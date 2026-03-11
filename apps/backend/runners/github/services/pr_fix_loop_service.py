"""
PR Fix Loop Service
===================

Applies one safe auto-fix round for a PR using the latest saved review result.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from pathlib import Path

try:
    from core.client import create_client
    from phase_config import (
        get_model_betas,
        get_thinking_kwargs_for_model,
        resolve_model_id,
    )
    from runners.github.gh_client import GHClient
    from runners.github.models import (
        GitHubRunnerConfig,
        PRFixResult,
        PRReviewFinding,
        PRReviewResult,
        ReviewSeverity,
    )
    from runners.github.services.agent_utils import create_working_dir_injector
    from runners.github.services.io_utils import safe_print
    from runners.github.services.sdk_utils import process_sdk_stream
except (ImportError, ValueError, SystemError):
    from core.client import create_client
    from gh_client import GHClient
    from models import (
        GitHubRunnerConfig,
        PRFixResult,
        PRReviewFinding,
        PRReviewResult,
        ReviewSeverity,
    )
    from phase_config import (
        get_model_betas,
        get_thinking_kwargs_for_model,
        resolve_model_id,
    )
    from services.agent_utils import create_working_dir_injector
    from services.io_utils import safe_print
    from services.sdk_utils import process_sdk_stream


logger = logging.getLogger(__name__)

SEVERITY_ORDER = {
    ReviewSeverity.CRITICAL: 4,
    ReviewSeverity.HIGH: 3,
    ReviewSeverity.MEDIUM: 2,
    ReviewSeverity.LOW: 1,
}

AUTO_FIXABLE_CATEGORIES = {"quality", "style", "test", "docs", "pattern"}
PROTECTED_PATH_PATTERNS = (
    re.compile(r"(^|/)\.env(\..*)?$"),
    re.compile(r"(^|/).*\.(pem|key|p12|crt)$"),
    re.compile(r"(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$"),
    re.compile(r"(^|/)(vercel\.json|wrangler\.toml|fly\.toml|render\.yaml)$"),
    re.compile(r"(^|/)\.github/workflows/"),
)


def _severity_at_or_above(value: str, threshold: str) -> bool:
    try:
        current = SEVERITY_ORDER[ReviewSeverity(value)]
        minimum = SEVERITY_ORDER[ReviewSeverity(threshold)]
    except ValueError:
        current = SEVERITY_ORDER[ReviewSeverity.MEDIUM]
        minimum = SEVERITY_ORDER[ReviewSeverity.MEDIUM]
    return current >= minimum


def _is_fixable_candidate(finding: PRReviewFinding, severity_threshold: str) -> bool:
    return (
        finding.fixable
        and finding.category.value in AUTO_FIXABLE_CATEGORIES
        and _severity_at_or_above(finding.severity.value, severity_threshold)
    )


def select_fix_candidates(
    review: PRReviewResult,
    severity_threshold: str,
) -> tuple[list[PRReviewFinding], list[str]]:
    """Select low-risk findings that the fixer may edit automatically."""
    candidates: list[PRReviewFinding] = []
    skipped: list[str] = []

    for finding in review.findings:
        if _is_fixable_candidate(finding, severity_threshold):
            candidates.append(finding)
        else:
            skipped.append(finding.id)

    return candidates, skipped


def build_attempt_signature(
    reviewed_commit_sha: str | None,
    candidates: list[PRReviewFinding],
    comment_fingerprints: list[str] | None = None,
) -> str:
    """Build an idempotency signature for a single fix attempt."""
    payload = {
        "reviewed_commit_sha": reviewed_commit_sha or "",
        "candidate_ids": sorted(f.id for f in candidates),
        "comment_fingerprints": sorted(comment_fingerprints or []),
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode("utf-8")
    ).hexdigest()


def find_protected_files(files: list[str]) -> list[str]:
    """Return changed files that should force human handoff."""
    protected: list[str] = []
    for file_path in files:
        normalized = file_path.replace("\\", "/")
        if any(pattern.search(normalized) for pattern in PROTECTED_PATH_PATTERNS):
            protected.append(file_path)
    return protected


class PRFixLoopService:
    """Runs a single safe auto-fix round for a PR."""

    max_changed_files = 8
    max_total_loc = 400

    def __init__(
        self,
        project_dir: Path,
        github_dir: Path,
        config: GitHubRunnerConfig,
        progress_callback=None,
    ):
        self.project_dir = Path(project_dir)
        self.github_dir = Path(github_dir)
        self.config = config
        self.progress_callback = progress_callback
        self.gh_client = GHClient(
            project_dir=self.project_dir,
            default_timeout=30.0,
            max_retries=3,
            enable_rate_limiting=True,
            repo=config.repo,
        )
        self._with_working_dir = create_working_dir_injector(self.project_dir)

    def _report_progress(self, phase: str, progress: int, message: str, **kwargs) -> None:
        if self.progress_callback:
            import sys

            if "orchestrator" in sys.modules:
                ProgressCallback = sys.modules["orchestrator"].ProgressCallback
            else:
                try:
                    from ..orchestrator import ProgressCallback
                except ImportError:
                    from orchestrator import ProgressCallback

            self.progress_callback(
                ProgressCallback(
                    phase=phase,
                    progress=progress,
                    message=message,
                    **kwargs,
                )
            )

    def _load_prompt(self) -> str:
        prompt_file = (
            Path(__file__).parent.parent.parent.parent
            / "prompts"
            / "github"
            / "pr_fix_loop.md"
        )
        if not prompt_file.exists():
            raise FileNotFoundError(f"PR fix loop prompt not found: {prompt_file}")
        return prompt_file.read_text(encoding="utf-8")

    async def _run_git(
        self,
        *args: str,
        check: bool = True,
    ) -> str:
        process = await asyncio.create_subprocess_exec(
            "git",
            *args,
            cwd=str(self.project_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        out = stdout.decode("utf-8", errors="replace").strip()
        err = stderr.decode("utf-8", errors="replace").strip()
        if check and process.returncode != 0:
            raise RuntimeError(err or out or f"git {' '.join(args)} failed")
        return out

    async def _ensure_clean_worktree(self) -> None:
        status = await self._run_git("status", "--porcelain")
        if status:
            raise RuntimeError(
                "Working tree is not clean. Commit or stash local changes before starting PR fix loop."
            )

    async def _get_diff_stats(self) -> tuple[list[str], int, int]:
        files = await self._run_git("diff", "--name-only")
        numstat = await self._run_git("diff", "--numstat")
        changed_files = [line.strip() for line in files.splitlines() if line.strip()]

        added = 0
        removed = 0
        for line in numstat.splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            if parts[0].isdigit():
                added += int(parts[0])
            if parts[1].isdigit():
                removed += int(parts[1])

        return changed_files, added, removed

    async def _collect_comment_context(
        self,
        pr_number: int,
        since_timestamp: str,
    ) -> tuple[str, dict[str, int], list[str]]:
        comments_payload = await self.gh_client.get_comments_since(pr_number, since_timestamp)
        reviews = await self.gh_client.get_reviews_since(pr_number, since_timestamp)

        review_comments = comments_payload.get("review_comments", [])
        issue_comments = comments_payload.get("issue_comments", [])

        comment_fingerprints = [
            f"review_comment:{comment.get('id')}" for comment in review_comments if comment.get("id")
        ] + [
            f"issue_comment:{comment.get('id')}" for comment in issue_comments if comment.get("id")
        ] + [
            f"review:{review.get('id')}" for review in reviews if review.get("id")
        ]

        sections: list[str] = []
        if review_comments:
            lines = []
            for comment in review_comments[:10]:
                author = comment.get("user", {}).get("login", "unknown")
                location = f"{comment.get('path', '')}:{comment.get('line', 0) or 0}"
                body = (comment.get("body") or "").strip()
                lines.append(f"- @{author} on {location}: {body[:300]}")
            sections.append("### New review comments\n" + "\n".join(lines))

        if issue_comments:
            lines = []
            for comment in issue_comments[:10]:
                author = comment.get("user", {}).get("login", "unknown")
                body = (comment.get("body") or "").strip()
                lines.append(f"- @{author}: {body[:300]}")
            sections.append("### New PR discussion comments\n" + "\n".join(lines))

        if reviews:
            lines = []
            for review in reviews[:10]:
                author = review.get("user", {}).get("login", "unknown")
                body = (review.get("body") or "").strip()
                state = review.get("state", "COMMENTED")
                lines.append(f"- @{author} [{state}]: {body[:500]}")
            sections.append("### New formal reviews\n" + "\n".join(lines))

        return (
            "\n\n".join(sections) if sections else "No new GitHub comments or reviews since the last review.",
            {
                "review_comments": len(review_comments),
                "issue_comments": len(issue_comments),
                "reviews": len(reviews),
            },
            comment_fingerprints,
        )

    def _build_prompt(
        self,
        review: PRReviewResult,
        candidates: list[PRReviewFinding],
        comment_context: str,
    ) -> str:
        findings_blob = json.dumps(
            [
                {
                    "id": finding.id,
                    "severity": finding.severity.value,
                    "category": finding.category.value,
                    "title": finding.title,
                    "description": finding.description,
                    "file": finding.file,
                    "line": finding.line,
                    "end_line": finding.end_line,
                    "suggested_fix": finding.suggested_fix,
                }
                for finding in candidates
            ],
            indent=2,
            ensure_ascii=False,
        )

        review_summary = {
            "summary": review.summary,
            "reviewed_commit_sha": review.reviewed_commit_sha,
            "reviewed_at": review.reviewed_at,
            "posted_at": review.posted_at,
        }

        prompt = self._load_prompt()
        full_prompt = f"""
{prompt}

## Review Summary

```json
{json.dumps(review_summary, indent=2, ensure_ascii=False)}
```

## Findings To Fix

```json
{findings_blob}
```

## New GitHub Review Context

{comment_context}
"""
        return self._with_working_dir(full_prompt, full_prompt)

    async def _run_fix_agent(self, prompt: str) -> dict:
        model_short = self.config.model or "sonnet"
        model = resolve_model_id(model_short)
        betas = get_model_betas(model_short)
        thinking_kwargs = get_thinking_kwargs_for_model(model, self.config.thinking_level)

        client = create_client(
            project_dir=self.project_dir,
            spec_dir=self.github_dir,
            model=model,
            agent_type="qa_fixer",
            betas=betas,
            fast_mode=self.config.fast_mode,
            **thinking_kwargs,
        )

        async with client:
            await client.query(prompt)

            stream_result = await process_sdk_stream(
                client,
                context_name="PRFixer",
                model=model,
                on_text=lambda text: safe_print(text, flush=True),
                on_tool_use=lambda tool_name, _tool_id, tool_input: safe_print(
                    f"[PRFixer] Tool: {tool_name} {json.dumps(tool_input, ensure_ascii=False)[:240]}",
                    flush=True,
                ),
                on_tool_result=lambda tool_id, is_error, _result: safe_print(
                    f"[PRFixer] Tool result ({tool_id}): {'error' if is_error else 'ok'}",
                    flush=True,
                ),
            )

        return stream_result

    async def fix_pr(
        self,
        pr_number: int,
        severity_threshold: str = "medium",
        last_attempt_signature: str | None = None,
    ) -> PRFixResult:
        """Apply one safe auto-fix round for a PR."""
        self._report_progress(
            "fetching",
            10,
            f"Preparing auto-fix context for PR #{pr_number}...",
            pr_number=pr_number,
        )

        review = PRReviewResult.load(self.github_dir, pr_number)
        if not review:
            return PRFixResult(
                pr_number=pr_number,
                status="failed",
                reason="No saved PR review found. Run a PR review before starting the fix loop.",
                error="review_missing",
            )

        if not review.reviewed_commit_sha:
            return PRFixResult(
                pr_number=pr_number,
                status="handoff",
                reason="Saved review is missing reviewed_commit_sha, so idempotent auto-fix is unsafe.",
                error="missing_reviewed_commit_sha",
            )

        await self._ensure_clean_worktree()
        head_sha_before = await self._run_git("rev-parse", "HEAD")
        if head_sha_before != review.reviewed_commit_sha:
            return PRFixResult(
                pr_number=pr_number,
                status="handoff",
                reason=(
                    "Current HEAD does not match the reviewed commit. "
                    "Run follow-up review first so fixes target the latest code."
                ),
                reviewed_commit_sha=review.reviewed_commit_sha,
                head_sha_before=head_sha_before,
                error="stale_review",
            )

        candidates, skipped = select_fix_candidates(review, severity_threshold)
        comment_context, comment_counts, comment_fingerprints = (
            await self._collect_comment_context(
                pr_number,
                review.posted_at or review.reviewed_at,
            )
        )
        attempt_signature = build_attempt_signature(
            review.reviewed_commit_sha,
            candidates,
            comment_fingerprints,
        )

        if last_attempt_signature and attempt_signature == last_attempt_signature:
            return PRFixResult(
                pr_number=pr_number,
                status="noop",
                reason="This fix attempt matches the previous signature; stopping to avoid a loop.",
                reviewed_commit_sha=review.reviewed_commit_sha,
                head_sha_before=head_sha_before,
                candidate_finding_ids=[finding.id for finding in candidates],
                skipped_finding_ids=skipped,
                attempt_signature=attempt_signature,
                comment_context=comment_counts,
            )

        if not candidates:
            return PRFixResult(
                pr_number=pr_number,
                status="handoff",
                reason=(
                    "No low-risk fixable findings matched the configured threshold. "
                    "Human review is required."
                ),
                reviewed_commit_sha=review.reviewed_commit_sha,
                head_sha_before=head_sha_before,
                skipped_finding_ids=skipped,
                attempt_signature=attempt_signature,
                comment_context=comment_counts,
            )

        self._report_progress(
            "analyzing",
            35,
            f"Applying {len(candidates)} fixable finding(s) for PR #{pr_number}...",
            pr_number=pr_number,
        )

        prompt = self._build_prompt(review, candidates, comment_context)
        stream_result = await self._run_fix_agent(prompt)
        if stream_result.get("error"):
            return PRFixResult(
                pr_number=pr_number,
                status="failed",
                reason="Claude fixer session failed before producing a stable edit.",
                reviewed_commit_sha=review.reviewed_commit_sha,
                head_sha_before=head_sha_before,
                candidate_finding_ids=[finding.id for finding in candidates],
                skipped_finding_ids=skipped,
                attempt_signature=attempt_signature,
                comment_context=comment_counts,
                error=str(stream_result["error"]),
            )

        changed_files, loc_added, loc_removed = await self._get_diff_stats()
        if not changed_files:
            return PRFixResult(
                pr_number=pr_number,
                status="noop",
                reason="Fixer session completed without changing tracked files.",
                reviewed_commit_sha=review.reviewed_commit_sha,
                head_sha_before=head_sha_before,
                candidate_finding_ids=[finding.id for finding in candidates],
                skipped_finding_ids=skipped,
                attempt_signature=attempt_signature,
                comment_context=comment_counts,
            )

        protected_files = find_protected_files(changed_files)
        if protected_files:
            return PRFixResult(
                pr_number=pr_number,
                status="handoff",
                reason=f"Protected files changed during auto-fix: {', '.join(protected_files)}",
                reviewed_commit_sha=review.reviewed_commit_sha,
                head_sha_before=head_sha_before,
                changed_files=changed_files,
                loc_added=loc_added,
                loc_removed=loc_removed,
                candidate_finding_ids=[finding.id for finding in candidates],
                skipped_finding_ids=skipped,
                attempt_signature=attempt_signature,
                comment_context=comment_counts,
                error="protected_file_modified",
            )

        if len(changed_files) > self.max_changed_files or (loc_added + loc_removed) > self.max_total_loc:
            return PRFixResult(
                pr_number=pr_number,
                status="handoff",
                reason=(
                    "Auto-fix exceeded the safe change budget "
                    f"({len(changed_files)} files, {loc_added + loc_removed} LOC)."
                ),
                reviewed_commit_sha=review.reviewed_commit_sha,
                head_sha_before=head_sha_before,
                changed_files=changed_files,
                loc_added=loc_added,
                loc_removed=loc_removed,
                candidate_finding_ids=[finding.id for finding in candidates],
                skipped_finding_ids=skipped,
                attempt_signature=attempt_signature,
                comment_context=comment_counts,
                error="change_budget_exceeded",
            )

        parent_sha = head_sha_before
        await self._run_git("add", "--", *changed_files)
        commit_message = f"fix(pr): address review findings for PR #{pr_number}"
        commit_output = await self._run_git("commit", "-m", commit_message)
        logger.info("Created auto-fix commit for PR #%s: %s", pr_number, commit_output)

        commit_sha = await self._run_git("rev-parse", "HEAD")

        try:
            await self._run_git("push")
            push_succeeded = True
            head_sha_after = await self._run_git("rev-parse", "HEAD")
            self._report_progress(
                "posting",
                80,
                f"Pushed auto-fix commit {commit_sha[:8]} for PR #{pr_number}.",
                pr_number=pr_number,
            )
        except Exception as exc:
            return PRFixResult(
                pr_number=pr_number,
                status="failed",
                reason=f"Created commit {commit_sha[:8]} but push failed.",
                reviewed_commit_sha=review.reviewed_commit_sha,
                head_sha_before=head_sha_before,
                head_sha_after=commit_sha,
                parent_sha=parent_sha,
                commit_sha=commit_sha,
                push_succeeded=False,
                changed_files=changed_files,
                loc_added=loc_added,
                loc_removed=loc_removed,
                candidate_finding_ids=[finding.id for finding in candidates],
                attempted_finding_ids=[finding.id for finding in candidates],
                skipped_finding_ids=skipped,
                attempt_signature=attempt_signature,
                comment_context=comment_counts,
                error=str(exc),
            )

        return PRFixResult(
            pr_number=pr_number,
            status="fixed",
            reason=f"Applied auto-fix commit {commit_sha[:8]} and pushed successfully.",
            reviewed_commit_sha=review.reviewed_commit_sha,
            head_sha_before=head_sha_before,
            head_sha_after=head_sha_after,
            parent_sha=parent_sha,
            commit_sha=commit_sha,
            push_succeeded=push_succeeded,
            changed_files=changed_files,
            loc_added=loc_added,
            loc_removed=loc_removed,
            candidate_finding_ids=[finding.id for finding in candidates],
            attempted_finding_ids=[finding.id for finding in candidates],
            skipped_finding_ids=skipped,
            attempt_signature=attempt_signature,
            comment_context=comment_counts,
        )

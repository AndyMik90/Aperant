"""
PR Review Engine
================

Core logic for multi-pass PR code review.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from ...phase_config import get_model_betas, resolve_model_id
    from ..context_gatherer import PRContext
    from ..models import (
        AICommentTriage,
        GitHubRunnerConfig,
        PRReviewFinding,
        ReviewPass,
        StructuralIssue,
    )
    from .io_utils import safe_print
    from .prompt_manager import PromptManager
    from .response_parsers import ResponseParser
except (ImportError, ValueError, SystemError):
    from context_gatherer import PRContext
    from models import (
        AICommentTriage,
        GitHubRunnerConfig,
        PRReviewFinding,
        ReviewPass,
        StructuralIssue,
    )
    from phase_config import get_model_betas, resolve_model_id
    from services.io_utils import safe_print
    from services.prompt_manager import PromptManager
    from services.response_parsers import ResponseParser


# Define a local ProgressCallback to avoid circular import
@dataclass
class ProgressCallback:
    """Callback for progress updates - local definition to avoid circular import."""

    phase: str
    progress: int
    message: str
    pr_number: int | None = None
    extra: dict[str, Any] | None = None


class PRReviewEngine:
    """Handles multi-pass PR review workflow."""

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
        self.prompt_manager = PromptManager()
        self.parser = ResponseParser()

    def _report_progress(self, phase: str, progress: int, message: str, **kwargs):
        """Report progress if callback is set."""
        if self.progress_callback:
            # ProgressCallback is imported at module level
            self.progress_callback(
                ProgressCallback(
                    phase=phase, progress=progress, message=message, **kwargs
                )
            )

    def needs_deep_analysis(self, scan_result: dict, context: PRContext) -> bool:
        """Determine if PR needs deep analysis pass."""
        total_changes = context.total_additions + context.total_deletions

        if total_changes > 200:
            safe_print(
                f"[AI] Deep analysis needed: {total_changes} lines changed", flush=True
            )
            return True

        complexity = scan_result.get("complexity", "low")
        if complexity in ["high", "medium"]:
            safe_print(f"[AI] Deep analysis needed: {complexity} complexity")
            return True

        risk_areas = scan_result.get("risk_areas", [])
        if risk_areas:
            safe_print(
                f"[AI] Deep analysis needed: {len(risk_areas)} risk areas", flush=True
            )
            return True

        return False

    def deduplicate_findings(
        self, findings: list[PRReviewFinding]
    ) -> list[PRReviewFinding]:
        """Remove duplicate findings from multiple passes."""
        seen = set()
        unique = []
        for f in findings:
            key = (f.file, f.line, f.title.lower().strip())
            if key not in seen:
                seen.add(key)
                unique.append(f)
            else:
                safe_print(
                    f"[AI] Skipping duplicate finding: {f.file}:{f.line} - {f.title}",
                    flush=True,
                )
        return unique

    async def run_review_pass(
        self,
        review_pass: ReviewPass,
        context: PRContext,
    ) -> dict | list[PRReviewFinding]:
        """Run a single review pass and return findings or scan result."""
        from core.client import create_client

        pass_prompt = self.prompt_manager.get_review_pass_prompt(review_pass)

        # Format changed files for display
        files_list = []
        for file in context.changed_files[:20]:
            files_list.append(f"- `{file.path}` (+{file.additions}/-{file.deletions})")
        if len(context.changed_files) > 20:
            files_list.append(f"- ... and {len(context.changed_files) - 20} more files")
        files_str = "\n".join(files_list)

        # Removed: Related files section
        # LLM agents now discover relevant files themselves via Read, Grep, Glob tools
        related_files_str = ""

        # NEW: Format commits for context
        commits_str = ""
        if context.commits:
            commits_list = []
            for commit in context.commits[:5]:  # Show last 5 commits
                sha = commit.get("oid", "")[:7]
                message = commit.get("messageHeadline", "")
                commits_list.append(f"- `{sha}` {message}")
            if len(context.commits) > 5:
                commits_list.append(
                    f"- ... and {len(context.commits) - 5} more commits"
                )
            commits_str = f"""
### Commits in this PR
{chr(10).join(commits_list)}
"""

        # NEW: Handle diff - use individual patches if full diff unavailable
        diff_content = context.diff
        diff_truncated_warning = ""

        # If diff is empty/truncated, build composite from individual file patches
        if context.diff_truncated or not context.diff:
            safe_print(
                f"[AI] Building composite diff from {len(context.changed_files)} file patches...",
                flush=True,
            )
            patches = []
            for file in context.changed_files[:50]:  # Limit to 50 files for large PRs
                if file.patch:
                    patches.append(file.patch)
            diff_content = "\n".join(patches)

            if len(context.changed_files) > 50:
                diff_truncated_warning = (
                    f"\n⚠️ **WARNING**: PR has {len(context.changed_files)} changed files. "
                    "Showing patches for first 50 files only. Review may be incomplete.\n"
                )
            else:
                diff_truncated_warning = (
                    "\n⚠️ **NOTE**: Full PR diff unavailable (PR > 20,000 lines). "
                    "Using individual file patches instead.\n"
                )

        # Truncate very large diffs
        diff_size = len(diff_content)
        if diff_size > 50000:
            diff_content = diff_content[:50000]
            diff_truncated_warning = f"\n⚠️ **WARNING**: Diff truncated from {diff_size} to 50,000 characters. Review may be incomplete.\n"

        pr_context = f"""
## Pull Request #{context.pr_number}

**Title:** {context.title}
**Author:** {context.author}
**Base:** {context.base_branch} ← **Head:** {context.head_branch}
**Changes:** {context.total_additions} additions, {context.total_deletions} deletions across {len(context.changed_files)} files

### Description
{context.description}

### Files Changed
{files_str}
{related_files_str}{commits_str}
### Diff
```diff
{diff_content}
```{diff_truncated_warning}
"""

        full_prompt = pass_prompt + "\n\n---\n\n" + pr_context

        project_root = (
            self.project_dir.parent.parent
            if self.project_dir.name == "backend"
            else self.project_dir
        )

        # Resolve model shorthand (e.g., "sonnet") to full model ID for API compatibility
        model_shorthand = self.config.model or "sonnet"
        model = resolve_model_id(model_shorthand)
        betas = get_model_betas(model_shorthand)
        client = create_client(
            project_dir=project_root,
            spec_dir=self.github_dir,
            model=model,
            agent_type="pr_reviewer",  # Read-only - no bash, no edits
            betas=betas,
            fast_mode=self.config.fast_mode,
        )

        result_text = ""
        try:
            async with client:
                await client.query(full_prompt)

                async for msg in client.receive_response():
                    msg_type = type(msg).__name__
                    if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            # Must check block type - only TextBlock has .text attribute
                            block_type = type(block).__name__
                            if block_type == "TextBlock" and hasattr(block, "text"):
                                result_text += block.text

            if review_pass == ReviewPass.QUICK_SCAN:
                return self.parser.parse_scan_result(result_text)
            else:
                return self.parser.parse_review_findings(result_text)

        except Exception as e:
            import logging
            import traceback

            logger = logging.getLogger(__name__)
            error_msg = f"Review pass {review_pass.value} failed: {e}"
            logger.error(error_msg)
            logger.error(f"Traceback: {traceback.format_exc()}")
            safe_print(f"[AI] ERROR: {error_msg}")

            # Re-raise to allow caller to handle or track partial failures
            raise RuntimeError(error_msg) from e

    async def run_multi_pass_review(
        self, context: PRContext
    ) -> tuple[
        list[PRReviewFinding], list[StructuralIssue], list[AICommentTriage], dict
    ]:
        """
        Run multi-pass review for comprehensive analysis.

        Optimized for speed: Pass 1 runs first (needed to decide on Pass 4),
        then Passes 2-6 run in parallel.

        Returns:
            Tuple of (findings, structural_issues, ai_triages, quick_scan_summary)
        """
        # Use parallel orchestrator with SDK subagents if enabled
        if self.config.use_parallel_orchestrator:
            safe_print(
                "[AI] Using parallel orchestrator PR review (SDK subagents)...",
                flush=True,
            )
            self._report_progress(
                "orchestrating",
                10,
                "Starting parallel orchestrator review...",
                pr_number=context.pr_number,
            )

            from .parallel_orchestrator_reviewer import ParallelOrchestratorReviewer

            orchestrator = ParallelOrchestratorReviewer(
                project_dir=self.project_dir,
                github_dir=self.github_dir,
                config=self.config,
                progress_callback=self.progress_callback,
            )

            result = await orchestrator.review(context)

            safe_print(
                f"[PR Review Engine] Parallel orchestrator returned {len(result.findings)} findings",
                flush=True,
            )

            quick_scan_summary = {
                "verdict": result.verdict.value if result.verdict else "unknown",
                "findings_count": len(result.findings),
                "strategy": "parallel_orchestrator",
            }

            return (result.findings, [], [], quick_scan_summary)

        # Fall back to multi-pass review
        all_findings = []
        structural_issues = []
        ai_triages = []

        # Pass 1: Quick Scan (must run first - determines if deep analysis needed)
        safe_print("[AI] Pass 1/6: Quick Scan - Understanding scope...")
        self._report_progress(
            "analyzing",
            35,
            "Pass 1/6: Quick Scan...",
            pr_number=context.pr_number,
        )
        scan_result = await self.run_review_pass(ReviewPass.QUICK_SCAN, context)

        # Determine which passes to run in parallel
        needs_deep = self.needs_deep_analysis(scan_result, context)
        has_ai_comments = len(context.ai_bot_comments) > 0

        # Build list of parallel tasks
        parallel_tasks = []
        task_names = []

        safe_print("[AI] Running passes 2-6 in parallel...")
        self._report_progress(
            "analyzing",
            50,
            "Running Security, Quality, Structural & AI Triage in parallel...",
            pr_number=context.pr_number,
        )

        async def run_security_pass():
            safe_print(
                "[AI] Pass 2/6: Security Review - Analyzing vulnerabilities...",
                flush=True,
            )
            findings = await self.run_review_pass(ReviewPass.SECURITY, context)
            safe_print(f"[AI] Security pass complete: {len(findings)} findings")
            return ("security", findings)

        async def run_quality_pass():
            safe_print(
                "[AI] Pass 3/6: Quality Review - Checking code quality...", flush=True
            )
            findings = await self.run_review_pass(ReviewPass.QUALITY, context)
            safe_print(f"[AI] Quality pass complete: {len(findings)} findings")
            return ("quality", findings)

        async def run_structural_pass():
            safe_print(
                "[AI] Pass 4/6: Structural Review - Checking for feature creep...",
                flush=True,
            )
            result_text = await self._run_structural_pass(context)
            issues = self.parser.parse_structural_issues(result_text)
            safe_print(f"[AI] Structural pass complete: {len(issues)} issues")
            return ("structural", issues)

        async def run_ai_triage_pass():
            safe_print(
                "[AI] Pass 5/6: AI Comment Triage - Verifying other AI comments...",
                flush=True,
            )
            result_text = await self._run_ai_triage_pass(context)
            triages = self.parser.parse_ai_comment_triages(result_text)
            safe_print(
                f"[AI] AI triage complete: {len(triages)} comments triaged", flush=True
            )
            return ("ai_triage", triages)

        async def run_deep_pass():
            safe_print(
                "[AI] Pass 6/6: Deep Analysis - Reviewing business logic...", flush=True
            )
            findings = await self.run_review_pass(ReviewPass.DEEP_ANALYSIS, context)
            safe_print(f"[AI] Deep analysis complete: {len(findings)} findings")
            return ("deep", findings)

        # Always run security, quality, structural
        parallel_tasks.append(run_security_pass())
        task_names.append("Security")

        parallel_tasks.append(run_quality_pass())
        task_names.append("Quality")

        parallel_tasks.append(run_structural_pass())
        task_names.append("Structural")

        # Only run AI triage if there are AI comments
        if has_ai_comments:
            parallel_tasks.append(run_ai_triage_pass())
            task_names.append("AI Triage")
            safe_print(
                f"[AI] Found {len(context.ai_bot_comments)} AI comments to triage",
                flush=True,
            )
        else:
            safe_print("[AI] Pass 5/6: Skipped (no AI comments to triage)")

        # Only run deep analysis if needed
        if needs_deep:
            parallel_tasks.append(run_deep_pass())
            task_names.append("Deep Analysis")
        else:
            safe_print("[AI] Pass 6/6: Skipped (changes not complex enough)")

        # Run all passes in parallel
        safe_print(
            f"[AI] Executing {len(parallel_tasks)} passes in parallel: {', '.join(task_names)}",
            flush=True,
        )
        results = await asyncio.gather(*parallel_tasks, return_exceptions=True)

        # Collect results from all parallel passes
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                safe_print(f"[AI] Pass '{task_names[i]}' failed: {result}")
            elif isinstance(result, tuple):
                pass_type, data = result
                if pass_type in ("security", "quality", "deep"):
                    all_findings.extend(data)
                elif pass_type == "structural":
                    structural_issues.extend(data)
                elif pass_type == "ai_triage":
                    ai_triages.extend(data)

        self._report_progress(
            "analyzing",
            85,
            "Deduplicating findings...",
            pr_number=context.pr_number,
        )

        # Deduplicate findings
        safe_print(
            f"[AI] Deduplicating {len(all_findings)} findings from all passes...",
            flush=True,
        )
        unique_findings = self.deduplicate_findings(all_findings)
        safe_print(
            f"[AI] Multi-pass review complete: {len(unique_findings)} findings, "
            f"{len(structural_issues)} structural issues, {len(ai_triages)} AI triages",
            flush=True,
        )

        return unique_findings, structural_issues, ai_triages, scan_result

    async def _run_structural_pass(self, context: PRContext) -> str:
        """Run the structural review pass."""
        from core.client import create_client

        # Load the structural prompt file
        prompt_file = (
            Path(__file__).parent.parent.parent.parent
            / "prompts"
            / "github"
            / "pr_structural.md"
        )
        if prompt_file.exists():
            prompt = prompt_file.read_text(encoding="utf-8")
        else:
            prompt = self.prompt_manager.get_review_pass_prompt(ReviewPass.STRUCTURAL)

        # Build context string
        pr_context = self._build_review_context(context)
        full_prompt = prompt + "\n\n---\n\n" + pr_context

        project_root = (
            self.project_dir.parent.parent
            if self.project_dir.name == "backend"
            else self.project_dir
        )

        # Resolve model shorthand (e.g., "sonnet") to full model ID for API compatibility
        model_shorthand = self.config.model or "sonnet"
        model = resolve_model_id(model_shorthand)
        betas = get_model_betas(model_shorthand)
        client = create_client(
            project_dir=project_root,
            spec_dir=self.github_dir,
            model=model,
            agent_type="pr_reviewer",  # Read-only - no bash, no edits
            betas=betas,
            fast_mode=self.config.fast_mode,
        )

        result_text = ""
        try:
            async with client:
                await client.query(full_prompt)
                async for msg in client.receive_response():
                    msg_type = type(msg).__name__
                    if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            # Must check block type - only TextBlock has .text attribute
                            block_type = type(block).__name__
                            if block_type == "TextBlock" and hasattr(block, "text"):
                                result_text += block.text
        except Exception as e:
            safe_print(f"[AI] Structural pass error: {e}")

        return result_text

    async def _run_ai_triage_pass(self, context: PRContext) -> str:
        """Run the AI comment triage pass."""
        from core.client import create_client

        if not context.ai_bot_comments:
            return "[]"

        # Load the AI triage prompt file
        prompt_file = (
            Path(__file__).parent.parent.parent.parent
            / "prompts"
            / "github"
            / "pr_ai_triage.md"
        )
        if prompt_file.exists():
            prompt = prompt_file.read_text(encoding="utf-8")
        else:
            prompt = self.prompt_manager.get_review_pass_prompt(
                ReviewPass.AI_COMMENT_TRIAGE
            )

        # Build context with AI comments
        ai_comments_context = self._build_ai_comments_context(context)
        pr_context = self._build_review_context(context)
        full_prompt = (
            prompt + "\n\n---\n\n" + ai_comments_context + "\n\n---\n\n" + pr_context
        )

        project_root = (
            self.project_dir.parent.parent
            if self.project_dir.name == "backend"
            else self.project_dir
        )

        # Resolve model shorthand (e.g., "sonnet") to full model ID for API compatibility
        model_shorthand = self.config.model or "sonnet"
        model = resolve_model_id(model_shorthand)
        betas = get_model_betas(model_shorthand)
        client = create_client(
            project_dir=project_root,
            spec_dir=self.github_dir,
            model=model,
            agent_type="pr_reviewer",  # Read-only - no bash, no edits
            betas=betas,
            fast_mode=self.config.fast_mode,
        )

        result_text = ""
        try:
            async with client:
                await client.query(full_prompt)
                async for msg in client.receive_response():
                    msg_type = type(msg).__name__
                    if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            # Must check block type - only TextBlock has .text attribute
                            block_type = type(block).__name__
                            if block_type == "TextBlock" and hasattr(block, "text"):
                                result_text += block.text
        except Exception as e:
            safe_print(f"[AI] AI triage pass error: {e}")

        return result_text

    def _build_ai_comments_context(self, context: PRContext) -> str:
        """Build context string for AI comments that need triaging."""
        lines = [
            "## AI Tool Comments to Triage",
            "",
            f"Found {len(context.ai_bot_comments)} comments from AI code review tools:",
            "",
            "**IMPORTANT: Check the timeline! AI comments were made at specific times.",
            "If a later commit fixed the issue the AI flagged, use ADDRESSED (not FALSE_POSITIVE).**",
            "",
        ]

        for i, comment in enumerate(context.ai_bot_comments, 1):
            lines.append(f"### Comment {i}: {comment.tool_name}")
            lines.append(f"- **Comment ID**: {comment.comment_id}")
            lines.append(f"- **Author**: {comment.author}")
            lines.append(
                f"- **Commented At**: {comment.created_at}"
            )  # Include timestamp
            lines.append(f"- **File**: {comment.file or 'General'}")
            if comment.line:
                lines.append(f"- **Line**: {comment.line}")
            lines.append("")
            lines.append("**Comment:**")
            lines.append(comment.body)
            lines.append("")

        # Add commit timeline for reference
        if context.commits:
            lines.append("## Commit Timeline (for reference)")
            lines.append("")
            lines.append(
                "Use this to determine if issues were fixed AFTER AI comments:"
            )
            lines.append("")
            for commit in context.commits:
                sha = commit.get("oid", "")[:8]
                message = commit.get("messageHeadline", "")
                committed_at = commit.get("committedDate", "")
                lines.append(f"- `{sha}` ({committed_at}): {message}")
            lines.append("")

        return "\n".join(lines)

    def _build_review_context(self, context: PRContext) -> str:
        """Build full review context string."""
        files_list = []
        for file in context.changed_files[:30]:
            files_list.append(
                f"- `{file.path}` (+{file.additions}/-{file.deletions}) - {file.status}"
            )
        if len(context.changed_files) > 30:
            files_list.append(f"- ... and {len(context.changed_files) - 30} more files")
        files_str = "\n".join(files_list)

        # Handle diff - use individual patches if full diff unavailable
        diff_content = context.diff
        if context.diff_truncated or not context.diff:
            patches = []
            for file in context.changed_files[:50]:
                if file.patch:
                    patches.append(file.patch)
            diff_content = "\n".join(patches)

        return f"""
## Pull Request #{context.pr_number}

**Title:** {context.title}
**Author:** {context.author}
**Base:** {context.base_branch} ← **Head:** {context.head_branch}
**Status:** {context.state}
**Changes:** {context.total_additions} additions, {context.total_deletions} deletions across {len(context.changed_files)} files

### Description
{context.description}

### Files Changed
{files_str}

### Full Diff
```diff
{diff_content[:100000]}
```
"""

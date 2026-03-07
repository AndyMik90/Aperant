"""
Follow-up PR Reviewer
=====================

Focused review of changes since last review:
- Only analyzes new commits
- Checks if previous findings are resolved
- Reviews new comments from contributors and AI bots
- Determines if PR is ready to merge

Supports both:
- Heuristic-based review (fast, no AI cost)
- AI-powered review (thorough, uses Claude)
"""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..models import FollowupReviewContext, GitHubRunnerConfig

try:
    from ...core.client import create_client
    from ...phase_config import resolve_model_id
    from ..gh_client import GHClient
    from ..models import (
        MergeVerdict,
        PRReviewFinding,
        PRReviewResult,
        ReviewCategory,
        ReviewSeverity,
        _utc_now_iso,
    )
    from .category_utils import map_category
    from .io_utils import safe_print
    from .prompt_manager import PromptManager
    from .pydantic_models import FollowupExtractionResponse, FollowupReviewResponse
    from .recovery_utils import create_finding_from_summary
    from .sdk_utils import process_sdk_stream
except (ImportError, ValueError, SystemError):
    from core.client import create_client
    from gh_client import GHClient
    from models import (
        MergeVerdict,
        PRReviewFinding,
        PRReviewResult,
        ReviewCategory,
        ReviewSeverity,
        _utc_now_iso,
    )
    from phase_config import resolve_model_id
    from services.category_utils import map_category
    from services.io_utils import safe_print
    from services.prompt_manager import PromptManager
    from services.pydantic_models import (
        FollowupExtractionResponse,
        FollowupReviewResponse,
    )
    from services.recovery_utils import create_finding_from_summary
    from services.sdk_utils import process_sdk_stream

logger = logging.getLogger(__name__)

# Severity mapping for AI responses
_SEVERITY_MAPPING = {
    "critical": ReviewSeverity.CRITICAL,
    "high": ReviewSeverity.HIGH,
    "medium": ReviewSeverity.MEDIUM,
    "low": ReviewSeverity.LOW,
}


class FollowupReviewer:
    """
    Performs focused follow-up reviews of PRs.

    Key capabilities:
    1. Only reviews changes since last review (new commits)
    2. Checks if posted findings have been addressed
    3. Reviews new comments from contributors and AI bots
    4. Determines if PR is ready to merge

    Supports both heuristic and AI-powered review modes.
    """

    def __init__(
        self,
        project_dir: Path,
        github_dir: Path,
        config: GitHubRunnerConfig,
        progress_callback=None,
        use_ai: bool = True,
    ):
        self.project_dir = Path(project_dir)
        self.github_dir = Path(github_dir)
        self.config = config
        self.progress_callback = progress_callback
        self.use_ai = use_ai
        self.prompt_manager = PromptManager()

    def _report_progress(
        self, phase: str, progress: int, message: str, pr_number: int
    ) -> None:
        """Report progress to callback if available."""
        if self.progress_callback:
            self.progress_callback(
                {
                    "phase": phase,
                    "progress": progress,
                    "message": message,
                    "pr_number": pr_number,
                }
            )
        safe_print(f"[Followup] [{phase}] {message}")

    async def review_followup(
        self,
        context: FollowupReviewContext,
    ) -> PRReviewResult:
        """
        Perform a focused follow-up review.

        Returns:
            PRReviewResult with updated findings and resolution status
        """
        logger.info(f"[Followup] Starting follow-up review for PR #{context.pr_number}")
        logger.info(f"[Followup] Previous review at: {context.previous_commit_sha[:8]}")
        logger.info(f"[Followup] Current HEAD: {context.current_commit_sha[:8]}")
        logger.info(
            f"[Followup] {len(context.commits_since_review)} new commits, "
            f"{len(context.files_changed_since_review)} files changed"
        )

        self._report_progress(
            "analyzing", 20, "Checking finding resolution...", context.pr_number
        )

        # Phase 1: Check which previous findings are resolved
        previous_findings = context.previous_review.findings
        resolved, unresolved = self._check_finding_resolution(
            previous_findings,
            context.files_changed_since_review,
            context.diff_since_review,
        )

        self._report_progress(
            "analyzing",
            40,
            f"Resolved: {len(resolved)}, Unresolved: {len(unresolved)}",
            context.pr_number,
        )

        # Phase 2: Review new changes for new issues
        self._report_progress(
            "analyzing", 60, "Analyzing new changes...", context.pr_number
        )

        # Use AI-powered review if enabled and there are significant changes
        if self.use_ai and len(context.diff_since_review) > 100:
            try:
                ai_result = await self._run_ai_review(context, resolved, unresolved)
                if ai_result:
                    # AI review successful - use its findings
                    new_findings = ai_result.get("new_findings", [])
                    comment_findings = ai_result.get("comment_findings", [])
                    # AI may have more accurate resolution info
                    ai_resolutions = ai_result.get("finding_resolutions", [])
                    if ai_resolutions:
                        resolved, unresolved = self._apply_ai_resolutions(
                            previous_findings, ai_resolutions
                        )
                else:
                    # Fall back to heuristic
                    new_findings = self._check_new_changes_heuristic(
                        context.diff_since_review,
                        context.files_changed_since_review,
                    )
                    comment_findings = self._review_comments(
                        context.contributor_comments_since_review,
                        context.ai_bot_comments_since_review,
                    )
            except Exception as e:
                logger.warning(f"AI review failed, falling back to heuristic: {e}")
                new_findings = self._check_new_changes_heuristic(
                    context.diff_since_review,
                    context.files_changed_since_review,
                )
                comment_findings = self._review_comments(
                    context.contributor_comments_since_review,
                    context.ai_bot_comments_since_review,
                )
        else:
            # Heuristic-based review (fast, no AI cost)
            new_findings = self._check_new_changes_heuristic(
                context.diff_since_review,
                context.files_changed_since_review,
            )
            # Phase 3: Review contributor comments for questions/concerns
            self._report_progress(
                "analyzing", 80, "Reviewing comments...", context.pr_number
            )
            comment_findings = self._review_comments(
                context.contributor_comments_since_review,
                context.ai_bot_comments_since_review,
            )

        # Combine new findings
        all_new_findings = new_findings + comment_findings

        # Generate verdict
        verdict, verdict_reasoning, blockers = self._generate_followup_verdict(
            resolved_count=len(resolved),
            unresolved_findings=unresolved,
            new_findings=all_new_findings,
        )

        # Generate summary
        summary = self._generate_followup_summary(
            resolved_ids=[f.id for f in resolved],
            unresolved_ids=[f.id for f in unresolved],
            new_finding_ids=[f.id for f in all_new_findings],
            commits_count=len(context.commits_since_review),
            verdict=verdict,
            verdict_reasoning=verdict_reasoning,
        )

        # Map verdict to overall_status
        if verdict == MergeVerdict.BLOCKED:
            overall_status = "request_changes"
        elif verdict == MergeVerdict.NEEDS_REVISION:
            overall_status = "request_changes"
        elif verdict == MergeVerdict.MERGE_WITH_CHANGES:
            overall_status = "comment"
        else:
            overall_status = "approve"

        # Combine findings: unresolved from before + new ones
        all_findings = unresolved + all_new_findings

        self._report_progress(
            "complete", 100, "Follow-up review complete!", context.pr_number
        )

        # Get file blob SHAs for rebase-resistant follow-up reviews
        # Blob SHAs persist across rebases - same content = same blob SHA
        file_blobs: dict[str, str] = {}
        try:
            gh_client = GHClient(
                project_dir=self.project_dir,
                default_timeout=30.0,
                repo=self.config.repo,
            )
            pr_files = await gh_client.get_pr_files(context.pr_number)
            for file in pr_files:
                filename = file.get("filename", "")
                blob_sha = file.get("sha", "")
                if filename and blob_sha:
                    file_blobs[filename] = blob_sha
            logger.info(
                f"Captured {len(file_blobs)} file blob SHAs for follow-up tracking"
            )
        except Exception as e:
            logger.warning(f"Could not capture file blobs: {e}")

        return PRReviewResult(
            pr_number=context.pr_number,
            repo=self.config.repo,
            success=True,
            findings=all_findings,
            summary=summary,
            overall_status=overall_status,
            verdict=verdict,
            verdict_reasoning=verdict_reasoning,
            blockers=blockers,
            reviewed_at=_utc_now_iso(),
            # Follow-up specific fields
            reviewed_commit_sha=context.current_commit_sha,
            reviewed_file_blobs=file_blobs,
            is_followup_review=True,
            previous_review_id=context.previous_review.review_id,
            resolved_findings=[f.id for f in resolved],
            unresolved_findings=[f.id for f in unresolved],
            new_findings_since_last_review=[f.id for f in all_new_findings],
        )

    def _check_finding_resolution(
        self,
        previous_findings: list[PRReviewFinding],
        changed_files: list[str],
        diff: str,
    ) -> tuple[list[PRReviewFinding], list[PRReviewFinding]]:
        """
        Check which previous findings have been addressed.

        A finding is considered resolved if:
        - The file was modified AND the specific line was changed
        - OR the code pattern mentioned was removed
        """
        resolved = []
        unresolved = []

        for finding in previous_findings:
            # If the file wasn't changed, finding is still open
            if finding.file not in changed_files:
                unresolved.append(finding)
                continue

            # Check if the line was modified
            if self._line_appears_changed(finding.file, finding.line, diff):
                resolved.append(finding)
            else:
                # File was modified but the specific line wasn't clearly changed
                # Mark as unresolved - the contributor needs to address the actual issue
                # "Benefit of the doubt" was wrong - if the line wasn't changed, the issue persists
                unresolved.append(finding)

        return resolved, unresolved

    def _line_appears_changed(self, file: str, line: int | None, diff: str) -> bool:
        """Check if a specific line appears to have been changed in the diff."""
        if not diff:
            return False

        # Handle None or invalid line numbers (legacy data)
        if line is None or line <= 0:
            return True  # Assume changed if line unknown

        # Look for the file in the diff
        file_marker = f"--- a/{file}"
        if file_marker not in diff:
            return False

        # Find the file section in the diff
        file_start = diff.find(file_marker)
        next_file = diff.find("\n--- a/", file_start + 1)
        file_diff = diff[file_start:next_file] if next_file > 0 else diff[file_start:]

        # Parse hunk headers (@@...@@) to find if line was in a changed region
        hunk_pattern = r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@"
        for match in re.finditer(hunk_pattern, file_diff):
            start_line = int(match.group(1))
            count = int(match.group(2)) if match.group(2) else 1
            if start_line <= line <= start_line + count:
                return True

        return False

    def _check_new_changes_heuristic(
        self,
        diff: str,
        changed_files: list[str],
    ) -> list[PRReviewFinding]:
        """
        Do a quick heuristic check on new changes.

        This is a simplified check - full AI review would be more thorough.
        Looks for common issues in the diff.
        """
        findings = []

        if not diff:
            return findings

        # Check for common security issues in new code
        security_patterns = [
            (r"password\s*=\s*['\"][^'\"]+['\"]", "Hardcoded password detected"),
            (r"api[_-]?key\s*=\s*['\"][^'\"]+['\"]", "Hardcoded API key detected"),
            (r"secret\s*=\s*['\"][^'\"]+['\"]", "Hardcoded secret detected"),
            (r"eval\s*\(", "Use of eval() detected"),
            (r"dangerouslySetInnerHTML", "dangerouslySetInnerHTML usage detected"),
        ]

        for pattern, title in security_patterns:
            matches = re.finditer(pattern, diff, re.IGNORECASE)
            for match in matches:
                # Only flag if it's in a + line (added code)
                context = diff[max(0, match.start() - 50) : match.end() + 50]
                if "\n+" in context or context.startswith("+"):
                    findings.append(
                        PRReviewFinding(
                            id=hashlib.md5(
                                f"new-{pattern}-{match.start()}".encode(),
                                usedforsecurity=False,
                            ).hexdigest()[:12],
                            severity=ReviewSeverity.HIGH,
                            category=ReviewCategory.SECURITY,
                            title=title,
                            description=f"Potential security issue in new code: {title.lower()}",
                            file="(in diff)",
                            line=0,
                        )
                    )
                    break  # One finding per pattern is enough

        return findings

    def _review_comments(
        self,
        contributor_comments: list[dict],
        ai_bot_comments: list[dict],
    ) -> list[PRReviewFinding]:
        """
        Review new comments and generate findings if needed.

        - Check if contributor questions need attention
        - Flag unaddressed concerns
        """
        findings = []

        # Check contributor comments for questions/concerns
        for comment in contributor_comments:
            body = (comment.get("body") or "").lower()

            # Skip very short comments
            if len(body) < 20:
                continue

            # Look for question patterns
            is_question = "?" in body
            is_concern = any(
                word in body
                for word in [
                    "shouldn't",
                    "should not",
                    "concern",
                    "worried",
                    "instead of",
                    "why not",
                    "problem",
                    "issue",
                ]
            )

            if is_question or is_concern:
                author = ""
                if isinstance(comment.get("user"), dict):
                    author = comment["user"].get("login", "contributor")
                elif isinstance(comment.get("author"), dict):
                    author = comment["author"].get("login", "contributor")

                body_preview = (comment.get("body") or "")[:100]
                if len(comment.get("body", "")) > 100:
                    body_preview += "..."

                findings.append(
                    PRReviewFinding(
                        id=hashlib.md5(
                            f"comment-{comment.get('id', '')}".encode(),
                            usedforsecurity=False,
                        ).hexdigest()[:12],
                        severity=ReviewSeverity.MEDIUM,
                        category=ReviewCategory.QUALITY,
                        title="Contributor comment needs response",
                        description=f"Comment from {author}: {body_preview}",
                        file=comment.get("path", ""),
                        line=comment.get("line", 0) or 0,
                    )
                )

        return findings

    def _generate_followup_verdict(
        self,
        resolved_count: int,
        unresolved_findings: list[PRReviewFinding],
        new_findings: list[PRReviewFinding],
    ) -> tuple[MergeVerdict, str, list[str]]:
        """Generate verdict based on follow-up review results."""
        blockers = []

        # Count by severity
        critical_unresolved = sum(
            1 for f in unresolved_findings if f.severity == ReviewSeverity.CRITICAL
        )
        high_unresolved = sum(
            1 for f in unresolved_findings if f.severity == ReviewSeverity.HIGH
        )
        medium_unresolved = sum(
            1 for f in unresolved_findings if f.severity == ReviewSeverity.MEDIUM
        )
        low_unresolved = sum(
            1 for f in unresolved_findings if f.severity == ReviewSeverity.LOW
        )
        critical_new = sum(
            1 for f in new_findings if f.severity == ReviewSeverity.CRITICAL
        )
        high_new = sum(1 for f in new_findings if f.severity == ReviewSeverity.HIGH)
        medium_new = sum(1 for f in new_findings if f.severity == ReviewSeverity.MEDIUM)
        low_new = sum(1 for f in new_findings if f.severity == ReviewSeverity.LOW)

        # Critical and High are always blockers
        for f in unresolved_findings:
            if f.severity in [ReviewSeverity.CRITICAL, ReviewSeverity.HIGH]:
                blockers.append(f"Unresolved: {f.title} ({f.file}:{f.line})")

        for f in new_findings:
            if f.severity in [ReviewSeverity.CRITICAL, ReviewSeverity.HIGH]:
                blockers.append(f"New issue: {f.title}")

        # Determine verdict
        if critical_unresolved > 0 or critical_new > 0:
            verdict = MergeVerdict.BLOCKED
            reasoning = (
                f"Still blocked by {critical_unresolved + critical_new} critical issues "
                f"({critical_unresolved} unresolved, {critical_new} new)"
            )
        elif (
            high_unresolved > 0
            or high_new > 0
            or medium_unresolved > 0
            or medium_new > 0
        ):
            # High and Medium severity findings block merge
            verdict = MergeVerdict.NEEDS_REVISION
            total_blocking = high_unresolved + high_new + medium_unresolved + medium_new
            reasoning = (
                f"{total_blocking} issue(s) must be addressed "
                f"({high_unresolved + medium_unresolved} unresolved, {high_new + medium_new} new)"
            )
        elif low_unresolved > 0 or low_new > 0:
            # Only Low severity suggestions remaining - safe to merge (non-blocking)
            verdict = MergeVerdict.READY_TO_MERGE
            reasoning = (
                f"{resolved_count} issues resolved. "
                f"{low_unresolved + low_new} non-blocking suggestion(s) to consider."
            )
        else:
            verdict = MergeVerdict.READY_TO_MERGE
            reasoning = f"All {resolved_count} previous findings have been addressed. No new issues."

        return verdict, reasoning, blockers

    def _generate_followup_summary(
        self,
        resolved_ids: list[str],
        unresolved_ids: list[str],
        new_finding_ids: list[str],
        commits_count: int,
        verdict: MergeVerdict,
        verdict_reasoning: str,
    ) -> str:
        """Generate summary for follow-up review."""
        verdict_emoji = {
            MergeVerdict.READY_TO_MERGE: ":white_check_mark:",
            MergeVerdict.MERGE_WITH_CHANGES: ":yellow_circle:",
            MergeVerdict.NEEDS_REVISION: ":orange_circle:",
            MergeVerdict.BLOCKED: ":red_circle:",
        }

        lines = [
            "## Follow-up Review",
            "",
            f"Reviewed {commits_count} new commit(s) since last review.",
            "",
            f"### Verdict: {verdict_emoji.get(verdict, '')} {verdict.value.upper().replace('_', ' ')}",
            "",
            verdict_reasoning,
            "",
            "### Progress Since Last Review",
            f"- **Resolved**: {len(resolved_ids)} finding(s) addressed",
            f"- **Still Open**: {len(unresolved_ids)} finding(s) remaining",
            f"- **New Issues**: {len(new_finding_ids)} new finding(s) in recent commits",
            "",
        ]

        if verdict == MergeVerdict.READY_TO_MERGE:
            lines.extend(
                [
                    "### :rocket: Ready to Merge",
                    "All previous findings have been addressed and no new blocking issues were found.",
                    "",
                ]
            )

        lines.append("---")
        lines.append("_Generated by Auto Claude Follow-up Review_")

        return "\n".join(lines)

    async def _run_ai_review(
        self,
        context: FollowupReviewContext,
        resolved: list[PRReviewFinding],
        unresolved: list[PRReviewFinding],
    ) -> dict[str, Any] | None:
        """
        Run AI-powered follow-up review using structured outputs.

        Uses Claude Agent SDK's native structured output support to guarantee
        valid JSON responses matching the FollowupReviewResponse schema.

        Returns parsed AI response with finding resolutions and new findings,
        or None if AI review fails.
        """
        self._report_progress(
            "analyzing", 65, "Running AI-powered review...", context.pr_number
        )

        # Build the context for the AI
        prompt_template = self.prompt_manager.get_followup_review_prompt()

        # Format previous findings for the prompt
        previous_findings_text = "\n".join(
            [
                f"- [{f.id}] {f.severity.value.upper()}: {f.title} ({f.file}:{f.line})"
                for f in context.previous_review.findings
            ]
        )

        # Format commits with timestamps (for timeline correlation with AI comments)
        commits_text = "\n".join(
            [
                f"- {c.get('sha', '')[:8]} ({c.get('commit', {}).get('author', {}).get('date', 'unknown')}): {c.get('commit', {}).get('message', '').split(chr(10))[0]}"
                for c in context.commits_since_review
            ]
        )

        # Format contributor comments with timestamps
        contributor_comments_text = "\n".join(
            [
                f"- @{c.get('user', {}).get('login', 'unknown')} ({c.get('created_at', 'unknown')}): {c.get('body', '')[:200]}"
                for c in context.contributor_comments_since_review
            ]
        )

        # Format AI comments with timestamps for timeline awareness
        ai_comments_text = "\n".join(
            [
                f"- @{c.get('user', {}).get('login', 'unknown')} ({c.get('created_at', 'unknown')}): {c.get('body', '')[:200]}"
                for c in context.ai_bot_comments_since_review
            ]
        )

        # Format PR reviews (formal review submissions from Cursor, CodeRabbit, etc.)
        # These often contain detailed findings in the body, so we include more content
        pr_reviews_text = "\n\n".join(
            [
                f"**@{r.get('user', {}).get('login', 'unknown')}** ({r.get('state', 'COMMENTED')}):\n{r.get('body', '')[:2000]}"
                for r in context.pr_reviews_since_review
                if r.get("body", "").strip()  # Only include reviews with body content
            ]
        )

        # Build the full message
        user_message = f"""
{prompt_template}

---

## Context for This Review

### PREVIOUS REVIEW SUMMARY:
{context.previous_review.summary}

### PREVIOUS FINDINGS:
{previous_findings_text if previous_findings_text else "No previous findings."}

### NEW COMMITS SINCE LAST REVIEW:
{commits_text if commits_text else "No new commits."}

### DIFF SINCE LAST REVIEW:
```diff
{context.diff_since_review[:15000]}
```
{f"... (truncated, {len(context.diff_since_review)} total chars)" if len(context.diff_since_review) > 15000 else ""}

### FILES CHANGED SINCE LAST REVIEW:
{chr(10).join(f"- {f}" for f in context.files_changed_since_review) if context.files_changed_since_review else "No files changed."}

### CONTRIBUTOR COMMENTS SINCE LAST REVIEW:
{contributor_comments_text if contributor_comments_text else "No contributor comments."}

### AI BOT COMMENTS SINCE LAST REVIEW:
{ai_comments_text if ai_comments_text else "No AI bot comments."}

### PR REVIEWS SINCE LAST REVIEW (CodeRabbit, Gemini Code Assist, Cursor, etc.):
{pr_reviews_text if pr_reviews_text else "No PR reviews since last review."}

---

**IMPORTANT**: Pay special attention to the PR REVIEWS section above. These are formal code reviews from AI tools like CodeRabbit, Gemini Code Assist, Cursor, Greptile, etc. that may have identified issues in the recent changes. You should:
1. Consider their findings when evaluating the code
2. Create new findings for valid issues they identified that haven't been addressed
3. Note if the recent commits addressed concerns raised in these reviews

Analyze this follow-up review context and provide your structured response.
"""

        try:
            # Use Claude Agent SDK query() with structured outputs
            # Reference: https://platform.claude.com/docs/en/agent-sdk/structured-outputs
            from claude_agent_sdk import ClaudeAgentOptions, query
            from phase_config import get_thinking_budget, resolve_model_id

            model_shorthand = self.config.model or "sonnet"
            model = resolve_model_id(model_shorthand)
            thinking_level = self.config.thinking_level or "medium"
            thinking_budget = get_thinking_budget(thinking_level)

            # Debug: Log the schema being sent
            schema = FollowupReviewResponse.model_json_schema()
            logger.debug(
                f"[Followup] Using output_format schema: {list(schema.get('properties', {}).keys())}"
            )
            safe_print(f"[Followup] SDK query with output_format, model={model}")

            # Capture assistant text for extraction fallback
            captured_text = ""

            # Iterate through messages from the query
            # Note: max_turns=2 because structured output uses a tool call + response
            async for message in query(
                prompt=user_message,
                options=ClaudeAgentOptions(
                    model=model,
                    system_prompt="You are a code review assistant. Analyze the provided context and provide structured feedback.",
                    allowed_tools=[],
                    max_turns=2,  # Need 2 turns for structured output tool call
                    max_thinking_tokens=thinking_budget,
                    output_format={
                        "type": "json_schema",
                        "schema": schema,
                    },
                ),
            ):
                msg_type = type(message).__name__

                # SDK delivers structured output via ToolUseBlock named 'StructuredOutput'
                # in an AssistantMessage
                if msg_type == "AssistantMessage":
                    content = getattr(message, "content", [])
                    for block in content:
                        block_type = type(block).__name__
                        if block_type == "TextBlock":
                            captured_text += getattr(block, "text", "")
                        elif block_type == "ToolUseBlock":
                            tool_name = getattr(block, "name", "")
                            if tool_name == "StructuredOutput":
                                # Extract structured data from tool input
                                structured_data = getattr(block, "input", None)
                                if structured_data:
                                    logger.info(
                                        "[Followup] Found StructuredOutput tool use"
                                    )
                                    safe_print(
                                        "[Followup] Using SDK structured output",
                                        flush=True,
                                    )
                                    # Validate with Pydantic and convert
                                    result = FollowupReviewResponse.model_validate(
                                        structured_data
                                    )
                                    return self._convert_structured_to_internal(result)

                    # Also check for direct structured_output attribute (SDK validated JSON)
                    if (
                        hasattr(message, "structured_output")
                        and message.structured_output
                    ):
                        logger.info(
                            "[Followup] Found structured_output attribute on message"
                        )
                        safe_print(
                            "[Followup] Using SDK structured output (direct attribute)",
                            flush=True,
                        )
                        result = FollowupReviewResponse.model_validate(
                            message.structured_output
                        )
                        return self._convert_structured_to_internal(result)

                # Handle ResultMessage for errors
                if msg_type == "ResultMessage":
                    subtype = getattr(message, "subtype", None)
                    if subtype == "error_max_structured_output_retries":
                        logger.warning(
                            "Claude could not produce valid structured output after retries"
                        )
                        # Attempt extraction call recovery before giving up
                        if captured_text:
                            safe_print(
                                "[Followup] Attempting extraction call recovery...",
                                flush=True,
                            )
                            extraction_result = await self._attempt_extraction_call(
                                captured_text, context
                            )
                            if extraction_result is not None:
                                return extraction_result
                        return None

            logger.warning("No structured output received from AI")
            # Attempt extraction call recovery before giving up
            if captured_text:
                safe_print(
                    "[Followup] No structured output — attempting extraction call recovery...",
                    flush=True,
                )
                extraction_result = await self._attempt_extraction_call(
                    captured_text, context
                )
                if extraction_result is not None:
                    return extraction_result
            return None

        except ValueError as e:
            # OAuth token not found
            logger.warning(f"No OAuth token available for AI review: {e}")
            safe_print("AI review failed: No OAuth token found")
            return None
        except Exception as e:
            logger.error(f"AI review with structured output failed: {e}")
            return None

    def _convert_structured_to_internal(
        self, result: FollowupReviewResponse
    ) -> dict[str, Any]:
        """
        Convert Pydantic FollowupReviewResponse to internal dict format.

        Converts Pydantic finding models to PRReviewFinding dataclass objects
        for compatibility with existing codebase.
        """
        # Convert new_findings to PRReviewFinding objects
        new_findings = []
        for f in result.new_findings:
            new_findings.append(
                PRReviewFinding(
                    id=f.id,
                    severity=_SEVERITY_MAPPING.get(f.severity, ReviewSeverity.MEDIUM),
                    category=map_category(f.category),
                    title=f.title,
                    description=f.description,
                    file=f.file,
                    line=f.line,
                    suggested_fix=f.suggested_fix,
                    fixable=f.fixable,
                )
            )

        # Convert comment_findings to PRReviewFinding objects
        comment_findings = []
        for f in result.comment_findings:
            comment_findings.append(
                PRReviewFinding(
                    id=f.id,
                    severity=_SEVERITY_MAPPING.get(f.severity, ReviewSeverity.LOW),
                    category=map_category(f.category),
                    title=f.title,
                    description=f.description,
                    file=f.file,
                    line=f.line,
                    suggested_fix=f.suggested_fix,
                    fixable=f.fixable,
                )
            )

        # Convert finding_resolutions to dict format
        finding_resolutions = [
            {
                "finding_id": r.finding_id,
                "status": r.status,
                "resolution_notes": r.resolution_notes,
            }
            for r in result.finding_resolutions
        ]

        return {
            "finding_resolutions": finding_resolutions,
            "new_findings": new_findings,
            "comment_findings": comment_findings,
            "verdict": result.verdict,
            "verdict_reasoning": result.verdict_reasoning,
        }

    async def _attempt_extraction_call(
        self,
        text: str,
        context: FollowupReviewContext,
    ) -> dict[str, Any] | None:
        """Attempt a short SDK call with minimal schema to recover review data.

        This is the extraction recovery step when full structured output validation fails.
        Uses FollowupExtractionResponse (small schema with ExtractedFindingSummary nesting)
        which has near-100% success rate.

        Uses create_client() + process_sdk_stream() for proper OAuth handling,
        matching the pattern in parallel_followup_reviewer.py.

        Returns parsed result dict on success, None on failure.
        """
        if not text or not text.strip():
            return None

        try:
            extraction_prompt = (
                "Extract the key review data from the following AI analysis output. "
                "Return the verdict, reasoning, resolved finding IDs, unresolved finding IDs, "
                "structured summaries of any new findings (including severity, description, file path, and line number), "
                "and counts of confirmed/dismissed findings.\n\n"
                f"--- AI ANALYSIS OUTPUT ---\n{text[:8000]}\n--- END ---"
            )

            model_shorthand = self.config.model or "sonnet"
            model = resolve_model_id(model_shorthand)

            extraction_client = create_client(
                project_dir=self.project_dir,
                spec_dir=self.github_dir,
                model=model,
                agent_type="pr_followup_extraction",
                output_format={
                    "type": "json_schema",
                    "schema": FollowupExtractionResponse.model_json_schema(),
                },
            )

            async with extraction_client:
                await extraction_client.query(extraction_prompt)

                stream_result = await process_sdk_stream(
                    client=extraction_client,
                    context_name="FollowupExtraction",
                    model=model,
                    system_prompt=extraction_prompt,
                    max_messages=20,
                )

            if stream_result.get("error"):
                logger.warning(
                    f"[Followup] Extraction call also failed: {stream_result['error']}"
                )
                return None

            extraction_output = stream_result.get("structured_output")
            if not extraction_output:
                logger.warning(
                    "[Followup] Extraction call returned no structured output"
                )
                return None

            extracted = FollowupExtractionResponse.model_validate(extraction_output)

            # Convert extraction to internal format with reconstructed findings
            new_findings = []
            for i, summary_obj in enumerate(extracted.new_finding_summaries):
                new_findings.append(
                    create_finding_from_summary(
                        summary=summary_obj.description,
                        index=i,
                        id_prefix="FR",
                        severity_override=summary_obj.severity,
                        file=summary_obj.file,
                        line=summary_obj.line,
                    )
                )

            # Build finding_resolutions from extraction data for _apply_ai_resolutions
            # (unresolved findings are handled via finding_resolutions + _apply_ai_resolutions)
            finding_resolutions = []
            for fid in extracted.resolved_finding_ids:
                finding_resolutions.append(
                    {"finding_id": fid, "status": "resolved", "resolution_notes": None}
                )
            for fid in extracted.unresolved_finding_ids:
                finding_resolutions.append(
                    {
                        "finding_id": fid,
                        "status": "unresolved",
                        "resolution_notes": None,
                    }
                )

            safe_print(
                f"[Followup] Extraction recovered: verdict={extracted.verdict}, "
                f"{len(extracted.resolved_finding_ids)} resolved, "
                f"{len(extracted.unresolved_finding_ids)} unresolved, "
                f"{len(new_findings)} new findings",
                flush=True,
            )

            return {
                "finding_resolutions": finding_resolutions,
                "new_findings": new_findings,
                "comment_findings": [],
                "verdict": extracted.verdict,
                "verdict_reasoning": f"[Recovered via extraction] {extracted.verdict_reasoning}",
            }

        except Exception as e:
            logger.warning(f"[Followup] Extraction call failed: {e}")
            return None

    def _apply_ai_resolutions(
        self,
        previous_findings: list[PRReviewFinding],
        ai_resolutions: list[dict],
    ) -> tuple[list[PRReviewFinding], list[PRReviewFinding]]:
        """
        Apply AI-determined resolution status to previous findings.

        Returns (resolved, unresolved) tuple.
        """
        # Build a map of finding_id -> status
        resolution_map = {
            r.get("finding_id"): r.get("status", "unresolved").lower()
            for r in ai_resolutions
        }

        resolved = []
        unresolved = []

        for finding in previous_findings:
            status = resolution_map.get(finding.id, "unresolved")
            if status == "resolved":
                resolved.append(finding)
            else:
                unresolved.append(finding)

        return resolved, unresolved

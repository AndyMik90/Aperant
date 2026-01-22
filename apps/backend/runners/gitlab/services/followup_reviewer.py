"""
Follow-up MR Reviewer
====================

Focused review of changes since last review for GitLab merge requests.
- Only analyzes new commits
- Checks if previous findings are resolved
- Reviews new comments from contributors
- Determines if MR is ready to merge
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..models import FollowupMRContext, GitLabRunnerConfig

try:
    from ..glab_client import GitLabClient
    from ..models import (
        MergeVerdict,
        MRReviewFinding,
        MRReviewResult,
        ReviewCategory,
        ReviewSeverity,
    )
    from .io_utils import safe_print
except (ImportError, ValueError, SystemError):
    from glab_client import GitLabClient
    from models import (
        MergeVerdict,
        MRReviewFinding,
        MRReviewResult,
        ReviewCategory,
        ReviewSeverity,
    )
    from services.io_utils import safe_print

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
    Performs focused follow-up reviews of GitLab MRs.

    Key capabilities:
    1. Only reviews changes since last review (new commits)
    2. Checks if posted findings have been addressed
    3. Reviews new comments from contributors
    4. Determines if MR is ready to merge

    Supports both heuristic and AI-powered review modes.
    """

    def __init__(
        self,
        project_dir: Path,
        gitlab_dir: Path,
        config: GitLabRunnerConfig,
        progress_callback=None,
        use_ai: bool = True,
    ):
        self.project_dir = Path(project_dir)
        self.gitlab_dir = Path(gitlab_dir)
        self.config = config
        self.progress_callback = progress_callback
        self.use_ai = use_ai

    def _report_progress(
        self, phase: str, progress: int, message: str, mr_iid: int
    ) -> None:
        """Report progress to callback if available."""
        if self.progress_callback:
            try:
                from ..orchestrator import ProgressCallback
            except (ImportError, ValueError, SystemError):
                from orchestrator import ProgressCallback

            self.progress_callback(
                ProgressCallback(
                    phase=phase, progress=progress, message=message, mr_iid=mr_iid
                )
            )
        safe_print(f"[Followup] [{phase}] {message}")

    async def review_followup(
        self,
        context: FollowupMRContext,
        glab_client: GitLabClient,
    ) -> MRReviewResult:
        """
        Perform a focused follow-up review.

        Args:
            context: FollowupMRContext with previous review and current state
            glab_client: GitLab API client

        Returns:
            MRReviewResult with updated findings and resolution status
        """
        logger.info(f"[Followup] Starting follow-up review for MR !{context.mr_iid}")
        logger.info(f"[Followup] Previous review at: {context.previous_commit_sha[:8]}")
        logger.info(f"[Followup] Current HEAD: {context.current_commit_sha[:8]}")
        logger.info(
            f"[Followup] {len(context.commits_since_review)} new commits, "
            f"{len(context.files_changed_since_review)} files changed"
        )

        self._report_progress(
            "analyzing", 20, "Checking finding resolution...", context.mr_iid
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
            context.mr_iid,
        )

        # Phase 2: Review new changes for new issues
        self._report_progress(
            "analyzing", 60, "Analyzing new changes...", context.mr_iid
        )

        # Heuristic-based review (fast, no AI cost)
        new_findings = self._check_new_changes_heuristic(
            context.diff_since_review,
            context.files_changed_since_review,
        )

        # Phase 3: Review contributor comments for questions/concerns
        self._report_progress("analyzing", 80, "Reviewing comments...", context.mr_iid)

        comment_findings = await self._review_comments(
            glab_client,
            context.mr_iid,
            context.commits_since_review,
        )

        # Combine new findings
        all_new_findings = new_findings + comment_findings

        # Determine verdict
        verdict = self._determine_verdict(unresolved, all_new_findings, context.mr_iid)

        self._report_progress(
            "complete", 100, f"Review complete: {verdict.value}", context.mr_iid
        )

        # Create result
        result = MRReviewResult(
            mr_iid=context.mr_iid,
            project=self.config.project,
            success=True,
            findings=previous_findings + all_new_findings,
            summary=self._generate_summary(resolved, unresolved, all_new_findings),
            overall_status="comment"
            if verdict != MergeVerdict.BLOCKED
            else "request_changes",
            verdict=verdict,
            verdict_reasoning=self._get_verdict_reasoning(
                verdict, resolved, unresolved, all_new_findings
            ),
            is_followup_review=True,
            previous_review_id=context.previous_review.mr_iid,
            resolved_findings=[f.id for f in resolved],
            unresolved_findings=[f.id for f in unresolved],
            new_findings_since_last_review=[f.id for f in all_new_findings],
        )

        # Save result
        result.save(self.gitlab_dir)

        return result

    def _check_finding_resolution(
        self,
        previous_findings: list[MRReviewFinding],
        changed_files: list[str],
        diff: str,
    ) -> tuple[list[MRReviewFinding], list[MRReviewFinding]]:
        """
        Check which previous findings have been resolved.

        Args:
            previous_findings: List of findings from previous review
            changed_files: Files that changed since last review
            diff: Diff of changes since last review

        Returns:
            Tuple of (resolved_findings, unresolved_findings)
        """
        resolved = []
        unresolved = []

        for finding in previous_findings:
            file_changed = finding.file in changed_files

            if not file_changed:
                # File unchanged - finding still unresolved
                unresolved.append(finding)
                continue

            # Check if the specific line/region was modified
            if self._is_finding_addressed(diff, finding):
                resolved.append(finding)
            else:
                unresolved.append(finding)

        return resolved, unresolved

    def _is_finding_addressed(self, diff: str, finding: MRReviewFinding) -> bool:
        """
        Check if a finding appears to be addressed in the diff.

        This is a heuristic - looks for:
        - The file being modified near the finding's line
        - The issue pattern being changed
        """
        # Look for the file in the diff
        file_pattern = f"diff --git a/{finding.file}"
        if file_pattern not in diff:
            return False

        # Get the section of the diff for this file
        diff_sections = diff.split(file_pattern)
        if len(diff_sections) < 2:
            return False

        file_diff = (
            diff_sections[1].split("diff --git")[0]
            if "diff --git" in diff_sections[1]
            else diff_sections[1]
        )

        # Check if lines near the finding were modified
        # Look for +/- changes within 5 lines of the finding
        for line in file_diff.split("\n"):
            if line.startswith("@@"):
                # Parse hunk header - handle optional line counts for single-line changes
                # Format: @@ -old_start[,old_count] +new_start[,new_count] @@
                # Example with counts: @@ -10,5 +10,7 @@
                # Example without counts (single line): @@ -40 +40 @@
                match = re.search(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", line)
                if match:
                    old_start = int(match.group(1))
                    old_count = int(match.group(2)) if match.group(2) else 1
                    new_start = int(match.group(3))
                    new_count = int(match.group(4)) if match.group(4) else 1

                    # Check if finding line is in the changed range
                    if old_start <= finding.line <= old_start + old_count:
                        # Finding was in changed region
                        return True

        # Special patterns based on category
        if finding.category == ReviewCategory.TEST:
            # Look for added tests
            if "+ def test_" in file_diff or "+class Test" in file_diff:
                return True
        elif finding.category == ReviewCategory.DOCS:
            # Look for added docstrings or comments
            if '+"""' in file_diff or '+ """' in file_diff or "+ #" in file_diff:
                return True

        return False

    def _check_new_changes_heuristic(
        self,
        diff: str,
        changed_files: list[str],
    ) -> list[MRReviewFinding]:
        """
        Check new changes for obvious issues using heuristics.

        This is fast and doesn't use AI.
        """
        findings = []
        finding_id = 0

        for file_path in changed_files:
            # Look for the file in the diff
            file_pattern = f"--- a/{file_path}"
            if (
                file_pattern not in diff
                and f"--- a/{file_path.replace('/', '_')}" not in diff
            ):
                continue

            # Check for common issues
            file_diff = diff.split(file_pattern)[1].split("\n")[0:50]  # First 50 lines

            # Look for TODO/FIXME comments
            for i, line in enumerate(file_diff):
                if "+" in line and (
                    "TODO" in line or "FIXME" in line or "HACK" in line
                ):
                    finding_id += 1
                    findings.append(
                        MRReviewFinding(
                            id=f"followup-todo-{finding_id}",
                            severity=ReviewSeverity.LOW,
                            category=ReviewCategory.QUALITY,
                            title=f"Developer TODO in {file_path}",
                            description=f"Line contains: {line.strip()}",
                            file=file_path,
                            line=i,
                            suggested_fix="Remove TODO or convert to issue",
                            fixable=False,
                        )
                    )

        return findings

    async def _review_comments(
        self,
        glab_client: GitLabClient,
        mr_iid: int,
        commits_since_review: list[dict],
    ) -> list[MRReviewFinding]:
        """
        Review comments for questions or concerns.

        Args:
            glab_client: GitLab API client
            mr_iid: MR internal ID
            commits_since_review: Commits since last review

        Returns:
            List of findings from comment analysis
        """
        findings = []

        try:
            # Get MR notes/comments
            notes = await glab_client.get_mr_notes_async(mr_iid)

            # Filter notes by commits since review
            reviewed_commit_shas = {c.get("id") for c in commits_since_review}

            for note in notes:
                # Check if note was added in commits since review
                note_commit_id = note.get("commit_id")
                if note_commit_id not in reviewed_commit_shas:
                    continue

                author = note.get("author", {}).get("username", "")
                body = note.get("body", "")

                # Look for questions or concerns
                if "?" in body and body.count("?") <= 3:
                    # Likely a question (not too many)
                    findings.append(
                        MRReviewFinding(
                            id=f"comment-question-{note.get('id')}",
                            severity=ReviewSeverity.LOW,
                            category=ReviewCategory.QUALITY,
                            title="Unresolved question in MR discussion",
                            description=f"Comment by {author}: {body[:100]}...",
                            file="MR Discussion",
                            line=1,
                            suggested_fix="Address the question in code or documentation",
                            fixable=False,
                        )
                    )

        except Exception as e:
            logger.warning(f"Failed to review comments: {e}")

        return findings

    def _determine_verdict(
        self,
        unresolved: list[MRReviewFinding],
        new_findings: list[MRReviewFinding],
        mr_iid: int,
    ) -> MergeVerdict:
        """
        Determine if MR is ready to merge based on findings.
        """
        # Check for critical issues
        critical_issues = [
            f
            for f in unresolved + new_findings
            if f.severity == ReviewSeverity.CRITICAL
        ]
        if critical_issues:
            return MergeVerdict.BLOCKED

        # Check for high issues
        high_issues = [
            f for f in unresolved + new_findings if f.severity == ReviewSeverity.HIGH
        ]
        if high_issues:
            return MergeVerdict.NEEDS_REVISION

        # Check for medium issues
        medium_issues = [
            f for f in unresolved + new_findings if f.severity == ReviewSeverity.MEDIUM
        ]
        if medium_issues:
            return MergeVerdict.MERGE_WITH_CHANGES

        # All clear or only low issues
        return MergeVerdict.READY_TO_MERGE

    def _generate_summary(
        self,
        resolved: list[MRReviewFinding],
        unresolved: list[MRReviewFinding],
        new_findings: list[MRReviewFinding],
    ) -> str:
        """Generate a summary of the follow-up review."""
        lines = [
            "# Follow-up Review Summary",
            "",
            f"**Resolved Findings:** {len(resolved)}",
            f"**Unresolved Findings:** {len(unresolved)}",
            f"**New Findings:** {len(new_findings)}",
            "",
        ]

        if unresolved:
            lines.append("## Unresolved Issues")
            for finding in unresolved[:5]:
                lines.append(f"- **{finding.severity.value}:** {finding.title}")
            lines.append("")

        if new_findings:
            lines.append("## New Issues")
            for finding in new_findings[:5]:
                lines.append(f"- **{finding.severity.value}:** {finding.title}")
            lines.append("")

        return "\n".join(lines)

    def _get_verdict_reasoning(
        self,
        verdict: MergeVerdict,
        resolved: list[MRReviewFinding],
        unresolved: list[MRReviewFinding],
        new_findings: list[MRReviewFinding],
    ) -> str:
        """Get reasoning for the verdict."""
        if verdict == MergeVerdict.READY_TO_MERGE:
            return (
                f"All {len(resolved)} previous findings were resolved. "
                f"{len(new_findings)} new issues are low severity."
            )
        elif verdict == MergeVerdict.MERGE_WITH_CHANGES:
            return (
                f"{len(unresolved)} findings remain unresolved, "
                f"{len(new_findings)} new issues found. "
                f"Consider addressing before merge."
            )
        elif verdict == MergeVerdict.NEEDS_REVISION:
            return (
                f"{len([f for f in unresolved + new_findings if f.severity == ReviewSeverity.HIGH])} "
                f"high-severity issues must be resolved."
            )
        else:  # BLOCKED
            return (
                f"{len([f for f in unresolved + new_findings if f.severity == ReviewSeverity.CRITICAL])} "
                f"critical issues block merge."
            )

    async def _run_ai_review(self, context: FollowupMRContext) -> dict | None:
        """Run AI-powered review (stub for future implementation)."""
        # This would integrate with the AI client for thorough review
        # For now, return None to trigger fallback to heuristic
        return None

"""
Auto-Fix Processor
==================

Handles automatic issue fixing workflow including permissions and state management.
Ported from GitHub with GitLab API adaptations.
"""

from __future__ import annotations

import json
from pathlib import Path

try:
    from ..models import AutoFixState, AutoFixStatus, GitLabRunnerConfig
    from ..permissions import GitLabPermissionChecker
except (ImportError, ValueError, SystemError):
    from models import AutoFixState, AutoFixStatus, GitLabRunnerConfig
    from permissions import GitLabPermissionChecker


class AutoFixProcessor:
    """Handles auto-fix workflow for GitLab issues."""

    def __init__(
        self,
        gitlab_dir: Path,
        config: GitLabRunnerConfig,
        permission_checker: GitLabPermissionChecker,
        progress_callback=None,
    ):
        self.gitlab_dir = Path(gitlab_dir)
        self.config = config
        self.permission_checker = permission_checker
        self.progress_callback = progress_callback

    def _report_progress(self, phase: str, progress: int, message: str, **kwargs):
        """Report progress if callback is set."""
        if self.progress_callback:
            import sys

            if "orchestrator" in sys.modules:
                ProgressCallback = sys.modules["orchestrator"].ProgressCallback
            else:
                # Fallback: try relative import
                try:
                    from ..orchestrator import ProgressCallback
                except ImportError:
                    from orchestrator import ProgressCallback

            self.progress_callback(
                ProgressCallback(
                    phase=phase, progress=progress, message=message, **kwargs
                )
            )

    async def process_issue(
        self,
        issue_iid: int,
        issue: dict,
        trigger_label: str | None = None,
    ) -> AutoFixState:
        """
        Process an issue for auto-fix.

        Args:
            issue_iid: The issue internal ID to fix
            issue: The issue data from GitLab
            trigger_label: Label that triggered this auto-fix (for permission checks)

        Returns:
            AutoFixState tracking the fix progress

        Raises:
            PermissionError: If the user who added the trigger label isn't authorized
        """
        self._report_progress(
            "fetching",
            10,
            f"Fetching issue #{issue_iid}...",
            issue_iid=issue_iid,
        )

        # Load or create state
        state = AutoFixState.load(self.gitlab_dir, issue_iid)
        if state and state.status not in [
            AutoFixStatus.FAILED,
            AutoFixStatus.COMPLETED,
        ]:
            # Already in progress
            return state

        try:
            # PERMISSION CHECK: Verify who triggered the auto-fix
            if trigger_label:
                self._report_progress(
                    "verifying",
                    15,
                    f"Verifying permissions for issue #{issue_iid}...",
                    issue_iid=issue_iid,
                )
                permission_result = (
                    await self.permission_checker.verify_automation_trigger(
                        issue_iid=issue_iid,
                        trigger_label=trigger_label,
                    )
                )
                if not permission_result.allowed:
                    print(
                        f"[PERMISSION] Auto-fix denied for #{issue_iid}: {permission_result.reason}",
                        flush=True,
                    )
                    raise PermissionError(
                        f"Auto-fix not authorized: {permission_result.reason}"
                    )
                print(
                    f"[PERMISSION] Auto-fix authorized for #{issue_iid} "
                    f"(triggered by {permission_result.username}, role: {permission_result.role})",
                    flush=True,
                )

            # Construct issue URL
            instance_url = self.config.instance_url.rstrip("/")
            issue_url = f"{instance_url}/{self.config.project}/-/issues/{issue_iid}"

            state = AutoFixState(
                issue_iid=issue_iid,
                issue_url=issue_url,
                project=self.config.project,
                status=AutoFixStatus.ANALYZING,
            )
            await state.save(self.gitlab_dir)

            self._report_progress(
                "analyzing", 30, "Analyzing issue...", issue_iid=issue_iid
            )

            # This would normally call the spec creation process
            # For now, we just create the state and let the frontend handle spec creation
            # via the existing investigation flow

            state.update_status(AutoFixStatus.CREATING_SPEC)
            await state.save(self.gitlab_dir)

            self._report_progress(
                "complete", 100, "Ready for spec creation", issue_iid=issue_iid
            )
            return state

        except Exception as e:
            if state:
                state.status = AutoFixStatus.FAILED
                state.error = str(e)
                await state.save(self.gitlab_dir)
            raise

    async def get_queue(self) -> list[AutoFixState]:
        """Get all issues in the auto-fix queue."""
        issues_dir = self.gitlab_dir / "issues"
        if not issues_dir.exists():
            return []

        queue = []
        for f in issues_dir.glob("autofix_*.json"):
            try:
                issue_iid = int(f.stem.replace("autofix_", ""))
                state = AutoFixState.load(self.gitlab_dir, issue_iid)
                if state:
                    queue.append(state)
            except (ValueError, json.JSONDecodeError):
                continue

        return sorted(queue, key=lambda s: s.created_at, reverse=True)

    async def check_labeled_issues(
        self, all_issues: list[dict], verify_permissions: bool = True
    ) -> list[dict]:
        """
        Check for issues with auto-fix labels and return their details.

        This is used by the frontend to detect new issues that should be auto-fixed.
        When verify_permissions is True, only returns issues where the label was
        added by an authorized user.

        Args:
            all_issues: All open issues from GitLab
            verify_permissions: Whether to verify who added the trigger label

        Returns:
            List of dicts with issue_iid, trigger_label, and authorized status
        """
        if not self.config.auto_fix_enabled:
            return []

        auto_fix_issues = []

        for issue in all_issues:
            labels = issue.get("labels", [])
            # GitLab labels are simple strings in the API
            matching_labels = [
                lbl
                for lbl in self.config.auto_fix_labels
                if lbl.lower() in [label.lower() for label in labels]
            ]

            if not matching_labels:
                continue

            # Check if not already in queue
            state = AutoFixState.load(self.gitlab_dir, issue["iid"])
            if state and state.status not in [
                AutoFixStatus.FAILED,
                AutoFixStatus.COMPLETED,
            ]:
                continue

            trigger_label = matching_labels[0]  # Use first matching label

            # Optionally verify permissions
            if verify_permissions:
                try:
                    permission_result = (
                        await self.permission_checker.verify_automation_trigger(
                            issue_iid=issue["iid"],
                            trigger_label=trigger_label,
                        )
                    )
                    if not permission_result.allowed:
                        print(
                            f"[PERMISSION] Skipping #{issue['iid']}: {permission_result.reason}",
                            flush=True,
                        )
                        continue
                    print(
                        f"[PERMISSION] #{issue['iid']} authorized "
                        f"(by {permission_result.username}, role: {permission_result.role})",
                        flush=True,
                    )
                except Exception as e:
                    print(
                        f"[PERMISSION] Error checking #{issue['iid']}: {e}",
                        flush=True,
                    )
                    continue

            auto_fix_issues.append(
                {
                    "issue_iid": issue["iid"],
                    "trigger_label": trigger_label,
                    "title": issue.get("title", ""),
                }
            )

        return auto_fix_issues

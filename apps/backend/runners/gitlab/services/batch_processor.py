"""
Batch Processor for GitLab
==========================

Handles batch processing of similar GitLab issues.
Ported from GitHub with GitLab API adaptations.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..glab_client import GitLabClient
    from ..models import GitLabRunnerConfig

try:
    from ..models import AutoFixState, AutoFixStatus
    from .io_utils import safe_print
except (ImportError, ValueError, SystemError):
    from models import AutoFixState, AutoFixStatus
    from services.io_utils import safe_print


class GitlabBatchProcessor:
    """Handles batch processing of similar GitLab issues."""

    def __init__(
        self,
        project_dir: Path,
        gitlab_dir: Path,
        config: GitLabRunnerConfig,
        progress_callback=None,
    ):
        self.project_dir = Path(project_dir)
        self.gitlab_dir = Path(gitlab_dir)
        self.config = config
        self.progress_callback = progress_callback

    def _report_progress(self, phase: str, progress: int, message: str, **kwargs):
        """
        Report progress if callback is set.

        Uses dynamic import to avoid circular dependency between batch_processor
        and orchestrator modules. Checks sys.modules first to avoid redundant
        import attempts when ProgressCallback is already loaded.
        """
        if self.progress_callback:
            # Import at module level to avoid circular import issues
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

    async def batch_and_fix_issues(
        self,
        issues: list[dict],
        fetch_issue_callback,
    ) -> list:
        """
        Batch similar issues and create combined specs for each batch.

        Args:
            issues: List of GitLab issues to batch
            fetch_issue_callback: Async function to fetch individual issues

        Returns:
            List of GitlabIssueBatch objects that were created
        """
        from .batch_issues import GitlabIssueBatcher

        self._report_progress("batching", 10, "Analyzing issues for batching...")

        try:
            if not issues:
                safe_print("[BATCH] No issues to batch")
                return []

            safe_print(
                f"[BATCH] Analyzing {len(issues)} issues for similarity...",
                flush=True,
            )

            # Initialize batcher with AI validation
            batcher = GitlabIssueBatcher(
                gitlab_dir=self.gitlab_dir,
                project=self.config.project,
                project_dir=self.project_dir,
                similarity_threshold=0.70,
                min_batch_size=1,
                max_batch_size=5,
                validate_batches=True,
            )

            # Create batches
            self._report_progress("batching", 30, "Creating issue batches...")
            batches = await batcher.create_batches(issues)

            if not batches:
                safe_print("[BATCH] No batches created")
                return []

            safe_print(f"[BATCH] Created {len(batches)} batches")
            for batch in batches:
                safe_print(f"  - {batch.batch_id}: {len(batch.issues)} issues")
                batcher.save_batch(batch)

            self._report_progress(
                "batching", 100, f"Batching complete: {len(batches)} batches"
            )
            return batches

        except Exception as e:
            safe_print(f"[BATCH] Error during batching: {e}")
            self._report_progress("batching", 100, f"Batching failed: {e}")
            return []

    async def process_batch(
        self,
        batch,
        glab_client: GitLabClient,
    ) -> AutoFixState | None:
        """
        Process a single batch of issues.

        Creates a combined spec for all issues in the batch.

        Args:
            batch: GitlabIssueBatch to process
            glab_client: GitLab API client

        Returns:
            AutoFixState for the batch, or None if failed
        """
        from .batch_issues import GitlabBatchStatus

        self._report_progress(
            "batch_processing",
            10,
            f"Processing batch {batch.batch_id}...",
            batch_id=batch.batch_id,
        )

        try:
            # Update batch status
            batch.status = GitlabBatchStatus.ANALYZING
            from .batch_issues import GitlabIssueBatcher

            # Create batcher instance to call save_batch (instance method)
            batcher = GitlabIssueBatcher(
                gitlab_dir=self.gitlab_dir,
                project=self.config.project,
                project_dir=self.project_dir,
                similarity_threshold=0.7,
            )
            batcher.save_batch(batch)

            # Build combined issue description
            combined_description = self._build_combined_description(batch)

            # Create spec ID for this batch
            spec_id = f"batch-{batch.batch_id}"

            # Create auto-fix state for the primary issue
            primary_issue = batch.issues[0]
            state = AutoFixState(
                issue_iid=primary_issue.issue_iid,
                issue_url=self._build_issue_url(primary_issue.issue_iid),
                project=self.config.project,
                status=AutoFixStatus.CREATING_SPEC,
            )

            # Note: In a full implementation, this would trigger spec creation
            # For now, we just create the state
            await state.save(self.gitlab_dir)

            # Update batch with spec ID
            batch.spec_id = spec_id
            batch.status = GitlabBatchStatus.CREATING_SPEC
            GitlabIssueBatcher.save_batch(batch)

            self._report_progress(
                "batch_processing",
                50,
                f"Batch {batch.batch_id}: spec creation ready",
                batch_id=batch.batch_id,
            )

            return state

        except Exception as e:
            safe_print(f"[BATCH] Error processing batch {batch.batch_id}: {e}")
            batch.status = GitlabBatchStatus.FAILED
            batch.error = str(e)
            from .batch_issues import GitlabIssueBatcher

            GitlabIssueBatcher.save_batch(batch)
            return None

    def _build_combined_description(self, batch) -> str:
        """Build a combined description for all issues in the batch."""
        lines = [
            f"# Batch Fix: {batch.theme or 'Multiple Issues'}",
            "",
            f"This batch addresses {len(batch.issues)} related issues:",
            "",
        ]

        for item in batch.issues:
            lines.append(f"## Issue !{item.issue_iid}: {item.title}")
            if item.body:
                # Truncate long descriptions
                body_preview = item.body[:500]
                if len(item.body) > 500:
                    body_preview += "..."
                lines.append(f"{body_preview}")
            lines.append("")

        if batch.validation_reasoning:
            lines.extend(
                [
                    "**Batching Reasoning:**",
                    batch.validation_reasoning,
                    "",
                ]
            )

        return "\n".join(lines)

    def _build_issue_url(self, issue_iid: int) -> str:
        """Build GitLab issue URL."""
        instance_url = self.config.instance_url.rstrip("/")
        return f"{instance_url}/{self.config.project}/-/issues/{issue_iid}"

    async def get_queue(self) -> list:
        """Get all batches in the queue."""
        from .batch_issues import GitlabIssueBatcher

        batcher = GitlabIssueBatcher(
            gitlab_dir=self.gitlab_dir,
            project=self.config.project,
            project_dir=self.project_dir,
        )

        return batcher.list_batches()

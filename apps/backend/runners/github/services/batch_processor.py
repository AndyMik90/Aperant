"""
Batch Processor
===============

Handles batch processing of similar issues.
"""

from __future__ import annotations

import json
from pathlib import Path

try:
    from ..models import AutoFixState, AutoFixStatus, GitHubRunnerConfig
    from .io_utils import safe_print
except (ImportError, ValueError, SystemError):
    from models import AutoFixState, AutoFixStatus, GitHubRunnerConfig
    from services.io_utils import safe_print


class BatchProcessor:
    """Handles batch processing of similar issues."""

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

    def _report_progress(self, phase: str, progress: int, message: str, **kwargs):
        """Report progress if callback is set."""
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
            issues: List of GitHub issues to batch
            fetch_issue_callback: Async function to fetch individual issues

        Returns:
            List of IssueBatch objects that were created
        """
        try:
            from ..batch_issues import BatchStatus, IssueBatcher
        except (ImportError, ValueError, SystemError):
            from batch_issues import BatchStatus, IssueBatcher

        self._report_progress("batching", 10, "Analyzing issues for batching...")

        try:
            if not issues:
                safe_print("[BATCH] No issues to batch")
                return []

            safe_print(
                f"[BATCH] Analyzing {len(issues)} issues for similarity...", flush=True
            )

            # Initialize batcher with AI validation
            batcher = IssueBatcher(
                github_dir=self.github_dir,
                repo=self.config.repo,
                project_dir=self.project_dir,
                similarity_threshold=0.70,
                min_batch_size=1,
                max_batch_size=5,
                validate_batches=True,
                validation_model="sonnet",
                validation_thinking_budget=10000,
            )

            self._report_progress("batching", 20, "Computing similarity matrix...")

            # Get already-processed issue numbers
            existing_states = []
            issues_dir = self.github_dir / "issues"
            if issues_dir.exists():
                for f in issues_dir.glob("autofix_*.json"):
                    try:
                        issue_num = int(f.stem.replace("autofix_", ""))
                        state = AutoFixState.load(self.github_dir, issue_num)
                        if state and state.status not in [
                            AutoFixStatus.FAILED,
                            AutoFixStatus.COMPLETED,
                        ]:
                            existing_states.append(issue_num)
                    except (ValueError, json.JSONDecodeError):
                        continue

            exclude_issues = set(existing_states)

            self._report_progress(
                "batching", 40, "Clustering and validating batches with AI..."
            )

            # Create batches (includes AI validation)
            batches = await batcher.create_batches(issues, exclude_issues)

            safe_print(f"[BATCH] Created {len(batches)} validated batches")

            self._report_progress("batching", 60, f"Created {len(batches)} batches")

            # Process each batch
            for i, batch in enumerate(batches):
                progress = 60 + int(40 * (i / len(batches)))
                issue_nums = batch.get_issue_numbers()
                self._report_progress(
                    "batching",
                    progress,
                    f"Processing batch {i + 1}/{len(batches)} ({len(issue_nums)} issues)...",
                )

                safe_print(
                    f"[BATCH] Batch {batch.batch_id}: {len(issue_nums)} issues - {issue_nums}",
                    flush=True,
                )

                # Update batch status
                batch.update_status(BatchStatus.ANALYZING)
                await batch.save(self.github_dir)

                # Create AutoFixState for primary issue (for compatibility)
                primary_state = AutoFixState(
                    issue_number=batch.primary_issue,
                    issue_url=f"https://github.com/{self.config.repo}/issues/{batch.primary_issue}",
                    repo=self.config.repo,
                    status=AutoFixStatus.ANALYZING,
                )
                await primary_state.save(self.github_dir)

            self._report_progress(
                "complete",
                100,
                f"Batched {sum(len(b.get_issue_numbers()) for b in batches)} issues into {len(batches)} batches",
            )

            return batches

        except Exception as e:
            safe_print(f"[BATCH] Error batching issues: {e}")
            import traceback

            traceback.print_exc()
            return []

    async def analyze_issues_preview(
        self,
        issues: list[dict],
        max_issues: int = 200,
    ) -> dict:
        """
        Analyze issues and return a PREVIEW of proposed batches without executing.

        Args:
            issues: List of GitHub issues to analyze
            max_issues: Maximum number of issues to analyze

        Returns:
            Dict with proposed batches and statistics for user review
        """
        try:
            from ..batch_issues import IssueBatcher
        except (ImportError, ValueError, SystemError):
            from batch_issues import IssueBatcher

        self._report_progress("analyzing", 10, "Fetching issues for analysis...")

        try:
            if not issues:
                return {
                    "success": True,
                    "total_issues": 0,
                    "proposed_batches": [],
                    "single_issues": [],
                    "message": "No open issues found",
                }

            issues = issues[:max_issues]

            safe_print(
                f"[PREVIEW] Analyzing {len(issues)} issues for grouping...", flush=True
            )
            self._report_progress("analyzing", 20, f"Analyzing {len(issues)} issues...")

            # Initialize batcher for preview
            batcher = IssueBatcher(
                github_dir=self.github_dir,
                repo=self.config.repo,
                project_dir=self.project_dir,
                similarity_threshold=0.70,
                min_batch_size=1,
                max_batch_size=5,
                validate_batches=True,
                validation_model="sonnet",
                validation_thinking_budget=10000,
            )

            # Get already-batched issue numbers to exclude
            existing_batch_issues = set(batcher._batch_index.keys())

            self._report_progress("analyzing", 40, "Computing similarity matrix...")

            # Build similarity matrix
            available_issues = [
                i for i in issues if i["number"] not in existing_batch_issues
            ]

            if not available_issues:
                return {
                    "success": True,
                    "total_issues": len(issues),
                    "already_batched": len(existing_batch_issues),
                    "proposed_batches": [],
                    "single_issues": [],
                    "message": "All issues are already in batches",
                }

            similarity_matrix, reasoning_dict = await batcher._build_similarity_matrix(
                available_issues
            )

            self._report_progress("analyzing", 60, "Clustering issues by similarity...")

            # Cluster issues
            clusters = batcher._cluster_issues(available_issues, similarity_matrix)

            self._report_progress(
                "analyzing", 80, "Validating batch groupings with AI..."
            )

            # Build proposed batches
            proposed_batches = []
            single_issues = []

            for cluster in clusters:
                cluster_issues = [i for i in available_issues if i["number"] in cluster]

                if len(cluster) == 1:
                    # Single issue - no batch needed
                    issue = cluster_issues[0]
                    issue_num = issue["number"]

                    # Get Claude's actual reasoning from comparisons
                    claude_reasoning = "No similar issues found."
                    if issue_num in reasoning_dict and reasoning_dict[issue_num]:
                        # Get reasoning from any comparison
                        other_issues = list(reasoning_dict[issue_num].keys())
                        if other_issues:
                            claude_reasoning = reasoning_dict[issue_num][
                                other_issues[0]
                            ]

                    single_issues.append(
                        {
                            "issue_number": issue_num,
                            "title": issue.get("title", ""),
                            "labels": [
                                label.get("name", "")
                                for label in issue.get("labels", [])
                            ],
                            "reasoning": claude_reasoning,
                        }
                    )
                    continue

                # Multi-issue batch
                primary = max(
                    cluster,
                    key=lambda n: sum(
                        1
                        for other in cluster
                        if n != other and (n, other) in similarity_matrix
                    ),
                )

                themes = batcher._extract_common_themes(cluster_issues)

                # Build batch items
                items = []
                for issue in cluster_issues:
                    similarity = (
                        1.0
                        if issue["number"] == primary
                        else similarity_matrix.get((primary, issue["number"]), 0.0)
                    )
                    items.append(
                        {
                            "issue_number": issue["number"],
                            "title": issue.get("title", ""),
                            "labels": [
                                label.get("name", "")
                                for label in issue.get("labels", [])
                            ],
                            "similarity_to_primary": similarity,
                        }
                    )

                items.sort(key=lambda x: x["similarity_to_primary"], reverse=True)

                # Validate with AI
                validated = False
                confidence = 0.0
                reasoning = ""
                refined_theme = themes[0] if themes else ""

                if batcher.validator:
                    try:
                        result = await batcher.validator.validate_batch(
                            batch_id=f"preview_{primary}",
                            primary_issue=primary,
                            issues=items,
                            themes=themes,
                        )
                        validated = result.is_valid
                        confidence = result.confidence
                        reasoning = result.reasoning
                        refined_theme = result.common_theme or refined_theme
                    except Exception as e:
                        safe_print(f"[PREVIEW] Validation error: {e}")
                        validated = True
                        confidence = 0.5
                        reasoning = "Validation skipped due to error"

                proposed_batches.append(
                    {
                        "primary_issue": primary,
                        "issues": items,
                        "issue_count": len(items),
                        "common_themes": themes,
                        "validated": validated,
                        "confidence": confidence,
                        "reasoning": reasoning,
                        "theme": refined_theme,
                    }
                )

            self._report_progress(
                "complete",
                100,
                f"Analysis complete: {len(proposed_batches)} batches proposed",
            )

            return {
                "success": True,
                "total_issues": len(issues),
                "analyzed_issues": len(available_issues),
                "already_batched": len(existing_batch_issues),
                "proposed_batches": proposed_batches,
                "single_issues": single_issues,
                "message": f"Found {len(proposed_batches)} potential batches grouping {sum(b['issue_count'] for b in proposed_batches)} issues",
            }

        except Exception as e:
            import traceback

            safe_print(f"[PREVIEW] Error: {e}")
            traceback.print_exc()
            return {
                "success": False,
                "error": str(e),
                "proposed_batches": [],
                "single_issues": [],
            }

    async def approve_and_execute_batches(
        self,
        approved_batches: list[dict],
    ) -> list:
        """
        Execute approved batches after user review.

        Args:
            approved_batches: List of batch dicts from analyze_issues_preview

        Returns:
            List of created IssueBatch objects
        """
        try:
            from ..batch_issues import (
                BatchStatus,
                IssueBatch,
                IssueBatcher,
                IssueBatchItem,
            )
        except (ImportError, ValueError, SystemError):
            from batch_issues import (
                BatchStatus,
                IssueBatch,
                IssueBatcher,
                IssueBatchItem,
            )

        if not approved_batches:
            return []

        self._report_progress("executing", 10, "Creating approved batches...")

        batcher = IssueBatcher(
            github_dir=self.github_dir,
            repo=self.config.repo,
            project_dir=self.project_dir,
        )

        created_batches = []
        total = len(approved_batches)

        for i, batch_data in enumerate(approved_batches):
            progress = 10 + int(80 * (i / total))
            primary = batch_data["primary_issue"]

            self._report_progress(
                "executing",
                progress,
                f"Creating batch {i + 1}/{total} (primary: #{primary})...",
            )

            # Create batch from approved data
            items = [
                IssueBatchItem(
                    issue_number=item["issue_number"],
                    title=item.get("title", ""),
                    body=item.get("body", ""),
                    labels=item.get("labels", []),
                )
                for item in batch_data.get("issues", [])
            ]

            batch = IssueBatch(
                batch_id=batcher._generate_batch_id(primary),
                primary_issue=primary,
                issues=items,
                common_themes=batch_data.get("common_themes", []),
                repo=self.config.repo,
                status=BatchStatus.ANALYZING,
            )

            # Update index
            for item in batch.issues:
                batcher._batch_index[item.issue_number] = batch.batch_id

            # Save batch
            batch.save(self.github_dir)
            created_batches.append(batch)

            # Create AutoFixState for primary issue
            primary_state = AutoFixState(
                issue_number=primary,
                issue_url=f"https://github.com/{self.config.repo}/issues/{primary}",
                repo=self.config.repo,
                status=AutoFixStatus.ANALYZING,
            )
            await primary_state.save(self.github_dir)

        # Save batch index
        batcher._save_batch_index()

        self._report_progress(
            "complete",
            100,
            f"Created {len(created_batches)} batches",
        )

        return created_batches

    async def get_batch_status(self) -> dict:
        """Get status of all batches."""
        try:
            from ..batch_issues import IssueBatcher
        except (ImportError, ValueError, SystemError):
            from batch_issues import IssueBatcher

        batcher = IssueBatcher(
            github_dir=self.github_dir,
            repo=self.config.repo,
            project_dir=self.project_dir,
        )

        batches = batcher.get_all_batches()

        return {
            "total_batches": len(batches),
            "by_status": {
                status.value: len([b for b in batches if b.status == status])
                for status in set(b.status for b in batches)
            },
            "batches": [
                {
                    "batch_id": b.batch_id,
                    "primary_issue": b.primary_issue,
                    "issue_count": len(b.items),
                    "status": b.status.value,
                    "created_at": b.created_at,
                }
                for b in batches
            ],
        }

    async def process_pending_batches(self) -> int:
        """Process all pending batches."""
        try:
            from ..batch_issues import BatchStatus, IssueBatcher
        except (ImportError, ValueError, SystemError):
            from batch_issues import BatchStatus, IssueBatcher

        batcher = IssueBatcher(
            github_dir=self.github_dir,
            repo=self.config.repo,
            project_dir=self.project_dir,
        )

        batches = batcher.get_all_batches()
        pending = [b for b in batches if b.status == BatchStatus.PENDING]

        for batch in pending:
            batch.update_status(BatchStatus.ANALYZING)
            batch.save(self.github_dir)

        return len(pending)

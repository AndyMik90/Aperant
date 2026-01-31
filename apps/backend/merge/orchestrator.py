"""
Merge Orchestrator
==================

Main coordinator for the intent-aware merge system.

This orchestrates the complete merge pipeline:
1. Load file evolution data (baselines + task changes)
2. Analyze semantic changes from each task
3. Detect conflicts between tasks
4. Apply deterministic merges where possible (AutoMerger)
5. Call AI resolver for ambiguous conflicts (AIResolver)
6. Produce final merged content and detailed report

The goal is to merge changes from multiple parallel tasks
with maximum automation and minimum AI token usage.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from .ai_resolver import AIResolver, create_claude_resolver
from .auto_merger import AutoMerger
from .conflict_detector import ConflictDetector
from .conflict_resolver import ConflictResolver
from .file_evolution import FileEvolutionTracker
from .git_utils import find_worktree, get_file_from_branch
from .merge_pipeline import MergePipeline

# Re-export models for backwards compatibility
from .models import MergeReport, MergeStats, TaskMergeRequest
from .progress import MergeProgressCallback, MergeProgressStage
from .semantic_analyzer import SemanticAnalyzer
from .types import (
    ConflictRegion,
    FileAnalysis,
    MergeDecision,
)

# Import debug utilities
try:
    from debug import (
        debug,
        debug_detailed,
        debug_error,
        debug_section,
        debug_success,
        debug_verbose,
        debug_warning,
        is_debug_enabled,
    )
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_detailed(*args, **kwargs):
        pass

    def debug_verbose(*args, **kwargs):
        pass

    def debug_success(*args, **kwargs):
        pass

    def debug_error(*args, **kwargs):
        pass

    def debug_warning(*args, **kwargs):
        pass

    def debug_section(*args, **kwargs):
        pass

    def is_debug_enabled():
        return False


logger = logging.getLogger(__name__)
MODULE = "merge.orchestrator"

# Export all public classes for backwards compatibility
__all__ = [
    "MergeOrchestrator",
    "MergeReport",
    "MergeStats",
    "TaskMergeRequest",
]


class MergeOrchestrator:
    """
    Orchestrates the complete merge pipeline.

    This is the main entry point for merging task changes.
    It coordinates all components to produce merged content
    with maximum automation and detailed reporting.

    Example:
        orchestrator = MergeOrchestrator(project_dir)

        # Merge a single task
        result = orchestrator.merge_task("task-001-feature")

        # Merge multiple tasks
        report = orchestrator.merge_tasks([
            TaskMergeRequest(task_id="task-001", worktree_path=path1),
            TaskMergeRequest(task_id="task-002", worktree_path=path2),
        ])
    """

    def __init__(
        self,
        project_dir: Path,
        storage_dir: Path | None = None,
        enable_ai: bool = True,
        ai_resolver: AIResolver | None = None,
        dry_run: bool = False,
    ):
        """
        Initialize the merge orchestrator.

        Args:
            project_dir: Root directory of the project
            storage_dir: Directory for merge data (default: .auto-claude/)
            enable_ai: Whether to use AI for ambiguous conflicts
            ai_resolver: Optional pre-configured AI resolver
            dry_run: If True, don't write any files
        """
        debug_section(MODULE, "Initializing MergeOrchestrator")
        debug(
            MODULE,
            "Configuration",
            project_dir=str(project_dir),
            enable_ai=enable_ai,
            dry_run=dry_run,
        )

        self.project_dir = Path(project_dir).resolve()
        self.storage_dir = storage_dir or (self.project_dir / ".auto-claude")
        self.enable_ai = enable_ai
        self.dry_run = dry_run

        # Initialize components
        debug_detailed(MODULE, "Initializing sub-components...")
        self.analyzer = SemanticAnalyzer()
        self.conflict_detector = ConflictDetector()
        self.auto_merger = AutoMerger()
        self.evolution_tracker = FileEvolutionTracker(
            project_dir=self.project_dir,
            storage_dir=self.storage_dir,
            semantic_analyzer=self.analyzer,
        )

        # AI resolver - lazy init if not provided
        self._ai_resolver = ai_resolver
        self._ai_resolver_initialized = ai_resolver is not None

        # Initialize conflict resolver and merge pipeline
        self._conflict_resolver: ConflictResolver | None = None
        self._merge_pipeline: MergePipeline | None = None

        # Merge output directory
        self.merge_output_dir = self.storage_dir / "merge_output"
        self.reports_dir = self.storage_dir / "merge_reports"

        debug_success(
            MODULE, "MergeOrchestrator initialized", storage_dir=str(self.storage_dir)
        )

    @property
    def ai_resolver(self) -> AIResolver:
        """Get the AI resolver, initializing if needed."""
        if not self._ai_resolver_initialized:
            if self.enable_ai:
                self._ai_resolver = create_claude_resolver()
            else:
                self._ai_resolver = AIResolver()  # No AI function
            self._ai_resolver_initialized = True
        return self._ai_resolver

    @property
    def conflict_resolver(self) -> ConflictResolver:
        """Get the conflict resolver, initializing if needed."""
        if self._conflict_resolver is None:
            self._conflict_resolver = ConflictResolver(
                auto_merger=self.auto_merger,
                ai_resolver=self.ai_resolver if self.enable_ai else None,
                enable_ai=self.enable_ai,
            )
        return self._conflict_resolver

    @property
    def merge_pipeline(self) -> MergePipeline:
        """Get the merge pipeline, initializing if needed."""
        if self._merge_pipeline is None:
            self._merge_pipeline = MergePipeline(
                conflict_detector=self.conflict_detector,
                conflict_resolver=self.conflict_resolver,
            )
        return self._merge_pipeline

    def _read_worktree_file_for_direct_copy(
        self,
        file_path: str,
        worktree_path: Path | None,
    ) -> tuple[str | None, bool]:
        """
        Read file content from worktree for DIRECT_COPY merge.

        Args:
            file_path: Relative path to the file
            worktree_path: Path to the worktree directory

        Returns:
            Tuple of (content, success). If success is False, content is None
            and the caller should mark the merge as FAILED.
        """
        if not worktree_path:
            logger.warning(
                f"DIRECT_COPY: No worktree path provided for file: {file_path}"
            )
            debug_warning(
                MODULE,
                "DIRECT_COPY: No worktree path provided",
                file=file_path,
            )
            return None, False

        worktree_file = worktree_path / file_path
        if not worktree_file.exists():
            logger.warning(f"DIRECT_COPY: Worktree file not found: {worktree_file}")
            debug_warning(
                MODULE,
                "DIRECT_COPY: Worktree file not found",
                file=str(worktree_file),
            )
            return None, False

        try:
            content = worktree_file.read_text(encoding="utf-8")
            debug_detailed(
                MODULE,
                f"Read file from worktree for direct copy: {file_path}",
            )
            return content, True
        except UnicodeDecodeError:
            content = worktree_file.read_text(encoding="utf-8", errors="replace")
            debug_detailed(
                MODULE,
                f"Read file from worktree with encoding fallback: {file_path}",
            )
            return content, True

    def merge_task(
        self,
        task_id: str,
        worktree_path: Path | None = None,
        target_branch: str = "main",
        progress_callback: MergeProgressCallback | None = None,
    ) -> MergeReport:
        """
        Merge a single task's changes into the target branch.

        Args:
            task_id: The task identifier
            worktree_path: Path to the task's worktree (auto-detected if not provided)
            target_branch: Branch to merge into
            progress_callback: Optional callback for progress updates.
                Called with (stage, percent, message, details) at key pipeline stages.

        Returns:
            MergeReport with results
        """
        debug_section(MODULE, f"Merging Task: {task_id}")
        debug(
            MODULE,
            "merge_task() called",
            task_id=task_id,
            worktree_path=str(worktree_path) if worktree_path else "auto-detect",
            target_branch=target_branch,
        )

        report = MergeReport(started_at=datetime.now(), tasks_merged=[task_id])
        start_time = datetime.now()

        def _emit(
            stage: MergeProgressStage,
            percent: int,
            message: str,
            details: dict[str, Any] | None = None,
        ) -> None:
            """Emit progress if a callback is provided."""
            if progress_callback is not None:
                progress_callback(stage, percent, message, details)

        try:
            # --- ANALYZING stage (0-25%) ---
            _emit(MergeProgressStage.ANALYZING, 0, "Starting merge analysis")

            # Find worktree if not provided
            if worktree_path is None:
                debug_detailed(MODULE, "Auto-detecting worktree path...")
                worktree_path = find_worktree(self.project_dir, task_id)
                if not worktree_path:
                    debug_error(MODULE, f"Could not find worktree for task {task_id}")
                    report.success = False
                    report.error = f"Could not find worktree for task {task_id}"
                    _emit(
                        MergeProgressStage.ERROR,
                        0,
                        f"Could not find worktree for task {task_id}",
                    )
                    return report
                debug_detailed(MODULE, f"Found worktree: {worktree_path}")

            # Ensure evolution data is up to date
            _emit(MergeProgressStage.ANALYZING, 5, "Loading file evolution data")
            debug(MODULE, "Refreshing evolution data from git...")
            self.evolution_tracker.refresh_from_git(
                task_id, worktree_path, target_branch=target_branch
            )

            # Get files modified by this task
            _emit(MergeProgressStage.ANALYZING, 15, "Running semantic analysis")
            modifications = self.evolution_tracker.get_task_modifications(task_id)
            debug(
                MODULE,
                f"Found {len(modifications) if modifications else 0} modified files",
            )

            if not modifications:
                debug_warning(MODULE, f"No modifications found for task {task_id}")
                logger.info(f"No modifications found for task {task_id}")
                _emit(
                    MergeProgressStage.COMPLETE,
                    100,
                    "No modifications found",
                )
                report.completed_at = datetime.now()
                return report

            _emit(
                MergeProgressStage.ANALYZING,
                25,
                f"Found {len(modifications)} modified files",
            )

            # --- DETECTING_CONFLICTS stage (25-50%) ---
            _emit(
                MergeProgressStage.DETECTING_CONFLICTS,
                25,
                "Detecting conflicts",
            )

            # --- RESOLVING stage (50-75%) ---
            total_files = len(modifications)
            for idx, (file_path, snapshot) in enumerate(modifications):
                # Calculate progress after processing (idx + 1) to reach 75% on last file
                file_percent = 50 + int(((idx + 1) / max(total_files, 1)) * 25)
                _emit(
                    MergeProgressStage.RESOLVING,
                    file_percent,
                    f"Merging file {idx + 1}/{total_files}",
                    {"current_file": file_path},
                )

                debug_detailed(
                    MODULE,
                    f"Processing file: {file_path}",
                    changes=len(snapshot.semantic_changes),
                )
                result = self._merge_file(
                    file_path=file_path,
                    task_snapshots=[snapshot],
                    target_branch=target_branch,
                )

                # Handle DIRECT_COPY: read file directly from worktree
                # This happens when file has modifications but semantic analysis
                # couldn't parse the changes (body modifications, unsupported languages)
                if result.decision == MergeDecision.DIRECT_COPY:
                    content, success = self._read_worktree_file_for_direct_copy(
                        file_path, worktree_path
                    )
                    if success:
                        result.merged_content = content
                    else:
                        result.decision = MergeDecision.FAILED
                        result.error = "Worktree file not found for DIRECT_COPY"

                report.file_results[file_path] = result
                self._update_stats(report.stats, result)
                debug_verbose(
                    MODULE,
                    f"File merge result: {result.decision.value}",
                    file=file_path,
                )

            # --- VALIDATING stage (75-100%) ---
            _emit(
                MergeProgressStage.VALIDATING,
                75,
                "Validating merge results",
                {
                    "conflicts_found": report.stats.conflicts_detected,
                    "conflicts_resolved": report.stats.conflicts_auto_resolved,
                },
            )

            report.success = report.stats.files_failed == 0

            _emit(
                MergeProgressStage.VALIDATING,
                90,
                "Validation complete",
            )

        except Exception as e:
            debug_error(MODULE, f"Merge failed for task {task_id}", error=str(e))
            logger.exception(f"Merge failed for task {task_id}")
            report.success = False
            report.error = str(e)
            _emit(MergeProgressStage.ERROR, 0, f"Merge failed: {e}")

        report.completed_at = datetime.now()
        report.stats.duration_seconds = (
            report.completed_at - start_time
        ).total_seconds()

        # Save report
        if not self.dry_run:
            self._save_report(report, task_id)

        # --- COMPLETE stage (100%) ---
        if report.success:
            _emit(
                MergeProgressStage.COMPLETE,
                100,
                f"Merge complete for {task_id}",
                {
                    "conflicts_found": report.stats.conflicts_detected,
                    "conflicts_resolved": report.stats.conflicts_auto_resolved,
                },
            )

        debug_success(
            MODULE,
            f"Merge complete for {task_id}",
            success=report.success,
            files_processed=report.stats.files_processed,
            files_auto_merged=report.stats.files_auto_merged,
            conflicts_detected=report.stats.conflicts_detected,
            duration=f"{report.stats.duration_seconds:.2f}s",
        )

        return report

    def merge_tasks(
        self,
        requests: list[TaskMergeRequest],
        target_branch: str = "main",
        progress_callback: MergeProgressCallback | None = None,
    ) -> MergeReport:
        """
        Merge multiple tasks' changes.

        This is the main entry point for merging multiple parallel tasks.
        It handles conflicts between tasks and produces a combined result.

        Args:
            requests: List of merge requests (one per task)
            target_branch: Branch to merge into
            progress_callback: Optional callback for progress updates.
                Called with (stage, percent, message, details) at key pipeline stages.

        Returns:
            MergeReport with combined results
        """
        report = MergeReport(
            started_at=datetime.now(),
            tasks_merged=[r.task_id for r in requests],
        )
        start_time = datetime.now()

        def _emit(
            stage: MergeProgressStage,
            percent: int,
            message: str,
            details: dict[str, Any] | None = None,
        ) -> None:
            """Emit progress if a callback is provided."""
            if progress_callback is not None:
                progress_callback(stage, percent, message, details)

        try:
            # --- ANALYZING stage (0-25%) ---
            _emit(
                MergeProgressStage.ANALYZING,
                0,
                f"Starting merge analysis for {len(requests)} tasks",
            )

            # Sort by priority (higher first)
            requests = sorted(requests, key=lambda r: -r.priority)

            # Refresh evolution data for all tasks
            _emit(
                MergeProgressStage.ANALYZING,
                5,
                "Loading file evolution data",
            )
            for request in requests:
                if request.worktree_path and request.worktree_path.exists():
                    self.evolution_tracker.refresh_from_git(
                        request.task_id,
                        request.worktree_path,
                        target_branch=target_branch,
                    )

            # Find all files modified by any task
            _emit(
                MergeProgressStage.ANALYZING,
                15,
                "Running semantic analysis",
            )
            task_ids = [r.task_id for r in requests]
            file_tasks = self.evolution_tracker.get_files_modified_by_tasks(task_ids)

            _emit(
                MergeProgressStage.ANALYZING,
                25,
                f"Found {len(file_tasks)} files to merge",
            )

            # --- DETECTING_CONFLICTS stage (25-50%) ---
            _emit(
                MergeProgressStage.DETECTING_CONFLICTS,
                25,
                "Detecting conflicts across tasks",
            )

            # --- RESOLVING stage (50-75%) ---
            total_files = len(file_tasks)
            for idx, (file_path, modifying_tasks) in enumerate(file_tasks.items()):
                file_percent = 50 + int((idx / max(total_files, 1)) * 25)
                _emit(
                    MergeProgressStage.RESOLVING,
                    file_percent,
                    f"Merging file {idx + 1}/{total_files}",
                    {"current_file": file_path},
                )

                # Get snapshots from all tasks that modified this file
                evolution = self.evolution_tracker.get_file_evolution(file_path)
                if not evolution:
                    continue

                snapshots = [
                    evolution.get_task_snapshot(tid)
                    for tid in modifying_tasks
                    if evolution.get_task_snapshot(tid)
                ]

                if not snapshots:
                    continue

                result = self._merge_file(
                    file_path=file_path,
                    task_snapshots=snapshots,
                    target_branch=target_branch,
                )

                # Handle DIRECT_COPY: read file directly from worktree
                # For multi-task merges, use the first task's worktree that modified this file
                if result.decision == MergeDecision.DIRECT_COPY:
                    # Find the worktree path from the first task that modified this file
                    worktree_path = None
                    for tid in modifying_tasks:
                        for req in requests:
                            if req.task_id == tid and req.worktree_path:
                                worktree_path = req.worktree_path
                                break
                        if worktree_path:
                            break

                    content, success = self._read_worktree_file_for_direct_copy(
                        file_path, worktree_path
                    )
                    if success:
                        result.merged_content = content
                    else:
                        result.decision = MergeDecision.FAILED
                        result.error = "Worktree file not found for DIRECT_COPY"

                report.file_results[file_path] = result
                self._update_stats(report.stats, result)

            # --- VALIDATING stage (75-100%) ---
            _emit(
                MergeProgressStage.VALIDATING,
                75,
                "Validating merge results",
                {
                    "conflicts_found": report.stats.conflicts_detected,
                    "conflicts_resolved": report.stats.conflicts_auto_resolved,
                },
            )

            report.success = report.stats.files_failed == 0

            _emit(
                MergeProgressStage.VALIDATING,
                90,
                "Validation complete",
            )

        except Exception as e:
            debug_error(
                MODULE,
                "Merge failed for tasks",
                task_ids=[r.task_id for r in requests],
                error=str(e),
            )
            logger.exception("Merge failed")
            report.success = False
            report.error = str(e)
            _emit(MergeProgressStage.ERROR, 0, f"Merge failed: {e}")

        report.completed_at = datetime.now()
        report.stats.duration_seconds = (
            report.completed_at - start_time
        ).total_seconds()

        # Save report
        if not self.dry_run:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            self._save_report(report, f"multi_{timestamp}")

        # --- COMPLETE stage (100%) ---
        if report.success:
            _emit(
                MergeProgressStage.COMPLETE,
                100,
                f"Merge complete for {len(requests)} tasks",
                {
                    "conflicts_found": report.stats.conflicts_detected,
                    "conflicts_resolved": report.stats.conflicts_auto_resolved,
                },
            )

        return report

    def _merge_file(
        self,
        file_path: str,
        task_snapshots: list,
        target_branch: str,
    ):
        """
        Merge changes from multiple tasks for a single file.

        Args:
            file_path: Path to the file
            task_snapshots: Snapshots from tasks that modified this file
            target_branch: Branch to merge into

        Returns:
            MergeResult with merged content or conflict info
        """
        task_ids = [s.task_id for s in task_snapshots]
        debug(
            MODULE,
            f"_merge_file: {file_path}",
            tasks=task_ids,
            target_branch=target_branch,
        )

        # Get baseline content
        baseline_content = self.evolution_tracker.get_baseline_content(file_path)
        if baseline_content is None:
            # Try to get from target branch
            baseline_content = get_file_from_branch(
                self.project_dir, file_path, target_branch
            )

        if baseline_content is None:
            # File is new - created by task(s)
            baseline_content = ""

        # Delegate to merge pipeline
        return self.merge_pipeline.merge_file(
            file_path=file_path,
            baseline_content=baseline_content,
            task_snapshots=task_snapshots,
        )

    def get_pending_conflicts(self) -> list[tuple[str, list[ConflictRegion]]]:
        """
        Get files with pending conflicts that need human review.

        Returns:
            List of (file_path, conflicts) tuples
        """
        pending = []
        active_tasks = list(self.evolution_tracker.get_active_tasks())

        if len(active_tasks) < 2:
            return pending

        # Check for conflicts between active tasks
        conflicting_files = self.evolution_tracker.get_conflicting_files(active_tasks)

        for file_path in conflicting_files:
            evolution = self.evolution_tracker.get_file_evolution(file_path)
            if not evolution:
                continue

            # Build analyses for conflict detection
            analyses = {}
            for snapshot in evolution.task_snapshots:
                if snapshot.task_id in active_tasks:
                    analyses[snapshot.task_id] = FileAnalysis(
                        file_path=file_path,
                        changes=snapshot.semantic_changes,
                    )

            conflicts = self.conflict_detector.detect_conflicts(analyses)
            if conflicts:
                # Filter to only non-auto-mergeable conflicts
                hard_conflicts = [c for c in conflicts if not c.can_auto_merge]
                if hard_conflicts:
                    pending.append((file_path, hard_conflicts))

        return pending

    def preview_merge(
        self,
        task_ids: list[str],
    ) -> dict[str, Any]:
        """
        Preview what a merge would look like without executing.

        Args:
            task_ids: List of task IDs to preview merging

        Returns:
            Dictionary with preview information
        """
        debug_section(MODULE, "Preview Merge")
        debug(MODULE, "preview_merge() called", task_ids=task_ids)

        file_tasks = self.evolution_tracker.get_files_modified_by_tasks(task_ids)
        conflicting = self.evolution_tracker.get_conflicting_files(task_ids)

        debug(
            MODULE,
            "Files analysis",
            files_modified=len(file_tasks),
            files_with_conflicts=len(conflicting),
        )

        preview = {
            "tasks": task_ids,
            "files_to_merge": list(file_tasks.keys()),
            "files_with_potential_conflicts": conflicting,
            "conflicts": [],
        }

        # Analyze conflicts
        for file_path in conflicting:
            debug_detailed(MODULE, f"Analyzing conflicts for: {file_path}")
            evolution = self.evolution_tracker.get_file_evolution(file_path)
            if not evolution:
                debug_warning(MODULE, f"No evolution data for {file_path}")
                continue

            analyses = {}
            for snapshot in evolution.task_snapshots:
                if snapshot.task_id in task_ids:
                    analyses[snapshot.task_id] = FileAnalysis(
                        file_path=file_path,
                        changes=snapshot.semantic_changes,
                    )

            conflicts = self.conflict_detector.detect_conflicts(analyses)
            debug_detailed(MODULE, f"Found {len(conflicts)} conflicts in {file_path}")

            for c in conflicts:
                debug_verbose(
                    MODULE,
                    f"Conflict: {c.location}",
                    severity=c.severity.value,
                    can_auto_merge=c.can_auto_merge,
                )
                preview["conflicts"].append(
                    {
                        "file": c.file_path,
                        "location": c.location,
                        "tasks": c.tasks_involved,
                        "severity": c.severity.value,
                        "can_auto_merge": c.can_auto_merge,
                        "strategy": c.merge_strategy.value
                        if c.merge_strategy
                        else None,
                        "reason": c.reason,
                    }
                )

        preview["summary"] = {
            "total_files": len(file_tasks),
            "conflict_files": len(conflicting),
            "total_conflicts": len(preview["conflicts"]),
            "auto_mergeable": sum(
                1 for c in preview["conflicts"] if c["can_auto_merge"]
            ),
        }

        debug_success(MODULE, "Preview complete", summary=preview["summary"])

        return preview

    def write_merged_files(
        self,
        report: MergeReport,
        output_dir: Path | None = None,
    ) -> list[Path]:
        """
        Write merged files to disk.

        Args:
            report: The merge report with results
            output_dir: Directory to write to (default: merge_output/)

        Returns:
            List of written file paths
        """
        if self.dry_run:
            logger.info("Dry run - not writing files")
            return []

        output_dir = output_dir or self.merge_output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        written = []
        for file_path, result in report.file_results.items():
            if result.merged_content is not None:
                out_path = output_dir / file_path
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(result.merged_content, encoding="utf-8")
                written.append(out_path)
                logger.debug(f"Wrote merged file: {out_path}")

        logger.info(f"Wrote {len(written)} merged files to {output_dir}")
        return written

    def apply_to_project(
        self,
        report: MergeReport,
    ) -> bool:
        """
        Apply merged files directly to the project.

        Args:
            report: The merge report with results

        Returns:
            True if all files were applied successfully
        """
        if self.dry_run:
            logger.info("Dry run - not applying to project")
            return True

        success = True
        for file_path, result in report.file_results.items():
            if result.merged_content and result.success:
                target_path = self.project_dir / file_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                try:
                    target_path.write_text(result.merged_content, encoding="utf-8")
                    logger.debug(f"Applied merged content to: {target_path}")
                except Exception as e:
                    logger.error(f"Failed to write {target_path}: {e}")
                    success = False

        return success

    def _update_stats(self, stats: MergeStats, result) -> None:
        """Update stats from a merge result."""
        stats.files_processed += 1
        stats.ai_calls_made += result.ai_calls_made
        stats.estimated_tokens_used += result.tokens_used
        stats.conflicts_detected += len(result.conflicts_resolved) + len(
            result.conflicts_remaining
        )
        stats.conflicts_auto_resolved += len(result.conflicts_resolved)

        if result.decision in (MergeDecision.AUTO_MERGED, MergeDecision.DIRECT_COPY):
            stats.files_auto_merged += 1
        elif result.decision == MergeDecision.AI_MERGED:
            stats.files_ai_merged += 1
            stats.conflicts_ai_resolved += len(result.conflicts_resolved)
        elif result.decision == MergeDecision.NEEDS_HUMAN_REVIEW:
            stats.files_need_review += 1
        elif result.decision == MergeDecision.FAILED:
            stats.files_failed += 1

    def _save_report(self, report: MergeReport, name: str) -> None:
        """Save a merge report to disk."""
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_path = self.reports_dir / f"{name}_{timestamp}.json"
        report.save(report_path)
        logger.info(f"Saved merge report to {report_path}")

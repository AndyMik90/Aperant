"""
Merge Pipeline
==============

File-level merge orchestration logic.

This module handles the pipeline for merging a single file:
- Building task analyses from snapshots
- Detecting conflicts
- Determining merge strategy (single task vs. multi-task)
- Coordinating conflict resolution
"""

from __future__ import annotations

import logging

from .conflict_detector import ConflictDetector
from .conflict_resolver import ConflictResolver
from .file_merger import apply_single_task_changes, combine_non_conflicting_changes
from .progress import MergeProgressCallback, MergeProgressStage
from .types import (
    ChangeType,
    FileAnalysis,
    MergeDecision,
    MergeResult,
    TaskSnapshot,
)

logger = logging.getLogger(__name__)


class MergePipeline:
    """
    Orchestrates the merge pipeline for individual files.

    This class handles the logic for merging changes from one or more
    tasks for a single file, coordinating conflict detection and resolution.
    """

    def __init__(
        self,
        conflict_detector: ConflictDetector,
        conflict_resolver: ConflictResolver,
    ):
        """
        Initialize the merge pipeline.

        Args:
            conflict_detector: ConflictDetector instance
            conflict_resolver: ConflictResolver instance
        """
        self.conflict_detector = conflict_detector
        self.conflict_resolver = conflict_resolver

    def merge_file(
        self,
        file_path: str,
        baseline_content: str,
        task_snapshots: list[TaskSnapshot],
        progress_callback: MergeProgressCallback | None = None,
    ) -> MergeResult:
        """
        Merge changes from multiple tasks for a single file.

        Args:
            file_path: Path to the file
            baseline_content: Original baseline content
            task_snapshots: Snapshots from tasks that modified this file
            progress_callback: Optional callback for emitting per-file progress
                within the 'resolving' stage (50-75% range)

        Returns:
            MergeResult with merged content or conflict info
        """
        task_ids = [s.task_id for s in task_snapshots]
        logger.info(f"Merging {file_path} with {len(task_snapshots)} task(s)")

        if progress_callback:
            progress_callback(
                stage=MergeProgressStage.RESOLVING,
                percent=50,
                message=f"Merging file: {file_path}",
                details={"current_file": file_path},
            )

        # If only one task modified the file, no conflict possible
        if len(task_snapshots) == 1:
            snapshot = task_snapshots[0]

            # Check if file has modifications but semantic analysis returned empty
            # This happens for: function body changes, unsupported file types (Rust, Go, etc.)
            # In this case, signal that the caller should use the worktree version directly
            if snapshot.has_modifications and not snapshot.semantic_changes:
                return MergeResult(
                    decision=MergeDecision.DIRECT_COPY,
                    file_path=file_path,
                    merged_content=None,  # Caller must read from worktree
                    explanation=f"File modified by {snapshot.task_id} but no semantic changes detected - use worktree version",
                )

            merged = apply_single_task_changes(baseline_content, snapshot, file_path)
            return MergeResult(
                decision=MergeDecision.AUTO_MERGED,
                file_path=file_path,
                merged_content=merged,
                explanation=f"Single task ({snapshot.task_id}) changes applied",
            )

        # Multiple tasks - need conflict detection
        task_analyses = self._build_task_analyses(file_path, task_snapshots)

        # Detect conflicts
        conflicts = self.conflict_detector.detect_conflicts(task_analyses)

        if not conflicts:
            # No conflicts - combine all changes
            merged = combine_non_conflicting_changes(
                baseline_content, task_snapshots, file_path
            )
            return MergeResult(
                decision=MergeDecision.AUTO_MERGED,
                file_path=file_path,
                merged_content=merged,
                explanation="All changes compatible, combined automatically",
            )

        # Handle conflicts
        return self.conflict_resolver.resolve_conflicts(
            file_path=file_path,
            baseline_content=baseline_content,
            task_snapshots=task_snapshots,
            conflicts=conflicts,
            progress_callback=progress_callback,
        )

    def _build_task_analyses(
        self,
        file_path: str,
        task_snapshots: list[TaskSnapshot],
    ) -> dict[str, FileAnalysis]:
        """
        Build FileAnalysis objects from task snapshots.

        Args:
            file_path: Path to the file
            task_snapshots: List of task snapshots

        Returns:
            Dictionary mapping task_id to FileAnalysis
        """
        analyses = {}
        for snapshot in task_snapshots:
            analysis = FileAnalysis(
                file_path=file_path,
                changes=snapshot.semantic_changes,
            )

            # Populate summary fields
            for change in snapshot.semantic_changes:
                if change.change_type == ChangeType.ADD_FUNCTION:
                    analysis.functions_added.add(change.target)
                elif change.change_type == ChangeType.MODIFY_FUNCTION:
                    analysis.functions_modified.add(change.target)
                elif change.change_type == ChangeType.ADD_IMPORT:
                    analysis.imports_added.add(change.target)
                elif change.change_type == ChangeType.REMOVE_IMPORT:
                    analysis.imports_removed.add(change.target)
                analysis.total_lines_changed += change.line_end - change.line_start + 1

            analyses[snapshot.task_id] = analysis

        return analyses

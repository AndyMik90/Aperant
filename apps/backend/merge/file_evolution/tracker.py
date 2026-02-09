"""
File Evolution Tracker - Main Orchestration Class
==================================================

Main entry point that orchestrates the modular components:
- EvolutionStorage: File storage and persistence
- BaselineCapture: Baseline state capture
- ModificationTracker: Modification recording
- EvolutionQueries: Query and analysis methods
"""

from __future__ import annotations

import logging
from pathlib import Path

from ..semantic_analyzer import SemanticAnalyzer
from ..types import FileEvolution, TaskSnapshot
from .baseline_capture import DEFAULT_EXTENSIONS, BaselineCapture
from .evolution_queries import EvolutionQueries
from .modification_tracker import ModificationTracker
from .storage import EvolutionStorage

# Import debug utilities
try:
    from debug import debug, debug_success
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_success(*args, **kwargs):
        pass


logger = logging.getLogger(__name__)
MODULE = "merge.file_evolution"


class FileEvolutionTracker:
    """
    Tracks file evolution across task modifications.

    This class manages:
    - Baseline capture when worktrees are created
    - File content snapshots in .ac.jerry/baselines/
    - Task modification tracking with semantic analysis
    - Persistence of evolution data

    Usage:
        tracker = FileEvolutionTracker(project_dir)

        # When creating a worktree for a task
        tracker.capture_baselines(task_id, files_to_track)

        # When a task modifies a file
        tracker.record_modification(task_id, file_path, old_content, new_content)

        # When preparing to merge
        evolution = tracker.get_file_evolution(file_path)
    """

    # Re-export default extensions for backward compatibility
    DEFAULT_EXTENSIONS = DEFAULT_EXTENSIONS

    def __init__(
        self,
        project_dir: Path,
        storage_dir: Path | None = None,
        semantic_analyzer: SemanticAnalyzer | None = None,
    ):
        """
        Initialize the file evolution tracker.

        Args:
            project_dir: Root directory of the project
            storage_dir: Directory for evolution data (default: .ac.jerry/)
            semantic_analyzer: Optional pre-configured analyzer
        """
        debug(MODULE, "Initializing FileEvolutionTracker", project_dir=str(project_dir))

        self.project_dir = Path(project_dir).resolve()
        storage_dir = storage_dir or (self.project_dir / ".ac.jerry")

        # Initialize modular components
        self.storage = EvolutionStorage(self.project_dir, storage_dir)
        self.baseline_capture = BaselineCapture(
            self.storage, extensions=self.DEFAULT_EXTENSIONS
        )
        self.modification_tracker = ModificationTracker(
            self.storage,
            semantic_analyzer=semantic_analyzer,
        )
        self.queries = EvolutionQueries(self.storage)

        # Load existing evolution data
        self._evolutions: dict[str, FileEvolution] = self.storage.load_evolutions()

        debug_success(
            MODULE,
            "FileEvolutionTracker initialized",
            evolutions_loaded=len(self._evolutions),
        )

    # Expose storage_dir and baselines_dir for backward compatibility
    @property
    def storage_dir(self) -> Path:
        """Get the storage directory."""
        return self.storage.storage_dir

    @property
    def baselines_dir(self) -> Path:
        """Get the baselines directory."""
        return self.storage.baselines_dir

    @property
    def evolution_file(self) -> Path:
        """Get the evolution file path."""
        return self.storage.evolution_file

    def _save_evolutions(self) -> None:
        """Persist evolution data to disk."""
        self.storage.save_evolutions(self._evolutions)

    def capture_baselines(
        self,
        task_id: str,
        files: list[Path | str] | None = None,
        intent: str = "",
    ) -> dict[str, FileEvolution]:
        """
        Capture baseline state of files for a task.

        Call this when creating a worktree for a new task.

        Args:
            task_id: Unique identifier for the task
            files: List of files to capture. If None, discovers trackable files.
            intent: Description of what the task intends to do

        Returns:
            Dictionary mapping file paths to their FileEvolution objects
        """
        captured = self.baseline_capture.capture_baselines(
            task_id=task_id,
            files=files,
            intent=intent,
            evolutions=self._evolutions,
        )
        self._save_evolutions()
        logger.info(f"Captured baselines for {len(captured)} files for task {task_id}")
        return captured

    def record_modification(
        self,
        task_id: str,
        file_path: Path | str,
        old_content: str,
        new_content: str,
        raw_diff: str | None = None,
    ) -> TaskSnapshot | None:
        """
        Record a file modification by a task.

        Call this after a task makes changes to a file.

        Args:
            task_id: The task that made the modification
            file_path: Path to the modified file
            old_content: File content before modification
            new_content: File content after modification
            raw_diff: Optional unified diff for reference

        Returns:
            Updated TaskSnapshot, or None if file not being tracked
        """
        snapshot = self.modification_tracker.record_modification(
            task_id=task_id,
            file_path=file_path,
            old_content=old_content,
            new_content=new_content,
            evolutions=self._evolutions,
            raw_diff=raw_diff,
        )
        self._save_evolutions()
        return snapshot

    def get_file_evolution(self, file_path: Path | str) -> FileEvolution | None:
        """
        Get the complete evolution history for a file.

        Args:
            file_path: Path to the file

        Returns:
            FileEvolution object, or None if not tracked
        """
        return self.queries.get_file_evolution(file_path, self._evolutions)

    def get_baseline_content(self, file_path: Path | str) -> str | None:
        """
        Get the baseline content for a file.

        Args:
            file_path: Path to the file

        Returns:
            Original baseline content, or None if not available
        """
        return self.queries.get_baseline_content(file_path, self._evolutions)

    def get_task_modifications(
        self,
        task_id: str,
    ) -> list[tuple[str, TaskSnapshot]]:
        """
        Get all file modifications made by a specific task.

        Args:
            task_id: The task identifier

        Returns:
            List of (file_path, TaskSnapshot) tuples
        """
        return self.queries.get_task_modifications(task_id, self._evolutions)

    def get_files_modified_by_tasks(
        self,
        task_ids: list[str],
    ) -> dict[str, list[str]]:
        """
        Get files modified by specified tasks.

        Args:
            task_ids: List of task identifiers

        Returns:
            Dictionary mapping file paths to list of task IDs that modified them
        """
        return self.queries.get_files_modified_by_tasks(task_ids, self._evolutions)

    def get_conflicting_files(self, task_ids: list[str]) -> list[str]:
        """
        Get files modified by multiple tasks (potential conflicts).

        Args:
            task_ids: List of task identifiers to check

        Returns:
            List of file paths modified by 2+ tasks
        """
        return self.queries.get_conflicting_files(task_ids, self._evolutions)

    def mark_task_completed(self, task_id: str) -> None:
        """
        Mark a task as completed (set completed_at on all snapshots).

        Args:
            task_id: The task identifier
        """
        self.modification_tracker.mark_task_completed(task_id, self._evolutions)
        self._save_evolutions()

    def cleanup_task(
        self,
        task_id: str,
        remove_baselines: bool = True,
    ) -> None:
        """
        Clean up data for a completed/cancelled task.

        Args:
            task_id: The task identifier
            remove_baselines: Whether to remove stored baseline files
        """
        self._evolutions = self.queries.cleanup_task(
            task_id=task_id,
            evolutions=self._evolutions,
            remove_baselines=remove_baselines,
        )
        self._save_evolutions()

    def get_active_tasks(self) -> set[str]:
        """
        Get set of task IDs with active (non-completed) modifications.

        Returns:
            Set of task IDs
        """
        return self.queries.get_active_tasks(self._evolutions)

    def get_evolution_summary(self) -> dict:
        """
        Get a summary of tracked file evolutions.

        Returns:
            Dictionary with summary statistics
        """
        return self.queries.get_evolution_summary(self._evolutions)

    def export_for_merge(
        self,
        file_path: Path | str,
        task_ids: list[str] | None = None,
    ) -> dict | None:
        """
        Export evolution data for a file in a format suitable for merge.

        This provides the data needed by the merge system to understand
        what each task did and in what order.

        Args:
            file_path: Path to the file
            task_ids: Optional list of tasks to include (default: all)

        Returns:
            Dictionary with merge-relevant evolution data
        """
        return self.queries.export_for_merge(
            file_path=file_path,
            evolutions=self._evolutions,
            task_ids=task_ids,
        )

    def refresh_from_git(
        self,
        task_id: str,
        worktree_path: Path,
        target_branch: str | None = None,
        analyze_only_files: set[str] | None = None,
    ) -> None:
        """
        Refresh task snapshots by analyzing git diff from worktree.

        This is useful when we didn't capture real-time modifications
        and need to retroactively analyze what a task changed.

        Args:
            task_id: The task identifier
            worktree_path: Path to the task's worktree
            target_branch: Branch to compare against (default: auto-detect)
            analyze_only_files: If provided, only run full semantic analysis on
                these files. Other files will be tracked with lightweight mode
                (no semantic analysis). This optimizes performance by only
                analyzing files that have actual conflicts.
        """
        self.modification_tracker.refresh_from_git(
            task_id=task_id,
            worktree_path=worktree_path,
            evolutions=self._evolutions,
            target_branch=target_branch,
            analyze_only_files=analyze_only_files,
        )
        self._save_evolutions()

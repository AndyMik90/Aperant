"""
Modification Tracking Module
=============================

Handles recording and analyzing file modifications:
- Recording task modifications with semantic analysis
- Refreshing modifications from git worktrees
- Managing task completion status
"""

from __future__ import annotations

import logging
import subprocess
from datetime import datetime
from pathlib import Path

from ..semantic_analyzer import SemanticAnalyzer
from ..types import FileEvolution, TaskSnapshot, compute_content_hash
from .storage import EvolutionStorage

# Import debug utilities
try:
    from debug import debug, debug_warning
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_warning(*args, **kwargs):
        pass


logger = logging.getLogger(__name__)
MODULE = "merge.file_evolution.modification_tracker"


class ModificationTracker:
    """
    Manages tracking of file modifications by tasks.

    Responsibilities:
    - Record modifications with semantic analysis
    - Refresh modifications from git worktrees
    - Mark tasks as completed
    """

    def __init__(
        self,
        storage: EvolutionStorage,
        semantic_analyzer: SemanticAnalyzer | None = None,
    ):
        """
        Initialize modification tracker.

        Args:
            storage: Storage manager for file operations
            semantic_analyzer: Optional pre-configured semantic analyzer
        """
        self.storage = storage
        self.analyzer = semantic_analyzer or SemanticAnalyzer()

    def record_modification(
        self,
        task_id: str,
        file_path: Path | str,
        old_content: str,
        new_content: str,
        evolutions: dict[str, FileEvolution],
        raw_diff: str | None = None,
        skip_semantic_analysis: bool = False,
    ) -> TaskSnapshot | None:
        """
        Record a file modification by a task.

        Args:
            task_id: The task that made the modification
            file_path: Path to the modified file
            old_content: File content before modification
            new_content: File content after modification
            evolutions: Current evolution data (will be updated)
            raw_diff: Optional unified diff for reference
            skip_semantic_analysis: If True, skip expensive semantic analysis.
                Use this for lightweight file tracking when only conflict
                detection is needed (not conflict resolution).

        Returns:
            Updated TaskSnapshot, or None if file not being tracked
        """
        rel_path = self.storage.get_relative_path(file_path)

        # Get or create evolution
        if rel_path not in evolutions:
            # Debug level: this is expected for files not in baseline (e.g., from main's changes)
            logger.debug(f"File {rel_path} not in evolution tracking - skipping")
            return None

        evolution = evolutions.get(rel_path)
        if not evolution:
            return None

        # Get existing snapshot or create new one
        snapshot = evolution.get_task_snapshot(task_id)
        if not snapshot:
            snapshot = TaskSnapshot(
                task_id=task_id,
                task_intent="",
                started_at=datetime.now(),
                content_hash_before=compute_content_hash(old_content),
            )

        # Analyze semantic changes (or skip for lightweight tracking)
        if skip_semantic_analysis:
            # Fast path: just track the file change without analysis
            # This is used for files that don't have conflicts
            semantic_changes = []
            debug(
                MODULE,
                f"Skipping semantic analysis for {rel_path} (lightweight tracking)",
            )
        else:
            # Full analysis (only for conflict files)
            analysis = self.analyzer.analyze_diff(rel_path, old_content, new_content)
            semantic_changes = analysis.changes

        # Update snapshot
        snapshot.completed_at = datetime.now()
        snapshot.content_hash_after = compute_content_hash(new_content)
        snapshot.semantic_changes = semantic_changes
        snapshot.raw_diff = raw_diff

        # Update evolution
        evolution.add_task_snapshot(snapshot)

        logger.info(
            f"Recorded modification to {rel_path} by {task_id}: "
            f"{len(semantic_changes)} semantic changes"
            + (" (lightweight)" if skip_semantic_analysis else "")
        )
        return snapshot

    def refresh_from_git(
        self,
        task_id: str,
        worktree_path: Path,
        evolutions: dict[str, FileEvolution],
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
            evolutions: Current evolution data (will be updated)
            target_branch: Branch to compare against (default: detect from worktree)
            analyze_only_files: If provided, only run full semantic analysis on
                these files. Other files will be tracked with lightweight mode
                (no semantic analysis). This optimizes performance by only
                analyzing files that have actual conflicts.
        """
        # Determine the target branch to compare against
        if not target_branch:
            # Try to detect the base branch from the worktree's upstream
            target_branch = self._detect_target_branch(worktree_path)

        debug(
            MODULE,
            f"refresh_from_git() for task {task_id}",
            task_id=task_id,
            worktree_path=str(worktree_path),
            target_branch=target_branch,
            analyze_only_files=list(analyze_only_files)[:10]
            if analyze_only_files
            else "all",
        )

        try:
            # Get the merge-base to accurately identify task-only changes
            # Using two-dot diff (merge-base..HEAD) returns only files changed by the task,
            # not files changed on the target branch since divergence
            merge_base_result = subprocess.run(
                ["git", "merge-base", target_branch, "HEAD"],
                cwd=worktree_path,
                capture_output=True,
                text=True,
                check=True,
            )
            merge_base = merge_base_result.stdout.strip()

            # Get list of files changed in the worktree since the merge-base
            result = subprocess.run(
                ["git", "diff", "--name-only", f"{merge_base}..HEAD"],
                cwd=worktree_path,
                capture_output=True,
                text=True,
                check=True,
            )
            changed_files = [f for f in result.stdout.strip().split("\n") if f]

            debug(
                MODULE,
                f"Found {len(changed_files)} changed files",
                changed_files=changed_files[:10]
                if len(changed_files) > 10
                else changed_files,
            )

            processed_count = 0
            for file_path in changed_files:
                try:
                    # Get the diff for this file (using merge-base for accurate task-only diff)
                    diff_result = subprocess.run(
                        ["git", "diff", f"{merge_base}..HEAD", "--", file_path],
                        cwd=worktree_path,
                        capture_output=True,
                        text=True,
                        check=True,
                    )

                    # Get content before (from merge-base - the point where task branched)
                    try:
                        show_result = subprocess.run(
                            ["git", "show", f"{merge_base}:{file_path}"],
                            cwd=worktree_path,
                            capture_output=True,
                            text=True,
                            check=True,
                        )
                        old_content = show_result.stdout
                    except subprocess.CalledProcessError:
                        # File is new
                        old_content = ""

                    current_file = worktree_path / file_path
                    if current_file.exists():
                        try:
                            new_content = current_file.read_text(encoding="utf-8")
                        except UnicodeDecodeError:
                            new_content = current_file.read_text(
                                encoding="utf-8", errors="replace"
                            )
                    else:
                        # File was deleted
                        new_content = ""

                    # Auto-create FileEvolution entry if not already tracked
                    # This handles retroactive tracking when capture_baselines wasn't called
                    rel_path = self.storage.get_relative_path(file_path)
                    if rel_path not in evolutions:
                        evolutions[rel_path] = FileEvolution(
                            file_path=rel_path,
                            baseline_commit=merge_base,
                            baseline_captured_at=datetime.now(),
                            baseline_content_hash=compute_content_hash(old_content),
                            baseline_snapshot_path="",  # Not storing baseline file
                            task_snapshots=[],
                        )
                        debug(
                            MODULE,
                            f"Auto-created evolution entry for {rel_path}",
                            baseline_commit=merge_base[:8],
                        )

                    # Determine if this file needs full semantic analysis
                    # If analyze_only_files is provided, only analyze files in that set
                    # Otherwise, analyze all files (backward compatible)
                    skip_analysis = False
                    if analyze_only_files is not None:
                        skip_analysis = rel_path not in analyze_only_files

                    # Record the modification
                    self.record_modification(
                        task_id=task_id,
                        file_path=file_path,
                        old_content=old_content,
                        new_content=new_content,
                        evolutions=evolutions,
                        raw_diff=diff_result.stdout,
                        skip_semantic_analysis=skip_analysis,
                    )
                    processed_count += 1

                except subprocess.CalledProcessError as e:
                    # Log error but continue with remaining files
                    logger.warning(
                        f"Failed to process {file_path} in refresh_from_git: {e}"
                    )
                    continue

            # Calculate how many files were fully analyzed vs just tracked
            if analyze_only_files is not None:
                analyzed_count = len(
                    [f for f in changed_files if f in analyze_only_files]
                )
                tracked_only_count = processed_count - analyzed_count
                logger.info(
                    f"Refreshed {processed_count}/{len(changed_files)} files from worktree for task {task_id} "
                    f"(analyzed: {analyzed_count}, tracked only: {tracked_only_count})"
                )
            else:
                logger.info(
                    f"Refreshed {processed_count}/{len(changed_files)} files from worktree for task {task_id} "
                    "(full analysis on all files)"
                )

        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to refresh from git: {e}")

    def mark_task_completed(
        self,
        task_id: str,
        evolutions: dict[str, FileEvolution],
    ) -> None:
        """
        Mark a task as completed (set completed_at on all snapshots).

        Args:
            task_id: The task identifier
            evolutions: Current evolution data (will be updated)
        """
        now = datetime.now()
        for evolution in evolutions.values():
            snapshot = evolution.get_task_snapshot(task_id)
            if snapshot and snapshot.completed_at is None:
                snapshot.completed_at = now

    def _detect_target_branch(self, worktree_path: Path) -> str:
        """
        Detect the base branch to compare against for a worktree.

        This finds the branch that the worktree was created FROM by looking
        for common branch names (main, master, develop) that have a valid
        merge-base with the worktree.

        Note: We don't use upstream tracking because that returns the worktree's
        own branch (e.g., origin/ac-jerry/...) rather than the base branch.

        Args:
            worktree_path: Path to the worktree

        Returns:
            The detected base branch name, defaults to 'main' if detection fails
        """
        # Try common branch names and find which one has a valid merge-base
        # This is the reliable way to find what branch the worktree diverged from
        for branch in ["main", "master", "develop"]:
            try:
                result = subprocess.run(
                    ["git", "merge-base", branch, "HEAD"],
                    cwd=worktree_path,
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0:
                    debug(
                        MODULE,
                        f"Detected base branch: {branch}",
                        worktree_path=str(worktree_path),
                    )
                    return branch
            except subprocess.CalledProcessError:
                continue

        # Before defaulting to 'main', verify it exists
        # This handles non-standard projects that use trunk, production, etc.
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--verify", "main"],
                cwd=worktree_path,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                debug_warning(
                    MODULE,
                    "Could not find merge-base with standard branches, defaulting to 'main'",
                    worktree_path=str(worktree_path),
                )
                return "main"
        except subprocess.CalledProcessError:
            pass  # 'main' branch doesn't exist - fall through to last resort

        # Last resort: use HEAD~10 as a fallback comparison point
        # This allows modification tracking even on non-standard branch setups
        debug_warning(
            MODULE,
            "No standard base branch found, modification tracking may be limited",
            worktree_path=str(worktree_path),
        )
        return "HEAD~10"

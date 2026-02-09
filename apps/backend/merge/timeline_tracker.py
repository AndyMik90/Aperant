"""
File Timeline Tracker Service
==============================

Central service managing all file timelines.

This service is the "brain" of the intent-aware merge system. It:
- Creates and manages FileTimeline objects
- Handles events from git hooks and task lifecycle
- Provides merge context to the AI resolver
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from .timeline_git import TimelineGitHelper
from .timeline_models import (
    BranchPoint,
    FileTimeline,
    MainBranchEvent,
    MergeContext,
    TaskFileView,
    TaskIntent,
    WorktreeState,
)
from .timeline_persistence import TimelinePersistence

logger = logging.getLogger(__name__)

# Import debug utilities
try:
    from debug import debug, debug_success, debug_warning
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_success(*args, **kwargs):
        pass

    def debug_warning(*args, **kwargs):
        pass


MODULE = "merge.timeline_tracker"


class FileTimelineTracker:
    """
    Central service managing all file timelines.

    This service is the "brain" of the intent-aware merge system.
    """

    def __init__(self, project_path: Path, storage_path: Path | None = None):
        """
        Initialize the file timeline tracker.

        Args:
            project_path: Root directory of the project
            storage_path: Directory for timeline storage (default: .ac.jerry/)
        """
        debug(
            MODULE, "Initializing FileTimelineTracker", project_path=str(project_path)
        )

        self.project_path = Path(project_path).resolve()
        self.storage_path = storage_path or (self.project_path / ".ac.jerry")

        # Initialize sub-components
        self.git = TimelineGitHelper(self.project_path)
        self.persistence = TimelinePersistence(self.storage_path)

        # In-memory cache of timelines
        self._timelines: dict[str, FileTimeline] = {}

        # Load existing timelines
        self._timelines = self.persistence.load_all_timelines()

        debug_success(
            MODULE,
            "FileTimelineTracker initialized",
            timelines_loaded=len(self._timelines),
        )

    # =========================================================================
    # EVENT HANDLERS
    # =========================================================================

    def on_task_start(
        self,
        task_id: str,
        files_to_modify: list[str],
        files_to_create: list[str] | None = None,
        branch_point_commit: str | None = None,
        task_intent: str = "",
        task_title: str = "",
    ) -> None:
        """
        Called when a task creates its worktree and starts work.

        This captures the task's "branch point" - what the file looked like
        when the task started, which is crucial for understanding what the
        task actually changed vs what was already there.

        Args:
            task_id: Unique task identifier
            files_to_modify: List of files the task will modify
            files_to_create: Optional list of new files to create
            branch_point_commit: Git commit hash where task branched
            task_intent: Description of what the task intends to do
            task_title: Short title for the task
        """
        debug(
            MODULE,
            f"on_task_start: {task_id}",
            files_to_modify=files_to_modify,
            branch_point=branch_point_commit,
        )

        # Get actual branch point commit if not provided
        if not branch_point_commit:
            branch_point_commit = self.git.get_current_main_commit()

        timestamp = datetime.now()

        for file_path in files_to_modify:
            # Get or create timeline for this file
            timeline = self._get_or_create_timeline(file_path)

            # Get file content at branch point
            content = self.git.get_file_content_at_commit(
                file_path, branch_point_commit
            )
            if content is None:
                # File doesn't exist at this commit - might be created by task
                content = ""

            # Create task file view
            task_view = TaskFileView(
                task_id=task_id,
                branch_point=BranchPoint(
                    commit_hash=branch_point_commit,
                    content=content,
                    timestamp=timestamp,
                ),
                task_intent=TaskIntent(
                    title=task_title or task_id,
                    description=task_intent,
                    from_plan=bool(task_intent),
                ),
                commits_behind_main=0,
                status="active",
            )

            timeline.add_task_view(task_view)
            self._persist_timeline(file_path)

        debug_success(
            MODULE, f"Task {task_id} registered with {len(files_to_modify)} files"
        )

    def on_main_branch_commit(self, commit_hash: str) -> None:
        """
        Called via git post-commit hook when human commits to main.

        This tracks the "drift" - how many commits have happened in main
        since each task branched.

        Args:
            commit_hash: Git commit hash
        """
        debug(MODULE, f"on_main_branch_commit: {commit_hash}")

        # Get list of files changed in this commit
        changed_files = self.git.get_files_changed_in_commit(commit_hash)

        for file_path in changed_files:
            # Only update existing timelines (we don't create new ones for random files)
            if file_path not in self._timelines:
                continue

            timeline = self._timelines[file_path]

            # Get file content at this commit
            content = self.git.get_file_content_at_commit(file_path, commit_hash)
            if content is None:
                continue

            # Get commit metadata
            commit_info = self.git.get_commit_info(commit_hash)

            # Create main branch event
            event = MainBranchEvent(
                commit_hash=commit_hash,
                timestamp=datetime.now(),
                content=content,
                source="human",
                commit_message=commit_info.get("message", ""),
                author=commit_info.get("author"),
                diff_summary=commit_info.get("diff_summary"),
            )

            timeline.add_main_event(event)
            self._persist_timeline(file_path)

        debug_success(
            MODULE,
            f"Processed main commit {commit_hash[:8]}",
            files_updated=len(changed_files),
        )

    def on_task_worktree_change(
        self,
        task_id: str,
        file_path: str,
        new_content: str,
    ) -> None:
        """
        Called when AI agent modifies a file in its worktree.

        This updates the task's "worktree state" - what the file currently
        looks like in that task's isolated workspace.

        Args:
            task_id: Unique task identifier
            file_path: Path to the file (relative to project root)
            new_content: New file content
        """
        debug(MODULE, f"on_task_worktree_change: {task_id} -> {file_path}")

        timeline = self._timelines.get(file_path)
        if not timeline:
            # Create timeline if it doesn't exist
            timeline = self._get_or_create_timeline(file_path)

        task_view = timeline.get_task_view(task_id)
        if not task_view:
            debug_warning(MODULE, f"Task {task_id} not registered for {file_path}")
            return

        # Update worktree state
        task_view.worktree_state = WorktreeState(
            content=new_content,
            last_modified=datetime.now(),
        )

        self._persist_timeline(file_path)

    def on_task_merged(self, task_id: str, merge_commit: str) -> None:
        """
        Called after a task is successfully merged to main.

        This updates the timeline to show:
        1. The task is now merged
        2. Main branch has a new commit (from this merge)

        Args:
            task_id: Unique task identifier
            merge_commit: Git commit hash of the merge
        """
        debug(MODULE, f"on_task_merged: {task_id}")

        # Get list of files this task modified
        task_files = self.get_files_for_task(task_id)

        for file_path in task_files:
            timeline = self._timelines.get(file_path)
            if not timeline:
                continue

            task_view = timeline.get_task_view(task_id)
            if not task_view:
                continue

            # Mark task as merged
            task_view.status = "merged"
            task_view.merged_at = datetime.now()

            # Add main branch event for the merge
            content = self.git.get_file_content_at_commit(file_path, merge_commit)
            if content:
                event = MainBranchEvent(
                    commit_hash=merge_commit,
                    timestamp=datetime.now(),
                    content=content,
                    source="merged_task",
                    merged_from_task=task_id,
                    commit_message=f"Merged from {task_id}",
                )
                timeline.add_main_event(event)

            self._persist_timeline(file_path)

        debug_success(MODULE, f"Task {task_id} marked as merged")

    def on_task_abandoned(self, task_id: str) -> None:
        """
        Called if a task is cancelled/abandoned.

        Args:
            task_id: Unique task identifier
        """
        debug(MODULE, f"on_task_abandoned: {task_id}")

        task_files = self.get_files_for_task(task_id)

        for file_path in task_files:
            timeline = self._timelines.get(file_path)
            if not timeline:
                continue

            task_view = timeline.get_task_view(task_id)
            if task_view:
                task_view.status = "abandoned"

            self._persist_timeline(file_path)

    # =========================================================================
    # QUERY METHODS
    # =========================================================================

    def get_merge_context(self, task_id: str, file_path: str) -> MergeContext | None:
        """
        Build complete merge context for AI resolver.

        This is the key method that produces the "situational awareness"
        the Merge AI needs.

        Args:
            task_id: Unique task identifier
            file_path: Path to the file (relative to project root)

        Returns:
            MergeContext object with complete merge information, or None if not found
        """
        debug(MODULE, f"get_merge_context: {task_id} -> {file_path}")

        timeline = self._timelines.get(file_path)
        if not timeline:
            debug_warning(MODULE, f"No timeline found for {file_path}")
            return None

        task_view = timeline.get_task_view(task_id)
        if not task_view:
            debug_warning(
                MODULE, f"Task {task_id} not found in timeline for {file_path}"
            )
            return None

        # Get main evolution since task branched
        main_evolution = timeline.get_events_since_commit(
            task_view.branch_point.commit_hash
        )

        # Get current main state
        current_main = timeline.get_current_main_state()
        current_main_content = (
            current_main.content if current_main else task_view.branch_point.content
        )
        current_main_commit = (
            current_main.commit_hash
            if current_main
            else task_view.branch_point.commit_hash
        )

        # Get task's worktree content
        worktree_content = ""
        if task_view.worktree_state:
            worktree_content = task_view.worktree_state.content
        else:
            # Try to get from worktree path
            worktree_content = self.git.get_worktree_file_content(task_id, file_path)

        # Get other pending tasks
        other_tasks = []
        for tv in timeline.get_active_tasks():
            if tv.task_id != task_id:
                other_tasks.append(
                    {
                        "task_id": tv.task_id,
                        "intent": tv.task_intent.description,
                        "branch_point": tv.branch_point.commit_hash,
                        "commits_behind": tv.commits_behind_main,
                    }
                )

        context = MergeContext(
            file_path=file_path,
            task_id=task_id,
            task_intent=task_view.task_intent,
            task_branch_point=task_view.branch_point,
            main_evolution=main_evolution,
            task_worktree_content=worktree_content,
            current_main_content=current_main_content,
            current_main_commit=current_main_commit,
            other_pending_tasks=other_tasks,
            total_commits_behind=task_view.commits_behind_main,
            total_pending_tasks=len(other_tasks),
        )

        debug_success(
            MODULE,
            "Built merge context",
            commits_behind=task_view.commits_behind_main,
            main_events=len(main_evolution),
            other_tasks=len(other_tasks),
        )

        return context

    def get_files_for_task(self, task_id: str) -> list[str]:
        """
        Return all files this task is tracking.

        Args:
            task_id: Unique task identifier

        Returns:
            List of file paths
        """
        files = []
        for file_path, timeline in self._timelines.items():
            if task_id in timeline.task_views:
                files.append(file_path)
        return files

    def get_pending_tasks_for_file(self, file_path: str) -> list[TaskFileView]:
        """
        Return all active tasks that modify this file.

        Args:
            file_path: Path to the file (relative to project root)

        Returns:
            List of TaskFileView objects
        """
        timeline = self._timelines.get(file_path)
        if not timeline:
            return []
        return timeline.get_active_tasks()

    def get_task_drift(self, task_id: str) -> dict[str, int]:
        """
        Return commits-behind-main for each file in task.

        Args:
            task_id: Unique task identifier

        Returns:
            Dictionary mapping file_path to commits_behind_main count
        """
        drift = {}
        for file_path, timeline in self._timelines.items():
            task_view = timeline.get_task_view(task_id)
            if task_view and task_view.status == "active":
                drift[file_path] = task_view.commits_behind_main
        return drift

    def has_timeline(self, file_path: str) -> bool:
        """
        Check if a file has an active timeline.

        Args:
            file_path: Path to the file (relative to project root)

        Returns:
            True if timeline exists
        """
        return file_path in self._timelines

    def get_timeline(self, file_path: str) -> FileTimeline | None:
        """
        Get the timeline for a file.

        Args:
            file_path: Path to the file (relative to project root)

        Returns:
            FileTimeline object, or None if not found
        """
        return self._timelines.get(file_path)

    # =========================================================================
    # CAPTURE METHODS (for integration with existing code)
    # =========================================================================

    def capture_worktree_state(self, task_id: str, worktree_path: Path) -> None:
        """
        Capture the current state of all modified files in a worktree.

        Called before merge to ensure we have the latest worktree content.

        Args:
            task_id: Unique task identifier
            worktree_path: Path to the worktree directory
        """
        debug(MODULE, f"capture_worktree_state: {task_id}")

        try:
            changed_files = self.git.get_changed_files_in_worktree(worktree_path)

            for file_path in changed_files:
                full_path = worktree_path / file_path
                if full_path.exists():
                    try:
                        content = full_path.read_text(encoding="utf-8")
                    except UnicodeDecodeError:
                        content = full_path.read_text(
                            encoding="utf-8", errors="replace"
                        )
                    self.on_task_worktree_change(task_id, file_path, content)

            debug_success(MODULE, f"Captured {len(changed_files)} files from worktree")

        except Exception as e:
            logger.error(f"Failed to capture worktree state: {e}")

    def initialize_from_worktree(
        self,
        task_id: str,
        worktree_path: Path,
        task_intent: str = "",
        task_title: str = "",
        target_branch: str | None = None,
    ) -> None:
        """
        Initialize timeline tracking from an existing worktree.

        Used for retroactive registration of tasks that were created
        before the timeline system was in place.

        Args:
            task_id: Unique task identifier
            worktree_path: Path to the worktree directory
            task_intent: Description of what the task intends to do
            task_title: Short title for the task
            target_branch: Branch to compare against (default: auto-detect)
        """
        debug(MODULE, f"initialize_from_worktree: {task_id}")

        try:
            # Get the branch point (merge-base with target branch)
            branch_point = self.git.get_branch_point(worktree_path, target_branch)
            if not branch_point:
                return

            # Get changed files
            changed_files = self.git.get_changed_files_in_worktree(
                worktree_path, target_branch
            )
            if not changed_files:
                return

            # Register task for these files
            self.on_task_start(
                task_id=task_id,
                files_to_modify=changed_files,
                branch_point_commit=branch_point,
                task_intent=task_intent,
                task_title=task_title,
            )

            # Capture current worktree state
            self.capture_worktree_state(task_id, worktree_path)

            # Calculate drift (commits behind target branch)
            # Use the detected target branch, or fall back to auto-detection
            actual_target = (
                target_branch
                if target_branch
                else self.git._detect_target_branch(worktree_path)
            )
            drift = self.git.count_commits_between(branch_point, actual_target)
            for file_path in changed_files:
                timeline = self._timelines.get(file_path)
                if timeline:
                    task_view = timeline.get_task_view(task_id)
                    if task_view:
                        task_view.commits_behind_main = drift
                    self._persist_timeline(file_path)

            debug_success(
                MODULE,
                "Initialized from worktree",
                files=len(changed_files),
                branch_point=branch_point[:8],
                target_branch=actual_target,
            )

        except Exception as e:
            logger.error(f"Failed to initialize from worktree: {e}")

    # =========================================================================
    # INTERNAL HELPERS
    # =========================================================================

    def _get_or_create_timeline(self, file_path: str) -> FileTimeline:
        """Get existing timeline or create new one."""
        if file_path not in self._timelines:
            self._timelines[file_path] = FileTimeline(file_path=file_path)
        return self._timelines[file_path]

    def _persist_timeline(self, file_path: str) -> None:
        """Save a single timeline to disk."""
        timeline = self._timelines.get(file_path)
        if not timeline:
            return

        self.persistence.save_timeline(file_path, timeline)
        self.persistence.update_index(list(self._timelines.keys()))

"""
Timeline Git Operations
=======================

Git helper utilities for the File Timeline system.

This module handles all Git interactions including:
- Getting file content at specific commits
- Querying commit information and metadata
- Determining changed files in commits
- Working with worktrees
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from core.git_executable import get_isolated_git_env

logger = logging.getLogger(__name__)

# Import debug utilities
try:
    from debug import debug, debug_error, debug_warning
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_error(*args, **kwargs):
        pass

    def debug_warning(*args, **kwargs):
        pass


MODULE = "merge.timeline_git"


class TimelineGitHelper:
    """
    Git operations helper for the FileTimelineTracker.

    Provides all Git-related functionality needed by the timeline system.
    """

    def __init__(self, project_path: Path):
        """
        Initialize the Git helper.

        Args:
            project_path: Root directory of the git repository
        """
        self.project_path = Path(project_path).resolve()

    def get_current_main_commit(self) -> str:
        """Get the current HEAD commit on main branch."""
        try:
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                check=True,
                env=get_isolated_git_env(),
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError:
            return "unknown"

    def get_file_content_at_commit(
        self, file_path: str, commit_hash: str
    ) -> str | None:
        """
        Get file content at a specific commit.

        Args:
            file_path: Path to the file (relative to project root)
            commit_hash: Git commit hash

        Returns:
            File content as string, or None if file doesn't exist at that commit
        """
        try:
            result = subprocess.run(
                ["git", "show", f"{commit_hash}:{file_path}"],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                env=get_isolated_git_env(),
            )
            if result.returncode == 0:
                return result.stdout
            return None
        except Exception:
            return None

    def get_files_changed_in_commit(self, commit_hash: str) -> list[str]:
        """
        Get list of files changed in a commit.

        Args:
            commit_hash: Git commit hash

        Returns:
            List of file paths changed in the commit
        """
        try:
            result = subprocess.run(
                [
                    "git",
                    "diff-tree",
                    "--no-commit-id",
                    "--name-only",
                    "-r",
                    commit_hash,
                ],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                check=True,
                env=get_isolated_git_env(),
            )
            return [f for f in result.stdout.strip().split("\n") if f]
        except subprocess.CalledProcessError:
            return []

    def get_commit_info(self, commit_hash: str) -> dict:
        """
        Get commit metadata.

        Args:
            commit_hash: Git commit hash

        Returns:
            Dictionary with keys: message, author, diff_summary
        """
        info = {}
        env = get_isolated_git_env()
        try:
            result = subprocess.run(
                ["git", "log", "-1", "--format=%s", commit_hash],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                env=env,
            )
            if result.returncode == 0:
                info["message"] = result.stdout.strip()

            result = subprocess.run(
                ["git", "log", "-1", "--format=%an", commit_hash],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                env=env,
            )
            if result.returncode == 0:
                info["author"] = result.stdout.strip()

            result = subprocess.run(
                ["git", "diff-tree", "--stat", "--no-commit-id", commit_hash],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                env=env,
            )
            if result.returncode == 0:
                info["diff_summary"] = (
                    result.stdout.strip().split("\n")[-1]
                    if result.stdout.strip()
                    else None
                )

        except Exception:
            pass

        return info

    def get_worktree_file_content(self, task_id: str, file_path: str) -> str:
        """
        Get file content from a task's worktree.

        Args:
            task_id: Task identifier (will be converted to spec name)
            file_path: Path to the file (relative to project root)

        Returns:
            File content as string, or empty string if file doesn't exist
        """
        # Extract spec name from task_id (remove 'task-' prefix if present)
        spec_name = (
            task_id.replace("task-", "") if task_id.startswith("task-") else task_id
        )

        worktree_path = (
            self.project_path
            / ".auto-claude"
            / "worktrees"
            / "tasks"
            / spec_name
            / file_path
        )
        if worktree_path.exists():
            try:
                return worktree_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                return worktree_path.read_text(encoding="utf-8", errors="replace")
        return ""

    def get_changed_files_in_worktree(
        self, worktree_path: Path, target_branch: str | None = None
    ) -> list[str]:
        """
        Get all changed files in a worktree vs target branch.

        Args:
            worktree_path: Path to the worktree directory
            target_branch: Branch to compare against (default: auto-detect)

        Returns:
            List of file paths changed in the worktree
        """
        if not target_branch:
            target_branch = self._detect_target_branch(worktree_path)

        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", f"{target_branch}...HEAD"],
                cwd=worktree_path,
                capture_output=True,
                text=True,
                env=get_isolated_git_env(),
            )

            if result.returncode != 0:
                return []

            return [f for f in result.stdout.strip().split("\n") if f]

        except Exception as e:
            logger.error(f"Failed to get changed files in worktree: {e}")
            return []

    def get_branch_point(
        self, worktree_path: Path, target_branch: str | None = None
    ) -> str | None:
        """
        Get the branch point (merge-base with target branch) for a worktree.

        Args:
            worktree_path: Path to the worktree directory
            target_branch: Branch to find merge-base with (default: auto-detect)

        Returns:
            Commit hash of the branch point, or None if error
        """
        if not target_branch:
            target_branch = self._detect_target_branch(worktree_path)

        try:
            result = subprocess.run(
                ["git", "merge-base", target_branch, "HEAD"],
                cwd=worktree_path,
                capture_output=True,
                text=True,
                env=get_isolated_git_env(),
            )

            if result.returncode != 0:
                debug_warning(
                    MODULE,
                    f"Could not determine branch point for {target_branch}",
                )
                return None

            return result.stdout.strip()

        except Exception as e:
            logger.error(f"Failed to get branch point: {e}")
            return None

    def _detect_target_branch(self, worktree_path: Path) -> str:
        """
        Detect the target branch to compare against for a worktree.

        Args:
            worktree_path: Path to the worktree

        Returns:
            The detected target branch name, defaults to 'main' if detection fails
        """
        env = get_isolated_git_env()
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
                cwd=worktree_path,
                capture_output=True,
                text=True,
                env=env,
            )
            if result.returncode == 0 and result.stdout.strip():
                upstream = result.stdout.strip()
                if "/" in upstream:
                    return upstream.split("/", 1)[1]
                return upstream
        except Exception:
            pass

        for branch in ["main", "master", "develop"]:
            try:
                result = subprocess.run(
                    ["git", "merge-base", branch, "HEAD"],
                    cwd=worktree_path,
                    capture_output=True,
                    text=True,
                    env=env,
                )
                if result.returncode == 0:
                    return branch
            except Exception:
                continue

        return "main"

    def count_commits_between(self, from_commit: str, to_commit: str) -> int:
        """
        Count commits between two points.

        Args:
            from_commit: Starting commit
            to_commit: Ending commit

        Returns:
            Number of commits between the two points
        """
        try:
            result = subprocess.run(
                ["git", "rev-list", "--count", f"{from_commit}..{to_commit}"],
                cwd=self.project_path,
                capture_output=True,
                text=True,
                env=get_isolated_git_env(),
            )

            if result.returncode == 0:
                return int(result.stdout.strip())

        except Exception as e:
            logger.error(f"Failed to count commits: {e}")

        return 0

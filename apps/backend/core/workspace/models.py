#!/usr/bin/env python3
"""
Workspace Models
================

Data classes and enums for workspace management.
"""

from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class WorkspaceMode(Enum):
    """How auto-claude should work."""

    ISOLATED = "isolated"  # Work in a separate worktree (safe)
    DIRECT = "direct"  # Work directly in user's project


class WorkspaceChoice(Enum):
    """User's choice after build completes."""

    MERGE = "merge"  # Add changes to project
    REVIEW = "review"  # Show what changed
    TEST = "test"  # Test the feature in the staging worktree
    LATER = "later"  # Decide later


@dataclass
class ParallelMergeTask:
    """A file merge task to be executed in parallel."""

    file_path: str
    main_content: str
    worktree_content: str
    base_content: str | None
    spec_name: str
    project_dir: Path


@dataclass
class ParallelMergeResult:
    """Result of a parallel merge task."""

    file_path: str
    merged_content: str | None
    success: bool
    error: str | None = None
    was_auto_merged: bool = False  # True if git auto-merged without AI


class MergeLockError(Exception):
    """Raised when a merge lock cannot be acquired."""

    pass


class MergeLock:
    """
    Context manager for merge locking to prevent concurrent merges.

    Uses a lock file in .auto-claude/ to ensure only one merge operation
    runs at a time for a given project.
    """

    def __init__(self, project_dir: Path, spec_name: str):
        self.project_dir = project_dir
        self.spec_name = spec_name
        self.lock_dir = project_dir / ".auto-claude" / ".locks"
        self.lock_file = self.lock_dir / f"merge-{spec_name}.lock"
        self.acquired = False

    def __enter__(self):
        """Acquire the merge lock."""
        import os
        import time

        self.lock_dir.mkdir(parents=True, exist_ok=True)

        # Try to acquire lock with timeout
        max_wait = 30  # seconds
        start_time = time.time()

        while True:
            try:
                # Try to create lock file exclusively
                fd = os.open(
                    str(self.lock_file),
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                    0o644,
                )
                os.close(fd)

                # Write our PID to the lock file
                self.lock_file.write_text(str(os.getpid()), encoding="utf-8")
                self.acquired = True
                return self

            except FileExistsError:
                # Lock file exists - check if process is still running
                if self.lock_file.exists():
                    try:
                        pid = int(self.lock_file.read_text(encoding="utf-8").strip())
                        # Import locally to avoid circular dependency
                        import os as _os

                        try:
                            _os.kill(pid, 0)
                            is_running = True
                        except (OSError, ProcessLookupError):
                            is_running = False

                        if not is_running:
                            # Stale lock - remove it
                            self.lock_file.unlink()
                            continue
                    except (ValueError, ProcessLookupError):
                        # Invalid PID or can't check - remove stale lock
                        self.lock_file.unlink()
                        continue

                # Active lock - wait or timeout
                if time.time() - start_time >= max_wait:
                    raise MergeLockError(
                        f"Could not acquire merge lock for {self.spec_name} after {max_wait}s"
                    )

                time.sleep(0.5)

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Release the merge lock."""
        if self.acquired and self.lock_file.exists():
            try:
                self.lock_file.unlink()
            except Exception:
                pass  # Best effort cleanup


class SpecNumberLockError(Exception):
    """Raised when a spec number lock cannot be acquired."""

    pass


class SpecNumberLock:
    """
    Context manager for spec number coordination across main project and worktrees.

    Prevents race conditions when creating specs by:
    1. Acquiring an exclusive file lock
    2. Scanning ALL spec locations (main + worktrees)
    3. Finding global maximum spec number
    4. Allowing atomic spec directory creation
    5. Releasing lock
    """

    def __init__(self, project_dir: Path):
        self.project_dir = project_dir
        self.lock_dir = project_dir / ".auto-claude" / ".locks"
        self.lock_file = self.lock_dir / "spec-numbering.lock"
        self.acquired = False
        self._global_max: int | None = None

    def __enter__(self) -> "SpecNumberLock":
        """Acquire the spec numbering lock."""
        import os
        import time

        self.lock_dir.mkdir(parents=True, exist_ok=True)

        max_wait = 30  # seconds
        start_time = time.time()

        while True:
            try:
                # Try to create lock file exclusively (atomic operation)
                fd = os.open(
                    str(self.lock_file),
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                    0o644,
                )
                os.close(fd)

                # Write our PID to the lock file
                self.lock_file.write_text(str(os.getpid()), encoding="utf-8")
                self.acquired = True
                return self

            except FileExistsError:
                # Lock file exists - check if process is still running
                if self.lock_file.exists():
                    try:
                        pid = int(self.lock_file.read_text(encoding="utf-8").strip())
                        import os as _os

                        try:
                            _os.kill(pid, 0)
                            is_running = True
                        except (OSError, ProcessLookupError):
                            is_running = False

                        if not is_running:
                            # Stale lock - remove it
                            self.lock_file.unlink()
                            continue
                    except (ValueError, ProcessLookupError):
                        # Invalid PID or can't check - remove stale lock
                        self.lock_file.unlink()
                        continue

                # Active lock - wait or timeout
                if time.time() - start_time >= max_wait:
                    raise SpecNumberLockError(
                        f"Could not acquire spec numbering lock after {max_wait}s"
                    )

                time.sleep(0.1)  # Shorter sleep for spec creation

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Release the spec numbering lock."""
        if self.acquired and self.lock_file.exists():
            try:
                self.lock_file.unlink()
            except Exception:
                pass  # Best effort cleanup

    def get_next_spec_number(self) -> int:
        """
        Scan all spec locations and return the next available spec number.

        Must be called while lock is held.

        Returns:
            Next available spec number (global max + 1)
        """
        if not self.acquired:
            raise SpecNumberLockError(
                "Lock must be acquired before getting next spec number"
            )

        if self._global_max is not None:
            return self._global_max + 1

        max_number = 0

        # 1. Scan main project specs
        main_specs_dir = self.project_dir / ".auto-claude" / "specs"
        max_number = max(max_number, self._scan_specs_dir(main_specs_dir))

        # 2. Scan all worktree specs
        worktrees_dir = self.project_dir / ".auto-claude" / "worktrees" / "tasks"
        if worktrees_dir.exists():
            for worktree in worktrees_dir.iterdir():
                if worktree.is_dir():
                    worktree_specs = worktree / ".auto-claude" / "specs"
                    max_number = max(max_number, self._scan_specs_dir(worktree_specs))

        self._global_max = max_number
        return max_number + 1

    def _scan_specs_dir(self, specs_dir: Path) -> int:
        """Scan a specs directory and return the highest spec number found."""
        if not specs_dir.exists():
            return 0

        max_num = 0
        for folder in specs_dir.glob("[0-9][0-9][0-9]-*"):
            try:
                num = int(folder.name[:3])
                max_num = max(max_num, num)
            except ValueError:
                pass

        return max_num


class DependencyStrategy(Enum):
    """Strategy for sharing dependency directories across worktrees.

    SYMLINK is fast and now safe for Python venvs with runtime health checks.
    A post-symlink health check validates the venv is usable, automatically
    falling back to RECREATE if the symlink is broken. This works around
    CPython's pyvenv.cfg discovery issue (CPython bug #106045) while maintaining
    fast worktree creation in the common case where symlinking succeeds.
    """

    SYMLINK = "symlink"  # Create a symlink to the source (fast, works for node_modules)
    RECREATE = "recreate"  # Re-run the package manager to create a fresh copy
    COPY = "copy"  # Deep-copy the directory (slow but always correct)
    SKIP = "skip"  # Do nothing; let the agent handle it


@dataclass
class DependencyShareConfig:
    """Configuration for how a specific dependency type should be shared."""

    dep_type: str  # e.g. "node_modules", "venv", ".venv"
    strategy: DependencyStrategy
    source_rel_path: str  # Relative path from project root, e.g. "node_modules"
    requirements_file: str | None = None  # e.g. "requirements.txt", "pyproject.toml"
    package_manager: str | None = None  # e.g. "npm", "uv", "pip"

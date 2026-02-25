"""
Status Management
==================

Build status tracking and status file management for ccstatusline integration.
"""

import json
import threading
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path

from .colors import warning


class BuildState(Enum):
    """Build state enumeration."""

    IDLE = "idle"
    PLANNING = "planning"
    BUILDING = "building"
    QA = "qa"
    COMPLETE = "complete"
    PAUSED = "paused"
    ERROR = "error"


@dataclass
class BuildStatus:
    """Current build status for status line display."""

    active: bool = False
    spec: str = ""
    state: BuildState = BuildState.IDLE
    subtasks_completed: int = 0
    subtasks_total: int = 0
    subtasks_in_progress: int = 0
    subtasks_failed: int = 0
    phase_current: str = ""
    phase_id: int = 0
    phase_total: int = 0
    workers_active: int = 0
    workers_max: int = 1
    session_number: int = 0
    session_started: str = ""
    last_update: str = ""

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "active": self.active,
            "spec": self.spec,
            "state": self.state.value,
            "subtasks": {
                "completed": self.subtasks_completed,
                "total": self.subtasks_total,
                "in_progress": self.subtasks_in_progress,
                "failed": self.subtasks_failed,
            },
            "phase": {
                "current": self.phase_current,
                "id": self.phase_id,
                "total": self.phase_total,
            },
            "workers": {
                "active": self.workers_active,
                "max": self.workers_max,
            },
            "session": {
                "number": self.session_number,
                "started_at": self.session_started,
            },
            "last_update": self.last_update or datetime.now().isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "BuildStatus":
        """Create from dictionary."""
        subtasks = data.get("subtasks", {})
        phase = data.get("phase", {})
        workers = data.get("workers", {})
        session = data.get("session", {})

        return cls(
            active=data.get("active", False),
            spec=data.get("spec", ""),
            state=BuildState(data.get("state", "idle")),
            subtasks_completed=subtasks.get("completed", 0),
            subtasks_total=subtasks.get("total", 0),
            subtasks_in_progress=subtasks.get("in_progress", 0),
            subtasks_failed=subtasks.get("failed", 0),
            phase_current=phase.get("current", ""),
            phase_id=phase.get("id", 0),
            phase_total=phase.get("total", 0),
            workers_active=workers.get("active", 0),
            workers_max=workers.get("max", 1),
            session_number=session.get("number", 0),
            session_started=session.get("started_at", ""),
            last_update=data.get("last_update", ""),
        )


class StatusManager:
    """Manages the .auto-claude-status file for ccstatusline integration."""

    # Class-level debounce delay (ms) for batched writes
    _WRITE_DEBOUNCE_MS = 50

    def __init__(self, project_dir: Path):
        self.project_dir = Path(project_dir)
        self.status_file = self.project_dir / ".auto-claude-status"
        self._status = BuildStatus()
        self._write_pending = False
        self._write_timer: threading.Timer | None = None
        self._write_lock = threading.Lock()  # Protects _write_pending and _write_timer

    def read(self) -> BuildStatus:
        """Read current status from file."""
        if not self.status_file.exists():
            return BuildStatus()

        try:
            with open(self.status_file, encoding="utf-8") as f:
                data = json.load(f)
            self._status = BuildStatus.from_dict(data)
            return self._status
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return BuildStatus()

    def _do_write(self) -> None:
        """Perform the actual file write."""
        import os
        import time

        debug = os.environ.get("DEBUG", "").lower() in ("true", "1")
        write_start = time.time()

        with self._write_lock:
            self._write_pending = False
            self._write_timer = None
            # Update timestamp inside lock to prevent race conditions
            self._status.last_update = datetime.now().isoformat()
            # Capture consistent snapshot while holding lock
            status_dict = self._status.to_dict()

        try:
            with open(self.status_file, "w", encoding="utf-8") as f:
                json.dump(status_dict, f, indent=2)

            if debug:
                write_duration = (time.time() - write_start) * 1000
                print(
                    f"[StatusManager] Batched write completed in {write_duration:.2f}ms"
                )
        except OSError as e:
            print(warning(f"Could not write status file: {e}"))

    def _schedule_write(self) -> None:
        """Schedule a debounced write to batch multiple updates."""
        import os

        debug = os.environ.get("DEBUG", "").lower() in ("true", "1")

        with self._write_lock:
            if self._write_timer is not None:
                self._write_timer.cancel()
                if debug:
                    print(
                        "[StatusManager] Cancelled pending write, batching with new update"
                    )

            self._write_pending = True
            self._write_timer = threading.Timer(
                self._WRITE_DEBOUNCE_MS / 1000.0, self._do_write
            )
            self._write_timer.start()

        if debug:
            print(
                f"[StatusManager] Scheduled batched write in {self._WRITE_DEBOUNCE_MS}ms"
            )

    def write(self, status: BuildStatus | None = None, immediate: bool = False) -> None:
        """Write status to file.

        Args:
            status: Optional status to set before writing
            immediate: If True, write immediately without debouncing
        """
        # Protect status assignment with lock to prevent race conditions
        with self._write_lock:
            if status:
                self._status = status

        if immediate:
            # Cancel any pending debounced write
            with self._write_lock:
                if self._write_timer is not None:
                    self._write_timer.cancel()
                    self._write_timer = None
            self._do_write()
        else:
            self._schedule_write()

    def flush(self) -> None:
        """Force any pending writes to complete immediately."""
        with self._write_lock:
            should_write = self._write_pending
            if self._write_timer is not None:
                self._write_timer.cancel()
                self._write_timer = None
        if should_write:
            self._do_write()

    def update(self, **kwargs) -> None:
        """Update specific status fields."""
        with self._write_lock:
            for key, value in kwargs.items():
                if hasattr(self._status, key):
                    setattr(self._status, key, value)
        self.write()

    def set_active(self, spec: str, state: BuildState) -> None:
        """Mark build as active. Writes immediately for visibility."""
        with self._write_lock:
            self._status.active = True
            self._status.spec = spec
            self._status.state = state
            self._status.session_started = datetime.now().isoformat()
        self.write(immediate=True)

    def set_inactive(self) -> None:
        """Mark build as inactive. Writes immediately for visibility."""
        with self._write_lock:
            self._status.active = False
            self._status.state = BuildState.IDLE
        self.write(immediate=True)

    def update_subtasks(
        self,
        completed: int = None,
        total: int = None,
        in_progress: int = None,
        failed: int = None,
    ) -> None:
        """Update subtask progress."""
        with self._write_lock:
            if completed is not None:
                self._status.subtasks_completed = completed
            if total is not None:
                self._status.subtasks_total = total
            if in_progress is not None:
                self._status.subtasks_in_progress = in_progress
            if failed is not None:
                self._status.subtasks_failed = failed
        self.write()

    def update_phase(self, current: str, phase_id: int = 0, total: int = 0) -> None:
        """Update current phase."""
        with self._write_lock:
            self._status.phase_current = current
            self._status.phase_id = phase_id
            self._status.phase_total = total
        self.write()

    def update_workers(self, active: int, max_workers: int = None) -> None:
        """Update worker count."""
        with self._write_lock:
            self._status.workers_active = active
            if max_workers is not None:
                self._status.workers_max = max_workers
        self.write()

    def update_session(self, number: int) -> None:
        """Update session number."""
        with self._write_lock:
            self._status.session_number = number
        self.write()

    def clear(self) -> None:
        """Remove status file."""
        # Cancel any pending writes
        with self._write_lock:
            if self._write_timer is not None:
                self._write_timer.cancel()
                self._write_timer = None
            self._write_pending = False

        if self.status_file.exists():
            try:
                self.status_file.unlink()
            except OSError:
                pass

"""
Storage functionality for task logs.
"""

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .models import LogEntry, LogPhase


class LogStorage:
    """Handles persistent storage of task logs."""

    LOG_FILE = "task_logs.json"

    def __init__(self, spec_dir: Path):
        """
        Initialize log storage.

        Args:
            spec_dir: Path to the spec directory
        """
        self.spec_dir = Path(spec_dir)
        self.log_file = self.spec_dir / self.LOG_FILE
        self._data: dict = self._load_or_create()

    def _load_or_create(self) -> dict:
        """Load existing logs or create new structure."""
        if self.log_file.exists():
            try:
                with open(self.log_file, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                pass

        return {
            "spec_id": self.spec_dir.name,
            "created_at": self._timestamp(),
            "updated_at": self._timestamp(),
            "phases": {
                LogPhase.PLANNING.value: {
                    "phase": LogPhase.PLANNING.value,
                    "status": "pending",
                    "started_at": None,
                    "completed_at": None,
                    "entries": [],
                },
                LogPhase.CODING.value: {
                    "phase": LogPhase.CODING.value,
                    "status": "pending",
                    "started_at": None,
                    "completed_at": None,
                    "entries": [],
                },
                LogPhase.VALIDATION.value: {
                    "phase": LogPhase.VALIDATION.value,
                    "status": "pending",
                    "started_at": None,
                    "completed_at": None,
                    "entries": [],
                },
            },
        }

    def save(self) -> None:
        """Save logs to file atomically to prevent corruption from concurrent reads."""
        self._data["updated_at"] = self._timestamp()
        try:
            self.spec_dir.mkdir(parents=True, exist_ok=True)
            # Write to temp file first, then atomic rename to prevent corruption
            # when the UI reads mid-write
            fd, tmp_path = tempfile.mkstemp(
                dir=self.spec_dir, prefix=".task_logs_", suffix=".tmp"
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(self._data, f, indent=2, ensure_ascii=False)
                # Atomic rename (on POSIX systems, rename is atomic)
                os.replace(tmp_path, self.log_file)
            except Exception:
                # Clean up temp file on failure
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                raise
        except OSError as e:
            print(f"Warning: Failed to save task logs: {e}", file=sys.stderr)

    def _timestamp(self) -> str:
        """Get current timestamp in ISO format."""
        return datetime.now(timezone.utc).isoformat()

    def add_entry(self, entry: LogEntry) -> None:
        """
        Add an entry to the specified phase.

        Args:
            entry: The log entry to add
        """
        phase_key = entry.phase
        if phase_key not in self._data["phases"]:
            # Create phase if it doesn't exist
            self._data["phases"][phase_key] = {
                "phase": phase_key,
                "status": "active",
                "started_at": self._timestamp(),
                "completed_at": None,
                "entries": [],
            }

        self._data["phases"][phase_key]["entries"].append(entry.to_dict())
        self.save()

    def update_phase_status(
        self, phase: str, status: str, completed_at: str | None = None
    ) -> None:
        """
        Update phase status.

        Args:
            phase: Phase name
            status: New status (pending, active, completed, failed)
            completed_at: Optional completion timestamp
        """
        if phase in self._data["phases"]:
            self._data["phases"][phase]["status"] = status
            if completed_at:
                self._data["phases"][phase]["completed_at"] = completed_at

    def set_phase_started(self, phase: str, started_at: str) -> None:
        """
        Set phase start time.

        Args:
            phase: Phase name
            started_at: Start timestamp
        """
        if phase in self._data["phases"]:
            self._data["phases"][phase]["started_at"] = started_at

    def get_data(self) -> dict:
        """Get all log data."""
        return self._data

    def get_phase_data(self, phase: str) -> dict:
        """Get data for a specific phase."""
        return self._data["phases"].get(phase, {})

    def update_spec_id(self, new_spec_id: str) -> None:
        """
        Update the spec ID in the data.

        Args:
            new_spec_id: New spec ID
        """
        self._data["spec_id"] = new_spec_id


def load_task_logs(spec_dir: Path) -> dict | None:
    """
    Load task logs from a spec directory.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Logs dictionary or None if not found
    """
    log_file = spec_dir / LogStorage.LOG_FILE
    if not log_file.exists():
        return None

    try:
        with open(log_file, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def get_active_phase(spec_dir: Path) -> str | None:
    """
    Get the currently active phase for a spec.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Phase name or None if no active phase
    """
    logs = load_task_logs(spec_dir)
    if not logs:
        return None

    for phase_name, phase_data in logs.get("phases", {}).items():
        if phase_data.get("status") == "active":
            return phase_name

    return None

"""
Task event protocol for frontend XState synchronization.

Protocol: __TASK_EVENT__:{...}
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

TASK_EVENT_PREFIX = "__TASK_EVENT__:"
_DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")


@dataclass
class TaskEventContext:
    task_id: str
    spec_id: str
    project_id: str
    sequence_start: int = 0


def _load_task_metadata(spec_dir: Path) -> dict:
    metadata_path = spec_dir / "task_metadata.json"
    if not metadata_path.exists():
        return {}
    try:
        with open(metadata_path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _load_last_sequence(spec_dir: Path) -> int:
    plan_path = spec_dir / "implementation_plan.json"
    if not plan_path.exists():
        return 0
    try:
        with open(plan_path, encoding="utf-8") as f:
            plan = json.load(f)
        last_event = plan.get("lastEvent") or {}
        seq = last_event.get("sequence")
        if isinstance(seq, int) and seq >= 0:
            return seq + 1
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return 0
    return 0


def load_task_event_context(spec_dir: Path) -> TaskEventContext:
    metadata = _load_task_metadata(spec_dir)
    task_id = metadata.get("taskId") or metadata.get("task_id") or spec_dir.name
    spec_id = metadata.get("specId") or metadata.get("spec_id") or spec_dir.name
    project_id = metadata.get("projectId") or metadata.get("project_id") or ""
    sequence_start = _load_last_sequence(spec_dir)
    return TaskEventContext(
        task_id=str(task_id),
        spec_id=str(spec_id),
        project_id=str(project_id),
        sequence_start=sequence_start,
    )


class TaskEventEmitter:
    def __init__(self, context: TaskEventContext) -> None:
        self._context = context
        self._sequence = context.sequence_start

    @classmethod
    def from_spec_dir(cls, spec_dir: Path) -> TaskEventEmitter:
        return cls(load_task_event_context(spec_dir))

    def emit(self, event_type: str, payload: dict | None = None) -> None:
        event = {
            "type": event_type,
            "taskId": self._context.task_id,
            "specId": self._context.spec_id,
            "projectId": self._context.project_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "eventId": str(uuid4()),
            "sequence": self._sequence,
        }
        if payload:
            event.update(payload)

        try:
            print(f"{TASK_EVENT_PREFIX}{json.dumps(event, default=str)}", flush=True)
            self._sequence += 1
        except (OSError, UnicodeEncodeError) as e:
            if _DEBUG:
                try:
                    sys.stderr.write(f"[task_event] emit failed: {e}\n")
                    sys.stderr.flush()
                except (OSError, UnicodeEncodeError):
                    pass  # Silent on complete I/O failure

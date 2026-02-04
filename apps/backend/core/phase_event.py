"""
Execution phase event protocol for frontend synchronization.

Protocol: __EXEC_PHASE__:{"phase":"coding","message":"Starting"}
"""

import json
import os
import sys
from enum import Enum
from typing import Any

PHASE_MARKER_PREFIX = "__EXEC_PHASE__:"
DRIFT_MARKER_PREFIX = "__DRIFT_REPORT__:"
_DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")


class ExecutionPhase(str, Enum):
    """Maps to frontend's ExecutionPhase type for task card badges."""

    PLANNING = "planning"
    CODING = "coding"
    QA_REVIEW = "qa_review"
    QA_FIXING = "qa_fixing"
    COMPLETE = "complete"
    FAILED = "failed"
    IDLE = "idle"


def emit_phase(
    phase: ExecutionPhase | str,
    message: str = "",
    *,
    progress: int | None = None,
    subtask: str | None = None,
) -> None:
    """Emit structured phase event to stdout for frontend parsing."""
    phase_value = phase.value if isinstance(phase, ExecutionPhase) else phase

    payload: dict[str, Any] = {
        "phase": phase_value,
        "message": message,
    }

    if progress is not None:
        if not (0 <= progress <= 100):
            progress = max(0, min(100, progress))
        payload["progress"] = progress

    if subtask is not None:
        payload["subtask"] = subtask

    try:
        print(f"{PHASE_MARKER_PREFIX}{json.dumps(payload, default=str)}", flush=True)
    except (OSError, UnicodeEncodeError) as e:
        if _DEBUG:
            try:
                sys.stderr.write(f"[phase_event] emit failed: {e}\n")
                sys.stderr.flush()
            except (OSError, UnicodeEncodeError):
                pass  # Truly silent on complete I/O failure


def emit_drift_report(report: dict[str, Any]) -> None:
    """
    Emit drift report event to stdout for frontend parsing.

    Protocol: __DRIFT_REPORT__:{"run_id":"...", "overall_drift_score":0.15, ...}

    Args:
        report: Drift report dictionary from DriftReport.to_dict()
    """
    try:
        print(f"{DRIFT_MARKER_PREFIX}{json.dumps(report, default=str)}", flush=True)
    except (OSError, UnicodeEncodeError) as e:
        if _DEBUG:
            try:
                sys.stderr.write(f"[phase_event] drift emit failed: {e}\n")
                sys.stderr.flush()
            except (OSError, UnicodeEncodeError):
                pass  # Truly silent on complete I/O failure


def emit_drift_interim(interim_report: dict[str, Any]) -> None:
    """
    Emit interim drift report for real-time UI updates.

    Protocol: __DRIFT_INTERIM__:{"is_interim":true, "overall_drift_score":0.12, ...}

    Args:
        interim_report: Interim drift data from AgentMonitor.get_interim_report()
    """
    try:
        print(f"__DRIFT_INTERIM__:{json.dumps(interim_report, default=str)}", flush=True)
    except (OSError, UnicodeEncodeError) as e:
        if _DEBUG:
            try:
                sys.stderr.write(f"[phase_event] drift interim emit failed: {e}\n")
                sys.stderr.flush()
            except (OSError, UnicodeEncodeError):
                pass

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
_DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")


class ExecutionPhase(str, Enum):
    """Maps to frontend's ExecutionPhase type for task card badges."""

    PLANNING = "planning"
    CODING = "coding"
    QA_REVIEW = "qa_review"
    QA_FIXING = "qa_fixing"
    COMPLETE = "complete"
    FAILED = "failed"
    # Pause states for intelligent error recovery
    RATE_LIMIT_PAUSED = "rate_limit_paused"
    AUTH_FAILURE_PAUSED = "auth_failure_paused"


def emit_phase(
    phase: ExecutionPhase | str,
    message: str = "",
    *,
    progress: int | None = None,
    subtask: str | None = None,
    reset_timestamp: int | None = None,
    profile_id: str | None = None,
) -> None:
    """Emit structured phase event to stdout for frontend parsing.

    Args:
        phase: The execution phase (e.g., PLANNING, CODING, RATE_LIMIT_PAUSED)
        message: Optional message describing the phase state
        progress: Optional progress percentage (0-100)
        subtask: Optional subtask identifier
        reset_timestamp: Optional Unix timestamp for rate limit reset time
        profile_id: Optional profile ID that triggered the pause
    """
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

    if reset_timestamp is not None:
        payload["reset_timestamp"] = reset_timestamp

    if profile_id is not None:
        payload["profile_id"] = profile_id

    try:
        print(f"{PHASE_MARKER_PREFIX}{json.dumps(payload, default=str)}", flush=True)
    except (OSError, UnicodeEncodeError) as e:
        if _DEBUG:
            try:
                sys.stderr.write(f"[phase_event] emit failed: {e}\n")
                sys.stderr.flush()
            except (OSError, UnicodeEncodeError):
                pass  # Truly silent on complete I/O failure

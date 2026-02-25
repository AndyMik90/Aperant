"""
Merge Progress Emission
=======================

Structured progress event emission for the merge pipeline.

This module provides the progress reporting infrastructure used by the
merge orchestrator to communicate real-time status updates to the
Electron frontend via stdout JSON lines.

Progress events are emitted as JSON lines to stdout with type='progress',
allowing the frontend to parse them separately from the final merge result.

Components:
- MergeProgressStage: Enum of pipeline stages
- MergeProgressCallback: Protocol for type-safe callback threading
- emit_progress: Function to emit structured progress events to stdout
"""

from __future__ import annotations

import json
from enum import Enum
from typing import Any, Protocol


class MergeProgressStage(Enum):
    """
    Stages of the merge pipeline.

    Each stage corresponds to a phase of the merge process and maps
    to a percentage range for progress reporting:
    - ANALYZING: 0-25% — Loading file evolution, running semantic analysis
    - DETECTING_CONFLICTS: 25-50% — Conflict detection and compatibility checks
    - RESOLVING: 50-75% — Auto-merge and AI resolution of conflicts
    - VALIDATING: 75-100% — Final validation of merged results
    - COMPLETE: 100% — Merge finished successfully
    - ERROR: N/A — Merge failed with an error
    """

    ANALYZING = "analyzing"
    DETECTING_CONFLICTS = "detecting_conflicts"
    RESOLVING = "resolving"
    VALIDATING = "validating"
    COMPLETE = "complete"
    ERROR = "error"


class MergeProgressCallback(Protocol):
    """
    Protocol for type-safe progress callback threading.

    Implementations receive structured progress updates from the merge
    pipeline stages and can forward them to any output channel.

    Args:
        stage: Current pipeline stage
        percent: Progress percentage (0-100)
        message: Human-readable status message
        details: Optional additional context (conflicts_found, conflicts_resolved, current_file)
    """

    def __call__(
        self,
        stage: MergeProgressStage,
        percent: int,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None: ...


def emit_progress(
    stage: MergeProgressStage,
    percent: int,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    """
    Emit a progress event as a JSON line to stdout.

    The Electron main process parses these JSON lines from the merge
    subprocess stdout and forwards them to the renderer via IPC.

    Args:
        stage: Current pipeline stage
        percent: Progress percentage (0-100), clamped to valid range
        message: Human-readable status message
        details: Optional dict with additional context. Supported keys:
            - conflicts_found (int): Number of conflicts detected
            - conflicts_resolved (int): Number of conflicts resolved so far
            - current_file (str): File currently being processed
    """
    percent = max(0, min(100, percent))

    event: dict[str, Any] = {
        "type": "progress",
        "stage": stage.value,
        "percent": percent,
        "message": message,
    }

    if details:
        event["details"] = details

    print(json.dumps(event), flush=True)

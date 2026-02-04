"""
Phase event facade for frontend synchronization.
Re-exports from core.phase_event for clean imports.
"""

from core.phase_event import (
    DRIFT_MARKER_PREFIX,
    PHASE_MARKER_PREFIX,
    ExecutionPhase,
    emit_drift_interim,
    emit_drift_report,
    emit_phase,
)

__all__ = [
    "DRIFT_MARKER_PREFIX",
    "PHASE_MARKER_PREFIX",
    "ExecutionPhase",
    "emit_drift_interim",
    "emit_drift_report",
    "emit_phase",
]

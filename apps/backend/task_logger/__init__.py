"""
Task Logger Package
===================

Persistent logging system for AC Jerry tasks.
Logs are organized by phase (planning, coding, validation) and stored in the spec directory.

Key features:
- Phase-based log organization (collapsible in UI)
- Streaming markers for real-time UI updates
- Persistent storage in JSON format for easy frontend consumption
- Tool usage tracking with start/end markers
"""

# Export models
# Export streaming capture
from .capture import StreamingLogCapture

# Export main logger
from .logger import TaskLogger
from .models import LogEntry, LogEntryType, LogPhase, PhaseLog

# Export storage utilities
from .storage import get_active_phase, load_task_logs

# Export utility functions
from .utils import clear_task_logger, get_task_logger, update_task_logger_path

__all__ = [
    # Models
    "LogPhase",
    "LogEntryType",
    "LogEntry",
    "PhaseLog",
    # Main logger
    "TaskLogger",
    # Storage utilities
    "load_task_logs",
    "get_active_phase",
    # Utility functions
    "get_task_logger",
    "clear_task_logger",
    "update_task_logger_path",
    # Streaming capture
    "StreamingLogCapture",
]

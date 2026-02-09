"""
Task Logger
============

Persistent logging system for AC Jerry tasks.

This module serves as the main entry point for task logging functionality.
The implementation has been refactored into a modular package structure:

- task_logger.models: Data models (LogPhase, LogEntryType, LogEntry, PhaseLog)
- task_logger.logger: Main TaskLogger class
- task_logger.storage: Log storage and persistence
- task_logger.streaming: Streaming marker functionality
- task_logger.utils: Utility functions
- task_logger.capture: StreamingLogCapture for agent sessions

For backwards compatibility, all public APIs are re-exported here.
"""

# Re-export all public APIs from the task_logger package
from task_logger import (
    LogEntry,
    LogEntryType,
    LogPhase,
    PhaseLog,
    StreamingLogCapture,
    TaskLogger,
    clear_task_logger,
    get_active_phase,
    get_task_logger,
    load_task_logs,
    update_task_logger_path,
)

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

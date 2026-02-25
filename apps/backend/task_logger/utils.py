"""
Utility functions for task logging.
"""

from pathlib import Path
from typing import TYPE_CHECKING

# ANSI functions are in separate ansi.py module to avoid cyclic imports

if TYPE_CHECKING:
    from .logger import TaskLogger


# Global logger instance for easy access
_current_logger: "TaskLogger | None" = None


def get_task_logger(
    spec_dir: Path | None = None, emit_markers: bool = True
) -> "TaskLogger | None":
    """
    Get or create a task logger for the given spec directory.

    Args:
        spec_dir: Path to the spec directory (creates new logger if different from current)
        emit_markers: Whether to emit streaming markers

    Returns:
        TaskLogger instance or None if no spec_dir
    """
    global _current_logger

    if spec_dir is None:
        return _current_logger

    if _current_logger is None or _current_logger.spec_dir != spec_dir:
        # Lazy import to avoid cyclic import
        from .logger import TaskLogger

        _current_logger = TaskLogger(spec_dir, emit_markers)

    return _current_logger


def clear_task_logger() -> None:
    """Clear the global task logger."""
    global _current_logger
    _current_logger = None


def update_task_logger_path(new_spec_dir: Path) -> None:
    """
    Update the global task logger's spec directory after a rename.

    This should be called after renaming a spec directory to ensure
    the logger continues writing to the correct location.

    Args:
        new_spec_dir: The new path to the spec directory
    """
    global _current_logger

    if _current_logger is None:
        return

    # Lazy import to avoid cyclic import
    from .logger import TaskLogger

    # Update the logger's internal paths
    _current_logger.spec_dir = Path(new_spec_dir)
    _current_logger.log_file = _current_logger.spec_dir / TaskLogger.LOG_FILE

    # Update spec_id in the storage
    _current_logger.storage.update_spec_id(new_spec_dir.name)

    # Save to the new location
    _current_logger.storage.save()

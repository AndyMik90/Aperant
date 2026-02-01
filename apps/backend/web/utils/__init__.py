"""
Web API Utility Functions
=========================

Utility functions for the web API layer.
"""

from .logging_utils import (
    dump_diagnostic_info,
    log_environment_info,
    log_error,
    log_file_operation,
    log_function_call,
    log_function_result,
    log_path_check,
    log_plan_state,
    log_task_lifecycle,
    log_worktree_info,
    with_logging,
)
from .plan_helpers import (
    get_all_subtasks,
    get_subtasks_by_phase,
    load_plan_from_spec,
    load_task_logs_from_spec,
    normalize_plan,
)

__all__ = [
    # Plan helpers
    "get_all_subtasks",
    "get_subtasks_by_phase",
    "load_plan_from_spec",
    "load_task_logs_from_spec",
    "normalize_plan",
    # Logging utilities
    "dump_diagnostic_info",
    "log_environment_info",
    "log_error",
    "log_file_operation",
    "log_function_call",
    "log_function_result",
    "log_path_check",
    "log_plan_state",
    "log_task_lifecycle",
    "log_worktree_info",
    "with_logging",
]

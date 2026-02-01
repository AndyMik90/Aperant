"""
Logging Utilities for Web Backend
==================================

Provides comprehensive logging helpers for debugging web backend operations.
Includes structured logging for task execution, plan loading, and error tracking.
"""

import json
import os
import traceback
from collections.abc import Callable
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any

from .security import get_secure_logger

# Create a dedicated logger for web operations
logger = get_secure_logger("auto-claude-api")


def log_function_call(
    func_name: str, args: dict | None = None, level: str = "DEBUG"
) -> None:
    """Log a function call with its arguments."""
    log_method = getattr(logger, level.lower(), logger.debug)
    args_str = json.dumps(args, default=str) if args else "{}"
    log_method(f"🔵 [{func_name}] CALLED with: {args_str}")


def log_function_result(
    func_name: str, result: Any, success: bool = True, level: str = "DEBUG"
) -> None:
    """Log a function result."""
    log_method = getattr(logger, level.lower(), logger.debug)
    emoji = "✅" if success else "❌"

    # Truncate long results
    result_str = str(result)
    if len(result_str) > 500:
        result_str = result_str[:500] + "..."

    log_method(f"{emoji} [{func_name}] RESULT: {result_str}")


def log_error(func_name: str, error: Exception, context: dict | None = None) -> None:
    """Log an error with full traceback and context."""
    context_str = json.dumps(context, default=str) if context else "{}"
    logger.error(
        f"💥 [{func_name}] ERROR: {type(error).__name__}: {error}\n"
        f"   Context: {context_str}\n"
        f"   Traceback:\n{''.join(traceback.format_tb(error.__traceback__))}"
    )


def log_path_check(
    context: str, path: Path, exists: bool, extra_info: str | None = None
) -> None:
    """Log a path existence check."""
    emoji = "📁" if exists else "📭"
    extra = f" ({extra_info})" if extra_info else ""
    logger.info(f"{emoji} [{context}] Path check: {path} exists={exists}{extra}")


def log_plan_state(
    context: str,
    spec_folder: str,
    plan_found: bool,
    subtask_count: int,
    source: str | None = None,
) -> None:
    """Log the state of an implementation plan."""
    emoji = "📋" if plan_found else "📭"
    source_info = f" from {source}" if source else ""
    logger.info(
        f"{emoji} [{context}] Plan state for '{spec_folder}': "
        f"found={plan_found}, subtasks={subtask_count}{source_info}"
    )


def log_task_lifecycle(event: str, task_id: str, details: dict | None = None) -> None:
    """Log task lifecycle events (start, stop, complete, error)."""
    event_emojis = {
        "start": "🚀",
        "stop": "🛑",
        "complete": "✅",
        "error": "💥",
        "status": "📊",
        "poll": "🔍",
    }
    emoji = event_emojis.get(event, "📝")
    details_str = json.dumps(details, default=str) if details else ""
    logger.info(f"{emoji} [Task:{event.upper()}] {task_id} {details_str}")


def log_worktree_info(
    context: str, project_path: Path, spec_folder: str, worktree_path: Path | None
) -> None:
    """Log worktree information."""
    if worktree_path:
        logger.info(
            f"🌳 [{context}] Worktree found for '{spec_folder}': {worktree_path}"
        )
    else:
        logger.info(
            f"🌲 [{context}] No worktree found for '{spec_folder}' in {project_path}"
        )


def log_file_operation(
    operation: str, file_path: Path, success: bool, details: str | None = None
) -> None:
    """Log file read/write operations."""
    emoji = "💾" if success else "❌"
    details_str = f" - {details}" if details else ""
    logger.info(
        f"{emoji} [File:{operation}] {file_path} success={success}{details_str}"
    )


def with_logging(func: Callable) -> Callable:
    """Decorator to add comprehensive logging to a function."""

    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        func_name = func.__name__
        log_function_call(func_name, {"args": args, "kwargs": kwargs})
        try:
            result = await func(*args, **kwargs)
            log_function_result(func_name, result)
            return result
        except Exception as e:
            log_error(func_name, e, {"args": args, "kwargs": kwargs})
            raise

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        func_name = func.__name__
        log_function_call(func_name, {"args": args, "kwargs": kwargs})
        try:
            result = func(*args, **kwargs)
            log_function_result(func_name, result)
            return result
        except Exception as e:
            log_error(func_name, e, {"args": args, "kwargs": kwargs})
            raise

    # Return appropriate wrapper based on function type
    import asyncio

    if asyncio.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper


def dump_diagnostic_info(
    context: str, project_path: Path, spec_folder: str, spec_dir: Path | None = None
) -> dict:
    """
    Dump comprehensive diagnostic information for debugging.
    Returns a dict with all diagnostic info.
    """
    from workspace import get_existing_build_worktree

    info = {
        "timestamp": datetime.utcnow().isoformat(),
        "context": context,
        "project_path": str(project_path),
        "spec_folder": spec_folder,
        "spec_dir": str(spec_dir) if spec_dir else None,
        "project_exists": project_path.exists() if project_path else False,
    }

    # Check spec directory
    if spec_dir:
        info["spec_dir_exists"] = spec_dir.exists()
        if spec_dir.exists():
            info["spec_dir_contents"] = (
                [f.name for f in spec_dir.iterdir()] if spec_dir.is_dir() else []
            )

            # Check for key files
            plan_file = spec_dir / "implementation_plan.json"
            info["plan_file_exists"] = plan_file.exists()
            if plan_file.exists():
                try:
                    plan = json.loads(plan_file.read_text())
                    info["plan_phases_count"] = len(plan.get("phases", []))
                    info["plan_status"] = plan.get("status")
                except Exception as e:
                    info["plan_read_error"] = str(e)

    # Check worktree
    try:
        worktree_path = get_existing_build_worktree(project_path, spec_folder)
        info["worktree_path"] = str(worktree_path) if worktree_path else None
        info["worktree_exists"] = worktree_path.exists() if worktree_path else False

        if worktree_path and worktree_path.exists():
            worktree_spec_dir = worktree_path / ".auto-claude" / "specs" / spec_folder
            info["worktree_spec_dir"] = str(worktree_spec_dir)
            info["worktree_spec_dir_exists"] = worktree_spec_dir.exists()

            if worktree_spec_dir.exists():
                worktree_plan = worktree_spec_dir / "implementation_plan.json"
                info["worktree_plan_exists"] = worktree_plan.exists()
                if worktree_plan.exists():
                    try:
                        wt_plan = json.loads(worktree_plan.read_text())
                        info["worktree_plan_phases"] = len(wt_plan.get("phases", []))
                    except Exception as e:
                        info["worktree_plan_read_error"] = str(e)
    except Exception as e:
        info["worktree_check_error"] = str(e)

    # Log the diagnostic info
    logger.info(
        f"🔬 [DIAGNOSTIC] {context}\n   {json.dumps(info, indent=2, default=str)}"
    )

    return info


def log_environment_info() -> dict:
    """Log current environment information."""
    info = {
        "timestamp": datetime.utcnow().isoformat(),
        "python_version": os.sys.version,
        "cwd": os.getcwd(),
        "pid": os.getpid(),
        "env_vars": {
            "PYTHONPATH": os.environ.get("PYTHONPATH"),
            "GRAPHITI_ENABLED": os.environ.get("GRAPHITI_ENABLED"),
            "DOCKER_MODE": os.environ.get("DOCKER_MODE"),
            "AUTO_CLAUDE_LOG_LEVEL": os.environ.get("AUTO_CLAUDE_LOG_LEVEL"),
        },
    }
    logger.info(f"🌍 [ENVIRONMENT] {json.dumps(info, indent=2)}")
    return info

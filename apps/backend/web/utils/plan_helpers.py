"""
Implementation Plan Helpers
===========================

Helper functions to normalize implementation_plan.json formats for the web API.

The planner agent may create plans in two formats:
1. Nested format: subtasks are inside each phase
2. Flat format: subtasks are at root level with "phase" reference

These helpers normalize the data to work with the core backend which expects
the nested format.
"""

import json
import os
from datetime import datetime
from pathlib import Path

from workspace import get_existing_build_worktree

from .logging_utils import (
    dump_diagnostic_info,
    log_file_operation,
    log_path_check,
    log_plan_state,
    log_worktree_info,
)
from .security import get_secure_logger

logger = get_secure_logger("auto-claude-api")


def _get_log_level() -> str:
    """Get the configured log level from environment."""
    return os.environ.get("AUTO_CLAUDE_LOG_LEVEL", "INFO").upper()


def get_all_subtasks(plan: dict) -> list[dict]:
    """
    Extract all subtasks from an implementation plan, handling both schema formats.

    Format 1 (nested): subtasks are inside each phase
    Format 2 (flat): subtasks are at root level with "phase" reference

    Args:
        plan: The parsed implementation plan dict

    Returns:
        List of all subtask dicts
    """
    all_subtasks = []

    # Check for nested format: subtasks inside phases
    for phase in plan.get("phases", []):
        phase_subtasks = phase.get("subtasks", [])
        if phase_subtasks:
            all_subtasks.extend(phase_subtasks)

    # Check for flat format: subtasks at root level
    if not all_subtasks:
        root_subtasks = plan.get("subtasks", [])
        if root_subtasks:
            all_subtasks = root_subtasks

    return all_subtasks


def get_subtasks_by_phase(plan: dict) -> dict[str, list[dict]]:
    """
    Get subtasks organized by phase, handling both schema formats.

    Args:
        plan: The parsed implementation plan dict

    Returns:
        Dict mapping phase_id to list of subtasks
    """
    by_phase: dict[str, list[dict]] = {}

    # Check for nested format: subtasks inside phases
    for phase in plan.get("phases", []):
        phase_id = phase.get("id") or phase.get("phase")
        phase_subtasks = phase.get("subtasks", [])
        if phase_subtasks:
            by_phase[phase_id] = phase_subtasks

    # Check for flat format: subtasks at root level with "phase" reference
    if not by_phase:
        for subtask in plan.get("subtasks", []):
            phase_ref = subtask.get("phase", "default")
            if phase_ref not in by_phase:
                by_phase[phase_ref] = []
            by_phase[phase_ref].append(subtask)

    return by_phase


def normalize_plan(plan: dict) -> dict:
    """
    Normalize a plan to the nested format expected by the core backend.

    If the plan is in flat format (subtasks at root level), this moves
    the subtasks into their respective phases.

    Args:
        plan: The parsed implementation plan dict

    Returns:
        The plan dict with subtasks nested inside phases
    """
    # Check if already in nested format
    has_nested_subtasks = any(
        phase.get("subtasks", []) for phase in plan.get("phases", [])
    )

    if has_nested_subtasks:
        # Already in correct format
        return plan

    # Check for flat format: subtasks at root level
    root_subtasks = plan.get("subtasks", [])
    if not root_subtasks:
        # No subtasks at all
        return plan

    # Convert flat to nested format
    subtasks_by_phase = get_subtasks_by_phase(plan)

    # Create a copy of the plan
    normalized = dict(plan)

    # Add subtasks to each phase
    normalized_phases = []
    for phase in plan.get("phases", []):
        phase_copy = dict(phase)
        phase_id = phase.get("id") or phase.get("phase")
        phase_copy["subtasks"] = subtasks_by_phase.get(phase_id, [])
        normalized_phases.append(phase_copy)

    normalized["phases"] = normalized_phases

    # Remove root-level subtasks to avoid confusion
    if "subtasks" in normalized:
        del normalized["subtasks"]

    return normalized


def load_plan_from_spec(
    spec_path: Path,
    project_path: Path,
    spec_folder: str,
) -> tuple[dict | None, list[dict]]:
    """
    Load implementation plan from spec, checking both main project and worktree.

    When a build is running in a worktree, the implementation_plan.json is
    updated there, not in the main project. This function checks both locations
    and returns the most up-to-date plan.

    Args:
        spec_path: Path to the spec directory in the main project
        project_path: Path to the project root
        spec_folder: The spec folder name (e.g., "001-feature-name")

    Returns:
        Tuple of (plan_dict, subtasks_list)
    """
    func_name = "load_plan_from_spec"
    timestamp = datetime.utcnow().isoformat()

    # Always log at INFO level for key operations (helps with Docker debugging)
    logger.info(
        f"📂 [{func_name}] START at {timestamp}\n"
        f"   spec_path={spec_path}\n"
        f"   project_path={project_path}\n"
        f"   spec_folder={spec_folder}"
    )

    plan = None
    subtasks = []

    # Check spec_path validity
    log_path_check(
        func_name, spec_path, spec_path.exists() if spec_path else False, "spec_path"
    )

    if spec_path and spec_path.exists():
        try:
            contents = list(spec_path.iterdir()) if spec_path.is_dir() else []
            logger.info(
                f"📂 [{func_name}] spec_path contents: {[f.name for f in contents]}"
            )
        except Exception as e:
            logger.error(f"📂 [{func_name}] Error listing spec_path: {e}")

    # First, check for worktree (has most up-to-date data when build is running)
    try:
        worktree_path = get_existing_build_worktree(project_path, spec_folder)
        log_worktree_info(func_name, project_path, spec_folder, worktree_path)
    except Exception as e:
        logger.error(f"📂 [{func_name}] Error getting worktree: {e}")
        worktree_path = None

    worktree_plan_file = None
    if worktree_path:
        worktree_spec_dir = worktree_path / ".auto-claude" / "specs" / spec_folder
        worktree_plan_file = worktree_spec_dir / "implementation_plan.json"
        log_path_check(
            func_name,
            worktree_spec_dir,
            worktree_spec_dir.exists(),
            "worktree_spec_dir",
        )
        log_path_check(
            func_name,
            worktree_plan_file,
            worktree_plan_file.exists(),
            "worktree_plan_file",
        )

        # Log worktree spec dir contents
        if worktree_spec_dir.exists():
            try:
                wt_contents = list(worktree_spec_dir.iterdir())
                logger.info(
                    f"📂 [{func_name}] worktree_spec_dir contents: {[f.name for f in wt_contents]}"
                )
            except Exception as e:
                logger.error(f"📂 [{func_name}] Error listing worktree_spec_dir: {e}")

    # Check main project spec directory
    main_plan_file = spec_path / "implementation_plan.json"
    log_path_check(func_name, main_plan_file, main_plan_file.exists(), "main_plan_file")

    # Determine which plan file to use (prefer worktree if it exists and is newer)
    plan_file = None
    source = None

    if worktree_plan_file and worktree_plan_file.exists():
        if main_plan_file.exists():
            # Use the newer one
            wt_mtime = worktree_plan_file.stat().st_mtime
            main_mtime = main_plan_file.stat().st_mtime
            wt_time_str = datetime.fromtimestamp(wt_mtime).isoformat()
            main_time_str = datetime.fromtimestamp(main_mtime).isoformat()
            logger.info(
                f"📂 [{func_name}] Comparing plan mtimes:\n"
                f"   worktree: {wt_time_str} ({wt_mtime})\n"
                f"   main: {main_time_str} ({main_mtime})"
            )
            if wt_mtime > main_mtime:
                plan_file = worktree_plan_file
                source = "worktree (newer)"
            else:
                plan_file = main_plan_file
                source = "main (newer)"
        else:
            plan_file = worktree_plan_file
            source = "worktree (main doesn't exist)"
    elif main_plan_file.exists():
        plan_file = main_plan_file
        source = "main (no worktree)"
    else:
        # No plan file found - dump diagnostic info for debugging
        logger.warning(
            f"📂 [{func_name}] ⚠️ NO PLAN FILE FOUND!\n"
            f"   spec_folder: {spec_folder}\n"
            f"   main_plan_file: {main_plan_file} (exists={main_plan_file.exists()})\n"
            f"   worktree_plan_file: {worktree_plan_file} (exists={worktree_plan_file.exists() if worktree_plan_file else 'N/A'})\n"
            f"   worktree_path: {worktree_path}"
        )
        # Dump full diagnostic info
        dump_diagnostic_info(func_name, project_path, spec_folder, spec_path)

    if source:
        logger.info(f"📂 [{func_name}] Selected plan source: {source}")

    if plan_file and plan_file.exists():
        try:
            logger.info(f"📂 [{func_name}] Reading plan from: {plan_file}")
            plan_content = plan_file.read_text()
            logger.info(f"📂 [{func_name}] Plan file size: {len(plan_content)} bytes")
            plan = json.loads(plan_content)

            # Log plan structure for debugging
            logger.info(
                f"📂 [{func_name}] Plan structure:\n"
                f"   phases: {len(plan.get('phases', []))}\n"
                f"   status: {plan.get('status', 'N/A')}\n"
                f"   has_qa_signoff: {'qa_signoff' in plan}"
            )

            # Use helper function that handles both nested and flat formats
            all_subtasks = get_all_subtasks(plan)
            logger.info(f"📂 [{func_name}] Found {len(all_subtasks)} subtasks")

            # Log subtask summary
            status_counts = {}
            for subtask in all_subtasks:
                status = subtask.get("status", "pending")
                status_counts[status] = status_counts.get(status, 0) + 1
                subtasks.append(
                    {
                        "id": subtask.get("id", ""),
                        "title": subtask.get("description", subtask.get("title", "")),
                        "description": subtask.get("description", ""),
                        "status": status,
                        "files": subtask.get(
                            "files", subtask.get("files_to_modify", [])
                        ),
                    }
                )

            logger.info(f"📂 [{func_name}] Subtask status counts: {status_counts}")
            log_file_operation("read", plan_file, True, f"{len(all_subtasks)} subtasks")

        except json.JSONDecodeError as e:
            logger.error(f"📂 [{func_name}] JSON parse error in plan file: {e}")
            log_file_operation("read", plan_file, False, f"JSON error: {e}")
        except Exception as e:
            logger.error(f"📂 [{func_name}] Error reading plan: {e}", exc_info=True)
            log_file_operation("read", plan_file, False, str(e))

    log_plan_state(func_name, spec_folder, plan is not None, len(subtasks), source)
    logger.info(
        f"📂 [{func_name}] END - returning plan={plan is not None}, subtasks={len(subtasks)}"
    )

    return plan, subtasks


def load_task_logs_from_spec(
    spec_path: Path,
    project_path: Path,
    spec_folder: str,
) -> dict | None:
    """
    Load task_logs.json from spec, checking both main project and worktree.

    Args:
        spec_path: Path to the spec directory in the main project
        project_path: Path to the project root
        spec_folder: The spec folder name

    Returns:
        The task_logs dict or None
    """
    # Import here to avoid circular imports
    from workspace import get_existing_build_worktree

    func_name = "load_task_logs_from_spec"
    timestamp = datetime.utcnow().isoformat()

    logger.info(
        f"📝 [{func_name}] START at {timestamp}\n"
        f"   spec_path={spec_path}\n"
        f"   project_path={project_path}\n"
        f"   spec_folder={spec_folder}"
    )

    # First, check for worktree (has most up-to-date data when build is running)
    try:
        worktree_path = get_existing_build_worktree(project_path, spec_folder)
        log_worktree_info(func_name, project_path, spec_folder, worktree_path)
    except Exception as e:
        logger.error(f"📝 [{func_name}] Error getting worktree: {e}")
        worktree_path = None

    worktree_logs_file = None
    if worktree_path:
        worktree_spec_dir = worktree_path / ".auto-claude" / "specs" / spec_folder
        worktree_logs_file = worktree_spec_dir / "task_logs.json"
        log_path_check(
            func_name,
            worktree_logs_file,
            worktree_logs_file.exists(),
            "worktree_logs_file",
        )

    # Check main project spec directory
    main_logs_file = spec_path / "task_logs.json"
    log_path_check(func_name, main_logs_file, main_logs_file.exists(), "main_logs_file")

    # Determine which file to use (prefer worktree if it exists and is newer)
    logs_file = None
    source = None

    if worktree_logs_file and worktree_logs_file.exists():
        if main_logs_file.exists():
            # Use the newer one
            wt_mtime = worktree_logs_file.stat().st_mtime
            main_mtime = main_logs_file.stat().st_mtime
            if wt_mtime > main_mtime:
                logs_file = worktree_logs_file
                source = "worktree (newer)"
            else:
                logs_file = main_logs_file
                source = "main (newer)"
        else:
            logs_file = worktree_logs_file
            source = "worktree (main doesn't exist)"
    elif main_logs_file.exists():
        logs_file = main_logs_file
        source = "main (no worktree)"
    else:
        logger.info(f"📝 [{func_name}] No task_logs.json found")

    if source:
        logger.info(f"📝 [{func_name}] Selected logs source: {source}")

    if logs_file and logs_file.exists():
        try:
            logger.info(f"📝 [{func_name}] Reading logs from: {logs_file}")
            content = logs_file.read_text()
            logs = json.loads(content)

            # Log phases summary
            phases = logs.get("phases", {})
            phases_summary = {p: phases[p].get("status", "unknown") for p in phases}
            logger.info(f"📝 [{func_name}] Phases: {phases_summary}")
            log_file_operation(
                "read", logs_file, True, f"phases: {list(phases.keys())}"
            )

            return logs
        except json.JSONDecodeError as e:
            logger.error(f"📝 [{func_name}] JSON parse error: {e}")
            log_file_operation("read", logs_file, False, f"JSON error: {e}")
        except Exception as e:
            logger.error(f"📝 [{func_name}] Error reading logs: {e}", exc_info=True)
            log_file_operation("read", logs_file, False, str(e))

    logger.info(f"📝 [{func_name}] END - returning None")
    return None

"""
Subtask Management Tools
========================

Tools for managing subtask status in implementation_plan.json.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.file_utils import write_json_atomic
from spec.validate_pkg.auto_fix import auto_fix_plan

try:
    from claude_agent_sdk import tool

    SDK_TOOLS_AVAILABLE = True
except ImportError:
    SDK_TOOLS_AVAILABLE = False
    tool = None


def _update_subtask_in_plan(
    plan: dict[str, Any],
    subtask_id: str,
    status: str,
    notes: str,
) -> bool:
    """
    Update a subtask in the plan.

    Args:
        plan: The implementation plan dict
        subtask_id: ID of the subtask to update
        status: New status (pending, in_progress, completed, failed)
        notes: Optional notes to add

    Returns:
        True if subtask was found and updated, False otherwise
    """
    subtask_found = False
    for phase in plan.get("phases", []):
        for subtask in phase.get("subtasks", []):
            if subtask.get("id") == subtask_id:
                subtask["status"] = status
                if notes:
                    subtask["notes"] = notes
                subtask["updated_at"] = datetime.now(timezone.utc).isoformat()
                subtask_found = True
                break
        if subtask_found:
            break

    if subtask_found:
        plan["last_updated"] = datetime.now(timezone.utc).isoformat()

    return subtask_found


def create_subtask_tools(spec_dir: Path, project_dir: Path) -> list:
    """
    Create subtask management tools.

    Args:
        spec_dir: Path to the spec directory
        project_dir: Path to the project root

    Returns:
        List of subtask tool functions
    """
    if not SDK_TOOLS_AVAILABLE:
        return []

    tools = []

    # -------------------------------------------------------------------------
    # Tool: update_subtask_status
    # -------------------------------------------------------------------------
    @tool(
        "update_subtask_status",
        "Update the status of a subtask in implementation_plan.json. Use this when completing or starting a subtask.",
        {"subtask_id": str, "status": str, "notes": str},
    )
    async def update_subtask_status(args: dict[str, Any]) -> dict[str, Any]:
        """Update subtask status in the implementation plan."""
        subtask_id = args["subtask_id"]
        status = args["status"]
        notes = args.get("notes", "")

        valid_statuses = ["pending", "in_progress", "completed", "failed"]
        if status not in valid_statuses:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Error: Invalid status '{status}'. Must be one of: {valid_statuses}",
                    }
                ]
            }

        plan_file = spec_dir / "implementation_plan.json"
        if not plan_file.exists():
            return {
                "content": [
                    {
                        "type": "text",
                        "text": "Error: implementation_plan.json not found",
                    }
                ]
            }

        try:
            with open(plan_file, encoding="utf-8") as f:
                plan = json.load(f)

            subtask_found = _update_subtask_in_plan(plan, subtask_id, status, notes)

            if not subtask_found:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Error: Subtask '{subtask_id}' not found in implementation plan",
                        }
                    ]
                }

            # Use atomic write to prevent file corruption
            write_json_atomic(plan_file, plan, indent=2)

            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Successfully updated subtask '{subtask_id}' to status '{status}'",
                    }
                ]
            }

        except json.JSONDecodeError as e:
            # Attempt to auto-fix the plan and retry
            if auto_fix_plan(spec_dir):
                # Retry after fix
                try:
                    with open(plan_file, encoding="utf-8") as f:
                        plan = json.load(f)

                    subtask_found = _update_subtask_in_plan(
                        plan, subtask_id, status, notes
                    )

                    if subtask_found:
                        write_json_atomic(plan_file, plan, indent=2)
                        return {
                            "content": [
                                {
                                    "type": "text",
                                    "text": f"Successfully updated subtask '{subtask_id}' to status '{status}' (after auto-fix)",
                                }
                            ]
                        }
                    else:
                        return {
                            "content": [
                                {
                                    "type": "text",
                                    "text": f"Error: Subtask '{subtask_id}' not found in implementation plan (after auto-fix)",
                                }
                            ]
                        }
                except Exception as retry_err:
                    logging.warning(
                        f"Subtask update retry failed after auto-fix: {retry_err}"
                    )
                    return {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Error: Subtask update failed after auto-fix: {retry_err}",
                            }
                        ]
                    }

            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Error: Invalid JSON in implementation_plan.json: {e}",
                    }
                ]
            }
        except Exception as e:
            return {
                "content": [
                    {"type": "text", "text": f"Error updating subtask status: {e}"}
                ]
            }

    tools.append(update_subtask_status)

    return tools

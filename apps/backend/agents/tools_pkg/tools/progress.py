"""
Build Progress Tools
====================

Tools for tracking and reporting build progress.
"""

import json
from pathlib import Path
from typing import Any

try:
    from claude_agent_sdk import tool

    SDK_TOOLS_AVAILABLE = True
except ImportError:
    SDK_TOOLS_AVAILABLE = False
    tool = None


def create_progress_tools(spec_dir: Path, project_dir: Path) -> list:
    """
    Create build progress tracking tools.

    Args:
        spec_dir: Path to the spec directory
        project_dir: Path to the project root

    Returns:
        List of progress tool functions
    """
    if not SDK_TOOLS_AVAILABLE:
        return []

    tools = []

    # -------------------------------------------------------------------------
    # Tool: get_build_progress
    # -------------------------------------------------------------------------
    @tool(
        "get_build_progress",
        "Get the current build progress including completed subtasks, pending subtasks, and next subtask to work on.",
        {},
    )
    async def get_build_progress(args: dict[str, Any]) -> dict[str, Any]:
        """Get current build progress."""
        plan_file = spec_dir / "implementation_plan.json"

        if not plan_file.exists():
            return {
                "content": [
                    {
                        "type": "text",
                        "text": "No implementation plan found. Run the planner first.",
                    }
                ]
            }

        try:
            with open(plan_file, encoding="utf-8") as f:
                plan = json.load(f)

            stats = {
                "total": 0,
                "completed": 0,
                "in_progress": 0,
                "pending": 0,
                "failed": 0,
            }

            phases_summary = []
            next_subtask = None

            for phase in plan.get("phases", []):
                phase_id = phase.get("id") or phase.get("phase")
                phase_name = phase.get("name", phase_id)
                phase_subtasks = phase.get("subtasks", [])

                phase_stats = {"completed": 0, "total": len(phase_subtasks)}

                for subtask in phase_subtasks:
                    stats["total"] += 1
                    status = subtask.get("status", "pending")

                    if status == "completed":
                        stats["completed"] += 1
                        phase_stats["completed"] += 1
                    elif status == "in_progress":
                        stats["in_progress"] += 1
                    elif status == "failed":
                        stats["failed"] += 1
                    else:
                        stats["pending"] += 1
                        # Track next subtask to work on
                        if next_subtask is None:
                            next_subtask = {
                                "id": subtask.get("id"),
                                "description": subtask.get("description"),
                                "phase": phase_name,
                            }

                phases_summary.append(
                    f"  {phase_name}: {phase_stats['completed']}/{phase_stats['total']}"
                )

            progress_pct = (
                (stats["completed"] / stats["total"] * 100) if stats["total"] > 0 else 0
            )

            result = f"""Build Progress: {stats["completed"]}/{stats["total"]} subtasks ({progress_pct:.0f}%)

Status breakdown:
  Completed: {stats["completed"]}
  In Progress: {stats["in_progress"]}
  Pending: {stats["pending"]}
  Failed: {stats["failed"]}

Phases:
{chr(10).join(phases_summary)}"""

            if next_subtask:
                result += f"""

Next subtask to work on:
  ID: {next_subtask["id"]}
  Phase: {next_subtask["phase"]}
  Description: {next_subtask["description"]}"""
            elif stats["completed"] == stats["total"]:
                result += "\n\nAll subtasks completed! Build is ready for QA."

            return {"content": [{"type": "text", "text": result}]}

        except Exception as e:
            return {
                "content": [
                    {"type": "text", "text": f"Error reading build progress: {e}"}
                ]
            }

    tools.append(get_build_progress)

    return tools

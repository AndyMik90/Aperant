"""
QA Management Tools
===================

Tools for managing QA status and sign-off in implementation_plan.json.
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


def _apply_qa_update(
    plan: dict[str, Any],
    status: str,
    issues: list[Any],
    tests_passed: dict[str, Any],
) -> int:
    """
    Apply QA update to the plan and return the new QA session number.

    Args:
        plan: The implementation plan dict
        status: QA status (pending, in_review, approved, rejected, fixes_applied)
        issues: List of issues found
        tests_passed: Dict of test results

    Returns:
        The new QA session number
    """
    # Get current QA session number
    current_qa = plan.get("qa_signoff", {})
    qa_session = current_qa.get("qa_session", 0)
    if status in ["in_review", "rejected"]:
        qa_session += 1

    plan["qa_signoff"] = {
        "status": status,
        "qa_session": qa_session,
        "issues_found": issues,
        "tests_passed": tests_passed,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ready_for_qa_revalidation": status == "fixes_applied",
    }

    # NOTE: Do NOT write plan["status"] or plan["planStatus"] here.
    # The frontend XState task state machine owns status transitions.
    # Writing status here races with XState's persistPlanStatusAndReasonSync()
    # and can clobber the reviewReason field, causing tasks to appear "incomplete".

    plan["last_updated"] = datetime.now(timezone.utc).isoformat()

    return qa_session


def create_qa_tools(spec_dir: Path, project_dir: Path) -> list:
    """
    Create QA management tools.

    Args:
        spec_dir: Path to the spec directory
        project_dir: Path to the project root

    Returns:
        List of QA tool functions
    """
    if not SDK_TOOLS_AVAILABLE:
        return []

    tools = []

    # -------------------------------------------------------------------------
    # Tool: update_qa_status
    # -------------------------------------------------------------------------
    @tool(
        "update_qa_status",
        "Update the QA sign-off status in implementation_plan.json. Use after QA review.",
        {"status": str, "issues": str, "tests_passed": str},
    )
    async def update_qa_status(args: dict[str, Any]) -> dict[str, Any]:
        """Update QA status in the implementation plan."""
        status = args["status"]
        issues_str = args.get("issues", "[]")
        tests_str = args.get("tests_passed", "{}")

        valid_statuses = [
            "pending",
            "in_review",
            "approved",
            "rejected",
            "fixes_applied",
        ]
        if status not in valid_statuses:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Error: Invalid QA status '{status}'. Must be one of: {valid_statuses}",
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
            # Parse issues and tests
            try:
                issues = json.loads(issues_str) if issues_str else []
            except json.JSONDecodeError:
                issues = [{"description": issues_str}] if issues_str else []

            try:
                tests_passed = json.loads(tests_str) if tests_str else {}
            except json.JSONDecodeError:
                tests_passed = {}

            with open(plan_file, encoding="utf-8") as f:
                plan = json.load(f)

            qa_session = _apply_qa_update(plan, status, issues, tests_passed)

            # Use atomic write to prevent file corruption
            write_json_atomic(plan_file, plan, indent=2)

            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Updated QA status to '{status}' (session {qa_session})",
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

                    qa_session = _apply_qa_update(plan, status, issues, tests_passed)
                    write_json_atomic(plan_file, plan, indent=2)

                    return {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Updated QA status to '{status}' (session {qa_session}) (after auto-fix)",
                            }
                        ]
                    }
                except Exception as retry_err:
                    logging.warning(
                        f"QA update retry failed after auto-fix: {retry_err} (original error: {e})"
                    )
                    return {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Error: QA update failed after auto-fix: {retry_err} (original JSON error: {e})",
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
                "content": [{"type": "text", "text": f"Error updating QA status: {e}"}]
            }

    tools.append(update_qa_status)

    return tools

"""
Auto-Fix Utilities
==================

Automated fixes for common implementation plan issues.
"""

import json
import logging
import re
from pathlib import Path

from core.file_utils import write_json_atomic
from core.plan_normalization import normalize_subtask_aliases


def _repair_json_syntax(content: str) -> str | None:
    """
    Attempt to repair common JSON syntax errors.

    Args:
        content: Raw JSON string that failed to parse

    Returns:
        Repaired JSON string if successful, None if repair failed
    """
    if not content or not content.strip():
        return None

    # Defensive limit on input size to prevent processing extremely large malformed files.
    # Implementation plans are typically <100KB; 1MB provides ample headroom.
    max_content_size = 1024 * 1024  # 1 MB
    if len(content) > max_content_size:
        logging.warning(
            f"JSON repair skipped: content size {len(content)} exceeds limit {max_content_size}"
        )
        return None

    repaired = content

    # Remove trailing commas before closing brackets/braces
    # Match: comma followed by optional whitespace and closing bracket/brace
    repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)

    # Strip string contents before counting brackets to avoid counting
    # brackets inside JSON string values (e.g., {"desc": "array[0]"})
    stripped = re.sub(r'"(?:[^"\\]|\\.)*"', '""', repaired)

    # Handle truncated JSON by attempting to close open brackets/braces
    # Use stack-based approach to track bracket order for correct closing
    bracket_stack: list[str] = []
    for char in stripped:
        if char == "{":
            bracket_stack.append("{")
        elif char == "[":
            bracket_stack.append("[")
        elif char == "}":
            if bracket_stack and bracket_stack[-1] == "{":
                bracket_stack.pop()
        elif char == "]":
            if bracket_stack and bracket_stack[-1] == "[":
                bracket_stack.pop()

    if bracket_stack:
        # Try to find a reasonable truncation point and close
        # First, strip any incomplete key-value pair at the end
        # Pattern: trailing incomplete string or number after last complete element
        repaired = re.sub(r',\s*"(?:[^"\\]|\\.)*$', "", repaired)  # Incomplete key
        repaired = re.sub(r",\s*$", "", repaired)  # Trailing comma
        repaired = re.sub(
            r':\s*"(?:[^"\\]|\\.)*$', ': ""', repaired
        )  # Incomplete string value
        repaired = re.sub(r":\s*[0-9.]+$", ": 0", repaired)  # Incomplete number

        # Close remaining open brackets in reverse order (stack-based)
        repaired = repaired.rstrip()
        for bracket in reversed(bracket_stack):
            if bracket == "{":
                repaired += "}"
            elif bracket == "[":
                repaired += "]"

    # Fix unquoted string values (common LLM error)
    # Match: quoted key followed by colon and unquoted word
    # Require a quoted key to avoid matching inside string values
    # (e.g., {"description": "status: pending review"} should not be modified)
    repaired = re.sub(
        r'("[^"]+"\s*):\s*(pending|in_progress|completed|failed|done|backlog)\s*([,}\]])',
        r'\1: "\2"\3',
        repaired,
    )

    # Try to parse the repaired JSON
    try:
        json.loads(repaired)
        return repaired
    except json.JSONDecodeError:
        return None


def _normalize_status(value: object) -> str:
    """Normalize common status variants to schema-compliant values."""
    if not isinstance(value, str):
        return "pending"

    normalized = value.strip().lower()
    if normalized in {"pending", "in_progress", "completed", "blocked", "failed"}:
        return normalized

    # Common non-standard variants produced by LLMs or legacy tooling
    if normalized in {"not_started", "not started", "todo", "to_do", "backlog"}:
        return "pending"
    if normalized in {"in-progress", "inprogress", "working"}:
        return "in_progress"
    if normalized in {"done", "complete", "completed_successfully"}:
        return "completed"

    # Unknown values fall back to pending to prevent deadlocks in execution
    return "pending"


def auto_fix_plan(spec_dir: Path) -> bool:
    """Attempt to auto-fix common implementation_plan.json issues.

    This function handles both structural issues (missing fields, wrong types)
    and syntax issues (trailing commas, truncated JSON).

    Args:
        spec_dir: Path to the spec directory

    Returns:
        True if fixes were applied, False otherwise
    """
    plan_file = spec_dir / "implementation_plan.json"

    if not plan_file.exists():
        return False

    plan = None
    json_repaired = False

    try:
        with open(plan_file, encoding="utf-8") as f:
            content = f.read()
        plan = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        # Attempt JSON syntax repair
        try:
            with open(plan_file, encoding="utf-8") as f:
                content = f.read()
            repaired = _repair_json_syntax(content)
            if repaired:
                plan = json.loads(repaired)
                json_repaired = True
                logging.info(f"JSON syntax repaired: {plan_file}")
        except Exception as e:
            logging.warning(f"JSON repair attempt failed for {plan_file}: {e}")
    except OSError:
        return False

    if plan is None:
        return False

    fixed = False

    # Support older/simple plans that use top-level "subtasks" (or "chunks")
    if "phases" not in plan and (
        isinstance(plan.get("subtasks"), list) or isinstance(plan.get("chunks"), list)
    ):
        subtasks = plan.get("subtasks") or plan.get("chunks") or []
        plan["phases"] = [
            {
                "id": "1",
                "phase": 1,
                "name": "Phase 1",
                "subtasks": subtasks,
            }
        ]
        plan.pop("subtasks", None)
        plan.pop("chunks", None)
        fixed = True

    # Fix missing top-level fields
    if "feature" not in plan:
        plan["feature"] = plan.get("title") or plan.get("spec_id") or "Unnamed Feature"
        fixed = True

    if "workflow_type" not in plan:
        plan["workflow_type"] = "feature"
        fixed = True

    if "phases" not in plan:
        plan["phases"] = []
        fixed = True

    # Fix phases
    for i, phase in enumerate(plan.get("phases", [])):
        # Normalize common phase field aliases
        if "name" not in phase and "title" in phase:
            phase["name"] = phase.get("title")
            fixed = True

        if "phase" not in phase and "phase_id" in phase:
            phase_id = phase.get("phase_id")
            phase_id_str = str(phase_id).strip() if phase_id is not None else ""
            phase_num: int | None = None
            if isinstance(phase_id, int) and not isinstance(phase_id, bool):
                phase_num = phase_id
            elif (
                isinstance(phase_id, float)
                and not isinstance(phase_id, bool)
                and phase_id.is_integer()
            ):
                phase_num = int(phase_id)
            elif isinstance(phase_id, str) and phase_id_str.isdigit():
                phase_num = int(phase_id_str)

            if phase_num is not None:
                if "id" not in phase:
                    phase["id"] = str(phase_num)
                    fixed = True
                phase["phase"] = phase_num
                fixed = True
            elif "id" not in phase and phase_id is not None:
                phase["id"] = phase_id_str
                fixed = True

        if "phase" not in phase:
            phase["phase"] = i + 1
            fixed = True

        depends_on_raw = phase.get("depends_on", [])
        if isinstance(depends_on_raw, list):
            normalized_depends_on = [
                str(d).strip() for d in depends_on_raw if d is not None
            ]
        elif depends_on_raw is None:
            normalized_depends_on = []
        else:
            normalized_depends_on = [str(depends_on_raw).strip()]
        if normalized_depends_on != depends_on_raw:
            phase["depends_on"] = normalized_depends_on
            fixed = True

        if "name" not in phase:
            phase["name"] = f"Phase {i + 1}"
            fixed = True

        if "subtasks" not in phase:
            phase["subtasks"] = phase.get("chunks", [])
            fixed = True
        elif "chunks" in phase and not phase.get("subtasks"):
            # If subtasks exists but is empty, fall back to chunks if present
            phase["subtasks"] = phase.get("chunks", [])
            fixed = True

        # Fix subtasks
        for j, subtask in enumerate(phase.get("subtasks", [])):
            normalized, changed = normalize_subtask_aliases(subtask)
            if changed:
                subtask.update(normalized)
                fixed = True

            if "id" not in subtask:
                subtask["id"] = f"subtask-{i + 1}-{j + 1}"
                fixed = True

            if "description" not in subtask:
                subtask["description"] = "No description"
                fixed = True

            if "status" not in subtask:
                subtask["status"] = "pending"
                fixed = True
            else:
                normalized_status = _normalize_status(subtask.get("status"))
                if subtask.get("status") != normalized_status:
                    subtask["status"] = normalized_status
                    fixed = True

    if fixed or json_repaired:
        try:
            # Use atomic write to prevent file corruption if interrupted
            write_json_atomic(plan_file, plan, indent=2, ensure_ascii=False)
        except OSError:
            return False
        if fixed:
            logging.info(f"Auto-fixed: {plan_file}")

    return fixed or json_repaired

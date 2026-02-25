"""
Implementation Plan Validator
==============================

Validates implementation_plan.json structure, phases, subtasks, and dependencies.
"""

import json
from pathlib import Path

from ..models import ValidationResult
from ..schemas import IMPLEMENTATION_PLAN_SCHEMA


class ImplementationPlanValidator:
    """Validates implementation_plan.json exists and has valid schema."""

    def __init__(self, spec_dir: Path):
        """Initialize the implementation plan validator.

        Args:
            spec_dir: Path to the spec directory
        """
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        """Validate implementation_plan.json exists and has valid schema.

        Returns:
            ValidationResult with errors, warnings, and suggested fixes
        """
        errors = []
        warnings = []
        fixes = []

        plan_file = self.spec_dir / "implementation_plan.json"

        if not plan_file.exists():
            errors.append("implementation_plan.json not found")
            fixes.append(
                f"Run: python auto-claude/planner.py --spec-dir {self.spec_dir}"
            )
            return ValidationResult(False, "plan", errors, warnings, fixes)

        try:
            with open(plan_file, encoding="utf-8") as f:
                plan = json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"implementation_plan.json is invalid JSON: {e}")
            fixes.append(
                "Regenerate with: python auto-claude/planner.py --spec-dir "
                + str(self.spec_dir)
            )
            return ValidationResult(False, "plan", errors, warnings, fixes)

        # Validate top-level required fields
        schema = IMPLEMENTATION_PLAN_SCHEMA
        for field in schema["required_fields"]:
            if field not in plan:
                errors.append(f"Missing required field: {field}")
                fixes.append(f"Add '{field}' to implementation_plan.json")

        # Validate workflow_type
        if "workflow_type" in plan:
            if plan["workflow_type"] not in schema["workflow_types"]:
                errors.append(f"Invalid workflow_type: {plan['workflow_type']}")
                fixes.append(f"Use one of: {schema['workflow_types']}")

        # Validate phases
        phases = plan.get("phases", [])
        if not phases:
            errors.append("No phases defined")
            fixes.append("Add at least one phase with subtasks")
        else:
            for i, phase in enumerate(phases):
                phase_errors = self._validate_phase(phase, i)
                errors.extend(phase_errors)

        # Check for at least one subtask
        total_subtasks = sum(len(p.get("subtasks", [])) for p in phases)
        if total_subtasks == 0:
            errors.append("No subtasks defined in any phase")
            fixes.append("Add subtasks to phases")

        # Validate dependencies don't create cycles
        dep_errors = self._validate_dependencies(phases)
        errors.extend(dep_errors)

        return ValidationResult(
            valid=len(errors) == 0,
            checkpoint="plan",
            errors=errors,
            warnings=warnings,
            fixes=fixes,
        )

    def _validate_phase(self, phase: dict, index: int) -> list[str]:
        """Validate a single phase.

        Supports both legacy format (using 'phase' number) and new format (using 'id' string).

        Args:
            phase: The phase dictionary to validate
            index: The index of the phase in the phases list

        Returns:
            List of error messages
        """
        errors = []
        schema = IMPLEMENTATION_PLAN_SCHEMA["phase_schema"]

        # Check required fields
        for field in schema["required_fields"]:
            if field not in phase:
                errors.append(f"Phase {index + 1}: missing required field '{field}'")

        # Check either-or required fields (must have at least one from each group)
        for field_group in schema.get("required_fields_either", []):
            if not any(f in phase for f in field_group):
                errors.append(
                    f"Phase {index + 1}: missing required field (need one of: {', '.join(field_group)})"
                )

        if "type" in phase and phase["type"] not in schema["phase_types"]:
            errors.append(f"Phase {index + 1}: invalid type '{phase['type']}'")

        # Validate subtasks
        subtasks = phase.get("subtasks", [])
        for j, subtask in enumerate(subtasks):
            subtask_errors = self._validate_subtask(subtask, index, j)
            errors.extend(subtask_errors)

        return errors

    def _validate_subtask(
        self, subtask: dict, phase_idx: int, subtask_idx: int
    ) -> list[str]:
        """Validate a single subtask.

        Args:
            subtask: The subtask dictionary to validate
            phase_idx: The index of the parent phase
            subtask_idx: The index of the subtask within the phase

        Returns:
            List of error messages
        """
        errors = []
        schema = IMPLEMENTATION_PLAN_SCHEMA["subtask_schema"]

        for field in schema["required_fields"]:
            if field not in subtask:
                errors.append(
                    f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: missing required field '{field}'"
                )

        if "status" in subtask and subtask["status"] not in schema["status_values"]:
            errors.append(
                f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: invalid status '{subtask['status']}'"
            )

        # Validate verification if present
        if "verification" in subtask:
            ver = subtask["verification"]
            ver_schema = IMPLEMENTATION_PLAN_SCHEMA["verification_schema"]

            if "type" not in ver:
                errors.append(
                    f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: verification missing 'type'"
                )
            elif ver["type"] not in ver_schema["verification_types"]:
                errors.append(
                    f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: invalid verification type '{ver['type']}'"
                )

        return errors

    def _validate_dependencies(self, phases: list[dict]) -> list[str]:
        """Check for circular dependencies.

        Supports both legacy numeric phase IDs and new string-based phase IDs.

        Args:
            phases: List of phase dictionaries

        Returns:
            List of error messages for invalid dependencies
        """
        errors = []

        # Build a map of phase identifiers (supports both "id" and "phase" fields)
        # and track their position/order for cycle detection
        phase_ids = set()
        phase_order = {}  # Maps phase id -> position index

        for i, p in enumerate(phases):
            # Support both "id" field (new format) and "phase" field (legacy format)
            phase_id = p.get("id") or p.get("phase", i + 1)
            phase_ids.add(phase_id)
            phase_order[phase_id] = i

        for i, phase in enumerate(phases):
            phase_id = phase.get("id") or phase.get("phase", i + 1)
            depends_on = phase.get("depends_on", [])

            for dep in depends_on:
                if dep not in phase_ids:
                    errors.append(
                        f"Phase {phase_id}: depends on non-existent phase {dep}"
                    )
                # Check for forward references (cycles) by comparing positions
                elif phase_order.get(dep, -1) >= i:
                    errors.append(
                        f"Phase {phase_id}: cannot depend on phase {dep} (would create cycle)"
                    )

        return errors

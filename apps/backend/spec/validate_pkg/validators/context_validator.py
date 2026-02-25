"""
Context Validator
=================

Validates context.json structure and required fields.
"""

import json
from pathlib import Path

from ..models import ValidationResult
from ..schemas import CONTEXT_SCHEMA


class ContextValidator:
    """Validates context.json exists and has required structure."""

    def __init__(self, spec_dir: Path):
        """Initialize the context validator.

        Args:
            spec_dir: Path to the spec directory
        """
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        """Validate context.json exists and has required structure.

        Returns:
            ValidationResult with errors, warnings, and suggested fixes
        """
        errors = []
        warnings = []
        fixes = []

        context_file = self.spec_dir / "context.json"

        if not context_file.exists():
            errors.append("context.json not found")
            fixes.append(
                "Run: python auto-claude/context.py --task '[task]' --services '[services]' --output context.json"
            )
            return ValidationResult(False, "context", errors, warnings, fixes)

        try:
            with open(context_file, encoding="utf-8") as f:
                context = json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"context.json is invalid JSON: {e}")
            fixes.append("Regenerate context.json or fix JSON syntax")
            return ValidationResult(False, "context", errors, warnings, fixes)

        # Check required fields
        for field in CONTEXT_SCHEMA["required_fields"]:
            if field not in context:
                errors.append(f"Missing required field: {field}")
                fixes.append(f"Add '{field}' to context.json")

        # Check optional but recommended fields
        recommended = ["files_to_modify", "files_to_reference", "scoped_services"]
        for field in recommended:
            if field not in context or not context[field]:
                warnings.append(f"Missing recommended field: {field}")

        return ValidationResult(
            valid=len(errors) == 0,
            checkpoint="context",
            errors=errors,
            warnings=warnings,
            fixes=fixes,
        )

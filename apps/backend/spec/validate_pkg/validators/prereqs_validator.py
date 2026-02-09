"""
Prerequisites Validator
========================

Validates that required prerequisites exist before spec creation.
"""

from pathlib import Path

from ..models import ValidationResult


class PrereqsValidator:
    """Validates prerequisites exist."""

    def __init__(self, spec_dir: Path):
        """Initialize the prerequisites validator.

        Args:
            spec_dir: Path to the spec directory
        """
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        """Validate prerequisites exist.

        Returns:
            ValidationResult with errors, warnings, and suggested fixes
        """
        errors = []
        warnings = []
        fixes = []

        # Check spec directory exists
        if not self.spec_dir.exists():
            errors.append(f"Spec directory does not exist: {self.spec_dir}")
            fixes.append(f"Create directory: mkdir -p {self.spec_dir}")
            return ValidationResult(False, "prereqs", errors, warnings, fixes)

        # Check project_index.json
        project_index = self.spec_dir / "project_index.json"
        if not project_index.exists():
            # Check if it exists at ac-jerry level
            auto_build_index = self.spec_dir.parent.parent / "project_index.json"
            if auto_build_index.exists():
                warnings.append(
                    "project_index.json exists at ac-jerry/ but not in spec folder"
                )
                fixes.append(f"Copy: cp {auto_build_index} {project_index}")
            else:
                errors.append("project_index.json not found")
                fixes.append(
                    "Run: python ac-jerry/analyzer.py --output ac-jerry/project_index.json"
                )

        return ValidationResult(
            valid=len(errors) == 0,
            checkpoint="prereqs",
            errors=errors,
            warnings=warnings,
            fixes=fixes,
        )

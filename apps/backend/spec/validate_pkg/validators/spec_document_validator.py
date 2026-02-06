"""
Spec Document Validator
========================

Validates spec.md document structure and required sections.
"""

import re
from pathlib import Path

from ..models import ValidationResult
from ..schemas import SPEC_RECOMMENDED_SECTIONS, SPEC_REQUIRED_SECTIONS


class SpecDocumentValidator:
    """Validates spec.md exists and has required sections."""

    def __init__(self, spec_dir: Path):
        """Initialize the spec document validator.

        Args:
            spec_dir: Path to the spec directory
        """
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        """Validate spec.md exists and has required sections.

        Returns:
            ValidationResult with errors, warnings, and suggested fixes
        """
        errors = []
        warnings = []
        fixes = []

        spec_file = self.spec_dir / "spec.md"

        if not spec_file.exists():
            errors.append("spec.md not found")
            fixes.append("Create spec.md with required sections")
            return ValidationResult(False, "spec", errors, warnings, fixes)

        content = spec_file.read_text(encoding="utf-8")

        # Check for required sections
        for section in SPEC_REQUIRED_SECTIONS:
            # Look for ## Section or # Section
            pattern = rf"^##?\s+{re.escape(section)}"
            if not re.search(pattern, content, re.MULTILINE | re.IGNORECASE):
                errors.append(f"Missing required section: '{section}'")
                fixes.append(f"Add '## {section}' section to spec.md")

        # Check for recommended sections
        for section in SPEC_RECOMMENDED_SECTIONS:
            pattern = rf"^##?\s+{re.escape(section)}"
            if not re.search(pattern, content, re.MULTILINE | re.IGNORECASE):
                warnings.append(f"Missing recommended section: '{section}'")

        # Check minimum content length
        if len(content) < 500:
            warnings.append("spec.md seems too short (< 500 chars)")

        return ValidationResult(
            valid=len(errors) == 0,
            checkpoint="spec",
            errors=errors,
            warnings=warnings,
            fixes=fixes,
        )

#!/usr/bin/env python3
"""
Tests for spec/validate_pkg/validators/spec_document_validator.py
=================================================================

Tests for SpecDocumentValidator class covering:
- File existence checks
- Required section validation
- Recommended section warnings
- Content length validation
- ValidationResult return values
"""

from pathlib import Path


class TestSpecDocumentValidatorInit:
    """Tests for SpecDocumentValidator initialization."""

    def test_initialization_with_path(self, spec_dir: Path):
        """SpecDocumentValidator initializes with spec_dir path."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        validator = SpecDocumentValidator(spec_dir)

        assert validator.spec_dir == spec_dir
        assert isinstance(validator.spec_dir, Path)

    def test_converts_string_to_path(self, spec_dir: Path):
        """SpecDocumentValidator converts string path to Path object."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        validator = SpecDocumentValidator(str(spec_dir))

        assert isinstance(validator.spec_dir, Path)
        assert validator.spec_dir == spec_dir


class TestValidateFileNotFound:
    """Tests for validate() when spec.md does not exist."""

    def test_returns_error_when_file_missing(self, spec_dir: Path):
        """Should return ValidationResult with error when spec.md missing."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert result.checkpoint == "spec"
        assert any("not found" in err.lower() or "spec.md" in err.lower() for err in result.errors)

    def test_error_message_includes_filename(self, spec_dir: Path):
        """Error message should mention spec.md."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert "spec.md" in result.errors[0]

    def test_fix_suggests_creation(self, spec_dir: Path):
        """Suggested fix should mention creating spec.md."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert any("create" in fix.lower() for fix in result.fixes)


class TestValidateRequiredSections:
    """Tests for validate() with missing required sections."""

    def test_error_when_overview_missing(self, spec_dir: Path):
        """Should error when required section 'Overview' is missing."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        spec_file.write_text("# Other Section\n\nContent here.\n", encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert any("overview" in err.lower() for err in result.errors)

    def test_error_for_all_required_sections_missing(self, spec_dir: Path):
        """Should list all missing required sections."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator
        from spec.validate_pkg.schemas import SPEC_REQUIRED_SECTIONS

        spec_file = spec_dir / "spec.md"
        spec_file.write_text("# Other\n\nContent.\n", encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Check that all required sections are mentioned in errors
        for section in SPEC_REQUIRED_SECTIONS:
            assert any(section.lower() in err.lower() for err in result.errors), \
                f"Section {section} not in errors"

    def test_accepts_hash_hash_format(self, spec_dir: Path):
        """Should accept ## Section format (double hash)."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview\n\nContent\n\n## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\nScope\n\n## Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True
        assert len(result.errors) == 0

    def test_accepts_single_hash_format(self, spec_dir: Path):
        """Should accept # Section format (single hash)."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "# Overview\n\nContent\n\n# Workflow Type\n\nFeature\n\n"
        content += "# Task Scope\n\nScope\n\n# Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True

    def test_case_insensitive_section_matching(self, spec_dir: Path):
        """Should match sections case-insensitively."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## OVERVIEW\n\nContent\n\n## workflow type\n\nFeature\n\n"
        content += "## task scope\n\nScope\n\n## success criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True

    def test_fixes_suggest_adding_sections(self, spec_dir: Path):
        """Suggested fixes should include adding missing sections."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        spec_file.write_text("# Other\n\nContent.\n", encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Fixes should suggest adding sections
        assert any("##" in fix for fix in result.fixes)


class TestValidateRecommendedSections:
    """Tests for validate() with recommended sections."""

    def test_warns_when_files_to_modify_missing(self, spec_dir: Path):
        """Should warn when 'Files to Modify' section is missing."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview\n\nContent\n\n## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\nScope\n\n## Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Missing recommended section should be a warning, not error
        assert any("files to modify" in warn.lower() for warn in result.warnings)

    def test_warns_for_multiple_missing_recommended(self, spec_dir: Path):
        """Should warn for all missing recommended sections."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview\n\nContent\n\n## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\nScope\n\n## Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Should have warnings for missing recommended sections
        assert len(result.warnings) > 0

    def test_no_warnings_with_all_recommended(self, spec_dir: Path):
        """Should not warn when all recommended sections present."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator
        from spec.validate_pkg.schemas import SPEC_RECOMMENDED_SECTIONS

        spec_file = spec_dir / "spec.md"
        content = "## Overview\n\nThis is a comprehensive overview of the feature that we are building.\n\n"
        content += "## Workflow Type\n\nFeature implementation workflow with multiple phases.\n\n"
        content += "## Task Scope\n\nThe scope includes backend API changes and database updates.\n\n"
        content += "## Success Criteria\n\nAll tests pass and the feature works as expected.\n\n"

        # Add all recommended sections with substantial content
        for section in SPEC_RECOMMENDED_SECTIONS:
            content += f"## {section}\n\nThis section contains detailed information about {section.lower()}. "
            content += "We need to ensure that all requirements are properly documented and reviewed.\n\n"

        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert len(result.warnings) == 0


class TestValidateContentLength:
    """Tests for content length validation."""

    def test_warns_when_content_too_short(self, spec_dir: Path):
        """Should warn when spec.md is less than 500 characters."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview\n\nShort.\n\n## Workflow Type\n\nX\n\n"
        content += "## Task Scope\n\nY\n\n## Success Criteria\n\nZ\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert any("too short" in warn.lower() for warn in result.warnings)

    def test_no_warning_for_adequate_length(self, spec_dir: Path):
        """Should not warn when spec.md has adequate length."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        # Create content longer than 500 characters
        content = "## Overview\n\n" + "X" * 600 + "\n\n"
        content += "## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\nScope\n\n"
        content += "## Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert not any("too short" in warn.lower() for warn in result.warnings)

    def test_content_check_counts_all_characters(self, spec_dir: Path):
        """Content length check should count all characters including whitespace."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        # Create content exactly over 500 characters with mixed content
        content = "## Overview\n\n" + "A" * 480 + "\n\n"
        content += "## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\nScope\n\n"
        content += "## Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Should not have length warning
        assert not any("too short" in warn.lower() for warn in result.warnings)


class TestValidateValidSpec:
    """Tests for validate() with valid spec.md."""

    def test_returns_valid_for_minimal_spec(self, spec_dir: Path):
        """Should return valid with minimal required sections."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview\n\nImplement feature.\n\n## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\nAdd user auth.\n\n## Success Criteria\n\nTests pass.\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True
        assert result.checkpoint == "spec"
        # May have warnings about recommended sections or length

    def test_returns_valid_with_comprehensive_spec(self, spec_dir: Path):
        """Should return valid with comprehensive spec document."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator
        from spec.validate_pkg.schemas import SPEC_REQUIRED_SECTIONS, SPEC_RECOMMENDED_SECTIONS

        spec_file = spec_dir / "spec.md"
        content = ""

        # Add all required sections
        for section in SPEC_REQUIRED_SECTIONS:
            content += f"## {section}\n\nDetailed content for {section}.\n\n"

        # Add all recommended sections
        for section in SPEC_RECOMMENDED_SECTIONS:
            content += f"## {section}\n\nDetails about {section}.\n\n"

        # Add more content to avoid length warning
        content += "Additional implementation details..." * 50

        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True
        assert len(result.errors) == 0
        assert len(result.warnings) == 0


class TestValidationResultStructure:
    """Tests for ValidationResult structure."""

    def test_result_has_all_fields(self, spec_dir: Path):
        """ValidationResult should have all expected fields."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        spec_file.write_text("## Overview\n\nContent\n", encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert hasattr(result, "valid")
        assert hasattr(result, "checkpoint")
        assert hasattr(result, "errors")
        assert hasattr(result, "warnings")
        assert hasattr(result, "fixes")

    def test_checkpoint_is_spec(self, spec_dir: Path):
        """Checkpoint field should always be 'spec'."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        spec_file.write_text("## Overview\n\nContent\n", encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.checkpoint == "spec"

    def test_lists_are_initialized(self, spec_dir: Path):
        """Errors, warnings, and fixes should always be lists."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        spec_file.write_text("## Overview\n\nContent\n", encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert isinstance(result.errors, list)
        assert isinstance(result.warnings, list)
        assert isinstance(result.fixes, list)


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_handles_unicode_in_spec(self, spec_dir: Path):
        """Should handle unicode characters in spec.md."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview\n\n添加用户认证功能\n\n## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\n范围\n\n## Success Criteria\n\n完成\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True

    def test_handles_extra_whitespace(self, spec_dir: Path):
        """Should handle extra whitespace in sections."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "##  Overview  \n\nContent\n\n## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\nScope\n\n## Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Should still match despite extra whitespace
        assert result.valid is True

    def test_handles_mixed_heading_levels(self, spec_dir: Path):
        """Should handle spec with various heading levels."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview\n\nContent\n\n### Subsection\n\nDetails\n\n"
        content += "## Workflow Type\n\nFeature\n\n## Task Scope\n\nScope\n\n"
        content += "## Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True

    def test_section_pattern_excludes_subsections(self, spec_dir: Path):
        """Should not match subsections (###) as main sections."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        # Only has subsections, not main sections
        content = "### Overview\n\nContent\n\n### Workflow Type\n\nFeature\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Should be invalid - ### doesn't count as ## or #
        assert result.valid is False

    def test_handles_empty_spec_file(self, spec_dir: Path):
        """Should handle empty spec.md file."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        spec_file.write_text("", encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        # Should warn about being too short
        assert any("too short" in warn.lower() for warn in result.warnings)

    def test_handles_spec_with_only_whitespace(self, spec_dir: Path):
        """Should handle spec.md with only whitespace."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        spec_file.write_text("   \n\n   \n", encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert any("too short" in warn.lower() for warn in result.warnings)


class TestSectionMatching:
    """Tests for section heading pattern matching."""

    def test_matches_section_with_trailing_colon(self, spec_dir: Path):
        """Should match sections with trailing colon."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview:\n\nContent\n\n## Workflow Type:\n\nFeature\n\n"
        content += "## Task Scope:\n\nScope\n\n## Success Criteria:\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Should match despite trailing colon
        assert result.valid is True

    def test_matches_section_with_special_chars(self, spec_dir: Path):
        """Should match sections with special characters."""
        from spec.validate_pkg.validators.spec_document_validator import SpecDocumentValidator

        spec_file = spec_dir / "spec.md"
        content = "## Overview (v2.0)\n\nContent\n\n## Workflow Type\n\nFeature\n\n"
        content += "## Task Scope\n\nScope\n\n## Success Criteria\n\nDone\n"
        spec_file.write_text(content, encoding="utf-8")

        validator = SpecDocumentValidator(spec_dir)
        result = validator.validate()

        # Should still match
        assert result.valid is True

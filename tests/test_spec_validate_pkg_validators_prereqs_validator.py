#!/usr/bin/env python3
"""
Tests for spec/validate_pkg/validators/prereqs_validator.py
===========================================================

Tests for PrereqsValidator class covering:
- Spec directory existence checks
- project_index.json existence checks
- Auto-claude level fallback checks
- ValidationResult return values
"""

import json
from pathlib import Path

import pytest


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def clean_project_index_files(spec_dir: Path) -> None:
    """Remove project_index.json files that may interfere with tests.

    Cleans up both:
    - spec_dir / "project_index.json"
    - spec_dir.parent.parent / "project_index.json" (auto-claude level)

    This prevents test isolation issues when tests share the same temp_dir parent.
    """
    # Clean spec_dir level
    spec_index = spec_dir / "project_index.json"
    if spec_index.exists():
        spec_index.unlink()

    # Clean auto-claude level (two levels up from spec_dir)
    auto_build_index = spec_dir.parent.parent / "project_index.json"
    if auto_build_index.exists():
        auto_build_index.unlink()


class TestPrereqsValidatorInit:
    """Tests for PrereqsValidator initialization."""

    def test_initialization_with_path(self, spec_dir: Path):
        """PrereqsValidator initializes with spec_dir path."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        validator = PrereqsValidator(spec_dir)

        assert validator.spec_dir == spec_dir
        assert isinstance(validator.spec_dir, Path)

    def test_converts_string_to_path(self, spec_dir: Path):
        """PrereqsValidator converts string path to Path object."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        validator = PrereqsValidator(str(spec_dir))

        assert isinstance(validator.spec_dir, Path)
        assert validator.spec_dir == spec_dir


class TestValidateSpecDirMissing:
    """Tests for validate() when spec directory does not exist."""

    def test_returns_error_when_spec_dir_missing(self, temp_dir: Path):
        """Should return error when spec directory does not exist."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        non_existent_dir = temp_dir / "nonexistent" / "spec"
        validator = PrereqsValidator(non_existent_dir)
        result = validator.validate()

        assert result.valid is False
        assert result.checkpoint == "prereqs"
        assert len(result.errors) > 0
        assert any("does not exist" in err.lower() for err in result.errors)

    def test_error_includes_directory_path(self, temp_dir: Path):
        """Error message should include the directory path."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        non_existent_dir = temp_dir / "missing" / "spec"
        validator = PrereqsValidator(non_existent_dir)
        result = validator.validate()

        error_msg = result.errors[0]
        assert str(non_existent_dir) in error_msg

    def test_fix_suggests_mkdir_command(self, temp_dir: Path):
        """Suggested fix should include mkdir -p command."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        non_existent_dir = temp_dir / "new" / "spec"
        validator = PrereqsValidator(non_existent_dir)
        result = validator.validate()

        assert any("mkdir" in fix.lower() for fix in result.fixes)
        assert any("-p" in fix for fix in result.fixes)


class TestValidateProjectIndexMissing:
    """Tests for validate() when project_index.json is missing."""

    def test_returns_error_when_project_index_missing(self, spec_dir: Path):
        """Should return error when project_index.json does not exist."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        clean_project_index_files(spec_dir)

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert any("project_index.json" in err for err in result.errors)

    def test_error_when_no_auto_claude_index(self, spec_dir: Path):
        """Should error when project_index.json missing at both levels."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        clean_project_index_files(spec_dir)

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert not result.warnings  # No warning if no auto-claude fallback exists

    def test_fix_suggests_running_analyzer(self, spec_dir: Path):
        """Suggested fix should suggest running analyzer.py."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        clean_project_index_files(spec_dir)

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert any("analyzer.py" in fix for fix in result.fixes)
        assert any("auto-claude" in fix for fix in result.fixes)


class TestValidateAutoClaudeFallback:
    """Tests for validate() with auto-claude level project_index.json."""

    def test_warns_when_auto_claude_index_exists(self, spec_dir: Path):
        """Should warn when project_index.json exists at auto-claude/ level."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        # The validator checks spec_dir.parent.parent for the auto-claude index
        # Create project_index.json at the correct level (two levels up from spec_dir)
        auto_build_index = spec_dir.parent.parent / "project_index.json"
        auto_build_index.parent.mkdir(parents=True, exist_ok=True)
        auto_build_index.write_text('{"project_type": "single"}', encoding="utf-8")

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        # When auto-claude index exists but spec_dir index doesn't, it's valid with a warning
        assert result.valid is True  # Valid because warning path, not error path
        assert len(result.warnings) > 0
        assert any("auto-claude" in warn or "spec folder" in warn for warn in result.warnings)

    def test_fix_suggests_copy_command(self, spec_dir: Path):
        """Suggested fix should include cp command when auto-claude index exists."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        # Create project_index.json at the auto-claude level (two levels up)
        auto_build_index = spec_dir.parent.parent / "project_index.json"
        auto_build_index.parent.mkdir(parents=True, exist_ok=True)
        auto_build_index.write_text('{"project_type": "monorepo"}', encoding="utf-8")

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert any("cp" in fix for fix in result.fixes)
        assert any(str(auto_build_index) in fix for fix in result.fixes)

    def test_no_warning_when_auto_claude_index_missing(self, spec_dir: Path):
        """Should not warn when auto-claude level index also missing."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        clean_project_index_files(spec_dir)

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        # Should be invalid since no index exists anywhere
        assert result.valid is False
        assert not any("auto-claude" in warn for warn in result.warnings)
        assert any("not found" in err for err in result.errors)


class TestValidateValidPrereqs:
    """Tests for validate() with valid prerequisites."""

    def test_returns_valid_when_project_index_exists(self, spec_dir: Path):
        """Should return valid when project_index.json exists in spec dir."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        project_index = spec_dir / "project_index.json"
        project_index.write_text('{"project_type": "single"}', encoding="utf-8")

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True
        assert result.checkpoint == "prereqs"
        assert len(result.errors) == 0

    def test_valid_with_valid_project_index_content(self, spec_dir: Path):
        """Should be valid with properly structured project_index.json."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        project_index = spec_dir / "project_index.json"
        project_index.write_text(json.dumps({
            "project_type": "monorepo",
            "services": {
                "backend": {"path": "backend", "language": "python"},
                "frontend": {"path": "frontend", "language": "typescript"},
            },
            "file_count": 150,
        }), encoding="utf-8")

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True


class TestValidationResultStructure:
    """Tests for ValidationResult structure."""

    def test_result_has_all_fields(self, spec_dir: Path):
        """ValidationResult should have all expected fields."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert hasattr(result, "valid")
        assert hasattr(result, "checkpoint")
        assert hasattr(result, "errors")
        assert hasattr(result, "warnings")
        assert hasattr(result, "fixes")

    def test_checkpoint_is_prereqs(self, spec_dir: Path):
        """Checkpoint field should always be 'prereqs'."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert result.checkpoint == "prereqs"

    def test_lists_are_initialized(self, spec_dir: Path):
        """Errors, warnings, and fixes should always be lists."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        assert isinstance(result.errors, list)
        assert isinstance(result.warnings, list)
        assert isinstance(result.fixes, list)


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_handles_relative_paths(self, temp_dir: Path, monkeypatch):
        """Should handle relative path arguments."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        # Create spec directory
        spec_path = temp_dir / "spec"
        spec_path.mkdir()

        # Use relative path with monkeypatch for safe directory change
        relative_path = "spec"
        monkeypatch.chdir(temp_dir)
        validator = PrereqsValidator(relative_path)
        result = validator.validate()

        # Should work (will be invalid since no project_index.json)
        assert result.checkpoint == "prereqs"

    def test_handles_symlink_to_directory(self, temp_dir: Path):
        """Should handle symlinks to directories."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        # Create actual spec directory
        actual_spec = temp_dir / "actual_spec"
        actual_spec.mkdir()

        # Create symlink
        import os
        link_spec = temp_dir / "link_spec"
        try:
            os.symlink(actual_spec, link_spec)
        except OSError:
            # Symlinks may not be supported on all systems
            pytest.skip("Symlinks not supported")

        validator = PrereqsValidator(link_spec)
        result = validator.validate()

        # Should handle the symlinked directory
        assert result.checkpoint == "prereqs"

    def test_multiple_validations_independent(self, spec_dir: Path):
        """Multiple validations should be independent."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        clean_project_index_files(spec_dir)

        validator1 = PrereqsValidator(spec_dir)
        result1 = validator1.validate()

        # Create project_index.json between validations
        project_index = spec_dir / "project_index.json"
        project_index.write_text('{"project_type": "single"}', encoding="utf-8")

        validator2 = PrereqsValidator(spec_dir)
        result2 = validator2.validate()

        # First result should be invalid (no index existed at validation time)
        assert result1.valid is False
        # Second result should be valid (index now exists)
        assert result2.valid is True

    def test_handles_empty_project_index(self, spec_dir: Path):
        """Should handle empty project_index.json file."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator

        project_index = spec_dir / "project_index.json"
        project_index.write_text("{}", encoding="utf-8")

        validator = PrereqsValidator(spec_dir)
        result = validator.validate()

        # Should be valid since file exists (content validation not required)
        assert result.valid is True


class TestPrereqsValidatorIntegration:
    """Integration tests with other validators."""

    def test_works_with_context_validator(self, spec_dir: Path):
        """Should work correctly when used with ContextValidator."""
        from spec.validate_pkg.validators.prereqs_validator import PrereqsValidator
        from spec.validate_pkg.validators.context_validator import ContextValidator

        # Create project_index.json
        project_index = spec_dir / "project_index.json"
        project_index.write_text('{"project_type": "single"}', encoding="utf-8")

        prereq_validator = PrereqsValidator(spec_dir)
        prereq_result = prereq_validator.validate()

        context_validator = ContextValidator(spec_dir)
        context_result = context_validator.validate()

        # Prereqs should be valid
        assert prereq_result.valid is True
        # Context should be invalid (no context.json)
        assert context_result.valid is False

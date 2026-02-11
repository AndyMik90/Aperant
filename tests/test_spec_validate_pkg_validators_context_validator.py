#!/usr/bin/env python3
"""
Tests for spec/validate_pkg/validators/context_validator.py
============================================================

Tests for ContextValidator class covering:
- File existence checks
- JSON parsing validation
- Required field validation
- Recommended field warnings
- ValidationResult return values
"""

import json
from pathlib import Path


class TestContextValidatorInit:
    """Tests for ContextValidator initialization."""

    def test_initialization_with_path(self, spec_dir: Path):
        """ContextValidator initializes with spec_dir path."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        validator = ContextValidator(spec_dir)

        assert validator.spec_dir == spec_dir
        assert isinstance(validator.spec_dir, Path)

    def test_converts_string_to_path(self, spec_dir: Path):
        """ContextValidator converts string path to Path object."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        validator = ContextValidator(str(spec_dir))

        assert isinstance(validator.spec_dir, Path)
        assert validator.spec_dir == spec_dir


class TestValidateFileNotFound:
    """Tests for validate() when context.json does not exist."""

    def test_returns_error_when_file_missing(self, spec_dir: Path):
        """Should return ValidationResult with error when context.json missing."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert result.checkpoint == "context"
        assert any("not found" in err.lower() for err in result.errors)
        assert len(result.fixes) > 0

    def test_error_message_includes_filename(self, spec_dir: Path):
        """Error message should mention context.json."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert "context.json" in result.errors[0]

    def test_fix_suggests_command(self, spec_dir: Path):
        """Suggested fix should include the context.py command."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert any("auto-claude/context.py" in fix for fix in result.fixes)
        assert any("--output context.json" in fix for fix in result.fixes)


class TestValidateInvalidJson:
    """Tests for validate() with invalid JSON content."""

    def test_returns_error_for_invalid_json(self, spec_dir: Path):
        """Should return error when context.json has invalid JSON."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text("{invalid json content", encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert result.checkpoint == "context"
        assert any("invalid json" in err.lower() for err in result.errors)

    def test_error_includes_json_parse_message(self, spec_dir: Path):
        """Error message should include JSON parsing error details."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text('{"unclosed": true', encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        # Error message should mention the JSON decode error
        assert any("json" in err.lower() for err in result.errors)

    def test_fix_suggests_regenerate(self, spec_dir: Path):
        """Suggested fix should mention regenerating context.json."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text("{bad}", encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert any("regenerate" in fix.lower() or "fix" in fix.lower() for fix in result.fixes)


class TestValidateMissingRequiredFields:
    """Tests for validate() with missing required fields."""

    def test_error_when_task_description_missing(self, spec_dir: Path):
        """Should error when required field 'task_description' is missing."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text('{"other_field": "value"}', encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert any("task_description" in err for err in result.errors)

    def test_error_for_all_required_fields_missing(self, spec_dir: Path):
        """Should list all missing required fields."""
        from spec.validate_pkg.validators.context_validator import ContextValidator
        from spec.validate_pkg.schemas import CONTEXT_SCHEMA

        context_file = spec_dir / "context.json"
        context_file.write_text("{}", encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        # Check that all required fields are mentioned in errors
        required_fields = CONTEXT_SCHEMA["required_fields"]
        for field in required_fields:
            assert any(field in err for err in result.errors), f"Field {field} not in errors"

    def test_fixes_suggest_adding_missing_fields(self, spec_dir: Path):
        """Suggested fixes should include adding missing fields."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text('{"created_at": "2024-01-01"}', encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        # Fixes should suggest adding task_description
        assert any("task_description" in fix for fix in result.fixes)

    def test_valid_when_all_required_fields_present(self, spec_dir: Path):
        """Should pass validation when all required fields exist."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {"task_description": "Add user authentication"}
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True
        assert len(result.errors) == 0


class TestValidateRecommendedFields:
    """Tests for validate() recommended field warnings."""

    def test_warns_when_files_to_modify_missing(self, spec_dir: Path):
        """Should warn when 'files_to_modify' is missing."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {"task_description": "Test task"}
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        # Missing recommended field should be a warning, not error
        assert any("files_to_modify" in warn for warn in result.warnings)
        assert all("files_to_modify" not in err for err in result.errors)

    def test_warns_when_files_to_reference_missing(self, spec_dir: Path):
        """Should warn when 'files_to_reference' is missing."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {"task_description": "Test task"}
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert any("files_to_reference" in warn for warn in result.warnings)

    def test_warns_when_scoped_services_missing(self, spec_dir: Path):
        """Should warn when 'scoped_services' is missing."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {"task_description": "Test task"}
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert any("scoped_services" in warn for warn in result.warnings)

    def test_warns_for_empty_recommended_fields(self, spec_dir: Path):
        """Should warn when recommended fields exist but are empty."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {
            "task_description": "Test task",
            "files_to_modify": [],
            "files_to_reference": None,
        }
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        # Empty fields should trigger warnings
        assert any("files_to_modify" in warn for warn in result.warnings)

    def test_no_warnings_when_recommended_fields_present(self, spec_dir: Path):
        """Should not warn when all recommended fields are present."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {
            "task_description": "Test task",
            "files_to_modify": ["src/auth.py"],
            "files_to_reference": ["src/user.py"],
            "scoped_services": ["backend"],
        }
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        # Check that no warnings for these fields exist
        assert not any("files_to_modify" in warn for warn in result.warnings)
        assert not any("files_to_reference" in warn for warn in result.warnings)
        assert not any("scoped_services" in warn for warn in result.warnings)


class TestValidateValidContext:
    """Tests for validate() with valid context.json."""

    def test_returns_valid_for_minimal_context(self, spec_dir: Path):
        """Should return valid result with minimal required fields."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {"task_description": "Implement OAuth login"}
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True
        assert result.checkpoint == "context"
        assert len(result.errors) == 0
        # Warnings for missing recommended fields are expected

    def test_returns_valid_with_all_fields(self, spec_dir: Path):
        """Should return valid result with all fields present."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {
            "task_description": "Add OAuth",
            "scoped_services": ["backend", "frontend"],
            "files_to_modify": ["src/auth.py"],
            "files_to_reference": ["src/user.py"],
            "patterns": ["singleton pattern"],
            "service_contexts": {"backend": "FastAPI app"},
            "created_at": "2024-01-15T10:00:00Z",
        }
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True
        assert len(result.errors) == 0
        assert len(result.warnings) == 0


class TestValidationResultStructure:
    """Tests for ValidationResult structure and fields."""

    def test_result_has_all_fields(self, spec_dir: Path):
        """ValidationResult should have all expected fields."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text('{"task_description": "Test"}', encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        # Check all fields exist
        assert hasattr(result, "valid")
        assert hasattr(result, "checkpoint")
        assert hasattr(result, "errors")
        assert hasattr(result, "warnings")
        assert hasattr(result, "fixes")

    def test_checkpoint_is_context(self, spec_dir: Path):
        """Checkpoint field should always be 'context'."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text('{"task_description": "Test"}', encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.checkpoint == "context"

    def test_fixes_only_on_invalid(self, spec_dir: Path):
        """Fixes should only be present when validation fails."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        # Valid case - no fixes needed
        context_file = spec_dir / "context.json"
        context_file.write_text('{"task_description": "Test"}', encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True
        assert len(result.fixes) == 0

    def test_lists_are_initialized(self, spec_dir: Path):
        """Errors, warnings, and fixes should always be lists."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text('{"task_description": "Test"}', encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert isinstance(result.errors, list)
        assert isinstance(result.warnings, list)
        assert isinstance(result.fixes, list)


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_handles_unicode_in_context(self, spec_dir: Path):
        """Should handle unicode characters in context.json."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_data = {
            "task_description": "添加用户认证",
        }
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True

    def test_handles_large_context_file(self, spec_dir: Path):
        """Should handle large context.json files."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        # Create a large context with many files
        context_data = {
            "task_description": "Large refactoring",
            "files_to_modify": [f"src/file{i}.py" for i in range(1000)],
            "files_to_reference": [f"lib/file{i}.py" for i in range(500)],
        }

        context_file = spec_dir / "context.json"
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True

    def test_handles_empty_context_object(self, spec_dir: Path):
        """Should handle empty JSON object."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_file = spec_dir / "context.json"
        context_file.write_text("{}", encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is False
        assert any("task_description" in err for err in result.errors)

    def test_handles_nested_json_structure(self, spec_dir: Path):
        """Should handle nested JSON objects."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_data = {
            "task_description": "Complex task",
            "service_contexts": {
                "backend": {
                    "framework": "FastAPI",
                    "version": "0.100.0",
                    "config": {"debug": True, "port": 8000},
                }
            },
            "patterns": [
                {"name": "singleton", "description": "Single instance"},
                {"name": "factory", "description": "Object creation"},
            ],
        }

        context_file = spec_dir / "context.json"
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        assert result.valid is True

    def test_handles_extra_fields(self, spec_dir: Path):
        """Should allow extra fields not in schema."""
        from spec.validate_pkg.validators.context_validator import ContextValidator

        context_data = {
            "task_description": "Test task",
            "custom_field": "custom value",
            "another_extra": 123,
        }

        context_file = spec_dir / "context.json"
        context_file.write_text(json.dumps(context_data), encoding="utf-8")

        validator = ContextValidator(spec_dir)
        result = validator.validate()

        # Extra fields should not cause validation errors
        assert result.valid is True

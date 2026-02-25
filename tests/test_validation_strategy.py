#!/usr/bin/env python3
"""
Tests for the validation_strategy module.

Tests cover:
- Project type detection
- Validation strategy building for different project types
- Risk level handling
- Security scanning integration
- Strategy serialization
"""

import json
import tempfile
from pathlib import Path

import pytest

# Add auto-claude to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from spec.validation_strategy import (
    ValidationStep,
    ValidationStrategy,
    ValidationStrategyBuilder,
    detect_project_type,
    build_validation_strategy,
    get_strategy_as_dict,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def builder():
    """Create a ValidationStrategyBuilder instance."""
    return ValidationStrategyBuilder()


# =============================================================================
# PROJECT TYPE DETECTION TESTS
# =============================================================================


class TestProjectTypeDetection:
    """Tests for detect_project_type function."""

    def test_detect_react_spa(self, temp_dir):
        """Test detection of React SPA project."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "my-app",
            "dependencies": {"react": "^18.0.0", "react-dom": "^18.0.0"}
        }))

        assert detect_project_type(temp_dir) == "react_spa"

    def test_detect_vue_spa(self, temp_dir):
        """Test detection of Vue SPA project."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "my-vue-app",
            "dependencies": {"vue": "^3.0.0"}
        }))

        assert detect_project_type(temp_dir) == "vue_spa"

    def test_detect_nextjs(self, temp_dir):
        """Test detection of Next.js project."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "my-next-app",
            "dependencies": {"next": "^14.0.0", "react": "^18.0.0"}
        }))

        assert detect_project_type(temp_dir) == "nextjs"

    def test_detect_angular_spa(self, temp_dir):
        """Test detection of Angular project."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "my-angular-app",
            "dependencies": {"@angular/core": "^17.0.0"}
        }))

        assert detect_project_type(temp_dir) == "angular_spa"

    def test_detect_nodejs(self, temp_dir):
        """Test detection of plain Node.js project."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "my-api",
            "dependencies": {"express": "^4.18.0"}
        }))

        assert detect_project_type(temp_dir) == "nodejs"

    def test_detect_python_api_fastapi(self, temp_dir):
        """Test detection of Python FastAPI project."""
        requirements = temp_dir / "requirements.txt"
        requirements.write_text("fastapi==0.100.0\nuvicorn==0.23.0\n")

        assert detect_project_type(temp_dir) == "python_api"

    def test_detect_python_api_flask(self, temp_dir):
        """Test detection of Python Flask project."""
        requirements = temp_dir / "requirements.txt"
        requirements.write_text("flask==2.0.0\ngunicorn==21.0.0\n")

        assert detect_project_type(temp_dir) == "python_api"

    def test_detect_python_api_django(self, temp_dir):
        """Test detection of Python Django project."""
        pyproject = temp_dir / "pyproject.toml"
        pyproject.write_text('[project]\ndependencies = ["django>=4.0"]\n')

        assert detect_project_type(temp_dir) == "python_api"

    def test_detect_python_cli_click(self, temp_dir):
        """Test detection of Python CLI project with click."""
        requirements = temp_dir / "requirements.txt"
        requirements.write_text("click==8.0.0\n")

        assert detect_project_type(temp_dir) == "python_cli"

    def test_detect_python_cli_typer(self, temp_dir):
        """Test detection of Python CLI project with typer."""
        requirements = temp_dir / "requirements.txt"
        requirements.write_text("typer==0.9.0\n")

        assert detect_project_type(temp_dir) == "python_cli"

    def test_detect_generic_python(self, temp_dir):
        """Test detection of generic Python project."""
        requirements = temp_dir / "requirements.txt"
        requirements.write_text("numpy==1.24.0\npandas==2.0.0\n")

        assert detect_project_type(temp_dir) == "python"

    def test_detect_rust(self, temp_dir):
        """Test detection of Rust project."""
        cargo = temp_dir / "Cargo.toml"
        cargo.write_text('[package]\nname = "my-app"\n')

        assert detect_project_type(temp_dir) == "rust"

    def test_detect_go(self, temp_dir):
        """Test detection of Go project."""
        go_mod = temp_dir / "go.mod"
        go_mod.write_text("module github.com/user/myapp\n")

        assert detect_project_type(temp_dir) == "go"

    def test_detect_ruby(self, temp_dir):
        """Test detection of Ruby project."""
        gemfile = temp_dir / "Gemfile"
        gemfile.write_text('source "https://rubygems.org"\ngem "rails"\n')

        assert detect_project_type(temp_dir) == "ruby"

    def test_detect_html_css(self, temp_dir):
        """Test detection of simple HTML/CSS project."""
        index = temp_dir / "index.html"
        index.write_text("<!DOCTYPE html>\n<html><body>Hello</body></html>")

        assert detect_project_type(temp_dir) == "html_css"

    def test_detect_unknown(self, temp_dir):
        """Test detection returns 'unknown' for unrecognized projects."""
        # Empty directory
        assert detect_project_type(temp_dir) == "unknown"

    def test_invalid_package_json(self, temp_dir):
        """Test handling of invalid package.json."""
        package_json = temp_dir / "package.json"
        package_json.write_text("not valid json")

        assert detect_project_type(temp_dir) == "nodejs"

    def test_detect_electron_in_dependencies(self, temp_dir):
        """Test detection of Electron project with electron in dependencies."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "my-electron-app",
            "dependencies": {"electron": "^28.0.0"}
        }))

        assert detect_project_type(temp_dir) == "electron"

    def test_detect_electron_in_dev_dependencies(self, temp_dir):
        """Test detection of Electron project with electron in devDependencies."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "my-electron-app",
            "devDependencies": {"electron": "^28.0.0"}
        }))

        assert detect_project_type(temp_dir) == "electron"

    def test_electron_priority_over_react(self, temp_dir):
        """Test that Electron is detected over React when both are present."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "electron-react-app",
            "dependencies": {
                "react": "^18.0.0",
                "react-dom": "^18.0.0"
            },
            "devDependencies": {
                "electron": "^28.0.0"
            }
        }))

        assert detect_project_type(temp_dir) == "electron"

    def test_electron_with_electron_vite(self, temp_dir):
        """Test detection of Electron project using electron-vite."""
        package_json = temp_dir / "package.json"
        package_json.write_text(json.dumps({
            "name": "electron-vite-app",
            "devDependencies": {
                "electron": "^28.0.0",
                "electron-vite": "^2.0.0"
            }
        }))

        assert detect_project_type(temp_dir) == "electron"


# =============================================================================
# VALIDATION STEP TESTS
# =============================================================================


class TestValidationStep:
    """Tests for ValidationStep dataclass."""

    def test_create_step(self):
        """Test creating a validation step."""
        step = ValidationStep(
            name="Unit Tests",
            command="npm test",
            expected_outcome="All tests pass",
            step_type="test",
        )

        assert step.name == "Unit Tests"
        assert step.command == "npm test"
        assert step.step_type == "test"
        assert step.required is True
        assert step.blocking is True

    def test_step_with_optional_fields(self):
        """Test step with optional fields."""
        step = ValidationStep(
            name="Visual Check",
            command="screenshot",
            expected_outcome="No visual regressions",
            step_type="visual",
            required=False,
            blocking=False,
        )

        assert step.required is False
        assert step.blocking is False


# =============================================================================
# VALIDATION STRATEGY TESTS
# =============================================================================


class TestValidationStrategy:
    """Tests for ValidationStrategy dataclass."""

    def test_create_strategy(self):
        """Test creating a validation strategy."""
        strategy = ValidationStrategy(
            risk_level="medium",
            project_type="react_spa",
            steps=[
                ValidationStep(
                    name="Test",
                    command="npm test",
                    expected_outcome="Pass",
                    step_type="test",
                )
            ],
            test_types_required=["unit", "integration"],
            reasoning="Test reasoning",
        )

        assert strategy.risk_level == "medium"
        assert strategy.project_type == "react_spa"
        assert len(strategy.steps) == 1
        assert strategy.test_types_required == ["unit", "integration"]
        assert strategy.security_scan_required is False
        assert strategy.skip_validation is False


# =============================================================================
# STRATEGY BUILDER TESTS - BY RISK LEVEL
# =============================================================================


class TestStrategyBuilderByRisk:
    """Tests for validation strategy builder with different risk levels."""

    def test_trivial_risk_skips_validation(self, builder, temp_dir):
        """Test that trivial risk allows skipping validation."""
        # Create a simple Python project
        (temp_dir / "requirements.txt").write_text("requests==2.31.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "trivial")

        assert strategy.skip_validation is True
        assert strategy.risk_level == "trivial"

    def test_low_risk_requires_unit_tests(self, builder, temp_dir):
        """Test that low risk requires unit tests."""
        (temp_dir / "requirements.txt").write_text("requests==2.31.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "low")

        assert strategy.skip_validation is False
        assert "unit" in strategy.test_types_required
        assert strategy.security_scan_required is False

    def test_medium_risk_requires_integration(self, builder, temp_dir):
        """Test that medium risk requires integration tests."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert "unit" in strategy.test_types_required
        assert "integration" in strategy.test_types_required
        assert strategy.security_scan_required is False

    def test_high_risk_requires_security(self, builder, temp_dir):
        """Test that high risk requires security scanning."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "high")

        assert "unit" in strategy.test_types_required
        assert "integration" in strategy.test_types_required
        assert strategy.security_scan_required is True

    def test_critical_risk_full_validation(self, builder, temp_dir):
        """Test that critical risk gets full validation."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "critical")

        assert "unit" in strategy.test_types_required
        assert "integration" in strategy.test_types_required
        assert "e2e" in strategy.test_types_required
        assert strategy.security_scan_required is True


# =============================================================================
# STRATEGY BUILDER TESTS - BY PROJECT TYPE
# =============================================================================


class TestStrategyBuilderByProjectType:
    """Tests for validation strategies by project type."""

    def test_html_css_strategy(self, builder, temp_dir):
        """Test HTML/CSS project strategy."""
        (temp_dir / "index.html").write_text("<!DOCTYPE html><html></html>")

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "html_css"
        assert "visual" in strategy.test_types_required
        # Should have visual verification steps
        step_types = [s.step_type for s in strategy.steps]
        assert "visual" in step_types or "setup" in step_types

    def test_react_spa_strategy(self, builder, temp_dir):
        """Test React SPA project strategy."""
        (temp_dir / "package.json").write_text(json.dumps({
            "dependencies": {"react": "^18.0.0"}
        }))

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "react_spa"
        assert "unit" in strategy.test_types_required
        assert "integration" in strategy.test_types_required
        # Should have test commands
        commands = [s.command for s in strategy.steps]
        assert any("npm test" in cmd or "npx" in cmd for cmd in commands)

    def test_python_api_strategy(self, builder, temp_dir):
        """Test Python API project strategy."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "python_api"
        # Should have pytest commands
        commands = [s.command for s in strategy.steps]
        assert any("pytest" in cmd for cmd in commands)

    def test_rust_strategy(self, builder, temp_dir):
        """Test Rust project strategy."""
        (temp_dir / "Cargo.toml").write_text('[package]\nname = "test"')

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "rust"
        commands = [s.command for s in strategy.steps]
        assert any("cargo test" in cmd for cmd in commands)

    def test_go_strategy(self, builder, temp_dir):
        """Test Go project strategy."""
        (temp_dir / "go.mod").write_text("module test")

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "go"
        commands = [s.command for s in strategy.steps]
        assert any("go test" in cmd for cmd in commands)

    def test_ruby_strategy(self, builder, temp_dir):
        """Test Ruby project strategy."""
        (temp_dir / "Gemfile").write_text('gem "rails"')

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "ruby"
        commands = [s.command for s in strategy.steps]
        assert any("rspec" in cmd for cmd in commands)

    def test_unknown_project_manual_verification(self, builder, temp_dir):
        """Test unknown project type requires manual verification."""
        # Empty directory = unknown type
        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "unknown"
        step_types = [s.step_type for s in strategy.steps]
        assert "manual" in step_types

    def test_electron_strategy(self, builder, temp_dir):
        """Test Electron project strategy."""
        (temp_dir / "package.json").write_text(json.dumps({
            "devDependencies": {"electron": "^28.0.0"}
        }))

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "electron"
        assert "unit" in strategy.test_types_required
        assert "e2e" in strategy.test_types_required
        # Should have npm test and npm run test:e2e commands
        commands = [s.command for s in strategy.steps]
        assert any("npm test" in cmd for cmd in commands)
        assert any("test:e2e" in cmd for cmd in commands)

    def test_electron_low_risk_strategy(self, builder, temp_dir):
        """Test Electron project with low risk only has unit tests."""
        (temp_dir / "package.json").write_text(json.dumps({
            "dependencies": {"electron": "^28.0.0"}
        }))

        strategy = builder.build_strategy(temp_dir, temp_dir, "low")

        assert strategy.project_type == "electron"
        assert "unit" in strategy.test_types_required
        # Low risk should NOT have e2e tests
        assert "e2e" not in strategy.test_types_required

    def test_electron_high_risk_has_console_check(self, builder, temp_dir):
        """Test Electron high risk includes console error check."""
        (temp_dir / "package.json").write_text(json.dumps({
            "devDependencies": {"electron": "^28.0.0"}
        }))

        strategy = builder.build_strategy(temp_dir, temp_dir, "high")

        assert strategy.project_type == "electron"
        step_names = [s.name.lower() for s in strategy.steps]
        assert any("console" in name for name in step_names)


# =============================================================================
# SECURITY STEPS TESTS
# =============================================================================


class TestSecuritySteps:
    """Tests for security scanning steps."""

    def test_high_risk_adds_secrets_scan(self, builder, temp_dir):
        """Test that high risk adds secrets scanning."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "high")

        step_names = [s.name.lower() for s in strategy.steps]
        assert any("secret" in name for name in step_names)

    def test_high_risk_python_adds_bandit(self, builder, temp_dir):
        """Test that high risk Python adds Bandit scan."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "high")

        commands = [s.command for s in strategy.steps]
        assert any("bandit" in cmd for cmd in commands)

    def test_high_risk_nodejs_adds_npm_audit(self, builder, temp_dir):
        """Test that high risk Node.js adds npm audit."""
        (temp_dir / "package.json").write_text(json.dumps({
            "dependencies": {"express": "^4.18.0"}
        }))

        strategy = builder.build_strategy(temp_dir, temp_dir, "high")

        commands = [s.command for s in strategy.steps]
        assert any("npm audit" in cmd for cmd in commands)

    def test_low_risk_no_security_scan(self, builder, temp_dir):
        """Test that low risk doesn't add security scanning."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "low")

        assert strategy.security_scan_required is False
        step_names = [s.name.lower() for s in strategy.steps]
        assert not any("secret" in name for name in step_names)


# =============================================================================
# STRATEGY SERIALIZATION TESTS
# =============================================================================


class TestStrategySerialization:
    """Tests for strategy serialization to dict/JSON."""

    def test_to_dict(self, builder, temp_dir):
        """Test converting strategy to dictionary."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")
        result = builder.to_dict(strategy)

        assert isinstance(result, dict)
        assert result["risk_level"] == "medium"
        assert result["project_type"] == "python_api"
        assert isinstance(result["steps"], list)
        assert isinstance(result["test_types_required"], list)

    def test_to_dict_step_structure(self, builder, temp_dir):
        """Test that step dictionaries have correct structure."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")
        result = builder.to_dict(strategy)

        assert len(result["steps"]) > 0
        step = result["steps"][0]

        assert "name" in step
        assert "command" in step
        assert "expected_outcome" in step
        assert "type" in step
        assert "required" in step
        assert "blocking" in step

    def test_to_json_serializable(self, builder, temp_dir):
        """Test that result is JSON serializable."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")
        result = builder.to_dict(strategy)

        # Should not raise
        json_str = json.dumps(result)
        assert isinstance(json_str, str)


# =============================================================================
# CONVENIENCE FUNCTION TESTS
# =============================================================================


class TestConvenienceFunctions:
    """Tests for convenience functions."""

    def test_build_validation_strategy(self, temp_dir):
        """Test build_validation_strategy convenience function."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        strategy = build_validation_strategy(temp_dir, temp_dir, "medium")

        assert isinstance(strategy, ValidationStrategy)
        assert strategy.project_type == "python_api"

    def test_get_strategy_as_dict(self, temp_dir):
        """Test get_strategy_as_dict convenience function."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        result = get_strategy_as_dict(temp_dir, temp_dir, "medium")

        assert isinstance(result, dict)
        assert result["project_type"] == "python_api"


# =============================================================================
# EDGE CASES
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_nonexistent_directory(self, builder):
        """Test handling of non-existent directory."""
        fake_dir = Path("/tmp/test-nonexistent-validation-123456")

        # Should not crash, returns unknown
        strategy = builder.build_strategy(fake_dir, fake_dir, "medium")
        assert strategy.project_type == "unknown"

    def test_empty_risk_level_defaults_medium(self, builder, temp_dir):
        """Test that None risk level defaults to medium."""
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        # When no risk level and no assessment file
        strategy = builder.build_strategy(temp_dir, temp_dir, None)

        # Should default to medium
        assert strategy.risk_level == "medium"

    def test_nextjs_priority_over_react(self, temp_dir):
        """Test that Next.js is detected over plain React."""
        (temp_dir / "package.json").write_text(json.dumps({
            "dependencies": {
                "next": "^14.0.0",
                "react": "^18.0.0",
                "react-dom": "^18.0.0"
            }
        }))

        # Next.js should take priority
        assert detect_project_type(temp_dir) == "nextjs"

    def test_python_with_pyproject_and_requirements(self, temp_dir):
        """Test Python detection with both pyproject.toml and requirements.txt."""
        (temp_dir / "pyproject.toml").write_text('[project]\nname = "test"')
        (temp_dir / "requirements.txt").write_text("fastapi==0.100.0\n")

        # Should still detect as python_api
        assert detect_project_type(temp_dir) == "python_api"


# =============================================================================
# FULLSTACK PROJECT TESTS
# =============================================================================


class TestFullstackProjects:
    """Tests for fullstack framework strategies."""

    def test_nextjs_strategy_has_api_tests(self, builder, temp_dir):
        """Test Next.js includes API tests for medium+ risk."""
        (temp_dir / "package.json").write_text(json.dumps({
            "dependencies": {"next": "^14.0.0"}
        }))

        strategy = builder.build_strategy(temp_dir, temp_dir, "medium")

        assert strategy.project_type == "nextjs"
        step_names = [s.name.lower() for s in strategy.steps]
        assert any("api" in name or "integration" in name for name in step_names)

    def test_nextjs_high_risk_has_e2e(self, builder, temp_dir):
        """Test Next.js high risk includes E2E tests."""
        (temp_dir / "package.json").write_text(json.dumps({
            "dependencies": {"next": "^14.0.0"}
        }))

        strategy = builder.build_strategy(temp_dir, temp_dir, "high")

        assert "e2e" in strategy.test_types_required

#!/usr/bin/env python3
"""
Tests for QA Report - Project Detection
========================================

Tests the no-test project detection functionality of qa/report.py including:
- check_test_discovery()
- is_no_test_project()
"""

import json
import sys
from pathlib import Path

import pytest

# Add tests directory to path for helper imports
sys.path.insert(0, str(Path(__file__).parent))

# Setup mocks before importing auto-claude modules
from qa_report_helpers import cleanup_qa_report_mocks, setup_qa_report_mocks

# Setup mocks
setup_qa_report_mocks()

# Import report functions after mocking
from qa.report import (
    check_test_discovery,
    is_no_test_project,
)

# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield  # Run all tests first
    cleanup_qa_report_mocks()


# =============================================================================
# TEST DISCOVERY TESTS
# =============================================================================


class TestCheckTestDiscovery:
    """Tests for check_test_discovery() function."""

    def test_no_discovery_file(self, spec_dir: Path) -> None:
        """Test when discovery file doesn't exist."""
        result = check_test_discovery(spec_dir)
        assert result is None

    def test_valid_discovery_file(self, spec_dir: Path) -> None:
        """Test reading valid discovery file."""
        discovery = {
            "frameworks": [{"name": "pytest", "type": "unit"}],
            "test_directories": ["tests/"]
        }
        discovery_file = spec_dir / "test_discovery.json"
        with open(discovery_file, "w") as f:
            json.dump(discovery, f)

        result = check_test_discovery(spec_dir)

        assert result is not None
        assert len(result["frameworks"]) == 1

    def test_invalid_json(self, spec_dir: Path) -> None:
        """Test handling of invalid JSON."""
        discovery_file = spec_dir / "test_discovery.json"
        discovery_file.write_text("invalid json{")

        result = check_test_discovery(spec_dir)
        assert result is None

    def test_empty_json(self, spec_dir: Path) -> None:
        """Test handling of empty JSON object."""
        discovery_file = spec_dir / "test_discovery.json"
        discovery_file.write_text("{}")

        result = check_test_discovery(spec_dir)
        assert result == {}


# =============================================================================
# NO-TEST PROJECT DETECTION TESTS
# =============================================================================


class TestIsNoTestProject:
    """Tests for is_no_test_project() function."""

    def test_empty_project_is_no_test(self, spec_dir: Path, project_dir: Path) -> None:
        """Test that empty project has no tests."""
        result = is_no_test_project(spec_dir, project_dir)
        assert result is True

    # Python test configuration files
    def test_project_with_pytest_ini(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of pytest.ini."""
        (project_dir / "pytest.ini").write_text("[pytest]")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_pyproject_toml(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of pyproject.toml."""
        (project_dir / "pyproject.toml").write_text("[tool.pytest]")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_setup_cfg(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of setup.cfg."""
        (project_dir / "setup.cfg").write_text("[options]")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    # JavaScript test configuration files
    def test_project_with_jest_config(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of Jest config."""
        (project_dir / "jest.config.js").write_text("module.exports = {}")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_jest_config_ts(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of Jest TypeScript config."""
        (project_dir / "jest.config.ts").write_text("export default {}")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_vitest_config(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of Vitest config."""
        (project_dir / "vitest.config.js").write_text("export default {}")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_vitest_config_ts(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of Vitest TypeScript config."""
        (project_dir / "vitest.config.ts").write_text("export default {}")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_karma_config(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of Karma config."""
        (project_dir / "karma.conf.js").write_text("module.exports = function() {}")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_cypress_config(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of Cypress config."""
        (project_dir / "cypress.config.js").write_text("module.exports = {}")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_playwright_config(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of Playwright config."""
        (project_dir / "playwright.config.ts").write_text("export default {}")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    # Ruby test configuration files
    def test_project_with_rspec(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of RSpec config."""
        (project_dir / ".rspec").write_text("--format documentation")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_rspec_helper(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of RSpec helper."""
        spec_dir_ruby = project_dir / "spec"
        spec_dir_ruby.mkdir()
        (spec_dir_ruby / "spec_helper.rb").write_text("RSpec.configure")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    # Test directories and files
    def test_project_with_test_directory(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of test directory."""
        tests_dir = project_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "test_app.py").write_text("def test_example(): pass")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_test_directory_no_test_files(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of empty test directory."""
        tests_dir = project_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "conftest.py").write_text("# fixtures only")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is True

    def test_project_with_spec_files(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of spec files."""
        tests_dir = project_dir / "__tests__"
        tests_dir.mkdir()
        (tests_dir / "app.spec.js").write_text("describe('app', () => {})")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_test_files_js(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of .test.js files."""
        tests_dir = project_dir / "__tests__"
        tests_dir.mkdir()
        (tests_dir / "app.test.js").write_text("test('works', () => {})")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_test_files_ts(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of .test.ts files."""
        tests_dir = project_dir / "test"
        tests_dir.mkdir()
        (tests_dir / "app.test.ts").write_text("test('works', () => {})")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_spec_files_ts(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of .spec.ts files."""
        tests_dir = project_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "app.spec.ts").write_text("describe('app', () => {})")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_project_with_python_test_suffix(self, spec_dir: Path, project_dir: Path) -> None:
        """Test detection of _test.py files."""
        tests_dir = project_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "app_test.py").write_text("def test_example(): pass")

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    # Discovery JSON integration
    def test_uses_discovery_json_if_available(self, spec_dir: Path, project_dir: Path) -> None:
        """Test that discovery.json takes precedence."""
        # Project has no test files
        # But discovery.json says there are frameworks
        discovery = {"frameworks": [{"name": "pytest"}]}
        discovery_file = spec_dir / "test_discovery.json"
        with open(discovery_file, "w") as f:
            json.dump(discovery, f)

        result = is_no_test_project(spec_dir, project_dir)
        assert result is False

    def test_empty_discovery_means_no_tests(self, spec_dir: Path, project_dir: Path) -> None:
        """Test that empty discovery means no tests."""
        discovery = {"frameworks": []}
        discovery_file = spec_dir / "test_discovery.json"
        with open(discovery_file, "w") as f:
            json.dump(discovery, f)

        result = is_no_test_project(spec_dir, project_dir)
        assert result is True

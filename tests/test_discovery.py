#!/usr/bin/env python3
"""
Tests for the test_discovery module.

Tests cover:
- Framework detection for various languages
- Package manager detection
- Test directory discovery
- Test file detection
- Command extraction
"""

import json
import tempfile
from pathlib import Path

import pytest

# Add auto-claude to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from test_discovery import (
    TestFramework,
    TestDiscoveryResult,
    TestDiscovery,
    discover_tests,
    get_test_command,
    get_test_frameworks,
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
def discovery():
    """Create a TestDiscovery instance."""
    return TestDiscovery()


# =============================================================================
# PACKAGE MANAGER DETECTION
# =============================================================================


class TestPackageManagerDetection:
    """Tests for package manager detection."""

    def test_detect_npm(self, discovery, temp_dir):
        """Test npm detection via package-lock.json."""
        (temp_dir / "package-lock.json").write_text("{}")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "npm"

    def test_detect_yarn(self, discovery, temp_dir):
        """Test yarn detection via yarn.lock."""
        (temp_dir / "yarn.lock").write_text("")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "yarn"

    def test_detect_pnpm(self, discovery, temp_dir):
        """Test pnpm detection via pnpm-lock.yaml."""
        (temp_dir / "pnpm-lock.yaml").write_text("")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "pnpm"

    def test_detect_bun(self, discovery, temp_dir):
        """Test bun detection via bun.lockb."""
        (temp_dir / "bun.lockb").write_bytes(b"")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "bun"

    def test_detect_bun_text_lockfile(self, discovery, temp_dir):
        """Test bun detection via bun.lock (text format, Bun 1.2.0+)."""
        (temp_dir / "bun.lock").write_text("")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "bun"

    def test_detect_uv(self, discovery, temp_dir):
        """Test uv detection via uv.lock."""
        (temp_dir / "uv.lock").write_text("")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "uv"

    def test_detect_poetry(self, discovery, temp_dir):
        """Test poetry detection via poetry.lock."""
        (temp_dir / "poetry.lock").write_text("")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "poetry"

    def test_detect_cargo(self, discovery, temp_dir):
        """Test cargo detection via Cargo.lock."""
        (temp_dir / "Cargo.lock").write_text("")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "cargo"

    def test_detect_bundler(self, discovery, temp_dir):
        """Test bundler detection via Gemfile.lock."""
        (temp_dir / "Gemfile.lock").write_text("")
        result = discovery.discover(temp_dir)
        assert result.package_manager == "bundler"


# =============================================================================
# JAVASCRIPT FRAMEWORK DETECTION
# =============================================================================


class TestJSFrameworkDetection:
    """Tests for JavaScript test framework detection."""

    def test_detect_jest_from_dependencies(self, discovery, temp_dir):
        """Test Jest detection from package.json dependencies."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)

        assert len(result.frameworks) > 0
        framework_names = [f.name for f in result.frameworks]
        assert "jest" in framework_names

    def test_detect_jest_version(self, discovery, temp_dir):
        """Test Jest version extraction."""
        pkg = {"devDependencies": {"jest": "^29.5.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)
        jest = next(f for f in result.frameworks if f.name == "jest")
        assert jest.version == "29.5.0"

    def test_detect_jest_config_file(self, discovery, temp_dir):
        """Test Jest config file detection."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))
        (temp_dir / "jest.config.js").write_text("module.exports = {}")

        result = discovery.discover(temp_dir)
        jest = next(f for f in result.frameworks if f.name == "jest")
        assert jest.config_file == "jest.config.js"

    def test_detect_vitest(self, discovery, temp_dir):
        """Test Vitest detection."""
        pkg = {"devDependencies": {"vitest": "^1.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "vitest" in framework_names

    def test_detect_playwright(self, discovery, temp_dir):
        """Test Playwright detection."""
        pkg = {"devDependencies": {"@playwright/test": "^1.40.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "playwright" in framework_names

        playwright = next(f for f in result.frameworks if f.name == "playwright")
        assert playwright.type == "e2e"

    def test_detect_cypress(self, discovery, temp_dir):
        """Test Cypress detection."""
        pkg = {"devDependencies": {"cypress": "^13.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "cypress" in framework_names

        cypress = next(f for f in result.frameworks if f.name == "cypress")
        assert cypress.type == "e2e"

    def test_detect_from_test_script(self, discovery, temp_dir):
        """Test framework detection from npm test script."""
        pkg = {
            "scripts": {"test": "vitest run"},
            "devDependencies": {},
        }
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)

        # Should infer from script
        framework_names = [f.name for f in result.frameworks]
        assert "vitest" in framework_names or "npm_test" in framework_names

    def test_ignore_empty_test_script(self, discovery, temp_dir):
        """Test that default empty test script is ignored."""
        pkg = {
            "scripts": {"test": 'echo "Error: no test specified" && exit 1'},
            "devDependencies": {},
        }
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)
        assert len(result.frameworks) == 0


# =============================================================================
# PYTHON FRAMEWORK DETECTION
# =============================================================================


class TestPythonFrameworkDetection:
    """Tests for Python test framework detection."""

    def test_detect_pytest_from_requirements(self, discovery, temp_dir):
        """Test pytest detection from requirements.txt."""
        (temp_dir / "requirements.txt").write_text("pytest==7.4.0\n")

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "pytest" in framework_names

    def test_detect_pytest_from_pyproject(self, discovery, temp_dir):
        """Test pytest detection from pyproject.toml."""
        pyproject = """
[project]
dependencies = ["pytest>=7.0.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]
"""
        (temp_dir / "pyproject.toml").write_text(pyproject)

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "pytest" in framework_names

    def test_detect_pytest_from_conftest(self, discovery, temp_dir):
        """Test pytest detection from conftest.py presence."""
        (temp_dir / "conftest.py").write_text("import pytest\n")

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "pytest" in framework_names

    def test_detect_pytest_from_tests_conftest(self, discovery, temp_dir):
        """Test pytest detection from tests/conftest.py."""
        tests_dir = temp_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "conftest.py").write_text("import pytest\n")

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "pytest" in framework_names

    def test_detect_pytest_ini(self, discovery, temp_dir):
        """Test pytest.ini config file detection."""
        (temp_dir / "pytest.ini").write_text("[pytest]\ntestpaths = tests\n")
        (temp_dir / "requirements.txt").write_text("pytest\n")

        result = discovery.discover(temp_dir)

        pytest_fw = next(f for f in result.frameworks if f.name == "pytest")
        assert pytest_fw.config_file == "pytest.ini"


# =============================================================================
# OTHER LANGUAGE FRAMEWORK DETECTION
# =============================================================================


class TestOtherLanguageFrameworks:
    """Tests for Rust, Go, and Ruby framework detection."""

    def test_detect_cargo_test(self, discovery, temp_dir):
        """Test Rust cargo test detection."""
        (temp_dir / "Cargo.toml").write_text('[package]\nname = "test"')

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "cargo_test" in framework_names

        cargo = next(f for f in result.frameworks if f.name == "cargo_test")
        assert cargo.command == "cargo test"

    def test_detect_go_test(self, discovery, temp_dir):
        """Test Go test detection."""
        (temp_dir / "go.mod").write_text("module test")

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "go_test" in framework_names

        go = next(f for f in result.frameworks if f.name == "go_test")
        assert go.command == "go test ./..."

    def test_detect_rspec(self, discovery, temp_dir):
        """Test RSpec detection."""
        (temp_dir / "Gemfile").write_text('gem "rspec"')

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "rspec" in framework_names

    def test_detect_rspec_with_dotfile(self, discovery, temp_dir):
        """Test RSpec detection via .rspec file."""
        (temp_dir / "Gemfile").write_text('gem "rails"')
        (temp_dir / ".rspec").write_text("--format documentation\n")

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "rspec" in framework_names

        rspec = next(f for f in result.frameworks if f.name == "rspec")
        assert rspec.config_file == ".rspec"

    def test_detect_minitest(self, discovery, temp_dir):
        """Test Minitest detection."""
        (temp_dir / "Gemfile").write_text('gem "minitest"')

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "minitest" in framework_names


# =============================================================================
# TEST DIRECTORY DETECTION
# =============================================================================


class TestDirectoryDetection:
    """Tests for test directory detection."""

    def test_find_tests_directory(self, discovery, temp_dir):
        """Test finding 'tests' directory."""
        (temp_dir / "tests").mkdir()

        result = discovery.discover(temp_dir)

        assert "tests" in result.test_directories

    def test_find_test_directory(self, discovery, temp_dir):
        """Test finding 'test' directory."""
        (temp_dir / "test").mkdir()

        result = discovery.discover(temp_dir)

        assert "test" in result.test_directories

    def test_find_spec_directory(self, discovery, temp_dir):
        """Test finding 'spec' directory."""
        (temp_dir / "spec").mkdir()

        result = discovery.discover(temp_dir)

        assert "spec" in result.test_directories

    def test_find_dunder_tests_directory(self, discovery, temp_dir):
        """Test finding '__tests__' directory."""
        (temp_dir / "__tests__").mkdir()

        result = discovery.discover(temp_dir)

        assert "__tests__" in result.test_directories


# =============================================================================
# TEST FILE DETECTION
# =============================================================================


class TestFileDetection:
    """Tests for test file detection."""

    def test_detect_python_test_files(self, discovery, temp_dir):
        """Test detecting Python test files."""
        tests_dir = temp_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "test_main.py").write_text("def test_example(): pass")

        result = discovery.discover(temp_dir)

        assert result.has_tests is True

    def test_detect_js_test_files(self, discovery, temp_dir):
        """Test detecting JavaScript test files."""
        src_dir = temp_dir / "src"
        src_dir.mkdir()
        (src_dir / "app.test.js").write_text("test('example', () => {})")

        result = discovery.discover(temp_dir)

        assert result.has_tests is True

    def test_detect_ts_test_files(self, discovery, temp_dir):
        """Test detecting TypeScript test files."""
        (temp_dir / "component.spec.ts").write_text("describe('test', () => {})")

        result = discovery.discover(temp_dir)

        assert result.has_tests is True

    def test_no_tests_in_empty_project(self, discovery, temp_dir):
        """Test that empty project has no tests."""
        result = discovery.discover(temp_dir)

        assert result.has_tests is False


# =============================================================================
# SERIALIZATION
# =============================================================================


class TestSerialization:
    """Tests for result serialization."""

    def test_to_dict(self, discovery, temp_dir):
        """Test converting result to dictionary."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)
        result_dict = discovery.to_dict(result)

        assert isinstance(result_dict, dict)
        assert "frameworks" in result_dict
        assert "test_command" in result_dict
        assert "test_directories" in result_dict
        assert "has_tests" in result_dict

    def test_framework_dict_structure(self, discovery, temp_dir):
        """Test framework dictionary structure."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))
        (temp_dir / "jest.config.js").write_text("{}")

        result = discovery.discover(temp_dir)
        result_dict = discovery.to_dict(result)

        assert len(result_dict["frameworks"]) > 0
        framework = result_dict["frameworks"][0]

        assert "name" in framework
        assert "type" in framework
        assert "command" in framework
        assert "config_file" in framework

    def test_json_serializable(self, discovery, temp_dir):
        """Test that result is JSON serializable."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)
        result_dict = discovery.to_dict(result)

        # Should not raise
        json_str = json.dumps(result_dict)
        assert isinstance(json_str, str)


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


class TestConvenienceFunctions:
    """Tests for convenience functions."""

    def test_discover_tests(self, temp_dir):
        """Test discover_tests function."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discover_tests(temp_dir)

        assert isinstance(result, TestDiscoveryResult)

    def test_get_test_command(self, temp_dir):
        """Test get_test_command function."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        cmd = get_test_command(temp_dir)

        assert "jest" in cmd

    def test_get_test_frameworks(self, temp_dir):
        """Test get_test_frameworks function."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        frameworks = get_test_frameworks(temp_dir)

        assert isinstance(frameworks, list)
        assert "jest" in frameworks


# =============================================================================
# EDGE CASES
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases."""

    def test_invalid_package_json(self, discovery, temp_dir):
        """Test handling of invalid package.json."""
        (temp_dir / "package.json").write_text("not valid json")

        # Should not raise
        result = discovery.discover(temp_dir)
        assert isinstance(result, TestDiscoveryResult)

    def test_nonexistent_directory(self, discovery):
        """Test handling of non-existent directory."""
        fake_dir = Path("/nonexistent/path")

        # Should not raise
        result = discovery.discover(fake_dir)
        assert isinstance(result, TestDiscoveryResult)
        assert len(result.frameworks) == 0

    def test_multiple_frameworks(self, discovery, temp_dir):
        """Test detecting multiple frameworks."""
        pkg = {
            "devDependencies": {
                "jest": "^29.0.0",
                "@playwright/test": "^1.40.0",
            }
        }
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result = discovery.discover(temp_dir)

        framework_names = [f.name for f in result.frameworks]
        assert "jest" in framework_names
        assert "playwright" in framework_names

    def test_caching(self, discovery, temp_dir):
        """Test that results are cached."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        # First call
        result1 = discovery.discover(temp_dir)

        # Second call should use cache
        result2 = discovery.discover(temp_dir)

        assert result1 is result2

    def test_clear_cache(self, discovery, temp_dir):
        """Test cache clearing."""
        pkg = {"devDependencies": {"jest": "^29.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        result1 = discovery.discover(temp_dir)
        discovery.clear_cache()
        result2 = discovery.discover(temp_dir)

        assert result1 is not result2

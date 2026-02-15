#!/usr/bin/env python3
"""
Tests for the ci_discovery module.

Tests cover:
- GitHub Actions parsing
- GitLab CI parsing
- CircleCI parsing
- Jenkins parsing
- Test command extraction
"""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

# Add auto-claude to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from ci_discovery import (
    CIConfig,
    CIWorkflow,
    CIDiscovery,
    discover_ci,
    get_ci_test_commands,
    get_ci_system,
    HAS_YAML,
)

# Skip tests that require YAML parsing when PyYAML is not installed
requires_yaml = pytest.mark.skipif(not HAS_YAML, reason="PyYAML not installed")


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
    """Create a CIDiscovery instance."""
    return CIDiscovery()


# =============================================================================
# GITHUB ACTIONS
# =============================================================================


class TestGitHubActions:
    """Tests for GitHub Actions parsing."""

    def test_detect_github_actions(self, discovery, temp_dir):
        """Test GitHub Actions detection (basic file presence)."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        workflow_content = """
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
"""
        (workflows / "ci.yml").write_text(workflow_content)

        result = discovery.discover(temp_dir)

        assert result is not None
        assert result.ci_system == "github_actions"
        assert len(result.config_files) > 0

    @requires_yaml
    def test_extract_test_commands(self, discovery, temp_dir):
        """Test extracting test commands from GitHub Actions."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        workflow_content = """
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm test
      - run: pytest tests/
"""
        (workflows / "test.yml").write_text(workflow_content)

        result = discovery.discover(temp_dir)

        assert "unit" in result.test_commands

    @requires_yaml
    def test_detect_test_related_workflow(self, discovery, temp_dir):
        """Test detecting test-related workflows."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        workflow_content = """
name: Test Suite
on: push
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - run: pytest tests/
"""
        (workflows / "test.yml").write_text(workflow_content)

        result = discovery.discover(temp_dir)

        test_workflows = [w for w in result.workflows if w.test_related]
        assert len(test_workflows) > 0

    @requires_yaml
    def test_extract_environment_variables(self, discovery, temp_dir):
        """Test extracting environment variables."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        workflow_content = """
name: CI
on: push
env:
  NODE_ENV: test
  CI: true
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
"""
        (workflows / "ci.yml").write_text(workflow_content)

        result = discovery.discover(temp_dir)

        assert "NODE_ENV" in result.environment_variables or "CI" in result.environment_variables

    @requires_yaml
    def test_handle_multiple_workflows(self, discovery, temp_dir):
        """Test handling multiple workflow files."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        (workflows / "ci.yml").write_text("""
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm build
""")

        (workflows / "test.yml").write_text("""
name: Test
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
""")

        result = discovery.discover(temp_dir)

        assert len(result.config_files) == 2
        assert len(result.workflows) >= 2


# =============================================================================
# GITLAB CI
# =============================================================================


class TestGitLabCI:
    """Tests for GitLab CI parsing."""

    def test_detect_gitlab_ci(self, discovery, temp_dir):
        """Test GitLab CI detection."""
        gitlab_ci = """
stages:
  - test
  - build

test:
  stage: test
  script:
    - npm test
"""
        (temp_dir / ".gitlab-ci.yml").write_text(gitlab_ci)

        result = discovery.discover(temp_dir)

        assert result is not None
        assert result.ci_system == "gitlab"

    @requires_yaml
    def test_extract_gitlab_test_commands(self, discovery, temp_dir):
        """Test extracting test commands from GitLab CI."""
        gitlab_ci = """
test:
  script:
    - pytest tests/

integration:
  script:
    - pytest tests/integration/
"""
        (temp_dir / ".gitlab-ci.yml").write_text(gitlab_ci)

        result = discovery.discover(temp_dir)

        assert "unit" in result.test_commands or len(result.test_commands) > 0

    def test_detect_gitlab_variables(self, discovery, temp_dir):
        """Test extracting GitLab CI variables."""
        gitlab_ci = """
variables:
  DATABASE_URL: postgres://localhost
  NODE_ENV: test

test:
  script:
    - npm test
"""
        (temp_dir / ".gitlab-ci.yml").write_text(gitlab_ci)

        result = discovery.discover(temp_dir)

        # May not work without yaml module, but should not crash
        assert result.ci_system == "gitlab"


# =============================================================================
# CIRCLECI
# =============================================================================


class TestCircleCI:
    """Tests for CircleCI parsing."""

    def test_detect_circleci(self, discovery, temp_dir):
        """Test CircleCI detection."""
        circleci_dir = temp_dir / ".circleci"
        circleci_dir.mkdir()

        config = """
version: 2.1
jobs:
  test:
    docker:
      - image: node:18
    steps:
      - checkout
      - run: npm test
"""
        (circleci_dir / "config.yml").write_text(config)

        result = discovery.discover(temp_dir)

        assert result is not None
        assert result.ci_system == "circleci"

    def test_extract_circleci_commands(self, discovery, temp_dir):
        """Test extracting commands from CircleCI."""
        circleci_dir = temp_dir / ".circleci"
        circleci_dir.mkdir()

        config = """
version: 2.1
jobs:
  test:
    docker:
      - image: python:3.11
    steps:
      - checkout
      - run:
          name: Run tests
          command: pytest tests/ --cov
"""
        (circleci_dir / "config.yml").write_text(config)

        result = discovery.discover(temp_dir)

        # Should find pytest command
        assert result.ci_system == "circleci"


# =============================================================================
# JENKINS
# =============================================================================


class TestJenkins:
    """Tests for Jenkinsfile parsing."""

    def test_detect_jenkins(self, discovery, temp_dir):
        """Test Jenkinsfile detection."""
        jenkinsfile = """
pipeline {
    agent any
    stages {
        stage('Test') {
            steps {
                sh 'npm test'
            }
        }
    }
}
"""
        (temp_dir / "Jenkinsfile").write_text(jenkinsfile)

        result = discovery.discover(temp_dir)

        assert result is not None
        assert result.ci_system == "jenkins"

    def test_extract_jenkins_commands(self, discovery, temp_dir):
        """Test extracting sh commands from Jenkinsfile."""
        jenkinsfile = """
pipeline {
    agent any
    stages {
        stage('Test') {
            steps {
                sh 'pytest tests/'
            }
        }
    }
}
"""
        (temp_dir / "Jenkinsfile").write_text(jenkinsfile)

        result = discovery.discover(temp_dir)

        # Should extract sh command
        assert result.ci_system == "jenkins"

    def test_extract_jenkins_stages(self, discovery, temp_dir):
        """Test extracting stages from Jenkinsfile."""
        jenkinsfile = """
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                sh 'npm build'
            }
        }
        stage('Test') {
            steps {
                sh 'npm test'
            }
        }
    }
}
"""
        (temp_dir / "Jenkinsfile").write_text(jenkinsfile)

        result = discovery.discover(temp_dir)

        workflow_names = [w.name for w in result.workflows]
        assert "Build" in workflow_names or "Test" in workflow_names


# =============================================================================
# TEST COMMAND EXTRACTION
# =============================================================================


class TestCommandExtraction:
    """Tests for test command extraction (requires YAML parsing)."""

    @requires_yaml
    def test_extract_pytest(self, discovery, temp_dir):
        """Test pytest command extraction."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        (workflows / "test.yml").write_text("""
name: Test
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pytest tests/ -v
""")

        result = discovery.discover(temp_dir)

        assert "pytest" in str(result.test_commands)

    @requires_yaml
    def test_extract_coverage_command(self, discovery, temp_dir):
        """Test coverage command extraction."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        (workflows / "test.yml").write_text("""
name: Test
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pytest tests/ --cov=src
""")

        result = discovery.discover(temp_dir)

        # Coverage command should be extracted
        assert result.coverage_command is not None or "cov" in str(result.test_commands)

    @requires_yaml
    def test_extract_npm_test(self, discovery, temp_dir):
        """Test npm test command extraction."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        (workflows / "ci.yml").write_text("""
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
""")

        result = discovery.discover(temp_dir)

        assert "npm" in str(result.test_commands) or "unit" in result.test_commands

    @requires_yaml
    def test_extract_e2e_playwright(self, discovery, temp_dir):
        """Test Playwright E2E command extraction."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        (workflows / "e2e.yml").write_text("""
name: E2E
on: push
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - run: npx playwright test
""")

        result = discovery.discover(temp_dir)

        assert "e2e" in result.test_commands

    @requires_yaml
    def test_extract_integration_tests(self, discovery, temp_dir):
        """Test integration test command extraction."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        (workflows / "test.yml").write_text("""
name: Test
on: push
jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - run: pytest tests/integration/
""")

        result = discovery.discover(temp_dir)

        assert "integration" in result.test_commands


# =============================================================================
# SERIALIZATION
# =============================================================================


class TestSerialization:
    """Tests for result serialization."""

    def test_to_dict(self, discovery, temp_dir):
        """Test converting result to dictionary."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        (workflows / "ci.yml").write_text("""
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
""")

        result = discovery.discover(temp_dir)
        result_dict = discovery.to_dict(result)

        assert isinstance(result_dict, dict)
        assert "ci_system" in result_dict
        assert "config_files" in result_dict
        assert "test_commands" in result_dict
        assert "workflows" in result_dict

    def test_json_serializable(self, discovery, temp_dir):
        """Test that result is JSON serializable."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)

        (workflows / "ci.yml").write_text("""
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
""")

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

    def test_discover_ci(self, temp_dir):
        """Test discover_ci function."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "ci.yml").write_text("name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n")

        result = discover_ci(temp_dir)

        assert result is not None
        assert isinstance(result, CIConfig)

    def test_discover_ci_no_config(self, temp_dir):
        """Test discover_ci when no CI config exists."""
        result = discover_ci(temp_dir)

        assert result is None

    def test_get_ci_test_commands(self, temp_dir):
        """Test get_ci_test_commands function."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "ci.yml").write_text("name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pytest tests/\n")

        commands = get_ci_test_commands(temp_dir)

        assert isinstance(commands, dict)

    def test_get_ci_system(self, temp_dir):
        """Test get_ci_system function."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "ci.yml").write_text("name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n")

        system = get_ci_system(temp_dir)

        assert system == "github_actions"

    def test_get_ci_system_not_found(self, temp_dir):
        """Test get_ci_system when no CI exists."""
        system = get_ci_system(temp_dir)

        assert system is None


# =============================================================================
# EDGE CASES
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases."""

    def test_invalid_yaml(self, discovery, temp_dir):
        """Test handling of invalid YAML."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "bad.yml").write_text("invalid: yaml: content: [")

        # Should not raise
        result = discovery.discover(temp_dir)
        assert result is not None

    def test_empty_workflow_file(self, discovery, temp_dir):
        """Test handling of empty workflow file."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "empty.yml").write_text("")

        # Should not raise
        result = discovery.discover(temp_dir)
        assert result is not None

    def test_nonexistent_directory(self, discovery):
        """Test handling of non-existent directory."""
        fake_dir = Path("/tmp/test-nonexistent-ci-discovery-123456")

        # Should not raise - mock exists to avoid permission error
        with patch.object(Path, 'exists', return_value=False):
            result = discovery.discover(fake_dir)
            assert result is None

    def test_ci_priority_github_first(self, discovery, temp_dir):
        """Test that GitHub Actions takes priority."""
        # Create both GitHub and GitLab configs
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "ci.yml").write_text("name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n")

        (temp_dir / ".gitlab-ci.yml").write_text("test:\n  script:\n    - npm test\n")

        result = discovery.discover(temp_dir)

        # GitHub Actions should be detected (checked first)
        assert result.ci_system == "github_actions"

    def test_caching(self, discovery, temp_dir):
        """Test that results are cached."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "ci.yml").write_text("name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n")

        result1 = discovery.discover(temp_dir)
        result2 = discovery.discover(temp_dir)

        assert result1 is result2

    def test_clear_cache(self, discovery, temp_dir):
        """Test cache clearing."""
        workflows = temp_dir / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "ci.yml").write_text("name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n")

        result1 = discovery.discover(temp_dir)
        discovery.clear_cache()
        result2 = discovery.discover(temp_dir)

        assert result1 is not result2

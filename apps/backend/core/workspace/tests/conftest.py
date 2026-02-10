#!/usr/bin/env python3
"""
Pytest Configuration and Shared Fixtures for Workspace Tests
==============================================================

Provides test fixtures for the workspace module tests.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Generator
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# =============================================================================
# MODULE MOCK CLEANUP - Prevents test isolation issues
# =============================================================================

# List of modules that might be mocked by test files
_POTENTIALLY_MOCKED_MODULES = [
    "claude_code_sdk",
    "claude_code_sdk.types",
    "claude_agent_sdk",
    "claude_agent_sdk.types",
]

# Store original module references at import time (BEFORE pre-mocking)
_original_module_state = {}
for _name in _POTENTIALLY_MOCKED_MODULES:
    if _name in sys.modules:
        _original_module_state[_name] = sys.modules[_name]


# =============================================================================
# PRE-MOCK EXTERNAL SDK MODULES - Must happen BEFORE adding auto-claude to path
# =============================================================================
# These SDK modules may not be installed, so we mock them before any imports
# that might trigger loading code that depends on them.


def _create_sdk_mock():
    """Create a comprehensive mock for SDK modules."""
    mock = MagicMock()
    mock.ClaudeAgentOptions = MagicMock
    mock.ClaudeSDKClient = MagicMock
    mock.HookMatcher = MagicMock
    return mock


# Pre-mock claude_agent_sdk if not installed
if "claude_agent_sdk" not in sys.modules:
    sys.modules["claude_agent_sdk"] = _create_sdk_mock()
    sys.modules["claude_agent_sdk.types"] = MagicMock()

# Pre-mock claude_code_sdk if not installed
if "claude_code_sdk" not in sys.modules:
    sys.modules["claude_code_sdk"] = _create_sdk_mock()
    sys.modules["claude_code_sdk.types"] = MagicMock()

# Add backend directory to path for imports
# When co-located at workspace/tests/, go up to backend directory
# workspace/tests -> workspace -> core -> backend (4 levels up)
_backend = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(_backend))

# Add repo root to sys.path for test_fixtures import fallback
_repo_root = _backend.parent.parent
sys.path.insert(0, str(_repo_root))


def _cleanup_mocked_modules():
    """Remove any MagicMock modules from sys.modules."""
    for name in _POTENTIALLY_MOCKED_MODULES:
        if name in sys.modules:
            module = sys.modules[name]
            if isinstance(module, MagicMock):
                if name in _original_module_state:
                    sys.modules[name] = _original_module_state[name]
                else:
                    del sys.modules[name]


def pytest_sessionstart(session):
    """Clean up any mocked modules before the test session starts."""
    _cleanup_mocked_modules()


# =============================================================================
# DIRECTORY FIXTURES
# =============================================================================


@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory that's cleaned up after the test."""
    temp_path = Path(tempfile.mkdtemp())
    yield temp_path
    shutil.rmtree(temp_path, ignore_errors=True)


@pytest.fixture
def temp_git_repo(temp_dir: Path) -> Generator[Path, None, None]:
    """Create a temporary git repository with initial commit.

    IMPORTANT: This fixture properly isolates git operations by clearing
    git environment variables that may be set by pre-commit hooks. Without
    this isolation, git operations could affect the parent repository when
    tests run inside a git worktree (e.g., during pre-commit validation).

    See: https://git-scm.com/docs/git#_environment_variables
    """
    # Save original environment values to restore later
    orig_env = {}

    # These git env vars may be set by pre-commit hooks and MUST be cleared
    # to avoid git operations affecting the parent repository instead of
    # our isolated test repo. This is critical when running inside worktrees.
    git_vars_to_clear = [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ]

    # Clear interfering git environment variables
    for key in git_vars_to_clear:
        orig_env[key] = os.environ.get(key)
        if key in os.environ:
            del os.environ[key]

    # Set GIT_CEILING_DIRECTORIES to prevent git from discovering parent .git
    # directories. This is critical for test isolation when running inside
    # another git repo (like during pre-commit hooks in worktrees).
    orig_env["GIT_CEILING_DIRECTORIES"] = os.environ.get("GIT_CEILING_DIRECTORIES")
    os.environ["GIT_CEILING_DIRECTORIES"] = str(temp_dir.parent)

    try:
        # Initialize git repo
        subprocess.run(["git", "init"], cwd=temp_dir, capture_output=True, check=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=temp_dir,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=temp_dir,
            capture_output=True,
        )

        # Create initial commit
        test_file = temp_dir / "README.md"
        test_file.write_text("# Test Project\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial commit"], cwd=temp_dir, capture_output=True
        )

        # Ensure branch is named 'main' (some git configs default to 'master')
        subprocess.run(
            ["git", "branch", "-M", "main"], cwd=temp_dir, capture_output=True
        )

        yield temp_dir
    finally:
        # Restore original environment variables
        for key, value in orig_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


@pytest.fixture
def spec_dir(temp_dir: Path) -> Path:
    """Create a spec directory inside temp_dir."""
    spec_path = temp_dir / "spec"
    spec_path.mkdir(parents=True)
    return spec_path


@pytest.fixture
def project_dir(temp_dir: Path) -> Path:
    """Create a project directory inside temp_dir."""
    project_path = temp_dir / "project"
    project_path.mkdir(parents=True)
    return project_path


@pytest.fixture
def make_commit(temp_git_repo: Path):
    """Fixture to make commits in the test git repo.

    Usage:
        def test_something(make_commit):
            make_commit("message", files={"file.txt": "content"})
    """

    def _make_commit(message: str, files: dict[str, str] | None = None):
        """Create a commit with the given message and files.

        Args:
            message: Commit message
            files: Optional dict of {filepath: content} to create before committing
        """
        if files:
            for file_path, content in files.items():
                full_path = temp_git_repo / file_path
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text(content, encoding="utf-8")

        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", message],
            cwd=temp_git_repo,
            capture_output=True,
        )

    return _make_commit


@pytest.fixture
def stage_files(temp_git_repo: Path):
    """Fixture to stage files in the test git repo.

    Usage:
        def test_something(stage_files):
            stage_files({"file.txt": "content"})
    """

    def _stage_files(files: dict[str, str]):
        """Stage files for commit.

        Args:
            files: Dict of {filepath: content} to create and stage
        """
        for file_path, content in files.items():
            full_path = temp_git_repo / file_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content, encoding="utf-8")

        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)

    return _stage_files

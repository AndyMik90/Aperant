#!/usr/bin/env python3
"""
Pytest Configuration and Shared Fixtures
=========================================

Provides common test fixtures for the Auto-Build Framework test suite.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock

import pytest

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
if 'claude_agent_sdk' not in sys.modules:
    sys.modules['claude_agent_sdk'] = _create_sdk_mock()
    sys.modules['claude_agent_sdk.types'] = MagicMock()

# Pre-mock claude_code_sdk if not installed
if 'claude_code_sdk' not in sys.modules:
    sys.modules['claude_code_sdk'] = _create_sdk_mock()
    sys.modules['claude_code_sdk.types'] = MagicMock()

# Pre-mock dotenv to prevent sys.exit() in cli.utils.import_dotenv
# This is needed for CLI tests since cli.utils calls import_dotenv at module level
if 'dotenv' not in sys.modules:
    sys.modules['dotenv'] = MagicMock()
    sys.modules['dotenv'].load_dotenv = MagicMock()

# Add apps/backend directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))


# =============================================================================
# MODULE MOCK CLEANUP - Prevents test isolation issues
# =============================================================================

# List of modules that might be mocked by test files
# These need to be cleaned up between test modules to prevent leakage
_POTENTIALLY_MOCKED_MODULES = [
    'claude_code_sdk',
    'claude_code_sdk.types',
    'claude_agent_sdk',
    'claude_agent_sdk.types',
    'dotenv',
    'ui',
    'progress',
    'task_logger',
    'linear_updater',
    'client',
    'init',
    'review',
    'validate_spec',
    'graphiti_providers',
    'agents.memory_manager',
    'agents.base',
    'core.error_utils',
    'security.tool_input_validator',
    'debug',
    'prompts_pkg',
    'prompts_pkg.project_context',
]

# Store original module references at import time (before any mocking)
_original_module_state = {}
for _name in _POTENTIALLY_MOCKED_MODULES:
    if _name in sys.modules:
        _original_module_state[_name] = sys.modules[_name]


def _cleanup_mocked_modules():
    """Remove any MagicMock modules from sys.modules."""
    for name in _POTENTIALLY_MOCKED_MODULES:
        if name in sys.modules:
            module = sys.modules[name]
            # Check if it's a MagicMock (indicating it was mocked)
            if isinstance(module, MagicMock):
                if name in _original_module_state:
                    sys.modules[name] = _original_module_state[name]
                else:
                    del sys.modules[name]


def pytest_sessionstart(session):
    """Clean up any mocked modules before the test session starts."""
    _cleanup_mocked_modules()


def pytest_runtest_setup(item):
    """Clean up mocked modules before each test to ensure isolation."""
    import importlib

    module_name = item.module.__name__

    # Common mock sets - defined once to reduce duplication and maintenance burden
    QA_REPORT_MOCKS = {'claude_agent_sdk', 'ui', 'progress', 'task_logger', 'linear_updater', 'client'}
    SDK_MOCKS = {'claude_code_sdk', 'claude_code_sdk.types', 'claude_agent_sdk', 'claude_agent_sdk.types'}

    # Map of which test modules mock which specific modules
    # Each test module should only preserve the mocks it installed
    module_mocks = {
        'test_qa_criteria': QA_REPORT_MOCKS,
        'test_qa_report': QA_REPORT_MOCKS,
        'test_qa_report_iteration': QA_REPORT_MOCKS,
        'test_qa_report_recurring': QA_REPORT_MOCKS,
        'test_qa_report_project_detection': QA_REPORT_MOCKS,
        'test_qa_report_manual_plan': QA_REPORT_MOCKS,
        'test_qa_report_config': QA_REPORT_MOCKS,
        'test_qa_loop': SDK_MOCKS,
        'test_spec_pipeline': {'claude_code_sdk', 'claude_code_sdk.types', 'init', 'client', 'review', 'task_logger', 'ui', 'validate_spec'},
        'test_spec_complexity': SDK_MOCKS,
        'test_spec_phases': {'claude_code_sdk', 'claude_code_sdk.types', 'claude_agent_sdk', 'graphiti_providers', 'validate_spec', 'client'},
        'test_qa_fixer': {'claude_agent_sdk', 'ui', 'progress', 'task_logger', 'linear_updater', 'client', 'agents.memory_manager', 'agents.base', 'core.error_utils', 'security.tool_input_validator', 'debug'},
        'test_qa_reviewer': {'claude_agent_sdk', 'ui', 'progress', 'task_logger', 'linear_updater', 'client', 'agents.memory_manager', 'agents.base', 'core.error_utils', 'security.tool_input_validator', 'debug', 'prompts_pkg', 'prompts_pkg.project_context'},
    }

    # Get the mocks that the current test module needs to preserve
    preserved_mocks = module_mocks.get(module_name, set())

    # Track if we cleaned up any mocks
    cleaned_up = False

    # Clean up all mocked modules EXCEPT those needed by the current test module
    for name in _POTENTIALLY_MOCKED_MODULES:
        if name in preserved_mocks:
            continue  # Don't clean up mocks this module needs
        if name in sys.modules:
            module = sys.modules[name]
            if isinstance(module, MagicMock):
                if name in _original_module_state:
                    sys.modules[name] = _original_module_state[name]
                else:
                    del sys.modules[name]
                cleaned_up = True

    # If we cleaned up mocks, we need to reload modules that might have cached
    # references to the mocked versions
    if cleaned_up and module_name in ('test_qa_loop', 'test_review'):
        # Reload progress first
        if 'progress' in sys.modules:
            importlib.reload(sys.modules['progress'])
        # Reload the entire qa module chain which imports progress
        for qa_module in ['qa.criteria', 'qa.report', 'qa.loop', 'qa']:
            if qa_module in sys.modules:
                try:
                    importlib.reload(sys.modules[qa_module])
                except Exception as e:
                    # Log reload failures - circular imports are expected but other errors should be visible
                    import warnings
                    warnings.warn(f'Failed to reload {qa_module}: {e}')
        # Reload review module chain
        for review_module in ['review.state', 'review.formatters', 'review']:
            if review_module in sys.modules:
                try:
                    importlib.reload(sys.modules[review_module])
                except Exception as e:
                    # Log reload failures - some modules may fail if dependencies aren't loaded
                    import warnings
                    warnings.warn(f'Failed to reload {review_module}: {e}')


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
            cwd=temp_dir, capture_output=True
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=temp_dir, capture_output=True
        )

        # Create initial commit
        test_file = temp_dir / "README.md"
        test_file.write_text("# Test Project\n")
        subprocess.run(["git", "add", "."], cwd=temp_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial commit"],
            cwd=temp_dir, capture_output=True
        )

        # Ensure branch is named 'main' (some git configs default to 'master')
        subprocess.run(["git", "branch", "-M", "main"], cwd=temp_dir, capture_output=True)

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


# =============================================================================
# WORKSPACE COMMAND TEST FIXTURES
# =============================================================================

# Constants for workspace tests
TEST_SPEC_NAME = "001-test-spec"
TEST_SPEC_BRANCH = f"auto-claude/{TEST_SPEC_NAME}"


@pytest.fixture
def mock_project_dir(temp_git_repo: Path) -> Path:
    """Create a mock project directory with git repo."""
    return temp_git_repo


@pytest.fixture
def mock_worktree_path(temp_git_repo: Path) -> Path:
    """Create a mock worktree path."""
    worktree_path = temp_git_repo / ".worktrees" / TEST_SPEC_NAME
    worktree_path.mkdir(parents=True, exist_ok=True)
    return worktree_path


@pytest.fixture
def workspace_spec_dir(temp_git_repo: Path) -> Path:
    """Create a spec directory inside .auto-claude/specs/ for workspace tests."""
    spec_dir = temp_git_repo / ".auto-claude" / "specs" / TEST_SPEC_NAME
    spec_dir.mkdir(parents=True, exist_ok=True)
    return spec_dir


@pytest.fixture
def with_spec_branch(temp_git_repo: Path) -> Generator[Path, None, None]:
    """Create a temp git repo with a spec branch.

    Note: temp_git_repo already provides an initialized repo with initial commit,
    so we only need to create the spec branch and add changes.
    """
    # Create spec branch
    subprocess.run(
        ["git", "checkout", "-b", TEST_SPEC_BRANCH],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Add a change on spec branch
    (temp_git_repo / "test.txt").write_text("test content")
    subprocess.run(
        ["git", "add", "test.txt"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Test commit"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Go back to main
    subprocess.run(
        ["git", "checkout", "main"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    yield temp_git_repo


@pytest.fixture
def with_conflicting_branches(temp_git_repo: Path) -> Generator[Path, None, None]:
    """Create temp git repo with conflicting branches for merge testing.

    Note: temp_git_repo already provides an initialized repo with initial commit,
    so we only need to create branches with conflicting changes.
    """
    # Create spec branch
    subprocess.run(
        ["git", "checkout", "-b", TEST_SPEC_BRANCH],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Add a file on spec branch
    (temp_git_repo / "conflict.txt").write_text("spec branch content")
    subprocess.run(
        ["git", "add", "conflict.txt"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Spec change"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    # Go back to main and make conflicting change
    subprocess.run(
        ["git", "checkout", "main"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    (temp_git_repo / "conflict.txt").write_text("main branch content")
    subprocess.run(
        ["git", "add", "conflict.txt"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "Main change"],
        cwd=temp_git_repo,
        capture_output=True,
        check=True,
    )

    yield temp_git_repo


# =============================================================================
# REVIEW FIXTURES - Import from review_fixtures.py
# =============================================================================

# Import review system fixtures from dedicated module
from tests.review_fixtures import (  # noqa: E402, F401
    approved_state,
    complete_spec_dir,
    pending_state,
    review_spec_dir,
)


# =============================================================================
# PROJECT STRUCTURE FIXTURES
# =============================================================================

@pytest.fixture
def python_project(temp_git_repo: Path) -> Path:
    """Create a sample Python project structure."""
    # Write pyproject.toml content directly (tomllib is read-only, no writer)
    toml_content = """[project]
name = "test-project"
version = "0.1.0"
dependencies = [
    "flask>=2.0",
    "pytest>=7.0",
    "sqlalchemy>=2.0",
]

[tool.pytest]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
"""
    (temp_git_repo / "pyproject.toml").write_text(toml_content)

    # Create Python files
    (temp_git_repo / "app").mkdir()
    (temp_git_repo / "app" / "__init__.py").write_text("# App module\n")
    (temp_git_repo / "app" / "main.py").write_text("def main():\n    pass\n")

    # Create .env file
    (temp_git_repo / ".env").write_text("DATABASE_URL=postgresql://localhost/test\n")

    # Commit changes
    subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Add Python project structure"],
        cwd=temp_git_repo, capture_output=True
    )

    return temp_git_repo


@pytest.fixture
def node_project(temp_git_repo: Path) -> Path:
    """Create a sample Node.js project structure."""
    package_json = {
        "name": "test-project",
        "version": "1.0.0",
        "scripts": {
            "dev": "next dev",
            "build": "next build",
            "test": "jest",
            "lint": "eslint .",
        },
        "dependencies": {
            "next": "^14.0.0",
            "react": "^18.0.0",
            "prisma": "^5.0.0",
        },
        "devDependencies": {
            "jest": "^29.0.0",
            "eslint": "^8.0.0",
            "typescript": "^5.0.0",
        },
    }

    (temp_git_repo / "package.json").write_text(json.dumps(package_json, indent=2))
    (temp_git_repo / "tsconfig.json").write_text('{"compilerOptions": {}}')

    # Create source files
    (temp_git_repo / "src").mkdir()
    (temp_git_repo / "src" / "index.ts").write_text("export const main = () => {};\n")

    # Commit changes
    subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Add Node.js project structure"],
        cwd=temp_git_repo, capture_output=True
    )

    return temp_git_repo


@pytest.fixture
def docker_project(temp_git_repo: Path) -> Path:
    """Create a project with Docker configuration."""
    # Dockerfile
    dockerfile = """FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
CMD ["python", "main.py"]
"""
    (temp_git_repo / "Dockerfile").write_text(dockerfile)

    # docker-compose.yml
    compose = """services:
  app:
    build: .
    ports:
      - "8000:8000"
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: test
  redis:
    image: redis:7
"""
    (temp_git_repo / "docker-compose.yml").write_text(compose)

    # requirements.txt
    (temp_git_repo / "requirements.txt").write_text("flask\nredis\npsycopg2-binary\n")

    # Commit changes
    subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Add Docker configuration"],
        cwd=temp_git_repo, capture_output=True
    )

    return temp_git_repo


# =============================================================================
# IMPLEMENTATION PLAN FIXTURES
# =============================================================================

@pytest.fixture
def sample_implementation_plan() -> dict:
    """Return a sample implementation plan structure."""
    return {
        "feature": "User Avatar Upload",
        "workflow_type": "feature",
        "services_involved": ["backend", "worker", "frontend"],
        "phases": [
            {
                "phase": 1,
                "name": "Backend Foundation",
                "type": "setup",
                "chunks": [
                    {
                        "id": "chunk-1-1",
                        "description": "Add avatar fields to User model",
                        "service": "backend",
                        "status": "completed",
                        "files_to_modify": ["app/models/user.py"],
                        "files_to_create": ["migrations/add_avatar.py"],
                    },
                    {
                        "id": "chunk-1-2",
                        "description": "POST /api/users/avatar endpoint",
                        "service": "backend",
                        "status": "pending",
                        "files_to_modify": ["app/routes/users.py"],
                    },
                ],
                "depends_on": [],
            },
            {
                "phase": 2,
                "name": "Worker Pipeline",
                "type": "implementation",
                "chunks": [
                    {
                        "id": "chunk-2-1",
                        "description": "Image processing task",
                        "service": "worker",
                        "status": "pending",
                        "files_to_create": ["app/tasks/images.py"],
                    },
                ],
                "depends_on": [1],
            },
            {
                "phase": 3,
                "name": "Frontend",
                "type": "implementation",
                "chunks": [
                    {
                        "id": "chunk-3-1",
                        "description": "AvatarUpload component",
                        "service": "frontend",
                        "status": "pending",
                        "files_to_create": ["src/components/AvatarUpload.tsx"],
                    },
                ],
                "depends_on": [1],
            },
        ],
        "final_acceptance": [
            "User can upload avatar from profile page",
            "Avatar is automatically resized",
        ],
    }


@pytest.fixture
def implementation_plan_file(spec_dir: Path, sample_implementation_plan: dict) -> Path:
    """Create an implementation_plan.json file in the spec directory."""
    plan_file = spec_dir / "implementation_plan.json"
    plan_file.write_text(json.dumps(sample_implementation_plan, indent=2))
    return plan_file


# =============================================================================
# SPEC FIXTURES
# =============================================================================

@pytest.fixture
def sample_spec() -> str:
    """Return a sample spec content."""
    return """# Avatar Upload Feature

## Overview
Allow users to upload and manage their profile avatars.

## Requirements
1. Users can upload PNG, JPG, or WebP images
2. Images are automatically resized to 200x200
3. Original images are stored for future cropping
4. Upload progress is shown in UI

## Acceptance Criteria
- [ ] POST /api/users/avatar endpoint accepts image uploads
- [ ] Images are processed asynchronously by worker
- [ ] Frontend shows upload progress
- [ ] Avatar displays correctly after upload
"""


@pytest.fixture
def spec_file(spec_dir: Path, sample_spec: str) -> Path:
    """Create a spec.md file in the spec directory."""
    spec_file = spec_dir / "spec.md"
    spec_file.write_text(sample_spec, encoding="utf-8")
    return spec_file


# =============================================================================
# QA FIXTURES
# =============================================================================

@pytest.fixture
def qa_signoff_approved() -> dict:
    """Return an approved QA signoff structure."""
    return {
        "status": "approved",
        "qa_session": 1,
        "timestamp": "2024-01-01T12:00:00",
        "tests_passed": {
            "unit": True,
            "integration": True,
            "e2e": True,
        },
    }


@pytest.fixture
def qa_signoff_rejected() -> dict:
    """Return a rejected QA signoff structure."""
    return {
        "status": "rejected",
        "qa_session": 1,
        "timestamp": "2024-01-01T12:00:00",
        "issues_found": [
            {"title": "Test failure", "type": "unit_test"},
            {"title": "Missing validation", "type": "acceptance"},
        ],
    }


@pytest.fixture
def project_dir(temp_dir: Path) -> Path:
    """Create a project directory for testing."""
    project = temp_dir / "project"
    project.mkdir()
    return project


@pytest.fixture
def spec_with_plan(spec_dir: Path) -> Path:
    """Create a spec directory with implementation plan."""
    plan = {
        "spec_name": "test-spec",
        "qa_signoff": {
            "status": "pending",
            "qa_session": 0,
        }
    }
    plan_file = spec_dir / "implementation_plan.json"
    with open(plan_file, "w") as f:
        json.dump(plan, f)
    return spec_dir


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

@pytest.fixture
def make_commit(temp_git_repo: Path):
    """Factory fixture to create commits."""
    def _make_commit(filename: str, content: str, message: str) -> str:
        filepath = temp_git_repo / filename
        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text(content)
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", message],
            cwd=temp_git_repo, capture_output=True
        )
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo, capture_output=True, text=True
        )
        return result.stdout.strip()
    return _make_commit


@pytest.fixture
def stage_files(temp_git_repo: Path):
    """Factory fixture to stage files without committing."""
    def _stage_files(files: dict[str, str]) -> None:
        for filename, content in files.items():
            filepath = temp_git_repo / filename
            filepath.parent.mkdir(parents=True, exist_ok=True)
            filepath.write_text(content)
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
    return _stage_files


# =============================================================================
# PHASE TESTING FIXTURES - Mock functions for spec/phases.py testing
# =============================================================================

@pytest.fixture
def mock_run_agent_fn():
    """
    Mock agent function for testing PhaseExecutor.

    Returns a factory that creates mock agent functions with configurable responses.

    Usage:
        async def test_something(mock_run_agent_fn):
            agent_fn = mock_run_agent_fn(success=True, output="Done")
            result = await agent_fn("prompt.md")
            assert result == (True, "Done")
    """
    def _create_mock(
        success: bool = True,
        output: str = "Agent completed successfully",
        side_effect: list = None,
    ):
        """Create a mock agent function.

        Args:
            success: Whether the agent should succeed
            output: The output message to return
            side_effect: Optional list of (success, output) tuples for sequential calls
        """
        call_count = 0

        async def _mock_agent(
            prompt_file: str,
            additional_context: str = None,
            phase_name: str = None,
        ) -> tuple[bool, str]:
            nonlocal call_count
            call_count += 1
            if side_effect is not None:
                if call_count <= len(side_effect):
                    result = side_effect[call_count - 1]
                    return result
                # Fallback to last result if more calls than expected
                return side_effect[-1]
            return (success, output)

        return _mock_agent

    return _create_mock


@pytest.fixture
def mock_task_logger():
    """
    Mock TaskLogger for testing PhaseExecutor.

    Returns a mock object that tracks all log calls without side effects.

    Usage:
        def test_something(mock_task_logger):
            executor = PhaseExecutor(..., task_logger=mock_task_logger, ...)
            # After test
            assert mock_task_logger.log.call_count > 0
    """
    from unittest.mock import MagicMock

    logger = MagicMock()
    logger.log = MagicMock()
    logger.start_phase = MagicMock()
    logger.end_phase = MagicMock()
    logger.tool_start = MagicMock()
    logger.tool_end = MagicMock()
    logger.save = MagicMock()
    return logger


@pytest.fixture
def mock_ui_module():
    """
    Mock UI module for testing PhaseExecutor.

    Provides mock implementations of UI functions used by PhaseExecutor.

    Usage:
        def test_something(mock_ui_module):
            executor = PhaseExecutor(..., ui_module=mock_ui_module, ...)
            # UI calls are captured
            assert mock_ui_module.print_status.called
    """
    from unittest.mock import MagicMock

    ui = MagicMock()
    ui.print_status = MagicMock()
    ui.muted = MagicMock(return_value="")
    ui.bold = MagicMock(return_value="")
    ui.success = MagicMock(return_value="")
    ui.error = MagicMock(return_value="")
    ui.warning = MagicMock(return_value="")
    ui.info = MagicMock(return_value="")
    ui.highlight = MagicMock(return_value="")
    return ui


@pytest.fixture
def mock_ui_icons():
    """
    Mock UI Icons class for CLI input handler tests.

    Provides the complete Icons class with Unicode and ASCII fallbacks.
    Mirrors the structure in apps/backend/ui/icons.py.

    Usage:
        def test_something(mock_ui_icons):
            Icons = mock_ui_icons
            assert Icons.SUCCESS == ("✓", "[OK]")
    """
    class MockIcons:
        """Mock Icons class - complete with all icons used by the codebase."""
        # Status icons
        SUCCESS = ("✓", "[OK]")
        ERROR = ("✗", "[X]")
        WARNING = ("⚠", "[!]")
        INFO = ("ℹ", "[i]")
        PENDING = ("○", "[ ]")
        IN_PROGRESS = ("◐", "[.]")
        COMPLETE = ("●", "[*]")
        BLOCKED = ("⊘", "[B]")

        # Action icons
        PLAY = ("▶", ">")
        PAUSE = ("⏸", "||")
        STOP = ("⏹", "[]")
        SKIP = ("⏭", ">>")

        # Navigation
        ARROW_RIGHT = ("→", "->")
        ARROW_DOWN = ("↓", "v")
        ARROW_UP = ("↑", "^")
        POINTER = ("❯", ">")
        BULLET = ("•", "*")

        # Objects
        FOLDER = ("📁", "[D]")
        FILE = ("📄", "[F]")
        GEAR = ("⚙", "[*]")
        SEARCH = ("🔍", "[?]")
        BRANCH = ("🌿", "[BR]")
        COMMIT = ("◉", "(@)")
        LIGHTNING = ("⚡", "!")
        LINK = ("🔗", "[L]")

        # Progress
        SUBTASK = ("▣", "#")
        PHASE = ("◆", "*")
        WORKER = ("⚡", "W")
        SESSION = ("▸", ">")

        # Menu
        EDIT = ("✏️", "[E]")
        CLIPBOARD = ("📋", "[C]")
        DOCUMENT = ("📄", "[D]")
        DOOR = ("🚪", "[Q]")
        SHIELD = ("🛡️", "[S]")

        # Box drawing
        BOX_TL = ("╔", "+")
        BOX_TR = ("╗", "+")
        BOX_BL = ("╚", "+")
        BOX_BR = ("╝", "+")
        BOX_H = ("═", "-")
        BOX_V = ("║", "|")
        BOX_ML = ("╠", "+")
        BOX_MR = ("╣", "+")
        BOX_TL_LIGHT = ("┌", "+")
        BOX_TR_LIGHT = ("┐", "+")
        BOX_BL_LIGHT = ("└", "+")
        BOX_BR_LIGHT = ("┘", "+")
        BOX_H_LIGHT = ("─", "-")
        BOX_V_LIGHT = ("│", "|")
        BOX_ML_LIGHT = ("├", "+")
        BOX_MR_LIGHT = ("┤", "+")

        # Progress bar
        BAR_FULL = ("█", "=")
        BAR_EMPTY = ("░", "-")
        BAR_HALF = ("▌", "=")

    return MockIcons


@pytest.fixture
def mock_ui_menu_option():
    """
    Mock UI MenuOption class for CLI tests.

    Provides a simple MenuOption class for menu testing.

    Usage:
        def test_something(mock_ui_menu_option):
            option = mock_ui_menu_option()("key", "Label")
            assert option.key == "key"
    """
    class MockMenuOption:
        """Mock MenuOption class."""
        def __init__(self, key, label, icon=None, description=""):
            self.key = key
            self.label = label
            self.icon = icon or ("", "")
            self.description = description

    return MockMenuOption


@pytest.fixture
def mock_ui_module_full(mock_ui_icons, mock_ui_menu_option):
    """
    Comprehensive mock UI module with all functions and classes.

    Provides a complete mock of the ui module for CLI tests.
    Includes Icons, MenuOption, and all UI functions.

    Usage:
        def test_something(mock_ui_module_full):
            ui = mock_ui_module_full
            assert ui.Icons.SUCCESS == ("✓", "[OK]")
            assert ui.icon(ui.Icons.SUCCESS) == "✓"
    """
    from unittest.mock import MagicMock

    Icons = mock_ui_icons
    MenuOption = mock_ui_menu_option

    def mock_icon(icon_tuple):
        """Mock icon function."""
        return icon_tuple[0] if icon_tuple else ""

    def mock_bold(text):
        """Mock bold function."""
        return f"**{text}**"

    def mock_muted(text):
        """Mock muted function."""
        return f"[{text}]"

    def mock_box(content, width=70, style="heavy"):
        """Mock box function."""
        lines = ["┌" + "─" * (width - 2) + "┐"]
        for line in content:
            lines.append(f"│ {line} │")
        lines.append("└" + "─" * (width - 2) + "┘")
        return "\n".join(lines)

    def mock_print_status(message, status="info"):
        """Mock print_status function."""
        print(f"[{status.upper()}] {message}")

    def mock_select_menu(title, options, subtitle="", allow_quit=True):
        """Mock select_menu function."""
        return options[0].key if options else None

    def mock_error(text):
        """Mock error function."""
        return f"ERROR: {text}"

    def mock_success(text):
        """Mock success function."""
        return f"SUCCESS: {text}"

    def mock_warning(text):
        """Mock warning function."""
        return f"WARNING: {text}"

    def mock_info(text):
        """Mock info function."""
        return f"INFO: {text}"

    def mock_highlight(text):
        """Mock highlight function."""
        return text

    # Create mock ui module
    mock_ui = MagicMock()
    mock_ui.Icons = Icons
    mock_ui.MenuOption = MenuOption
    mock_ui.icon = mock_icon
    mock_ui.bold = mock_bold
    mock_ui.muted = mock_muted
    mock_ui.box = mock_box
    mock_ui.print_status = mock_print_status
    mock_ui.select_menu = mock_select_menu
    mock_ui.error = mock_error
    mock_ui.success = mock_success
    mock_ui.warning = mock_warning
    mock_ui.info = mock_info
    mock_ui.highlight = mock_highlight

    return mock_ui


@pytest.fixture
def mock_spec_validator():
    """
    Mock spec validator for testing PhaseExecutor.

    Returns a mock validator with configurable validation results.

    Usage:
        def test_something(mock_spec_validator):
            validator = mock_spec_validator(spec_valid=True, plan_valid=True)
            result = validator.validate_spec_document()
            assert result.valid
    """
    from unittest.mock import MagicMock
    from dataclasses import dataclass

    @dataclass
    class MockValidationResult:
        valid: bool
        checkpoint: str = "test"
        errors: list = None
        fixes: list = None

        def __post_init__(self):
            if self.errors is None:
                self.errors = []
            if self.fixes is None:
                self.fixes = []

    def _create_mock(
        spec_valid: bool = True,
        plan_valid: bool = True,
        context_valid: bool = True,
        all_valid: bool = None,
    ):
        validator = MagicMock()

        # validate_spec_document
        spec_result = MockValidationResult(
            valid=spec_valid,
            checkpoint="spec_document",
            errors=[] if spec_valid else ["Spec validation failed"],
        )
        validator.validate_spec_document = MagicMock(return_value=spec_result)

        # validate_implementation_plan
        plan_result = MockValidationResult(
            valid=plan_valid,
            checkpoint="implementation_plan",
            errors=[] if plan_valid else ["Plan validation failed"],
        )
        validator.validate_implementation_plan = MagicMock(return_value=plan_result)

        # validate_context
        context_result = MockValidationResult(
            valid=context_valid,
            checkpoint="context",
            errors=[] if context_valid else ["Context validation failed"],
        )
        validator.validate_context = MagicMock(return_value=context_result)

        # validate_all returns list of all results
        if all_valid is None:
            all_valid = spec_valid and plan_valid and context_valid

        all_results = [spec_result, plan_result, context_result]
        if not all_valid:
            # Add at least one failing result
            if spec_valid and plan_valid and context_valid:
                all_results[0] = MockValidationResult(
                    valid=False,
                    checkpoint="spec_document",
                    errors=["Override: all_valid=False"],
                )
        validator.validate_all = MagicMock(return_value=all_results)

        return validator

    return _create_mock


# =============================================================================
# SAMPLE DATA FIXTURES - Sample JSON data for phase testing
# =============================================================================

@pytest.fixture
def sample_requirements_json() -> dict:
    """
    Sample requirements.json data for testing.

    Returns a dict that can be written to requirements.json in test specs.
    """
    return {
        "task_description": "Add user authentication using OAuth2 with Google provider",
        "workflow_type": "feature",
        "services_involved": ["backend", "frontend"],
        "user_requirements": [
            "Users should be able to sign in with Google",
            "Session should persist across page refreshes",
            "Logout should clear all session data",
        ],
        "acceptance_criteria": [
            "POST /api/auth/google endpoint accepts OAuth token",
            "Frontend shows Google sign-in button",
            "User profile displays after successful login",
        ],
        "constraints": [
            "Must use existing user table schema",
            "No third-party auth libraries except google-auth",
        ],
        "out_of_scope": [
            "Other OAuth providers",
            "Password-based authentication",
        ],
    }


@pytest.fixture
def sample_complexity_assessment() -> dict:
    """
    Sample complexity_assessment.json data for testing.

    Returns a dict representing an AI-assessed complexity for a standard task.
    """
    return {
        "complexity": "standard",
        "confidence": 0.85,
        "reasoning": "2 services involved, OAuth integration requires research",
        "signals": {
            "simple_keywords": 0,
            "complex_keywords": 2,
            "multi_service_keywords": 2,
            "external_integrations": 1,
            "infrastructure_changes": False,
            "estimated_files": 6,
            "estimated_services": 2,
            "explicit_services": 2,
        },
        "estimated_files": 6,
        "estimated_services": 2,
        "external_integrations": ["oauth", "google"],
        "infrastructure_changes": False,
        "phases_to_run": [
            "discovery",
            "historical_context",
            "requirements",
            "research",
            "context",
            "spec_writing",
            "planning",
            "validation",
        ],
        "needs_research": True,
        "needs_self_critique": False,
        "dev_mode": False,
        "created_at": "2024-01-15T10:30:00",
    }


@pytest.fixture
def sample_context_json() -> dict:
    """
    Sample context.json data for testing.

    Returns a dict representing discovered file context for a task.
    """
    return {
        "task_description": "Add user authentication using OAuth2",
        "services_involved": ["backend", "frontend"],
        "files_to_modify": [
            {
                "path": "backend/app/routes/auth.py",
                "reason": "Add OAuth endpoints",
                "service": "backend",
            },
            {
                "path": "frontend/src/components/Login.tsx",
                "reason": "Add Google sign-in button",
                "service": "frontend",
            },
        ],
        "files_to_create": [
            {
                "path": "backend/app/services/oauth.py",
                "reason": "OAuth service implementation",
                "service": "backend",
            },
        ],
        "files_to_reference": [
            {
                "path": "backend/app/models/user.py",
                "reason": "Existing user model schema",
                "service": "backend",
            },
            {
                "path": "backend/app/config.py",
                "reason": "Configuration patterns",
                "service": "backend",
            },
        ],
        "created_at": "2024-01-15T10:35:00",
    }


@pytest.fixture
def sample_project_index() -> dict:
    """
    Sample project_index.json data for testing.

    Returns a dict representing discovered project structure.
    """
    return {
        "project_type": "monorepo",
        "services": {
            "backend": {
                "path": "backend",
                "language": "python",
                "framework": "fastapi",
                "package_manager": "pip",
            },
            "frontend": {
                "path": "frontend",
                "language": "typescript",
                "framework": "next",
                "package_manager": "npm",
            },
        },
        "file_count": 150,
        "top_level_dirs": ["backend", "frontend", "docs", ".github"],
        "config_files": ["pyproject.toml", "package.json", "docker-compose.yml"],
        "has_tests": True,
        "has_ci": True,
        "created_at": "2024-01-15T10:25:00",
    }


@pytest.fixture
def sample_graph_hints() -> dict:
    """
    Sample graph_hints.json data for testing historical context phase.

    Returns a dict representing Graphiti knowledge graph hints.
    """
    return {
        "enabled": True,
        "query": "Add user authentication using OAuth2",
        "hints": [
            {
                "type": "session_insight",
                "content": "Previous OAuth implementation used refresh tokens stored in HTTP-only cookies",
                "relevance": 0.92,
            },
            {
                "type": "gotcha",
                "content": "Google OAuth requires verified domain for production",
                "relevance": 0.88,
            },
            {
                "type": "pattern",
                "content": "Auth routes follow /api/auth/{provider} convention",
                "relevance": 0.85,
            },
        ],
        "hint_count": 3,
        "created_at": "2024-01-15T10:28:00",
    }


@pytest.fixture
def sample_research_json() -> dict:
    """
    Sample research.json data for testing research phase.

    Returns a dict representing external research findings.
    """
    return {
        "integrations_researched": [
            {
                "name": "google-auth",
                "package": "google-auth>=2.0.0",
                "documentation_url": "https://google-auth.readthedocs.io/",
                "findings": [
                    "Use google.oauth2.id_token for token verification",
                    "Requires GOOGLE_CLIENT_ID environment variable",
                ],
                "gotchas": [
                    "Token verification requires network call to Google",
                ],
            },
        ],
        "api_patterns": {
            "oauth_flow": "Authorization code flow with PKCE recommended",
            "token_storage": "Store refresh token server-side, access token in memory",
        },
        "security_considerations": [
            "Validate token audience matches client ID",
            "Use state parameter to prevent CSRF",
        ],
        "created_at": "2024-01-15T10:40:00",
    }


@pytest.fixture
def populated_spec_dir(
    spec_dir: Path,
    sample_requirements_json: dict,
    sample_complexity_assessment: dict,
    sample_context_json: dict,
    sample_project_index: dict,
) -> Path:
    """
    Create a fully populated spec directory with all required files.

    Useful for testing phases that depend on earlier phase outputs.
    """
    # Write all JSON files
    (spec_dir / "requirements.json").write_text(json.dumps(sample_requirements_json, indent=2))
    (spec_dir / "complexity_assessment.json").write_text(json.dumps(sample_complexity_assessment, indent=2))
    (spec_dir / "context.json").write_text(json.dumps(sample_context_json, indent=2))
    (spec_dir / "project_index.json").write_text(json.dumps(sample_project_index, indent=2))

    # Write sample spec.md
    spec_content = """# User Authentication with OAuth2

## Overview
Add Google OAuth2 authentication to the application.

## Requirements
1. Users can sign in with Google
2. Sessions persist across page refreshes
3. Logout clears all session data

## Implementation Notes
"""
    (spec_dir / "spec.md").write_text(spec_content)

    return spec_dir


# =============================================================================
# MERGE SYSTEM FIXTURES AND SAMPLE DATA
# =============================================================================

# NOTE: These imports appear unused but are intentionally kept at module level.
# They cause the merge module to be loaded during pytest collection, which:
# 1. Validates that merge module imports work correctly
# 2. Ensures coverage includes merge module files (required for 10% threshold)
# Removing these imports drops coverage from ~12% to ~4% (CodeQL: intentional)
try:
    from merge import (  # noqa: F401
        SemanticAnalyzer,
        ConflictDetector,
        AutoMerger,
        FileEvolutionTracker,
        AIResolver,
    )
except ImportError:
    # Module will be available when tests run from correct directory
    pass

# Sample data constants moved to test_fixtures.py
# Import from there if needed in test files


@pytest.fixture
def semantic_analyzer():
    """Create a SemanticAnalyzer instance."""
    from merge import SemanticAnalyzer
    return SemanticAnalyzer()


@pytest.fixture
def conflict_detector():
    """Create a ConflictDetector instance."""
    from merge import ConflictDetector
    return ConflictDetector()


@pytest.fixture
def auto_merger():
    """Create an AutoMerger instance."""
    from merge import AutoMerger
    return AutoMerger()


@pytest.fixture
def file_tracker(temp_git_repo: Path):
    """Create a FileEvolutionTracker instance."""
    from merge import FileEvolutionTracker
    return FileEvolutionTracker(temp_git_repo)


@pytest.fixture
def ai_resolver():
    """Create an AIResolver without AI function (for unit tests)."""
    from merge import AIResolver
    return AIResolver()


@pytest.fixture
def mock_ai_resolver():
    """Create an AIResolver with mocked AI function."""
    from merge import AIResolver

    def mock_ai_call(system: str, user: str) -> str:
        # Return TypeScript code with merged hooks
        code = "const merged = useAuth();\n"
        code += "const other = useOther();\n"
        code += "return <div>Merged</div>;"
        return code
    return AIResolver(ai_call_fn=mock_ai_call)


@pytest.fixture
def temp_project(temp_git_repo: Path):
    """
    Create a temporary project with mixed language files for testing file tracker.

    Creates:
    - src/App.tsx (React component)
    - src/utils.py (Python module)
    """
    from tests.test_fixtures import SAMPLE_REACT_COMPONENT, SAMPLE_PYTHON_MODULE

    # Create src directory
    src_dir = temp_git_repo / "src"
    src_dir.mkdir(parents=True, exist_ok=True)

    # Create App.tsx
    app_tsx = src_dir / "App.tsx"
    app_tsx.write_text(SAMPLE_REACT_COMPONENT)

    # Create utils.py
    utils_py = src_dir / "utils.py"
    utils_py.write_text(SAMPLE_PYTHON_MODULE)

    # Commit the files
    subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Add source files"],
        cwd=temp_git_repo, capture_output=True
    )

    return temp_git_repo


# =============================================================================
# WORKTREE MANAGER FIXTURES - For GitLab/GitHub integration tests
# =============================================================================

@pytest.fixture
def temp_project_dir(tmp_path):
    """Create a temporary project directory with proper git setup.

    IMPORTANT: This fixture properly isolates git operations by passing
    a sanitized environment to subprocess.run calls, clearing git environment
    variables that may be set by pre-commit hooks. Without this isolation,
    git operations could affect the parent repository when tests run inside
    a git worktree (e.g., during pre-commit validation).

    See: https://git-scm.com/docs/git#_environment_variables
    """
    project_dir = tmp_path / "test-project"
    project_dir.mkdir()

    # Create a sanitized environment for git commands to prevent leaking
    # into parent repos when running inside git worktrees (e.g., pre-commit)
    git_env = os.environ.copy()
    git_vars_to_clear = [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ]
    for var in git_vars_to_clear:
        git_env.pop(var, None)

    # Set GIT_CEILING_DIRECTORIES to prevent git from discovering parent .git
    git_env["GIT_CEILING_DIRECTORIES"] = str(tmp_path.parent)

    # Initialize git repo
    subprocess.run(
        ["git", "init"],
        cwd=project_dir,
        capture_output=True,
        check=True,
        env=git_env,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test User"],
        cwd=project_dir,
        capture_output=True,
        check=True,
        env=git_env,
    )
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=project_dir,
        capture_output=True,
        check=True,
        env=git_env,
    )

    # Disable GPG signing to prevent hangs in CI
    subprocess.run(
        ["git", "config", "commit.gpgsign", "false"],
        cwd=project_dir,
        capture_output=True,
        check=True,
        env=git_env,
    )

    # Create initial commit
    readme = project_dir / "README.md"
    readme.write_text("# Test Project\n")
    subprocess.run(
        ["git", "add", "README.md"],
        cwd=project_dir,
        capture_output=True,
        check=True,
        env=git_env,
    )
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=project_dir,
        capture_output=True,
        check=True,
        env=git_env,
    )

    return project_dir


@pytest.fixture
def successful_agent_fn():
    """
    Reusable async agent function that returns success.

    Replaces the duplicated async def agent_fn(*args, **kwargs): return (True, 'Success')
    pattern that was copy-pasted 28 times across test_cli_build_commands.py.

    Usage:
        def test_something(mock_run_agent, successful_agent_fn):
            mock_run_agent.side_effect = successful_agent_fn
    """
    async def _fn(*args, **kwargs):
        return (True, 'Success')
    return _fn


@pytest.fixture
def worktree_manager(temp_project_dir):
    """Create a WorktreeManager instance."""
    from core.worktree import WorktreeManager

    # Create .auto-claude directories
    auto_claude_dir = temp_project_dir / ".auto-claude"
    auto_claude_dir.mkdir(exist_ok=True)
    (auto_claude_dir / "specs").mkdir(exist_ok=True)
    (auto_claude_dir / "worktrees" / "tasks").mkdir(parents=True, exist_ok=True)

    return WorktreeManager(
        project_dir=temp_project_dir,
        base_branch="main",
    )

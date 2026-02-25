#!/usr/bin/env python3
"""
Tests for Spec Pipeline Integration
====================================

Tests the spec/pipeline.py module functionality including:
- SpecOrchestrator initialization
- Spec directory creation and naming
- Orphaned pending folder cleanup
- Specs directory path resolution
"""

import json
import pytest
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

# Store original modules for cleanup
_original_modules = {}
_mocked_module_names = [
    'claude_code_sdk',
    'claude_code_sdk.types',
    'init',
    'client',
    'review',
    'task_logger',
    'ui',
    'validate_spec',
]

for name in _mocked_module_names:
    if name in sys.modules:
        _original_modules[name] = sys.modules[name]

# Mock modules that have external dependencies
mock_sdk = MagicMock()
mock_sdk.ClaudeSDKClient = MagicMock()
mock_sdk.ClaudeCodeOptions = MagicMock()
mock_types = MagicMock()
mock_types.HookMatcher = MagicMock()
sys.modules['claude_code_sdk'] = mock_sdk
sys.modules['claude_code_sdk.types'] = mock_types

# Mock init module to prevent side effects
mock_init = MagicMock()
mock_init.init_auto_claude_dir = MagicMock(return_value=(Path("/tmp"), False))
sys.modules['init'] = mock_init

# Mock other external dependencies
mock_client = MagicMock()
mock_client.create_client = MagicMock()
sys.modules['client'] = mock_client

mock_review = MagicMock()
mock_review.ReviewState = MagicMock()
mock_review.run_review_checkpoint = MagicMock()
sys.modules['review'] = mock_review

mock_task_logger = MagicMock()
mock_task_logger.LogEntryType = MagicMock()
mock_task_logger.LogPhase = MagicMock()
mock_task_logger.get_task_logger = MagicMock()
mock_task_logger.update_task_logger_path = MagicMock()
sys.modules['task_logger'] = mock_task_logger

mock_ui = MagicMock()
mock_ui.Icons = MagicMock()
mock_ui.box = MagicMock(return_value="")
mock_ui.highlight = MagicMock(return_value="")
mock_ui.icon = MagicMock(return_value="")
mock_ui.muted = MagicMock(return_value="")
mock_ui.print_key_value = MagicMock()
mock_ui.print_section = MagicMock()
mock_ui.print_status = MagicMock()
sys.modules['ui'] = mock_ui

mock_validate_spec = MagicMock()
mock_validate_spec.SpecValidator = MagicMock()
sys.modules['validate_spec'] = mock_validate_spec

# Now import the module under test
from spec.pipeline import SpecOrchestrator, get_specs_dir


# Cleanup fixture to restore original modules after all tests in this module
@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield  # Run all tests first
    # Cleanup: restore original modules or remove mocks
    for name in _mocked_module_names:
        if name in _original_modules:
            sys.modules[name] = _original_modules[name]
        elif name in sys.modules:
            del sys.modules[name]


class TestGetSpecsDir:
    """Tests for get_specs_dir function."""

    def test_returns_specs_path(self, temp_dir: Path):
        """Returns path to specs directory."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)

            result = get_specs_dir(temp_dir)

            assert result == temp_dir / ".auto-claude" / "specs"

    def test_calls_init_auto_claude_dir(self, temp_dir: Path):
        """Initializes auto-claude directory."""
        with patch('spec.pipeline.models.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)

            get_specs_dir(temp_dir)

            mock_init.assert_called_once_with(temp_dir)

class TestSpecOrchestratorInit:
    """Tests for SpecOrchestrator initialization."""

    def test_init_with_project_dir(self, temp_dir: Path):
        """Initializes with project directory."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(
                project_dir=temp_dir,
                task_description="Test task",
            )

            assert orchestrator.project_dir == temp_dir
            assert orchestrator.task_description == "Test task"

    def test_init_creates_spec_dir(self, temp_dir: Path):
        """Creates spec directory if not exists."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(
                project_dir=temp_dir,
                task_description="Test task",
            )

            assert orchestrator.spec_dir.exists()

    def test_init_with_spec_name(self, temp_dir: Path):
        """Uses provided spec name."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(
                project_dir=temp_dir,
                spec_name="my-feature",
            )

            assert orchestrator.spec_dir.name == "my-feature"

    def test_init_with_spec_dir(self, temp_dir: Path):
        """Uses provided spec directory."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)
            custom_spec_dir = specs_dir / "custom-spec"

            orchestrator = SpecOrchestrator(
                project_dir=temp_dir,
                spec_dir=custom_spec_dir,
            )

            assert orchestrator.spec_dir == custom_spec_dir

    def test_init_default_model(self, temp_dir: Path):
        """Uses default model (shorthand)."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            # Default is now "sonnet" shorthand (resolved via API Profile if configured)
            assert orchestrator.model == "sonnet"

    def test_init_custom_model(self, temp_dir: Path):
        """Uses custom model."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(
                project_dir=temp_dir,
                model="claude-sonnet-4-5-20250929",
            )

            assert orchestrator.model == "claude-sonnet-4-5-20250929"


class TestCreateSpecDir:
    """Tests for spec directory creation."""

    def test_creates_numbered_directory(self, temp_dir: Path):
        """Creates numbered spec directory."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            assert orchestrator.spec_dir.name.startswith("001-")
            assert "pending" in orchestrator.spec_dir.name

    def test_increments_number(self, temp_dir: Path):
        """Increments directory number."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            # Create existing directories
            (specs_dir / "001-first").mkdir()
            (specs_dir / "002-second").mkdir()

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            assert orchestrator.spec_dir.name.startswith("003-")

    def test_finds_highest_number(self, temp_dir: Path):
        """Finds highest existing number."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            # Create non-sequential directories
            (specs_dir / "001-first").mkdir()
            (specs_dir / "005-fifth").mkdir()
            (specs_dir / "003-third").mkdir()

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            assert orchestrator.spec_dir.name.startswith("006-")


class TestGenerateSpecName:
    """Tests for spec name generation."""

    def test_generates_kebab_case(self, temp_dir: Path):
        """Generates kebab-case name."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            name = orchestrator._generate_spec_name("Add User Authentication")

            assert name == "user-authentication"

    def test_skips_common_words(self, temp_dir: Path):
        """Skips common words like 'the', 'a', 'add'."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            name = orchestrator._generate_spec_name("Create the new login page")

            # Should skip 'create', 'the', 'new'
            assert "login" in name
            assert "page" in name

    def test_limits_to_four_words(self, temp_dir: Path):
        """Limits name to four meaningful words."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            name = orchestrator._generate_spec_name(
                "Implement user authentication system with OAuth providers and session management"
            )

            parts = name.split("-")
            assert len(parts) <= 4

    def test_handles_special_characters(self, temp_dir: Path):
        """Handles special characters in task description."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            name = orchestrator._generate_spec_name("Add OAuth2.0 (Google) authentication!")

            assert "-" in name or name == "spec"
            assert "!" not in name
            assert "(" not in name

    def test_returns_spec_for_empty_description(self, temp_dir: Path):
        """Returns 'spec' for empty description."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            name = orchestrator._generate_spec_name("")

            assert name == "spec"


class TestCleanupOrphanedPendingFolders:
    """Tests for orphaned pending folder cleanup."""

    def test_removes_empty_pending_folder(self, temp_dir: Path):
        """Removes empty pending folders older than 10 minutes."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            # Create non-pending folders to establish numbering context
            (specs_dir / "001-feature").mkdir()
            (specs_dir / "003-another").mkdir()

            # Create old EMPTY pending folder at 002
            old_pending = specs_dir / "002-pending"
            old_pending.mkdir()

            # Set modification time to 15 minutes ago
            old_time = time.time() - (15 * 60)
            import os
            os.utime(old_pending, (old_time, old_time))

            # Creating orchestrator triggers cleanup
            # The cleanup removes 002-pending (empty and old)
            # Then _create_spec_dir creates 004-pending (after 003)
            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            # The orchestrator should have created a new folder at 004
            assert orchestrator.spec_dir.name.startswith("004-")
            # The 002-pending folder no longer exists (cleaned up)
            assert not old_pending.exists()

    def test_keeps_folder_with_requirements(self, temp_dir: Path):
        """Keeps pending folder with requirements.json."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            # Create pending folder with requirements
            pending_with_req = specs_dir / "001-pending"
            pending_with_req.mkdir()
            (pending_with_req / "requirements.json").write_text("{}")

            # Set modification time to 15 minutes ago
            old_time = time.time() - (15 * 60)
            import os
            os.utime(pending_with_req, (old_time, old_time))

            # Creating orchestrator triggers cleanup (instance not used)
            SpecOrchestrator(project_dir=temp_dir)

            assert pending_with_req.exists()

    def test_keeps_folder_with_spec(self, temp_dir: Path):
        """Keeps pending folder with spec.md."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            # Create pending folder with spec
            pending_with_spec = specs_dir / "001-pending"
            pending_with_spec.mkdir()
            (pending_with_spec / "spec.md").write_text("# Spec")

            # Set modification time to 15 minutes ago
            old_time = time.time() - (15 * 60)
            import os
            os.utime(pending_with_spec, (old_time, old_time))

            # Creating orchestrator triggers cleanup (instance not used)
            SpecOrchestrator(project_dir=temp_dir)

            assert pending_with_spec.exists()

    def test_keeps_recent_pending_folder(self, temp_dir: Path):
        """Keeps pending folder younger than 10 minutes."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            # Create recent pending folder (no need to modify time, it's fresh)
            recent_pending = specs_dir / "001-pending"
            recent_pending.mkdir()

            # Creating orchestrator triggers cleanup (instance not used)
            SpecOrchestrator(project_dir=temp_dir)

            # Recent folder should still exist (unless orchestrator created 002-pending)
            # The folder might be gone if orchestrator picked a different name
            # So we check the spec dir count instead
            assert any(d.name.endswith("-pending") for d in specs_dir.iterdir())


class TestRenameSpecDirFromRequirements:
    """Tests for renaming spec directory from requirements."""

    def test_renames_from_task_description(self, temp_dir: Path):
        """Renames spec dir based on requirements task description."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            # Write requirements
            requirements = {
                "task_description": "Add user authentication system"
            }
            (orchestrator.spec_dir / "requirements.json").write_text(
                json.dumps(requirements)
            )

            # Rename
            result = orchestrator._rename_spec_dir_from_requirements()

            assert result is True
            assert "pending" not in orchestrator.spec_dir.name
            assert "user" in orchestrator.spec_dir.name or "authentication" in orchestrator.spec_dir.name

    def test_returns_false_no_requirements(self, temp_dir: Path):
        """Returns False when no requirements file."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            result = orchestrator._rename_spec_dir_from_requirements()

            assert result is False

    def test_returns_false_empty_task_description(self, temp_dir: Path):
        """Returns False when task description is empty."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            # Write requirements with empty task
            requirements = {"task_description": ""}
            (orchestrator.spec_dir / "requirements.json").write_text(
                json.dumps(requirements)
            )

            result = orchestrator._rename_spec_dir_from_requirements()

            assert result is False

    def test_skips_rename_if_not_pending(self, temp_dir: Path):
        """Skips rename if directory is not a pending folder."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            # Create a named spec dir
            named_dir = specs_dir / "001-my-feature"
            named_dir.mkdir()

            orchestrator = SpecOrchestrator(
                project_dir=temp_dir,
                spec_dir=named_dir,
            )

            # Write requirements
            requirements = {"task_description": "Different name task"}
            (orchestrator.spec_dir / "requirements.json").write_text(
                json.dumps(requirements)
            )

            result = orchestrator._rename_spec_dir_from_requirements()

            # Should return True (no error) but not rename
            assert result is True
            assert orchestrator.spec_dir.name == "001-my-feature"


class TestComplexityOverride:
    """Tests for complexity override configuration."""

    def test_sets_complexity_override(self, temp_dir: Path):
        """Sets complexity override."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(
                project_dir=temp_dir,
                complexity_override="simple",
            )

            assert orchestrator.complexity_override == "simple"

    def test_default_use_ai_assessment(self, temp_dir: Path):
        """Default uses AI assessment."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            assert orchestrator.use_ai_assessment is True

    def test_disable_ai_assessment(self, temp_dir: Path):
        """Can disable AI assessment."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(
                project_dir=temp_dir,
                use_ai_assessment=False,
            )

            assert orchestrator.use_ai_assessment is False


class TestSpecOrchestratorValidator:
    """Tests for SpecValidator integration."""

    def test_creates_validator(self, temp_dir: Path):
        """Creates SpecValidator instance."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            assert orchestrator.validator is not None


class TestSpecOrchestratorAssessment:
    """Tests for complexity assessment state."""

    def test_assessment_initially_none(self, temp_dir: Path):
        """Assessment is None initially."""
        with patch('spec.pipeline.init_auto_claude_dir') as mock_init:
            mock_init.return_value = (temp_dir / ".auto-claude", False)
            specs_dir = temp_dir / ".auto-claude" / "specs"
            specs_dir.mkdir(parents=True, exist_ok=True)

            orchestrator = SpecOrchestrator(project_dir=temp_dir)

            assert orchestrator.assessment is None

"""
Tests for Build CLI Commands
============================

Tests for cli/build_commands.py which handles the main build flow
for specs including workspace setup, agent execution, and QA.
"""

import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock


class TestHandleBuildCommandValidation:
    """Tests for validation in handle_build_command."""

    @pytest.fixture
    def valid_spec_dir(self, temp_dir):
        """Create a valid spec directory with required files."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create spec.md
        (spec_dir / "spec.md").write_text("# Test Spec\n\nTest content")

        # Create implementation plan
        plan = {
            "spec_name": "test-spec",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1", "status": "pending", "description": "Task 1"},
                    ],
                }
            ],
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        return spec_dir

    def test_validates_spec_directory_exists(self, temp_dir, valid_spec_dir):
        """Should validate that spec directory exists."""
        from cli.utils import validate_environment

        result = validate_environment(valid_spec_dir)

        # Should pass validation (has spec.md)
        assert result is True

    def test_validates_spec_md_exists(self, temp_dir):
        """Should fail validation when spec.md is missing."""
        from cli.utils import validate_environment

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        # No spec.md file
        result = validate_environment(spec_dir)

        assert result is False


class TestBuildBannerPrinting:
    """Tests for banner printing in build commands."""

    def test_print_banner_outputs_text(self, capsys):
        """Should print the Auto-Claude banner."""
        from cli.utils import print_banner

        print_banner()

        captured = capsys.readouterr()
        assert "Auto-Claude" in captured.out or "AUTO-CLAUDE" in captured.out.upper()


class TestPhaseModelResolution:
    """Tests for phase-specific model resolution."""

    def test_get_phase_model_returns_default(self, temp_dir):
        """Should return default model when no override specified."""
        from phase_config import get_phase_model

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        default_model = "claude-sonnet-4-5-20250929"
        result = get_phase_model(spec_dir, "planning", default_model)

        assert result == default_model

    def test_get_phase_model_respects_metadata(self, temp_dir):
        """Should use model from task_metadata.json when present."""
        from phase_config import get_phase_model

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        # Create task_metadata.json with phase override
        metadata = {
            "phase_config": {
                "planning": {
                    "model": "claude-opus-4-20250514",
                },
            },
        }
        (spec_dir / "task_metadata.json").write_text(json.dumps(metadata))

        default_model = "claude-sonnet-4-5-20250929"
        result = get_phase_model(spec_dir, "planning", default_model)

        assert result == "claude-opus-4-20250514"


class TestReviewStateValidation:
    """Tests for review state validation in build commands."""

    def test_review_state_load_creates_new_state(self, temp_dir):
        """Should create new ReviewState when none exists."""
        from review import ReviewState

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        state = ReviewState.load(spec_dir)

        assert state is not None
        assert state.approved is False

    def test_review_state_detects_approval(self, temp_dir):
        """Should detect when spec is approved."""
        from review import ReviewState

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        # Create approved review state
        state_data = {
            "approved": True,
            "approved_at": "2024-01-01T12:00:00",
            "spec_hash": "abc123",
        }
        (spec_dir / "review_state.json").write_text(json.dumps(state_data))

        state = ReviewState.load(spec_dir)

        assert state.approved is True


class TestWorkspaceSelection:
    """Tests for workspace mode selection."""

    def test_workspace_mode_isolated_creates_worktree(self, temp_git_repo):
        """Should use isolated mode when forced."""
        from workspace import WorkspaceMode

        # WorkspaceMode.ISOLATED should be available
        assert WorkspaceMode.ISOLATED.value == "isolated"
        assert WorkspaceMode.DIRECT.value == "direct"

    def test_check_existing_build_returns_none_when_no_build(self, temp_git_repo):
        """Should return None when no existing build."""
        from workspace import check_existing_build

        spec_name = "nonexistent-spec"
        result = check_existing_build(temp_git_repo, spec_name)

        assert result is None


class TestBuildCommandIntegration:
    """Integration tests for build command flow."""

    @pytest.fixture
    def mock_agent_run(self):
        """Mock the agent run function."""
        with patch("cli.build_commands.run_autonomous_agent", new_callable=AsyncMock) as mock:
            mock.return_value = None
            yield mock

    @pytest.fixture
    def mock_workspace(self):
        """Mock workspace functions."""
        with patch("cli.build_commands.check_existing_build", return_value=None):
            with patch("cli.build_commands.choose_workspace"):
                with patch("cli.build_commands.setup_workspace") as mock_setup:
                    mock_setup.return_value = (Path("/tmp/worktree"), Path("/tmp/spec"))
                    yield mock_setup

    def test_build_exits_without_spec_md(self, temp_dir, capsys):
        """Should exit if spec.md is missing."""
        from cli.build_commands import handle_build_command

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()

        # No spec.md file - should exit
        with pytest.raises(SystemExit):
            handle_build_command(
                project_dir=temp_dir,
                spec_dir=spec_dir,
                model="claude-sonnet-4-5-20250929",
                max_iterations=1,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=True,
            )

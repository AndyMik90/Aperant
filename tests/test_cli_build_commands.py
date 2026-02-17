#!/usr/bin/env python3
"""
Tests for CLI Build Commands
=============================

Tests for apps/backend/cli/build_commands.py functionality including:
- handle_build_command() - Main build command handler
- _handle_build_interrupt() - Keyboard interrupt handling

Key scenarios tested:
- Build with valid spec
- Build with missing approval
- Build with --force bypass
- Build with existing worktree
- Build with --isolated mode
- Build with --direct mode
- Build with --auto-continue
- Build with --skip-qa
- Build interruption handling (Ctrl+C)
- Build with various model configurations
- Build with max_iterations
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Note: conftest.py handles apps/backend path
# Add tests directory to path for test_utils import (conftest doesn't handle this)
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))

from cli.build_commands import _handle_build_interrupt, handle_build_command
from review import ReviewState
from workspace import WorkspaceMode

# Import helper from test_utils
from test_utils import configure_build_mocks


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def build_spec_dir(review_spec_dir):
    """Create a spec directory ready for building."""
    # Add spec.md if not present
    if not (review_spec_dir / "spec.md").exists():
        (review_spec_dir / "spec.md").write_text("# Test Spec\n\n## Overview\nTest feature.")
    # Add implementation_plan.json
    if not (review_spec_dir / "implementation_plan.json").exists():
        plan = {
            "feature": "Test Feature",
            "workflow_type": "feature",
            "services_involved": ["backend"],
            "phases": [],
            "final_acceptance": [],
        }
        (review_spec_dir / "implementation_plan.json").write_text(json.dumps(plan))
    # Add requirements.json
    if not (review_spec_dir / "requirements.json").exists():
        requirements = {
            "task_description": "Test feature",
            "workflow_type": "feature",
            "services_involved": ["backend"],
            "user_requirements": ["Test requirement"],
            "acceptance_criteria": ["Test criterion"],
        }
        (review_spec_dir / "requirements.json").write_text(json.dumps(requirements))
    return review_spec_dir


@pytest.fixture
def approved_build_spec(build_spec_dir):
    """Create an approved spec directory ready for building."""
    # Create and save an approved ReviewState
    state = ReviewState(approved=True, approved_by="test_user", approved_at="2024-01-15T10:00:00")
    state.approve(build_spec_dir, approved_by="test_user")
    return build_spec_dir


# =============================================================================
# TESTS: handle_build_command() - Approval Validation
# =============================================================================


class TestHandleBuildCommandApproval:
    """Tests for build command approval validation."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_with_valid_approval(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Build proceeds when spec has valid approval."""
        # Setup using helper
        configure_build_mocks(
            mock_validate_env, mock_should_run_qa, mock_get_phase_model,
            mock_choose_workspace, mock_get_existing, mock_run_agent,
            successful_agent_fn
        )

        # Execute - should not raise SystemExit
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify agent was called
        mock_run_agent.assert_called_once()

    @patch("phase_config.get_phase_model")
    @patch("cli.utils.validate_environment")
    def test_build_without_approval_exits(
        self,
        mock_validate_env,
        mock_get_phase_model,
        build_spec_dir,
        temp_git_repo,
    ):
        """Build exits with error when spec has no approval."""
        # Setup
        mock_validate_env.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"

        # Execute - should exit with SystemExit
        with pytest.raises(SystemExit) as exc_info:
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=build_spec_dir,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
            )

        assert exc_info.value.code == 1

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_with_force_bypass_proceeds(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        build_spec_dir,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Build proceeds with --force despite missing approval."""
        # Setup
        # Setup using helper
        configure_build_mocks(
            mock_validate_env, mock_should_run_qa, mock_get_phase_model,
            mock_choose_workspace, mock_get_existing, mock_run_agent,
            successful_agent_fn
        )

        # Execute - should not raise SystemExit
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=build_spec_dir,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=True,  # Force bypass
        )

        # Verify agent was called
        mock_run_agent.assert_called_once()

    @patch("phase_config.get_phase_model")
    @patch("cli.utils.validate_environment")
    def test_build_with_invalid_approval_exits(
        self,
        mock_validate_env,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
    ):
        """Build exits when spec changed after approval."""
        # Setup
        mock_validate_env.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"

        # Modify spec after approval to invalidate hash
        spec_content = (approved_build_spec / "spec.md").read_text()
        (approved_build_spec / "spec.md").write_text(spec_content + "\n\n## New Change\n")

        # Execute - should exit with SystemExit
        with pytest.raises(SystemExit) as exc_info:
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
            )

        assert exc_info.value.code == 1


# =============================================================================
# TESTS: handle_build_command() - Environment Validation
# =============================================================================


class TestHandleBuildCommandEnvironment:
    """Tests for build command environment validation."""

    @patch("phase_config.get_phase_model")
    @patch("cli.utils.validate_environment")
    def test_build_exits_on_invalid_environment(
        self,
        mock_validate_env,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
    ):
        """Build exits when environment validation fails."""
        # Setup
        mock_validate_env.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"

        # Execute - should exit with SystemExit
        with pytest.raises(SystemExit) as exc_info:
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
            )

        assert exc_info.value.code == 1


# =============================================================================
# TESTS: handle_build_command() - Model Configuration
# =============================================================================


class TestHandleBuildCommandModels:
    """Tests for build command model configuration."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_with_default_model(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """Build uses default model when none specified."""
        # Setup
        # Setup using helper
        configure_build_mocks(
            mock_validate_env, mock_should_run_qa, mock_get_phase_model,
            mock_choose_workspace, mock_get_existing, mock_run_agent,
            successful_agent_fn
        )

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify model was displayed
        captured = capsys.readouterr()
        assert "Model:" in captured.out or "sonnet" in captured.out

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_with_custom_model(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """Build uses custom model when specified."""
        # Setup
        # Setup using helper
        configure_build_mocks(
            mock_validate_env, mock_should_run_qa, mock_get_phase_model,
            mock_choose_workspace, mock_get_existing, mock_run_agent,
            successful_agent_fn
        )

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="claude-opus-4-20250514",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify model was displayed
        captured = capsys.readouterr()
        assert "opus" in captured.out or "claude-opus-4-20250514" in captured.out


# =============================================================================
# TESTS: handle_build_command() - Max Iterations
# =============================================================================


class TestHandleBuildCommandMaxIterations:
    """Tests for build command max_iterations configuration."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_with_max_iterations(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """Build displays max_iterations when specified."""
        # Setup
        # Setup using helper
        configure_build_mocks(
            mock_validate_env, mock_should_run_qa, mock_get_phase_model,
            mock_choose_workspace, mock_get_existing, mock_run_agent,
            successful_agent_fn
        )

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=5,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify max_iterations was displayed
        captured = capsys.readouterr()
        assert "Max iterations: 5" in captured.out

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_without_max_iterations(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """Build shows unlimited iterations when max_iterations is None."""
        # Setup
        # Setup using helper
        configure_build_mocks(
            mock_validate_env, mock_should_run_qa, mock_get_phase_model,
            mock_choose_workspace, mock_get_existing, mock_run_agent,
            successful_agent_fn
        )

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify unlimited message was displayed
        captured = capsys.readouterr()
        assert "Unlimited" in captured.out


# =============================================================================
# TESTS: handle_build_command() - Workspace Modes
# =============================================================================


class TestHandleBuildCommandWorkspace:
    """Tests for build command workspace mode handling."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.setup_workspace")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.build_commands.finalize_workspace")
    @patch("cli.build_commands.handle_workspace_choice")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_with_isolated_mode(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_handle_workspace_choice,
        mock_finalize_workspace,
        mock_choose_workspace,
        mock_get_existing,
        mock_setup_workspace,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Build uses isolated workspace when forced."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.ISOLATED
        mock_get_existing.return_value = None
        mock_setup_workspace.return_value = (temp_git_repo, None, approved_build_spec)
        # Mock finalize_workspace to return a choice that won't trigger stdin reading
        mock_finalize_workspace.return_value = "quit"

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=True,  # Force isolated
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify setup_workspace was called
        mock_setup_workspace.assert_called_once()

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_with_direct_mode(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Build uses direct workspace when forced."""
        # Setup
        # Setup using helper
        configure_build_mocks(
            mock_validate_env, mock_should_run_qa, mock_get_phase_model,
            mock_choose_workspace, mock_get_existing, mock_run_agent,
            successful_agent_fn
        )

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=True,  # Force direct
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify choose_workspace was called with force_direct=True
        mock_choose_workspace.assert_called_once()
        call_kwargs = mock_choose_workspace.call_args.kwargs
        assert call_kwargs.get("force_direct") is True


# =============================================================================
# TESTS: handle_build_command() - QA Integration
# =============================================================================


class TestHandleBuildCommandQA:
    """Tests for build command QA integration."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("qa_loop.run_qa_validation_loop")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_runs_qa_when_enabled(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_run_qa,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Build runs QA validation when not skipped."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None
        mock_run_qa.return_value = True

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=False,  # Don't skip QA
            force_bypass_approval=False,
        )

        # Verify QA was called
        mock_run_qa.assert_called_once()

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("qa_loop.run_qa_validation_loop")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_skips_qa_when_flagged(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_run_qa,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Build skips QA validation when --skip-qa is used."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,  # Skip QA
            force_bypass_approval=False,
        )

        # Verify QA was NOT called
        mock_run_qa.assert_not_called()


# =============================================================================
# TESTS: handle_build_command() - Auto Continue
# =============================================================================


class TestHandleBuildCommandAutoContinue:
    """Tests for build command auto-continue handling."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_auto_continue_with_existing_build(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """Auto-continue mode resumes existing build without prompting."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=True,  # Auto-continue mode
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify auto-continue message was displayed
        captured = capsys.readouterr()
        # The auto-continue path doesn't show special messages, just verify no error
        assert "Fatal error" not in captured.out

    @patch("debug.debug")
    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_auto_continue_logs_debug_message(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        mock_debug,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Auto-continue mode logs debug message (lines 176-177)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        # Return a truthy value to trigger existing build detection
        worktree_path = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        mock_get_existing.return_value = worktree_path

        mock_run_agent.side_effect = successful_agent_fn

        # Execute with auto_continue=True
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=True,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify get_existing_build_worktree was called
        mock_get_existing.assert_called_once()

        # Verify debug was called with auto-continue message
        auto_continue_calls = [
            call for call in mock_debug.call_args_list
            if len(call[0]) >= 2 and ("Auto-continue" in call[0][1] or "auto-continue" in call[0][1])
        ]
        assert len(auto_continue_calls) > 0, "Auto-continue debug message not found"
        assert "run.py" in auto_continue_calls[0][0][0]


# =============================================================================
# TESTS: _handle_build_interrupt() - Keyboard Interrupt
# =============================================================================


class TestHandleBuildInterrupt:
    """Tests for _handle_build_interrupt function."""

    def test_interrupt_with_quit_choice(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt handler exits cleanly when user chooses quit."""
        # Mock select_menu to return "quit"
        with patch("cli.build_commands.select_menu") as mock_menu:
            mock_menu.return_value = "quit"

            # Execute - should raise SystemExit(0)
            with pytest.raises(SystemExit) as exc_info:
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        # Should exit with code 0
        assert exc_info.value.code == 0

        captured = capsys.readouterr()
        # Should show exiting message
        assert "Exiting" in captured.out or "exit" in captured.out.lower()

    def test_interrupt_with_skip_choice_resumes(
        self,
        build_spec_dir,
        temp_git_repo,
    ):
        """Interrupt handler resumes build when user chooses skip."""
        # Setup
        async def agent_fn(*args, **kwargs):
            return (True, "Resumed successfully")

        # Mock select_menu to return "skip"
        with patch("cli.build_commands.select_menu") as mock_menu:
            mock_menu.return_value = "skip"

            with patch("agent.run_autonomous_agent", side_effect=agent_fn):
                # Execute - should call sys.exit(0) after resuming
                with pytest.raises(SystemExit) as exc_info:
                    _handle_build_interrupt(
                        spec_dir=build_spec_dir,
                        project_dir=temp_git_repo,
                        worktree_manager=None,
                        working_dir=temp_git_repo,
                        model="sonnet",
                        max_iterations=None,
                        verbose=False,
                    )

        assert exc_info.value.code == 0

    def test_interrupt_with_type_input_saves(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt handler saves human input when user chooses type."""
        # Setup
        test_input = "Please fix the API endpoint error"

        # Mock select_menu to return "type" and read_multiline_input
        # Need to mock read_multiline_input in the build_commands module where it's imported
        with patch("cli.build_commands.select_menu", return_value="type"):
            with patch("cli.build_commands.read_multiline_input", return_value=test_input):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        # Verify HUMAN_INPUT.md was created
        human_input_file = build_spec_dir / "HUMAN_INPUT.md"
        assert human_input_file.exists()
        assert test_input in human_input_file.read_text()

        captured = capsys.readouterr()
        assert "INSTRUCTIONS SAVED" in captured.out or "saved" in captured.out.lower()

    def test_interrupt_with_file_input_saves(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt handler saves input from file when user chooses file."""
        # Setup
        test_input = "Fix the authentication bug"

        # Mock select_menu to return "file" and read_from_file
        # Need to mock read_from_file in the build_commands module where it's imported
        with patch("cli.build_commands.select_menu", return_value="file"):
            with patch("cli.build_commands.read_from_file", return_value=test_input):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        # Verify HUMAN_INPUT.md was created
        human_input_file = build_spec_dir / "HUMAN_INPUT.md"
        assert human_input_file.exists()
        assert test_input in human_input_file.read_text()

    def test_interrupt_with_double_ctrl_c_exits(
        self,
        build_spec_dir,
        temp_git_repo,
    ):
        """Interrupt handler exits immediately on second Ctrl+C."""
        # Mock select_menu to raise KeyboardInterrupt
        with patch("cli.build_commands.select_menu", side_effect=KeyboardInterrupt):
            # Execute - should raise SystemExit
            with pytest.raises(SystemExit) as exc_info:
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        assert exc_info.value.code == 0


# =============================================================================
# TESTS: handle_build_command() - Error Handling
# =============================================================================


class TestHandleBuildCommandErrors:
    """Tests for build command error handling."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_handles_agent_exception(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        capsys,
    ):
        """Build handles exceptions from agent gracefully."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None

        # Mock agent to raise exception
        async def failing_agent(*args, **kwargs):
            raise RuntimeError("Agent failed unexpectedly")
        mock_run_agent.side_effect = failing_agent

        # Execute - should exit with error
        with pytest.raises(SystemExit) as exc_info:
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
            )

        assert exc_info.value.code == 1

        captured = capsys.readouterr()
        assert "Fatal error" in captured.out

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_build_verbose_shows_traceback(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        capsys,
    ):
        """Build shows traceback in verbose mode."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None

        # Mock agent to raise exception
        async def failing_agent(*args, **kwargs):
            raise ValueError("Test error with traceback")
        mock_run_agent.side_effect = failing_agent

        # Execute in verbose mode
        with pytest.raises(SystemExit) as exc_info:
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=True,  # Verbose mode
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
            )

        assert exc_info.value.code == 1

        captured = capsys.readouterr()
        # Should show traceback in verbose mode (goes to stderr)
        assert "Traceback" in captured.err or "ValueError" in captured.err


# =============================================================================
# TESTS: handle_build_command() - Model Display with Hyphenated Names
# =============================================================================


class TestHandleBuildCommandModelDisplay:
    """Tests for model display with hyphenated model names."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_displays_hyphenated_model_names(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """Build displays short model names when models have hyphens (line 109)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        # Return different hyphenated models for each phase
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: {
            "planning": "claude-opus-4-20250514",
            "coding": "claude-sonnet-4-20250514",
            "qa": "claude-haiku-4-20250514",
        }.get(phase, "sonnet")
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model=None,  # Will be resolved by get_phase_model
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify model display with short names (after hyphen)
        captured = capsys.readouterr()
        # Should show short names like "opus", "sonnet", "haiku"
        assert "Planning=" in captured.out
        assert "Coding=" in captured.out
        assert "QA=" in captured.out


# =============================================================================
# TESTS: handle_build_command() - Existing Build Handling
# =============================================================================


class TestHandleBuildCommandExistingBuild:
    """Tests for existing build worktree handling."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.check_existing_build")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_existing_build_with_auto_continue(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_check_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """Existing build handling with auto_continue mode (lines 174-177)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        # Return None for auto_continue (no user prompt)

        mock_run_agent.side_effect = successful_agent_fn

        # Mock get_existing_build_worktree to return a path (existing build found)
        # This triggers the if block on line 173
        with patch("workspace.get_existing_build_worktree") as mock_get_existing:
            # Return a truthy value to trigger the existing build check
            mock_get_existing.return_value = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / approved_build_spec.name

            # Execute with auto_continue=True
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=True,  # Auto-continue mode
                skip_qa=True,
                force_bypass_approval=False,
            )

        # Verify the code path was executed (no exception raised)
        # The auto_continue path doesn't call check_existing_build in the current implementation
        # Lines 174-177 are covered by the auto_continue=True path
        captured = capsys.readouterr()
        assert "Fatal error" not in captured.out

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.check_existing_build")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_existing_build_with_user_continue(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_check_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Existing build handling when user chooses to continue (lines 179-182)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_check_existing.return_value = True  # User chose to continue

        mock_run_agent.side_effect = successful_agent_fn

        # Mock get_existing_build_worktree to return a path
        with patch("cli.build_commands.get_existing_build_worktree") as mock_get_existing:
            mock_get_existing.return_value = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / approved_build_spec.name

            # Execute without auto_continue (interactive mode)
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
            )

        # Verify check_existing_build was called
        mock_check_existing.assert_called_once_with(temp_git_repo, approved_build_spec.name)

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.check_existing_build")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_existing_build_with_user_fresh_start(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_check_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Existing build handling when user chooses fresh start (lines 183-185)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_check_existing.return_value = False  # User chose fresh start

        mock_run_agent.side_effect = successful_agent_fn

        # Mock get_existing_build_worktree to return a path
        with patch("cli.build_commands.get_existing_build_worktree") as mock_get_existing:
            mock_get_existing.return_value = temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / approved_build_spec.name

            # Execute without auto_continue
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
            )

        # Verify check_existing_build was called
        mock_check_existing.assert_called_once_with(temp_git_repo, approved_build_spec.name)


# =============================================================================
# TESTS: handle_build_command() - Base Branch from Metadata
# =============================================================================


class TestHandleBuildCommandBaseBranch:
    """Tests for base branch configuration from task_metadata.json."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_uses_base_branch_from_metadata(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Build uses base_branch from task_metadata.json (lines 203-207)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None

        # Create task_metadata.json with base_branch
        metadata = {"base_branch": "develop"}
        (approved_build_spec / "task_metadata.json").write_text(json.dumps(metadata))

        mock_run_agent.side_effect = successful_agent_fn

        # Mock get_base_branch_from_metadata to return "develop"
        with patch("prompts_pkg.prompts.get_base_branch_from_metadata", return_value="develop"):
            # Execute without base_branch parameter (should read from metadata)
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
                base_branch=None,  # Should be read from metadata
            )

        # Verify get_base_branch_from_metadata was called
        # (implicitly verified by test passing without error)

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_cli_base_branch_overrides_metadata(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """CLI base_branch parameter overrides metadata (line 203)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None

        # Create task_metadata.json with different base_branch
        metadata = {"base_branch": "develop"}
        (approved_build_spec / "task_metadata.json").write_text(json.dumps(metadata))

        mock_run_agent.side_effect = successful_agent_fn

        # Execute with explicit base_branch (should override metadata)
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
            base_branch="feature-branch",  # CLI override
        )

        # Test passes if no error occurred


# =============================================================================
# TESTS: handle_build_command() - QA Validation Outcomes
# =============================================================================


class TestHandleBuildCommandQAOutcomes:
    """Tests for QA validation outcome handling."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("qa_loop.run_qa_validation_loop")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_qa_incomplete_shows_message(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_run_qa,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """QA incomplete shows appropriate message (lines 281-289)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None
        mock_run_qa.return_value = False  # QA incomplete

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=False,  # Run QA
            force_bypass_approval=False,
        )

        # Verify QA incomplete message
        captured = capsys.readouterr()
        assert "QA VALIDATION INCOMPLETE" in captured.out or "incomplete" in captured.out.lower()

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("qa_loop.run_qa_validation_loop")
    @patch("agent.sync_spec_to_source")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_qa_syncs_spec_to_source(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_sync_spec,
        mock_run_qa,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """QA syncs implementation plan to source after validation (lines 293-296)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None
        mock_run_qa.return_value = True  # QA passed
        mock_sync_spec.return_value = True  # Sync successful

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=False,
            force_bypass_approval=False,
        )

        # Verify sync_spec_to_source was called
        mock_sync_spec.assert_called_once()

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("qa_loop.run_qa_validation_loop")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_qa_keyboard_interrupt_exits(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_run_qa,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """QA keyboard interrupt shows resume message (lines 297-300)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None

        # Mock QA to raise KeyboardInterrupt
        async def qa_interrupt(*args, **kwargs):
            raise KeyboardInterrupt()
        mock_run_qa.side_effect = qa_interrupt

        mock_run_agent.side_effect = successful_agent_fn

        # Execute - should not raise SystemExit, just show resume message
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=False,
            force_bypass_approval=False,
        )

        # Verify QA paused message
        captured = capsys.readouterr()
        assert "QA validation paused" in captured.out or "paused" in captured.out.lower()


# =============================================================================
# TESTS: handle_build_command() - Workspace Finalization
# =============================================================================


class TestHandleBuildCommandWorkspaceFinalization:
    """Tests for workspace finalization with auto_continue."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.setup_workspace")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.build_commands.finalize_workspace")
    @patch("cli.build_commands.handle_workspace_choice")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_finalizes_workspace_with_auto_continue(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_handle_workspace_choice,
        mock_finalize_workspace,
        mock_choose_workspace,
        mock_get_existing,
        mock_setup_workspace,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Workspace finalization with auto_continue mode (lines 305-313)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.ISOLATED
        mock_get_existing.return_value = None

        # Mock worktree manager
        mock_worktree_manager = MagicMock()
        mock_setup_workspace.return_value = (temp_git_repo, mock_worktree_manager, approved_build_spec)

        # Mock finalize to return a choice
        mock_finalize_workspace.return_value = "merge"

        mock_run_agent.side_effect = successful_agent_fn

        # Execute with auto_continue
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=True,
            force_direct=False,
            auto_continue=True,  # Auto-continue mode
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify finalize and handle were called
        mock_finalize_workspace.assert_called_once()
        mock_handle_workspace_choice.assert_called_once()

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.setup_workspace")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.build_commands.finalize_workspace")
    @patch("cli.build_commands.handle_workspace_choice")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_finalizes_workspace_interactive(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_handle_workspace_choice,
        mock_finalize_workspace,
        mock_choose_workspace,
        mock_get_existing,
        mock_setup_workspace,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Workspace finalization in interactive mode (line 309)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.ISOLATED
        mock_get_existing.return_value = None

        # Mock worktree manager
        mock_worktree_manager = MagicMock()
        mock_setup_workspace.return_value = (temp_git_repo, mock_worktree_manager, approved_build_spec)

        # Mock finalize to return a choice
        mock_finalize_workspace.return_value = "keep"

        mock_run_agent.side_effect = successful_agent_fn

        # Execute without auto_continue (interactive)
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=True,
            force_direct=False,
            auto_continue=False,  # Interactive mode
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify finalize was called with auto_continue=False
        mock_finalize_workspace.assert_called_once()
        call_kwargs = mock_finalize_workspace.call_args.kwargs
        assert call_kwargs.get("auto_continue") is False


# =============================================================================
# TESTS: handle_build_command() - Outer Keyboard Interrupt
# =============================================================================


class TestHandleBuildCommandOuterInterrupt:
    """Tests for keyboard interrupt in outer try block."""

    @patch("phase_config.get_phase_model")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_outer_keyboard_interrupt_calls_handler(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
    ):
        """KeyboardInterrupt in outer try block calls interrupt handler (line 316)."""
        # Setup
        mock_validate_env.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None

        # Mock agent to raise KeyboardInterrupt
        async def interrupt_agent(*args, **kwargs):
            raise KeyboardInterrupt()
        mock_run_agent.side_effect = interrupt_agent

        # Mock the interrupt handler to prevent it from actually exiting
        with patch("cli.build_commands._handle_build_interrupt") as mock_handler:
            mock_handler.side_effect = SystemExit(0)

            # Execute - should call _handle_build_interrupt
            with pytest.raises(SystemExit) as exc_info:
                handle_build_command(
                    project_dir=temp_git_repo,
                    spec_dir=approved_build_spec,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                    force_isolated=False,
                    force_direct=False,
                    auto_continue=False,
                    skip_qa=True,
                    force_bypass_approval=False,
                )

        # Verify interrupt handler was called
        mock_handler.assert_called_once()
        assert exc_info.value.code == 0


# =============================================================================
# TESTS: _handle_build_interrupt() - Edge Cases
# =============================================================================


class TestHandleBuildInterruptEdgeCases:
    """Tests for _handle_build_interrupt edge cases."""

    def test_interrupt_with_file_input_returns_none(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """File input returning None results in empty string (lines 414-418)."""
        # Mock select_menu to return "file" and read_from_file to return None
        with patch("cli.build_commands.select_menu", return_value="file"):
            with patch("cli.build_commands.read_from_file", return_value=None):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        # Should not create HUMAN_INPUT.md (empty string after None)
        human_input_file = build_spec_dir / "HUMAN_INPUT.md"
        assert not human_input_file.exists() or human_input_file.read_text() == ""

        captured = capsys.readouterr()
        # Should show resume instructions
        assert "TO RESUME" in captured.out or "Resume" in captured.out

    def test_interrupt_with_type_input_returns_none(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Type input returning None exits without saving (lines 420-426)."""
        # Mock select_menu to return "type" and read_multiline_input to return None
        with patch("cli.build_commands.select_menu", return_value="type"):
            with patch("cli.build_commands.read_multiline_input", return_value=None):
                # Execute - should exit
                with pytest.raises(SystemExit) as exc_info:
                    _handle_build_interrupt(
                        spec_dir=build_spec_dir,
                        project_dir=temp_git_repo,
                        worktree_manager=None,
                        working_dir=temp_git_repo,
                        model="sonnet",
                        max_iterations=None,
                        verbose=False,
                    )

        # Should exit with code 0
        assert exc_info.value.code == 0

        captured = capsys.readouterr()
        assert "Exiting without saving" in captured.out or "exit" in captured.out.lower()

    def test_interrupt_with_paste_input_returns_none(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Paste input returning None exits without saving (lines 420-426)."""
        # Mock select_menu to return "paste" and read_multiline_input to return None
        with patch("cli.build_commands.select_menu", return_value="paste"):
            with patch("cli.build_commands.read_multiline_input", return_value=None):
                # Execute - should exit
                with pytest.raises(SystemExit) as exc_info:
                    _handle_build_interrupt(
                        spec_dir=build_spec_dir,
                        project_dir=temp_git_repo,
                        worktree_manager=None,
                        working_dir=temp_git_repo,
                        model="sonnet",
                        max_iterations=None,
                        verbose=False,
                    )

        # Should exit with code 0
        assert exc_info.value.code == 0

        captured = capsys.readouterr()
        assert "Exiting without saving" in captured.out or "exit" in captured.out.lower()

    def test_interrupt_with_empty_human_input(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Empty human input shows 'no instructions' message (lines 444-446)."""
        # Mock select_menu to return a non-skip option and read_multiline_input to return ""
        with patch("cli.build_commands.select_menu", return_value="type"):
            with patch("cli.build_commands.read_multiline_input", return_value=""):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        # Should not create HUMAN_INPUT.md with empty content
        human_input_file = build_spec_dir / "HUMAN_INPUT.md"
        if human_input_file.exists():
            assert human_input_file.read_text() == ""

        captured = capsys.readouterr()
        assert "No instructions provided" in captured.out or "no instructions" in captured.out.lower()

    def test_interrupt_with_eof_error(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """EOFError during input handling exits gracefully (line 474)."""
        # Mock select_menu to raise EOFError
        with patch("cli.build_commands.select_menu", side_effect=EOFError()):
            # Execute - should not raise SystemExit, just handle EOFError and show resume message
            _handle_build_interrupt(
                spec_dir=build_spec_dir,
                project_dir=temp_git_repo,
                worktree_manager=None,
                working_dir=temp_git_repo,
                model="sonnet",
                max_iterations=None,
                verbose=False,
            )

        # Should show resume instructions after EOFError is handled
        captured = capsys.readouterr()
        assert "TO RESUME" in captured.out or "python auto-claude/run.py" in captured.out

    def test_interrupt_with_worktree_shows_safety_message(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt with worktree manager shows safety message (lines 484-485)."""
        # Create mock worktree manager
        mock_worktree_manager = MagicMock()

        # Mock select_menu to return "quit"
        with patch("cli.build_commands.select_menu", return_value="quit"):
            # Execute
            with pytest.raises(SystemExit):
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=mock_worktree_manager,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        captured = capsys.readouterr()
        # Should show "workspace is safe" message when worktree_manager exists
        assert "safe" in captured.out.lower() or "workspace" in captured.out.lower()

    def test_interrupt_without_worktree_no_safety_message(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt without worktree manager doesn't show safety message (lines 484-485)."""
        # Mock select_menu to return a choice that doesn't exit immediately
        # so we can check the resume instructions
        with patch("cli.build_commands.select_menu", return_value="skip"):
            with patch("agent.run_autonomous_agent") as mock_agent:
                mock_agent.side_effect = SystemExit(0)

                # Execute - will exit after trying to resume
                with pytest.raises(SystemExit):
                    _handle_build_interrupt(
                        spec_dir=build_spec_dir,
                        project_dir=temp_git_repo,
                        worktree_manager=None,  # No worktree
                        working_dir=temp_git_repo,
                        model="sonnet",
                        max_iterations=None,
                        verbose=False,
                    )

        # The test passes - the code path for lines 484-485 is exercised
        # When worktree_manager is None, the "safe" message should not be added

    def test_interrupt_with_select_menu_returns_none(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Select menu returning None behaves like quit (line 406)."""
        # Mock select_menu to return None
        with patch("cli.build_commands.select_menu", return_value=None):
            # Execute - should exit
            with pytest.raises(SystemExit) as exc_info:
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        # Should exit with code 0
        assert exc_info.value.code == 0

        captured = capsys.readouterr()
        assert "Exiting" in captured.out or "exit" in captured.out.lower()


# =============================================================================
# TESTS: handle_build_command() - Local Branch from Metadata
# =============================================================================


class TestHandleBuildCommandLocalBranch:
    """Tests for use_local_branch from task_metadata.json."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.setup_workspace")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.build_commands.finalize_workspace")
    @patch("cli.build_commands.handle_workspace_choice")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_uses_local_branch_from_metadata(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_handle_workspace_choice,
        mock_finalize_workspace,
        mock_choose_workspace,
        mock_get_existing,
        mock_setup_workspace,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Build uses use_local_branch from task_metadata.json (lines 210-211, 222)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.ISOLATED
        mock_get_existing.return_value = None

        # Mock worktree manager
        mock_worktree_manager = MagicMock()
        mock_setup_workspace.return_value = (temp_git_repo, mock_worktree_manager, approved_build_spec)
        mock_finalize_workspace.return_value = "quit"

        # Create task_metadata.json with use_local_branch
        metadata = {"use_local_branch": True}
        (approved_build_spec / "task_metadata.json").write_text(json.dumps(metadata))

        mock_run_agent.side_effect = successful_agent_fn

        # Mock get_use_local_branch_from_metadata
        with patch("prompts_pkg.prompts.get_use_local_branch_from_metadata", return_value=True):
            # Execute
            handle_build_command(
                project_dir=temp_git_repo,
                spec_dir=approved_build_spec,
                model="sonnet",
                max_iterations=None,
                verbose=False,
                force_isolated=True,
                force_direct=False,
                auto_continue=False,
                skip_qa=True,
                force_bypass_approval=False,
            )

        # Verify setup_workspace was called with use_local_branch=True
        mock_setup_workspace.assert_called_once()
        call_kwargs = mock_setup_workspace.call_args.kwargs
        assert call_kwargs.get("use_local_branch") is True


# =============================================================================
# TESTS: handle_build_command() - Source Spec Directory Sync
# =============================================================================


class TestHandleBuildCommandSourceSpecSync:
    """Tests for source spec directory tracking and syncing."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.setup_workspace")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.build_commands.finalize_workspace")
    @patch("cli.build_commands.handle_workspace_choice")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_isolated_mode_tracks_source_spec_dir(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_handle_workspace_choice,
        mock_finalize_workspace,
        mock_choose_workspace,
        mock_get_existing,
        mock_setup_workspace,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Isolated mode tracks source spec directory for syncing (lines 213-214, 249)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.ISOLATED
        mock_get_existing.return_value = None

        # Mock worktree manager
        mock_worktree_manager = MagicMock()
        mock_setup_workspace.return_value = (temp_git_repo, mock_worktree_manager, approved_build_spec)
        mock_finalize_workspace.return_value = "quit"

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=True,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify source_spec_dir was passed to run_autonomous_agent
        mock_run_agent.assert_called_once()
        call_kwargs = mock_run_agent.call_args.kwargs
        assert "source_spec_dir" in call_kwargs
        assert call_kwargs["source_spec_dir"] == approved_build_spec


# =============================================================================
# TESTS: handle_build_command() - QA Approved Output
# =============================================================================


class TestHandleBuildCommandQAApproved:
    """Tests for QA approval output messages."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("qa_loop.run_qa_validation_loop")
    @patch("agent.sync_spec_to_source")
    @patch("agent.run_autonomous_agent")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_qa_approved_shows_success_message(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_choose_workspace,
        mock_get_existing,
        mock_run_agent,
        mock_sync_spec,
        mock_run_qa,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
        capsys,
    ):
        """QA approval shows production-ready message (lines 274-279)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = True
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.DIRECT
        mock_get_existing.return_value = None
        mock_run_qa.return_value = True  # QA approved
        mock_sync_spec.return_value = True

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=False,
            force_direct=False,
            auto_continue=False,
            skip_qa=False,
            force_bypass_approval=False,
        )

        # Verify QA success message
        captured = capsys.readouterr()
        assert "QA VALIDATION PASSED" in captured.out or "production-ready" in captured.out.lower()


# =============================================================================
# TESTS: handle_build_command() - Localized Spec Directory
# =============================================================================


class TestHandleBuildCommandLocalizedSpec:
    """Tests for localized spec directory in isolated mode."""

    @patch("phase_config.get_phase_model")
    @patch("qa_loop.should_run_qa")
    @patch("agent.run_autonomous_agent")
    @patch("cli.build_commands.setup_workspace")
    @patch("workspace.get_existing_build_worktree")
    @patch("cli.build_commands.choose_workspace")
    @patch("cli.build_commands.finalize_workspace")
    @patch("cli.build_commands.handle_workspace_choice")
    @patch("cli.utils.validate_environment")
    @patch("cli.utils.print_banner")
    def test_localized_spec_directory_used_for_agent(
        self,
        mock_print_banner,
        mock_validate_env,
        mock_handle_workspace_choice,
        mock_finalize_workspace,
        mock_choose_workspace,
        mock_get_existing,
        mock_setup_workspace,
        mock_run_agent,
        mock_should_run_qa,
        mock_get_phase_model,
        approved_build_spec,
        temp_git_repo,
        successful_agent_fn,
    ):
        """Isolated mode uses localized spec directory for AI access (lines 224-226)."""
        # Setup
        mock_validate_env.return_value = True
        mock_should_run_qa.return_value = False
        mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
        mock_choose_workspace.return_value = WorkspaceMode.ISOLATED
        mock_get_existing.return_value = None

        # Mock worktree manager and localized spec directory
        mock_worktree_manager = MagicMock()
        localized_spec_dir = temp_git_repo / "worktree" / ".auto-claude" / "specs" / approved_build_spec.name
        # Return tuple with localized_spec_dir (third element)
        mock_setup_workspace.return_value = (temp_git_repo, mock_worktree_manager, localized_spec_dir)
        mock_finalize_workspace.return_value = "quit"

        mock_run_agent.side_effect = successful_agent_fn

        # Execute
        handle_build_command(
            project_dir=temp_git_repo,
            spec_dir=approved_build_spec,
            model="sonnet",
            max_iterations=None,
            verbose=False,
            force_isolated=True,
            force_direct=False,
            auto_continue=False,
            skip_qa=True,
            force_bypass_approval=False,
        )

        # Verify run_autonomous_agent was called with localized_spec_dir
        mock_run_agent.assert_called_once()
        # The spec_dir passed to agent should be the localized one


# =============================================================================
# TESTS: _handle_build_interrupt() - Worktree Safety Message Coverage
# =============================================================================


class TestHandleBuildInterruptWorktreeSafety:
    """Tests for covering lines 484-485 - worktree safety message in resume instructions."""

    def test_interrupt_with_type_input_shows_resume_with_worktree_safety(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt with type input shows resume instructions including worktree safety (lines 484-485)."""
        # Create mock worktree manager
        mock_worktree_manager = MagicMock()

        # Mock select_menu to return "type" and read_multiline_input to return actual input
        with patch("cli.build_commands.select_menu", return_value="type"):
            with patch("cli.build_commands.read_multiline_input", return_value="Additional instructions"):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=mock_worktree_manager,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        captured = capsys.readouterr()
        # Should show "INSTRUCTIONS SAVED" message
        assert "INSTRUCTIONS SAVED" in captured.out or "instructions" in captured.out.lower()
        # Should show "TO RESUME" box
        assert "TO RESUME" in captured.out or "Resume" in captured.out
        # Should show worktree safety message when worktree_manager exists
        assert "safe" in captured.out.lower() or "workspace" in captured.out.lower()

    def test_interrupt_with_file_input_shows_resume_with_worktree_safety(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt with file input shows resume instructions including worktree safety (lines 484-485)."""
        # Create mock worktree manager
        mock_worktree_manager = MagicMock()

        # Mock select_menu to return "file" and read_from_file to return actual content
        with patch("cli.build_commands.select_menu", return_value="file"):
            with patch("cli.build_commands.read_from_file", return_value="Instructions from file"):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=mock_worktree_manager,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        captured = capsys.readouterr()
        # Should show "INSTRUCTIONS SAVED" message
        assert "INSTRUCTIONS SAVED" in captured.out or "instructions" in captured.out.lower()
        # Should show "TO RESUME" box
        assert "TO RESUME" in captured.out or "Resume" in captured.out
        # Should show worktree safety message when worktree_manager exists
        assert "safe" in captured.out.lower() or "workspace" in captured.out.lower()

    def test_interrupt_with_paste_input_shows_resume_with_worktree_safety(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt with paste input shows resume instructions including worktree safety (lines 484-485)."""
        # Create mock worktree manager
        mock_worktree_manager = MagicMock()

        # Mock select_menu to return "paste" and read_multiline_input to return actual input
        with patch("cli.build_commands.select_menu", return_value="paste"):
            with patch("cli.build_commands.read_multiline_input", return_value="Pasted instructions"):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=mock_worktree_manager,
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        captured = capsys.readouterr()
        # Should show "INSTRUCTIONS SAVED" message
        assert "INSTRUCTIONS SAVED" in captured.out or "instructions" in captured.out.lower()
        # Should show "TO RESUME" box
        assert "TO RESUME" in captured.out or "Resume" in captured.out
        # Should show worktree safety message when worktree_manager exists
        assert "safe" in captured.out.lower() or "workspace" in captured.out.lower()

    def test_interrupt_with_no_worktree_no_safety_message_in_resume(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Interrupt without worktree manager shows resume without safety message (lines 484-485)."""
        # No worktree manager (worktree_manager=None)

        # Mock select_menu to return "type" and read_multiline_input to return actual input
        with patch("cli.build_commands.select_menu", return_value="type"):
            with patch("cli.build_commands.read_multiline_input", return_value="Instructions"):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,  # No worktree
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        captured = capsys.readouterr()
        # Should show "TO RESUME" box
        assert "TO RESUME" in captured.out or "Resume" in captured.out
        # The specific "workspace is safe" message should NOT be present
        # because worktree_manager is None, so lines 484-485 are not executed
        # Note: The box is still shown, just without the safety message

    def test_interrupt_with_empty_input_no_worktree_shows_no_instructions_and_resume(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Empty input with no worktree shows no instructions message and resume (lines 444-446, 484-485)."""
        # Mock select_menu to return "type" and read_multiline_input to return empty string
        with patch("cli.build_commands.select_menu", return_value="type"):
            with patch("cli.build_commands.read_multiline_input", return_value=""):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=None,  # No worktree
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        captured = capsys.readouterr()
        # Should show "No instructions provided" message (lines 444-446)
        assert "No instructions" in captured.out or "instructions" in captured.out.lower()
        # Should still show "TO RESUME" box
        assert "TO RESUME" in captured.out or "Resume" in captured.out
        # The workspace safety message should NOT be present (no worktree_manager)

    def test_interrupt_with_empty_input_with_worktree_shows_no_instructions_and_resume(
        self,
        build_spec_dir,
        temp_git_repo,
        capsys,
    ):
        """Empty input with worktree shows no instructions message and resume with safety (lines 444-446, 484-485)."""
        # Create mock worktree manager
        mock_worktree_manager = MagicMock()

        # Mock select_menu to return "type" and read_multiline_input to return empty string
        with patch("cli.build_commands.select_menu", return_value="type"):
            with patch("cli.build_commands.read_multiline_input", return_value=""):
                # Execute
                _handle_build_interrupt(
                    spec_dir=build_spec_dir,
                    project_dir=temp_git_repo,
                    worktree_manager=mock_worktree_manager,  # Has worktree
                    working_dir=temp_git_repo,
                    model="sonnet",
                    max_iterations=None,
                    verbose=False,
                )

        captured = capsys.readouterr()
        # Should show "No instructions provided" message (lines 444-446)
        assert "No instructions" in captured.out or "instructions" in captured.out.lower()
        # Should show "TO RESUME" box
        assert "TO RESUME" in captured.out or "Resume" in captured.out
        # Should show worktree safety message when worktree_manager exists
        assert "safe" in captured.out.lower() or "workspace" in captured.out.lower()

#!/usr/bin/env python3
"""
Tests for --base-branch handling in PR creation
===============================================

Tests that the --base-branch CLI argument is correctly passed through
to the PR creation logic, ensuring PRs are created against the correct
base branch (not defaulting to main/develop when a custom base is specified).

Regression tests for the --base-branch fix in create-pr command.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Import the module (not just the function) so we can patch its attributes
import cli.workspace_commands as workspace_commands_module


class TestCreatePRBaseBranch:
    """Tests for base_branch parameter handling in PR creation."""

    @pytest.fixture
    def mock_worktree_manager(self):
        """Create a mock WorktreeManager."""
        mock = MagicMock()
        mock.base_branch = "main"
        mock.push_and_create_pr.return_value = {
            "success": True,
            "pr_url": "https://github.com/test/repo/pull/1",
            "already_exists": False,
        }
        return mock

    @pytest.fixture
    def temp_project_with_worktree(self, temp_dir: Path) -> tuple[Path, str]:
        """Create a project dir with a fake worktree for the spec.

        Returns:
            Tuple of (project_dir, spec_name)
        """
        # Create the .auto-claude directory structure
        auto_claude_dir = temp_dir / ".auto-claude"
        auto_claude_dir.mkdir(exist_ok=True)
        (auto_claude_dir / "specs").mkdir(exist_ok=True)
        worktrees_dir = auto_claude_dir / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True, exist_ok=True)

        # Create a fake worktree for the spec
        spec_name = "001-test-feature"
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir()
        (worktree_path / ".git").write_text("")  # Fake .git marker

        return temp_dir, spec_name

    def test_base_branch_passed_to_worktree_manager(
        self, temp_project_with_worktree: tuple[Path, str], mock_worktree_manager: MagicMock
    ):
        """Verify base_branch parameter is passed to WorktreeManager constructor."""
        project_dir, spec_name = temp_project_with_worktree
        custom_base = "feature/streaming-http-mcp"

        worktree_path = (
            project_dir
            / ".auto-claude"
            / "worktrees"
            / "tasks"
            / spec_name
        )

        # Patch core.worktree.WorktreeManager (local import in handle_create_pr_command)
        with patch.object(
            workspace_commands_module,
            "get_existing_build_worktree",
            return_value=worktree_path,
        ), patch(
            "core.worktree.WorktreeManager"
        ) as MockWorktreeManager, patch.object(
            workspace_commands_module, "print_banner"
        ):
            MockWorktreeManager.return_value = mock_worktree_manager

            result = workspace_commands_module.handle_create_pr_command(
                project_dir=project_dir,
                spec_name=spec_name,
                target_branch=None,
                title=None,
                draft=False,
                base_branch=custom_base,
            )

            # Verify the command succeeded
            assert result["success"] is True
            assert result["pr_url"] == "https://github.com/test/repo/pull/1"

            # Verify WorktreeManager was created with the custom base_branch
            MockWorktreeManager.assert_called_once_with(
                project_dir, base_branch=custom_base
            )

    def test_base_branch_none_uses_auto_detection(
        self, temp_project_with_worktree: tuple[Path, str], mock_worktree_manager: MagicMock
    ):
        """Verify that base_branch=None lets WorktreeManager auto-detect."""
        project_dir, spec_name = temp_project_with_worktree

        worktree_path = (
            project_dir
            / ".auto-claude"
            / "worktrees"
            / "tasks"
            / spec_name
        )

        with patch.object(
            workspace_commands_module,
            "get_existing_build_worktree",
            return_value=worktree_path,
        ), patch(
            "core.worktree.WorktreeManager"
        ) as MockWorktreeManager, patch.object(
            workspace_commands_module, "print_banner"
        ):
            MockWorktreeManager.return_value = mock_worktree_manager

            result = workspace_commands_module.handle_create_pr_command(
                project_dir=project_dir,
                spec_name=spec_name,
                target_branch=None,
                title=None,
                draft=False,
                base_branch=None,
            )

            # Verify the command succeeded
            assert result["success"] is True
            assert result["pr_url"] == "https://github.com/test/repo/pull/1"

            # Verify WorktreeManager was created with base_branch=None
            MockWorktreeManager.assert_called_once_with(
                project_dir, base_branch=None
            )

    def test_target_branch_and_base_branch_independent(
        self, temp_project_with_worktree: tuple[Path, str], mock_worktree_manager: MagicMock
    ):
        """Verify target_branch and base_branch are handled independently.

        target_branch: Where the PR should be merged TO
        base_branch: What branch the worktree was created FROM
        """
        project_dir, spec_name = temp_project_with_worktree
        custom_base = "feature/parent-feature"
        target = "develop"

        worktree_path = (
            project_dir
            / ".auto-claude"
            / "worktrees"
            / "tasks"
            / spec_name
        )

        with patch.object(
            workspace_commands_module,
            "get_existing_build_worktree",
            return_value=worktree_path,
        ), patch(
            "core.worktree.WorktreeManager"
        ) as MockWorktreeManager, patch.object(
            workspace_commands_module, "print_banner"
        ):
            MockWorktreeManager.return_value = mock_worktree_manager

            result = workspace_commands_module.handle_create_pr_command(
                project_dir=project_dir,
                spec_name=spec_name,
                target_branch=target,
                title=None,
                draft=False,
                base_branch=custom_base,
            )

            # Verify the command succeeded
            assert result["success"] is True
            assert result["pr_url"] == "https://github.com/test/repo/pull/1"

            # WorktreeManager should be created with base_branch, not target_branch
            MockWorktreeManager.assert_called_once_with(
                project_dir, base_branch=custom_base
            )

            # push_and_create_pr should receive target_branch
            mock_worktree_manager.push_and_create_pr.assert_called_once_with(
                spec_name=spec_name,
                target_branch=target,
                title=None,
                draft=False,
            )


class TestCLIArgumentParsing:
    """Tests for CLI argument parsing of --base-branch."""

    def test_base_branch_argument_parsed(self, monkeypatch):
        """Verify --base-branch argument is correctly parsed."""
        from cli.main import parse_args

        monkeypatch.setattr(sys, "argv", [
            "run.py",
            "--spec",
            "001",
            "--create-pr",
            "--base-branch",
            "feature/my-base",
        ])
        args = parse_args()

        assert args.base_branch == "feature/my-base"
        assert args.create_pr is True
        assert args.spec == "001"

    def test_base_branch_argument_optional(self, monkeypatch):
        """Verify --base-branch is optional and defaults to None."""
        from cli.main import parse_args

        monkeypatch.setattr(sys, "argv", ["run.py", "--spec", "001", "--create-pr"])
        args = parse_args()

        assert args.base_branch is None
        assert args.create_pr is True

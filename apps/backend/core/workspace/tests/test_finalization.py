#!/usr/bin/env python3
"""
Tests for Workspace Selection and Management
=============================================

Tests the workspace.py module functionality including:
- Workspace mode selection (isolated vs direct)
- Uncommitted changes detection
- Workspace setup
- Build finalization workflows
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

# Add parent directory to path so we can import the workspace module
# When co-located at workspace/tests/, we need to add backend to path
# workspace/tests -> workspace -> core -> backend (4 levels up)
_backend = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(_backend))

from core.workspace import (
    WorkspaceChoice,
    WorkspaceMode,
    get_current_branch,
    get_existing_build_worktree,
    has_uncommitted_changes,
    setup_workspace,
)
from worktree import WorktreeError, WorktreeManager

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"

# =============================================================================
# TESTS FOR finalization.py
# =============================================================================


class TestFinalizeWorkspace:
    """Tests for finalize_workspace function."""

    def test_direct_mode_returns_merge(self, temp_git_repo: Path, monkeypatch, capsys):
        """Direct mode returns MERGE choice and shows completion message."""
        from core.workspace.finalization import finalize_workspace

        # Mock the UI functions
        def mock_box(content, width=60, style="heavy"):
            return content

        monkeypatch.setattr("core.workspace.finalization.box", mock_box)

        result = finalize_workspace(
            temp_git_repo,
            "test-spec",
            manager=None,
            auto_continue=False,
        )

        assert result == WorkspaceChoice.MERGE

        captured = capsys.readouterr()
        assert "BUILD COMPLETE" in captured.out
        assert "directly to your project" in captured.out

    def test_auto_continue_mode_returns_later(self, temp_git_repo: Path):
        """Auto-continue mode returns LATER choice."""
        from core.workspace.finalization import finalize_workspace

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree info
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        result = finalize_workspace(
            temp_git_repo,
            spec_name,
            manager=manager,
            auto_continue=True,
        )

        assert result == WorkspaceChoice.LATER

    def test_isolated_mode_shows_menu(self, temp_git_repo: Path, monkeypatch):
        """Isolated mode shows menu with test/review/merge/later options."""
        from core.workspace.finalization import finalize_workspace

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock select_menu to return "test"
        def mock_select_menu(title, options, allow_quit):
            return "test"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        result = finalize_workspace(
            temp_git_repo,
            spec_name,
            manager=manager,
            auto_continue=False,
        )

        assert result == WorkspaceChoice.TEST


class TestHandleWorkspaceChoice:
    """Tests for handle_workspace_choice function."""

    def test_choice_test_shows_instructions(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """TEST choice shows testing instructions."""
        from core.workspace.finalization import handle_workspace_choice

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        handle_workspace_choice(WorkspaceChoice.TEST, temp_git_repo, spec_name, manager)

        captured = capsys.readouterr()
        assert "TEST YOUR FEATURE" in captured.out
        assert str(worktree_path) in captured.out

    def test_choice_merge_calls_merge_worktree(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """MERGE choice calls manager.merge_worktree."""
        from core.workspace.finalization import handle_workspace_choice

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree and commit something
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)
        (worktree_path / "test.py").write_text("test", encoding="utf-8")

        # Initialize git in worktree and commit
        subprocess.run(["git", "init"], cwd=worktree_path, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=worktree_path,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"],
            cwd=worktree_path,
            capture_output=True,
        )
        subprocess.run(["git", "add", "."], cwd=worktree_path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Test"], cwd=worktree_path, capture_output=True
        )

        handle_workspace_choice(
            WorkspaceChoice.MERGE, temp_git_repo, spec_name, manager
        )

        captured = capsys.readouterr()
        assert "Adding changes" in captured.out

    def test_choice_review_shows_changed_files(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """REVIEW choice shows changed files."""
        from core.workspace.finalization import handle_workspace_choice

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock show_changed_files
        mock_shown = []

        def mock_show_changed_files(manager, spec_name):
            mock_shown.append(spec_name)

        monkeypatch.setattr(
            "core.workspace.finalization.show_changed_files", mock_show_changed_files
        )

        handle_workspace_choice(
            WorkspaceChoice.REVIEW, temp_git_repo, spec_name, manager
        )

        assert len(mock_shown) == 1
        assert mock_shown[0] == spec_name

        captured = capsys.readouterr()
        assert "To see full details" in captured.out

    def test_choice_later_shows_deferred_message(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """LATER choice shows deferral message."""
        from core.workspace.finalization import handle_workspace_choice

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        handle_workspace_choice(
            WorkspaceChoice.LATER, temp_git_repo, spec_name, manager
        )

        captured = capsys.readouterr()
        assert "No problem!" in captured.out
        assert "saved" in captured.out


class TestReviewExistingBuild:
    """Tests for review_existing_build function."""

    def test_no_existing_build_shows_warning(self, temp_git_repo: Path, capsys):
        """Shows warning when no existing build found."""
        from core.workspace.finalization import review_existing_build

        result = review_existing_build(temp_git_repo, "nonexistent-spec")

        assert result is False

        captured = capsys.readouterr()
        assert "No existing build found" in captured.out

    def test_shows_build_contents(self, temp_git_repo: Path, capsys):
        """Shows build summary and changed files when build exists."""
        from core.workspace.finalization import review_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        result = review_existing_build(temp_git_repo, spec_name)

        assert result is True

        captured = capsys.readouterr()
        assert "BUILD CONTENTS" in captured.out


class TestDiscardExistingBuild:
    """Tests for discard_existing_build function."""

    def test_no_existing_build_returns_false(self, temp_git_repo: Path, capsys):
        """Returns False when no existing build found."""
        from core.workspace.finalization import discard_existing_build

        result = discard_existing_build(temp_git_repo, "nonexistent-spec")

        assert result is False

        captured = capsys.readouterr()
        assert "No existing build found" in captured.out

    def test_confirmation_deletes_build(self, temp_git_repo: Path, monkeypatch, capsys):
        """Deletes build when user types 'delete' to confirm."""
        from core.workspace.finalization import discard_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock input to return "delete"
        monkeypatch.setattr("builtins.input", lambda: "delete")

        result = discard_existing_build(temp_git_repo, spec_name)

        assert result is True
        captured = capsys.readouterr()
        assert "Build deleted" in captured.out

    def test_cancelled_confirmation_returns_false(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Returns False when user doesn't confirm."""
        from core.workspace.finalization import discard_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock input to return "no"
        monkeypatch.setattr("builtins.input", lambda: "no")

        result = discard_existing_build(temp_git_repo, spec_name)

        assert result is False
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out


class TestCheckExistingBuild:
    """Tests for check_existing_build function."""

    def test_no_existing_build_returns_false(self, temp_git_repo: Path):
        """Returns False when no existing build."""
        from core.workspace.finalization import check_existing_build

        result = check_existing_build(temp_git_repo, "nonexistent-spec")

        assert result is False

    def test_shows_menu_for_existing_build(self, temp_git_repo: Path, monkeypatch):
        """Shows menu when existing build found."""
        from core.workspace.finalization import check_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock select_menu to return "continue"
        def mock_select_menu(title, options, allow_quit):
            return "continue"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        result = check_existing_build(temp_git_repo, spec_name)

        assert result is True

    def test_review_choice_reviews_and_continues(
        self, temp_git_repo: Path, monkeypatch
    ):
        """Review choice reviews build then continues."""
        from core.workspace.finalization import check_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        review_called = []

        def mock_review(project_dir, spec_name):
            review_called.append(spec_name)
            return True

        def mock_select_menu(title, options, allow_quit):
            return "review"

        def mock_input(prompt):
            return ""

        monkeypatch.setattr(
            "core.workspace.finalization.review_existing_build", mock_review
        )
        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)
        monkeypatch.setattr("builtins.input", mock_input)

        result = check_existing_build(temp_git_repo, spec_name)

        assert result is True
        assert spec_name in review_called


class TestListAllWorktrees:
    """Tests for list_all_worktrees function."""

    def test_returns_empty_list_when_no_worktrees(self, temp_git_repo: Path):
        """Returns empty list when no worktrees exist."""
        from core.workspace.finalization import list_all_worktrees

        result = list_all_worktrees(temp_git_repo)

        assert result == []

    def test_lists_existing_worktrees(self, temp_git_repo: Path):
        """Returns list of existing worktrees."""
        from core.workspace.finalization import list_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        (worktrees_dir / "spec-001").mkdir()
        (worktrees_dir / "spec-002").mkdir()

        result = list_all_worktrees(temp_git_repo)

        assert len(result) == 2
        spec_names = {wt.spec_name for wt in result}
        assert "spec-001" in spec_names
        assert "spec-002" in spec_names


class TestCleanupAllWorktrees:
    """Tests for cleanup_all_worktrees function."""

    def test_no_worktrees_returns_false(self, temp_git_repo: Path, capsys):
        """Returns False when no worktrees found."""
        from core.workspace.finalization import cleanup_all_worktrees

        result = cleanup_all_worktrees(temp_git_repo, confirm=False)

        assert result is False

        captured = capsys.readouterr()
        assert "No worktrees found" in captured.out

    def test_cleanup_without_confirmation(self, temp_git_repo: Path):
        """Cleans up worktrees when confirm=False."""
        from core.workspace.finalization import cleanup_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        spec1_path = worktrees_dir / "spec-001"
        spec1_path.mkdir()
        spec2_path = worktrees_dir / "spec-002"
        spec2_path.mkdir()

        result = cleanup_all_worktrees(temp_git_repo, confirm=False)

        assert result is True
        assert not spec1_path.exists()
        assert not spec2_path.exists()

    def test_cleanup_with_confirmation_yes(self, temp_git_repo: Path, monkeypatch):
        """Cleans up worktrees when user confirms with 'yes'."""
        from core.workspace.finalization import cleanup_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        spec1_path = worktrees_dir / "spec-001"
        spec1_path.mkdir()

        # Mock input to return "yes"
        monkeypatch.setattr("builtins.input", lambda: "yes")

        result = cleanup_all_worktrees(temp_git_repo, confirm=True)

        assert result is True
        assert not spec1_path.exists()

    def test_cleanup_with_confirmation_no(self, temp_git_repo: Path, monkeypatch):
        """Cancels cleanup when user doesn't confirm."""
        from core.workspace.finalization import cleanup_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        spec1_path = worktrees_dir / "spec-001"
        spec1_path.mkdir()

        # Mock input to return "no"
        monkeypatch.setattr("builtins.input", lambda: "no")

        result = cleanup_all_worktrees(temp_git_repo, confirm=True)

        assert result is False
        assert spec1_path.exists()  # Should still exist

    def test_cleanup_with_confirmation_keyboard_interrupt(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Cancels cleanup when user presses Ctrl+C (KeyboardInterrupt)."""
        from core.workspace.finalization import cleanup_all_worktrees

        # Create worktrees
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        spec1_path = worktrees_dir / "spec-001"
        spec1_path.mkdir()

        # Mock input to raise KeyboardInterrupt
        def mock_input(prompt=""):
            raise KeyboardInterrupt()

        monkeypatch.setattr("builtins.input", mock_input)

        result = cleanup_all_worktrees(temp_git_repo, confirm=True)

        assert result is False
        assert spec1_path.exists()  # Should still exist

        captured = capsys.readouterr()
        assert "Cancelled" in captured.out


class TestFinalizeWorkspaceBranchCoverage:
    """Additional tests for finalize_workspace to cover missing branches."""

    def test_isolated_mode_merge_choice(self, temp_git_repo: Path, monkeypatch):
        """Isolated mode returns MERGE when user selects merge."""
        from core.workspace.finalization import finalize_workspace

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock select_menu to return "merge"
        def mock_select_menu(title, options, allow_quit):
            return "merge"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        result = finalize_workspace(
            temp_git_repo,
            spec_name,
            manager=manager,
            auto_continue=False,
        )

        assert result == WorkspaceChoice.MERGE

    def test_isolated_mode_review_choice(self, temp_git_repo: Path, monkeypatch):
        """Isolated mode returns REVIEW when user selects review."""
        from core.workspace.finalization import finalize_workspace

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock select_menu to return "review"
        def mock_select_menu(title, options, allow_quit):
            return "review"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        result = finalize_workspace(
            temp_git_repo,
            spec_name,
            manager=manager,
            auto_continue=False,
        )

        assert result == WorkspaceChoice.REVIEW

    def test_isolated_mode_later_choice(self, temp_git_repo: Path, monkeypatch):
        """Isolated mode returns LATER when user selects later."""
        from core.workspace.finalization import finalize_workspace

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock select_menu to return "later"
        def mock_select_menu(title, options, allow_quit):
            return "later"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        result = finalize_workspace(
            temp_git_repo,
            spec_name,
            manager=manager,
            auto_continue=False,
        )

        assert result == WorkspaceChoice.LATER


class TestHandleWorkspaceChoiceBranchCoverage:
    """Additional tests for handle_workspace_choice to cover missing branches."""

    def test_choice_test_without_staging_path(self, temp_git_repo: Path, capsys):
        """TEST choice shows fallback instructions when staging_path is None."""
        from core.workspace.finalization import handle_workspace_choice

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree directory (but not through manager, so no staging_path)
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        handle_workspace_choice(WorkspaceChoice.TEST, temp_git_repo, spec_name, manager)

        captured = capsys.readouterr()
        assert "TEST YOUR FEATURE" in captured.out
        # Should show the fallback path
        assert (
            str(worktree_path) in captured.out
            or f".auto-claude/worktrees/tasks/{spec_name}" in captured.out
        )

    def test_choice_merge_success(self, temp_git_repo: Path, capsys):
        """MERGE choice shows success message when merge succeeds."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        # Setup a proper isolated workspace with git worktree
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Make changes and commit
        (working_dir / "test.py").write_text("test content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add test"], cwd=working_dir, capture_output=True
        )

        handle_workspace_choice(
            WorkspaceChoice.MERGE, temp_git_repo, "test-spec", manager
        )

        captured = capsys.readouterr()
        assert "Your feature has been added" in captured.out

    def test_choice_later_without_staging_path(self, temp_git_repo: Path, capsys):
        """LATER choice shows fallback path when staging_path is None."""
        from core.workspace.finalization import handle_workspace_choice

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create worktree directory (but not through manager, so no staging_path)
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        handle_workspace_choice(
            WorkspaceChoice.LATER, temp_git_repo, spec_name, manager
        )

        captured = capsys.readouterr()
        assert "No problem!" in captured.out
        # Should show the fallback path
        assert (
            str(worktree_path) in captured.out
            or f".auto-claude/worktrees/tasks/{spec_name}" in captured.out
        )


class TestDiscardExistingBuildBranchCoverage:
    """Additional tests for discard_existing_build to cover missing branches."""

    def test_keyboard_interrupt_cancels_discard(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """KeyboardInterrupt during confirmation returns False."""
        from core.workspace.finalization import discard_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock input to raise KeyboardInterrupt
        def mock_input(prompt=""):
            raise KeyboardInterrupt()

        monkeypatch.setattr("builtins.input", mock_input)

        result = discard_existing_build(temp_git_repo, spec_name)

        assert result is False

        captured = capsys.readouterr()
        assert "Cancelled" in captured.out


class TestCheckExistingBuildBranchCoverage:
    """Additional tests for check_existing_build to cover missing branches."""

    def test_none_choice_exits(self, temp_git_repo: Path, monkeypatch):
        """None choice (quit) calls sys.exit(0)."""
        import sys

        from core.workspace.finalization import check_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        # Mock select_menu to return None (quit)
        def mock_select_menu(title, options, allow_quit):
            return None

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        # Should raise SystemExit
        with pytest.raises(SystemExit) as exc_info:
            check_existing_build(temp_git_repo, spec_name)

        assert exc_info.value.code == 0

    def test_merge_choice_merges_and_returns_false(
        self, temp_git_repo: Path, monkeypatch
    ):
        """Merge choice calls merge_existing_build and returns False."""
        from unittest.mock import MagicMock

        from core.workspace.finalization import check_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        merge_called = []

        def mock_merge_existing_build(project_dir, spec_name):
            merge_called.append(spec_name)

        def mock_select_menu(title, options, allow_quit):
            return "merge"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)

        # Mock the workspace module import
        import workspace as ws

        original_merge = getattr(ws, "merge_existing_build", None)
        ws.merge_existing_build = mock_merge_existing_build

        try:
            result = check_existing_build(temp_git_repo, spec_name)
            assert result is False
            assert spec_name in merge_called
        finally:
            if original_merge:
                ws.merge_existing_build = original_merge

    def test_fresh_choice_discards_and_returns_false(
        self, temp_git_repo: Path, monkeypatch
    ):
        """Fresh choice discards build and returns False (start fresh)."""
        from core.workspace.finalization import check_existing_build

        spec_name = "test-spec"
        worktrees_dir = temp_git_repo / ".auto-claude" / "worktrees" / "tasks"
        worktrees_dir.mkdir(parents=True)
        worktree_path = worktrees_dir / spec_name
        worktree_path.mkdir(parents=True)

        def mock_select_menu(title, options, allow_quit):
            return "fresh"

        monkeypatch.setattr("core.workspace.finalization.select_menu", mock_select_menu)
        # Mock input to return "delete" for confirmation
        monkeypatch.setattr("builtins.input", lambda: "delete")

        result = check_existing_build(temp_git_repo, spec_name)
        assert result is False, "Fresh choice should return False"

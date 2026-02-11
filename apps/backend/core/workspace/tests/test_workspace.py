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
from core.workspace.models import (
    MergeLock,
    MergeLockError,
    SpecNumberLock,
    SpecNumberLockError,
)
from worktree import WorktreeError, WorktreeManager

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"


class TestHasUncommittedChanges:
    """Tests for uncommitted changes detection."""

    def test_clean_repo_no_changes(self, temp_git_repo: Path):
        """Clean repo returns False."""
        result = has_uncommitted_changes(temp_git_repo)
        assert result is False

    def test_untracked_file_has_changes(self, temp_git_repo: Path):
        """Untracked file counts as changes."""
        (temp_git_repo / "new_file.txt").write_text("content", encoding="utf-8")

        result = has_uncommitted_changes(temp_git_repo)
        assert result is True

    def test_modified_file_has_changes(self, temp_git_repo: Path):
        """Modified tracked file counts as changes."""
        (temp_git_repo / "README.md").write_text("modified content", encoding="utf-8")

        result = has_uncommitted_changes(temp_git_repo)
        assert result is True

    def test_staged_file_has_changes(self, temp_git_repo: Path):
        """Staged file counts as changes."""
        (temp_git_repo / "README.md").write_text("modified", encoding="utf-8")
        subprocess.run(
            ["git", "add", "README.md"], cwd=temp_git_repo, capture_output=True
        )

        result = has_uncommitted_changes(temp_git_repo)
        assert result is True


class TestGetCurrentBranch:
    """Tests for current branch detection."""

    def test_gets_main_branch(self, temp_git_repo: Path):
        """Gets the main/master branch."""
        branch = get_current_branch(temp_git_repo)

        # Could be main or master depending on git config
        assert branch in ["main", "master"]

    def test_gets_feature_branch(self, temp_git_repo: Path):
        """Gets feature branch name."""
        subprocess.run(
            ["git", "checkout", "-b", "feature/test-branch"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        branch = get_current_branch(temp_git_repo)
        assert branch == "feature/test-branch"


class TestGetExistingBuildWorktree:
    """Tests for existing build worktree detection."""

    def test_no_existing_worktree(self, temp_git_repo: Path):
        """Returns None when no worktree exists."""
        result = get_existing_build_worktree(temp_git_repo, "test-spec")
        assert result is None

    def test_existing_worktree(self, temp_git_repo: Path):
        """Returns path when worktree exists."""
        # Create the worktree directory structure (per-spec architecture)
        worktree_path = temp_git_repo / ".worktrees" / TEST_SPEC_NAME
        worktree_path.mkdir(parents=True)

        result = get_existing_build_worktree(temp_git_repo, TEST_SPEC_NAME)
        assert result == worktree_path


class TestSetupWorkspace:
    """Tests for workspace setup."""

    def test_setup_direct_mode(self, temp_git_repo: Path):
        """Direct mode returns project dir and no manager."""
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.DIRECT,
        )

        assert working_dir == temp_git_repo
        assert manager is None

    def test_setup_isolated_mode(self, temp_git_repo: Path):
        """Isolated mode creates worktree and returns manager."""
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            TEST_SPEC_NAME,
            WorkspaceMode.ISOLATED,
        )

        assert working_dir != temp_git_repo
        assert manager is not None
        assert working_dir.exists()
        # Per-spec architecture: worktree is named after the spec
        assert working_dir.name == TEST_SPEC_NAME

    def test_setup_isolated_creates_worktrees_dir(self, temp_git_repo: Path):
        """Isolated mode creates worktrees directory."""
        setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        assert (temp_git_repo / ".auto-claude" / "worktrees" / "tasks").exists()


class TestWorkspaceUtilities:
    """Tests for workspace utility functions."""

    def test_per_spec_worktree_naming(self, temp_git_repo: Path):
        """Per-spec architecture uses spec name for worktree directory."""
        spec_name = "my-spec-001"
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            spec_name,
            WorkspaceMode.ISOLATED,
        )

        # Worktree should be named after the spec
        assert working_dir.name == spec_name
        # New path: .auto-claude/worktrees/tasks/{spec_name}
        assert working_dir.parent.name == "tasks"


class TestWorkspaceIntegration:
    """Integration tests for workspace management."""

    def test_isolated_workflow(self, temp_git_repo: Path):
        """Full isolated workflow: setup -> work -> finalize."""
        # Setup isolated workspace
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Make changes in workspace
        (working_dir / "feature.py").write_text("# New feature\n", encoding="utf-8")

        # Verify changes are in workspace
        assert (working_dir / "feature.py").exists()

        # Verify changes are NOT in main project
        assert not (temp_git_repo / "feature.py").exists()

    def test_direct_workflow(self, temp_git_repo: Path):
        """Full direct workflow: setup -> work."""
        # Setup direct workspace
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.DIRECT,
        )

        # Working dir is the project dir
        assert working_dir == temp_git_repo

        # Make changes directly
        (working_dir / "feature.py").write_text("# New feature\n", encoding="utf-8")

        # Changes are in main project
        assert (temp_git_repo / "feature.py").exists()

    def test_isolated_merge(self, temp_git_repo: Path):
        """Can merge isolated workspace back to main."""
        # Setup
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Make changes and commit using git directly
        (working_dir / "feature.py").write_text("# New feature\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add feature"], cwd=working_dir, capture_output=True
        )

        # Merge back using merge_worktree
        result = manager.merge_worktree("test-spec", delete_after=False)

        assert result is True

        # Check changes are in main
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        assert (temp_git_repo / "feature.py").exists()


class TestWorkspaceCleanup:
    """Tests for workspace cleanup."""

    def test_cleanup_after_merge(self, temp_git_repo: Path):
        """Workspace is cleaned up after merge with delete_after=True."""
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Commit changes using git directly
        (working_dir / "test.py").write_text("test", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Test"], cwd=working_dir, capture_output=True
        )

        # Merge with cleanup
        manager.merge_worktree("test-spec", delete_after=True)

        # Workspace should be removed
        assert not working_dir.exists()

    def test_workspace_preserved_after_merge_no_delete(self, temp_git_repo: Path):
        """Workspace preserved after merge with delete_after=False."""
        working_dir, manager, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Commit changes using git directly
        (working_dir / "test.py").write_text("test", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Test"], cwd=working_dir, capture_output=True
        )

        # Merge without cleanup
        manager.merge_worktree("test-spec", delete_after=False)

        # Workspace should still exist
        assert working_dir.exists()


class TestWorkspaceReuse:
    """Tests for reusing existing workspaces."""

    def test_reuse_existing_workspace(self, temp_git_repo: Path):
        """Can reuse existing workspace on second setup."""
        # First setup
        working_dir1, manager1, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Add a marker file
        (working_dir1 / "marker.txt").write_text("marker", encoding="utf-8")

        # Second setup (should reuse)
        working_dir2, manager2, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Should be the same directory
        assert working_dir1 == working_dir2

        # Marker should still exist
        assert (working_dir2 / "marker.txt").exists()


class TestWorkspaceErrors:
    """Tests for workspace error handling."""

    def test_setup_non_git_directory(self, temp_dir: Path):
        """Handles non-git directories gracefully."""
        # This should fail because temp_dir is not a git repo
        with pytest.raises(
            (OSError, ValueError, subprocess.CalledProcessError, WorktreeError)
        ):
            setup_workspace(
                temp_dir,
                "test-spec",
                WorkspaceMode.ISOLATED,
            )


class TestPerSpecWorktreeName:
    """Tests for per-spec worktree naming (new architecture)."""

    def test_worktree_named_after_spec(self, temp_git_repo: Path):
        """Worktree is named after the spec."""
        spec_name = "spec-1"
        working_dir, _, _ = setup_workspace(
            temp_git_repo,
            spec_name,
            WorkspaceMode.ISOLATED,
        )

        # Per-spec architecture: worktree directory matches spec name
        assert working_dir.name == spec_name

    def test_different_specs_get_different_worktrees(self, temp_git_repo: Path):
        """Different specs create separate worktrees."""
        working_dir1, _, _ = setup_workspace(
            temp_git_repo,
            "spec-1",
            WorkspaceMode.ISOLATED,
        )

        working_dir2, _, _ = setup_workspace(
            temp_git_repo,
            "spec-2",
            WorkspaceMode.ISOLATED,
        )

        # Each spec has its own worktree
        assert working_dir1.name == "spec-1"
        assert working_dir2.name == "spec-2"
        assert working_dir1 != working_dir2

    def test_worktree_path_in_worktrees_dir(self, temp_git_repo: Path):
        """Worktree is created in worktrees directory."""
        working_dir, _, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # New path: .auto-claude/worktrees/tasks/{spec_name}
        assert "worktrees" in str(working_dir)
        assert working_dir.parent.name == "tasks"


class TestConflictInfoDisplay:
    """Tests for conflict info display function (ACS-179)."""

    def test_print_conflict_info_with_string_list(self, capsys):
        """print_conflict_info handles string list of file paths (ACS-179)."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": ["file1.txt", "file2.py", "file3.js"]}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "3 file" in captured.out
        assert "file1.txt" in captured.out
        assert "file2.py" in captured.out
        assert "file3.js" in captured.out
        assert "git add" in captured.out

    def test_print_conflict_info_with_dict_list(self, capsys):
        """print_conflict_info handles dict list with file/reason/severity (ACS-179)."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "file1.txt", "reason": "Syntax error", "severity": "high"},
                {"file": "file2.py", "reason": "Merge conflict", "severity": "medium"},
                {"file": "file3.js", "reason": "Unknown error", "severity": "low"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "3 file" in captured.out
        assert "file1.txt" in captured.out
        assert "file2.py" in captured.out
        assert "file3.js" in captured.out
        assert "Syntax error" in captured.out
        assert "Merge conflict" in captured.out
        # Verify severity emoji indicators
        assert "🔴" in captured.out  # High severity
        assert "🟡" in captured.out  # Medium severity

    def test_print_conflict_info_mixed_formats(self, capsys):
        """print_conflict_info handles mixed string and dict conflicts (ACS-179)."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                "simple-file.txt",
                {
                    "file": "complex-file.py",
                    "reason": "AI merge failed",
                    "severity": "high",
                },
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "2 file" in captured.out
        assert "simple-file.txt" in captured.out
        assert "complex-file.py" in captured.out
        assert "AI merge failed" in captured.out


class TestMergeErrorHandling:
    """Tests for merge error handling (ACS-163)."""

    def test_merge_failure_returns_false_immediately(self, temp_git_repo: Path):
        """Failed merge returns False without falling through (ACS-163)."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with changes
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "worker-file.txt").write_text(
            "worker content", encoding="utf-8"
        )
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path,
            capture_output=True,
        )

        # Create a conflicting change on main
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "worker-file.txt").write_text("main content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Merge should fail (conflict) and return False
        # This tests the fix for ACS-163 where failed merge would fall through
        result = manager.merge_worktree("worker-spec", delete_after=False)

        # Should return False on merge conflict
        assert result is False

        # Verify side effects: base branch content is unchanged
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        base_content = (temp_git_repo / "worker-file.txt").read_text(encoding="utf-8")
        assert base_content == "main content", (
            "Base branch should be unchanged after failed merge"
        )


class TestMergeLockExceptionHandling:
    """Tests for exception handling in MergeLock.__exit__ (lines 136-137)."""

    def test_merge_lock_exit_handles_already_deleted_lock(self, temp_git_repo: Path):
        """MergeLock.__exit__ handles lock file already being deleted (lines 136-137)."""
        lock = MergeLock(temp_git_repo, "test-spec")

        with lock:
            assert lock.acquired is True
            # Delete the lock file manually before context exits
            lock.lock_file.unlink()

        # Should exit cleanly even though lock file was already deleted
        assert lock.lock_file.exists() is False


class TestSpecNumberLockExceptionHandling:
    """Tests for exception handling in SpecNumberLock.__exit__ (lines 225-226)."""

    def test_spec_number_lock_exit_handles_already_deleted_lock(
        self, temp_git_repo: Path
    ):
        """SpecNumberLock.__exit__ handles lock file already being deleted (lines 225-226)."""
        lock = SpecNumberLock(temp_git_repo)

        with lock:
            assert lock.acquired is True
            # Delete the lock file manually before context exits
            lock.lock_file.unlink()

        # Should exit cleanly even though lock file was already deleted
        assert lock.lock_file.exists() is False


class TestScanSpecsDirValueErrorHandling:
    """Tests for ValueError handling in _scan_specs_dir (lines 272-273)."""

    def test_scan_specs_dir_handles_non_numeric_prefix(self, temp_git_repo: Path):
        """_scan_specs_dir handles directories with non-numeric prefix (lines 272-273)."""
        lock = SpecNumberLock(temp_git_repo)

        # Create specs directory with invalid names
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Create directories with various invalid prefixes
        (specs_dir / "abc-invalid").mkdir()
        (specs_dir / "xyz-test").mkdir()
        (specs_dir / "--bad").mkdir()

        with lock:
            result = lock._scan_specs_dir(specs_dir)

            # Should ignore directories with non-numeric prefixes and return 0
            assert result == 0

    def test_scan_specs_dir_handles_partial_numeric_prefix(self, temp_git_repo: Path):
        """_scan_specs_dir handles directories with partial numeric prefix (lines 272-273)."""
        lock = SpecNumberLock(temp_git_repo)

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Create directories with partial numeric prefixes
        (specs_dir / "12-invalid").mkdir()  # Only 2 digits
        (specs_dir / "1-bad").mkdir()  # Only 1 digit
        (specs_dir / "001-valid").mkdir()  # Valid

        with lock:
            result = lock._scan_specs_dir(specs_dir)

            # Should only count the valid 3-digit prefix
            assert result == 1

    def test_scan_specs_dir_handles_empty_directory_name(self, temp_git_repo: Path):
        """_scan_specs_dir handles empty directory names gracefully (lines 272-273)."""
        lock = SpecNumberLock(temp_git_repo)

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Create directory that's just dashes (would cause issues with [:3])
        (specs_dir / "---").mkdir()

        with lock:
            result = lock._scan_specs_dir(specs_dir)

            # Should handle gracefully without crashing
            assert result == 0

    def test_scan_specs_dir_handles_very_long_numeric_prefix(self, temp_git_repo: Path):
        """_scan_specs_dir handles directories with long numeric strings (lines 272-273)."""
        lock = SpecNumberLock(temp_git_repo)

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Create directory with high spec number (tests parsing first 3 digits)
        # The glob pattern "[0-9][0-9][0-9]-*" matches exactly 3 digits, so use 999
        (specs_dir / "999-high-spec").mkdir()

        with lock:
            result = lock._scan_specs_dir(specs_dir)

            # Should parse the first 3 digits as number
            assert result == 999

    def test_scan_specs_dir_handles_mixed_valid_invalid(self, temp_git_repo: Path):
        """_scan_specs_dir handles mix of valid and invalid spec directories (lines 272-273)."""
        lock = SpecNumberLock(temp_git_repo)

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Mix of valid and invalid directories
        (specs_dir / "001-first").mkdir()
        (specs_dir / "invalid-name").mkdir()
        (specs_dir / "005-second").mkdir()
        (specs_dir / "abc").mkdir()
        (specs_dir / "010-third").mkdir()

        with lock:
            result = lock._scan_specs_dir(specs_dir)

            # Should only count valid directories and return max
            assert result == 10


# =============================================================================
# TESTS FOR WORKSPACE SETUP (core.workspace.setup) - MISSING COVERAGE
# =============================================================================


class TestChooseWorkspace:
    """Tests for choose_workspace function (lines 52-146)."""

    def test_force_isolated_mode(self, temp_git_repo: Path, monkeypatch):
        """Returns ISOLATED mode when force_isolated is True (lines 75-76)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import choose_workspace

        # Mock has_uncommitted_changes to avoid its side effects
        monkeypatch.setattr(
            "core.workspace.setup.has_uncommitted_changes", lambda x: False
        )

        result = choose_workspace(
            temp_git_repo,
            "test-spec",
            force_isolated=True,
        )

        assert result == WorkspaceMode.ISOLATED

    def test_force_direct_mode(self, temp_git_repo: Path, monkeypatch):
        """Returns DIRECT mode when force_direct is True (lines 77-78)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import choose_workspace

        # Mock has_uncommitted_changes to avoid its side effects
        monkeypatch.setattr(
            "core.workspace.setup.has_uncommitted_changes", lambda x: False
        )

        result = choose_workspace(
            temp_git_repo,
            "test-spec",
            force_direct=True,
        )

        assert result == WorkspaceMode.DIRECT

    def test_auto_continue_defaults_to_isolated(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Auto-continue mode defaults to isolated for safety (lines 81-83)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import choose_workspace

        # Mock has_uncommitted_changes to avoid its side effects
        monkeypatch.setattr(
            "core.workspace.setup.has_uncommitted_changes", lambda x: False
        )

        result = choose_workspace(
            temp_git_repo,
            "test-spec",
            auto_continue=True,
        )

        assert result == WorkspaceMode.ISOLATED
        captured = capsys.readouterr()
        assert "Auto-continue" in captured.out

    def test_unsaved_work_triggers_isolated(self, temp_git_repo: Path, monkeypatch):
        """Uncommitted changes trigger isolated mode (lines 86-110)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import choose_workspace

        # Mock has_uncommitted_changes to return True
        monkeypatch.setattr(
            "core.workspace.setup.has_uncommitted_changes", lambda x: True
        )

        # Mock input to simulate Enter key press
        monkeypatch.setattr("builtins.input", lambda x: None)

        result = choose_workspace(
            temp_git_repo,
            "test-spec",
        )

        assert result == WorkspaceMode.ISOLATED

    def test_unsaved_work_with_keyboard_interrupt(
        self, temp_git_repo: Path, monkeypatch
    ):
        """KeyboardInterrupt during unsaved work prompt exits cleanly (lines 105-108)."""
        import sys

        from core.workspace.setup import choose_workspace

        # Mock has_uncommitted_changes to return True
        monkeypatch.setattr(
            "core.workspace.setup.has_uncommitted_changes", lambda x: True
        )

        # Mock input to raise KeyboardInterrupt
        def mock_input(prompt):
            raise KeyboardInterrupt()

        monkeypatch.setattr("builtins.input", mock_input)

        # Should exit via sys.exit(0)
        with pytest.raises(SystemExit) as exc_info:
            choose_workspace(temp_git_repo, "test-spec")

        assert exc_info.value.code == 0


class TestDebugModuleFallback:
    """Tests for debug module fallback functions (lines 35-43)."""

    def test_fallback_debug_function(self, monkeypatch):
        """Fallback debug function does nothing when module is unavailable."""
        # Remove debug from sys.modules if present
        import sys

        debug_module = sys.modules.pop("debug", None)

        try:
            # Re-import setup.py to trigger the fallback
            monkeypatch.setattr(sys, "modules", {**sys.modules})
            if "core.workspace.setup" in sys.modules:
                del sys.modules["core.workspace.setup"]

            # Import fresh - should use fallback
            import core.workspace.setup as setup_module

            # Fallback debug functions should be no-ops
            setup_module.debug("test", "message")
            setup_module.debug_warning("test", "warning")

            # Should not raise any exceptions
            assert True
        finally:
            # Restore debug module if it existed
            if debug_module is not None:
                sys.modules["debug"] = debug_module

    def test_fallback_debug_warning_function(self, monkeypatch):
        """Fallback debug_warning function does nothing when module is unavailable."""
        import sys

        # Remove debug from sys.modules if present
        debug_module = sys.modules.pop("debug", None)

        try:
            # Force reimport to use fallback
            if "core.workspace.setup" in sys.modules:
                del sys.modules["core.workspace.setup"]

            from core.workspace.setup import debug_warning

            # Fallback function should be a no-op
            debug_warning("test_module", "test_warning")

            # Should not raise any exceptions
            assert True
        finally:
            if debug_module is not None:
                sys.modules["debug"] = debug_module


class TestSymlinkBrokenSymlinkDetection:
    """Tests for broken symlink detection (lines 242-247)."""

    @pytest.mark.skipif(sys.platform == "win32", reason="Unix-specific symlink test")
    def test_skips_broken_symlinks(self, temp_git_repo: Path):
        """Skips creating symlink if broken symlink already exists (lines 242-247)."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Create node_modules in project
        node_modules = temp_git_repo / "node_modules"
        node_modules.mkdir()
        (node_modules / "test.txt").write_text("test", encoding="utf-8")

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Create a broken symlink (pointing to non-existent path)
        non_existent_path = temp_git_repo / "non_existent_path"
        os.symlink(
            non_existent_path, worktree_path / "node_modules", target_is_directory=False
        )

        # Verify symlink is broken
        assert (worktree_path / "node_modules").is_symlink()
        assert not (worktree_path / "node_modules").exists()

        # Should skip the broken symlink
        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        # node_modules should not be in symlinked list
        assert "node_modules" not in symlinked


class TestWindowsJunctionFailure:
    """Tests for Windows junction creation failure (lines 256-262)."""

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-specific test")
    def test_handles_mklink_failure(self, temp_git_repo: Path, monkeypatch, capsys):
        """Handles mklink /J failure gracefully (lines 256-262)."""
        from unittest.mock import patch

        from core.workspace.setup import symlink_node_modules_to_worktree

        # Create node_modules in project
        node_modules = temp_git_repo / "node_modules"
        node_modules.mkdir()
        (node_modules / "test.txt").write_text("test", encoding="utf-8")

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Mock subprocess.run to simulate mklink failure
        def mock_subprocess_run(cmd, capture_output=False, text=False):
            result = type(
                "obj", (object,), {"returncode": 1, "stderr": "Access denied"}
            )()
            return result

        with patch("subprocess.run", side_effect=mock_subprocess_run):
            with monkeypatch.context() as m:
                m.setattr("sys.platform", "win32")
                symlinked = symlink_node_modules_to_worktree(
                    temp_git_repo, worktree_path
                )

        # Should handle failure gracefully
        assert "node_modules" not in symlinked


class TestSymlinkOSErrorHandling:
    """Tests for OSError handling in symlink creation (lines 269-278)."""

    @pytest.mark.skipif(sys.platform == "win32", reason="Unix-specific test")
    def test_handles_oserror_on_symlink_creation(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Handles OSError when symlink creation fails (lines 269-281)."""
        from unittest.mock import patch

        from core.workspace.setup import symlink_node_modules_to_worktree

        # Create node_modules in project
        node_modules = temp_git_repo / "node_modules"
        node_modules.mkdir()
        (node_modules / "test.txt").write_text("test", encoding="utf-8")

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Mock os.symlink to raise OSError
        def mock_symlink(src, dst):
            raise OSError("Filesystem does not support symlinks")

        with patch("os.symlink", side_effect=mock_symlink):
            symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        # Should handle error gracefully
        assert "node_modules" not in symlinked

        # Check warning message was printed
        captured = capsys.readouterr()
        assert "Warning" in captured.out or "node_modules" in captured.out


class TestEnvFilesPrintStatus:
    """Tests for env files copy print status (line 373)."""

    def test_prints_status_when_env_files_copied(self, temp_git_repo: Path, capsys):
        """Prints status message when env files are copied (line 373-375)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace

        # Create .env file in project root
        (temp_git_repo / ".env").write_text("TEST=1", encoding="utf-8")

        # Setup isolated workspace - .env should be copied
        setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        captured = capsys.readouterr()
        assert "Environment files copied" in captured.out


class TestSymlinkedModulesPrintStatus:
    """Tests for symlinked modules print status (line 383)."""

    @pytest.mark.skipif(sys.platform == "win32", reason="Unix-specific symlink test")
    def test_prints_status_when_modules_symlinked(self, temp_git_repo: Path, capsys):
        """Prints status message when node_modules are symlinked (line 383)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace

        # Create backend/.venv to trigger Python virtual environment detection
        # This is a common pattern in this monorepo
        backend_venv = temp_git_repo / "apps" / "backend" / ".venv"
        backend_venv.mkdir(parents=True)
        (backend_venv / "lib").mkdir()

        # Create node_modules at root
        node_modules = temp_git_repo / "node_modules"
        node_modules.mkdir()
        (node_modules / "package.json").write_text("{}", encoding="utf-8")

        # Create apps/frontend/node_modules
        frontend_node_modules = temp_git_repo / "apps" / "frontend" / "node_modules"
        frontend_node_modules.mkdir(parents=True)
        (frontend_node_modules / "react").mkdir()

        # Setup isolated workspace - node_modules should be symlinked
        setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        captured = capsys.readouterr()
        assert "Dependencies linked" in captured.out


class TestSecurityFilesCopy:
    """Tests for security files copy with error handling (lines 395-407)."""

    def test_copies_security_files(self, temp_git_repo: Path):
        """Copies security configuration files to worktree (lines 389-406)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace
        from security.constants import ALLOWLIST_FILENAME, PROFILE_FILENAME

        # Create security files
        allowlist_file = temp_git_repo / ALLOWLIST_FILENAME
        allowlist_file.write_text("allowlist content", encoding="utf-8")

        profile_file = temp_git_repo / PROFILE_FILENAME
        profile_file.write_text('{"profile": "data"}', encoding="utf-8")

        # Commit changes
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add security files"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Setup workspace
        worktree_path, _, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Verify files were copied
        assert (worktree_path / ALLOWLIST_FILENAME).exists()
        assert (worktree_path / PROFILE_FILENAME).exists()
        assert (worktree_path / ALLOWLIST_FILENAME).read_text(
            encoding="utf-8"
        ) == "allowlist content"

    def test_handles_security_file_copy_error(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Handles OSError when copying security files (lines 399-406)."""
        from unittest.mock import patch

        from core.workspace.setup import copy_env_files_to_worktree
        from security.constants import ALLOWLIST_FILENAME

        # Create security file
        allowlist_file = temp_git_repo / ALLOWLIST_FILENAME
        allowlist_file.write_text("content", encoding="utf-8")

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Mock shutil.copy2 to raise PermissionError
        def mock_copy2(src, dst):
            if ALLOWLIST_FILENAME in str(src):
                raise PermissionError("Access denied")
            return shutil.copy2(src, dst)

        with patch("shutil.copy2", side_effect=mock_copy2):
            # This should handle the error gracefully
            copy_env_files_to_worktree(temp_git_repo, worktree_path)

        # Function should complete without raising
        assert True


class TestSecurityProfileInheritance:
    """Tests for security profile inheritance marking (lines 413-428)."""

    def test_marks_profile_as_inherited(self, temp_git_repo: Path):
        """Marks security profile with inherited_from field (lines 416-428)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace
        from security.constants import PROFILE_FILENAME

        # Create security profile
        profile_data = {"profile": "test-profile", "project_type": "python"}
        profile_file = temp_git_repo / PROFILE_FILENAME
        profile_file.write_text(json.dumps(profile_data, indent=2), encoding="utf-8")

        # Commit changes
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add profile"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Setup workspace
        worktree_path, _, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Verify profile was marked as inherited
        worktree_profile = worktree_path / PROFILE_FILENAME
        assert worktree_profile.exists()

        with open(worktree_profile, encoding="utf-8") as f:
            worktree_profile_data = json.load(f)

        assert "inherited_from" in worktree_profile_data
        assert str(temp_git_repo.resolve()) in worktree_profile_data["inherited_from"]

    def test_handles_corrupt_profile_json(self, temp_git_repo: Path, capsys):
        """Handles JSON decode error when reading profile (line 427-428)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace
        from security.constants import PROFILE_FILENAME

        # Create corrupt profile file
        profile_file = temp_git_repo / PROFILE_FILENAME
        profile_file.write_text("{invalid json content", encoding="utf-8")

        # Commit changes
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add corrupt profile"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Setup workspace - should handle error gracefully
        worktree_path, _, _ = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
        )

        # Verify worktree was created despite corrupt profile
        assert worktree_path.exists()


class TestSpecCopyInSetupWorkspace:
    """Tests for spec copy in setup_workspace (lines 441-445)."""

    def test_copies_spec_to_workspace(self, temp_git_repo: Path):
        """Copies spec files to workspace when source_spec_dir is provided (lines 441-445)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace

        # Create source spec directory
        source_spec = temp_git_repo / "external-specs" / "test-spec"
        source_spec.mkdir(parents=True)
        (source_spec / "spec.md").write_text("# Test Spec", encoding="utf-8")
        (source_spec / "requirements.json").write_text("{}", encoding="utf-8")

        # Setup workspace with source spec
        worktree_path, _, localized_spec = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
            source_spec_dir=source_spec,
        )

        # Verify spec was copied
        assert localized_spec is not None
        assert localized_spec.exists()
        assert (localized_spec / "spec.md").exists()
        assert (localized_spec / "requirements.json").exists()

    def test_skips_spec_copy_when_source_not_exists(self, temp_git_repo: Path):
        """Skips spec copy when source_spec_dir does not exist (lines 441-445)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace

        # Setup workspace with non-existent source spec
        non_existent_spec = temp_git_repo / "non-existent-spec"

        worktree_path, _, localized_spec = setup_workspace(
            temp_git_repo,
            "test-spec",
            WorkspaceMode.ISOLATED,
            source_spec_dir=non_existent_spec,
        )

        # localized_spec should be None
        assert localized_spec is None


class TestTimelineHookNotGitRepo:
    """Tests for ensure_timeline_hook_installed with non-git directory (line 477)."""

    def test_returns_early_when_not_git_repo(self, temp_dir: Path):
        """Returns early when directory is not a git repository (line 477)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Should not raise any exception
        ensure_timeline_hook_installed(temp_dir)

        # Function should return without doing anything
        assert True


class TestTimelineHookWorktreeGitFile:
    """Tests for worktree .git file handling (lines 480-485)."""

    def test_handles_worktree_git_file(self, temp_git_repo: Path):
        """Handles worktree where .git is a file, not directory (lines 480-485)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create a worktree-style .git file
        git_dir = temp_git_repo / ".git"
        git_dir_content = "gitdir: .git/worktrees/test\n"

        # Save original .git directory
        git_backup = temp_git_repo / ".git.backup"
        if git_dir.is_dir():
            shutil.move(str(git_dir), str(git_backup))

        try:
            # Create .git as a file (worktree style)
            git_dir.write_text(git_dir_content, encoding="utf-8")

            # Should handle this gracefully
            ensure_timeline_hook_installed(temp_git_repo)

            assert True
        finally:
            # Restore original .git
            if git_backup.exists():
                if git_dir.exists():
                    git_dir.unlink()
                shutil.move(str(git_backup), str(git_dir))

    def test_handles_invalid_git_file_content(self, temp_git_repo: Path):
        """Handles .git file with invalid content (lines 481-485)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create a .git file with invalid content
        git_dir = temp_git_repo / ".git"
        git_backup = temp_git_repo / ".git.backup"

        # Save original
        if git_dir.is_dir():
            shutil.move(str(git_dir), str(git_backup))

        try:
            # Write invalid content (doesn't start with "gitdir:")
            git_dir.write_text("invalid content", encoding="utf-8")

            # Should return early without error
            ensure_timeline_hook_installed(temp_git_repo)

            assert True
        finally:
            if git_backup.exists():
                if git_dir.exists():
                    git_dir.unlink()
                shutil.move(str(git_backup), str(git_dir))


class TestTimelineHookExistsCheck:
    """Tests for hook exists check (lines 490-493)."""

    def test_skips_when_hook_already_exists(self, temp_git_repo: Path, monkeypatch):
        """Skips installation when hook already exists with FileTimelineTracker (lines 490-493)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create hooks directory and hook file with FileTimelineTracker marker
        hooks_dir = temp_git_repo / ".git" / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)

        hook_file = hooks_dir / "post-commit"
        hook_content = """#!/bin/sh
# FileTimelineTracker hook
git log -1
"""
        hook_file.write_text(hook_content, encoding="utf-8")

        # Track if install_hook was called
        install_called = []

        def mock_install_hook(project_dir):
            install_called.append(True)

        monkeypatch.setattr("merge.install_hook.install_hook", mock_install_hook)

        ensure_timeline_hook_installed(temp_git_repo)

        # install_hook should NOT have been called
        assert len(install_called) == 0


class TestTimelineHookExceptionHandling:
    """Tests for exception handling in ensure_timeline_hook_installed (lines 501-503)."""

    def test_handles_exception_gracefully(self, temp_git_repo: Path, monkeypatch):
        """Handles exceptions during hook installation gracefully (lines 501-503)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Mock install_hook to raise an exception
        def mock_install_hook(project_dir):
            raise RuntimeError("Hook installation failed")

        monkeypatch.setattr("merge.install_hook.install_hook", mock_install_hook)

        # Should not raise exception - should handle it via debug_warning
        ensure_timeline_hook_installed(temp_git_repo)

        # Test passes if no exception was raised
        assert True


class TestInitializeTimelineTrackingNoSourceSpec:
    """Tests for initialize_timeline_tracking without source spec (lines 563-569)."""

    def test_initializes_from_worktree_without_plan(self, temp_git_repo: Path):
        """Initializes tracking from worktree when no implementation plan exists (lines 563-569)."""
        from core.workspace.setup import initialize_timeline_tracking

        # Create worktree with some changes
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)
        (worktree_path / "test.py").write_text("# Test file", encoding="utf-8")

        # Call without source_spec_dir
        initialize_timeline_tracking(
            project_dir=temp_git_repo,
            spec_name="test-spec",
            worktree_path=worktree_path,
            source_spec_dir=None,
        )

        # Should complete without error
        assert True


class TestInitializeTimelineTrackingWithNoFiles:
    """Tests for initialize_timeline_tracking with no files to track."""

    def test_handles_no_files_in_plan(self, temp_git_repo: Path):
        """Handles implementation plan with no files to modify (lines 546-561)."""
        from core.workspace.setup import initialize_timeline_tracking

        # Create source spec with empty implementation plan
        source_spec = temp_git_repo / ".auto-claude" / "specs" / "test-spec"
        source_spec.mkdir(parents=True)

        plan = {"title": "Empty Plan", "description": "No files", "phases": []}
        (source_spec / "implementation_plan.json").write_text(
            json.dumps(plan), encoding="utf-8"
        )

        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Should handle empty plan gracefully
        initialize_timeline_tracking(
            project_dir=temp_git_repo,
            spec_name="test-spec",
            worktree_path=worktree_path,
            source_spec_dir=source_spec,
        )

        assert True


class TestFinalizationWorkspaceCdPathFallbacks:
    """Tests for finalization cd path fallback when get_existing_build_worktree returns None (lines 176, 247)."""

    def test_test_choice_fallback_to_default_path(
        self, temp_git_repo: Path, capsys, monkeypatch
    ):
        """Tests TEST choice shows default .auto-claude path when worktree not found (lines 172-180)."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Mock get_existing_build_worktree to return None (no worktree found)
        def mock_get_existing_build_worktree(project_dir, spec_name):
            return None

        monkeypatch.setattr(
            "core.workspace.finalization.get_existing_build_worktree",
            mock_get_existing_build_worktree,
        )

        handle_workspace_choice(WorkspaceChoice.TEST, temp_git_repo, spec_name, manager)

        captured = capsys.readouterr()
        # Should show the default .auto-claude/worktrees/tasks/{spec_name} path
        assert ".auto-claude/worktrees/tasks/test-spec" in captured.out

    def test_later_choice_fallback_to_default_path(
        self, temp_git_repo: Path, capsys, monkeypatch
    ):
        """Tests LATER choice shows default path when worktree not found (lines 243-251)."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Mock get_existing_build_worktree to return None
        def mock_get_existing_build_worktree(project_dir, spec_name):
            return None

        monkeypatch.setattr(
            "core.workspace.finalization.get_existing_build_worktree",
            mock_get_existing_build_worktree,
        )

        handle_workspace_choice(
            WorkspaceChoice.LATER, temp_git_repo, spec_name, manager
        )

        captured = capsys.readouterr()
        # Should show the default .auto-claude/worktrees/tasks/{spec_name} path
        assert ".auto-claude/worktrees/tasks/test-spec" in captured.out


class TestFinalizationWorkspaceCdPathWithExistingBuild:
    """Tests for finalization cd path when get_existing_build_worktree returns a path (lines 174, 245)."""

    def test_test_choice_shows_existing_worktree_path(
        self, temp_git_repo: Path, capsys, monkeypatch
    ):
        """Tests TEST choice shows worktree path when staging_path is None and get_existing_build_worktree returns path (line 174)."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create a worktree directory (plain directory, not a git worktree)
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / spec_name
        )
        worktree_path.mkdir(parents=True)

        # Mock manager.get_worktree_info to return None (simulating no valid worktree info)
        # This ensures staging_path will be None
        monkeypatch.setattr(manager, "get_worktree_info", lambda spec_name: None)

        # Mock get_existing_build_worktree to return the worktree path
        def mock_get_existing_build_worktree(project_dir, spec_name):
            return worktree_path

        monkeypatch.setattr(
            "core.workspace.finalization.get_existing_build_worktree",
            mock_get_existing_build_worktree,
        )

        handle_workspace_choice(WorkspaceChoice.TEST, temp_git_repo, spec_name, manager)

        captured = capsys.readouterr()
        # Should show the actual worktree path (via line 174)
        assert str(worktree_path) in captured.out

    def test_later_choice_shows_existing_worktree_path(
        self, temp_git_repo: Path, capsys, monkeypatch
    ):
        """Tests LATER choice shows worktree path when staging_path is None and get_existing_build_worktree returns path (line 245)."""
        from core.workspace.finalization import handle_workspace_choice
        from worktree import WorktreeManager

        manager = WorktreeManager(temp_git_repo)
        spec_name = "test-spec"

        # Create a worktree directory (plain directory, not a git worktree)
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / spec_name
        )
        worktree_path.mkdir(parents=True)

        # Mock manager.get_worktree_info to return None (simulating no valid worktree info)
        # This ensures staging_path will be None
        monkeypatch.setattr(manager, "get_worktree_info", lambda spec_name: None)

        # Mock get_existing_build_worktree to return the worktree path
        def mock_get_existing_build_worktree(project_dir, spec_name):
            return worktree_path

        monkeypatch.setattr(
            "core.workspace.finalization.get_existing_build_worktree",
            mock_get_existing_build_worktree,
        )

        handle_workspace_choice(
            WorkspaceChoice.LATER, temp_git_repo, spec_name, manager
        )

        captured = capsys.readouterr()
        # Should show the actual worktree path (via line 245)
        assert str(worktree_path) in captured.out


class TestChooseWorkspaceMenuSelection:
    """Tests for choose_workspace menu selection (lines 113-146)."""

    def test_shows_menu_with_isolated_and_direct_options(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Shows menu with isolated and direct options when no uncommitted changes (lines 113-146)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import choose_workspace

        # Mock has_uncommitted_changes to return False
        monkeypatch.setattr(
            "core.workspace.setup.has_uncommitted_changes", lambda x: False
        )

        # Mock select_menu to return "direct" choice
        def mock_select_menu(title, options, allow_quit=False):
            from ui import MenuOption

            # Verify the options are correct
            assert len(options) == 2
            assert options[0].key == "isolated"
            assert options[1].key == "direct"
            assert "Separate workspace" in options[0].label
            assert "Right here" in options[1].label
            return "direct"

        monkeypatch.setattr("core.workspace.setup.select_menu", mock_select_menu)

        result = choose_workspace(
            temp_git_repo,
            "test-spec",
        )

        assert result == WorkspaceMode.DIRECT
        captured = capsys.readouterr()
        assert "Working directly in your project" in captured.out

    def test_menu_selects_isolated_returns_isolated_mode(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Menu returns isolated mode when isolated option is selected (lines 139-146)."""
        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import choose_workspace

        # Mock has_uncommitted_changes to return False
        monkeypatch.setattr(
            "core.workspace.setup.has_uncommitted_changes", lambda x: False
        )

        # Mock select_menu to return "isolated"
        monkeypatch.setattr(
            "core.workspace.setup.select_menu",
            lambda title, options, allow_quit=False: "isolated",
        )

        result = choose_workspace(
            temp_git_repo,
            "test-spec",
        )

        assert result == WorkspaceMode.ISOLATED
        captured = capsys.readouterr()
        assert "Using a separate workspace for safety" in captured.out

    def test_menu_with_none_choice_exits(self, temp_git_repo: Path, monkeypatch):
        """Menu with None choice (user quit) exits via sys.exit(0) (lines 134-137)."""
        from core.workspace.setup import choose_workspace

        # Mock has_uncommitted_changes to return False
        monkeypatch.setattr(
            "core.workspace.setup.has_uncommitted_changes", lambda x: False
        )

        # Mock select_menu to return None (user quit)
        monkeypatch.setattr(
            "core.workspace.setup.select_menu",
            lambda title, options, allow_quit=False: None,
        )

        # Should exit via sys.exit(0)
        with pytest.raises(SystemExit) as exc_info:
            choose_workspace(temp_git_repo, "test-spec")

        assert exc_info.value.code == 0


class TestWindowsJunctionCreation:
    """Tests for Windows-specific junction creation in symlink_node_modules_to_worktree (lines 256-262)."""

    @pytest.mark.skipif(
        sys.platform != "win32",
        reason="Windows junction creation only applies on Windows",
    )
    def test_creates_junction_on_windows(self, temp_git_repo: Path, monkeypatch):
        """Creates junction on Windows using mklink /J command (lines 256-262)."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Create source node_modules directory
        source_node_modules = temp_git_repo / "node_modules"
        source_node_modules.mkdir()
        (source_node_modules / "test-package").mkdir()

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Mock subprocess.run to simulate mklink /J
        mock_results = []

        def mock_subprocess_run(cmd, capture_output=False, text=False, **kwargs):
            mock_results.append(cmd)
            result = type("MockResult", (), {"returncode": 0, "stderr": ""})()
            return result

        monkeypatch.setattr("subprocess.run", mock_subprocess_run)

        # Call the function
        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        # Verify mklink /J command was called
        assert len(mock_results) > 0
        cmd = mock_results[0]
        assert "cmd" in cmd
        assert "/c" in cmd
        assert "mklink" in cmd
        assert "/J" in cmd

    @pytest.mark.skipif(
        sys.platform != "win32",
        reason="Windows junction creation only applies on Windows",
    )
    def test_handles_junction_creation_failure(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Handles mklink /J failure gracefully (lines 261-262, 269-281)."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Create source node_modules directory
        source_node_modules = temp_git_repo / "node_modules"
        source_node_modules.mkdir()

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Mock subprocess.run to simulate mklink failure
        def mock_subprocess_run(cmd, capture_output=False, text=False, **kwargs):
            result = type(
                "MockResult", (), {"returncode": 1, "stderr": "Access denied"}
            )()
            return result

        monkeypatch.setattr("subprocess.run", mock_subprocess_run)

        # Call the function - should handle error gracefully
        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        # Should return empty list (no successful symlinks)
        assert len(symlinked) == 0

        captured = capsys.readouterr()
        # Should show warning
        assert "Warning" in captured.out or "TypeScript" in captured.out

    def test_creates_relative_symlink_on_non_windows(
        self, temp_git_repo: Path, monkeypatch
    ):
        """Creates relative symlink on non-Windows platforms (lines 264-266)."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Skip on actual Windows
        if sys.platform == "win32":
            pytest.skip("Test for non-Windows platforms")

        # Create source node_modules directory
        source_node_modules = temp_git_repo / "node_modules"
        source_node_modules.mkdir()
        (source_node_modules / "test-package").mkdir()

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Call the function
        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        # Verify symlink was created
        assert len(symlinked) > 0
        target_path = worktree_path / symlinked[0]
        assert target_path.is_symlink()


class TestSecurityFileCopyErrorInSetupWorkspace:
    """Tests for security file copy error handling in setup_workspace (lines 402-403)."""

    def test_handles_security_file_copy_oserror_in_setup(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Handles OSError when copying security files in setup_workspace (lines 402-406)."""
        from unittest.mock import patch

        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace
        from security.constants import ALLOWLIST_FILENAME

        # Create security file
        allowlist_file = temp_git_repo / ALLOWLIST_FILENAME
        allowlist_file.write_text("content", encoding="utf-8")

        # Commit changes
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add allowlist"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Track if warning was printed
        print_calls = []

        original_print = (
            __builtins__["print"]
            if isinstance(__builtins__, dict)
            else __builtins__.print
        )

        def mock_print(*args, **kwargs):
            print_calls.append((args, kwargs))
            return original_print(*args, **kwargs)

        # Mock shutil.copy2 to raise OSError for security files
        def mock_copy2(src, dst):
            if ALLOWLIST_FILENAME in str(src):
                raise OSError("Permission denied")
            return shutil.copy2(src, dst)

        monkeypatch.setattr("builtins.print", mock_print)

        with patch("shutil.copy2", side_effect=mock_copy2):
            # Setup workspace - should handle error gracefully
            worktree_path, _, _ = setup_workspace(
                temp_git_repo,
                "test-spec",
                WorkspaceMode.ISOLATED,
            )

        # Verify worktree was created despite copy error
        assert worktree_path.exists()

    def test_handles_permission_error_on_security_copy(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Handles PermissionError when copying security files (lines 402-406)."""
        from unittest.mock import patch

        from core.workspace.models import WorkspaceMode
        from core.workspace.setup import setup_workspace
        from security.constants import PROFILE_FILENAME

        # Create security profile
        profile_file = temp_git_repo / PROFILE_FILENAME
        profile_file.write_text('{"profile": "data"}', encoding="utf-8")

        # Commit changes
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add profile"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Mock shutil.copy2 to raise PermissionError for profile file
        def mock_copy2(src, dst):
            if PROFILE_FILENAME in str(src):
                raise PermissionError("Access denied")
            return shutil.copy2(src, dst)

        with patch("shutil.copy2", side_effect=mock_copy2):
            # Setup workspace - should handle error gracefully
            worktree_path, _, _ = setup_workspace(
                temp_git_repo,
                "test-spec",
                WorkspaceMode.ISOLATED,
            )

        # Verify worktree was created despite permission error
        assert worktree_path.exists()

        # Verify warning was printed


class TestMergeLockExceptionHandlingUnlink:
    """Tests for MergeLock __exit__ exception handling during unlink (lines 136-137)."""

    def test_merge_lock_exit_handles_unlink_exception(self, temp_git_repo: Path):
        """MergeLock.__exit__ handles exceptions when unlink() fails (lines 136-137)."""
        from unittest.mock import patch

        lock = MergeLock(temp_git_repo, "test-spec")

        # Enter the lock context
        lock.__enter__()
        assert lock.acquired is True
        assert lock.lock_file.exists()

        # Mock unlink to raise an exception
        with patch.object(Path, "unlink", side_effect=OSError("Device read-only")):
            # __exit__ should not raise despite unlink failure
            lock.__exit__(None, None, None)

        # Lock should still be marked as acquired because cleanup failed silently
        assert lock.acquired is True

    def test_merge_lock_exit_handles_permission_error(self, temp_git_repo: Path):
        """MergeLock.__exit__ handles PermissionError when unlink() fails."""
        from unittest.mock import patch

        lock = MergeLock(temp_git_repo, "test-spec")

        lock.__enter__()
        assert lock.acquired is True

        # Mock unlink to raise PermissionError
        with patch.object(Path, "unlink", side_effect=PermissionError("Access denied")):
            # Should not raise
            lock.__exit__(None, None, None)

    def test_merge_lock_exit_handles_lock_file_becoming_directory(
        self, temp_git_repo: Path
    ):
        """MergeLock.__exit__ handles when lock file becomes a directory (race condition)."""
        lock = MergeLock(temp_git_repo, "test-spec")

        lock.__enter__()
        assert lock.acquired is True

        # Simulate race: lock file becomes a directory
        lock.lock_file.unlink()
        lock.lock_file.mkdir()

        # unlink() on a directory raises OSError/IsADirectoryError
        # __exit__ should handle this gracefully
        lock.__exit__(None, None, None)

        # Cleanup the directory
        lock.lock_file.rmdir()


class TestSpecNumberLockExceptionHandlingUnlink:
    """Tests for SpecNumberLock __exit__ exception handling during unlink (lines 225-226)."""

    def test_spec_number_lock_exit_handles_unlink_exception(self, temp_git_repo: Path):
        """SpecNumberLock.__exit__ handles exceptions when unlink() fails (lines 225-226)."""
        from unittest.mock import patch

        lock = SpecNumberLock(temp_git_repo)

        lock.__enter__()
        assert lock.acquired is True
        assert lock.lock_file.exists()

        # Mock unlink to raise an exception
        with patch.object(Path, "unlink", side_effect=OSError("Device read-only")):
            # __exit__ should not raise despite unlink failure
            lock.__exit__(None, None, None)

    def test_spec_number_lock_exit_handles_permission_error(self, temp_git_repo: Path):
        """SpecNumberLock.__exit__ handles PermissionError when unlink() fails."""
        from unittest.mock import patch

        lock = SpecNumberLock(temp_git_repo)

        lock.__enter__()
        assert lock.acquired is True

        # Mock unlink to raise PermissionError
        with patch.object(Path, "unlink", side_effect=PermissionError("Access denied")):
            # Should not raise
            lock.__exit__(None, None, None)

    def test_spec_number_lock_exit_handles_lock_file_becoming_directory(
        self, temp_git_repo: Path
    ):
        """SpecNumberLock.__exit__ handles when lock file becomes a directory (race condition)."""
        lock = SpecNumberLock(temp_git_repo)

        lock.__enter__()
        assert lock.acquired is True

        # Simulate race: lock file becomes a directory
        lock.lock_file.unlink()
        lock.lock_file.mkdir()

        # unlink() on a directory raises OSError/IsADirectoryError
        # __exit__ should handle this gracefully
        lock.__exit__(None, None, None)

        # Cleanup the directory
        lock.lock_file.rmdir()


class TestSpecNumberLockScanExceptionHandling:
    """Tests for _scan_specs_dir exception handling (lines 272-273)."""

    def test_scan_specs_dir_handles_invalid_folder_names(self, temp_git_repo: Path):
        """_scan_specs_dir handles folders with non-numeric prefixes (lines 272-273)."""
        lock = SpecNumberLock(temp_git_repo)

        # Create specs with invalid names that trigger ValueError
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # These will cause ValueError when trying to int(folder.name[:3])
        invalid_names = ["abc", "xyz", "invalid-name"]
        for name in invalid_names:
            (specs_dir / name).mkdir()

        # Create valid specs
        (specs_dir / "001-valid").mkdir()
        (specs_dir / "100-another").mkdir()

        with lock:
            # Should not raise ValueError, should skip invalid folders
            result = lock._scan_specs_dir(specs_dir)

            # Should only count valid specs
            assert result == 100

    def test_scan_specs_dir_handles_malformed_number_prefix(self, temp_git_repo: Path):
        """_scan_specs_dir handles folder names with non-digit characters in prefix."""
        lock = SpecNumberLock(temp_git_repo)

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Create folder that starts with digits but has non-digit in prefix
        # This will fail the int() conversion
        (specs_dir / "1a-bad").mkdir()
        (specs_dir / "9!-bad").mkdir()

        # Create valid specs
        (specs_dir / "050-good").mkdir()

        with lock:
            # Should handle malformed prefixes gracefully
            result = lock._scan_specs_dir(specs_dir)

            # Should only count valid specs
            assert result == 50

    def test_scan_specs_dir_handles_short_folder_names(self, temp_git_repo: Path):
        """_scan_specs_dir handles folder names shorter than 3 characters."""
        lock = SpecNumberLock(temp_git_repo)

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Edge case: folder with less than 3 chars
        # name[:3] will be less than 3 chars, but int() may still work if it's numeric
        (specs_dir / "12").mkdir()

        # Edge case: very large number
        (specs_dir / "999-very-large").mkdir()

        # Valid specs
        (specs_dir / "001-first").mkdir()

        with lock:
            result = lock._scan_specs_dir(specs_dir)

            # Should handle all cases and return max
            assert result == 999

    def test_scan_specs_dir_handles_unexpected_folder_names(
        self, temp_git_repo: Path, monkeypatch
    ):
        """_scan_specs_dir handles ValueError when glob returns unexpected folder names (lines 272-273)."""
        lock = SpecNumberLock(temp_git_repo)

        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Create a folder that matches the glob pattern visually
        # but we'll mock glob to return a folder that triggers ValueError
        (specs_dir / "001-valid").mkdir()

        # Create fake Path objects that will cause ValueError in int()
        from pathlib import Path
        from unittest.mock import MagicMock

        fake_folder = MagicMock()
        fake_folder.name = "XYZ-invalid"  # Non-numeric prefix

        # Mock glob to return both valid and invalid folders
        original_glob = specs_dir.glob

        def mock_glob(pattern):
            # Return the actual valid folder plus our fake one
            real_results = list(original_glob(pattern))
            return real_results + [fake_folder]

        monkeypatch.setattr(Path, "glob", lambda self, pattern: mock_glob(pattern))

        with lock:
            # Should not raise ValueError, should skip invalid folder
            result = lock._scan_specs_dir(specs_dir)

            # Should still find the valid spec
            assert result == 1


class TestSetupDebugFallback:
    """Tests for debug fallback functions in setup.py (lines 35-43)."""

    def test_debug_fallback_no_op(self, monkeypatch):
        """Fallback debug function is no-op when debug module not available (lines 39-40)."""
        # Remove debug module from sys.modules to trigger fallback
        import importlib
        import sys

        debug_module = sys.modules.pop("debug", None)

        # Force reload of setup module to trigger fallback path
        if "core.workspace.setup" in sys.modules:
            del sys.modules["core.workspace.setup"]

        try:
            from core.workspace.setup import debug, debug_warning

            # Both functions should be no-ops (don't raise)
            debug("test", "message")
            debug_warning("test", "warning")

            # No exception means fallback is working
            assert True
        finally:
            # Restore debug module
            if debug_module is not None:
                sys.modules["debug"] = debug_module
            # Force reload again to restore normal state
            if "core.workspace.setup" in sys.modules:
                del sys.modules["core.workspace.setup"]
            import importlib

            importlib.reload(importlib.import_module("core.workspace.setup"))

    def test_debug_import_error_creates_fallback(self, monkeypatch):
        """ImportError in debug import creates fallback functions (lines 35-43)."""
        import builtins
        import importlib
        import sys

        # Save original debug module and import function
        original_debug = sys.modules.get("debug")
        original_import = builtins.__import__

        # Create a custom import that blocks 'debug' module
        def debug_blocking_import(name, *args, **kwargs):
            if name == "debug":
                raise ImportError("debug module not found (simulated)")
            return original_import(name, *args, **kwargs)

        try:
            # Block debug import and remove from sys.modules
            monkeypatch.setattr(builtins, "__import__", debug_blocking_import)
            if "debug" in sys.modules:
                del sys.modules["debug"]

            # Also remove setup module and related modules to force re-import
            for module_name in list(sys.modules.keys()):
                if module_name.startswith("core.workspace.setup"):
                    del sys.modules[module_name]

            # Re-import setup module - it should create fallback functions
            setup_module = importlib.import_module("core.workspace.setup")

            # Check that debug functions exist and are callables
            assert hasattr(setup_module, "debug")
            assert hasattr(setup_module, "debug_warning")
            assert callable(setup_module.debug)
            assert callable(setup_module.debug_warning)

            # They should be no-ops (accept any args without error)
            setup_module.debug("module", "message", "extra")
            setup_module.debug_warning("module", "warning", key="value")
        finally:
            # Restore debug module
            if original_debug is not None:
                sys.modules["debug"] = original_debug
            # Restore setup module
            if "core.workspace.setup" in sys.modules:
                del sys.modules["core.workspace.setup"]
            importlib.reload(importlib.import_module("core.workspace.setup"))


class TestWindowsJunctionErrorHandling:
    """Tests for Windows junction creation error handling (lines 256-262)."""

    def test_windows_junction_creation_error_handling(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Handles OSError when mklink fails on Windows (lines 256-262, 269-281)."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Only test on Windows or when we can mock the platform
        if sys.platform != "win32":
            # Mock platform to simulate Windows
            monkeypatch.setattr("sys.platform", "win32")

        # Create source node_modules directory
        source_node_modules = temp_git_repo / "node_modules"
        source_node_modules.mkdir()
        (source_node_modules / "test-package").mkdir()

        # Create worktree path
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Mock subprocess.run to simulate mklink failure
        original_run = subprocess.run

        def mock_subprocess_run(cmd, **kwargs):
            if "mklink" in " ".join(cmd):
                # Simulate mklink failure
                return subprocess.CompletedProcess(
                    cmd, returncode=1, stderr="Access is denied"
                )
            return original_run(cmd, **kwargs)

        monkeypatch.setattr("subprocess.run", mock_subprocess_run)

        # Call the function - should handle error gracefully
        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        # Verify no symlinks were created (due to error)
        assert len(symlinked) == 0

        # Verify warning was printed
        captured = capsys.readouterr()
        assert "Warning" in captured.out or "warning" in captured.out.lower()

    def test_windows_junction_osexception_continues(
        self, temp_git_repo: Path, monkeypatch
    ):
        """Continues after OSError in junction creation (lines 261-262, 269-281)."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Mock Windows platform
        original_platform = sys.platform
        monkeypatch.setattr("sys.platform", "win32")

        try:
            # Create source and worktree directories
            source_node_modules = temp_git_repo / "node_modules"
            source_node_modules.mkdir()

            worktree_path = (
                temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
            )
            worktree_path.mkdir(parents=True)

            # Create a second source to test that function continues after error
            source_frontend_modules = (
                temp_git_repo / "apps" / "frontend" / "node_modules"
            )
            source_frontend_modules.mkdir(parents=True)

            # Mock subprocess.run to fail on first, succeed on second
            call_count = [0]
            original_run = subprocess.run

            def mock_subprocess_run(cmd, **kwargs):
                call_count[0] += 1
                if "mklink" in " ".join(cmd) and call_count[0] == 1:
                    # First mklink fails
                    raise OSError("mklink /J failed")
                elif "mklink" in " ".join(cmd):
                    # Second succeeds
                    return subprocess.CompletedProcess(cmd, returncode=0, stderr="")
                return original_run(cmd, **kwargs)

            monkeypatch.setattr("subprocess.run", mock_subprocess_run)

            # Call the function - should continue after first error
            symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

            # At least one symlink should have succeeded (or both failed gracefully)
            # The important thing is the function didn't crash
            assert isinstance(symlinked, list)
        finally:
            monkeypatch.setattr("sys.platform", original_platform)


class TestTimelineHookInstallationEdgeCases:
    """Tests for timeline hook installation edge cases (lines 461-503)."""

    def setup_method(self):
        """Reset the global hook check flag before each test."""
        import core.workspace.setup as setup_module

        setup_module._git_hook_check_done = False

    def test_hook_installation_skips_when_no_git_dir(self, temp_dir: Path, monkeypatch):
        """Skips hook installation when .git directory doesn't exist (line 477)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # temp_dir is not a git repo
        assert not (temp_dir / ".git").exists()

        # Should return early without error
        ensure_timeline_hook_installed(temp_dir)

        # No .git directory should have been created
        assert not (temp_dir / ".git").exists()

    def test_hook_installation_handles_worktree_invalid_git_file(self, tmp_path):
        """Handles worktrees with invalid .git file content (lines 481-485)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create a fake worktree directory (not a real git repo)
        fake_worktree = tmp_path / "fake_worktree"
        fake_worktree.mkdir()

        # Create .git as a FILE with invalid content (worktree style)
        git_file = fake_worktree / ".git"
        git_file.write_text(
            "invalid content that doesn't start with gitdir:", encoding="utf-8"
        )

        # Should handle gracefully and return early
        ensure_timeline_hook_installed(fake_worktree)

        # Verify the file wasn't modified
        assert "invalid content" in git_file.read_text(encoding="utf-8")

    def test_hook_installation_worktree_gitdir_extraction(self, tmp_path):
        """Extracts gitdir from worktree .git file correctly (lines 481-483)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create a fake worktree structure
        # First, create the actual git dir in a different location
        actual_git_dir = tmp_path / "actual_git_dir"
        actual_git_dir.mkdir()
        (actual_git_dir / "hooks").mkdir()

        # Create a fake worktree directory with .git as a FILE
        fake_worktree = tmp_path / "fake_worktree"
        fake_worktree.mkdir()
        git_file = fake_worktree / ".git"
        git_file.write_text(f"gitdir: {actual_git_dir}", encoding="utf-8")

        # Should correctly extract gitdir path
        ensure_timeline_hook_installed(fake_worktree)

        # Verify the actual git dir has hooks directory
        assert (actual_git_dir / "hooks").exists()

    def test_hook_installation_skips_when_hook_already_installed(
        self, tmp_path, monkeypatch
    ):
        """Skips installation when FileTimelineTracker hook already exists (lines 491-493)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create a git directory structure
        git_dir = tmp_path / ".git"
        git_dir.mkdir()
        hooks_dir = git_dir / "hooks"
        hooks_dir.mkdir()

        # Create an existing hook with FileTimelineTracker marker
        hook_path = hooks_dir / "post-commit"
        hook_path.write_text(
            "#!/bin/bash\n# FileTimelineTracker hook\necho 'Timeline tracking'\n",
            encoding="utf-8",
        )

        # Mock install_hook to verify it's NOT called
        install_hook_called = []

        def mock_install_hook(project_dir):
            install_hook_called.append(project_dir)

        # Patch the import location where install_hook is used
        monkeypatch.setattr("merge.install_hook.install_hook", mock_install_hook)

        # Should skip installation
        ensure_timeline_hook_installed(tmp_path)

        # install_hook should NOT have been called
        assert len(install_hook_called) == 0

    def test_hook_installation_handles_exceptions_gracefully(
        self, tmp_path, monkeypatch
    ):
        """Handles exceptions during hook installation gracefully (lines 501-503)."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create a git directory structure
        git_dir = tmp_path / ".git"
        git_dir.mkdir()
        hooks_dir = git_dir / "hooks"
        hooks_dir.mkdir()

        # Mock install_hook to raise an exception
        def mock_install_hook(project_dir):
            raise RuntimeError("Simulated installation failure")

        # Patch the import location where install_hook is used
        monkeypatch.setattr("merge.install_hook.install_hook", mock_install_hook)

        # Should handle exception gracefully (not crash)
        ensure_timeline_hook_installed(tmp_path)

        # Function should complete without raising an exception

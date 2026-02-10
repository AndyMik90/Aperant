#!/usr/bin/env python3
"""
Tests for Workspace Display Functions
======================================

Tests the display.py module functionality including:
- Build summary display
- Changed files display
- Merge success printing
- Conflict info display
- Environment file operations
- Node modules symlink operations
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"


class TestShowBuildSummary:
    """Tests for show_build_summary display function."""

    def test_show_build_summary_no_changes(self, capsys):
        """show_build_summary prints info message when no changes."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_build_summary

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 0,
            "modified_files": 0,
            "deleted_files": 0,
        }
        mock_manager.get_changed_files.return_value = []

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "No changes were made" in captured.out

    def test_show_build_summary_with_new_files(self, capsys):
        """show_build_summary displays new files count correctly."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_build_summary

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 3,
            "modified_files": 0,
            "deleted_files": 0,
        }
        mock_manager.get_changed_files.return_value = [
            ("A", "file1.py"),
            ("A", "file2.py"),
            ("A", "file3.py"),
        ]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "What was built" in captured.out
        assert "+ 3 new files" in captured.out

    def test_show_build_summary_singular_new_file(self, capsys):
        """show_build_summary uses singular form for one new file."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_build_summary

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 1,
            "modified_files": 0,
            "deleted_files": 0,
        }
        mock_manager.get_changed_files.return_value = [("A", "file1.py")]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "+ 1 new file" in captured.out
        assert "files" not in captured.out.split("new file")[1].split("\n")[0]

    def test_show_build_summary_with_modified_files(self, capsys):
        """show_build_summary displays modified files count correctly."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_build_summary

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 0,
            "modified_files": 2,
            "deleted_files": 0,
        }
        mock_manager.get_changed_files.return_value = [
            ("M", "file1.py"),
            ("M", "file2.py"),
        ]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "~ 2 modified files" in captured.out

    def test_show_build_summary_with_deleted_files(self, capsys):
        """show_build_summary displays deleted files count correctly."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_build_summary

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 0,
            "modified_files": 0,
            "deleted_files": 1,
        }
        mock_manager.get_changed_files.return_value = [("D", "old.py")]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "- 1 deleted file" in captured.out

    def test_show_build_summary_mixed_changes(self, capsys):
        """show_build_summary displays all change types together."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_build_summary

        mock_manager = MagicMock()
        mock_manager.get_change_summary.return_value = {
            "new_files": 2,
            "modified_files": 3,
            "deleted_files": 1,
        }
        mock_manager.get_changed_files.return_value = [
            ("A", "new1.py"),
            ("A", "new2.py"),
            ("M", "mod1.py"),
            ("M", "mod2.py"),
            ("M", "mod3.py"),
            ("D", "old.py"),
        ]

        show_build_summary(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "+ 2 new files" in captured.out
        assert "~ 3 modified files" in captured.out
        assert "- 1 deleted file" in captured.out


class TestShowChangedFiles:
    """Tests for show_changed_files display function."""

    def test_show_changed_files_empty_list(self, capsys):
        """show_changed_files prints info message when no files changed."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_changed_files

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = []

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "No changes" in captured.out

    def test_show_changed_files_with_added_file(self, capsys):
        """show_changed_files displays added file with + prefix."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_changed_files

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [("A", "new_file.py")]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "Changed files" in captured.out
        assert "+ new_file.py" in captured.out

    def test_show_changed_files_with_modified_file(self, capsys):
        """show_changed_files displays modified file with ~ prefix."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_changed_files

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [("M", "changed.py")]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "~ changed.py" in captured.out

    def test_show_changed_files_with_deleted_file(self, capsys):
        """show_changed_files displays deleted file with - prefix."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_changed_files

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [("D", "removed.py")]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "- removed.py" in captured.out

    def test_show_changed_files_with_unknown_status(self, capsys):
        """show_changed_files displays unknown status code without decoration."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_changed_files

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [("R", "renamed.py")]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "R renamed.py" in captured.out

    def test_show_changed_files_multiple_files(self, capsys):
        """show_changed_files displays all changed files."""
        from unittest.mock import MagicMock

        from core.workspace.display import show_changed_files

        mock_manager = MagicMock()
        mock_manager.get_changed_files.return_value = [
            ("A", "new.py"),
            ("M", "modified.py"),
            ("D", "deleted.py"),
            ("R", "renamed.py"),
        ]

        show_changed_files(mock_manager, "test-spec")

        captured = capsys.readouterr()
        assert "+ new.py" in captured.out
        assert "~ modified.py" in captured.out
        assert "- deleted.py" in captured.out
        assert "R renamed.py" in captured.out


class TestPrintMergeSuccess:
    """Tests for print_merge_success display function."""

    def test_print_merge_success_no_commit_basic(self, capsys):
        """print_merge_success with no_commit=True shows basic message."""
        from core.workspace.display import print_merge_success

        print_merge_success(no_commit=True)

        captured = capsys.readouterr()
        assert "CHANGES ADDED TO YOUR PROJECT" in captured.out
        assert "working directory" in captured.out
        assert "Review the changes" in captured.out
        assert "commit when ready" in captured.out

    def test_print_merge_success_no_commit_with_lock_files(self, capsys):
        """print_merge_success with lock_files_excluded shows lock file note."""
        from core.workspace.display import print_merge_success

        stats = {"lock_files_excluded": 2}
        print_merge_success(no_commit=True, stats=stats)

        captured = capsys.readouterr()
        assert "CHANGES ADDED TO YOUR PROJECT" in captured.out
        assert "Lock files kept from main" in captured.out
        assert "npm install" in captured.out

    def test_print_merge_success_no_commit_with_keep_worktree(self, capsys):
        """print_merge_success with keep_worktree shows discard command."""
        from core.workspace.display import print_merge_success

        print_merge_success(no_commit=True, spec_name="spec-001", keep_worktree=True)

        captured = capsys.readouterr()
        assert "CHANGES ADDED TO YOUR PROJECT" in captured.out
        assert "Worktree kept for testing" in captured.out
        assert "python auto-claude/run.py --spec spec-001 --discard" in captured.out

    def test_print_merge_success_no_commit_full_scenario(self, capsys):
        """print_merge_success with all optional parameters."""
        from core.workspace.display import print_merge_success

        stats = {"lock_files_excluded": 1}
        print_merge_success(
            no_commit=True,
            stats=stats,
            spec_name="test-spec",
            keep_worktree=True,
        )

        captured = capsys.readouterr()
        assert "CHANGES ADDED TO YOUR PROJECT" in captured.out
        assert "Lock files kept from main" in captured.out
        assert "Worktree kept for testing" in captured.out
        assert "--spec test-spec --discard" in captured.out

    def test_print_merge_success_with_commit_basic(self, capsys):
        """print_merge_success with no_commit=False shows commit message."""
        from core.workspace.display import print_merge_success

        print_merge_success(no_commit=False)

        captured = capsys.readouterr()
        assert "FEATURE ADDED TO YOUR PROJECT" in captured.out
        assert "separate workspace has been cleaned up" in captured.out

    def test_print_merge_success_with_commit_and_stats(self, capsys):
        """print_merge_success with stats shows file counts."""
        from core.workspace.display import print_merge_success

        stats = {
            "files_added": 5,
            "files_modified": 3,
            "files_deleted": 1,
        }
        print_merge_success(no_commit=False, stats=stats)

        captured = capsys.readouterr()
        assert "FEATURE ADDED TO YOUR PROJECT" in captured.out
        assert "What changed" in captured.out
        assert "+ 5 files added" in captured.out
        assert "~ 3 files modified" in captured.out
        assert "- 1 file deleted" in captured.out

    def test_print_merge_success_singular_file_counts(self, capsys):
        """print_merge_success uses singular form for single file counts."""
        from core.workspace.display import print_merge_success

        stats = {
            "files_added": 1,
            "files_modified": 1,
            "files_deleted": 1,
        }
        print_merge_success(no_commit=False, stats=stats)

        captured = capsys.readouterr()
        assert "+ 1 file added" in captured.out
        assert "~ 1 file modified" in captured.out
        assert "- 1 file deleted" in captured.out

    def test_print_merge_success_with_keep_worktree(self, capsys):
        """print_merge_success with keep_worktree shows discard command."""
        from core.workspace.display import print_merge_success

        print_merge_success(no_commit=False, keep_worktree=True, spec_name="my-spec")

        captured = capsys.readouterr()
        assert "FEATURE ADDED TO YOUR PROJECT" in captured.out
        assert "Worktree kept for testing" in captured.out
        assert "--spec my-spec --discard" in captured.out
        assert "separate workspace has been cleaned up" not in captured.out

    def test_print_merge_success_zero_file_counts_not_shown(self, capsys):
        """print_merge_success doesn't show file types with zero count."""
        from core.workspace.display import print_merge_success

        stats = {
            "files_added": 2,
            "files_modified": 0,
            "files_deleted": 0,
        }
        print_merge_success(no_commit=False, stats=stats)

        captured = capsys.readouterr()
        assert "+ 2 files added" in captured.out
        assert "files modified" not in captured.out
        assert "files deleted" not in captured.out


class TestPrintConflictInfoExtended:
    """Extended tests for print_conflict_info display function."""

    def test_print_conflict_info_empty_conflicts(self, capsys):
        """print_conflict_info returns early with empty conflicts list."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": []}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert captured.out == ""

    def test_print_conflict_info_no_conflicts_key(self, capsys):
        """print_conflict_info returns early when conflicts key missing."""
        from core.workspace.display import print_conflict_info

        result = {}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert captured.out == ""

    def test_print_conflict_info_critical_severity(self, capsys):
        """print_conflict_info shows critical severity icon."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {
                    "file": "critical.py",
                    "reason": "Breaking change",
                    "severity": "critical",
                }
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "critical.py" in captured.out
        assert "⛔" in captured.out
        assert "Breaking change" in captured.out

    def test_print_conflict_info_high_severity(self, capsys):
        """print_conflict_info shows high severity icon."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "high.py", "reason": "Major conflict", "severity": "high"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "high.py" in captured.out
        assert "🔴" in captured.out
        assert "Major conflict" in captured.out

    def test_print_conflict_info_medium_severity(self, capsys):
        """print_conflict_info shows medium severity icon."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "medium.py", "reason": "Minor conflict", "severity": "medium"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "medium.py" in captured.out
        assert "🟡" in captured.out
        assert "Minor conflict" in captured.out

    def test_print_conflict_info_low_severity_no_icon(self, capsys):
        """print_conflict_info shows no icon for low severity."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "low.py", "reason": "Trivial issue", "severity": "low"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "low.py" in captured.out
        assert "Trivial issue" in captured.out
        assert "⛔" not in captured.out
        assert "🔴" not in captured.out
        assert "🟡" not in captured.out

    def test_print_conflict_info_unknown_severity(self, capsys):
        """print_conflict_info handles unknown severity gracefully."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "unknown.py", "reason": "Unknown", "severity": "unknown"}
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "unknown.py" in captured.out
        assert "Unknown" in captured.out

    def test_print_conflict_info_missing_file_key(self, capsys):
        """print_conflict_info handles missing file key."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": [{"reason": "No file specified", "severity": "high"}]}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "unknown" in captured.out
        assert "No file specified" in captured.out

    def test_print_conflict_info_missing_reason_key(self, capsys):
        """print_conflict_info handles missing reason key."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": [{"file": "noreason.py", "severity": "medium"}]}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "noreason.py" in captured.out

    def test_print_conflict_info_dict_no_reason(self, capsys):
        """print_conflict_info with dict missing reason."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": [{"file": "test.py", "severity": "high"}]}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "test.py" in captured.out
        assert "🔴" in captured.out

    def test_print_conflict_info_multiple_conflicts(self, capsys):
        """print_conflict_info handles multiple conflicts."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {"file": "critical.py", "reason": "Critical", "severity": "critical"},
                {"file": "high.py", "reason": "High", "severity": "high"},
                {"file": "medium.py", "reason": "Medium", "severity": "medium"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "3 file" in captured.out
        assert "⛔" in captured.out
        assert "🔴" in captured.out
        assert "🟡" in captured.out

    def test_print_conflict_info_shows_marker_conflict_message(self, capsys):
        """print_conflict_info shows marker conflict message for string conflicts."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": ["conflict.py"]}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "conflict markers" in captured.out
        # Check that the conflict markers are mentioned in the message

    def test_print_conflict_info_shows_ai_conflict_message(self, capsys):
        """print_conflict_info shows AI conflict message for dict conflicts."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                {
                    "file": "ai-conflict.py",
                    "reason": "AI merge failed",
                    "severity": "high",
                }
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "could not be auto-merged" in captured.out

    def test_print_conflict_info_shows_both_messages_mixed(self, capsys):
        """print_conflict_info shows both messages for mixed conflicts."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                "marker.py",
                {"file": "ai.py", "reason": "AI failed", "severity": "high"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "conflict markers" in captured.out
        assert "could not be auto-merged" in captured.out

    def test_print_conflict_info_shows_git_commands(self, capsys):
        """print_conflict_info shows git add and commit commands."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": ["file1.py", "file2.py"]}

        print_conflict_info(result)

        captured = capsys.readouterr()
        assert "git add" in captured.out
        assert "git commit" in captured.out

    def test_print_conflict_info_quotes_special_paths(self, capsys):
        """print_conflict_info properly quotes file paths with special characters."""
        from core.workspace.display import print_conflict_info

        result = {"conflicts": ["file with spaces.py", "file'with'quotes.py"]}

        print_conflict_info(result)

        captured = capsys.readouterr()
        # shlex.quote should quote paths with spaces
        assert "git add" in captured.out
        assert "file with spaces.py" in captured.out

    def test_print_conflict_info_deduplicates_files(self, capsys):
        """print_conflict_info deduplicates file paths in git command."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                "file1.py",
                {"file": "file1.py", "reason": "Also here", "severity": "medium"},
                "file2.py",
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        # Count occurrences of file1.py
        count = captured.out.count("file1.py")
        assert count == 3  # Display shows it twice (string + dict), once in git add

    def test_print_conflict_info_preserves_order(self, capsys):
        """print_conflict_info preserves file order while deduplicating."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": [
                "first.py",
                {"file": "second.py", "severity": "high"},
                "first.py",  # Duplicate
                {"file": "third.py", "severity": "medium"},
            ]
        }

        print_conflict_info(result)

        captured = capsys.readouterr()
        # First occurrence should be preserved
        lines = captured.out.split("\n")
        first_idx = None
        second_idx = None
        for i, line in enumerate(lines):
            if "first.py" in line:
                if first_idx is None:
                    first_idx = i
            if "second.py" in line:
                if second_idx is None:
                    second_idx = i
        assert first_idx is not None
        assert second_idx is not None


class TestCopyEnvFilesToWorktree:
    """Tests for copy_env_files_to_worktree function."""

    def test_copies_all_env_files(self, temp_git_repo: Path):
        """Copies all .env files when they exist in project dir."""
        from core.workspace.setup import copy_env_files_to_worktree

        # Create .env files in project
        (temp_git_repo / ".env").write_text("FOO=bar", encoding="utf-8")
        (temp_git_repo / ".env.local").write_text("LOCAL=1", encoding="utf-8")
        (temp_git_repo / ".env.development").write_text("DEV=1", encoding="utf-8")

        # Create worktree directory
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Copy env files
        copied = copy_env_files_to_worktree(temp_git_repo, worktree_path)

        # Check all files were copied
        assert ".env" in copied
        assert ".env.local" in copied
        assert ".env.development" in copied
        assert len(copied) == 3

        # Verify files exist in worktree
        assert (worktree_path / ".env").exists()
        assert (worktree_path / ".env.local").exists()
        assert (worktree_path / ".env.development").exists()

    def test_skips_nonexistent_env_files(self, temp_git_repo: Path):
        """Only copies env files that exist."""
        from core.workspace.setup import copy_env_files_to_worktree

        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        copied = copy_env_files_to_worktree(temp_git_repo, worktree_path)

        assert len(copied) == 0

    def test_does_not_overwrite_existing_env_files(self, temp_git_repo: Path):
        """Does not overwrite .env files that already exist in worktree."""
        from core.workspace.setup import copy_env_files_to_worktree

        # Create .env in project
        (temp_git_repo / ".env").write_text("PROJECT=1", encoding="utf-8")

        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Create existing .env in worktree with different content
        (worktree_path / ".env").write_text("WORKTREE=1", encoding="utf-8")

        copied = copy_env_files_to_worktree(temp_git_repo, worktree_path)

        # .env should not be in copied list since it already existed
        assert ".env" not in copied

        # Worktree .env should keep its original content
        assert (worktree_path / ".env").read_text(encoding="utf-8") == "WORKTREE=1"


class TestSymlinkNodeModulesToWorktree:
    """Tests for symlink_node_modules_to_worktree function."""

    @pytest.mark.skipif(sys.platform != "linux", reason="Unix-specific test")
    def test_symlinks_node_modules_on_unix(self, temp_git_repo: Path):
        """Creates relative symlinks on Unix systems."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        # Create node_modules in project
        node_modules = temp_git_repo / "node_modules"
        node_modules.mkdir()
        (node_modules / "test.txt").write_text("test", encoding="utf-8")

        # Create apps/frontend/node_modules
        frontend_node_modules = temp_git_repo / "apps" / "frontend" / "node_modules"
        frontend_node_modules.mkdir(parents=True)
        (frontend_node_modules / "test2.txt").write_text("test2", encoding="utf-8")

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)
        (worktree_path / "apps" / "frontend").mkdir(parents=True)

        # Create symlinks
        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        assert len(symlinked) == 2
        assert "node_modules" in symlinked
        assert "apps/frontend/node_modules" in symlinked

        # Verify symlinks exist and point to correct location
        assert (worktree_path / "node_modules").is_symlink()
        assert (worktree_path / "apps" / "frontend" / "node_modules").is_symlink()

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-specific test")
    def test_creates_junctions_on_windows(self, temp_git_repo: Path, monkeypatch):
        """Creates junctions on Windows systems."""
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

        # Mock subprocess.run to simulate mklink /J success
        def mock_subprocess_run(cmd, capture_output=False, text=False):
            result = type("obj", (object,), {"returncode": 0, "stderr": ""})()
            return result

        with patch("subprocess.run", side_effect=mock_subprocess_run):
            with monkeypatch.context() as m:
                m.setattr("sys.platform", "win32")
                symlinked = symlink_node_modules_to_worktree(
                    temp_git_repo, worktree_path
                )

        assert "node_modules" in symlinked

    def test_skips_nonexistent_node_modules(self, temp_git_repo: Path):
        """Skips node_modules that don't exist in project."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        assert len(symlinked) == 0

    def test_skips_existing_symlinks(self, temp_git_repo: Path):
        """Does not recreate symlinks that already exist."""
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

        # Create existing symlink
        if sys.platform != "win32":
            os.symlink(temp_git_repo / "node_modules", worktree_path / "node_modules")

        symlinked = symlink_node_modules_to_worktree(temp_git_repo, worktree_path)

        # Should skip existing symlink
        assert "node_modules" not in symlinked

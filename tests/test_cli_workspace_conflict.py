#!/usr/bin/env python3
"""
Tests for CLI Workspace Conflict Detection
==========================================

Tests conflict detection functions:
- _check_git_merge_conflicts()
- _detect_conflict_scenario()
- _detect_parallel_task_conflicts()
"""

import subprocess
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest

# Import the module under test
from cli import workspace_commands


# =============================================================================
# TEST CONSTANTS
# =============================================================================

TEST_SPEC_NAME = "001-test-spec"
TEST_SPEC_BRANCH = f"auto-claude/{TEST_SPEC_NAME}"


# =============================================================================
# TESTS FOR _detect_default_branch()
# =============================================================================



class TestCheckGitMergeConflicts:
    """Tests for _check_git_merge_conflicts function."""

    def test_no_conflicts_clean_merge(self, with_spec_branch: Path):
        """No conflicts when branches are clean."""
        result = workspace_commands._check_git_merge_conflicts(
            with_spec_branch, TEST_SPEC_NAME, base_branch="main"
        )

        assert result["has_conflicts"] is False
        assert result["conflicting_files"] == []

    def test_detects_conflicts(self, with_conflicting_branches: Path):
        """Detects merge conflicts."""
        result = workspace_commands._check_git_merge_conflicts(
            with_conflicting_branches, TEST_SPEC_NAME, base_branch="main"
        )

        assert result["has_conflicts"] is True
        assert len(result["conflicting_files"]) > 0

    def test_detects_needs_rebase(self, with_spec_branch: Path):
        """Detects when main has advanced."""
        # Add another commit to main
        (with_spec_branch / "main2.txt").write_text("main content")
        subprocess.run(
            ["git", "add", "main2.txt"],
            cwd=with_spec_branch,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "Main advance"],
            cwd=with_spec_branch,
            capture_output=True,
        )

        result = workspace_commands._check_git_merge_conflicts(
            with_spec_branch, TEST_SPEC_NAME, base_branch="main"
        )

        assert result["needs_rebase"] is True
        assert result["commits_behind"] > 0

    def test_auto_detects_base_branch(self, with_spec_branch: Path):
        """Auto-detects base branch when not provided."""
        result = workspace_commands._check_git_merge_conflicts(
            with_spec_branch, TEST_SPEC_NAME, base_branch=None
        )

        assert "base_branch" in result
        assert result["base_branch"] in ["main", "master"]

    def test_excludes_auto_claude_files(self, with_conflicting_branches: Path):
        """Excludes .auto-claude files from conflicts."""
        # This would require setup with actual .auto-claude conflicts
        # For now, test the filtering logic exists
        result = workspace_commands._check_git_merge_conflicts(
            with_conflicting_branches, TEST_SPEC_NAME, base_branch="main"
        )

        # Verify no .auto-claude files in conflicting files
        for file_path in result["conflicting_files"]:
            assert ".auto-claude" not in file_path


# =============================================================================
# TESTS FOR _detect_conflict_scenario()
# =============================================================================



class TestDetectConflictScenario:
    """Tests for _detect_conflict_scenario function."""

    def test_no_conflicting_files(self, mock_project_dir: Path):
        """Returns normal_conflict when no conflicting files."""
        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, [], TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "normal_conflict"
        assert result["already_merged_files"] == []

    @patch("subprocess.run")
    def test_already_merged_scenario(self, mock_run, mock_project_dir: Path):
        """Detects already_merged scenario."""
        # Mock git commands to return identical content
        mock_run.side_effect = [
            # merge-base
            MagicMock(returncode=0, stdout="abc123\n"),
            # spec branch content
            MagicMock(returncode=0, stdout="same content"),
            # base branch content
            MagicMock(returncode=0, stdout="same content"),
            # merge-base content
            MagicMock(returncode=0, stdout="original content"),
        ]

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file.txt"], TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "already_merged"
        assert "file.txt" in result["already_merged_files"]

    @patch("subprocess.run")
    def test_superseded_scenario(self, mock_run, mock_project_dir: Path):
        """Detects superseded scenario."""
        # Mock git commands: spec matches merge-base, base has changed
        mock_run.side_effect = [
            # merge-base
            MagicMock(returncode=0, stdout="abc123\n"),
            # spec branch content (matches merge-base)
            MagicMock(returncode=0, stdout="original content"),
            # base branch content (newer)
            MagicMock(returncode=0, stdout="newer content"),
            # merge-base content
            MagicMock(returncode=0, stdout="original content"),
        ]

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file.txt"], TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "superseded"
        assert "file.txt" in result["superseded_files"]

    @patch("subprocess.run")
    def test_diverged_scenario(self, mock_run, mock_project_dir: Path):
        """Detects diverged scenario."""
        # Mock git commands: both branches have different changes
        mock_run.side_effect = [
            # merge-base
            MagicMock(returncode=0, stdout="abc123\n"),
            # spec branch content
            MagicMock(returncode=0, stdout="spec changes"),
            # base branch content
            MagicMock(returncode=0, stdout="base changes"),
            # merge-base content
            MagicMock(returncode=0, stdout="original content"),
        ]

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file.txt"], TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "diverged"
        assert "file.txt" in result["diverged_files"]

    def test_merge_base_failure(self, mock_project_dir: Path):
        """Handles merge-base command failure."""
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1)

            result = workspace_commands._detect_conflict_scenario(
                mock_project_dir, ["file.txt"], TEST_SPEC_BRANCH, "main"
            )

            assert result["scenario"] == "normal_conflict"

    def test_mixed_scenarios(self, mock_project_dir: Path):
        """Handles mixed scenarios across multiple files."""
        with patch("subprocess.run") as mock_run:
            # First call: merge-base
            # Then for each file: spec, base, merge-base content
            responses = [MagicMock(returncode=0, stdout="abc123\n")]

            # File 1: already merged (spec == base)
            responses.extend([
                MagicMock(returncode=0, stdout="same"),
                MagicMock(returncode=0, stdout="same"),
                MagicMock(returncode=0, stdout="orig"),
            ])

            # File 2: diverged
            responses.extend([
                MagicMock(returncode=0, stdout="spec"),
                MagicMock(returncode=0, stdout="base"),
                MagicMock(returncode=0, stdout="orig"),
            ])

            mock_run.side_effect = responses

            result = workspace_commands._detect_conflict_scenario(
                mock_project_dir, ["file1.txt", "file2.txt"], TEST_SPEC_BRANCH, "main"
            )

            # With mixed scenarios, should detect diverged (most complex)
            assert result["scenario"] == "diverged", \
                f"Expected 'diverged' with mixed scenarios (1 already_merged + 1 diverged), got: {result['scenario']}"


# =============================================================================
# TESTS FOR _detect_parallel_task_conflicts()
# =============================================================================



class TestDetectConflictScenarioEdgeCases:
    """Tests for edge cases in conflict scenario detection."""

    @patch("subprocess.run")
    def test_majority_already_merged_scenario(self, mock_run, mock_project_dir: Path):
        """Detects already_merged when majority of files are already merged."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # 3 files already merged, 1 diverged
        for i in range(3):
            responses.extend([
                MagicMock(returncode=0, stdout=f"same{i}"),
                MagicMock(returncode=0, stdout=f"same{i}"),
                MagicMock(returncode=0, stdout=f"orig{i}"),
            ])

        # 1 diverged file
        responses.extend([
            MagicMock(returncode=0, stdout="spec"),
            MagicMock(returncode=0, stdout="base"),
            MagicMock(returncode=0, stdout="orig"),
        ])

        mock_run.side_effect = responses

        files = [f"file{i}.txt" for i in range(4)]
        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, files, TEST_SPEC_BRANCH, "main"
        )

        # Should detect as already_merged (3/4 files)
        assert result["scenario"] == "already_merged"

    @patch("subprocess.run")
    def test_majority_superseded_scenario(self, mock_run, mock_project_dir: Path):
        """Detects superseded when majority of files are superseded."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # 3 files superseded, 1 diverged
        for i in range(3):
            responses.extend([
                MagicMock(returncode=0, stdout=f"orig{i}"),
                MagicMock(returncode=0, stdout=f"new{i}"),
                MagicMock(returncode=0, stdout=f"orig{i}"),
            ])

        # 1 diverged file
        responses.extend([
            MagicMock(returncode=0, stdout="spec"),
            MagicMock(returncode=0, stdout="base"),
            MagicMock(returncode=0, stdout="orig"),
        ])

        mock_run.side_effect = responses

        files = [f"file{i}.txt" for i in range(4)]
        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, files, TEST_SPEC_BRANCH, "main"
        )

        # Should detect as superseded (3/4 files)
        assert result["scenario"] == "superseded"

    @patch("subprocess.run")
    def test_all_superseded_scenario(self, mock_run, mock_project_dir: Path):
        """Detects all files superseded."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        for i in range(3):
            responses.extend([
                MagicMock(returncode=0, stdout=f"orig{i}"),
                MagicMock(returncode=0, stdout=f"new{i}"),
                MagicMock(returncode=0, stdout=f"orig{i}"),
            ])

        mock_run.side_effect = responses

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file1.txt", "file2.txt", "file3.txt"],
            TEST_SPEC_BRANCH, "main"
        )

        assert result["scenario"] == "superseded"

    @patch("subprocess.run")
    def test_file_analysis_exception_adds_to_diverged(
        self, mock_run, mock_project_dir: Path
    ):
        """Adds file to diverged when analysis raises exception."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        # First file succeeds
        responses.extend([
            MagicMock(returncode=0, stdout="spec"),
            MagicMock(returncode=0, stdout="base"),
            MagicMock(returncode=0, stdout="orig"),
        ])

        # Second file raises exception
        responses.extend([
            MagicMock(returncode=0, stdout="spec2"),
            MagicMock(side_effect=Exception("Analysis failed")),
        ])

        mock_run.side_effect = responses

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file1.txt", "file2.txt"],
            TEST_SPEC_BRANCH, "main"
        )

        # Should have at least one diverged file
        assert len(result.get("diverged_files", [])) >= 1

    @patch("subprocess.run")
    def test_no_merge_base_content_all_diverged(self, mock_run, mock_project_dir: Path):
        """Treats all files as diverged when merge-base content doesn't exist."""
        responses = [MagicMock(returncode=0, stdout="abc123\n")]  # merge-base

        for i in range(2):
            responses.extend([
                MagicMock(returncode=0, stdout=f"spec{i}"),
                MagicMock(returncode=0, stdout=f"base{i}"),
                MagicMock(returncode=1),  # merge-base content doesn't exist
            ])

        mock_run.side_effect = responses

        result = workspace_commands._detect_conflict_scenario(
            mock_project_dir, ["file1.txt", "file2.txt"],
            TEST_SPEC_BRANCH, "main"
        )

        assert len(result["diverged_files"]) == 2


# =============================================================================
# TESTS FOR _check_git_merge_conflicts() - EDGE CASES
# =============================================================================



class TestCheckGitMergeConflictsEdgeCases:
    """Tests for edge cases in git merge conflict detection."""

    @patch("subprocess.run")
    def test_merge_base_command_failure(self, mock_run, mock_project_dir: Path):
        """Handles merge-base command failure."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="main\n"),  # base branch detection
            MagicMock(returncode=1, stderr="merge-base failed"),  # merge-base fails
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # Should return early with default values
        assert result["has_conflicts"] is False
        assert result["conflicting_files"] == []

    @patch("subprocess.run")
    def test_ahead_count_command_failure(self, mock_run, mock_project_dir: Path):
        """Handles rev-list --count command failure."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="main\n"),  # base branch
            MagicMock(returncode=0, stdout="abc123\n"),  # merge-base
            MagicMock(returncode=1),  # ahead count fails
            MagicMock(returncode=0),  # merge-tree succeeds
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # Should continue without commits_behind info
        assert "commits_behind" in result

    @patch("subprocess.run")
    def test_parse_conflict_from_merge_tree_output(self, mock_run, mock_project_dir: Path):
        """Parses conflicts from merge-tree output."""
        mock_run.side_effect = [
            # Note: git rev-parse is skipped when base_branch is provided
            MagicMock(returncode=0, stdout="abc123\n"),  # merge-base
            MagicMock(returncode=0, stdout="0\n"),          # rev-list (count ahead)
            # merge-tree with conflicts - using format that matches the code's parsing
            # The code looks for "CONFLICT" in line and then extracts with regex
            MagicMock(
                returncode=1,
                stdout="",
                stderr="Auto-merging file1.txt\n"
                        "CONFLICT (content): Merge conflict in file1.txt\n"
                        "Auto-merging file2.txt\n"
                        "CONFLICT (content): Merge conflict in file2.txt\n"
            ),
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        assert result["has_conflicts"] is True
        # Note: The regex extracts the file path from the conflict message
        assert len(result["conflicting_files"]) > 0

    @patch("subprocess.run")
    def test_fallback_to_diff_when_no_conflicts_parsed(
        self, mock_run, mock_project_dir: Path
    ):
        """Falls back to diff-based detection when merge-tree output can't be parsed."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="main\n"),
            MagicMock(returncode=0, stdout="abc123\n"),
            MagicMock(returncode=0, stdout="0\n"),
            # merge-tree returns non-zero but no parseable output
            MagicMock(returncode=1, stdout="", stderr=""),
            # Fallback: diff from merge-base to main (empty to trigger fallback behavior)
            MagicMock(returncode=0, stdout=""),
            # Fallback: diff from merge-base to spec (empty)
            MagicMock(returncode=0, stdout=""),
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # With empty diffs, should have no conflicts
        assert result["conflicting_files"] == []

    @patch("subprocess.run")
    def test_exception_during_conflict_check(self, mock_run, mock_project_dir: Path):
        """Handles exceptions during conflict check."""
        mock_run.side_effect = Exception("Git command failed")

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # Should return default result
        assert result["has_conflicts"] is False
        assert result["conflicting_files"] == []

    @patch("subprocess.run")
    def test_filters_auto_claude_files_from_conflicts(
        self, mock_run, mock_project_dir: Path
    ):
        """Filters .auto-claude files from conflict list."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="main\n"),
            MagicMock(returncode=0, stdout="abc123\n"),
            MagicMock(returncode=0, stdout="0\n"),
            # Fallback diffs
            MagicMock(returncode=0, stdout=".auto-claude/config.json\nnormal_file.txt\n"),
            MagicMock(returncode=0, stdout=".auto-claude/config.json\nnormal_file.txt\n"),
        ]

        result = workspace_commands._check_git_merge_conflicts(
            mock_project_dir, TEST_SPEC_NAME, base_branch="main"
        )

        # .auto-claude files should be filtered out
        assert ".auto-claude/config.json" not in result["conflicting_files"]
        if result["conflicting_files"]:
            assert all(".auto-claude" not in f for f in result["conflicting_files"])


# =============================================================================
# TESTS FOR handle_create_pr_command() - EDGE CASES
# =============================================================================



class TestDetectParallelTaskConflicts:
    """Tests for _detect_parallel_task_conflicts function."""

    def test_no_active_other_tasks(self, mock_project_dir: Path):
        """Returns empty list when no other active tasks."""
        with patch("merge.MergeOrchestrator") as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.evolution_tracker.get_active_tasks.return_value = {
                TEST_SPEC_NAME
            }
            mock_orchestrator_class.return_value = mock_orchestrator

            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt"]
            )

            assert result == []

    def test_detects_file_overlap(self, mock_project_dir: Path):
        """Detects when other tasks modify same files."""
        with patch("merge.MergeOrchestrator") as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.evolution_tracker.get_active_tasks.return_value = {
                TEST_SPEC_NAME, "002-other-spec"
            }
            mock_orchestrator.evolution_tracker.get_files_modified_by_tasks.return_value = {
                "file1.txt": ["002-other-spec"]
            }
            mock_orchestrator_class.return_value = mock_orchestrator

            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt", "file2.txt"]
            )

            assert len(result) == 1
            assert result[0]["file"] == "file1.txt"
            assert TEST_SPEC_NAME in result[0]["tasks"]
            assert "002-other-spec" in result[0]["tasks"]

    def test_no_file_overlap(self, mock_project_dir: Path):
        """Returns empty when no file overlap."""
        with patch("merge.MergeOrchestrator") as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.evolution_tracker.get_active_tasks.return_value = {
                TEST_SPEC_NAME, "002-other-spec"
            }
            mock_orchestrator.evolution_tracker.get_files_modified_by_tasks.return_value = {
                "other_file.txt": ["002-other-spec"]
            }
            mock_orchestrator_class.return_value = mock_orchestrator

            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt", "file2.txt"]
            )

            assert result == []

    def test_multiple_tasks_same_file(self, mock_project_dir: Path):
        """Detects multiple tasks modifying same file."""
        with patch("merge.MergeOrchestrator") as mock_orchestrator_class:
            mock_orchestrator = MagicMock()
            mock_orchestrator.evolution_tracker.get_active_tasks.return_value = {
                TEST_SPEC_NAME, "002-other-spec", "003-third-spec"
            }
            mock_orchestrator.evolution_tracker.get_files_modified_by_tasks.return_value = {
                "file1.txt": ["002-other-spec", "003-third-spec"]
            }
            mock_orchestrator_class.return_value = mock_orchestrator

            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt"]
            )

            assert len(result) == 1
            assert len(result[0]["tasks"]) == 3  # Current + 2 other tasks

    def test_exception_returns_empty(self, mock_project_dir: Path):
        """Returns empty list on exception."""
        with patch("merge.MergeOrchestrator", side_effect=Exception("Test error")):
            result = workspace_commands._detect_parallel_task_conflicts(
                mock_project_dir, TEST_SPEC_NAME, ["file1.txt"]
            )

            assert result == []


# =============================================================================
# TESTS FOR _detect_worktree_base_branch()
# =============================================================================

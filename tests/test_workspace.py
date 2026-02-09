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

import subprocess
from pathlib import Path

import pytest
from workspace import (
    WorkspaceChoice,
    WorkspaceMode,
    get_current_branch,
    get_existing_build_worktree,
    has_uncommitted_changes,
    setup_workspace,
)
from worktree import WorktreeManager

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"


class TestWorkspaceMode:
    """Tests for WorkspaceMode enum."""

    def test_isolated_mode(self):
        """ISOLATED mode value is correct."""
        assert WorkspaceMode.ISOLATED.value == "isolated"

    def test_direct_mode(self):
        """DIRECT mode value is correct."""
        assert WorkspaceMode.DIRECT.value == "direct"


class TestWorkspaceChoice:
    """Tests for WorkspaceChoice enum."""

    def test_merge_choice(self):
        """MERGE choice value is correct."""
        assert WorkspaceChoice.MERGE.value == "merge"

    def test_review_choice(self):
        """REVIEW choice value is correct."""
        assert WorkspaceChoice.REVIEW.value == "review"

    def test_test_choice(self):
        """TEST choice value is correct."""
        assert WorkspaceChoice.TEST.value == "test"

    def test_later_choice(self):
        """LATER choice value is correct."""
        assert WorkspaceChoice.LATER.value == "later"


class TestHasUncommittedChanges:
    """Tests for uncommitted changes detection."""

    def test_clean_repo_no_changes(self, temp_git_repo: Path):
        """Clean repo returns False."""
        result = has_uncommitted_changes(temp_git_repo)
        assert result is False

    def test_untracked_file_has_changes(self, temp_git_repo: Path):
        """Untracked file counts as changes."""
        (temp_git_repo / "new_file.txt").write_text("content")

        result = has_uncommitted_changes(temp_git_repo)
        assert result is True

    def test_modified_file_has_changes(self, temp_git_repo: Path):
        """Modified tracked file counts as changes."""
        (temp_git_repo / "README.md").write_text("modified content")

        result = has_uncommitted_changes(temp_git_repo)
        assert result is True

    def test_staged_file_has_changes(self, temp_git_repo: Path):
        """Staged file counts as changes."""
        (temp_git_repo / "README.md").write_text("modified")
        subprocess.run(["git", "add", "README.md"], cwd=temp_git_repo, capture_output=True)

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
            cwd=temp_git_repo, capture_output=True
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

        assert (temp_git_repo / ".ac.jerry" / "worktrees" / "tasks").exists()


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
        # New path: .ac.jerry/worktrees/tasks/{spec_name}
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
        (working_dir / "feature.py").write_text("# New feature\n")

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
        (working_dir / "feature.py").write_text("# New feature\n")

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
        (working_dir / "feature.py").write_text("# New feature\n")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add feature"],
            cwd=working_dir, capture_output=True
        )

        # Merge back using merge_worktree
        result = manager.merge_worktree("test-spec", delete_after=False)

        assert result is True

        # Check changes are in main
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo, capture_output=True
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
        (working_dir / "test.py").write_text("test")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Test"],
            cwd=working_dir, capture_output=True
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
        (working_dir / "test.py").write_text("test")
        subprocess.run(["git", "add", "."], cwd=working_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Test"],
            cwd=working_dir, capture_output=True
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
        (working_dir1 / "marker.txt").write_text("marker")

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
        with pytest.raises(Exception):
            # This should fail because temp_dir is not a git repo
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

        # New path: .ac.jerry/worktrees/tasks/{spec_name}
        assert "worktrees" in str(working_dir)
        assert working_dir.parent.name == "tasks"


class TestConflictInfoDisplay:
    """Tests for conflict info display function (ACS-179)."""

    def test_print_conflict_info_with_string_list(self, capsys):
        """print_conflict_info handles string list of file paths (ACS-179)."""
        from core.workspace.display import print_conflict_info

        result = {
            "conflicts": ["file1.txt", "file2.py", "file3.js"]
        }

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
                {"file": "complex-file.py", "reason": "AI merge failed", "severity": "high"},
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
        (worker_info.path / "worker-file.txt").write_text("worker content")
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path, capture_output=True
        )

        # Create a conflicting change on main
        subprocess.run(["git", "checkout", manager.base_branch], cwd=temp_git_repo, capture_output=True)
        (temp_git_repo / "worker-file.txt").write_text("main content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit"],
            cwd=temp_git_repo, capture_output=True
        )

        # Merge should fail (conflict) and return False
        # This tests the fix for ACS-163 where failed merge would fall through
        result = manager.merge_worktree("worker-spec", delete_after=False)

        # Should return False on merge conflict
        assert result is False

        # Verify side effects: base branch content is unchanged
        subprocess.run(["git", "checkout", manager.base_branch], cwd=temp_git_repo, capture_output=True)
        base_content = (temp_git_repo / "worker-file.txt").read_text()
        assert base_content == "main content", "Base branch should be unchanged after failed merge"

        # Verify worktree still exists (delete_after=False)
        assert worker_info.path.exists(), "Worktree should still exist after failed merge"

        # Verify worktree content is unchanged
        worktree_content = (worker_info.path / "worker-file.txt").read_text()
        assert worktree_content == "worker content", "Worktree content should be unchanged"

    def test_merge_success_returns_true(self, temp_git_repo: Path):
        """Successful merge returns True (ACS-163 verification)."""
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        # Create a worktree with non-conflicting changes
        worker_info = manager.create_worktree("worker-spec")
        (worker_info.path / "worker-file.txt").write_text("worker content")
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Worker commit"],
            cwd=worker_info.path, capture_output=True
        )

        # Merge should succeed
        result = manager.merge_worktree("worker-spec", delete_after=False)

        assert result is True

        # Verify the file was merged into base branch
        subprocess.run(["git", "checkout", manager.base_branch], cwd=temp_git_repo, capture_output=True)
        assert (temp_git_repo / "worker-file.txt").exists(), "Merged file should exist in base branch"
        merged_content = (temp_git_repo / "worker-file.txt").read_text()
        assert merged_content == "worker content", "Merged file should have worktree content"


class TestRebaseDetection:
    """Tests for automatic rebase detection (ACS-224)."""

    def test_check_git_conflicts_detects_branch_behind(self, temp_git_repo: Path):
        """_check_git_conflicts detects when spec branch is behind base branch (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to spec branch
        (temp_git_repo / "spec-file.txt").write_text("spec content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Go back to main and add a commit (making spec branch behind)
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "main-file.txt").write_text("main content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit after spec"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Check git conflicts - should detect spec branch is behind
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        assert result is not None
        assert result.get("needs_rebase") is True, "Should detect branch is behind"
        assert result.get("commits_behind") == 1, "Should count commits behind correctly"
        assert result.get("spec_branch") == spec_branch

    def test_check_git_conflicts_no_commits_behind(self, temp_git_repo: Path):
        """_check_git_conflicts returns commits_behind=0 when branch is up to date (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch that's ahead (not behind)
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Switch back to main before checking conflicts
        # (otherwise _check_git_conflicts would compare spec to itself)
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Check git conflicts - spec branch is ahead, not behind
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        assert result is not None
        assert result.get("needs_rebase") is False, "Should not need rebase when ahead"
        assert result.get("commits_behind") == 0, "Should have 0 commits behind"

    def test_check_git_conflicts_multiple_commits_behind(self, temp_git_repo: Path):
        """_check_git_conflicts correctly counts multiple commits behind (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to spec branch
        (temp_git_repo / "spec-file.txt").write_text("spec content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Go back to main and add multiple commits
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        for i in range(3):
            (temp_git_repo / f"main-file-{i}.txt").write_text(f"main content {i}")
            subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", f"Main commit {i}"],
                cwd=temp_git_repo,
                capture_output=True,
            )

        # Check git conflicts - should detect 3 commits behind
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        assert result is not None
        assert result.get("needs_rebase") is True
        assert result.get("commits_behind") == 3, "Should count all commits behind"


class TestRebaseSpecBranch:
    """Tests for _rebase_spec_branch function (ACS-224)."""

    def test_rebase_spec_branch_clean_rebase(self, temp_git_repo: Path):
        """_rebase_spec_branch successfully rebases clean branch (ACS-224)."""
        from core.workspace import _rebase_spec_branch

        # Create a spec branch
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to spec branch
        (temp_git_repo / "spec-file.txt").write_text("spec content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to main (making spec behind)
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "main-file.txt").write_text("main content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get spec branch commit before rebase
        before_commit = subprocess.run(
            ["git", "rev-parse", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        ).stdout.strip()

        # Rebase the spec branch
        result = _rebase_spec_branch(temp_git_repo, "test-spec", "main")

        assert result is True, "Rebase should succeed"

        # Get spec branch commit after rebase
        after_commit = subprocess.run(
            ["git", "rev-parse", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        ).stdout.strip()

        # Commits should be different (rebase changed the commit hash)
        assert before_commit != after_commit, "Rebase should change commit hash"

        # Verify spec branch now has main's commit in its history
        log = subprocess.run(
            ["git", "log", "--oneline", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        ).stdout
        assert "Main commit" in log, "Spec branch should have main commit after rebase"

    def test_rebase_spec_branch_with_conflicts_aborts_cleanly(self, temp_git_repo: Path):
        """_rebase_spec_branch handles conflicts by aborting and returning False (ACS-224)."""
        from core.workspace import _rebase_spec_branch

        # Create a spec branch
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Create a file that will conflict
        (temp_git_repo / "conflict.txt").write_text("spec version")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec conflict"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Modify the same file on main
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "conflict.txt").write_text("main version")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main conflict"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Rebase should handle conflict by aborting
        result = _rebase_spec_branch(temp_git_repo, "test-spec", "main")

        # Should return False (rebase was aborted due to conflicts, no ref movement)
        assert result is False, "Rebase with conflicts should return False after abort"

        # Verify we're not in a rebase state (was aborted)
        # Check both possible rebase state directories across git versions
        rebase_merge_dir = temp_git_repo / ".git" / "rebase-merge"
        rebase_apply_dir = temp_git_repo / ".git" / "rebase-apply"
        assert not rebase_merge_dir.exists(), (
            "Should not be in rebase-merge state after abort"
        )
        assert not rebase_apply_dir.exists(), (
            "Should not be in rebase-apply state after abort"
        )

    def test_rebase_spec_branch_invalid_branch(self, temp_git_repo: Path):
        """_rebase_spec_branch handles invalid branch gracefully (ACS-224)."""
        from core.workspace import _rebase_spec_branch

        # Try to rebase a non-existent spec branch
        result = _rebase_spec_branch(temp_git_repo, "nonexistent-spec", "main")

        assert result is False, "Rebase of non-existent branch should fail"

        # NEW-004: Verify repo state after failure - should be clean and unchanged
        # (1) Current branch should still be 'main'
        current_branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert current_branch.stdout.strip() == "main", "Should still be on main branch"

        # (2) No rebase state directories should exist
        rebase_merge_dir = temp_git_repo / ".git" / "rebase-merge"
        rebase_apply_dir = temp_git_repo / ".git" / "rebase-apply"
        assert not rebase_merge_dir.exists(), "Should not be in rebase-merge state"
        assert not rebase_apply_dir.exists(), "Should not be in rebase-apply state"

        # (3) Git status should show clean state
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        assert status_result.stdout.strip() == "", "Git status should be clean"

    def test_rebase_spec_branch_already_up_to_date(self, temp_git_repo: Path):
        """_rebase_spec_branch returns True when spec branch is already up-to-date (ACS-224)."""
        from core.workspace import _rebase_spec_branch

        # Create a spec branch and add a commit
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Switch back to main (no new commits added to main)
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Spec branch is ahead of main (not behind), so rebase should return True
        # (branch already up-to-date is a success condition)
        result = _rebase_spec_branch(temp_git_repo, "test-spec", "main")

        assert result is True, "Rebase should return True when branch is already up-to-date"


class TestRebaseIntegration:
    """Integration tests for automatic rebase in merge flow (ACS-224)."""

    def test_smart_merge_auto_rebases_when_behind(self, temp_git_repo: Path):
        """Smart merge automatically rebases spec branch when behind (ACS-224)."""
        from core.workspace import merge_existing_build

        # Create a spec worktree
        manager = WorktreeManager(temp_git_repo)
        manager.setup()

        worker_info = manager.create_worktree("test-spec")

        # Add a file in spec worktree and commit
        (worker_info.path / "spec-file.txt").write_text("spec content")
        subprocess.run(["git", "add", "."], cwd=worker_info.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=worker_info.path,
            capture_output=True,
        )

        # Add commits to main (making spec branch behind)
        subprocess.run(
            ["git", "checkout", manager.base_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        for i in range(2):
            (temp_git_repo / f"main-{i}.txt").write_text(f"main {i}")
            subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", f"Main {i}"],
                cwd=temp_git_repo,
                capture_output=True,
            )

        # Merge should succeed (auto-rebase + merge)
        result = merge_existing_build(
            temp_git_repo,
            "test-spec",
            no_commit=True,
            use_smart_merge=True,
        )

        # Merge should return True (success)
        assert result is True, "Merge with auto-rebase should succeed"

    def test_check_git_conflicts_with_diverged_branches(self, temp_git_repo: Path):
        """_check_git_conflicts correctly detects diverged branches (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to spec
        (temp_git_repo / "spec.txt").write_text("spec")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add different commits to main
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "main.txt").write_text("main")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Check git conflicts
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        assert result is not None
        assert result.get("needs_rebase") is True
        assert result.get("commits_behind") == 1
        assert result.get("base_branch") == "main"
        assert result.get("spec_branch") == spec_branch


class TestRebaseErrorHandling:
    """Tests for rebase error handling (ACS-224)."""

    def test_check_git_conflicts_handles_invalid_spec(self, temp_git_repo: Path):
        """_check_git_conflicts handles non-existent spec branch gracefully (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Check conflicts for non-existent spec
        result = _check_git_conflicts(temp_git_repo, "nonexistent-spec")

        # Should return a valid dict structure even for non-existent branch
        assert result is not None
        assert "needs_rebase" in result
        assert "commits_behind" in result
        assert result.get("needs_rebase") is False
        assert result.get("commits_behind") == 0

    def test_check_git_conflicts_handles_detached_head(self, temp_git_repo: Path):
        """_check_git_conflicts handles detached HEAD state gracefully (ACS-224)."""
        from core.workspace import _check_git_conflicts

        # Create a spec branch first
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get the commit hash and checkout to detached HEAD state
        commit_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        commit_hash = commit_result.stdout.strip()
        subprocess.run(
            ["git", "checkout", commit_hash],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Check conflicts while in detached HEAD state
        result = _check_git_conflicts(temp_git_repo, "test-spec")

        # Should return a valid dict structure with safe defaults
        assert result is not None
        assert "needs_rebase" in result
        assert "commits_behind" in result
        # In detached HEAD, base_branch will be "HEAD" and results may vary
        # The important thing is it doesn't crash

        # Cleanup: return to main branch
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

    def test_check_git_conflicts_handles_corrupted_repo(self, temp_git_repo: Path):
        """_check_git_conflicts handles corrupted repo metadata gracefully (ACS-224)."""
        import shutil

        from core.workspace import _check_git_conflicts

        # Create a spec branch
        spec_branch = "ac-jerry/test-spec"
        subprocess.run(
            ["git", "checkout", "-b", spec_branch],
            cwd=temp_git_repo,
            capture_output=True,
        )
        (temp_git_repo / "spec-file.txt").write_text("spec content")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Spec commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Return to main
        subprocess.run(
            ["git", "checkout", "main"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Backup .git directory
        git_dir = temp_git_repo / ".git"
        backup_dir = temp_git_repo / ".git.backup"

        try:
            # Simulate corrupted repo by temporarily moving .git
            shutil.move(str(git_dir), str(backup_dir))

            # Check conflicts should handle gracefully (no exception)
            result = _check_git_conflicts(temp_git_repo, "test-spec")

            # Should return a valid dict structure with default/false values
            assert result is not None
            assert "needs_rebase" in result
            assert "commits_behind" in result
            # When repo is corrupted, should return safe defaults
            assert result.get("needs_rebase") is False
            assert result.get("commits_behind") == 0

        finally:
            # Restore .git directory
            if backup_dir.exists():
                shutil.move(str(backup_dir), str(git_dir))
            # Ensure we're back on main
            subprocess.run(
                ["git", "checkout", "main"],
                cwd=temp_git_repo,
                capture_output=True,
            )

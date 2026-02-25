"""
Regression tests for GitHub PR creation after GitLab support was added.

This test suite verifies that:
1. GitHub remotes are still detected correctly
2. push_and_create_pr correctly routes to create_pull_request for GitHub
3. gh CLI is still invoked with correct arguments
4. No regressions in existing GitHub PR functionality
5. Provider field is correctly set to "github"
"""

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add apps/backend directory to path for imports
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from core.git_provider import detect_git_provider
from worktree import PullRequestResult, WorktreeInfo, WorktreeManager


class TestGitHubProviderDetection:
    """Test that GitHub remotes are still detected correctly."""

    @pytest.fixture(autouse=True)
    def isolate_git_env(self):
        """Clear GIT_* environment variables to prevent worktree interference."""
        # Store original values
        git_vars = {k: v for k, v in os.environ.items() if k.startswith('GIT_')}
        # Clear GIT environment variables
        for k in list(git_vars.keys()):
            del os.environ[k]
        yield
        # Restore original values
        for k, v in git_vars.items():
            os.environ[k] = v

    def test_github_https_detection(self, tmp_path):
        """Test GitHub HTTPS URL detection."""
        repo_path = tmp_path / "test-repo"
        repo_path.mkdir()

        # Initialize git repo with GitHub remote
        subprocess.run(["git", "init"], cwd=repo_path, check=True, capture_output=True)
        subprocess.run(
            ["git", "remote", "add", "origin", "https://github.com/user/repo.git"],
            cwd=repo_path,
            check=True,
            capture_output=True,
        )

        provider = detect_git_provider(repo_path)
        assert provider == "github", f"Expected 'github', got '{provider}'"

    def test_github_ssh_detection(self, tmp_path):
        """Test GitHub SSH URL detection."""
        repo_path = tmp_path / "test-repo"
        repo_path.mkdir()

        # Initialize git repo with GitHub remote
        subprocess.run(["git", "init"], cwd=repo_path, check=True, capture_output=True)
        subprocess.run(
            ["git", "remote", "add", "origin", "git@github.com:user/repo.git"],
            cwd=repo_path,
            check=True,
            capture_output=True,
        )

        provider = detect_git_provider(repo_path)
        assert provider == "github", f"Expected 'github', got '{provider}'"

    def test_github_enterprise_detection(self, tmp_path):
        """Test GitHub Enterprise URL detection."""
        repo_path = tmp_path / "test-repo"
        repo_path.mkdir()

        # Initialize git repo with GitHub Enterprise remote
        subprocess.run(["git", "init"], cwd=repo_path, check=True, capture_output=True)
        subprocess.run(
            [
                "git",
                "remote",
                "add",
                "origin",
                "https://github.company.com/user/repo.git",
            ],
            cwd=repo_path,
            check=True,
            capture_output=True,
        )

        provider = detect_git_provider(repo_path)
        assert provider == "github", f"Expected 'github', got '{provider}'"


class TestGitHubPRRouting:
    """Test that push_and_create_pr correctly routes to create_pull_request for GitHub."""

    def test_github_routing_to_create_pull_request(
        self, worktree_manager, temp_project_dir
    ):
        """Test that GitHub remotes route to create_pull_request."""
        spec_name = "test-spec"

        # Mock push_branch to succeed
        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        # Mock PR creation result
        mock_pr_result = PullRequestResult(
            success=True,
            pr_url="https://github.com/user/repo/pull/123",
            already_exists=False,
        )

        # Import the actual module to patch it directly
        import core.worktree as worktree_module

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            # Patch on the module object directly to handle importlib shim loading
            patch.object(worktree_module, "detect_git_provider", return_value="github"),
            patch.object(
                worktree_manager, "create_pull_request", return_value=mock_pr_result
            ) as mock_create_pr,
        ):
            result = worktree_manager.push_and_create_pr(
                spec_name=spec_name,
                target_branch="main",
                title="Test PR",
                draft=False,
            )

        # Verify create_pull_request was called
        mock_create_pr.assert_called_once_with(
            spec_name=spec_name,
            target_branch="main",
            title="Test PR",
            draft=False,
        )

        # Verify result
        assert result["success"] is True
        assert result["pushed"] is True
        assert result["provider"] == "github"
        assert result["pr_url"] == "https://github.com/user/repo/pull/123"

    def test_github_provider_field_set_correctly(
        self, worktree_manager, temp_project_dir
    ):
        """Test that provider field is set to 'github' in result."""
        spec_name = "test-spec"

        # Mock push_branch to succeed
        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        # Mock PR creation result
        mock_pr_result = PullRequestResult(
            success=True,
            pr_url="https://github.com/user/repo/pull/123",
            already_exists=False,
        )

        # Import the actual module to patch it directly
        import core.worktree as worktree_module

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            # Patch on the module object directly to handle importlib shim loading
            patch.object(worktree_module, "detect_git_provider", return_value="github"),
            patch.object(
                worktree_manager, "create_pull_request", return_value=mock_pr_result
            ),
        ):
            result = worktree_manager.push_and_create_pr(
                spec_name=spec_name,
                target_branch="main",
                title="Test PR",
                draft=False,
            )

        # Verify provider field
        assert result["provider"] == "github", (
            f"Expected provider='github', got '{result['provider']}'"
        )
        assert result["pushed"] is True


class TestGitHubCLIInvocation:
    """Test that gh CLI is still invoked correctly with proper arguments."""

    def test_gh_cli_invoked_with_correct_args(self, tmp_path):
        """Test that gh pr create is invoked with correct arguments."""
        # Setup
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # Create .auto-claude directories
        auto_claude_dir = project_dir / ".auto-claude"
        auto_claude_dir.mkdir(exist_ok=True)

        # Create WorktreeManager
        manager = WorktreeManager(
            project_dir=project_dir,
            base_branch="main",
        )

        # Mock get_worktree_info to return a valid WorktreeInfo
        mock_worktree_info = WorktreeInfo(
            path=spec_dir,
            branch="auto-claude/001-test-spec",
            spec_name="001-test-spec",
            base_branch="main",
            is_active=True,
        )

        # Mock subprocess result
        mock_subprocess_result = MagicMock(
            returncode=0,
            stdout="https://github.com/user/repo/pull/123\n",
            stderr="",
        )

        # Import the actual module to patch it directly
        import core.worktree as worktree_module

        with (
            patch.object(manager, "get_worktree_info", return_value=mock_worktree_info),
            patch.object(
                worktree_module, "get_gh_executable", return_value="/usr/bin/gh"
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ) as mock_run,
            patch.object(manager, "_extract_spec_summary", return_value="Test PR body"),
        ):
            result = manager.create_pull_request(
                spec_name="001-test-spec",
                target_branch="main",
                title="Test PR Title",
                draft=False,
            )

        # Verify gh CLI was called with correct arguments
        assert mock_run.called
        call_args = mock_run.call_args[0][0]
        assert call_args[0] == "/usr/bin/gh"
        assert "pr" in call_args
        assert "create" in call_args
        assert "--base" in call_args
        assert "main" in call_args
        assert "--title" in call_args
        assert "Test PR Title" in call_args
        assert "--body" in call_args

        # Verify result
        assert result["success"] is True
        assert result["pr_url"] == "https://github.com/user/repo/pull/123"

    def test_gh_cli_draft_flag(self, tmp_path):
        """Test that --draft flag is passed to gh CLI when draft=True."""
        # Setup
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # Create .auto-claude directories
        auto_claude_dir = project_dir / ".auto-claude"
        auto_claude_dir.mkdir(exist_ok=True)

        # Create WorktreeManager
        manager = WorktreeManager(
            project_dir=project_dir,
            base_branch="main",
        )

        # Mock get_worktree_info
        mock_worktree_info = WorktreeInfo(
            path=spec_dir,
            branch="auto-claude/001-test-spec",
            spec_name="001-test-spec",
            base_branch="main",
            is_active=True,
        )

        # Mock subprocess result
        mock_subprocess_result = MagicMock(
            returncode=0,
            stdout="https://github.com/user/repo/pull/123\n",
            stderr="",
        )

        # Import the actual module to patch it directly
        import core.worktree as worktree_module

        with (
            patch.object(manager, "get_worktree_info", return_value=mock_worktree_info),
            patch.object(
                worktree_module, "get_gh_executable", return_value="/usr/bin/gh"
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ) as mock_run,
            patch.object(manager, "_extract_spec_summary", return_value="Test PR body"),
        ):
            result = manager.create_pull_request(
                spec_name="001-test-spec",
                target_branch="main",
                title="Draft PR",
                draft=True,
            )

        # Verify --draft flag is present
        call_args = mock_run.call_args[0][0]
        assert "--draft" in call_args
        assert result["success"] is True


class TestGitHubOriginPrefixStripping:
    """Test that origin/ prefix is stripped from target_branch in create_pull_request."""

    def test_origin_prefix_stripped_from_target_branch(self, tmp_path):
        """Test that 'origin/develop' becomes 'develop' in --base argument to gh CLI."""
        # Setup
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # Create .auto-claude directories
        auto_claude_dir = project_dir / ".auto-claude"
        auto_claude_dir.mkdir(exist_ok=True)

        # Create WorktreeManager
        manager = WorktreeManager(
            project_dir=project_dir,
            base_branch="main",
        )

        # Mock get_worktree_info to return a valid WorktreeInfo
        mock_worktree_info = WorktreeInfo(
            path=spec_dir,
            branch="auto-claude/001-test-spec",
            spec_name="001-test-spec",
            base_branch="main",
            is_active=True,
        )

        # Mock subprocess result
        mock_subprocess_result = MagicMock(
            returncode=0,
            stdout="https://github.com/user/repo/pull/123\n",
            stderr="",
        )

        # Import the actual module to patch it directly
        import core.worktree as worktree_module

        with (
            patch.object(manager, "get_worktree_info", return_value=mock_worktree_info),
            patch.object(
                worktree_module, "get_gh_executable", return_value="/usr/bin/gh"
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ) as mock_run,
            patch.object(manager, "_extract_spec_summary", return_value="Test PR body"),
        ):
            result = manager.create_pull_request(
                spec_name="001-test-spec",
                target_branch="origin/develop",
                title="Test PR Title",
                draft=False,
            )

        # Verify gh CLI received "develop" (not "origin/develop") as --base
        assert mock_run.called
        call_args = mock_run.call_args[0][0]
        base_idx = call_args.index("--base")
        assert call_args[base_idx + 1] == "develop", (
            f"Expected 'develop' after --base, got '{call_args[base_idx + 1]}'"
        )
        assert result["success"] is True

    def test_target_branch_without_origin_prefix_unchanged(self, tmp_path):
        """Test that 'develop' (no prefix) is passed through unchanged to gh CLI."""
        # Setup
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # Create .auto-claude directories
        auto_claude_dir = project_dir / ".auto-claude"
        auto_claude_dir.mkdir(exist_ok=True)

        # Create WorktreeManager
        manager = WorktreeManager(
            project_dir=project_dir,
            base_branch="main",
        )

        # Mock get_worktree_info to return a valid WorktreeInfo
        mock_worktree_info = WorktreeInfo(
            path=spec_dir,
            branch="auto-claude/001-test-spec",
            spec_name="001-test-spec",
            base_branch="main",
            is_active=True,
        )

        # Mock subprocess result
        mock_subprocess_result = MagicMock(
            returncode=0,
            stdout="https://github.com/user/repo/pull/123\n",
            stderr="",
        )

        # Import the actual module to patch it directly
        import core.worktree as worktree_module

        with (
            patch.object(manager, "get_worktree_info", return_value=mock_worktree_info),
            patch.object(
                worktree_module, "get_gh_executable", return_value="/usr/bin/gh"
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ) as mock_run,
            patch.object(manager, "_extract_spec_summary", return_value="Test PR body"),
        ):
            result = manager.create_pull_request(
                spec_name="001-test-spec",
                target_branch="develop",
                title="Test PR Title",
                draft=False,
            )

        # Verify gh CLI received "develop" as --base
        assert mock_run.called
        call_args = mock_run.call_args[0][0]
        base_idx = call_args.index("--base")
        assert call_args[base_idx + 1] == "develop", (
            f"Expected 'develop' after --base, got '{call_args[base_idx + 1]}'"
        )
        assert result["success"] is True


class TestGitHubErrorHandling:
    """Test that GitHub error handling still works correctly."""

    def test_missing_gh_cli_error(self, tmp_path):
        """Test error message when gh CLI is not installed."""
        # Setup
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # Create .auto-claude directories
        auto_claude_dir = project_dir / ".auto-claude"
        auto_claude_dir.mkdir(exist_ok=True)

        # Create WorktreeManager
        manager = WorktreeManager(
            project_dir=project_dir,
            base_branch="main",
        )

        # Mock get_worktree_info
        mock_worktree_info = WorktreeInfo(
            path=spec_dir,
            branch="auto-claude/001-test-spec",
            spec_name="001-test-spec",
            base_branch="main",
            is_active=True,
        )

        # Import the actual module to patch it directly
        import core.worktree as worktree_module

        with (
            patch.object(manager, "get_worktree_info", return_value=mock_worktree_info),
            patch.object(worktree_module, "get_gh_executable", return_value=None),
        ):
            result = manager.create_pull_request(
                spec_name="001-test-spec",
                target_branch="main",
                title="Test PR",
                draft=False,
            )

        # Verify error message
        assert result["success"] is False
        assert "GitHub CLI (gh) not found" in result["error"]

    def test_already_exists_handling(self, tmp_path):
        """Test that 'already exists' case is handled correctly."""
        # Setup
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # Create .auto-claude directories
        auto_claude_dir = project_dir / ".auto-claude"
        auto_claude_dir.mkdir(exist_ok=True)

        # Create WorktreeManager
        manager = WorktreeManager(
            project_dir=project_dir,
            base_branch="main",
        )

        # Mock get_worktree_info
        mock_worktree_info = WorktreeInfo(
            path=spec_dir,
            branch="auto-claude/001-test-spec",
            spec_name="001-test-spec",
            base_branch="main",
            is_active=True,
        )

        # Mock subprocess result for "already exists" error
        mock_subprocess_result = MagicMock(
            returncode=1,
            stdout="",
            stderr="pull request already exists",
        )

        # Import the actual module to patch it directly
        import core.worktree as worktree_module

        with (
            patch.object(manager, "get_worktree_info", return_value=mock_worktree_info),
            patch.object(
                worktree_module, "get_gh_executable", return_value="/usr/bin/gh"
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ),
            patch.object(
                manager,
                "_get_existing_pr_url",
                return_value="https://github.com/user/repo/pull/123",
            ),
            patch.object(manager, "_extract_spec_summary", return_value="Test PR body"),
        ):
            result = manager.create_pull_request(
                spec_name="001-test-spec",
                target_branch="main",
                title="Test PR",
                draft=False,
            )

        # Verify it's treated as success with already_exists flag
        assert result["success"] is True
        assert result["already_exists"] is True
        assert result["pr_url"] == "https://github.com/user/repo/pull/123"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

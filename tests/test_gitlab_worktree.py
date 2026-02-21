"""
Integration Tests for WorktreeManager GitLab/GitHub PR/MR Creation
==================================================================

Tests the WorktreeManager class methods for creating pull requests (GitHub)
and merge requests (GitLab), including provider detection and CLI routing.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add apps/backend directory to path for imports
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from worktree import (
    PullRequestResult,
    WorktreeInfo,
)


class TestCreateMergeRequest:
    """Test create_merge_request method for GitLab MR creation."""

    def test_successful_mr_creation(self, worktree_manager, temp_project_dir):
        """Test successful MR creation with glab CLI."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        # Mock get_worktree_info to return a valid WorktreeInfo
        mock_worktree_info = WorktreeInfo(
            path=temp_project_dir / ".auto-claude" / "worktrees" / "tasks" / spec_name,
            branch=f"auto-claude/{spec_name}",
            spec_name=spec_name,
            base_branch="main",
            is_active=True,
        )

        # Mock subprocess for glab CLI
        mock_subprocess_result = MagicMock(
            returncode=0,
            stdout="https://gitlab.com/user/repo/-/merge_requests/42\n",
            stderr="",
        )

        with (
            patch.object(
                worktree_manager, "get_worktree_info", return_value=mock_worktree_info
            ),
            patch.object(
                worktree_module,
                "get_glab_executable",
                return_value="/usr/local/bin/glab",
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ),
            patch.object(
                worktree_manager, "_extract_spec_summary", return_value="Test MR body"
            ),
        ):
            result = worktree_manager.create_merge_request(
                spec_name=spec_name,
                target_branch="main",
                title="Test MR",
                draft=False,
            )

        # Verify result
        assert result["success"] is True
        assert result["pr_url"] == "https://gitlab.com/user/repo/-/merge_requests/42"
        assert result.get("already_exists") is False
        assert "error" not in result or result["error"] is None

    def test_mr_already_exists(self, worktree_manager, temp_project_dir):
        """Test MR already exists scenario."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_worktree_info = WorktreeInfo(
            path=temp_project_dir / ".auto-claude" / "worktrees" / "tasks" / spec_name,
            branch=f"auto-claude/{spec_name}",
            spec_name=spec_name,
            base_branch="main",
            is_active=True,
        )

        # Mock glab CLI returning "already exists" error
        mock_subprocess_result = MagicMock(
            returncode=1,
            stdout="",
            stderr="Error: merge request already exists\n",
        )

        # Mock _get_existing_mr_url to return existing URL
        existing_url = "https://gitlab.com/user/repo/-/merge_requests/42"

        with (
            patch.object(
                worktree_manager, "get_worktree_info", return_value=mock_worktree_info
            ),
            patch.object(
                worktree_module,
                "get_glab_executable",
                return_value="/usr/local/bin/glab",
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ),
            patch.object(
                worktree_manager, "_extract_spec_summary", return_value="Test MR body"
            ),
            patch.object(
                worktree_manager, "_get_existing_mr_url", return_value=existing_url
            ),
        ):
            result = worktree_manager.create_merge_request(
                spec_name=spec_name,
                target_branch="main",
            )

        # Verify result
        assert result["success"] is True
        assert result["pr_url"] == existing_url
        assert result["already_exists"] is True
        assert "error" not in result or result["error"] is None

    def test_missing_glab_cli(self, worktree_manager, temp_project_dir):
        """Test error when glab CLI is not installed."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_worktree_info = WorktreeInfo(
            path=temp_project_dir / ".auto-claude" / "worktrees" / "tasks" / spec_name,
            branch=f"auto-claude/{spec_name}",
            spec_name=spec_name,
            base_branch="main",
            is_active=True,
        )

        with (
            patch.object(
                worktree_manager, "get_worktree_info", return_value=mock_worktree_info
            ),
            patch.object(worktree_module, "get_glab_executable", return_value=None),
        ):
            result = worktree_manager.create_merge_request(spec_name=spec_name)

        # Verify error
        assert result["success"] is False
        assert "GitLab CLI (glab) not found" in result["error"]
        assert "https://gitlab.com/gitlab-org/cli" in result["error"]

    def test_no_worktree_found(self, worktree_manager):
        """Test error when worktree doesn't exist."""
        spec_name = "nonexistent-spec"

        with patch.object(worktree_manager, "get_worktree_info", return_value=None):
            result = worktree_manager.create_merge_request(spec_name=spec_name)

        # Verify error
        assert result["success"] is False
        assert f"No worktree found for spec: {spec_name}" in result["error"]

    def test_mr_with_draft_flag(self, worktree_manager, temp_project_dir):
        """Test MR creation with draft flag."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_worktree_info = WorktreeInfo(
            path=temp_project_dir / ".auto-claude" / "worktrees" / "tasks" / spec_name,
            branch=f"auto-claude/{spec_name}",
            spec_name=spec_name,
            base_branch="main",
            is_active=True,
        )

        mock_subprocess_result = MagicMock(
            returncode=0,
            stdout="https://gitlab.com/user/repo/-/merge_requests/43\n",
            stderr="",
        )

        with (
            patch.object(
                worktree_manager, "get_worktree_info", return_value=mock_worktree_info
            ),
            patch.object(
                worktree_module,
                "get_glab_executable",
                return_value="/usr/local/bin/glab",
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ) as mock_run,
            patch.object(
                worktree_manager, "_extract_spec_summary", return_value="Test MR body"
            ),
        ):
            result = worktree_manager.create_merge_request(
                spec_name=spec_name,
                draft=True,
            )

        # Verify draft flag was passed to glab
        call_args = mock_run.call_args[0][0]
        assert "--draft" in call_args
        assert result["success"] is True

    def test_network_error_retry(self, worktree_manager, temp_project_dir):
        """Test retry logic for network errors."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_worktree_info = WorktreeInfo(
            path=temp_project_dir / ".auto-claude" / "worktrees" / "tasks" / spec_name,
            branch=f"auto-claude/{spec_name}",
            spec_name=spec_name,
            base_branch="main",
            is_active=True,
        )

        # First call fails with network error, second succeeds
        mock_failure = MagicMock(
            returncode=1,
            stdout="",
            stderr="Error: connection timeout\n",
        )
        mock_success = MagicMock(
            returncode=0,
            stdout="https://gitlab.com/user/repo/-/merge_requests/44\n",
            stderr="",
        )

        with (
            patch.object(
                worktree_manager, "get_worktree_info", return_value=mock_worktree_info
            ),
            patch.object(
                worktree_module,
                "get_glab_executable",
                return_value="/usr/local/bin/glab",
            ),
            patch.object(
                worktree_module.subprocess,
                "run",
                side_effect=[mock_failure, mock_success],
            ),
            patch.object(
                worktree_manager, "_extract_spec_summary", return_value="Test MR body"
            ),
            patch.object(worktree_module.time, "sleep"),  # Skip sleep in tests
        ):
            result = worktree_manager.create_merge_request(spec_name=spec_name)

        # Verify retry succeeded
        assert result["success"] is True
        assert result["pr_url"] == "https://gitlab.com/user/repo/-/merge_requests/44"


class TestGitLabOriginPrefixStripping:
    """Test that origin/ prefix is stripped from target_branch in create_merge_request."""

    def test_origin_prefix_stripped_from_target_branch(
        self, worktree_manager, temp_project_dir
    ):
        """Test that 'origin/develop' becomes 'develop' in --target-branch argument to glab CLI."""
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_worktree_info = WorktreeInfo(
            path=temp_project_dir / ".auto-claude" / "worktrees" / "tasks" / spec_name,
            branch=f"auto-claude/{spec_name}",
            spec_name=spec_name,
            base_branch="main",
            is_active=True,
        )

        mock_subprocess_result = MagicMock(
            returncode=0,
            stdout="https://gitlab.com/user/repo/-/merge_requests/42\n",
            stderr="",
        )

        with (
            patch.object(
                worktree_manager, "get_worktree_info", return_value=mock_worktree_info
            ),
            patch.object(
                worktree_module,
                "get_glab_executable",
                return_value="/usr/local/bin/glab",
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ) as mock_run,
            patch.object(
                worktree_manager, "_extract_spec_summary", return_value="Test MR body"
            ),
        ):
            result = worktree_manager.create_merge_request(
                spec_name=spec_name,
                target_branch="origin/develop",
                title="Test MR",
                draft=False,
            )

        # Verify glab CLI received "develop" (not "origin/develop") as --target-branch
        assert mock_run.called
        call_args = mock_run.call_args[0][0]
        target_idx = call_args.index("--target-branch")
        assert call_args[target_idx + 1] == "develop", (
            f"Expected 'develop' after --target-branch, got '{call_args[target_idx + 1]}'"
        )
        assert result["success"] is True

    def test_target_branch_without_origin_prefix_unchanged(
        self, worktree_manager, temp_project_dir
    ):
        """Test that 'develop' (no prefix) is passed through unchanged to glab CLI."""
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_worktree_info = WorktreeInfo(
            path=temp_project_dir / ".auto-claude" / "worktrees" / "tasks" / spec_name,
            branch=f"auto-claude/{spec_name}",
            spec_name=spec_name,
            base_branch="main",
            is_active=True,
        )

        mock_subprocess_result = MagicMock(
            returncode=0,
            stdout="https://gitlab.com/user/repo/-/merge_requests/43\n",
            stderr="",
        )

        with (
            patch.object(
                worktree_manager, "get_worktree_info", return_value=mock_worktree_info
            ),
            patch.object(
                worktree_module,
                "get_glab_executable",
                return_value="/usr/local/bin/glab",
            ),
            patch.object(
                worktree_module.subprocess, "run", return_value=mock_subprocess_result
            ) as mock_run,
            patch.object(
                worktree_manager, "_extract_spec_summary", return_value="Test MR body"
            ),
        ):
            result = worktree_manager.create_merge_request(
                spec_name=spec_name,
                target_branch="develop",
                title="Test MR",
                draft=False,
            )

        # Verify glab CLI received "develop" as --target-branch
        assert mock_run.called
        call_args = mock_run.call_args[0][0]
        target_idx = call_args.index("--target-branch")
        assert call_args[target_idx + 1] == "develop", (
            f"Expected 'develop' after --target-branch, got '{call_args[target_idx + 1]}'"
        )
        assert result["success"] is True


class TestPushAndCreatePR:
    """Test push_and_create_pr method with provider detection."""

    def test_gitlab_routing(self, worktree_manager, temp_project_dir):
        """Test routing to create_merge_request for GitLab repos."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        # Mock push_branch to succeed
        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        # Mock MR creation result
        mock_mr_result = PullRequestResult(
            success=True,
            pr_url="https://gitlab.com/user/repo/-/merge_requests/42",
            already_exists=False,
        )

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            patch.object(worktree_module, "detect_git_provider", return_value="gitlab"),
            patch.object(
                worktree_manager, "create_merge_request", return_value=mock_mr_result
            ) as mock_create_mr,
        ):
            result = worktree_manager.push_and_create_pr(
                spec_name=spec_name,
                target_branch="main",
                title="Test MR",
            )

        # Verify routing to GitLab
        mock_create_mr.assert_called_once_with(
            spec_name=spec_name,
            target_branch="main",
            title="Test MR",
            draft=False,
        )

        # Verify result
        assert result["success"] is True
        assert result["pushed"] is True
        assert result["provider"] == "gitlab"
        assert result["pr_url"] == "https://gitlab.com/user/repo/-/merge_requests/42"

    def test_unknown_provider_error(self, worktree_manager, temp_project_dir):
        """Test error handling for unknown git providers."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        # Mock push_branch to succeed
        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            patch.object(
                worktree_module, "detect_git_provider", return_value="unknown"
            ),
        ):
            result = worktree_manager.push_and_create_pr(spec_name=spec_name)

        # Verify error
        assert result["success"] is False
        assert result["pushed"] is True
        assert result["provider"] == "unknown"
        assert "Unable to determine git hosting provider" in result["error"]
        assert "Supported: GitHub, GitLab" in result["error"]

    def test_push_failure(self, worktree_manager, temp_project_dir):
        """Test handling of push failures."""
        spec_name = "test-feature"

        # Mock push_branch to fail
        mock_push_result = {
            "success": False,
            "error": "Failed to push: remote rejected",
        }

        with patch.object(
            worktree_manager, "push_branch", return_value=mock_push_result
        ):
            result = worktree_manager.push_and_create_pr(spec_name=spec_name)

        # Verify error
        assert result["success"] is False
        assert result["pushed"] is False
        assert "Failed to push: remote rejected" in result["error"]

    def test_draft_pr_flag(self, worktree_manager, temp_project_dir):
        """Test draft flag is passed through correctly."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        mock_pr_result = PullRequestResult(
            success=True,
            pr_url="https://github.com/user/repo/pull/124",
            already_exists=False,
        )

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            patch.object(worktree_module, "detect_git_provider", return_value="github"),
            patch.object(
                worktree_manager, "create_pull_request", return_value=mock_pr_result
            ) as mock_create_pr,
        ):
            result = worktree_manager.push_and_create_pr(
                spec_name=spec_name,
                draft=True,
            )

        # Verify draft flag was passed
        assert mock_create_pr.call_args[1]["draft"] is True
        assert result["success"] is True

    def test_force_push_flag(self, worktree_manager, temp_project_dir):
        """Test force push flag is passed to push_branch."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        mock_pr_result = PullRequestResult(
            success=True,
            pr_url="https://github.com/user/repo/pull/125",
            already_exists=False,
        )

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ) as mock_push,
            patch.object(worktree_module, "detect_git_provider", return_value="github"),
            patch.object(
                worktree_manager, "create_pull_request", return_value=mock_pr_result
            ),
        ):
            result = worktree_manager.push_and_create_pr(
                spec_name=spec_name,
                force_push=True,
            )

        # Verify force flag was passed to push_branch
        assert mock_push.call_args[1]["force"] is True
        assert result["success"] is True

    def test_custom_target_branch(self, worktree_manager, temp_project_dir):
        """Test custom target branch is passed through."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"
        custom_target = "develop"

        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        mock_pr_result = PullRequestResult(
            success=True,
            pr_url="https://github.com/user/repo/pull/126",
            already_exists=False,
        )

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            patch.object(worktree_module, "detect_git_provider", return_value="github"),
            patch.object(
                worktree_manager, "create_pull_request", return_value=mock_pr_result
            ) as mock_create_pr,
        ):
            result = worktree_manager.push_and_create_pr(
                spec_name=spec_name,
                target_branch=custom_target,
            )

        # Verify target branch was passed
        assert mock_create_pr.call_args[1]["target_branch"] == custom_target
        assert result["success"] is True


class TestProviderIntegration:
    """Test integration between provider detection and CLI routing."""

    def test_self_hosted_gitlab_routing(self, worktree_manager, temp_project_dir):
        """Test that self-hosted GitLab instances route to glab CLI."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        mock_mr_result = PullRequestResult(
            success=True,
            pr_url="https://gitlab.company.com/team/repo/-/merge_requests/1",
            already_exists=False,
        )

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            patch.object(
                worktree_module, "detect_git_provider", return_value="gitlab"
            ),  # Self-hosted detected as gitlab
            patch.object(
                worktree_manager, "create_merge_request", return_value=mock_mr_result
            ) as mock_create_mr,
        ):
            result = worktree_manager.push_and_create_pr(spec_name=spec_name)

        # Verify routing to GitLab (not GitHub)
        mock_create_mr.assert_called_once()
        assert result["provider"] == "gitlab"
        assert result["success"] is True

    def test_pr_already_exists_propagation(self, worktree_manager, temp_project_dir):
        """Test that already_exists flag propagates correctly."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        # Mock PR that already exists
        mock_pr_result = PullRequestResult(
            success=True,
            pr_url="https://github.com/user/repo/pull/127",
            already_exists=True,
        )

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            patch.object(worktree_module, "detect_git_provider", return_value="github"),
            patch.object(
                worktree_manager, "create_pull_request", return_value=mock_pr_result
            ),
        ):
            result = worktree_manager.push_and_create_pr(spec_name=spec_name)

        # Verify already_exists flag
        assert result["success"] is True
        assert result["already_exists"] is True
        assert result["pr_url"] == "https://github.com/user/repo/pull/127"

    def test_error_propagation_from_pr_creation(
        self, worktree_manager, temp_project_dir
    ):
        """Test that errors from PR/MR creation propagate correctly."""
        # Import the actual module to patch it directly (handles importlib shim)
        import core.worktree as worktree_module

        spec_name = "test-feature"

        mock_push_result = {
            "success": True,
            "remote": "origin",
            "branch": f"auto-claude/{spec_name}",
        }

        # Mock PR creation failure
        mock_pr_result = PullRequestResult(
            success=False,
            error="Authentication failed",
        )

        with (
            patch.object(
                worktree_manager, "push_branch", return_value=mock_push_result
            ),
            patch.object(worktree_module, "detect_git_provider", return_value="github"),
            patch.object(
                worktree_manager, "create_pull_request", return_value=mock_pr_result
            ),
        ):
            result = worktree_manager.push_and_create_pr(spec_name=spec_name)

        # Verify error propagation
        assert result["success"] is False
        assert result["pushed"] is True
        assert "Authentication failed" in result["error"]

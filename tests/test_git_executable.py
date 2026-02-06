"""Tests for git_executable module - environment isolation and git executable finding."""

import os
import subprocess
from unittest.mock import patch

from core.git_executable import (
    GIT_ENV_VARS_TO_CLEAR,
    get_git_executable,
    get_isolated_git_env,
    run_git,
)


class TestGetIsolatedGitEnv:
    """Tests for get_isolated_git_env() function."""

    def test_clears_git_dir(self):
        """GIT_DIR should be removed from the environment."""
        base_env = {"GIT_DIR": "/some/path", "PATH": "/usr/bin"}
        env = get_isolated_git_env(base_env)
        assert "GIT_DIR" not in env
        assert env["PATH"] == "/usr/bin"

    def test_clears_git_work_tree(self):
        """GIT_WORK_TREE should be removed from the environment."""
        base_env = {"GIT_WORK_TREE": "/some/worktree", "HOME": "/home/user"}
        env = get_isolated_git_env(base_env)
        assert "GIT_WORK_TREE" not in env
        assert env["HOME"] == "/home/user"

    def test_clears_all_git_env_vars(self):
        """All variables in GIT_ENV_VARS_TO_CLEAR should be removed."""
        # Create env with all the git vars set
        base_env = {var: f"value_{var}" for var in GIT_ENV_VARS_TO_CLEAR}
        base_env["PATH"] = "/usr/bin"
        base_env["HOME"] = "/home/user"

        env = get_isolated_git_env(base_env)

        # None of the git vars should remain
        for var in GIT_ENV_VARS_TO_CLEAR:
            assert var not in env, f"{var} should have been cleared"

        # Non-git vars should be preserved
        assert env["PATH"] == "/usr/bin"
        assert env["HOME"] == "/home/user"

    def test_sets_husky_zero(self):
        """HUSKY should be set to '0' to disable user hooks."""
        env = get_isolated_git_env({"PATH": "/usr/bin"})
        assert env["HUSKY"] == "0"

    def test_husky_overrides_existing_value(self):
        """HUSKY=0 should override any existing HUSKY value."""
        base_env = {"HUSKY": "1", "PATH": "/usr/bin"}
        env = get_isolated_git_env(base_env)
        assert env["HUSKY"] == "0"

    def test_does_not_modify_original_env(self):
        """The original environment dict should not be modified."""
        base_env = {"GIT_DIR": "/some/path", "PATH": "/usr/bin"}
        original_git_dir = base_env["GIT_DIR"]

        get_isolated_git_env(base_env)

        assert base_env["GIT_DIR"] == original_git_dir

    def test_uses_os_environ_by_default(self):
        """When no base_env is provided, should use os.environ."""
        with patch.dict(os.environ, {"GIT_DIR": "/test/path"}, clear=False):
            env = get_isolated_git_env()
            assert "GIT_DIR" not in env

    def test_preserves_unrelated_vars(self):
        """Environment variables not in the clear list should be preserved."""
        base_env = {
            "PATH": "/usr/bin",
            "HOME": "/home/user",
            "LANG": "en_US.UTF-8",
            "CUSTOM_VAR": "custom_value",
            "GIT_DIR": "/should/be/cleared",
        }

        env = get_isolated_git_env(base_env)

        assert env["PATH"] == "/usr/bin"
        assert env["HOME"] == "/home/user"
        assert env["LANG"] == "en_US.UTF-8"
        assert env["CUSTOM_VAR"] == "custom_value"


class TestGitEnvVarsToClear:
    """Tests for the GIT_ENV_VARS_TO_CLEAR constant."""

    def test_contains_git_dir(self):
        """GIT_DIR must be in the list."""
        assert "GIT_DIR" in GIT_ENV_VARS_TO_CLEAR

    def test_contains_git_work_tree(self):
        """GIT_WORK_TREE must be in the list."""
        assert "GIT_WORK_TREE" in GIT_ENV_VARS_TO_CLEAR

    def test_contains_git_index_file(self):
        """GIT_INDEX_FILE must be in the list."""
        assert "GIT_INDEX_FILE" in GIT_ENV_VARS_TO_CLEAR

    def test_contains_author_identity_vars(self):
        """Author identity variables must be in the list."""
        assert "GIT_AUTHOR_NAME" in GIT_ENV_VARS_TO_CLEAR
        assert "GIT_AUTHOR_EMAIL" in GIT_ENV_VARS_TO_CLEAR
        assert "GIT_AUTHOR_DATE" in GIT_ENV_VARS_TO_CLEAR

    def test_contains_committer_identity_vars(self):
        """Committer identity variables must be in the list."""
        assert "GIT_COMMITTER_NAME" in GIT_ENV_VARS_TO_CLEAR
        assert "GIT_COMMITTER_EMAIL" in GIT_ENV_VARS_TO_CLEAR
        assert "GIT_COMMITTER_DATE" in GIT_ENV_VARS_TO_CLEAR


class TestRunGit:
    """Tests for run_git() function."""

    def test_uses_isolated_env_by_default(self):
        """run_git should use isolated environment by default."""
        with patch("core.git_executable.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=["git", "status"], returncode=0, stdout="", stderr=""
            )

            run_git(["status"])

            # Check that env was passed and doesn't contain GIT_DIR
            call_kwargs = mock_run.call_args.kwargs
            assert "env" in call_kwargs
            assert "GIT_DIR" not in call_kwargs["env"]
            assert call_kwargs["env"]["HUSKY"] == "0"

    def test_respects_isolate_env_false(self):
        """run_git with isolate_env=False should not modify environment."""
        with patch("core.git_executable.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=["git", "status"], returncode=0, stdout="", stderr=""
            )

            run_git(["status"], isolate_env=False)

            call_kwargs = mock_run.call_args.kwargs
            # When isolate_env=False and no env provided, env should be None
            assert call_kwargs.get("env") is None

    def test_allows_custom_env(self):
        """run_git should accept custom environment."""
        custom_env = {"PATH": "/custom/path", "CUSTOM": "value"}

        with patch("core.git_executable.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=["git", "status"], returncode=0, stdout="", stderr=""
            )

            run_git(["status"], env=custom_env)

            call_kwargs = mock_run.call_args.kwargs
            assert call_kwargs["env"] == custom_env

    def test_handles_timeout(self):
        """run_git should handle timeout gracefully."""
        with patch("core.git_executable.subprocess.run") as mock_run:
            mock_run.side_effect = subprocess.TimeoutExpired(cmd="git", timeout=60)

            result = run_git(["status"], timeout=60)

            assert result.returncode == -1
            assert "timed out" in result.stderr

    def test_handles_file_not_found(self):
        """run_git should handle missing git executable gracefully."""
        with patch("core.git_executable.subprocess.run") as mock_run:
            mock_run.side_effect = FileNotFoundError()

            result = run_git(["status"])

            assert result.returncode == -1
            assert "not found" in result.stderr


class TestGetGitExecutable:
    """Tests for get_git_executable() function."""

    def test_returns_string(self):
        """get_git_executable should return a string path."""
        result = get_git_executable()
        assert isinstance(result, str)
        assert len(result) > 0

    def test_caches_result(self):
        """get_git_executable should cache the result."""
        # Call twice and verify same result
        result1 = get_git_executable()
        result2 = get_git_executable()
        assert result1 == result2

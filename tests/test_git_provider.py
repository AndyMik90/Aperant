"""
Tests for Git Provider Detection Module
========================================

Tests the detect_git_provider function to ensure it correctly identifies
GitHub, GitLab (cloud and self-hosted), and unknown providers from remote URLs.
"""

import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add apps/backend directory to path for imports
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from core.git_provider import _classify_hostname, detect_git_provider


@pytest.fixture
def temp_repo_dir(tmp_path):
    """Create a temporary directory simulating a git repository."""
    repo_dir = tmp_path / "test-repo"
    repo_dir.mkdir()
    return repo_dir


class TestDetectGitProviderSSH:
    """Test git provider detection for SSH remote URLs."""

    def test_github_ssh_url(self, temp_repo_dir):
        """Test detection of GitHub SSH URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="git@github.com:user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "github"

    def test_gitlab_cloud_ssh_url(self, temp_repo_dir):
        """Test detection of GitLab cloud SSH URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="git@gitlab.com:user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "gitlab"

    def test_gitlab_self_hosted_ssh_url(self, temp_repo_dir):
        """Test detection of self-hosted GitLab SSH URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="git@gitlab.company.com:user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "gitlab"

    def test_gitlab_custom_domain_ssh_url(self, temp_repo_dir):
        """Test detection of GitLab on custom domain."""
        mock_result = MagicMock(
            returncode=0,
            stdout="git@git.example.com:user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        # Should be unknown because 'gitlab' is not in hostname
        assert provider == "unknown"

    def test_ssh_url_without_git_suffix(self, temp_repo_dir):
        """Test SSH URL without .git suffix."""
        mock_result = MagicMock(
            returncode=0,
            stdout="git@github.com:user/repo\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "github"


class TestDetectGitProviderHTTPS:
    """Test git provider detection for HTTPS remote URLs."""

    def test_github_https_url(self, temp_repo_dir):
        """Test detection of GitHub HTTPS URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="https://github.com/user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "github"

    def test_gitlab_cloud_https_url(self, temp_repo_dir):
        """Test detection of GitLab cloud HTTPS URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="https://gitlab.com/user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "gitlab"

    def test_gitlab_self_hosted_https_url(self, temp_repo_dir):
        """Test detection of self-hosted GitLab HTTPS URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="https://gitlab.enterprise.org/user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "gitlab"

    def test_http_url(self, temp_repo_dir):
        """Test detection of HTTP URL (not HTTPS)."""
        mock_result = MagicMock(
            returncode=0,
            stdout="http://github.com/user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "github"

    def test_https_url_without_git_suffix(self, temp_repo_dir):
        """Test HTTPS URL without .git suffix."""
        mock_result = MagicMock(
            returncode=0,
            stdout="https://gitlab.com/user/repo\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "gitlab"

    def test_https_url_with_port(self, temp_repo_dir):
        """Test HTTPS URL with custom port."""
        mock_result = MagicMock(
            returncode=0,
            stdout="https://gitlab.example.com:8443/user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "gitlab"


class TestDetectGitProviderEdgeCases:
    """Test edge cases and error handling."""

    def test_no_remote_configured(self, temp_repo_dir):
        """Test repository with no remote configured."""
        mock_result = MagicMock(
            returncode=128,
            stdout="",
            stderr="fatal: No such remote 'origin'",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "unknown"

    def test_empty_remote_url(self, temp_repo_dir):
        """Test repository with empty remote URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="   \n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "unknown"

    def test_malformed_ssh_url(self, temp_repo_dir):
        """Test malformed SSH URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="malformed-url-without-colon\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "unknown"

    def test_malformed_https_url(self, temp_repo_dir):
        """Test malformed HTTPS URL."""
        mock_result = MagicMock(
            returncode=0,
            stdout="https://malformed\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "unknown"

    def test_unknown_provider(self, temp_repo_dir):
        """Test unknown provider (Bitbucket)."""
        mock_result = MagicMock(
            returncode=0,
            stdout="git@bitbucket.org:user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "unknown"

    def test_subprocess_exception(self, temp_repo_dir):
        """Test handling of subprocess exceptions."""
        with patch("core.git_provider.run_git", side_effect=subprocess.SubprocessError("Failed")):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "unknown"

    def test_generic_exception(self, temp_repo_dir):
        """Test handling of generic exceptions."""
        with patch("core.git_provider.run_git", side_effect=Exception("Unexpected error")):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "unknown"

    def test_timeout_handling(self, temp_repo_dir):
        """Test handling of command timeout."""
        mock_result = MagicMock(
            returncode=-1,
            stdout="",
            stderr="Command timed out after 5 seconds",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(temp_repo_dir)

        assert provider == "unknown"


class TestDetectGitProviderPathTypes:
    """Test that function works with both string and Path objects."""

    def test_with_string_path(self):
        """Test detection with string path."""
        mock_result = MagicMock(
            returncode=0,
            stdout="git@github.com:user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider("/path/to/repo")

        assert provider == "github"

    def test_with_path_object(self):
        """Test detection with Path object."""
        mock_result = MagicMock(
            returncode=0,
            stdout="git@gitlab.com:user/repo.git\n",
        )

        with patch("core.git_provider.run_git", return_value=mock_result):
            provider = detect_git_provider(Path("/path/to/repo"))

        assert provider == "gitlab"


class TestClassifyHostname:
    """Test the _classify_hostname helper function."""

    def test_github_com(self):
        """Test classification of github.com."""
        assert _classify_hostname("github.com") == "github"

    def test_github_com_uppercase(self):
        """Test classification with uppercase (case-insensitive)."""
        assert _classify_hostname("GITHUB.COM") == "github"

    def test_github_com_mixed_case(self):
        """Test classification with mixed case."""
        assert _classify_hostname("GitHub.com") == "github"

    def test_github_keyword_in_hostname(self):
        """Test that 'github' at start of domain segment is detected."""
        # Segments starting with 'github-' are detected (e.g., GitHub Enterprise)
        assert _classify_hostname("github-enterprise.company.com") == "github"
        assert _classify_hostname("github-internal.local") == "github"
        # Embedded 'github' (not at segment start) returns unknown for security
        assert _classify_hostname("attacker-github.com") == "unknown"
        assert _classify_hostname("mygithub.dev") == "unknown"

    def test_gitlab_com(self):
        """Test classification of gitlab.com."""
        assert _classify_hostname("gitlab.com") == "gitlab"

    def test_gitlab_self_hosted_subdomain(self):
        """Test classification of GitLab self-hosted with subdomain."""
        assert _classify_hostname("gitlab.company.com") == "gitlab"

    def test_gitlab_self_hosted_main_domain(self):
        """Test classification of GitLab self-hosted as main domain."""
        assert _classify_hostname("gitlab.example.org") == "gitlab"

    def test_gitlab_with_port(self):
        """Test classification of GitLab hostname with port."""
        assert _classify_hostname("gitlab.company.com:8443") == "gitlab"

    def test_gitlab_keyword_in_hostname(self):
        """Test that 'gitlab' at start of domain segment is detected."""
        # Segments starting with 'gitlab-' are detected
        assert _classify_hostname("gitlab-server.local") == "gitlab"
        assert _classify_hostname("gitlab-internal.company.com") == "gitlab"
        # Embedded 'gitlab' (not at segment start) returns unknown for security
        assert _classify_hostname("mygitlab.dev") == "unknown"
        assert _classify_hostname("code-gitlab.enterprise") == "unknown"

    def test_bitbucket(self):
        """Test classification of Bitbucket (unknown)."""
        assert _classify_hostname("bitbucket.org") == "unknown"

    def test_custom_domain(self):
        """Test classification of custom domain without keywords."""
        assert _classify_hostname("git.example.com") == "unknown"

    def test_codeberg(self):
        """Test classification of Codeberg (unknown)."""
        assert _classify_hostname("codeberg.org") == "unknown"

    def test_sourceforge(self):
        """Test classification of SourceForge (unknown)."""
        assert _classify_hostname("sourceforge.net") == "unknown"

    def test_empty_hostname(self):
        """Test classification of empty hostname."""
        assert _classify_hostname("") == "unknown"

    def test_localhost(self):
        """Test classification of localhost."""
        assert _classify_hostname("localhost") == "unknown"

    def test_ip_address(self):
        """Test classification of IP address."""
        assert _classify_hostname("192.168.1.100") == "unknown"


class TestGitCommandIntegration:
    """Test that run_git is called with correct parameters."""

    def test_run_git_called_with_correct_args(self, temp_repo_dir):
        """Test that run_git is called with correct arguments."""
        mock_result = MagicMock(returncode=0, stdout="git@github.com:user/repo.git\n")

        with patch("core.git_provider.run_git", return_value=mock_result) as mock_run_git:
            detect_git_provider(temp_repo_dir)

            # Verify run_git was called with correct parameters
            mock_run_git.assert_called_once_with(
                ["remote", "get-url", "origin"],
                cwd=temp_repo_dir,
                timeout=5,
            )

    def test_run_git_respects_timeout(self, temp_repo_dir):
        """Test that the 5-second timeout is used."""
        mock_result = MagicMock(returncode=0, stdout="git@github.com:user/repo.git\n")

        with patch("core.git_provider.run_git", return_value=mock_result) as mock_run_git:
            detect_git_provider(temp_repo_dir)

            # Verify timeout parameter
            call_kwargs = mock_run_git.call_args[1]
            assert call_kwargs["timeout"] == 5


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

"""
Tests for Bot Detection Module
================================

Tests the GitHubBotDetector class to ensure it correctly prevents infinite loops.
"""

import json
import sys
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add the backend runners/github directory to path
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
_github_dir = _backend_dir / "runners" / "github"
if str(_github_dir) not in sys.path:
    sys.path.insert(0, str(_github_dir))

from bot_detection import BotDetectionState, BotDetector as GitHubBotDetector


@pytest.fixture
def temp_state_dir(tmp_path):
    """Create temporary state directory."""
    state_dir = tmp_path / "github"
    state_dir.mkdir()
    return state_dir


@pytest.fixture
def mock_bot_detector(temp_state_dir):
    """Create bot detector with mocked bot username."""
    with patch.object(GitHubBotDetector, "_get_bot_username", return_value="test-bot"):
        detector = GitHubBotDetector(
            state_dir=temp_state_dir,
            bot_token="fake-token",
            review_own_prs=False,
        )
        return detector


class TestBotDetectionState:
    """Test BotDetectionState data class."""

    def test_save_and_load(self, temp_state_dir):
        """Test saving and loading state."""
        state = BotDetectionState(
            reviewed_commits={
                "123": ["abc123", "def456"],
                "456": ["ghi789"],
            },
            last_review_times={
                "123": "2025-01-01T10:00:00",
                "456": "2025-01-01T11:00:00",
            },
        )

        # Save
        state.save(temp_state_dir)

        # Load
        loaded = BotDetectionState.load(temp_state_dir)

        assert loaded.reviewed_commits == state.reviewed_commits
        assert loaded.last_review_times == state.last_review_times

    def test_load_nonexistent(self, temp_state_dir):
        """Test loading when file doesn't exist."""
        loaded = BotDetectionState.load(temp_state_dir)

        assert loaded.reviewed_commits == {}
        assert loaded.last_review_times == {}


class TestGitHubBotDetectorInit:
    """Test GitHubBotDetector initialization."""

    def test_init_with_token(self, temp_state_dir):
        """Test initialization with bot token."""
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps({"login": "my-bot"}),
            )

            detector = GitHubBotDetector(
                state_dir=temp_state_dir,
                bot_token="ghp_test123",
                review_own_prs=False,
            )

            assert detector.bot_username == "my-bot"
            assert detector.review_own_prs is False

    def test_init_without_token(self, temp_state_dir):
        """Test initialization without bot token."""
        detector = GitHubBotDetector(
            state_dir=temp_state_dir,
            bot_token=None,
            review_own_prs=True,
        )

        assert detector.bot_username is None
        assert detector.review_own_prs is True


class TestBotDetection:
    """Test bot detection methods."""

    def test_is_bot_pr(self, mock_bot_detector):
        """Test detecting bot-authored PRs."""
        bot_pr = {"author": {"login": "test-bot"}}
        human_pr = {"author": {"login": "alice"}}

        assert mock_bot_detector.is_bot_pr(bot_pr) is True
        assert mock_bot_detector.is_bot_pr(human_pr) is False

    def test_is_bot_commit(self, mock_bot_detector):
        """Test detecting bot-authored commits."""
        bot_commit = {"author": {"login": "test-bot"}}
        human_commit = {"author": {"login": "alice"}}
        bot_committer = {
            "committer": {"login": "test-bot"},
            "author": {"login": "alice"},
        }

        assert mock_bot_detector.is_bot_commit(bot_commit) is True
        assert mock_bot_detector.is_bot_commit(human_commit) is False
        assert mock_bot_detector.is_bot_commit(bot_committer) is True

    def test_get_last_commit_sha(self, mock_bot_detector):
        """Test extracting last commit SHA."""
        # GitHub API returns commits in chronological order (oldest first, newest last)
        # So commits[-1] is the LATEST commit
        commits = [
            {"oid": "abc123"},  # Oldest commit
            {"oid": "def456"},  # Latest commit
        ]

        sha = mock_bot_detector.get_last_commit_sha(commits)
        assert sha == "def456"  # Should return the LAST (latest) commit

        # Test with sha field instead of oid
        commits_with_sha = [{"sha": "xyz789"}]
        sha = mock_bot_detector.get_last_commit_sha(commits_with_sha)
        assert sha == "xyz789"

        # Empty commits
        assert mock_bot_detector.get_last_commit_sha([]) is None


class TestCoolingOff:
    """Test cooling off period.

    Note: COOLING_OFF_MINUTES is currently set to 1 minute for testing large PRs.
    """

    def test_within_cooling_off(self, mock_bot_detector):
        """Test PR within cooling off period."""
        # Set last review to 30 seconds ago (within 1 minute cooling off)
        import datetime as dt
        half_min_ago = dt.datetime.now() - timedelta(seconds=30)
        mock_bot_detector.state.last_review_times["123"] = half_min_ago.isoformat()

        is_cooling, reason = mock_bot_detector.is_within_cooling_off(123)

        assert is_cooling is True
        assert "Cooling off" in reason

    def test_outside_cooling_off(self, mock_bot_detector):
        """Test PR outside cooling off period."""
        # Set last review to 2 minutes ago (outside 1 minute cooling off)
        import datetime as dt
        two_min_ago = dt.datetime.now() - timedelta(minutes=2)
        mock_bot_detector.state.last_review_times["123"] = two_min_ago.isoformat()

        is_cooling, reason = mock_bot_detector.is_within_cooling_off(123)

        assert is_cooling is False
        assert reason == ""

    def test_no_previous_review(self, mock_bot_detector):
        """Test PR with no previous review."""
        is_cooling, reason = mock_bot_detector.is_within_cooling_off(999)

        assert is_cooling is False
        assert reason == ""


class TestReviewedCommits:
    """Test reviewed commit tracking."""

    def test_has_reviewed_commit(self, mock_bot_detector):
        """Test checking if commit was reviewed."""
        mock_bot_detector.state.reviewed_commits["123"] = ["abc123", "def456"]

        assert mock_bot_detector.has_reviewed_commit(123, "abc123") is True
        assert mock_bot_detector.has_reviewed_commit(123, "xyz789") is False
        assert mock_bot_detector.has_reviewed_commit(999, "abc123") is False

    def test_mark_reviewed(self, mock_bot_detector, temp_state_dir):
        """Test marking PR as reviewed."""
        mock_bot_detector.mark_reviewed(123, "abc123")

        # Check state
        assert "123" in mock_bot_detector.state.reviewed_commits
        assert "abc123" in mock_bot_detector.state.reviewed_commits["123"]
        assert "123" in mock_bot_detector.state.last_review_times

        # Check persistence
        loaded = BotDetectionState.load(temp_state_dir)
        assert "123" in loaded.reviewed_commits
        assert "abc123" in loaded.reviewed_commits["123"]

    def test_mark_reviewed_multiple(self, mock_bot_detector):
        """Test marking same PR reviewed multiple times."""
        mock_bot_detector.mark_reviewed(123, "abc123")
        mock_bot_detector.mark_reviewed(123, "def456")

        commits = mock_bot_detector.state.reviewed_commits["123"]
        assert len(commits) == 2
        assert "abc123" in commits
        assert "def456" in commits


class TestShouldSkipReview:
    """Test main should_skip_pr_review logic."""

    def test_skip_bot_pr(self, mock_bot_detector):
        """Test skipping bot-authored PR."""
        pr_data = {"author": {"login": "test-bot"}}
        commits = [{"author": {"login": "test-bot"}, "oid": "abc123"}]

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is True
        assert "bot user" in reason

    def test_skip_bot_commit(self, mock_bot_detector):
        """Test skipping PR with bot commit as the latest commit."""
        pr_data = {"author": {"login": "alice"}}
        # GitHub API returns commits in chronological order (oldest first, newest last)
        # So commits[-1] is the LATEST commit - which is the bot commit
        commits = [
            {"author": {"login": "alice"}, "oid": "abc123"},  # Oldest commit (by alice)
            {"author": {"login": "test-bot"}, "oid": "def456"},  # Latest commit (by bot)
        ]

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is True
        assert "bot" in reason.lower()

    def test_skip_cooling_off(self, mock_bot_detector):
        """Test skipping during cooling off period."""
        # Set last review to 30 seconds ago (within 1 minute cooling off)
        import datetime as dt
        half_min_ago = dt.datetime.now() - timedelta(seconds=30)
        mock_bot_detector.state.last_review_times["123"] = half_min_ago.isoformat()

        pr_data = {"author": {"login": "alice"}}
        commits = [{"author": {"login": "alice"}, "oid": "abc123"}]

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is True
        assert "Cooling off" in reason

    def test_skip_already_reviewed(self, mock_bot_detector):
        """Test skipping already-reviewed commit."""
        mock_bot_detector.state.reviewed_commits["123"] = ["abc123"]

        pr_data = {"author": {"login": "alice"}}
        commits = [{"author": {"login": "alice"}, "oid": "abc123"}]

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is True
        assert "Already reviewed" in reason

    def test_allow_review(self, mock_bot_detector):
        """Test allowing review when all checks pass."""
        pr_data = {"author": {"login": "alice"}}
        commits = [{"author": {"login": "alice"}, "oid": "abc123"}]

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is False
        assert reason == ""

    def test_allow_review_own_prs(self, temp_state_dir):
        """Test allowing review when review_own_prs is True."""
        with patch.object(GitHubBotDetector, "_get_bot_username", return_value="test-bot"):
            detector = GitHubBotDetector(
                state_dir=temp_state_dir,
                bot_token="fake-token",
                review_own_prs=True,  # Allow bot to review own PRs
            )

        pr_data = {"author": {"login": "test-bot"}}
        commits = [{"author": {"login": "test-bot"}, "oid": "abc123"}]

        should_skip, reason = detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        # Should not skip even though it's bot's own PR
        assert should_skip is False


class TestStateManagement:
    """Test state management methods."""

    def test_clear_pr_state(self, mock_bot_detector, temp_state_dir):
        """Test clearing PR state."""
        # Set up state
        mock_bot_detector.mark_reviewed(123, "abc123")
        mock_bot_detector.mark_reviewed(456, "def456")

        # Clear one PR
        mock_bot_detector.clear_pr_state(123)

        # Check in-memory state
        assert "123" not in mock_bot_detector.state.reviewed_commits
        assert "123" not in mock_bot_detector.state.last_review_times
        assert "456" in mock_bot_detector.state.reviewed_commits

        # Check persistence
        loaded = BotDetectionState.load(temp_state_dir)
        assert "123" not in loaded.reviewed_commits
        assert "456" in loaded.reviewed_commits

    def test_get_stats(self, mock_bot_detector):
        """Test getting detector statistics."""
        mock_bot_detector.mark_reviewed(123, "abc123")
        mock_bot_detector.mark_reviewed(123, "def456")
        mock_bot_detector.mark_reviewed(456, "ghi789")

        stats = mock_bot_detector.get_stats()

        assert stats["bot_username"] == "test-bot"
        assert stats["review_own_prs"] is False
        assert stats["total_prs_tracked"] == 2
        assert stats["total_reviews_performed"] == 3
        assert stats["cooling_off_minutes"] == 1  # Currently set to 1 for testing


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_no_commits(self, mock_bot_detector):
        """Test handling PR with no commits."""
        pr_data = {"author": {"login": "alice"}}
        commits = []

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        # Should not skip (no bot commit to detect)
        assert should_skip is False

    def test_malformed_commit_data(self, mock_bot_detector):
        """Test handling malformed commit data."""
        pr_data = {"author": {"login": "alice"}}
        commits = [
            {"author": {"login": "alice"}},  # Missing oid/sha
            {},  # Empty commit
        ]

        # Should not crash
        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is False

    def test_invalid_last_review_time(self, mock_bot_detector):
        """Test handling invalid timestamp in state."""
        mock_bot_detector.state.last_review_times["123"] = "invalid-timestamp"

        is_cooling, reason = mock_bot_detector.is_within_cooling_off(123)

        # Should not crash, should return False
        assert is_cooling is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

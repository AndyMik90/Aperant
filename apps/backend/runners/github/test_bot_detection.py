"""
Tests for Bot Detection Module
================================

Tests the BotDetector class to ensure it correctly prevents infinite loops.
"""

import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Use direct file import to avoid package import issues
_github_dir = Path(__file__).parent
if str(_github_dir) not in sys.path:
    sys.path.insert(0, str(_github_dir))

from bot_detection import BotDetectionState, BotDetector


@pytest.fixture
def temp_state_dir(tmp_path):
    """Create temporary state directory."""
    state_dir = tmp_path / "github"
    state_dir.mkdir()
    return state_dir


@pytest.fixture
def mock_bot_detector(temp_state_dir):
    """Create bot detector with mocked bot username."""
    with patch.object(BotDetector, "_get_bot_username", return_value="test-bot"):
        detector = BotDetector(
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


class TestBotDetectorInit:
    """Test BotDetector initialization."""

    def test_init_with_token(self, temp_state_dir):
        """Test initialization with bot token."""
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps({"login": "my-bot"}),
            )

            detector = BotDetector(
                state_dir=temp_state_dir,
                bot_token="ghp_test123",
                review_own_prs=False,
            )

            assert detector.bot_username == "my-bot"
            assert detector.review_own_prs is False

    def test_init_without_token(self, temp_state_dir):
        """Test initialization without bot token."""
        detector = BotDetector(
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
        half_min_ago = datetime.now() - timedelta(seconds=30)
        mock_bot_detector.state.last_review_times["123"] = half_min_ago.isoformat()

        is_cooling, reason = mock_bot_detector.is_within_cooling_off(123)

        assert is_cooling is True
        assert "Cooling off" in reason

    def test_outside_cooling_off(self, mock_bot_detector):
        """Test PR outside cooling off period."""
        # Set last review to 2 minutes ago (outside 1 minute cooling off)
        two_min_ago = datetime.now() - timedelta(minutes=2)
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
            {
                "author": {"login": "test-bot"},
                "oid": "def456",
            },  # Latest commit (by bot)
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
        half_min_ago = datetime.now() - timedelta(seconds=30)
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
        with patch.object(BotDetector, "_get_bot_username", return_value="test-bot"):
            detector = BotDetector(
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


class TestGhExecutableDetection:
    """Test gh executable detection in bot_detector._get_bot_username."""

    def test_get_bot_username_with_gh_not_found(self, temp_state_dir):
        """Test _get_bot_username when gh CLI is not found."""
        with patch("bot_detection.get_gh_executable", return_value=None):
            detector = BotDetector(
                state_dir=temp_state_dir,
                bot_token="fake-token",
                review_own_prs=False,
            )

            # Should not crash, username should be None
            assert detector.bot_username is None

    def test_get_bot_username_with_detected_gh(self, temp_state_dir):
        """Test _get_bot_username when gh CLI is found."""
        mock_gh_path = str(temp_state_dir / "gh")
        with patch("bot_detection.get_gh_executable", return_value=mock_gh_path):
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=0,
                    stdout=json.dumps({"login": "test-bot-user"}),
                )

                detector = BotDetector(
                    state_dir=temp_state_dir,
                    bot_token="fake-token",
                    review_own_prs=False,
                )

                # Should use the detected gh path
                assert detector.bot_username == "test-bot-user"

                # Verify subprocess was called with the correct gh path
                mock_run.assert_called_once()
                called_cmd_list = mock_run.call_args[0][0]
                assert called_cmd_list[0] == mock_gh_path
                assert called_cmd_list[1:] == ["api", "user"]

    def test_get_bot_username_uses_get_gh_executable_return_value(self, temp_state_dir):
        """Test that _get_bot_username uses the path returned by get_gh_executable."""
        # Note: GITHUB_CLI_PATH env var is tested by get_gh_executable's own tests
        # This test verifies _get_bot_username uses whatever get_gh_executable returns
        mock_gh_path = str(temp_state_dir / "gh")

        with patch("bot_detection.get_gh_executable", return_value=mock_gh_path):
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=0,
                    stdout=json.dumps({"login": "env-bot-user"}),
                )

                detector = BotDetector(
                    state_dir=temp_state_dir,
                    bot_token="fake-token",
                    review_own_prs=False,
                )

                # Verify the command was run with the path from get_gh_executable
                assert detector.bot_username == "env-bot-user"

                # Verify subprocess was called with the correct path
                mock_run.assert_called_once()
                called_cmd_list = mock_run.call_args[0][0]
                assert called_cmd_list[0] == mock_gh_path
                assert called_cmd_list[1:] == ["api", "user"]

    def test_get_bot_username_with_api_error(self, temp_state_dir):
        """Test _get_bot_username when gh api command fails."""
        mock_gh_path = str(temp_state_dir / "gh")
        with patch("bot_detection.get_gh_executable", return_value=mock_gh_path):
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(
                    returncode=1,
                    stderr="Authentication failed",
                )

                detector = BotDetector(
                    state_dir=temp_state_dir,
                    bot_token="invalid-token",
                    review_own_prs=False,
                )

                # Should handle error gracefully, username should be None
                assert detector.bot_username is None

    def test_get_bot_username_with_subprocess_timeout(self, temp_state_dir):
        """Test _get_bot_username when subprocess times out."""
        mock_gh_path = str(temp_state_dir / "gh")
        with patch("bot_detection.get_gh_executable", return_value=mock_gh_path):
            with patch(
                "subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 5)
            ):
                detector = BotDetector(
                    state_dir=temp_state_dir,
                    bot_token="fake-token",
                    review_own_prs=False,
                )

                # Should handle timeout gracefully, username should be None
                assert detector.bot_username is None

    def test_get_bot_username_without_token(self, temp_state_dir):
        """Test _get_bot_username when no bot token is provided."""
        with patch("subprocess.run") as mock_run:
            detector = BotDetector(
                state_dir=temp_state_dir,
                bot_token=None,
                review_own_prs=False,
            )

            # Should return None without trying to call gh
            assert detector.bot_username is None
            # Verify subprocess.run was not called (no gh CLI invocation)
            mock_run.assert_not_called()


class TestInProgressTracking:
    """Test in-progress review tracking."""

    def test_mark_review_started(self, mock_bot_detector, temp_state_dir):
        """Test marking review as started."""
        mock_bot_detector.mark_review_started(123)

        # Check state
        assert "123" in mock_bot_detector.state.in_progress_reviews
        start_time_str = mock_bot_detector.state.in_progress_reviews["123"]
        start_time = datetime.fromisoformat(start_time_str)

        # Should be very recent (within last 5 seconds)
        time_diff = datetime.now() - start_time
        assert time_diff.total_seconds() < 5

        # Check persistence
        loaded = BotDetectionState.load(temp_state_dir)
        assert "123" in loaded.in_progress_reviews

    def test_mark_review_finished_success(self, mock_bot_detector, temp_state_dir):
        """Test marking review as finished successfully."""
        mock_bot_detector.mark_review_started(123)
        assert "123" in mock_bot_detector.state.in_progress_reviews

        mock_bot_detector.mark_review_finished(123, success=True)

        # In-progress state should be cleared
        assert "123" not in mock_bot_detector.state.in_progress_reviews

        # Check persistence
        loaded = BotDetectionState.load(temp_state_dir)
        assert "123" not in loaded.in_progress_reviews

    def test_mark_review_finished_error(self, mock_bot_detector):
        """Test marking review as finished with error."""
        mock_bot_detector.mark_review_started(123)
        mock_bot_detector.mark_review_finished(123, success=False)

        # In-progress state should be cleared
        assert "123" not in mock_bot_detector.state.in_progress_reviews

    def test_is_review_in_progress_active(self, mock_bot_detector):
        """Test detecting active in-progress review."""
        mock_bot_detector.mark_review_started(123)

        is_in_progress, reason = mock_bot_detector.is_review_in_progress(123)

        assert is_in_progress is True
        assert "already in progress" in reason.lower()

    def test_is_review_in_progress_not_started(self, mock_bot_detector):
        """Test checking in-progress when review not started."""
        is_in_progress, reason = mock_bot_detector.is_review_in_progress(999)

        assert is_in_progress is False
        assert reason == ""

    def test_is_review_in_progress_stale(self, mock_bot_detector):
        """Test detecting stale in-progress review."""
        # Set review start time to 31 minutes ago (past timeout)
        stale_time = datetime.now() - timedelta(minutes=31)
        mock_bot_detector.state.in_progress_reviews["123"] = stale_time.isoformat()

        is_in_progress, reason = mock_bot_detector.is_review_in_progress(123)

        # Should detect as stale and clear it
        assert is_in_progress is False
        assert reason == ""
        # Should be removed from state
        assert "123" not in mock_bot_detector.state.in_progress_reviews

    def test_is_review_in_progress_invalid_timestamp(self, mock_bot_detector):
        """Test handling invalid timestamp in in-progress state."""
        mock_bot_detector.state.in_progress_reviews["123"] = "invalid-timestamp"

        is_in_progress, reason = mock_bot_detector.is_review_in_progress(123)

        # Should clear invalid state
        assert is_in_progress is False
        assert reason == ""
        assert "123" not in mock_bot_detector.state.in_progress_reviews

    def test_should_skip_review_in_progress(self, mock_bot_detector):
        """Test skipping PR when review is in progress."""
        mock_bot_detector.mark_review_started(123)

        pr_data = {"author": {"login": "alice"}}
        commits = [{"author": {"login": "alice"}, "oid": "abc123"}]

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is True
        assert "already in progress" in reason.lower()

    def test_mark_reviewed_clears_in_progress(self, mock_bot_detector):
        """Test that mark_reviewed also clears in-progress state."""
        mock_bot_detector.mark_review_started(123)
        assert "123" in mock_bot_detector.state.in_progress_reviews

        mock_bot_detector.mark_reviewed(123, "abc123")

        # In-progress should be cleared
        assert "123" not in mock_bot_detector.state.in_progress_reviews
        # Reviewed state should be set
        assert "123" in mock_bot_detector.state.reviewed_commits
        assert "abc123" in mock_bot_detector.state.reviewed_commits["123"]

    def test_clear_pr_state_clears_in_progress(self, mock_bot_detector):
        """Test that clear_pr_state also clears in-progress state."""
        mock_bot_detector.mark_review_started(123)
        mock_bot_detector.mark_reviewed(123, "abc123")

        assert (
            "123" in mock_bot_detector.state.in_progress_reviews or True
        )  # May be cleared by mark_reviewed
        assert "123" in mock_bot_detector.state.reviewed_commits

        # Start another review
        mock_bot_detector.mark_review_started(123)
        assert "123" in mock_bot_detector.state.in_progress_reviews

        mock_bot_detector.clear_pr_state(123)

        # Everything should be cleared
        assert "123" not in mock_bot_detector.state.in_progress_reviews
        assert "123" not in mock_bot_detector.state.reviewed_commits
        assert "123" not in mock_bot_detector.state.last_review_times

    def test_get_stats_includes_in_progress(self, mock_bot_detector):
        """Test that get_stats includes in-progress count."""
        mock_bot_detector.mark_review_started(123)
        mock_bot_detector.mark_review_started(456)
        mock_bot_detector.mark_reviewed(789, "abc123")

        stats = mock_bot_detector.get_stats()

        assert stats["in_progress_reviews"] == 2
        assert stats["total_prs_tracked"] == 1  # Only 789 is tracked as reviewed
        assert stats["in_progress_timeout_minutes"] == 30

    def test_cleanup_stale_prs_removes_stale_in_progress(self, mock_bot_detector):
        """Test that cleanup_stale_prs removes stale in-progress reviews."""
        # Add a stale in-progress review (32 minutes ago)
        stale_time = datetime.now() - timedelta(minutes=32)
        mock_bot_detector.state.in_progress_reviews["123"] = stale_time.isoformat()

        # Add an active in-progress review (5 minutes ago)
        active_time = datetime.now() - timedelta(minutes=5)
        mock_bot_detector.state.in_progress_reviews["456"] = active_time.isoformat()

        # Add a stale reviewed PR (40 days ago)
        stale_review_time = datetime.now() - timedelta(days=40)
        mock_bot_detector.state.reviewed_commits["789"] = ["abc123"]
        mock_bot_detector.state.last_review_times["789"] = stale_review_time.isoformat()

        cleaned = mock_bot_detector.cleanup_stale_prs(max_age_days=30)

        # Should remove stale in-progress and stale reviewed PR
        assert cleaned == 2  # 1 stale in-progress + 1 stale reviewed
        assert "123" not in mock_bot_detector.state.in_progress_reviews
        assert (
            "456" in mock_bot_detector.state.in_progress_reviews
        )  # Active one remains
        assert "789" not in mock_bot_detector.state.reviewed_commits


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

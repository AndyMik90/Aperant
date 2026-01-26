"""
GitLab Bot Detection Tests
==========================

Tests for bot detection to prevent infinite review loops.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest
from __tests__.fixtures.gitlab import (
    MOCK_GITLAB_CONFIG,
    mock_mr_data,
)


class TestBotDetector:
    """Test bot detection prevents infinite loops."""

    @pytest.fixture
    def detector(self, tmp_path):
        """Create a BotDetector instance for testing."""
        from runners.gitlab.bot_detection import BotDetector

        return BotDetector(
            state_dir=tmp_path,
            bot_username="auto-claude-bot",
            review_own_mrs=False,
        )

    def test_bot_detection_init(self, detector):
        """Test detector initializes correctly."""
        assert detector.bot_username == "auto-claude-bot"
        assert detector.review_own_mrs is False
        assert detector.state.reviewed_commits == {}

    def test_is_bot_mr_self_authored(self, detector):
        """Test MR authored by bot is detected."""
        mr_data = mock_mr_data(author="auto-claude-bot")

        assert detector.is_bot_mr(mr_data) is True

    def test_is_bot_mr_pattern_match(self, detector):
        """Test MR with bot pattern in username is detected."""
        mr_data = mock_mr_data(author="coderabbit[bot]")

        assert detector.is_bot_mr(mr_data) is True

    def test_is_bot_mr_human_authored(self, detector):
        """Test MR authored by human is not detected as bot."""
        mr_data = mock_mr_data(author="john_doe")

        assert detector.is_bot_mr(mr_data) is False

    def test_is_bot_commit_self_authored(self, detector):
        """Test commit by bot is detected."""
        commit = {
            "author": {"username": "auto-claude-bot"},
            "message": "Fix issue",
        }

        assert detector.is_bot_commit(commit) is True

    def test_is_bot_commit_ai_coauthored(self, detector):
        """Test commit with AI co-authorship is detected."""
        commit = {
            "author": {"username": "human"},
            "message": "Co-authored-by: claude <no-reply>",
        }

        assert detector.is_bot_commit(commit) is True

    def test_is_bot_commit_human(self, detector):
        """Test human commit is not detected as bot."""
        commit = {
            "author": {"username": "john_doe"},
            "message": "Fix bug",
        }

        assert detector.is_bot_commit(commit) is False

    def test_should_skip_mr_bot_authored(self, detector):
        """Test should skip MR when bot authored."""
        mr_data = mock_mr_data(author="auto-claude-bot")
        commits = []

        should_skip, reason = detector.should_skip_mr_review(123, mr_data, commits)

        assert should_skip is True
        assert "auto-claude-bot" in reason.lower()

    def test_should_skip_mr_in_cooling_off(self, detector):
        """Test should skip MR when in cooling off period."""
        # First, mark as reviewed
        detector.mark_reviewed(123, "abc123")

        # Immediately try to review again
        mr_data = mock_mr_data()
        commits = [{"id": "abc123", "sha": "abc123"}]

        should_skip, reason = detector.should_skip_mr_review(123, mr_data, commits)

        assert should_skip is True
        assert "cooling" in reason.lower()

    def test_should_skip_mr_already_reviewed(self, detector):
        """Test should skip MR when commit already reviewed."""
        # Mark as reviewed
        detector.mark_reviewed(123, "abc123")

        # Try to review same commit
        mr_data = mock_mr_data()
        commits = [{"id": "abc123", "sha": "abc123"}]

        # Wait past cooling off (manually update time)
        detector.state.last_review_times["123"] = (
            datetime.now(timezone.utc) - timedelta(minutes=10)
        ).isoformat()

        should_skip, reason = detector.should_skip_mr_review(123, mr_data, commits)

        assert should_skip is True
        assert "already reviewed" in reason.lower()

    def test_should_not_skip_safe_mr(self, detector):
        """Test should not skip when MR is safe to review."""
        mr_data = mock_mr_data()
        commits = [{"id": "new123", "sha": "new123"}]

        should_skip, reason = detector.should_skip_mr_review(456, mr_data, commits)

        assert should_skip is False
        assert reason == ""

    def test_mark_reviewed(self, detector):
        """Test marking MR as reviewed."""
        detector.mark_reviewed(123, "abc123")

        assert "123" in detector.state.reviewed_commits
        assert "abc123" in detector.state.reviewed_commits["123"]
        assert "123" in detector.state.last_review_times

    def test_mark_reviewed_multiple_commits(self, detector):
        """Test marking multiple commits for same MR."""
        detector.mark_reviewed(123, "commit1")
        detector.mark_reviewed(123, "commit2")
        detector.mark_reviewed(123, "commit3")

        assert len(detector.state.reviewed_commits["123"]) == 3

    def test_clear_mr_state(self, detector):
        """Test clearing MR state."""
        detector.mark_reviewed(123, "abc123")
        detector.clear_mr_state(123)

        assert "123" not in detector.state.reviewed_commits
        assert "123" not in detector.state.last_review_times

    def test_get_stats(self, detector):
        """Test getting detector statistics."""
        detector.mark_reviewed(123, "abc123")
        detector.mark_reviewed(124, "def456")

        stats = detector.get_stats()

        assert stats["bot_username"] == "auto-claude-bot"
        assert stats["total_mrs_tracked"] == 2
        assert stats["total_reviews_performed"] == 2

    def test_cleanup_stale_mrs(self, detector):
        """Test cleanup of old MR state."""
        # Add an old MR (manually set old timestamp)
        old_time = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
        detector.state.last_review_times["999"] = old_time
        detector.state.reviewed_commits["999"] = ["old123"]

        # Add a recent MR
        detector.mark_reviewed(123, "abc123")

        cleaned = detector.cleanup_stale_mrs(max_age_days=30)

        assert cleaned == 1
        assert "999" not in detector.state.reviewed_commits
        assert "123" in detector.state.reviewed_commits

    def test_state_persistence(self, tmp_path):
        """Test state is saved and loaded correctly."""
        from runners.gitlab.bot_detection import BotDetector

        # Create detector and mark as reviewed
        detector1 = BotDetector(
            state_dir=tmp_path,
            bot_username="test-bot",
        )
        detector1.mark_reviewed(123, "abc123")

        # Create new detector instance (should load state)
        detector2 = BotDetector(
            state_dir=tmp_path,
            bot_username="test-bot",
        )

        assert "123" in detector2.state.reviewed_commits
        assert "abc123" in detector2.state.reviewed_commits["123"]


class TestBotDetectionState:
    """Test BotDetectionState model."""

    def test_to_dict(self):
        """Test converting state to dictionary."""
        from runners.gitlab.bot_detection import BotDetectionState

        state = BotDetectionState(
            reviewed_commits={"123": ["abc123", "def456"]},
            last_review_times={"123": "2025-01-14T10:00:00"},
        )

        data = state.to_dict()

        assert data["reviewed_commits"]["123"] == ["abc123", "def456"]

    def test_from_dict(self):
        """Test loading state from dictionary."""
        from runners.gitlab.bot_detection import BotDetectionState

        data = {
            "reviewed_commits": {"123": ["abc123"]},
            "last_review_times": {"123": "2025-01-14T10:00:00"},
        }

        state = BotDetectionState.from_dict(data)

        assert state.reviewed_commits["123"] == ["abc123"]
        assert state.last_review_times["123"] == "2025-01-14T10:00:00"

    def test_save_and_load(self, tmp_path):
        """Test saving and loading state from disk."""
        from runners.gitlab.bot_detection import BotDetectionState

        state = BotDetectionState(
            reviewed_commits={"123": ["abc123"]},
            last_review_times={"123": "2025-01-14T10:00:00"},
        )

        state.save(tmp_path)

        loaded = BotDetectionState.load(tmp_path)

        assert loaded.reviewed_commits["123"] == ["abc123"]

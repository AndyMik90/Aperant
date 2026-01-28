#!/usr/bin/env python3
"""
Tests for Review Feedback System
=================================

Tests for ReviewState feedback functionality:
- Adding feedback with timestamps
- Feedback accumulation across sessions
- Feedback persistence
"""

from pathlib import Path

import pytest
from review import ReviewState

from tests.review_fixtures import complete_spec_dir, review_spec_dir


class TestReviewStateFeedback:
    """Tests for feedback functionality."""

    def test_add_feedback(self, tmp_path: Path) -> None:
        """add_feedback() adds timestamped feedback."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        state = ReviewState()
        state.add_feedback("Great work!", spec_dir, auto_save=False)

        assert len(state.feedback) == 1
        # Should have timestamp prefix
        assert "]" in state.feedback[0]
        assert "Great work!" in state.feedback[0]

    def test_add_multiple_feedback(self, tmp_path: Path) -> None:
        """add_feedback() accumulates feedback."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        state = ReviewState()
        state.add_feedback("First comment", spec_dir, auto_save=False)
        state.add_feedback("Second comment", spec_dir, auto_save=False)

        assert len(state.feedback) == 2
        assert "First comment" in state.feedback[0]
        assert "Second comment" in state.feedback[1]

    def test_add_feedback_auto_saves(self, tmp_path: Path) -> None:
        """add_feedback() saves when auto_save=True."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        state = ReviewState()
        state.add_feedback("Saved feedback", spec_dir, auto_save=True)

        loaded = ReviewState.load(spec_dir)
        assert len(loaded.feedback) == 1
        assert "Saved feedback" in loaded.feedback[0]

    def test_feedback_persistence_across_sessions(self, complete_spec_dir: Path) -> None:
        """Test that feedback is preserved across review sessions."""
        # First session - add feedback
        state1 = ReviewState()
        state1.add_feedback("First review comment", complete_spec_dir)
        state1.add_feedback("Another observation", complete_spec_dir)

        # Simulate new session
        state2 = ReviewState.load(complete_spec_dir)
        assert len(state2.feedback) == 2
        assert "First review comment" in state2.feedback[0]
        assert "Another observation" in state2.feedback[1]

        # Add more feedback in second session
        state2.add_feedback("Follow-up from second review", complete_spec_dir)

        # Third session - verify all feedback
        state3 = ReviewState.load(complete_spec_dir)
        assert len(state3.feedback) == 3

    def test_full_approval_flow_with_feedback(self, review_spec_dir: Path) -> None:
        """Test complete approval flow with feedback."""
        # 1. Initially not approved
        state = ReviewState.load(review_spec_dir)
        assert not state.is_approved()

        # 2. Add feedback
        state.add_feedback("Needs minor changes", review_spec_dir)

        # 3. Approve
        state.approve(review_spec_dir, approved_by="reviewer")

        # 4. Verify state
        assert state.is_approved()
        assert state.is_approval_valid(review_spec_dir)

        # 5. Reload and verify persisted
        reloaded = ReviewState.load(review_spec_dir)
        assert reloaded.is_approved()
        assert reloaded.approved_by == "reviewer"
        assert len(reloaded.feedback) == 1

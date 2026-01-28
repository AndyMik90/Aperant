#!/usr/bin/env python3
"""
Tests for Review Approval Workflows
====================================

Tests for ReviewState approval and rejection methods:
- approve() and is_approved()
- reject() and invalidate()
- Review count tracking
- Auto-save functionality
"""

from pathlib import Path
from unittest.mock import patch

import pytest
from review import REVIEW_STATE_FILE, ReviewState

from tests.review_fixtures import approved_state, pending_state, review_spec_dir


class TestReviewStateApproval:
    """Tests for approve(), reject(), and related methods."""

    def test_is_approved_true(self, approved_state: ReviewState) -> None:
        """is_approved() returns True for approved state."""
        assert approved_state.is_approved() is True

    def test_is_approved_false(self, pending_state: ReviewState) -> None:
        """is_approved() returns False for pending state."""
        assert pending_state.is_approved() is False

    def test_approve_sets_fields(self, review_spec_dir: Path) -> None:
        """approve() sets all required fields correctly."""
        state = ReviewState()

        # Freeze time for consistent testing
        with patch("review.state.datetime") as mock_datetime:
            mock_datetime.now.return_value.isoformat.return_value = "2024-07-01T10:00:00"
            state.approve(review_spec_dir, approved_by="approver")

        assert state.approved is True
        assert state.approved_by == "approver"
        assert state.approved_at == "2024-07-01T10:00:00"
        assert state.spec_hash != ""  # Hash should be computed
        assert state.review_count == 1

    def test_approve_increments_review_count(self, review_spec_dir: Path) -> None:
        """approve() increments review_count each time."""
        state = ReviewState(review_count=3)

        state.approve(review_spec_dir, approved_by="user", auto_save=False)

        assert state.review_count == 4

    def test_approve_auto_saves(self, review_spec_dir: Path) -> None:
        """approve() saves state when auto_save=True (default)."""
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="user")

        state_file = review_spec_dir / REVIEW_STATE_FILE
        assert state_file.exists()

        loaded = ReviewState.load(review_spec_dir)
        assert loaded.approved is True

    def test_approve_no_auto_save(self, review_spec_dir: Path) -> None:
        """approve() doesn't save when auto_save=False."""
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="user", auto_save=False)

        state_file = review_spec_dir / REVIEW_STATE_FILE
        assert not state_file.exists()

    def test_reject_clears_approval(self, review_spec_dir: Path) -> None:
        """reject() clears approval fields."""
        state = ReviewState(
            approved=True,
            approved_by="old_user",
            approved_at="2024-01-01T00:00:00",
            spec_hash="old_hash",
            review_count=5,
        )

        state.reject(review_spec_dir, auto_save=False)

        assert state.approved is False
        assert state.approved_by == ""
        assert state.approved_at == ""
        assert state.spec_hash == ""
        assert state.review_count == 6  # Still incremented

    def test_invalidate_keeps_feedback(self, review_spec_dir: Path) -> None:
        """invalidate() keeps feedback history."""
        state = ReviewState(
            approved=True,
            approved_by="user",
            feedback=["Important feedback"],
            spec_hash="hash",
        )

        state.invalidate(review_spec_dir, auto_save=False)

        assert state.approved is False
        assert state.spec_hash == ""
        assert state.feedback == ["Important feedback"]  # Preserved
        assert state.approved_by == "user"  # Kept as history

    def test_multiple_review_sessions(self, review_spec_dir: Path) -> None:
        """Test multiple review sessions increment count correctly."""
        state = ReviewState()
        assert state.review_count == 0

        # First review - approve
        state.approve(review_spec_dir, approved_by="user1")
        assert state.review_count == 1

        # Modify spec to invalidate
        (review_spec_dir / "spec.md").write_text("Changed content")
        state.invalidate(review_spec_dir)

        # Second review - reject
        state.reject(review_spec_dir)
        assert state.review_count == 2

        # Third review - approve again
        state.approve(review_spec_dir, approved_by="user2")
        assert state.review_count == 3

    def test_auto_approve_workflow(self, review_spec_dir: Path) -> None:
        """Test the auto-approve workflow (--auto-approve flag)."""
        # Simulate spec_runner.py with --auto-approve
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="auto")

        assert state.is_approved()
        assert state.approved_by == "auto"
        assert state.is_approval_valid(review_spec_dir)

        # Verify state file
        loaded = ReviewState.load(review_spec_dir)
        assert loaded.approved_by == "auto"

    def test_rejection_preserves_history(self, review_spec_dir: Path) -> None:
        """Test that rejection properly clears approval but preserves feedback."""
        # Initial approval with feedback
        state = ReviewState()
        state.add_feedback("Looks good initially", review_spec_dir, auto_save=False)
        state.approve(review_spec_dir, approved_by="first_reviewer")

        original_feedback = state.feedback.copy()
        assert state.is_approved()

        # Reject
        state.reject(review_spec_dir)

        assert not state.is_approved()
        assert not state.is_approval_valid(review_spec_dir)
        assert state.approved_by == ""  # Cleared
        assert state.approved_at == ""  # Cleared
        assert state.spec_hash == ""  # Cleared
        assert state.feedback == original_feedback  # Preserved
        assert state.review_count == 2  # Incremented

    def test_invalidate_vs_reject_difference(self, review_spec_dir: Path) -> None:
        """
        Test the difference between invalidate() and reject().

        invalidate() - Used when spec changes; keeps approved_by as history
        reject() - User explicitly rejects; clears all approval info
        """
        # Setup: Approved state
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="original_approver")
        state.add_feedback("Initial feedback", review_spec_dir, auto_save=False)

        # Test invalidate() - keeps history
        state_for_invalidate = ReviewState.from_dict(state.to_dict())
        state_for_invalidate.invalidate(review_spec_dir, auto_save=False)

        assert not state_for_invalidate.approved
        assert state_for_invalidate.approved_by == "original_approver"  # Kept as history
        assert state_for_invalidate.approved_at == ""  # Cleared
        assert state_for_invalidate.spec_hash == ""  # Cleared
        assert len(state_for_invalidate.feedback) == 1  # Preserved

        # Test reject() - clears everything
        state_for_reject = ReviewState.from_dict(state.to_dict())
        state_for_reject.reject(review_spec_dir, auto_save=False)

        assert not state_for_reject.approved
        assert state_for_reject.approved_by == ""  # Cleared
        assert state_for_reject.approved_at == ""  # Cleared
        assert state_for_reject.spec_hash == ""  # Cleared
        assert len(state_for_reject.feedback) == 1  # Preserved

    def test_review_count_tracks_all_interactions(self, review_spec_dir: Path) -> None:
        """Test that review_count accurately tracks user interactions."""
        state = ReviewState()
        assert state.review_count == 0

        # Approve
        state.approve(review_spec_dir, approved_by="user")
        assert state.review_count == 1

        # Invalidate (spec changed)
        state.invalidate(review_spec_dir)
        # Note: invalidate doesn't increment review_count

        # Re-approve
        state.approve(review_spec_dir, approved_by="user")
        assert state.review_count == 2

        # Reject
        state.reject(review_spec_dir)
        assert state.review_count == 3

        # Approve again
        state.approve(review_spec_dir, approved_by="user")
        assert state.review_count == 4

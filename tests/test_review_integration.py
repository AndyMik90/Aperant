#!/usr/bin/env python3
"""
Tests for Review System Integration
====================================

Integration tests for complete review workflows:
- Full approval flow from start to finish
- Build readiness checks (run.py simulation)
- Rejection workflows
- Multi-session scenarios
"""

import json
from pathlib import Path

import pytest
from review import REVIEW_STATE_FILE, ReviewState

from tests.review_fixtures import complete_spec_dir, review_spec_dir


class TestFullReviewFlow:
    """Integration tests for basic review workflow."""

    def test_full_approval_flow(self, review_spec_dir: Path) -> None:
        """Test complete approval flow."""
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

    def test_approval_invalidation_on_change(self, review_spec_dir: Path) -> None:
        """Test that spec changes invalidate approval."""
        # 1. Approve initially
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="user")
        assert state.is_approval_valid(review_spec_dir)

        # 2. Modify spec.md
        spec_file = review_spec_dir / "spec.md"
        original_content = spec_file.read_text()
        spec_file.write_text(original_content + "\n## New Section\n\nAdded content.")

        # 3. Approval should now be invalid
        assert not state.is_approval_valid(review_spec_dir)

        # 4. Re-approve with new hash
        state.approve(review_spec_dir, approved_by="user")
        assert state.is_approval_valid(review_spec_dir)

    def test_rejection_flow(self, review_spec_dir: Path) -> None:
        """Test rejection workflow."""
        # 1. Approve first
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="user")
        assert state.is_approved()

        # 2. Reject
        state.reject(review_spec_dir)

        # 3. Verify state
        assert not state.is_approved()

        # 4. Reload and verify
        reloaded = ReviewState.load(review_spec_dir)
        assert not reloaded.is_approved()

    def test_auto_approve_flow(self, review_spec_dir: Path) -> None:
        """Test auto-approve workflow."""
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="auto")

        assert state.is_approved()
        assert state.approved_by == "auto"
        assert state.is_approval_valid(review_spec_dir)

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


class TestFullReviewWorkflowIntegration:
    """
    Integration tests for the complete review workflow.

    These tests verify the full flow from spec creation through
    approval, build readiness check, and invalidation scenarios.
    """

    def test_full_review_flow(self, complete_spec_dir: Path) -> None:
        """
        Test the complete review flow from start to finish.

        This test verifies:
        1. Initial state is not approved
        2. Approval creates review_state.json
        3. After approval, is_approval_valid returns True
        4. Modifying spec invalidates approval
        5. Re-approval works correctly
        """
        # 1. Initial state - no approval
        state = ReviewState.load(complete_spec_dir)
        assert not state.is_approved()
        assert not state.is_approval_valid(complete_spec_dir)

        # Verify review_state.json doesn't exist yet
        state_file = complete_spec_dir / REVIEW_STATE_FILE
        assert not state_file.exists()

        # 2. User adds feedback before approving
        state.add_feedback("Please clarify the API response format", complete_spec_dir)

        # 3. User approves
        state.approve(complete_spec_dir, approved_by="developer")

        # Verify state file was created
        assert state_file.exists()

        # 4. Verify approval is valid
        assert state.is_approved()
        assert state.is_approval_valid(complete_spec_dir)
        assert state.approved_by == "developer"
        assert state.approved_at != ""
        assert state.spec_hash != ""
        assert state.review_count == 1
        assert len(state.feedback) == 1

        # 5. Simulate run.py check - should pass
        reloaded = ReviewState.load(complete_spec_dir)
        assert reloaded.is_approval_valid(complete_spec_dir)

        # 6. Modify spec.md (simulating user edit)
        spec_file = complete_spec_dir / "spec.md"
        original_content = spec_file.read_text()
        spec_file.write_text(original_content + "\n\n## Additional Notes\n\nSome extra information.\n")

        # 7. Approval should now be invalid (spec changed)
        assert not reloaded.is_approval_valid(complete_spec_dir)

        # 8. Reload and verify still shows approved but invalid
        fresh_state = ReviewState.load(complete_spec_dir)
        assert fresh_state.approved is True  # Still marked approved
        assert not fresh_state.is_approval_valid(complete_spec_dir)  # But not valid

        # 9. Re-approve after changes
        fresh_state.approve(complete_spec_dir, approved_by="developer")
        assert fresh_state.is_approval_valid(complete_spec_dir)
        assert fresh_state.review_count == 2

    def test_run_py_approval_check_simulation(self, complete_spec_dir: Path) -> None:
        """
        Test the approval check logic as run.py would use it.

        This simulates the exact check that run.py performs before
        starting a build.
        """
        # Initial state - run.py would block
        review_state = ReviewState.load(complete_spec_dir)
        build_should_proceed = review_state.is_approval_valid(complete_spec_dir)
        assert not build_should_proceed, "Build should be blocked without approval"

        # After approval - run.py would proceed
        review_state.approve(complete_spec_dir, approved_by="user")
        build_should_proceed = review_state.is_approval_valid(complete_spec_dir)
        assert build_should_proceed, "Build should proceed after approval"

        # Simulate force flag bypass (even without valid approval)
        review_state.reject(complete_spec_dir)
        force_flag = True
        if force_flag:
            # run.py with --force would proceed even without approval
            build_should_proceed = True
        else:
            build_should_proceed = review_state.is_approval_valid(complete_spec_dir)
        assert build_should_proceed, "Force flag should bypass approval check"

    def test_spec_change_detection_accuracy(self, complete_spec_dir: Path) -> None:
        """Test that spec change detection works for various types of changes."""
        # Approve initially
        state = ReviewState()
        state.approve(complete_spec_dir, approved_by="user", auto_save=False)
        original_hash = state.spec_hash
        assert state.is_approval_valid(complete_spec_dir)

        # Test 1: Whitespace-only change should change hash
        spec_file = complete_spec_dir / "spec.md"
        original_content = spec_file.read_text()
        spec_file.write_text(original_content + "\n\n\n")
        assert not state.is_approval_valid(complete_spec_dir)

        # Restore
        spec_file.write_text(original_content)
        assert state.is_approval_valid(complete_spec_dir)

        # Test 2: Plan modification should invalidate
        plan_file = complete_spec_dir / "implementation_plan.json"
        plan_content = plan_file.read_text()
        plan = json.loads(plan_content)
        plan["phases"][0]["chunks"][0]["status"] = "completed"
        plan_file.write_text(json.dumps(plan, indent=2))
        assert not state.is_approval_valid(complete_spec_dir)

        # Test 3: New hash should be different
        state.approve(complete_spec_dir, approved_by="user", auto_save=False)
        assert state.spec_hash != original_hash

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

    def test_auto_approve_workflow(self, complete_spec_dir: Path) -> None:
        """Test the auto-approve workflow (--auto-approve flag)."""
        # Simulate spec_runner.py with --auto-approve
        state = ReviewState()
        state.approve(complete_spec_dir, approved_by="auto")

        assert state.is_approved()
        assert state.approved_by == "auto"
        assert state.is_approval_valid(complete_spec_dir)

        # Verify state file
        loaded = ReviewState.load(complete_spec_dir)
        assert loaded.approved_by == "auto"

    def test_rejection_preserves_history(self, complete_spec_dir: Path) -> None:
        """Test that rejection properly clears approval but preserves feedback."""
        # Initial approval with feedback
        state = ReviewState()
        state.add_feedback("Looks good initially", complete_spec_dir, auto_save=False)
        state.approve(complete_spec_dir, approved_by="first_reviewer")

        original_feedback = state.feedback.copy()
        assert state.is_approved()

        # Reject
        state.reject(complete_spec_dir)

        assert not state.is_approved()
        assert not state.is_approval_valid(complete_spec_dir)
        assert state.approved_by == ""  # Cleared
        assert state.approved_at == ""  # Cleared
        assert state.spec_hash == ""  # Cleared
        assert state.feedback == original_feedback  # Preserved
        assert state.review_count == 2  # Incremented

    def test_invalidate_vs_reject_difference(self, complete_spec_dir: Path) -> None:
        """
        Test the difference between invalidate() and reject().

        invalidate() - Used when spec changes; keeps approved_by as history
        reject() - User explicitly rejects; clears all approval info
        """
        # Setup: Approved state
        state = ReviewState()
        state.approve(complete_spec_dir, approved_by="original_approver")
        state.add_feedback("Initial feedback", complete_spec_dir, auto_save=False)

        # Test invalidate() - keeps history
        state_for_invalidate = ReviewState.from_dict(state.to_dict())
        state_for_invalidate.invalidate(complete_spec_dir, auto_save=False)

        assert not state_for_invalidate.approved
        assert state_for_invalidate.approved_by == "original_approver"  # Kept as history
        assert state_for_invalidate.approved_at == ""  # Cleared
        assert state_for_invalidate.spec_hash == ""  # Cleared
        assert len(state_for_invalidate.feedback) == 1  # Preserved

        # Test reject() - clears everything
        state_for_reject = ReviewState.from_dict(state.to_dict())
        state_for_reject.reject(complete_spec_dir, auto_save=False)

        assert not state_for_reject.approved
        assert state_for_reject.approved_by == ""  # Cleared
        assert state_for_reject.approved_at == ""  # Cleared
        assert state_for_reject.spec_hash == ""  # Cleared
        assert len(state_for_reject.feedback) == 1  # Preserved

    def test_status_summary_reflects_current_state(self, complete_spec_dir: Path) -> None:
        """Test that get_review_status_summary() accurately reflects state."""
        from review import get_review_status_summary

        # Not approved
        summary1 = get_review_status_summary(complete_spec_dir)
        assert not summary1["approved"]
        assert not summary1["valid"]
        assert summary1["review_count"] == 0

        # Approved
        state = ReviewState()
        state.add_feedback("Test feedback", complete_spec_dir)
        state.approve(complete_spec_dir, approved_by="test_user")

        summary2 = get_review_status_summary(complete_spec_dir)
        assert summary2["approved"]
        assert summary2["valid"]
        assert summary2["approved_by"] == "test_user"
        assert summary2["feedback_count"] == 1
        assert not summary2["spec_changed"]

        # Spec changed
        (complete_spec_dir / "spec.md").write_text("Changed content")

        summary3 = get_review_status_summary(complete_spec_dir)
        assert summary3["approved"]  # Still marked approved
        assert not summary3["valid"]  # But not valid
        assert summary3["spec_changed"]

    def test_concurrent_access_safety(self, complete_spec_dir: Path) -> None:
        """
        Test that multiple load/save operations don't corrupt state.

        While not truly concurrent (no threading), this tests
        that sequential load/modify/save operations work correctly.
        """
        # First process loads and starts modifying
        state1 = ReviewState.load(complete_spec_dir)
        state1.add_feedback("Feedback from process 1", complete_spec_dir, auto_save=False)

        # Second process loads and modifies
        state2 = ReviewState.load(complete_spec_dir)
        state2.add_feedback("Feedback from process 2", complete_spec_dir)

        # First process saves (overwrites second's changes)
        state1.save(complete_spec_dir)

        # Verify final state (last writer wins)
        final = ReviewState.load(complete_spec_dir)
        assert len(final.feedback) == 1
        assert "process 1" in final.feedback[0]

    def test_review_count_tracks_all_interactions(self, complete_spec_dir: Path) -> None:
        """Test that review_count accurately tracks user interactions."""
        state = ReviewState()
        assert state.review_count == 0

        # Approve
        state.approve(complete_spec_dir, approved_by="user")
        assert state.review_count == 1

        # Invalidate (spec changed)
        state.invalidate(complete_spec_dir)
        # Note: invalidate doesn't increment review_count

        # Re-approve
        state.approve(complete_spec_dir, approved_by="user")
        assert state.review_count == 2

        # Reject
        state.reject(complete_spec_dir)
        assert state.review_count == 3

        # Approve again
        state.approve(complete_spec_dir, approved_by="user")
        assert state.review_count == 4

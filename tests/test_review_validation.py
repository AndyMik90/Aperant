#!/usr/bin/env python3
"""
Tests for Spec Hash Validation
===============================

Tests for hash computation and spec change detection:
- File hash computation
- Spec hash computation (spec.md + implementation_plan.json)
- Approval validation based on hash comparison
"""

from pathlib import Path

import pytest
from review import ReviewState
from review.state import _compute_file_hash, _compute_spec_hash

from tests.review_fixtures import review_spec_dir


class TestSpecHashValidation:
    """Tests for spec change detection using hash."""

    def test_compute_file_hash_existing_file(self, tmp_path: Path) -> None:
        """_compute_file_hash() returns hash for existing file."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Hello, World!")

        file_hash = _compute_file_hash(test_file)

        # Verify it's a valid MD5 hash
        assert len(file_hash) == 32
        assert all(c in "0123456789abcdef" for c in file_hash)

    def test_compute_file_hash_missing_file(self, tmp_path: Path) -> None:
        """_compute_file_hash() returns empty string for missing file."""
        missing_file = tmp_path / "nonexistent.txt"

        file_hash = _compute_file_hash(missing_file)

        assert file_hash == ""

    def test_compute_file_hash_deterministic(self, tmp_path: Path) -> None:
        """_compute_file_hash() returns same hash for same content."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Consistent content")

        hash1 = _compute_file_hash(test_file)
        hash2 = _compute_file_hash(test_file)

        assert hash1 == hash2

    def test_compute_file_hash_different_content(self, tmp_path: Path) -> None:
        """_compute_file_hash() returns different hash for different content."""
        test_file = tmp_path / "test.txt"

        test_file.write_text("Content A")
        hash_a = _compute_file_hash(test_file)

        test_file.write_text("Content B")
        hash_b = _compute_file_hash(test_file)

        assert hash_a != hash_b

    def test_compute_spec_hash(self, review_spec_dir: Path) -> None:
        """_compute_spec_hash() computes combined hash of spec files."""
        spec_hash = _compute_spec_hash(review_spec_dir)

        # Should be a valid MD5 hash
        assert len(spec_hash) == 32
        assert all(c in "0123456789abcdef" for c in spec_hash)

    def test_compute_spec_hash_changes_on_spec_edit(self, review_spec_dir: Path) -> None:
        """_compute_spec_hash() changes when spec.md is modified."""
        hash_before = _compute_spec_hash(review_spec_dir)

        # Modify spec.md
        spec_file = review_spec_dir / "spec.md"
        spec_file.write_text("Modified content")

        hash_after = _compute_spec_hash(review_spec_dir)

        assert hash_before != hash_after

    def test_compute_spec_hash_changes_on_plan_edit(self, review_spec_dir: Path) -> None:
        """_compute_spec_hash() changes when plan is modified."""
        hash_before = _compute_spec_hash(review_spec_dir)

        # Modify implementation_plan.json
        plan_file = review_spec_dir / "implementation_plan.json"
        plan_file.write_text('{"modified": true}')

        hash_after = _compute_spec_hash(review_spec_dir)

        assert hash_before != hash_after

    def test_is_approval_valid_with_matching_hash(self, review_spec_dir: Path) -> None:
        """is_approval_valid() returns True when hash matches."""
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="user", auto_save=False)

        assert state.is_approval_valid(review_spec_dir) is True

    def test_is_approval_valid_with_changed_spec(self, review_spec_dir: Path) -> None:
        """is_approval_valid() returns False when spec changed."""
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="user", auto_save=False)

        # Modify spec after approval
        spec_file = review_spec_dir / "spec.md"
        spec_file.write_text("New content after approval")

        assert state.is_approval_valid(review_spec_dir) is False

    def test_is_approval_valid_not_approved(self, review_spec_dir: Path) -> None:
        """is_approval_valid() returns False when not approved."""
        state = ReviewState(approved=False)

        assert state.is_approval_valid(review_spec_dir) is False

    def test_is_approval_valid_legacy_no_hash(self, review_spec_dir: Path) -> None:
        """is_approval_valid() returns True for legacy approvals without hash."""
        state = ReviewState(
            approved=True,
            approved_by="legacy_user",
            spec_hash="",  # No hash (legacy approval)
        )

        assert state.is_approval_valid(review_spec_dir) is True

    def test_spec_change_detection_accuracy(self, review_spec_dir: Path) -> None:
        """Test that spec change detection works for various types of changes."""
        # Approve initially
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="user", auto_save=False)
        original_hash = state.spec_hash
        assert state.is_approval_valid(review_spec_dir)

        # Test 1: Whitespace-only change should change hash
        spec_file = review_spec_dir / "spec.md"
        original_content = spec_file.read_text()
        spec_file.write_text(original_content + "\n\n\n")
        assert not state.is_approval_valid(review_spec_dir)

        # Restore
        spec_file.write_text(original_content)
        assert state.is_approval_valid(review_spec_dir)

        # Test 2: Plan modification should invalidate
        import json
        plan_file = review_spec_dir / "implementation_plan.json"
        plan_content = plan_file.read_text()
        plan = json.loads(plan_content)
        plan["phases"][0]["chunks"][0]["status"] = "completed"
        plan_file.write_text(json.dumps(plan, indent=2))
        assert not state.is_approval_valid(review_spec_dir)

        # Test 3: New hash should be different
        state.approve(review_spec_dir, approved_by="user", auto_save=False)
        assert state.spec_hash != original_hash

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

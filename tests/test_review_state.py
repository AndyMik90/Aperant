#!/usr/bin/env python3
"""
Tests for ReviewState Data Class
=================================

Tests for basic ReviewState functionality including:
- Default initialization
- Dictionary serialization (to_dict/from_dict)
- Persistence (load/save operations)
"""

import json
from pathlib import Path

import pytest
from review import REVIEW_STATE_FILE, ReviewState

from tests.review_fixtures import approved_state, pending_state

# =============================================================================
# REVIEW STATE - BASIC FUNCTIONALITY
# =============================================================================

class TestReviewStateBasics:
    """Tests for ReviewState basic functionality."""

    def test_default_state(self) -> None:
        """New ReviewState has correct defaults."""
        state = ReviewState()

        assert state.approved is False
        assert state.approved_by == ""
        assert state.approved_at == ""
        assert state.feedback == []
        assert state.spec_hash == ""
        assert state.review_count == 0

    def test_to_dict(self, approved_state: ReviewState) -> None:
        """to_dict() returns correct dictionary."""
        d = approved_state.to_dict()

        assert d["approved"] is True
        assert d["approved_by"] == "test_user"
        assert d["approved_at"] == "2024-01-15T10:30:00"
        assert d["feedback"] == ["Looks good!", "Minor suggestion added."]
        assert d["spec_hash"] == "abc123"
        assert d["review_count"] == 2

    def test_from_dict(self) -> None:
        """from_dict() creates correct ReviewState."""
        data = {
            "approved": True,
            "approved_by": "user1",
            "approved_at": "2024-02-20T14:00:00",
            "feedback": ["Test feedback"],
            "spec_hash": "xyz789",
            "review_count": 5,
        }

        state = ReviewState.from_dict(data)

        assert state.approved is True
        assert state.approved_by == "user1"
        assert state.approved_at == "2024-02-20T14:00:00"
        assert state.feedback == ["Test feedback"]
        assert state.spec_hash == "xyz789"
        assert state.review_count == 5

    def test_from_dict_with_missing_fields(self) -> None:
        """from_dict() handles missing fields with defaults."""
        data = {"approved": True}

        state = ReviewState.from_dict(data)

        assert state.approved is True
        assert state.approved_by == ""
        assert state.approved_at == ""
        assert state.feedback == []
        assert state.spec_hash == ""
        assert state.review_count == 0

    def test_from_dict_empty(self) -> None:
        """from_dict() handles empty dictionary."""
        state = ReviewState.from_dict({})

        assert state.approved is False
        assert state.approved_by == ""
        assert state.review_count == 0


# =============================================================================
# REVIEW STATE - LOAD/SAVE
# =============================================================================

class TestReviewStatePersistence:
    """Tests for ReviewState load and save operations."""

    def test_save_creates_file(self, tmp_path: Path) -> None:
        """save() creates review_state.json file."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        state = ReviewState(approved=True, approved_by="user")
        state.save(spec_dir)

        state_file = spec_dir / REVIEW_STATE_FILE
        assert state_file.exists()

    def test_save_writes_correct_json(self, tmp_path: Path) -> None:
        """save() writes correct JSON content."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        state = ReviewState(
            approved=True,
            approved_by="test_user",
            approved_at="2024-01-01T00:00:00",
            feedback=["Good work"],
            spec_hash="hash123",
            review_count=3,
        )
        state.save(spec_dir)

        state_file = spec_dir / REVIEW_STATE_FILE
        with open(state_file) as f:
            data = json.load(f)

        assert data["approved"] is True
        assert data["approved_by"] == "test_user"
        assert data["feedback"] == ["Good work"]
        assert data["review_count"] == 3

    def test_load_existing_file(self, tmp_path: Path) -> None:
        """load() reads existing review_state.json file."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # Create state file manually
        data = {
            "approved": True,
            "approved_by": "manual_user",
            "approved_at": "2024-03-15T09:00:00",
            "feedback": ["Manually created"],
            "spec_hash": "manual_hash",
            "review_count": 1,
        }
        state_file = spec_dir / REVIEW_STATE_FILE
        state_file.write_text(json.dumps(data))

        state = ReviewState.load(spec_dir)

        assert state.approved is True
        assert state.approved_by == "manual_user"
        assert state.feedback == ["Manually created"]

    def test_load_missing_file(self, tmp_path: Path) -> None:
        """load() returns empty state when file doesn't exist."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        state = ReviewState.load(spec_dir)

        assert state.approved is False
        assert state.approved_by == ""
        assert state.review_count == 0

    def test_load_corrupted_json(self, tmp_path: Path) -> None:
        """load() returns empty state for corrupted JSON."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        state_file = spec_dir / REVIEW_STATE_FILE
        state_file.write_text("{ invalid json }")

        state = ReviewState.load(spec_dir)

        assert state.approved is False
        assert state.review_count == 0

    def test_load_empty_file(self, tmp_path: Path) -> None:
        """load() returns empty state for empty file."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        state_file = spec_dir / REVIEW_STATE_FILE
        state_file.write_text("")

        state = ReviewState.load(spec_dir)

        assert state.approved is False

    def test_save_and_load_roundtrip(self, tmp_path: Path) -> None:
        """save() and load() preserve state correctly."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        original = ReviewState(
            approved=True,
            approved_by="roundtrip_user",
            approved_at="2024-06-01T12:00:00",
            feedback=["First review", "Second review"],
            spec_hash="roundtrip_hash",
            review_count=7,
        )
        original.save(spec_dir)

        loaded = ReviewState.load(spec_dir)

        assert loaded.approved == original.approved
        assert loaded.approved_by == original.approved_by
        assert loaded.approved_at == original.approved_at
        assert loaded.feedback == original.feedback
        assert loaded.spec_hash == original.spec_hash
        assert loaded.review_count == original.review_count

    def test_concurrent_access_safety(self, tmp_path: Path) -> None:
        """
        Test that multiple load/save operations don't corrupt state.

        While not truly concurrent (no threading), this tests
        that sequential load/modify/save operations work correctly.
        """
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # First process loads and starts modifying
        state1 = ReviewState.load(spec_dir)
        state1.add_feedback("Feedback from process 1", spec_dir, auto_save=False)

        # Second process loads and modifies
        state2 = ReviewState.load(spec_dir)
        state2.add_feedback("Feedback from process 2", spec_dir)

        # First process saves (overwrites second's changes)
        state1.save(spec_dir)

        # Verify final state (last writer wins)
        final = ReviewState.load(spec_dir)
        assert len(final.feedback) == 1
        assert "process 1" in final.feedback[0]

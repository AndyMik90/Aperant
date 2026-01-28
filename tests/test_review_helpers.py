#!/usr/bin/env python3
"""
Tests for Review Helper Functions
==================================

Tests for utility functions:
- extract_section() - Extract markdown sections
- truncate_text() - Text truncation utilities
- get_review_status_summary() - Status summary generation
- get_review_menu_options() - Menu configuration
"""

from pathlib import Path

import pytest
from review import (
    ReviewChoice,
    ReviewState,
    extract_section,
    get_review_menu_options,
    get_review_status_summary,
    truncate_text,
)

from tests.review_fixtures import complete_spec_dir, review_spec_dir

# =============================================================================
# TEXT HELPER FUNCTIONS
# =============================================================================

class TestTextHelpers:
    """Tests for text manipulation helper functions."""

    def test_extract_section_found(self) -> None:
        """extract_section() extracts content correctly."""
        content = """# Title

## Overview

This is the overview section.

## Details

This is the details section.
"""
        overview = extract_section(content, "## Overview")

        assert "This is the overview section." in overview
        assert "This is the details section." not in overview

    def test_extract_section_not_found(self) -> None:
        """extract_section() returns empty string when not found."""
        content = """# Title

## Existing Section

Content here.
"""
        result = extract_section(content, "## Missing Section")

        assert result == ""

    def test_extract_section_last_section(self) -> None:
        """extract_section() handles last section correctly."""
        content = """# Title

## First

First content.

## Last

Last content.
"""
        last = extract_section(content, "## Last")

        assert "Last content." in last

    def test_truncate_text_short(self) -> None:
        """truncate_text() returns short text unchanged."""
        short_text = "Short text"

        result = truncate_text(short_text, max_lines=10, max_chars=100)

        assert result == "Short text"

    def test_truncate_text_too_many_lines(self) -> None:
        """truncate_text() truncates by line count."""
        long_text = "\n".join(f"Line {i}" for i in range(20))

        result = truncate_text(long_text, max_lines=5, max_chars=1000)

        # Should contain 5 lines from original + "..." on new line
        lines = result.split("\n")
        assert lines[-1] == "..."
        assert len(lines) <= 6  # 5 content lines + "..." line
        assert "Line 0" in result
        assert "Line 4" in result

    def test_truncate_text_too_many_chars(self) -> None:
        """truncate_text() truncates by character count."""
        long_text = "A" * 500

        result = truncate_text(long_text, max_lines=100, max_chars=100)

        assert len(result) <= 100
        assert result.endswith("...")


# =============================================================================
# REVIEW STATUS SUMMARY
# =============================================================================

class TestReviewStatusSummary:
    """Tests for get_review_status_summary()."""

    def test_summary_approved_valid(self, review_spec_dir: Path) -> None:
        """Summary for approved and valid state."""
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="summary_user")

        summary = get_review_status_summary(review_spec_dir)

        assert summary["approved"] is True
        assert summary["valid"] is True
        assert summary["approved_by"] == "summary_user"
        assert summary["spec_changed"] is False

    def test_summary_approved_stale(self, review_spec_dir: Path) -> None:
        """Summary for approved but stale state."""
        state = ReviewState()
        state.approve(review_spec_dir, approved_by="user")

        # Modify spec after approval
        (review_spec_dir / "spec.md").write_text("Changed!")

        summary = get_review_status_summary(review_spec_dir)

        assert summary["approved"] is True
        assert summary["valid"] is False
        assert summary["spec_changed"] is True

    def test_summary_not_approved(self, review_spec_dir: Path) -> None:
        """Summary for not approved state."""
        summary = get_review_status_summary(review_spec_dir)

        assert summary["approved"] is False
        assert summary["valid"] is False
        assert summary["approved_by"] == ""

    def test_summary_with_feedback(self, review_spec_dir: Path) -> None:
        """Summary includes feedback count."""
        state = ReviewState(feedback=["One", "Two", "Three"])
        state.save(review_spec_dir)

        summary = get_review_status_summary(review_spec_dir)

        assert summary["feedback_count"] == 3

    def test_status_summary_reflects_current_state(self, complete_spec_dir: Path) -> None:
        """Test that get_review_status_summary() accurately reflects state."""
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


# =============================================================================
# REVIEW MENU OPTIONS
# =============================================================================

class TestReviewMenuOptions:
    """Tests for review menu configuration."""

    def test_get_review_menu_options_count(self) -> None:
        """get_review_menu_options() returns correct number of options."""
        options = get_review_menu_options()

        assert len(options) == 5

    @pytest.mark.xfail(
        reason="Test isolation issue: review module mocked by test_spec_pipeline.py persists due to Python import caching. Passes when run individually.",
        strict=False,
    )
    def test_get_review_menu_options_keys(self) -> None:
        """get_review_menu_options() has correct keys."""
        options = get_review_menu_options()
        keys = [opt.key for opt in options]

        assert ReviewChoice.APPROVE.value in keys
        assert ReviewChoice.EDIT_SPEC.value in keys
        assert ReviewChoice.EDIT_PLAN.value in keys
        assert ReviewChoice.FEEDBACK.value in keys
        assert ReviewChoice.REJECT.value in keys

    def test_get_review_menu_options_have_labels(self) -> None:
        """All menu options have labels and descriptions."""
        options = get_review_menu_options()

        for opt in options:
            assert opt.label != ""
            assert opt.description != ""

    def test_review_choice_enum_values(self) -> None:
        """ReviewChoice enum has expected values."""
        assert ReviewChoice.APPROVE.value == "approve"
        assert ReviewChoice.EDIT_SPEC.value == "edit_spec"
        assert ReviewChoice.EDIT_PLAN.value == "edit_plan"
        assert ReviewChoice.FEEDBACK.value == "feedback"
        assert ReviewChoice.REJECT.value == "reject"

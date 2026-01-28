#!/usr/bin/env python3
"""
Tests for QA Report - Configuration
====================================

Tests the configuration constants in qa/report.py including:
- RECURRING_ISSUE_THRESHOLD
- ISSUE_SIMILARITY_THRESHOLD
"""

import sys
from pathlib import Path

import pytest

# Add tests directory to path for helper imports
sys.path.insert(0, str(Path(__file__).parent))

# Setup mocks before importing auto-claude modules
from qa_report_helpers import cleanup_qa_report_mocks, setup_qa_report_mocks

# Setup mocks
setup_qa_report_mocks()

# Import configuration constants after mocking
from qa.report import (
    ISSUE_SIMILARITY_THRESHOLD,
    RECURRING_ISSUE_THRESHOLD,
)

# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield  # Run all tests first
    cleanup_qa_report_mocks()


# =============================================================================
# CONFIGURATION TESTS
# =============================================================================


class TestConfiguration:
    """Tests for configuration values."""

    def test_recurring_threshold_default(self) -> None:
        """Test default recurring issue threshold."""
        assert RECURRING_ISSUE_THRESHOLD == 3

    def test_recurring_threshold_is_int(self) -> None:
        """Test that recurring threshold is an integer."""
        assert isinstance(RECURRING_ISSUE_THRESHOLD, int)

    def test_similarity_threshold_default(self) -> None:
        """Test default similarity threshold."""
        assert ISSUE_SIMILARITY_THRESHOLD == 0.8
        assert 0 < ISSUE_SIMILARITY_THRESHOLD <= 1

    def test_similarity_threshold_is_float(self) -> None:
        """Test that similarity threshold is a float."""
        assert isinstance(ISSUE_SIMILARITY_THRESHOLD, float)

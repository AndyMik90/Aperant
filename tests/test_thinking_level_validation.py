"""
Tests for thinking level validation in phase_config module.

Ensures that invalid thinking levels are caught with proper warnings
and default to 'medium' as expected.
"""

import logging
import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from phase_config import THINKING_BUDGET_MAP, get_thinking_budget


class TestThinkingLevelValidation:
    """Test thinking level validation and error handling."""

    def test_valid_thinking_levels(self):
        """Test that all valid thinking levels return correct budgets."""
        valid_levels = ["none", "low", "medium", "high", "ultrathink"]

        for level in valid_levels:
            budget = get_thinking_budget(level)
            expected = THINKING_BUDGET_MAP[level]
            assert budget == expected, f"Expected {expected} for {level}, got {budget}"

    def test_none_level_returns_none(self):
        """Test that 'none' thinking level returns None (no extended thinking)."""
        assert get_thinking_budget("none") is None

    def test_ultrathink_max_budget(self):
        """Test that 'ultrathink' returns maximum budget (63999 so max_tokens = 63999 + 1 = 64000 limit)."""
        assert get_thinking_budget("ultrathink") == 63999

    def test_invalid_level_logs_warning(self, caplog):
        """Test that invalid thinking level logs a warning."""
        with caplog.at_level(logging.WARNING):
            budget = get_thinking_budget("invalid_level")

            # Should default to medium
            assert budget == THINKING_BUDGET_MAP["medium"]

            # Should have logged a warning
            assert len(caplog.records) == 1
            assert "Invalid thinking_level 'invalid_level'" in caplog.text
            assert "Valid values:" in caplog.text
            assert "Defaulting to 'medium'" in caplog.text

    def test_invalid_level_shows_valid_options(self, caplog):
        """Test that warning message includes all valid options."""
        with caplog.at_level(logging.WARNING):
            get_thinking_budget("bad_value")

            # Check all valid levels are mentioned
            for level in ["none", "low", "medium", "high", "ultrathink"]:
                assert level in caplog.text

    def test_empty_string_level(self, caplog):
        """Test that empty string is treated as invalid."""
        with caplog.at_level(logging.WARNING):
            budget = get_thinking_budget("")
            assert budget == THINKING_BUDGET_MAP["medium"]
            assert "Invalid thinking_level" in caplog.text

    def test_case_sensitive(self, caplog):
        """Test that thinking level is case-sensitive."""
        with caplog.at_level(logging.WARNING):
            # "MEDIUM" should be invalid (not "medium")
            budget = get_thinking_budget("MEDIUM")
            assert budget == THINKING_BUDGET_MAP["medium"]
            assert "Invalid thinking_level 'MEDIUM'" in caplog.text

    def test_multiple_invalid_calls(self, caplog):
        """Test that each invalid call produces a warning."""
        invalid_levels = ["bad1", "bad2", "bad3"]

        with caplog.at_level(logging.WARNING):
            for level in invalid_levels:
                get_thinking_budget(level)

            # Should have 3 warnings
            assert len(caplog.records) == 3

    def test_budget_values_match_expected(self):
        """Test that budget values match documented amounts."""
        assert get_thinking_budget("low") == 1024
        assert get_thinking_budget("medium") == 4096
        assert get_thinking_budget("high") == 16384
        assert get_thinking_budget("ultrathink") == 63999

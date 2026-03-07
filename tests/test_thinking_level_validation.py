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

from phase_config import THINKING_BUDGET_MAP, get_thinking_budget, sanitize_thinking_level


class TestThinkingLevelValidation:
    """Test thinking level validation and error handling."""

    def test_valid_thinking_levels(self):
        """Test that all valid thinking levels return correct budgets."""
        valid_levels = ["low", "medium", "high"]

        for level in valid_levels:
            budget = get_thinking_budget(level)
            expected = THINKING_BUDGET_MAP[level]
            assert budget == expected, f"Expected {expected} for {level}, got {budget}"

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
            for level in ["low", "medium", "high"]:
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

    def test_removed_none_treated_as_invalid(self, caplog):
        """Test that removed 'none' level is treated as invalid and defaults to medium."""
        with caplog.at_level(logging.WARNING):
            budget = get_thinking_budget("none")
            assert budget == THINKING_BUDGET_MAP["medium"]
            assert "Invalid thinking_level 'none'" in caplog.text

    def test_removed_ultrathink_treated_as_invalid(self, caplog):
        """Test that removed 'ultrathink' level is treated as invalid and defaults to medium."""
        with caplog.at_level(logging.WARNING):
            budget = get_thinking_budget("ultrathink")
            assert budget == THINKING_BUDGET_MAP["medium"]
            assert "Invalid thinking_level 'ultrathink'" in caplog.text


class TestSanitizeThinkingLevel:
    """Test sanitize_thinking_level for CLI argparse validation."""

    def test_valid_levels_pass_through(self):
        """Test that valid thinking levels are returned unchanged."""
        assert sanitize_thinking_level("low") == "low"
        assert sanitize_thinking_level("medium") == "medium"
        assert sanitize_thinking_level("high") == "high"

    def test_ultrathink_maps_to_high(self):
        """Test that legacy 'ultrathink' is mapped to 'high'."""
        assert sanitize_thinking_level("ultrathink") == "high"

    def test_none_maps_to_low(self):
        """Test that legacy 'none' is mapped to 'low'."""
        assert sanitize_thinking_level("none") == "low"

    def test_unknown_value_defaults_to_medium(self):
        """Test that completely unknown values default to 'medium'."""
        assert sanitize_thinking_level("garbage") == "medium"
        assert sanitize_thinking_level("") == "medium"
        assert sanitize_thinking_level("ULTRA") == "medium"

    def test_case_sensitive(self):
        """Test that sanitize_thinking_level is case-sensitive."""
        assert sanitize_thinking_level("HIGH") == "medium"
        assert sanitize_thinking_level("Medium") == "medium"

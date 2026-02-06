#!/usr/bin/env python3
"""
Tests for Phase Event Emission Protocol
========================================

Tests the phase_event.py module including:
- ExecutionPhase enum
- emit_phase function
- Edge case handling (newlines, unicode, long messages)
- Error handling
"""

import json
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from core.phase_event import (
    PHASE_MARKER_PREFIX,
    ExecutionPhase,
    emit_phase,
)


class TestExecutionPhaseEnum:
    """Tests for ExecutionPhase enum values."""

    def test_all_phases_have_string_values(self):
        """All phases have valid string values."""
        for phase in ExecutionPhase:
            assert isinstance(phase.value, str)
            assert len(phase.value) > 0

    def test_phase_values_are_lowercase(self):
        """Phase values are lowercase for consistency."""
        for phase in ExecutionPhase:
            assert phase.value == phase.value.lower()

    def test_phase_count(self):
        """Expected number of phases exists."""
        # planning, coding, qa_review, qa_fixing, complete, failed,
        # rate_limit_paused, auth_failure_paused
        assert len(ExecutionPhase) == 8

    def test_planning_phase_exists(self):
        """PLANNING phase has correct value."""
        assert ExecutionPhase.PLANNING.value == "planning"

    def test_coding_phase_exists(self):
        """CODING phase has correct value."""
        assert ExecutionPhase.CODING.value == "coding"

    def test_qa_review_phase_exists(self):
        """QA_REVIEW phase has correct value."""
        assert ExecutionPhase.QA_REVIEW.value == "qa_review"

    def test_qa_fixing_phase_exists(self):
        """QA_FIXING phase has correct value."""
        assert ExecutionPhase.QA_FIXING.value == "qa_fixing"

    def test_complete_phase_exists(self):
        """COMPLETE phase has correct value."""
        assert ExecutionPhase.COMPLETE.value == "complete"

    def test_failed_phase_exists(self):
        """FAILED phase has correct value."""
        assert ExecutionPhase.FAILED.value == "failed"

    def test_phase_is_string_subclass(self):
        """ExecutionPhase inherits from str for easy serialization."""
        assert issubclass(ExecutionPhase, str)


class TestMarkerFormat:
    """Tests for marker format consistency."""

    def test_marker_prefix_constant(self):
        """PHASE_MARKER_PREFIX is correct."""
        assert PHASE_MARKER_PREFIX == "__EXEC_PHASE__:"

    def test_marker_prefix_ends_with_colon(self):
        """Marker ends with colon for easy JSON parsing."""
        assert PHASE_MARKER_PREFIX.endswith(":")


class TestEmitPhase:
    """Tests for emit_phase function."""

    def test_emits_valid_json(self, capsys):
        """Emits valid JSON with marker prefix."""
        emit_phase(ExecutionPhase.CODING, "Test message")
        captured = capsys.readouterr()

        assert PHASE_MARKER_PREFIX in captured.out
        # Extract JSON part
        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert isinstance(payload, dict)

    def test_includes_phase_field(self, capsys):
        """Output includes phase field."""
        emit_phase(ExecutionPhase.PLANNING, "Starting")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "phase" in payload
        assert payload["phase"] == "planning"

    def test_includes_message_field(self, capsys):
        """Output includes message field."""
        emit_phase(ExecutionPhase.CODING, "Building feature")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "message" in payload
        assert payload["message"] == "Building feature"

    def test_optional_progress_field(self, capsys):
        """Progress field is included when provided."""
        emit_phase(ExecutionPhase.CODING, "Working", progress=50)
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "progress" in payload
        assert payload["progress"] == 50

    def test_progress_not_included_when_none(self, capsys):
        """Progress field is not included when None."""
        emit_phase(ExecutionPhase.CODING, "Working")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "progress" not in payload

    def test_optional_subtask_field(self, capsys):
        """Subtask field is included when provided."""
        emit_phase(ExecutionPhase.CODING, "Working", subtask="subtask-1")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "subtask" in payload
        assert payload["subtask"] == "subtask-1"

    def test_subtask_not_included_when_none(self, capsys):
        """Subtask field is not included when None."""
        emit_phase(ExecutionPhase.CODING, "Working")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "subtask" not in payload

    def test_enum_value_extracted(self, capsys):
        """ExecutionPhase enum is converted to string value."""
        emit_phase(ExecutionPhase.QA_REVIEW, "Reviewing")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert payload["phase"] == "qa_review"

    def test_string_phase_accepted(self, capsys):
        """String phase value is accepted."""
        emit_phase("custom_phase", "Custom")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert payload["phase"] == "custom_phase"

    def test_output_ends_with_newline(self, capsys):
        """Output ends with newline for line-based parsing."""
        emit_phase(ExecutionPhase.CODING, "Test")
        captured = capsys.readouterr()
        assert captured.out.endswith("\n")

    def test_all_fields_together(self, capsys):
        """All fields work together correctly."""
        emit_phase(
            ExecutionPhase.CODING,
            "Working on feature",
            progress=75,
            subtask="feat-123",
        )
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)

        assert payload["phase"] == "coding"
        assert payload["message"] == "Working on feature"
        assert payload["progress"] == 75
        assert payload["subtask"] == "feat-123"


class TestEdgeCases:
    """Tests for edge case handling."""

    def test_empty_message_allowed(self, capsys):
        """Empty message is valid."""
        emit_phase(ExecutionPhase.CODING, "")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert payload["message"] == ""

    def test_unicode_in_message(self, capsys):
        """Unicode characters are handled correctly."""
        emit_phase(ExecutionPhase.CODING, "Building 🚀 feature with émojis")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "🚀" in payload["message"]
        assert "émojis" in payload["message"]

    def test_special_json_chars_escaped(self, capsys):
        """Special JSON characters (quotes, backslash) are escaped."""
        emit_phase(ExecutionPhase.CODING, 'Message with "quotes" and \\backslash')
        captured = capsys.readouterr()

        # Should be valid JSON
        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert '"quotes"' in payload["message"]
        assert "\\backslash" in payload["message"]

    def test_newline_in_message(self, capsys):
        """Newlines in message are properly serialized as JSON."""
        emit_phase(ExecutionPhase.CODING, "Line1\nLine2")
        captured = capsys.readouterr()

        # Output should be single line (JSON escaped newline)
        lines = captured.out.strip().split("\n")
        assert len(lines) == 1, "Output should be single line"

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        # JSON.loads unescapes the newline
        assert payload["message"] == "Line1\nLine2"

    def test_carriage_return_in_message(self, capsys):
        """Carriage returns are handled."""
        emit_phase(ExecutionPhase.CODING, "Line1\r\nLine2")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "Line1" in payload["message"]
        assert "Line2" in payload["message"]

    def test_tab_in_message(self, capsys):
        """Tab characters are handled."""
        emit_phase(ExecutionPhase.CODING, "Col1\tCol2")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "\t" in payload["message"]

    def test_very_long_message(self, capsys):
        """Very long messages are handled."""
        long_message = "x" * 10000
        emit_phase(ExecutionPhase.CODING, long_message)
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        # Either full message or truncated is acceptable
        assert len(payload["message"]) > 0

    def test_progress_zero(self, capsys):
        """Progress of 0 is included (not treated as falsy)."""
        emit_phase(ExecutionPhase.CODING, "Starting", progress=0)
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert "progress" in payload
        assert payload["progress"] == 0

    def test_progress_100(self, capsys):
        """Progress of 100 works correctly."""
        emit_phase(ExecutionPhase.COMPLETE, "Done", progress=100)
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert payload["progress"] == 100

    def test_subtask_with_special_chars(self, capsys):
        """Subtask with special characters works."""
        emit_phase(ExecutionPhase.CODING, "Working", subtask="feat/add-login#123")
        captured = capsys.readouterr()

        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)
        assert payload["subtask"] == "feat/add-login#123"


class TestErrorHandling:
    """Tests for error handling."""

    def test_oserror_handled_silently(self, monkeypatch):
        """OSError during print is handled silently."""

        def raise_oserror(*args, **kwargs):
            raise OSError("Broken pipe")

        monkeypatch.setattr("builtins.print", raise_oserror)

        # Should not raise
        emit_phase(ExecutionPhase.CODING, "Test")

    def test_unicode_encode_error_handled(self, monkeypatch):
        """UnicodeEncodeError is handled silently."""

        def raise_unicode_error(*args, **kwargs):
            raise UnicodeEncodeError("utf-8", "", 0, 1, "test")

        monkeypatch.setattr("builtins.print", raise_unicode_error)

        # Should not raise
        emit_phase(ExecutionPhase.CODING, "Test")

    def test_debug_mode_logs_errors(self, monkeypatch, capsys):
        """In debug mode, errors are logged to stderr."""
        monkeypatch.setenv("DEBUG", "true")

        import importlib
        from core import phase_event

        importlib.reload(phase_event)

        call_count = [0]
        original_print = print

        def raise_oserror_once(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise OSError("Test error")
            return original_print(*args, **kwargs)

        monkeypatch.setattr("builtins.print", raise_oserror_once)

        from core.phase_event import emit_phase as emit_phase_reloaded

        emit_phase_reloaded(ExecutionPhase.CODING, "Test")

        captured = capsys.readouterr()
        assert "emit failed" in captured.err


class TestPhaseTransitions:
    """Tests for typical phase transition scenarios."""

    def test_planning_to_coding(self, capsys):
        """Typical planning → coding transition."""
        emit_phase(ExecutionPhase.PLANNING, "Creating plan")
        emit_phase(ExecutionPhase.CODING, "Starting implementation")

        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")
        assert len(lines) == 2

        # First line is planning
        payload1 = json.loads(lines[0].replace(PHASE_MARKER_PREFIX, ""))
        assert payload1["phase"] == "planning"

        # Second line is coding
        payload2 = json.loads(lines[1].replace(PHASE_MARKER_PREFIX, ""))
        assert payload2["phase"] == "coding"

    def test_coding_to_qa_review(self, capsys):
        """Typical coding → qa_review transition."""
        emit_phase(ExecutionPhase.CODING, "Done coding")
        emit_phase(ExecutionPhase.QA_REVIEW, "Starting QA")

        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")

        payload2 = json.loads(lines[1].replace(PHASE_MARKER_PREFIX, ""))
        assert payload2["phase"] == "qa_review"

    def test_qa_review_to_complete(self, capsys):
        """Typical qa_review → complete transition."""
        emit_phase(ExecutionPhase.QA_REVIEW, "Reviewing")
        emit_phase(ExecutionPhase.COMPLETE, "QA passed")

        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")

        payload2 = json.loads(lines[1].replace(PHASE_MARKER_PREFIX, ""))
        assert payload2["phase"] == "complete"

    def test_qa_review_to_qa_fixing(self, capsys):
        """Typical qa_review → qa_fixing transition."""
        emit_phase(ExecutionPhase.QA_REVIEW, "Found issues")
        emit_phase(ExecutionPhase.QA_FIXING, "Fixing issues")

        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")

        payload2 = json.loads(lines[1].replace(PHASE_MARKER_PREFIX, ""))
        assert payload2["phase"] == "qa_fixing"

    def test_failed_phase(self, capsys):
        """Failed phase emission."""
        emit_phase(ExecutionPhase.FAILED, "Build failed: test error")

        captured = capsys.readouterr()
        json_str = captured.out.strip().replace(PHASE_MARKER_PREFIX, "")
        payload = json.loads(json_str)

        assert payload["phase"] == "failed"
        assert "Build failed" in payload["message"]


class TestIntegration:
    """Integration tests simulating real usage patterns."""

    def test_full_successful_workflow(self, capsys):
        """Simulate complete successful build workflow."""
        emit_phase(ExecutionPhase.PLANNING, "Creating implementation plan")
        emit_phase(ExecutionPhase.CODING, "Starting implementation", subtask="1/3")
        emit_phase(
            ExecutionPhase.CODING, "Implementing feature", subtask="2/3", progress=33
        )
        emit_phase(ExecutionPhase.CODING, "Finalizing", subtask="3/3", progress=66)
        emit_phase(ExecutionPhase.QA_REVIEW, "Running QA validation")
        emit_phase(ExecutionPhase.COMPLETE, "QA validation passed", progress=100)

        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")

        assert len(lines) == 6

        # Verify final phase
        final = json.loads(lines[-1].replace(PHASE_MARKER_PREFIX, ""))
        assert final["phase"] == "complete"
        assert final["progress"] == 100

    def test_workflow_with_qa_fixes(self, capsys):
        """Simulate workflow with QA rejection and fixes."""
        emit_phase(ExecutionPhase.PLANNING, "Planning")
        emit_phase(ExecutionPhase.CODING, "Coding")
        emit_phase(ExecutionPhase.QA_REVIEW, "First review")
        emit_phase(ExecutionPhase.QA_FIXING, "Fixing issues")
        emit_phase(ExecutionPhase.QA_REVIEW, "Second review")
        emit_phase(ExecutionPhase.COMPLETE, "Passed on second try")

        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")

        assert len(lines) == 6

        # Verify we had two QA reviews
        phases = [
            json.loads(line.replace(PHASE_MARKER_PREFIX, ""))["phase"] for line in lines
        ]
        assert phases.count("qa_review") == 2
        assert phases.count("qa_fixing") == 1

    def test_failed_workflow(self, capsys):
        """Simulate failed build workflow."""
        emit_phase(ExecutionPhase.PLANNING, "Planning")
        emit_phase(ExecutionPhase.CODING, "Coding")
        emit_phase(ExecutionPhase.FAILED, "Unrecoverable error occurred")

        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")

        assert len(lines) == 3

        final = json.loads(lines[-1].replace(PHASE_MARKER_PREFIX, ""))
        assert final["phase"] == "failed"

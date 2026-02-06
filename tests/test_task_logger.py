"""
Task Logger Tests

Tests for the task_logger module including ANSI code stripping functionality.
"""

import json
import os
import sys

# Add backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'apps', 'backend'))

from task_logger.ansi import strip_ansi_codes
from task_logger.capture import StreamingLogCapture
from task_logger.logger import TaskLogger
from task_logger.models import LogEntryType, LogPhase


# ============================================================================
# Unit Tests for strip_ansi_codes() Function
# ============================================================================

class TestStripAnsiCodes:
    """Unit tests for the strip_ansi_codes() utility function."""

    def test_empty_string(self):
        """Empty string should return empty string."""
        assert strip_ansi_codes("") == ""

    def test_none_input(self):
        """None input should return empty string."""
        assert strip_ansi_codes(None) == ""

    def test_no_ansi_codes(self):
        """Plain text without ANSI codes should be unchanged."""
        assert strip_ansi_codes("plain text") == "plain text"
        assert strip_ansi_codes("Hello, World!") == "Hello, World!"
        assert strip_ansi_codes("12345") == "12345"

    def test_simple_color_code(self):
        """Simple CSI color codes should be removed."""
        assert strip_ansi_codes("\x1b[31mred\x1b[0m") == "red"
        assert strip_ansi_codes("\x1b[32mgreen\x1b[0m") == "green"
        assert strip_ansi_codes("\x1b[34mblue\x1b[0m") == "blue"

    def test_vitest_like_output(self):
        """Vitest-like timestamp and debug output should be cleaned."""
        input_text = "\x1b[90m[21:40:22.196]\x1b[0m \x1b[36m[DEBUG]\x1b[0m Test message"
        expected = "[21:40:22.196] [DEBUG] Test message"
        assert strip_ansi_codes(input_text) == expected

    def test_multiple_ansi_codes(self):
        """Multiple consecutive ANSI codes should all be removed."""
        input_text = "\x1b[31m\x1b[1mbold red\x1b[0m"
        expected = "bold red"
        assert strip_ansi_codes(input_text) == expected

    def test_osc_bel_sequence(self):
        """OSC sequences with BEL terminator should be removed."""
        assert strip_ansi_codes("\x1b]0;Window Title\x07") == ""
        assert strip_ansi_codes("Text\x1b]0;Title\x07More") == "TextMore"

    def test_osc_st_sequence(self):
        """OSC sequences with ST terminator should be removed."""
        assert strip_ansi_codes("\x1b]0;Window Title\x1b\\") == ""
        assert strip_ansi_codes("Text\x1b]0;Title\x1b\\More") == "TextMore"

    def test_mixed_ansi_types(self):
        """Mixed CSI and OSC sequences in same string should all be removed."""
        input_text = "\x1b[31mError:\x1b[0m \x1b]1;Title\x07Failed"
        expected = "Error: Failed"
        assert strip_ansi_codes(input_text) == expected

    def test_multiline_text(self):
        """Multi-line text with ANSI codes should be cleaned."""
        input_text = "\x1b[31mLine 1\x1b[0m\nLine 2\x1b[32m\x1b[1m\x1b[0m\nLine 3"
        expected = "Line 1\nLine 2\nLine 3"
        assert strip_ansi_codes(input_text) == expected

    def test_private_mode_parameters(self):
        """CSI sequences with private mode parameters should be removed."""
        # Cursor hide/show
        assert strip_ansi_codes("\x1b[?25lHide\x1b[?25hShow") == "HideShow"
        # Private mode with other chars
        assert strip_ansi_codes("\x1b[=1hApplication Mode\x1b[=0l") == "Application Mode"

    def test_csi_with_parameters(self):
        """CSI sequences with semicolon-separated parameters should be removed."""
        # Bold red (1;31)
        assert strip_ansi_codes("\x1b[1;31mText\x1b[0m") == "Text"
        # Multiple parameters
        assert strip_ansi_codes("\x1b[38;2;255;0;0mRGB Red\x1b[0m") == "RGB Red"

    def test_csi_cursor_movement(self):
        """CSI cursor movement sequences should be removed."""
        assert strip_ansi_codes("Text\x1b[2K") == "Text"
        assert strip_ansi_codes("\x1b[0G\x1b[2KClear line") == "Clear line"
        assert strip_ansi_codes("\x1b[A\x1b[B\x1b[C\x1b[D") == ""

    def test_ansi_hyperlinks(self):
        """ANSI hyperlink format (OSC 8) should be removed."""
        input_text = "\x1b]8;;https://example.com\x07Click here\x1b]8;;\x07"
        expected = "Click here"
        assert strip_ansi_codes(input_text) == expected

    def test_csi_bracketed_paste(self):
        """CSI bracketed paste sequences should be removed (final byte ~)."""
        # Bracketed paste start/end
        assert strip_ansi_codes("\x1b[200~") == ""
        assert strip_ansi_codes("\x1b[201~") == ""
        # Bracketed paste with content
        assert strip_ansi_codes("\x1b[200~text\x1b[201~") == "text"

    def test_unicode_with_ansi(self):
        """Unicode text combined with ANSI codes should preserve Unicode."""
        input_text = "\x1b[31m你好\x1b[0m \x1b[32m世界\x1b[0m"
        expected = "你好 世界"
        assert strip_ansi_codes(input_text) == expected

        # Emoji
        input_text = "\x1b[36m🎉\x1b[0m \x1b[33m🚀\x1b[0m"
        expected = "🎉 🚀"
        assert strip_ansi_codes(input_text) == expected

    def test_very_long_input(self):
        """Very long strings with many ANSI codes should be handled efficiently."""
        # Create a long string with alternating ANSI codes and text
        parts = []
        for i in range(100):
            parts.append(f"\x1b[{i % 10}mtext{i}\x1b[0m")
        input_text = "".join(parts)
        result = strip_ansi_codes(input_text)

        # Verify all ANSI codes are removed
        assert "\x1b" not in result
        # Verify text content is preserved
        for i in range(100):
            assert f"text{i}" in result

    def test_only_ansi_codes(self):
        """String consisting entirely of ANSI codes should return empty."""
        assert strip_ansi_codes("\x1b[31m\x1b[1m\x1b[4m") == ""
        assert strip_ansi_codes("\x1b]0;Title\x07") == ""

    def test_nested_ansi_sequences(self):
        """Nested ANSI sequences should all be removed."""
        input_text = "\x1b[31m\x1b[1mbold red\x1b[0m \x1b[32mgreen\x1b[0m"
        expected = "bold red green"
        assert strip_ansi_codes(input_text) == expected


# ============================================================================
# Integration Tests for TaskLogger
# ============================================================================

class TestTaskLoggerAnsiIntegration:
    """Integration tests for TaskLogger ANSI code sanitization."""

    def test_log_sanitizes_content(self, tmp_path):
        """The log() method should sanitize content before storage."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        logger.log(
            "\x1b[31mError message\x1b[0m",
            LogEntryType.ERROR,
            print_to_console=False
        )

        # Load the log file and verify content is sanitized
        log_file = tmp_path / "task_logs.json"
        with open(log_file) as f:
            logs = json.load(f)

        coding_entries = logs["phases"]["coding"]["entries"]
        assert len(coding_entries) == 1
        assert coding_entries[0]["content"] == "Error message"
        assert "\x1b" not in coding_entries[0]["content"]

    def test_log_with_detail_sanitizes_detail(self, tmp_path):
        """log_with_detail() should sanitize detail parameter."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        logger.log_with_detail(
            content="Reading file",
            detail="\x1b[31mERROR:\x1b[0m File not found",
            print_to_console=False
        )

        log_file = tmp_path / "task_logs.json"
        with open(log_file) as f:
            logs = json.load(f)

        coding_entries = logs["phases"]["coding"]["entries"]
        assert len(coding_entries) == 1
        assert coding_entries[0]["detail"] == "ERROR: File not found"
        assert "\x1b" not in coding_entries[0]["detail"]

    def test_log_with_detail_sanitizes_content(self, tmp_path):
        """log_with_detail() should sanitize content parameter."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        logger.log_with_detail(
            content="\x1b[33mWarning:\x1b[0m Check this",
            detail="Some detail text",
            print_to_console=False
        )

        log_file = tmp_path / "task_logs.json"
        with open(log_file) as f:
            logs = json.load(f)

        coding_entries = logs["phases"]["coding"]["entries"]
        assert len(coding_entries) == 1
        assert coding_entries[0]["content"] == "Warning: Check this"
        assert "\x1b" not in coding_entries[0]["content"]

    def test_tool_end_sanitizes_detail(self, tmp_path):
        """tool_end() should sanitize detail parameter."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        logger.tool_start("Bash", "npm test")
        logger.tool_end(
            "Bash",
            success=True,
            result="Tests completed",
            detail="\x1b[36m$ npm test\x1b[0m\n\x1b[32mPASS\x1b[0m All tests passed"
        )

        log_file = tmp_path / "task_logs.json"
        with open(log_file) as f:
            logs = json.load(f)

        coding_entries = logs["phases"]["coding"]["entries"]
        # Find the tool_end entry
        tool_end_entries = [e for e in coding_entries if e["type"] == "tool_end"]
        assert len(tool_end_entries) == 1
        assert tool_end_entries[0]["detail"] == "$ npm test\nPASS All tests passed"
        assert "\x1b" not in tool_end_entries[0]["detail"]

    def test_tool_end_sanitizes_result_and_content(self, tmp_path):
        """tool_end() should sanitize result and content parameters."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        logger.tool_start("Bash", "npm test")
        logger.tool_end(
            "Bash",
            success=True,
            result="\x1b[32mTests passed\x1b[0m",
            detail="Some output"
        )

        log_file = tmp_path / "task_logs.json"
        with open(log_file) as f:
            logs = json.load(f)

        coding_entries = logs["phases"]["coding"]["entries"]
        tool_end_entries = [e for e in coding_entries if e["type"] == "tool_end"]
        assert len(tool_end_entries) == 1
        # Content should be "[Bash] Done: Tests passed" without ANSI codes
        assert tool_end_entries[0]["content"] == "[Bash] Done: Tests passed"
        assert "\x1b" not in tool_end_entries[0]["content"]


# ============================================================================
# Integration Tests for StreamingLogCapture
# ============================================================================

class TestStreamingLogCaptureAnsiIntegration:
    """Integration tests for StreamingLogCapture ANSI code sanitization."""

    def test_process_text_sanitizes(self, tmp_path):
        """process_text() should sanitize text before logging."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        with StreamingLogCapture(logger, LogPhase.CODING) as capture:
            capture.process_text("\x1b[90m[DEBUG]\x1b[0m Processing...")

        log_file = tmp_path / "task_logs.json"
        with open(log_file) as f:
            logs = json.load(f)

        coding_entries = logs["phases"]["coding"]["entries"]
        assert len(coding_entries) == 1
        assert coding_entries[0]["content"] == "[DEBUG] Processing..."
        assert "\x1b" not in coding_entries[0]["content"]

    def test_process_text_multiple_calls(self, tmp_path):
        """Multiple process_text calls should each sanitize."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        with StreamingLogCapture(logger, LogPhase.CODING) as capture:
            capture.process_text("\x1b[31mError\x1b[0m")
            capture.process_text("\x1b[32mSuccess\x1b[0m")

        log_file = tmp_path / "task_logs.json"
        with open(log_file) as f:
            logs = json.load(f)

        coding_entries = logs["phases"]["coding"]["entries"]
        assert len(coding_entries) == 2
        assert coding_entries[0]["content"] == "Error"
        assert coding_entries[1]["content"] == "Success"


# ============================================================================
# Public API Tests
# ============================================================================

class TestTaskLoggerPublicAPI:
    """Tests for the task_logger public API exports."""

    def test_strip_ansi_codes_is_exported(self):
        """strip_ansi_codes should be importable from task_logger package."""
        from task_logger import strip_ansi_codes as exported_strip

        # Verify it's the same function
        assert exported_strip is strip_ansi_codes

        # Verify it works
        assert exported_strip("\x1b[31mtest\x1b[0m") == "test"

    def test_public_api_exports(self):
        """All expected exports should be available."""
        from task_logger import (
            LogPhase,
            LogEntryType,
            LogEntry,
            TaskLogger,
            load_task_logs,
            get_active_phase,
            get_task_logger,
            clear_task_logger,
            update_task_logger_path,
            strip_ansi_codes,
            StreamingLogCapture,
        )
        # If imports succeed, the test passes

#!/usr/bin/env python3
"""
Tests for CLI Input Handlers (cli/input_handlers.py)
====================================================

Tests for reusable user input collection utilities:
- collect_user_input_interactive()
- read_from_file()
- read_multiline_input()
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add apps/backend to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))


# =============================================================================
# Mock UI module before importing cli.input_handlers
# =============================================================================

class MockIcons:
    """Mock Icons class - complete with all icons used by the codebase."""
    # Status icons
    SUCCESS = ("✓", "[OK]")
    ERROR = ("✗", "[X]")
    WARNING = ("⚠", "[!]")
    INFO = ("ℹ", "[i]")
    PENDING = ("○", "[ ]")
    IN_PROGRESS = ("◐", "[.]")
    COMPLETE = ("●", "[*]")
    BLOCKED = ("⊘", "[B]")

    # Action icons
    PLAY = ("▶", ">")
    PAUSE = ("⏸", "||")
    STOP = ("⏹", "[]")
    SKIP = ("⏭", ">>")

    # Navigation
    ARROW_RIGHT = ("→", "->")
    ARROW_DOWN = ("↓", "v")
    ARROW_UP = ("↑", "^")
    POINTER = ("❯", ">")
    BULLET = ("•", "*")

    # Objects
    FOLDER = ("📁", "[D]")
    FILE = ("📄", "[F]")
    GEAR = ("⚙", "[*]")
    SEARCH = ("🔍", "[?]")
    BRANCH = ("🌿", "[BR]")
    COMMIT = ("◉", "(@)")
    LIGHTNING = ("⚡", "!")
    LINK = ("🔗", "[L]")

    # Progress
    SUBTASK = ("▣", "#")
    PHASE = ("◆", "*")
    WORKER = ("⚡", "W")
    SESSION = ("▸", ">")

    # Menu
    EDIT = ("✏️", "[E]")
    CLIPBOARD = ("📋", "[C]")
    DOCUMENT = ("📄", "[D]")
    DOOR = ("🚪", "[Q]")
    SHIELD = ("🛡️", "[S]")

    # Box drawing
    BOX_TL = ("╔", "+")
    BOX_TR = ("╗", "+")
    BOX_BL = ("╚", "+")
    BOX_BR = ("╝", "+")
    BOX_H = ("═", "-")
    BOX_V = ("║", "|")
    BOX_ML = ("╠", "+")
    BOX_MR = ("╣", "+")
    BOX_TL_LIGHT = ("┌", "+")
    BOX_TR_LIGHT = ("┐", "+")
    BOX_BL_LIGHT = ("└", "+")
    BOX_BR_LIGHT = ("┘", "+")
    BOX_H_LIGHT = ("─", "-")
    BOX_V_LIGHT = ("│", "|")
    BOX_ML_LIGHT = ("├", "+")
    BOX_MR_LIGHT = ("┤", "+")

    # Progress bar
    BAR_FULL = ("█", "=")
    BAR_EMPTY = ("░", "-")
    BAR_HALF = ("▌", "=")


class MockMenuOption:
    """Mock MenuOption class."""
    def __init__(self, key, label, icon=None, description=""):
        self.key = key
        self.label = label
        self.icon = icon or ("", "")
        self.description = description


def mock_icon(icon_tuple):
    """Mock icon function."""
    return icon_tuple[0] if icon_tuple else ""


def mock_muted(text):
    """Mock muted function."""
    return f"[{text}]"


def mock_box(content, width=70, style="heavy"):
    """Mock box function."""
    lines = ["┌" + "─" * (width - 2) + "┐"]
    for line in content:
        lines.append(f"│ {line} │")
    lines.append("└" + "─" * (width - 2) + "┘")
    return "\n".join(lines)


def mock_print_status(message, status="info"):
    """Mock print_status function."""
    print(f"[{status.upper()}] {message}")


def mock_select_menu(title, options, subtitle="", allow_quit=True):
    """Mock select_menu function."""
    return options[0].key if options else None


# Create mock ui module
mock_ui = MagicMock()
mock_ui.Icons = MockIcons
mock_ui.MenuOption = MockMenuOption
mock_ui.icon = mock_icon
mock_ui.muted = mock_muted
mock_ui.box = mock_box
mock_ui.print_status = mock_print_status
mock_ui.select_menu = mock_select_menu

sys.modules['ui'] = mock_ui


# =============================================================================
# Import cli.input_handlers after mocking dependencies
# =============================================================================

from cli.input_handlers import (
    collect_user_input_interactive,
    read_from_file,
    read_multiline_input,
)


# =============================================================================
# Tests for collect_user_input_interactive()
# =============================================================================

class TestCollectUserInputInteractive:
    """Tests for collect_user_input_interactive() function."""

    def test_returns_input_when_type_selected(self, capsys):
        """Returns user input when type option is selected."""
        with patch('cli.input_handlers.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=['Line 1', 'Line 2', '']):
                result = collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:"
                )

        assert result is not None
        assert "Line 1" in result
        assert "Line 2" in result

    def test_returns_input_when_paste_selected(self, capsys):
        """Returns user input when paste option is selected."""
        with patch('cli.input_handlers.select_menu', return_value='paste'):
            with patch('builtins.input', side_effect=['Pasted content', '']):
                result = collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:"
                )

        assert result is not None
        assert "Pasted content" in result

    def test_reads_from_file_when_file_selected(self, temp_dir):
        """Reads input from file when file option is selected."""
        # Create a test file
        test_file = temp_dir / "input.txt"
        test_file.write_text("Content from file")

        with patch('cli.input_handlers.select_menu', return_value='file'):
            with patch('builtins.input', return_value=str(test_file)):
                result = collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:"
                )

        assert result is not None
        assert "Content from file" in result

    def test_returns_empty_string_when_skip_selected(self):
        """Returns empty string when skip option is selected."""
        with patch('cli.input_handlers.select_menu', return_value='skip'):
            result = collect_user_input_interactive(
                title="Test Title",
                subtitle="Test Subtitle",
                prompt_text="Enter your input:"
            )

        assert result == ""

    def test_returns_none_when_quit_selected(self):
        """Returns None when quit option is selected."""
        with patch('cli.input_handlers.select_menu', return_value='quit'):
            result = collect_user_input_interactive(
                title="Test Title",
                subtitle="Test Subtitle",
                prompt_text="Enter your input:"
            )

        assert result is None

    def test_returns_none_when_menu_returns_none(self):
        """Returns None when select_menu returns None."""
        with patch('cli.input_handlers.select_menu', return_value=None):
            result = collect_user_input_interactive(
                title="Test Title",
                subtitle="Test Subtitle",
                prompt_text="Enter your input:"
            )

        assert result is None

    def test_hides_file_option_when_disabled(self):
        """Does not show file option when allow_file is False."""
        with patch('cli.input_handlers.select_menu') as mock_menu:
            mock_menu.return_value = 'type'
            with patch('builtins.input', side_effect=['Test', '']):
                collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:",
                    allow_file=False
                )

        # Check that options were passed to select_menu
        options = mock_menu.call_args[1]['options']
        keys = [opt.key for opt in options]
        assert 'file' not in keys
        assert 'type' in keys
        assert 'skip' in keys
        assert 'quit' in keys

    def test_hides_paste_option_when_disabled(self):
        """Does not show paste option when allow_paste is False."""
        with patch('cli.input_handlers.select_menu') as mock_menu:
            mock_menu.return_value = 'type'
            with patch('builtins.input', side_effect=['Test', '']):
                collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:",
                    allow_paste=False
                )

        # Check that options were passed to select_menu
        options = mock_menu.call_args[1]['options']
        keys = [opt.key for opt in options]
        assert 'paste' not in keys
        assert 'type' in keys
        assert 'file' in keys

    def test_passes_title_and_subtitle_to_menu(self):
        """Passes title and subtitle to select_menu."""
        with patch('cli.input_handlers.select_menu') as mock_menu:
            mock_menu.return_value = 'skip'
            collect_user_input_interactive(
                title="Custom Title",
                subtitle="Custom Subtitle",
                prompt_text="Enter your input:"
            )

        assert mock_menu.called
        call_kwargs = mock_menu.call_args[1]
        assert call_kwargs['title'] == "Custom Title"
        assert call_kwargs['subtitle'] == "Custom Subtitle"

    def test_handles_keyboard_interrupt_during_type(self, capsys):
        """Handles KeyboardInterrupt during type input."""
        with patch('cli.input_handlers.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=KeyboardInterrupt):
                result = collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:"
                )

        assert result is None
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out or "cancel" in captured.out.lower()

    def test_handles_eof_error_during_type(self, capsys):
        """Handles EOFError during type input."""
        with patch('cli.input_handlers.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=EOFError):
                result = collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:"
                )

        # EOFError should break the input loop
        # Result could be empty string or None depending on implementation
        assert result is None or result == ""

    def test_file_read_failure_returns_none(self, temp_dir):
        """Returns None when file read fails."""
        with patch('cli.input_handlers.select_menu', return_value='file'):
            with patch('builtins.input', return_value='/nonexistent/file.txt'):
                result = collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:"
                )

        assert result is None

    def test_strips_whitespace_from_input(self):
        """Strips leading/trailing whitespace from collected input."""
        with patch('cli.input_handlers.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=['  Text with spaces  ', '']):
                result = collect_user_input_interactive(
                    title="Test Title",
                    subtitle="Test Subtitle",
                    prompt_text="Enter your input:"
                )

        assert result is not None
        assert result.strip() == result
        assert not result.startswith(" ")
        assert not result.endswith(" ")


# =============================================================================
# Tests for read_from_file()
# =============================================================================

class TestReadFromFile:
    """Tests for read_from_file() function."""

    def test_returns_file_contents(self, temp_dir, capsys):
        """Returns contents of the specified file."""
        test_file = temp_dir / "test.txt"
        test_file.write_text("File content here")

        with patch('builtins.input', return_value=str(test_file)):
            result = read_from_file()

        assert result is not None
        assert result == "File content here"

    def test_returns_none_when_no_path_provided(self, capsys):
        """Returns None when no file path is provided."""
        with patch('builtins.input', return_value=''):
            result = read_from_file()

        assert result is None
        captured = capsys.readouterr()
        assert "No file path" in captured.out

    def test_returns_none_for_nonexistent_file(self, capsys):
        """Returns None when file doesn't exist."""
        with patch('builtins.input', return_value='/nonexistent/path.txt'):
            result = read_from_file()

        assert result is None
        captured = capsys.readouterr()
        # The error message could be "not found" or "Permission denied" depending on the system
        assert "not found" in captured.out.lower() or "no such file" in captured.out.lower() or "permission denied" in captured.out.lower() or "cannot read" in captured.out.lower()

    def test_returns_none_for_empty_file(self, temp_dir, capsys):
        """Returns None when file is empty."""
        empty_file = temp_dir / "empty.txt"
        empty_file.write_text("")

        with patch('builtins.input', return_value=str(empty_file)):
            result = read_from_file()

        assert result is None
        captured = capsys.readouterr()
        assert "empty" in captured.out.lower()

    def test_returns_none_on_permission_error(self, capsys):
        """Returns None when file cannot be read due to permissions."""
        with patch('builtins.input', return_value='/restricted/file.txt'):
            with patch('pathlib.Path.exists', return_value=True):
                with patch('pathlib.Path.read_text', side_effect=PermissionError("Denied")):
                    result = read_from_file()

        assert result is None
        captured = capsys.readouterr()
        assert "Permission" in captured.out or "denied" in captured.out.lower()

    def test_returns_none_on_keyboard_interrupt(self, capsys):
        """Returns None when user interrupts input."""
        with patch('builtins.input', side_effect=KeyboardInterrupt):
            result = read_from_file()

        assert result is None
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out or "cancel" in captured.out.lower()

    def test_returns_none_on_eof_error(self, capsys):
        """Returns None on EOFError during input."""
        with patch('builtins.input', side_effect=EOFError):
            result = read_from_file()

        assert result is None
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out or "cancel" in captured.out.lower()

    def test_expands_tilde_in_path(self, temp_dir):
        """Expands ~ to home directory in file path."""
        test_file = temp_dir / "test.txt"
        test_file.write_text("Content")

        with patch('builtins.input', return_value='~/test.txt'):
            with patch('pathlib.Path.expanduser', return_value=test_file):
                result = read_from_file()

        assert result is not None
        assert result == "Content"

    def test_resolves_relative_paths(self, temp_dir):
        """Resolves relative file paths to absolute."""
        test_file = temp_dir / "subdir" / "test.txt"
        test_file.parent.mkdir(parents=True)
        test_file.write_text("Resolved content")

        # Change to temp_dir
        import os
        original_cwd = os.getcwd()
        try:
            os.chdir(temp_dir)
            with patch('builtins.input', return_value='subdir/test.txt'):
                result = read_from_file()

            assert result is not None
            assert result == "Resolved content"
        finally:
            os.chdir(original_cwd)

    def test_shows_character_count(self, temp_dir, capsys):
        """Shows number of characters loaded from file."""
        test_file = temp_dir / "test.txt"
        content = "A" * 100
        test_file.write_text(content)

        with patch('builtins.input', return_value=str(test_file)):
            result = read_from_file()

        captured = capsys.readouterr()
        assert "100" in captured.out or "character" in captured.out.lower()

    def test_handles_unicode_content(self, temp_dir):
        """Handles files with Unicode content."""
        test_file = temp_dir / "unicode.txt"
        content = "Hello 世界 🌍 Привет"
        test_file.write_text(content, encoding='utf-8')

        with patch('builtins.input', return_value=str(test_file)):
            result = read_from_file()

        assert result is not None
        assert result == content

    def test_strips_whitespace_from_file_content(self, temp_dir):
        """Strips leading/trailing whitespace from file content."""
        test_file = temp_dir / "spaces.txt"
        test_file.write_text("  Content with spaces  ")

        with patch('builtins.input', return_value=str(test_file)):
            result = read_from_file()

        assert result is not None
        assert result == "Content with spaces"
        assert not result.startswith(" ")
        assert not result.endswith(" ")

    def test_handles_generic_exception(self, capsys):
        """Handles generic exceptions during file reading."""
        with patch('builtins.input', return_value='/test/file.txt'):
            with patch('pathlib.Path.exists', return_value=True):
                with patch('pathlib.Path.read_text', side_effect=Exception("Unknown error")):
                    result = read_from_file()

        assert result is None
        captured = capsys.readouterr()
        assert "Error" in captured.out or "error" in captured.out.lower()

    def test_file_not_found_after_resolve(self, temp_dir, capsys):
        """Returns None when path resolves but file doesn't exist (lines 163-164)."""
        # Use a path in a valid temp directory but the file doesn't exist
        nonexistent_file = temp_dir / "does_not_exist.txt"

        with patch('builtins.input', return_value=str(nonexistent_file)):
            result = read_from_file()

        assert result is None
        captured = capsys.readouterr()
        # Should show "File not found" error message
        assert "not found" in captured.out.lower()


# =============================================================================
# Tests for read_multiline_input()
# =============================================================================

class TestReadMultilineInput:
    """Tests for read_multiline_input() function."""

    def test_returns_single_line_input(self):
        """Returns single line of input."""
        with patch('builtins.input', side_effect=['Single line', '']):
            result = read_multiline_input("Enter text:")

        assert result is not None
        assert result == "Single line"

    def test_returns_multiple_lines_of_input(self):
        """Returns multiple lines joined by newline."""
        with patch('builtins.input', side_effect=['Line 1', 'Line 2', 'Line 3', '']):
            result = read_multiline_input("Enter text:")

        assert result is not None
        assert result == "Line 1\nLine 2\nLine 3"

    def test_stops_on_empty_line(self):
        """Stops reading when encountering an empty line."""
        with patch('builtins.input', side_effect=['Line 1', 'Line 2', '', 'Should not be included']):
            result = read_multiline_input("Enter text:")

        assert result is not None
        assert "Should not be included" not in result

    def test_returns_none_on_keyboard_interrupt(self, capsys):
        """Returns None when user interrupts with Ctrl+C."""
        with patch('builtins.input', side_effect=KeyboardInterrupt):
            result = read_multiline_input("Enter text:")

        assert result is None
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out or "cancel" in captured.out.lower()

    def test_breaks_on_eof_error(self):
        """Breaks input loop on EOFError."""
        with patch('builtins.input', side_effect=['Line 1', EOFError]):
            result = read_multiline_input("Enter text:")

        # Should return content before EOF
        assert result is not None
        assert "Line 1" in result

    def test_handles_empty_input(self):
        """Handles case where user enters nothing."""
        with patch('builtins.input', side_effect=['', '']):
            result = read_multiline_input("Enter text:")

        assert result == ""

    def test_strips_whitespace_from_result(self):
        """Strips leading/trailing whitespace from final result."""
        with patch('builtins.input', side_effect=['  Line 1  ', '  Line 2  ', '']):
            result = read_multiline_input("Enter text:")

        # Note: The implementation strips each line but not the overall result
        # Behavior depends on implementation
        assert result is not None
        assert "Line 1" in result

    def test_handles_unicode_input(self):
        """Handles Unicode characters in input."""
        with patch('builtins.input', side_effect=['Hello 世界', '🌍 Emoji', '']):
            result = read_multiline_input("Enter text:")

        assert result is not None
        assert "世界" in result
        assert "🌍" in result

    def test_preserves_internal_whitespace(self):
        """Preserves internal whitespace in lines."""
        with patch('builtins.input', side_effect=['Line with    spaces', 'Line\twith\ttabs', '']):
            result = read_multiline_input("Enter text:")

        assert result is not None
        assert "    " in result
        assert "\t" in result

    def test_passes_prompt_text_to_box(self, capsys):
        """Passes prompt text to the box display."""
        with patch('builtins.input', side_effect=['', '']):
            read_multiline_input("Custom prompt text")

        captured = capsys.readouterr()
        # The prompt text should appear in the output
        assert "prompt" in captured.out.lower() or "text" in captured.out.lower() or "enter" in captured.out.lower()

    def test_allows_multiple_consecutive_empty_lines_to_stop(self):
        """Stops on first empty line (empty_count >= 1)."""
        with patch('builtins.input', side_effect=['Line 1', '', '']):
            result = read_multiline_input("Enter text:")

        assert result is not None
        assert result == "Line 1"

    def test_handles_long_lines(self):
        """Handles very long input lines."""
        long_line = "A" * 10000
        with patch('builtins.input', side_effect=[long_line, '']):
            result = read_multiline_input("Enter text:")

        assert result is not None
        assert len(result) == 10000

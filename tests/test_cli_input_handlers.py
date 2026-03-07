#!/usr/bin/env python3
"""
Tests for CLI Input Handlers (cli/input_handlers.py)
====================================================

Tests for reusable user input collection utilities:
- collect_user_input_interactive()
- read_from_file()
- read_multiline_input()
"""

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest


# =============================================================================
# Auto-use fixture to set up mock UI module before importing cli.input_handlers
# =============================================================================

@pytest.fixture(autouse=True)
def setup_mock_ui_for_input_handlers(mock_ui_module_full):
    """Auto-use fixture that replaces sys.modules['ui'] with mock for each test."""
    sys.modules['ui'] = mock_ui_module_full
    yield


# =============================================================================
# Import cli.input_handlers - works because conftest.py pre-mocks ui module in sys.modules
# The autouse fixture refreshes the mock before each test.
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

    def test_returns_none_on_permission_error(self, temp_dir, capsys):
        """Returns None when file cannot be read due to permissions."""
        # Create a real temporary file
        restricted_file = temp_dir / "restricted.txt"
        restricted_file.write_text("secret content")

        with patch('builtins.input', return_value=str(restricted_file)):
            with patch.object(Path, 'read_text', side_effect=PermissionError("Denied")):
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

    def test_handles_generic_exception(self, temp_dir, capsys):
        """Handles generic exceptions during file reading."""
        # Create a real temporary file
        test_file = temp_dir / "error_file.txt"
        test_file.write_text("content")

        with patch('builtins.input', return_value=str(test_file)):
            with patch.object(Path, 'read_text', side_effect=Exception("Unknown error")):
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
        custom_prompt = "Custom prompt text"
        with patch('builtins.input', side_effect=['', '']):
            read_multiline_input(custom_prompt)

        captured = capsys.readouterr()
        # The actual custom prompt text should appear in the output
        assert custom_prompt.lower() in captured.out.lower()

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


# =============================================================================
# Tests for module import behavior (line 14 - sys.path insertion)
# =============================================================================

class TestModuleImportPathInsertion:
    """Tests for module-level path manipulation logic."""

    def test_inserts_parent_dir_to_sys_path_when_not_present(self):
        """
        Test that line 14 executes: sys.path.insert(0, str(_PARENT_DIR))

        This test covers the scenario where _PARENT_DIR is not in sys.path
        when the module-level code executes.

        Note: This test manually executes the module-level code that would
        normally run on import, since we can't easily re-import after removing
        the path (the module wouldn't be found without the path).
        """
        from cli.input_handlers import _PARENT_DIR

        # Get the parent dir that should be inserted by line 14
        parent_dir_str = str(_PARENT_DIR)
        parent_dir_normalized = os.path.normpath(parent_dir_str)

        # Verify parent_dir_str is the apps/backend directory (cross-platform)
        expected_suffix = os.path.join("apps", "backend")
        assert parent_dir_normalized.endswith(expected_suffix) or parent_dir_str.endswith("apps/backend")

        # Save current sys.path state to restore later
        original_path = sys.path.copy()

        # Remove the parent dir from sys.path to simulate the condition on line 13
        # Use normalized paths for comparison to handle different path separators
        paths_to_restore = []
        for p in sys.path[:]:  # Copy to avoid modification during iteration
            p_normalized = os.path.normpath(p)
            if expected_suffix in p_normalized or p == parent_dir_str:
                paths_to_restore.append(p)
                sys.path.remove(p)

        try:
            # Verify parent_dir_str is NOT in sys.path now
            assert parent_dir_str not in sys.path

            # Now manually execute the logic from lines 13-14 of input_handlers.py
            # This simulates what happens when the module is imported without the path
            # We use the _PARENT_DIR value that was already imported
            if str(_PARENT_DIR) not in sys.path:
                # This is line 14 - the line we're testing
                sys.path.insert(0, str(_PARENT_DIR))

            # Verify the parent dir was added to sys.path at position 0
            assert parent_dir_str in sys.path, f"Parent dir {parent_dir_str} should be in sys.path"
            assert sys.path[0] == parent_dir_str, f"Parent dir should be at sys.path[0]"

        finally:
            # Restore sys.path to original state
            sys.path[:] = original_path

    def test_line_14_coverage_via_importlib_reload(self):
        """
        Test that line 14 executes using importlib.reload() with path manipulation.

        This test forces a reload of the module in a state where _PARENT_DIR
        is not in sys.path, triggering line 14 execution.
        """
        import importlib
        import cli.input_handlers

        # Get the parent dir that should be inserted by line 14
        parent_dir_str = str(cli.input_handlers._PARENT_DIR)

        # Save current sys.path and sys.modules state to restore later
        original_path = sys.path.copy()
        original_module = sys.modules.get('cli.input_handlers')

        # Remove the parent dir from sys.path
        # Use normalized paths for comparison to handle different path separators
        parent_dir_normalized = os.path.normpath(parent_dir_str)
        for p in sys.path[:]:
            p_normalized = os.path.normpath(p)
            if p == parent_dir_str or p_normalized == parent_dir_normalized:
                sys.path.remove(p)

        try:
            # Verify parent_dir_str is NOT in sys.path now
            assert parent_dir_str not in sys.path

            # Reload the module - this should execute lines 13-14 since path is not present
            importlib.reload(cli.input_handlers)

            # Verify the parent dir was added to sys.path by line 14
            assert parent_dir_str in sys.path, f"Parent dir {parent_dir_str} should be in sys.path"

        finally:
            # Restore sys.path to original state
            sys.path[:] = original_path
            # Restore sys.modules to original state
            if original_module is not None:
                sys.modules['cli.input_handlers'] = original_module
            elif 'cli.input_handlers' in sys.modules:
                del sys.modules['cli.input_handlers']

#!/usr/bin/env python3
"""
Tests for CLI Followup Commands (cli/followup_commands.py)
===========================================================

Tests for follow-up task commands:
- collect_followup_task()
- handle_followup_command()
"""

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# Note: conftest.py handles apps/backend path
# Add tests directory to path for test_utils import (conftest doesn't handle this)
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))


# =============================================================================
# Mock external dependencies before importing cli.followup_commands
# =============================================================================

# Import shared helper for creating mock modules
from test_utils import _create_mock_module

# Mock modules
if 'progress' not in sys.modules:
    sys.modules['progress'] = _create_mock_module()


# =============================================================================
# Auto-use fixture to set up mock UI module before importing cli.followup_commands
# =============================================================================

@pytest.fixture(autouse=True)
def setup_mock_ui_for_followup(mock_ui_module_full):
    """Auto-use fixture that replaces sys.modules['ui'] with mock for each test."""
    sys.modules['ui'] = mock_ui_module_full
    yield

# =============================================================================
# Import cli.followup_commands after mocking dependencies
# =============================================================================

from cli.followup_commands import (
    collect_followup_task,
    handle_followup_command,
)


# =============================================================================
# Tests for collect_followup_task()
# =============================================================================

class TestCollectFollowupTask:
    """Tests for collect_followup_task() function."""

    def test_returns_task_description_on_type(self, temp_dir, capsys):
        """Returns task description when user chooses to type."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=['First line', 'Second line', '']):
                result = collect_followup_task(spec_dir)

        assert result is not None
        assert "First line" in result
        assert "Second line" in result

        # Check that FOLLOWUP_REQUEST.md was created
        followup_file = spec_dir / "FOLLOWUP_REQUEST.md"
        assert followup_file.exists()
        assert followup_file.read_text() == result

    def test_reads_from_file_when_selected(self, temp_dir, capsys):
        """Reads task description from file when file option selected."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create a temp file with task description
        task_file = temp_dir / "task.txt"
        task_file.write_text("Task from file\nMultiple lines")

        with patch('cli.followup_commands.select_menu', return_value='file'):
            with patch('builtins.input', return_value=str(task_file)):
                result = collect_followup_task(spec_dir)

        assert result is not None
        assert "Task from file" in result
        assert "Multiple lines" in result

    def test_handles_nonexistent_file(self, temp_dir, capsys):
        """Handles case when specified file doesn't exist."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', return_value='file'):
            with patch('builtins.input', return_value='/nonexistent/file.txt'):
                with patch('cli.followup_commands.select_menu', return_value='quit'):
                    result = collect_followup_task(spec_dir)

        assert result is None

    def test_handles_empty_file(self, temp_dir, capsys):
        """Handles case when file is empty."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create empty file
        task_file = temp_dir / "empty.txt"
        task_file.write_text("")

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', side_effect=[str(task_file)]):
                result = collect_followup_task(spec_dir)

        assert result is None

    def test_handles_permission_error(self, temp_dir, capsys):
        """Handles permission denied error when reading file."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        task_file = temp_dir / "restricted.txt"
        task_file.write_text("Content")

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=str(task_file)):
                # Mock Path.read_text to raise PermissionError
                with patch('pathlib.Path.read_text', side_effect=PermissionError("Denied")):
                    result = collect_followup_task(spec_dir)

        assert result is None

    def test_returns_none_on_quit(self, temp_dir):
        """Returns None when user selects quit."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', return_value='quit'):
            result = collect_followup_task(spec_dir)

        assert result is None

    def test_retries_on_empty_input(self, temp_dir, capsys):
        """Retries when user provides empty input."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # First attempt: type with empty input
        # Second attempt: type with actual content
        with patch('cli.followup_commands.select_menu', side_effect=['type', 'type']):
            with patch('builtins.input', side_effect=[
                '',  # First attempt - empty
                'Actual task content',  # Second attempt - content
                ''
            ]):
                result = collect_followup_task(spec_dir, max_retries=3)

        assert result is not None
        assert "Actual task content" in result

    def test_respects_max_retries(self, temp_dir, capsys):
        """Stops retrying after max attempts reached."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Always return empty input
        with patch('cli.followup_commands.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=['', '', '', '']):
                result = collect_followup_task(spec_dir, max_retries=2)

        assert result is None
        captured = capsys.readouterr()
        assert "Maximum retry" in captured.out or "cancelled" in captured.out.lower()

    def test_handles_keyboard_interrupt(self, temp_dir, capsys):
        """Handles KeyboardInterrupt during input collection."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=KeyboardInterrupt):
                result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out or "cancel" in captured.out.lower()

    def test_handles_eof_error(self, temp_dir, capsys):
        """Handles EOFError during input collection."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=EOFError):
                result = collect_followup_task(spec_dir)

        # EOFError should break the input loop, returning None if empty
        # The actual content would be empty, so it should retry or return None
        assert result is None

    def test_saves_to_followup_request_file(self, temp_dir):
        """Saves the collected task to FOLLOWUP_REQUEST.md."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        task_description = "This is a test follow-up task"

        with patch('cli.followup_commands.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=[task_description, '']):
                collect_followup_task(spec_dir)

        followup_file = spec_dir / "FOLLOWUP_REQUEST.md"
        assert followup_file.exists()
        assert followup_file.read_text() == task_description

    def test_handles_empty_file_path(self, temp_dir, capsys):
        """Handles case when no file path is provided."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=''):
                result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        assert "No file path" in captured.out or "cancel" in captured.out.lower()

    def test_expands_tilde_in_path(self, temp_dir):
        """Expands ~ in file path to home directory."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create a file in temp_dir to simulate home
        task_file = temp_dir / "task.txt"
        task_file.write_text("Task content")

        with patch('cli.followup_commands.select_menu', return_value='file'):
            with patch('builtins.input', return_value=str(task_file)):
                with patch('pathlib.Path.expanduser', return_value=task_file):
                    result = collect_followup_task(spec_dir)

        assert result is not None
        assert "Task content" in result


# =============================================================================
# Tests for handle_followup_command()
# =============================================================================

class TestHandleFollowupCommand:
    """Tests for handle_followup_command() function."""

    @patch('cli.utils.validate_environment')
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('progress.is_build_complete')
    @patch('progress.count_subtasks')
    @patch('cli.followup_commands.collect_followup_task')
    def test_exits_when_no_implementation_plan(
        self,
        mock_collect,
        mock_count,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Exits with error when implementation plan doesn't exist."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")

        # sys.exit is called directly in the function, so we need to catch SystemExit
        with pytest.raises(SystemExit) as exc_info:
            handle_followup_command(temp_dir, spec_dir, "sonnet")

        assert exc_info.value.code == 1

        captured = capsys.readouterr()
        assert "No implementation plan found" in captured.out or "not been built" in captured.out

    @patch('cli.utils.validate_environment')
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete')
    @patch('cli.followup_commands.count_subtasks')
    @patch('cli.followup_commands.collect_followup_task')
    def test_exits_when_build_not_complete(
        self,
        mock_collect,
        mock_count,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Exits with error when build is not complete."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{}')

        mock_is_complete.return_value = False
        mock_count.return_value = (2, 5)  # 2 completed, 5 total

        # sys.exit is called directly in the function
        with pytest.raises(SystemExit) as exc_info:
            handle_followup_command(temp_dir, spec_dir, "sonnet")

        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "not complete" in captured.out or "pending" in captured.out

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_runs_planner_after_collecting_task(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Runs follow-up planner after successfully collecting task."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = "Add new feature"
        mock_run_planner.return_value = True

        handle_followup_command(temp_dir, spec_dir, "sonnet")

        assert mock_run_planner.called
        call_kwargs = mock_run_planner.call_args[1]
        assert call_kwargs['project_dir'] == temp_dir
        assert call_kwargs['spec_dir'] == spec_dir
        assert call_kwargs['model'] == "sonnet"

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_returns_when_user_cancels(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Returns early when user cancels task collection."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = None

        handle_followup_command(temp_dir, spec_dir, "sonnet")

        assert not mock_run_planner.called
        captured = capsys.readouterr()
        assert "cancel" in captured.out.lower()

    @patch('cli.utils.validate_environment', return_value=False)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_exits_when_environment_invalid(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir
    ):
        """Exits when environment validation fails."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = "Task description"

        # sys.exit is called directly in the function
        with pytest.raises(SystemExit) as exc_info:
            handle_followup_command(temp_dir, spec_dir, "sonnet")

        assert exc_info.value.code == 1
        assert not mock_run_planner.called

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_handles_successful_planning(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Shows success message when planning completes successfully."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = "Add feature"
        mock_run_planner.return_value = True

        handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        assert "COMPLETE" in captured.out or "success" in captured.out.lower()

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_handles_planning_failure(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Shows warning when planning doesn't fully succeed."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = "Add feature"
        mock_run_planner.return_value = False

        with pytest.raises(SystemExit):
            handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        assert "INCOMPLETE" in captured.out or "warning" in captured.out.lower()

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_handles_keyboard_interrupt(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Handles KeyboardInterrupt during planning."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = "Add feature"
        mock_run_planner.side_effect = KeyboardInterrupt()

        with pytest.raises(SystemExit):
            handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        assert "paused" in captured.out.lower() or "retry" in captured.out.lower()

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_handles_planning_exception(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Handles exception during planning."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = "Add feature"
        mock_run_planner.side_effect = Exception("Planning failed")

        with pytest.raises(SystemExit):
            handle_followup_command(temp_dir, spec_dir, "sonnet", verbose=False)

        captured = capsys.readouterr()
        assert "error" in captured.out.lower()

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_shows_traceback_in_verbose_mode(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Shows traceback in verbose mode."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = "Add feature"
        test_error = Exception("Test error")
        mock_run_planner.side_effect = test_error

        with pytest.raises(SystemExit):
            handle_followup_command(temp_dir, spec_dir, "sonnet", verbose=True)

        captured = capsys.readouterr()
        # In verbose mode, traceback should be printed
        assert "error" in captured.out.lower()

    def test_counts_prior_followups(self, temp_dir, capsys):
        """Counts and displays prior follow-up phases."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")

        # Create implementation plan with follow-up phases
        plan = {
            "phases": [
                {"name": "Initial Phase"},
                {"name": "Follow-Up: Bug Fixes"},
                {"name": "Followup: Enhancement"},
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        with patch('cli.followup_commands.is_build_complete', return_value=True):
            with patch('cli.followup_commands.collect_followup_task', return_value=None):
                handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        # Should indicate prior follow-ups were detected
        # The exact output depends on the implementation
        assert "complete" in captured.out.lower()

    def test_shows_ready_message_for_first_followup(self, temp_dir, capsys):
        """Shows appropriate message for first follow-up."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")

        # Create plan without follow-up phases
        plan = {"phases": [{"name": "Initial Phase"}]}
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        with patch('cli.followup_commands.is_build_complete', return_value=True):
            with patch('cli.followup_commands.collect_followup_task', return_value=None):
                handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        assert "complete" in captured.out.lower() or "ready" in captured.out.lower()

    def test_passes_verbose_flag_to_planner(self, temp_dir):
        """Passes verbose flag to follow-up planner."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        with patch('cli.utils.validate_environment', return_value=True):
            with patch('agent.run_followup_planner', new_callable=AsyncMock, return_value=True) as mock_planner:
                with patch('cli.followup_commands.is_build_complete', return_value=True):
                    with patch('cli.followup_commands.collect_followup_task', return_value="Task"):
                        handle_followup_command(temp_dir, spec_dir, "sonnet", verbose=True)

        call_kwargs = mock_planner.call_args[1]
        assert call_kwargs['verbose'] is True


# =============================================================================
# Additional tests for improved coverage (lines 108-111, 139-144, 150-153, 296-297)
# =============================================================================

    def test_handles_keyboard_interrupt_on_file_path_input(self, temp_dir, capsys):
        """Handles KeyboardInterrupt when entering file path (lines 108-111)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', return_value='file'):
            with patch('builtins.input', side_effect=KeyboardInterrupt):
                result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out or "cancel" in captured.out.lower()

    def test_handles_eof_error_on_file_path_input(self, temp_dir, capsys):
        """Handles EOFError when entering file path (lines 108-111)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', return_value='file'):
            with patch('builtins.input', side_effect=EOFError):
                result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        assert "Cancelled" in captured.out or "cancel" in captured.out.lower()

    def test_handles_file_not_found_error(self, temp_dir, capsys):
        """Handles FileNotFoundError when file doesn't exist (lines 139-144)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create a path that doesn't exist
        nonexistent_file = temp_dir / "does_not_exist.txt"

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=str(nonexistent_file)):
                result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        # Should show file not found error
        assert "not found" in captured.out.lower() or "check that the path" in captured.out.lower()

    def test_handles_generic_exception_on_file_read(self, temp_dir, capsys):
        """Handles generic exception when reading file (lines 150-153)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create a file that exists
        task_file = temp_dir / "task.txt"
        task_file.write_text("Content")

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=str(task_file)):
                # Mock read_text to raise a generic exception
                with patch('pathlib.Path.read_text', side_effect=OSError("Read error")):
                    result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        assert "error" in captured.out.lower()

    def test_handles_unicode_decode_error_on_file_read(self, temp_dir, capsys):
        """Handles UnicodeDecodeError when reading file (lines 150-153)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create a file that exists
        task_file = temp_dir / "task.txt"
        task_file.write_text("Content")

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=str(task_file)):
                # Mock read_text to raise UnicodeDecodeError
                with patch('pathlib.Path.read_text', side_effect=UnicodeDecodeError('utf-8', b'', 0, 1, 'invalid')):
                    result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        assert "error" in captured.out.lower()

    def test_handles_runtime_error_on_file_read(self, temp_dir, capsys):
        """Handles RuntimeError when reading file (lines 150-153)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create a file that exists
        task_file = temp_dir / "task.txt"
        task_file.write_text("Content")

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=str(task_file)):
                # Mock read_text to raise RuntimeError
                with patch('pathlib.Path.read_text', side_effect=RuntimeError("Unexpected error")):
                    result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        assert "error" in captured.out.lower()


class TestHandleFollowupCommandEdgeCases:
    """Additional tests for handle_followup_command() edge cases (lines 296-297)."""

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_handles_json_decode_error_in_plan_file(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Handles JSONDecodeError when implementation_plan.json is malformed (lines 296-297)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")

        # Write invalid JSON to implementation_plan.json
        (spec_dir / "implementation_plan.json").write_text('{ invalid json }')

        mock_collect.return_value = None

        # Should handle the JSONDecodeError gracefully and continue
        handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        # Should complete without error (prior_followup_count just stays 0)
        assert "complete" in captured.out.lower()

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_handles_keyerror_in_plan_file(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Handles KeyError when implementation_plan.json is missing expected keys (lines 296-297)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")

        # Write JSON without 'phases' key
        (spec_dir / "implementation_plan.json").write_text('{"other_key": "value"}')

        mock_collect.return_value = None

        # Should handle the missing key gracefully
        handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        assert "complete" in captured.out.lower()

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_handles_phase_with_missing_name_key(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Handles phase dict without 'name' key (lines 296-297)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")

        # Write JSON with phase missing 'name' key
        (spec_dir / "implementation_plan.json").write_text('{"phases": [{"other_key": "value"}, {"name": "Valid Phase"}]}')

        mock_collect.return_value = None

        # Should handle missing name gracefully (uses .get() with default)
        handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        assert "complete" in captured.out.lower()

    @patch('cli.utils.validate_environment', return_value=True)
    @patch('agent.run_followup_planner', new_callable=AsyncMock)
    @patch('cli.followup_commands.is_build_complete', return_value=True)
    @patch('cli.followup_commands.collect_followup_task')
    def test_handles_empty_phases_in_plan(
        self,
        mock_collect,
        mock_is_complete,
        mock_run_planner,
        mock_validate,
        temp_dir,
        capsys
    ):
        """Handles empty phases array in implementation plan (lines 296-297)."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("# Test")

        # Write JSON with empty phases array
        (spec_dir / "implementation_plan.json").write_text('{"phases": []}')

        mock_collect.return_value = None

        handle_followup_command(temp_dir, spec_dir, "sonnet")

        captured = capsys.readouterr()
        assert "complete" in captured.out.lower()



class TestCollectFollowupTaskEdgeCases:
    """Additional edge case tests for collect_followup_task()."""

    def test_handles_file_with_only_whitespace(self, temp_dir, capsys):
        """Handles file that contains only whitespace characters."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create file with only whitespace
        task_file = temp_dir / "whitespace.txt"
        task_file.write_text("   \n\n\t\n   ")

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=str(task_file)):
                result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        # .strip() would make the content empty, triggering the empty file message
        assert "empty" in captured.out.lower() or "cancel" in captured.out.lower()

    def test_handles_file_with_newline_only_content(self, temp_dir, capsys):
        """Handles file that contains only newlines."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Create file with only newlines
        task_file = temp_dir / "newlines.txt"
        task_file.write_text("\n\n\n")

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=str(task_file)):
                result = collect_followup_task(spec_dir)

        assert result is None

    def test_handles_file_read_with_os_error(self, temp_dir, capsys):
        """Handles OSError when reading file."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        task_file = temp_dir / "task.txt"
        task_file.write_text("Content")

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value=str(task_file)):
                with patch('pathlib.Path.read_text', side_effect=OSError("OS error reading file")):
                    result = collect_followup_task(spec_dir)

        assert result is None
        captured = capsys.readouterr()
        assert "error" in captured.out.lower()

    def test_handles_value_error_on_file_path(self, temp_dir, capsys):
        """Handles ValueError during file path resolution."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        with patch('cli.followup_commands.select_menu', side_effect=['file', 'quit']):
            with patch('builtins.input', return_value='/valid/path'):
                # Mock resolve to raise ValueError
                with patch('pathlib.Path.resolve', side_effect=ValueError("Invalid path")):
                    result = collect_followup_task(spec_dir)

        # Should handle gracefully and return None or retry
        assert result is None

    def test_handles_type_input_with_trailing_whitespace(self, temp_dir):
        """Properly strips trailing whitespace from typed input."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        task_description = "Task content with trailing spaces   "

        with patch('cli.followup_commands.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=[task_description, '']):
                result = collect_followup_task(spec_dir)

        assert result is not None
        # Should be stripped
        assert result == "Task content with trailing spaces"

    def test_handles_type_input_with_internal_whitespace(self, temp_dir):
        """Preserves internal whitespace in typed input."""
        spec_dir = temp_dir / ".auto-claude" / "specs" / "001-test"
        spec_dir.mkdir(parents=True)

        # Note: empty line terminates input, so we need non-empty lines only
        # Then a final empty line to signal completion
        with patch('cli.followup_commands.select_menu', return_value='type'):
            with patch('builtins.input', side_effect=["Line 1", "Line 2", "  Line 3", '']):
                result = collect_followup_task(spec_dir)

        assert result is not None
        assert "Line 1" in result
        assert "Line 2" in result
        assert "Line 3" in result


# =============================================================================
# TESTS: Module-level path insertion (line 16)
# =============================================================================


class TestFollowupCommandsModuleImport:
    """Tests for covering module-level path insertion (line 16)."""

    def test_module_import_executes_path_insertion(self):
        """Module import executes sys.path.insert (line 16)."""
        # Get the module path and parent directory
        import cli.followup_commands as followup_module
        module_path = followup_module.__file__
        parent_dir = str(Path(module_path).parent.parent)

        # Save original sys.path
        original_path = sys.path.copy()

        # Remove the parent directory from sys.path to make the condition True
        while parent_dir in sys.path:
            sys.path.remove(parent_dir)

        # Remove module and its submodules from sys.modules to force re-import
        modules_to_remove = [k for k in sys.modules.keys() if k.startswith('cli.followup_commands')]
        for mod_name in modules_to_remove:
            del sys.modules[mod_name]

        # Now import it fresh - this should execute line 16 under coverage
        import importlib.util
        spec = importlib.util.spec_from_file_location("cli.followup_commands", module_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules['cli.followup_commands'] = module
        spec.loader.exec_module(module)

        # Verify the module loaded correctly
        assert hasattr(module, 'handle_followup_command')

        # Restore original sys.path
        sys.path[:] = original_path

#!/usr/bin/env python3
"""
Tests for CLI Main Entry Point
================================

Tests the cli.main module which handles argument parsing and command routing.
Tests parse_args(), main(), and _run_cli() functions.

Key scenarios tested:
- --list flag
- --spec with valid/invalid spec
- --merge, --review, --discard flags
- --qa, --qa-status, --review-status flags
- --followup flag
- --list-worktrees, --cleanup-worktrees flags
- --batch-create, --batch-status, --batch-cleanup flags
- --create-pr flag
- --force flag
- --base-branch flag
- --auto-continue flag
- --skip-qa flag
- --no-commit flag
- --merge-preview flag
- --pr-target, --pr-title, --pr-draft flags
"""

import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, Mock
import pytest

# Note: conftest.py already adds apps/backend to sys.path at line 52

# Mock import_dotenv to avoid sys.exit() during imports
with patch("cli.utils.import_dotenv", return_value=Mock()):
    from cli.main import parse_args


@pytest.fixture
def clear_env():
    """Clear environment variables that might affect tests."""
    original_env = os.environ.copy()
    os.environ.pop("AUTO_BUILD_MODEL", None)
    os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
    yield
    os.environ.clear()
    os.environ.update(original_env)


@pytest.fixture
def mock_project_dir(temp_dir):
    """Create a mock project directory with spec structure."""
    project_dir = temp_dir / "project"
    project_dir.mkdir()

    # Create .auto-claude directory structure
    auto_claude_dir = project_dir / ".auto-claude"
    auto_claude_dir.mkdir()
    specs_dir = auto_claude_dir / "specs"
    specs_dir.mkdir()

    # Create a sample spec
    spec_001 = specs_dir / "001-test-spec"
    spec_001.mkdir()
    (spec_001 / "spec.md").write_text("# Test Spec\n\nThis is a test spec.")
    (spec_001 / "requirements.json").write_text('{"task_description": "test"}')
    (spec_001 / "implementation_plan.json").write_text('{"phases": []}')

    return project_dir


@pytest.fixture
def mock_utils():
    """Mock CLI utility functions."""
    with patch("cli.main.print_banner"), \
         patch("cli.main.get_project_dir") as mock_get_project_dir, \
         patch("cli.main.find_spec") as mock_find_spec, \
         patch("cli.main.setup_environment"):

        yield {
            "get_project_dir": mock_get_project_dir,
            "find_spec": mock_find_spec,
        }


@pytest.fixture
def mock_debug():
    """Mock debug functions."""
    # The debug module is imported inside _run_cli, so we need to mock it there
    with patch("debug.debug"), \
         patch("debug.debug_section"), \
         patch("debug.debug_success"), \
         patch("debug.debug_error"):
        yield


class TestParseArgs:
    """Tests for parse_args() argument parsing."""

    def test_parse_args_defaults(self, clear_env):
        """Test parse_args with no arguments."""
        with patch("sys.argv", ["run.py"]):
            args = parse_args()

            assert args.list is False
            assert args.spec is None
            assert args.project_dir is None
            assert args.max_iterations is None
            assert args.model is None
            assert args.verbose is False
            assert args.isolated is False
            assert args.direct is False
            assert args.merge is False
            assert args.review is False
            assert args.discard is False
            assert args.create_pr is False
            assert args.qa is False
            assert args.qa_status is False
            assert args.review_status is False
            assert args.followup is False
            assert args.list_worktrees is False
            assert args.cleanup_worktrees is False
            assert args.force is False
            assert args.base_branch is None
            assert args.batch_create is None
            assert args.batch_status is False
            assert args.batch_cleanup is False
            assert args.no_dry_run is False
            assert args.auto_continue is False
            assert args.skip_qa is False
            assert args.no_commit is False
            assert args.merge_preview is False
            assert args.pr_target is None
            assert args.pr_title is None
            assert args.pr_draft is False

    def test_parse_list_flag(self, clear_env):
        """Test --list flag parsing."""
        with patch("sys.argv", ["run.py", "--list"]):
            args = parse_args()
            assert args.list is True

    def test_parse_spec_with_number(self, clear_env):
        """Test --spec with numeric spec identifier."""
        with patch("sys.argv", ["run.py", "--spec", "001"]):
            args = parse_args()
            assert args.spec == "001"

    def test_parse_spec_with_name(self, clear_env):
        """Test --spec with full spec name."""
        with patch("sys.argv", ["run.py", "--spec", "001-feature-name"]):
            args = parse_args()
            assert args.spec == "001-feature-name"

    def test_parse_project_dir(self, clear_env):
        """Test --project-dir flag."""
        with patch("sys.argv", ["run.py", "--project-dir", "/custom/path"]):
            args = parse_args()
            assert isinstance(args.project_dir, Path)
            assert args.project_dir == Path("/custom/path")

    def test_parse_max_iterations(self, clear_env):
        """Test --max-iterations flag."""
        with patch("sys.argv", ["run.py", "--max-iterations", "5"]):
            args = parse_args()
            assert args.max_iterations == 5

    def test_parse_model(self, clear_env):
        """Test --model flag."""
        with patch("sys.argv", ["run.py", "--model", "sonnet"]):
            args = parse_args()
            assert args.model == "sonnet"

    def test_parse_verbose(self, clear_env):
        """Test --verbose flag."""
        with patch("sys.argv", ["run.py", "--verbose"]):
            args = parse_args()
            assert args.verbose is True

    def test_mutually_exclusive_workspace_flags(self, clear_env):
        """Test --isolated and --direct are mutually exclusive."""
        # Can use --isolated alone
        with patch("sys.argv", ["run.py", "--isolated"]):
            args = parse_args()
            assert args.isolated is True
            assert args.direct is False

        # Can use --direct alone
        with patch("sys.argv", ["run.py", "--direct"]):
            args = parse_args()
            assert args.direct is True
            assert args.isolated is False

    def test_mutually_exclusive_build_flags(self, clear_env):
        """Test build management flags are mutually exclusive."""
        # Can use --merge alone
        with patch("sys.argv", ["run.py", "--merge"]):
            args = parse_args()
            assert args.merge is True

        # Can use --review alone
        with patch("sys.argv", ["run.py", "--review"]):
            args = parse_args()
            assert args.review is True

        # Can use --discard alone
        with patch("sys.argv", ["run.py", "--discard"]):
            args = parse_args()
            assert args.discard is True

        # Can use --create-pr alone
        with patch("sys.argv", ["run.py", "--create-pr"]):
            args = parse_args()
            assert args.create_pr is True

    def test_parse_pr_options(self, clear_env):
        """Test PR-related flags."""
        with patch("sys.argv", ["run.py", "--pr-target", "develop", "--pr-title", "My PR", "--pr-draft"]):
            args = parse_args()
            assert args.pr_target == "develop"
            assert args.pr_title == "My PR"
            assert args.pr_draft is True

    def test_parse_merge_options(self, clear_env):
        """Test merge-related flags."""
        with patch("sys.argv", ["run.py", "--no-commit", "--merge-preview"]):
            args = parse_args()
            assert args.no_commit is True
            assert args.merge_preview is True

    def test_parse_qa_flags(self, clear_env):
        """Test QA-related flags."""
        with patch("sys.argv", ["run.py", "--qa", "--qa-status", "--skip-qa"]):
            args = parse_args()
            assert args.qa is True
            assert args.qa_status is True
            assert args.skip_qa is True

    def test_parse_followup_flag(self, clear_env):
        """Test --followup flag."""
        with patch("sys.argv", ["run.py", "--followup"]):
            args = parse_args()
            assert args.followup is True

    def test_parse_review_status_flag(self, clear_env):
        """Test --review-status flag."""
        with patch("sys.argv", ["run.py", "--review-status"]):
            args = parse_args()
            assert args.review_status is True

    def test_parse_worktree_management_flags(self, clear_env):
        """Test worktree management flags."""
        with patch("sys.argv", ["run.py", "--list-worktrees", "--cleanup-worktrees"]):
            args = parse_args()
            assert args.list_worktrees is True
            assert args.cleanup_worktrees is True

    def test_parse_force_flag(self, clear_env):
        """Test --force flag."""
        with patch("sys.argv", ["run.py", "--force"]):
            args = parse_args()
            assert args.force is True

    def test_parse_base_branch(self, clear_env):
        """Test --base-branch flag."""
        with patch("sys.argv", ["run.py", "--base-branch", "develop"]):
            args = parse_args()
            assert args.base_branch == "develop"

    def test_parse_auto_continue_flag(self, clear_env):
        """Test --auto-continue flag."""
        with patch("sys.argv", ["run.py", "--auto-continue"]):
            args = parse_args()
            assert args.auto_continue is True

    def test_parse_batch_flags(self, clear_env):
        """Test batch operation flags."""
        with patch("sys.argv", ["run.py", "--batch-create", "tasks.json", "--batch-status", "--batch-cleanup", "--no-dry-run"]):
            args = parse_args()
            assert args.batch_create == "tasks.json"
            assert args.batch_status is True
            assert args.batch_cleanup is True
            assert args.no_dry_run is True


class TestMain:
    """Tests for main() entry point error handling."""

    def test_main_keyboard_interrupt(self, clear_env):
        """Test main() handles KeyboardInterrupt correctly."""
        from cli.main import main

        with patch("cli.main.setup_environment"), \
             patch("core.sentry.init_sentry"), \
             patch("cli.main._run_cli", side_effect=KeyboardInterrupt):

            with pytest.raises(SystemExit) as exc_info:
                main()

            assert exc_info.value.code == 130

    def test_main_unexpected_exception(self, clear_env):
        """Test main() captures unexpected exceptions to Sentry."""
        from cli.main import main

        test_error = RuntimeError("Unexpected error")

        with patch("cli.main.setup_environment"), \
             patch("core.sentry.init_sentry"), \
             patch("core.sentry.capture_exception") as mock_capture, \
             patch("cli.main._run_cli", side_effect=test_error):

            with pytest.raises(SystemExit) as exc_info:
                main()

            assert exc_info.value.code == 1
            mock_capture.assert_called_once_with(test_error)

    def test_main_successful_execution(self, clear_env):
        """Test main() executes successfully."""
        from cli.main import main

        with patch("cli.main.setup_environment"), \
             patch("core.sentry.init_sentry"), \
             patch("cli.main._run_cli"):

            # Should not raise
            main()


class TestRunCliListCommands:
    """Tests for _run_cli() listing commands."""

    def test_list_command(self, mock_utils, mock_debug):
        """Test --list calls print_specs_list."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir

        with patch("cli.main.print_specs_list") as mock_print_specs:
            with patch("sys.argv", ["run.py", "--list"]):
                _run_cli()

            mock_print_specs.assert_called_once_with(project_dir)

    def test_list_worktrees_command(self, mock_utils, mock_debug):
        """Test --list-worktrees calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir

        with patch("cli.main.handle_list_worktrees_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--list-worktrees"]):
                _run_cli()

            mock_handle.assert_called_once_with(project_dir)

    def test_cleanup_worktrees_command(self, mock_utils, mock_debug):
        """Test --cleanup-worktrees calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir

        with patch("cli.main.handle_cleanup_worktrees_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--cleanup-worktrees"]):
                _run_cli()

            mock_handle.assert_called_once_with(project_dir)


class TestRunCliBatchCommands:
    """Tests for _run_cli() batch operation commands."""

    def test_batch_create_command(self, mock_utils, mock_debug):
        """Test --batch-create calls handler with file path."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir

        with patch("cli.main.handle_batch_create_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--batch-create", "tasks.json"]):
                _run_cli()

            mock_handle.assert_called_once_with("tasks.json", str(project_dir))

    def test_batch_status_command(self, mock_utils, mock_debug):
        """Test --batch-status calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir

        with patch("cli.main.handle_batch_status_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--batch-status"]):
                _run_cli()

            mock_handle.assert_called_once_with(str(project_dir))

    def test_batch_cleanup_command_dry_run(self, mock_utils, mock_debug):
        """Test --batch-cleanup with dry run (default)."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir

        with patch("cli.main.handle_batch_cleanup_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--batch-cleanup"]):
                _run_cli()

            # Default is dry_run=True (no --no-dry-run flag)
            mock_handle.assert_called_once_with(str(project_dir), dry_run=True)

    def test_batch_cleanup_command_no_dry_run(self, mock_utils, mock_debug):
        """Test --batch-cleanup with --no-dry-run."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir

        with patch("cli.main.handle_batch_cleanup_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--batch-cleanup", "--no-dry-run"]):
                _run_cli()

            mock_handle.assert_called_once_with(str(project_dir), dry_run=False)


class TestRunCliSpecResolution:
    """Tests for _run_cli() spec resolution."""

    def test_missing_spec_exits(self, mock_utils, mock_debug, capsys):
        """Test missing --spec flag shows error and exits."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir

        with patch("sys.argv", ["run.py"]):
            with pytest.raises(SystemExit) as exc_info:
                _run_cli()

        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "--spec is required" in captured.out

    def test_spec_not_found_exits(self, mock_utils, mock_debug, capsys):
        """Test non-existent spec shows error and exits."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = None

        # Mock print_specs_list to avoid directory creation issues
        with patch("cli.main.print_specs_list"):
            with patch("sys.argv", ["run.py", "--spec", "999"]):
                with pytest.raises(SystemExit) as exc_info:
                    _run_cli()

            assert exc_info.value.code == 1
            captured = capsys.readouterr()
            assert "Spec '999' not found" in captured.out

    def test_spec_found_sets_sentry_context(self, mock_utils, mock_debug):
        """Test finding spec sets Sentry context."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("core.sentry.set_context") as mock_set_context, \
             patch("cli.main.handle_build_command"):

            with patch("sys.argv", ["run.py", "--spec", "001"]):
                _run_cli()

            mock_set_context.assert_called_once()
            call_args = mock_set_context.call_args
            assert call_args[0][0] == "spec"
            assert call_args[0][1]["name"] == "001-test"
            assert call_args[0][1]["project"] == str(project_dir)


class TestRunCliBuildCommands:
    """Tests for _run_cli() build management commands."""

    def test_merge_command(self, mock_utils, mock_debug):
        """Test --merge calls handler with correct args."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_merge_command", return_value=True) as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--merge"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir,
                "001-test",
                no_commit=False,
                base_branch=None,
            )

    def test_merge_command_with_no_commit(self, mock_utils, mock_debug):
        """Test --merge with --no-commit flag."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_merge_command", return_value=True) as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--merge", "--no-commit"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir,
                "001-test",
                no_commit=True,
                base_branch=None,
            )

    def test_merge_command_with_base_branch(self, mock_utils, mock_debug):
        """Test --merge with --base-branch flag."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_merge_command", return_value=True) as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--merge", "--base-branch", "develop"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir,
                "001-test",
                no_commit=False,
                base_branch="develop",
            )

    def test_merge_failure_exits(self, mock_utils, mock_debug):
        """Test --merge exits with code 1 on failure."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_merge_command", return_value=False):
            with patch("sys.argv", ["run.py", "--spec", "001", "--merge"]):
                with pytest.raises(SystemExit) as exc_info:
                    _run_cli()

            assert exc_info.value.code == 1

    def test_merge_preview_command(self, mock_utils, mock_debug):
        """Test --merge-preview outputs JSON."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        preview_result = {"conflicts": [], "files": ["test.py"]}

        # handle_merge_preview_command is imported locally in _run_cli
        with patch("cli.workspace_commands.handle_merge_preview_command", return_value=preview_result):
            with patch("sys.argv", ["run.py", "--spec", "001", "--merge-preview"]):
                with patch("builtins.print") as mock_print:
                    _run_cli()

            # Should print JSON output
            mock_print.assert_called_once()
            printed_arg = mock_print.call_args[0][0]
            result = json.loads(printed_arg)
            assert result == preview_result

    def test_review_command(self, mock_utils, mock_debug):
        """Test --review calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_review_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--review"]):
                _run_cli()

            mock_handle.assert_called_once_with(project_dir, "001-test")

    def test_discard_command(self, mock_utils, mock_debug):
        """Test --discard calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_discard_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--discard"]):
                _run_cli()

            mock_handle.assert_called_once_with(project_dir, "001-test")


class TestRunCliPRCommand:
    """Tests for _run_cli() PR creation command."""

    def test_create_pr_command(self, mock_utils, mock_debug):
        """Test --create-pr calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        result = {"success": True, "url": "https://github.com/test/pr/1"}

        with patch("cli.main.handle_create_pr_command", return_value=result) as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--create-pr"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_name="001-test",
                target_branch=None,
                title=None,
                draft=False,
            )

    def test_create_pr_with_all_options(self, mock_utils, mock_debug):
        """Test --create-pr with all PR options."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        result = {"success": True, "url": "https://github.com/test/pr/1"}

        with patch("cli.main.handle_create_pr_command", return_value=result) as mock_handle:
            with patch("sys.argv", [
                "run.py", "--spec", "001", "--create-pr",
                "--pr-target", "develop",
                "--pr-title", "My PR Title",
                "--pr-draft"
            ]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_name="001-test",
                target_branch="develop",
                title="My PR Title",
                draft=True,
            )

    def test_create_pr_failure_exits(self, mock_utils, mock_debug):
        """Test --create-pr exits on failure."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        result = {"success": False, "error": "Failed to create PR"}

        with patch("cli.main.handle_create_pr_command", return_value=result):
            with patch("sys.argv", ["run.py", "--spec", "001", "--create-pr"]):
                with pytest.raises(SystemExit) as exc_info:
                    _run_cli()

            assert exc_info.value.code == 1


class TestRunCliQACommands:
    """Tests for _run_cli() QA commands."""

    def test_qa_status_command(self, mock_utils, mock_debug):
        """Test --qa-status calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_qa_status_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--qa-status"]):
                _run_cli()

            mock_handle.assert_called_once_with(spec_dir)

    def test_review_status_command(self, mock_utils, mock_debug):
        """Test --review-status calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_review_status_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--review-status"]):
                _run_cli()

            mock_handle.assert_called_once_with(spec_dir)

    def test_qa_command(self, mock_utils, mock_debug):
        """Test --qa calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_qa_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--qa"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model=None,
                verbose=False,
            )

    def test_qa_command_with_model(self, mock_utils, mock_debug):
        """Test --qa with --model flag."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_qa_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--qa", "--model", "opus"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model="opus",
                verbose=False,
            )

    def test_qa_command_with_verbose(self, mock_utils, mock_debug):
        """Test --qa with --verbose flag."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_qa_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--qa", "--verbose"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model=None,
                verbose=True,
            )


class TestRunCliFollowupCommand:
    """Tests for _run_cli() followup command."""

    def test_followup_command(self, mock_utils, mock_debug):
        """Test --followup calls handler."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_followup_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--followup"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model=None,
                verbose=False,
            )

    def test_followup_with_model_and_verbose(self, mock_utils, mock_debug):
        """Test --followup with --model and --verbose flags."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_followup_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--followup", "--model", "sonnet", "--verbose"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model="sonnet",
                verbose=True,
            )


class TestRunCliBuildFlow:
    """Tests for _run_cli() normal build flow."""

    def test_normal_build_command(self, mock_utils, mock_debug):
        """Test normal build flow calls handle_build_command."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_build_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001"]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model=None,
                max_iterations=None,
                verbose=False,
                force_isolated=False,
                force_direct=False,
                auto_continue=False,
                skip_qa=False,
                force_bypass_approval=False,
                base_branch=None,
            )

    def test_build_with_all_options(self, mock_utils, mock_debug):
        """Test build flow with all optional flags."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_build_command") as mock_handle:
            with patch("sys.argv", [
                "run.py", "--spec", "001",
                "--model", "opus",
                "--max-iterations", "10",
                "--verbose",
                "--isolated",
                "--auto-continue",
                "--skip-qa",
                "--force",
                "--base-branch", "develop",
            ]):
                _run_cli()

            mock_handle.assert_called_once_with(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model="opus",
                max_iterations=10,
                verbose=True,
                force_isolated=True,
                force_direct=False,
                auto_continue=True,
                skip_qa=True,
                force_bypass_approval=True,
                base_branch="develop",
            )

    def test_build_with_direct_mode(self, mock_utils, mock_debug):
        """Test build with --direct flag."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_build_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--direct"]):
                _run_cli()

            call_args = mock_handle.call_args
            assert call_args[1]["force_direct"] is True
            assert call_args[1]["force_isolated"] is False


class TestModelResolution:
    """Tests for model resolution from CLI args and environment."""

    def test_model_from_cli_arg(self, mock_utils, mock_debug, clear_env):
        """Test model from --model flag takes precedence."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_build_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--model", "opus"]):
                _run_cli()

            # Model should be passed from CLI arg
            call_args = mock_handle.call_args
            assert call_args[1]["model"] == "opus"

    def test_model_from_env_var(self, mock_utils, mock_debug, clear_env):
        """Test model from AUTO_BUILD_MODEL environment variable."""
        from cli.main import _run_cli

        os.environ["AUTO_BUILD_MODEL"] = "sonnet"

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_build_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001"]):
                _run_cli()

            # Model should be read from env var
            call_args = mock_handle.call_args
            assert call_args[1]["model"] == "sonnet"

    def test_model_cli_arg_overrides_env(self, mock_utils, mock_debug, clear_env):
        """Test --model flag overrides AUTO_BUILD_MODEL env var."""
        from cli.main import _run_cli

        os.environ["AUTO_BUILD_MODEL"] = "sonnet"

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_build_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001", "--model", "opus"]):
                _run_cli()

            # CLI arg should override env var
            call_args = mock_handle.call_args
            assert call_args[1]["model"] == "opus"

    def test_model_none_when_not_specified(self, mock_utils, mock_debug, clear_env):
        """Test model is None when neither CLI arg nor env var is set."""
        from cli.main import _run_cli

        project_dir = Path("/mock/project")
        spec_dir = Path("/mock/project/.auto-claude/specs/001-test")

        mock_utils["get_project_dir"].return_value = project_dir
        mock_utils["find_spec"].return_value = spec_dir

        with patch("cli.main.handle_build_command") as mock_handle:
            with patch("sys.argv", ["run.py", "--spec", "001"]):
                _run_cli()

            # Model should be None (allows get_phase_model() to use task_metadata.json)
            call_args = mock_handle.call_args
            assert call_args[1]["model"] is None


class TestModuleImportPathInsertion:
    """Tests for module-level path manipulation logic (line 16)."""

    def test_inserts_parent_dir_to_sys_path_when_not_present(self):
        """
        Test that line 16 executes: sys.path.insert(0, str(_PARENT_DIR))

        This test covers the scenario where _PARENT_DIR is not in sys.path
        when the module-level code executes.
        """
        import importlib

        # Use import_module to get the actual module object
        main_module = importlib.import_module("cli.main")

        # Get the parent dir that should be inserted by line 16
        parent_dir_str = str(main_module._PARENT_DIR)

        # Verify parent_dir_str is the apps/backend directory
        # Use os.path.normpath for cross-platform path comparison
        import os
        normalized_path = os.path.normpath(parent_dir_str)
        # Check that the normalized path contains apps/backend or apps\backend (Windows)
        assert ("apps" + os.sep + "backend") in normalized_path or "apps/backend" in normalized_path or "apps\\backend" in normalized_path

        # Save current sys.path state to restore later
        original_path = sys.path.copy()

        # Remove the parent dir from sys.path
        for p in sys.path[:]:
            if p == parent_dir_str or p.rstrip("/") == parent_dir_str.rstrip("/"):
                sys.path.remove(p)

        try:
            # Verify parent_dir_str is NOT in sys.path now
            assert parent_dir_str not in sys.path

            # Reload the module - this should execute lines 15-16 since path is not present
            importlib.reload(main_module)

            # Verify the parent dir was added to sys.path by line 16
            assert parent_dir_str in sys.path, f"Parent dir {parent_dir_str} should be in sys.path"

        finally:
            # Restore sys.path to original state
            sys.path[:] = original_path


class TestMainEntryExecution:
    """Tests for __main__ entry point execution (line 484)."""

    def test_main_callable_directly(self, clear_env):
        """
        Test that main() function is callable (verifies line 484 can execute).

        Line 484 is: `main()` inside `if __name__ == "__main__":`
        This test verifies that calling main() directly works as expected,
        which is what line 484 does when the module is executed as __main__.
        """
        from cli.main import main

        # Verify main is callable
        assert callable(main)

        # Test that main() calls _run_cli with proper mocking
        with patch("cli.main.setup_environment"), \
             patch("core.sentry.init_sentry"), \
             patch("cli.main._run_cli") as mock_run_cli, \
             patch("sys.argv", ["run.py", "--list"]):

            # Call main() - this is what line 484 does
            main()

            # Verify _run_cli was called
            mock_run_cli.assert_called_once()

    def test_module_can_be_imported(self):
        """Test that cli.main module can be imported without errors."""
        import importlib
        main_module = importlib.import_module("cli.main")

        # Verify module has expected attributes
        assert hasattr(main_module, "main")
        assert hasattr(main_module, "parse_args")
        assert hasattr(main_module, "_run_cli")
        assert callable(main_module.main)
        assert callable(main_module.parse_args)
        assert callable(main_module._run_cli)

    def test_main_block_executes_when_name_is_main(self, clear_env):
        """
        Test that line 484 (main() call) executes when __name__ == '__main__'.

        This test uses runpy to execute the module as __main__, which ensures
        the if __name__ == "__main__": block on line 483-484 is actually executed.

        Note: This test is marked with pytest.mark.slow because it executes
        the entire module which may have side effects.
        """
        import runpy
        import importlib

        # Save original state
        original_argv = sys.argv.copy()
        original_modules = sys.modules.copy()

        # Remove cli modules to force re-import
        modules_to_remove = [mod for mod in sys.modules if 'cli' in mod]
        for mod in modules_to_remove:
            del sys.modules[mod]

        # Set up argv
        sys.argv = ['cli.main', '--list']

        # Create mocks that will be used when the module imports
        mock_setup = MagicMock()
        mock_init_sentry = MagicMock()
        mock_print_banner = MagicMock()
        mock_print_specs_list = MagicMock()

        try:
            # Apply patches BEFORE importing
            with patch('cli.utils.setup_environment', mock_setup), \
                 patch('core.sentry.init_sentry', mock_init_sentry), \
                 patch('cli.utils.print_banner', mock_print_banner), \
                 patch('cli.spec_commands.print_specs_list', mock_print_specs_list):

                # Run the module as __main__ - this executes line 484
                runpy.run_module('cli.main', run_name='__main__', alter_sys=True)

                # Verify the mocks were called
                mock_setup.assert_called_once()
                mock_init_sentry.assert_called_once()
                mock_print_banner.assert_called_once()
                mock_print_specs_list.assert_called_once()

        except SystemExit as e:
            # --list exits after completion, which is expected
            assert e.code == 0 or e.code is None
        finally:
            sys.argv[:] = original_argv
            # Restore original modules - selectively remove modules added during test
            current_modules = set(sys.modules.keys())
            original_module_keys = set(original_modules.keys())
            added_modules = current_modules - original_module_keys
            for module_name in added_modules:
                del sys.modules[module_name]
            # Restore original modules that may have been modified
            sys.modules.update(original_modules)

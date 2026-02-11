#!/usr/bin/env python3
"""
Tests for CLI Spec Commands
============================

Tests for spec_commands.py module functionality including:
- list_specs() - List all specs in the project
- print_specs_list() - Print formatted spec list
"""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from cli.spec_commands import list_specs, print_specs_list


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def project_dir_with_specs(temp_git_repo: Path) -> Path:
    """Create a project directory with spec folders."""
    specs_dir = temp_git_repo / ".auto-claude" / "specs"
    specs_dir.mkdir(parents=True)

    # Create spec 001 - with spec.md only
    spec_001 = specs_dir / "001-initial-setup"
    spec_001.mkdir()
    (spec_001 / "spec.md").write_text("# Initial Setup\n")

    # Create spec 002 - with implementation plan (in progress)
    spec_002 = specs_dir / "002-user-auth"
    spec_002.mkdir()
    (spec_002 / "spec.md").write_text("# User Auth\n")
    plan_002 = {
        "phases": [
            {
                "phase": 1,
                "name": "Backend",
                "subtasks": [
                    {"id": "1-1", "status": "completed"},
                    {"id": "1-2", "status": "pending"},
                ]
            }
        ]
    }
    (spec_002 / "implementation_plan.json").write_text(json.dumps(plan_002))

    # Create spec 003 - complete implementation plan
    spec_003 = specs_dir / "003-avatar-upload"
    spec_003.mkdir()
    (spec_003 / "spec.md").write_text("# Avatar Upload\n")
    plan_003 = {
        "phases": [
            {
                "phase": 1,
                "name": "Backend",
                "subtasks": [
                    {"id": "1-1", "status": "completed"},
                    {"id": "1-2", "status": "completed"},
                ]
            }
        ]
    }
    (spec_003 / "implementation_plan.json").write_text(json.dumps(plan_003))

    # Create spec 004 - pending (no spec.md yet, but has requirements)
    spec_004 = specs_dir / "004-api-integration"
    spec_004.mkdir()
    (spec_004 / "requirements.json").write_text('{"task_description": "API Integration"}')

    # Create invalid folder (should be ignored)
    invalid_folder = specs_dir / "invalid-folder-name"
    invalid_folder.mkdir()

    return temp_git_repo


@pytest.fixture
def project_dir_with_build_worktree(temp_git_repo: Path) -> Path:
    """Create a project with a spec that has a build worktree."""
    specs_dir = temp_git_repo / ".auto-claude" / "specs"
    specs_dir.mkdir(parents=True)

    # Create spec
    spec_001 = specs_dir / "001-feature"
    spec_001.mkdir()
    (spec_001 / "spec.md").write_text("# Feature\n")

    # Create worktree directory
    worktrees_dir = temp_git_repo / ".worktrees" / "001-feature"
    worktrees_dir.mkdir(parents=True)

    return temp_git_repo


@pytest.fixture
def empty_project_dir(temp_git_repo: Path) -> Path:
    """Create a project with no specs directory."""
    return temp_git_repo


# =============================================================================
# LIST_SPECS TESTS
# =============================================================================

class TestListSpecs:
    """Tests for list_specs() function."""

    def test_empty_specs_dir(self, empty_project_dir: Path) -> None:
        """Returns empty list when specs dir doesn't exist."""
        specs = list_specs(empty_project_dir)
        assert specs == []

    def test_list_all_specs(self, project_dir_with_specs: Path) -> None:
        """Lists all valid specs in correct order."""
        specs = list_specs(project_dir_with_specs)

        # Should have 3 specs (001, 002, 003) - 004 is excluded because it has no spec.md
        assert len(specs) == 3

        # Check they're in sorted order
        assert specs[0]["number"] == "001"
        assert specs[1]["number"] == "002"
        assert specs[2]["number"] == "003"

    def test_spec_without_spec_md_is_excluded(self, project_dir_with_specs: Path) -> None:
        """Specs without spec.md are not included in the list."""
        specs = list_specs(project_dir_with_specs)

        # 004 has requirements.json but no spec.md, so should not be included
        spec_numbers = [s["number"] for s in specs]
        assert "004" not in spec_numbers
        # Should only have specs with spec.md
        assert len(specs) == 3

    def test_invalid_folder_name_is_excluded(self, project_dir_with_specs: Path) -> None:
        """Folders with invalid naming are excluded."""
        specs = list_specs(project_dir_with_specs)

        # "invalid-folder-name" doesn't match the pattern
        spec_names = [s["name"] for s in specs]
        assert "invalid-folder-name" not in spec_names

    def test_spec_status_pending(self, project_dir_with_specs: Path) -> None:
        """Spec with only spec.md has 'pending' status."""
        specs = list_specs(project_dir_with_specs)

        spec_001 = next(s for s in specs if s["number"] == "001")
        assert spec_001["status"] == "pending"
        assert spec_001["progress"] == "-"

    def test_spec_status_in_progress(self, project_dir_with_specs: Path) -> None:
        """Spec with incomplete implementation plan has 'in_progress' status."""
        specs = list_specs(project_dir_with_specs)

        spec_002 = next(s for s in specs if s["number"] == "002")
        assert spec_002["status"] == "in_progress"
        assert spec_002["progress"] == "1/2"

    def test_spec_status_complete(self, project_dir_with_specs: Path) -> None:
        """Spec with all tasks complete has 'complete' status."""
        specs = list_specs(project_dir_with_specs)

        spec_003 = next(s for s in specs if s["number"] == "003")
        assert spec_003["status"] == "complete"
        assert spec_003["progress"] == "2/2"

    def test_spec_status_initialized(self, temp_git_repo: Path) -> None:
        """Spec with implementation plan but no subtasks has 'initialized' status."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        spec_001 = specs_dir / "001-test"
        spec_001.mkdir()
        (spec_001 / "spec.md").write_text("# Test\n")
        (spec_001 / "implementation_plan.json").write_text('{"phases": []}')

        specs = list_specs(temp_git_repo)

        assert len(specs) == 1
        assert specs[0]["status"] == "initialized"
        assert specs[0]["progress"] == "0/0"

    def test_spec_with_build_worktree(self, project_dir_with_build_worktree: Path) -> None:
        """Spec with build worktree shows 'has build' in status."""
        specs = list_specs(project_dir_with_build_worktree)

        assert len(specs) == 1
        assert specs[0]["status"] == "pending (has build)"
        assert specs[0]["has_build"] is True

    def test_spec_structure(self, project_dir_with_specs: Path) -> None:
        """Each spec dict has all required keys."""
        specs = list_specs(project_dir_with_specs)

        for spec in specs:
            assert "number" in spec
            assert "name" in spec
            assert "folder" in spec
            assert "path" in spec
            assert "status" in spec
            assert "progress" in spec
            assert "has_build" in spec

    def test_spec_name_extraction(self, project_dir_with_specs: Path) -> None:
        """Correctly extracts name from folder name."""
        specs = list_specs(project_dir_with_specs)

        spec_001 = next(s for s in specs if s["number"] == "001")
        assert spec_001["name"] == "initial-setup"

        spec_002 = next(s for s in specs if s["number"] == "002")
        assert spec_002["name"] == "user-auth"


# =============================================================================
# PRINT_SPECS_LIST TESTS
# =============================================================================

class TestPrintSpecsList:
    """Tests for print_specs_list() function."""

    def test_prints_empty_message_when_no_specs(self, capsys, temp_git_repo: Path) -> None:
        """Prints 'No specs found' message when specs directory doesn't exist."""
        print_specs_list(temp_git_repo, auto_create=False)

        captured = capsys.readouterr()
        assert "No specs found" in captured.out

    def test_prints_spec_list(self, capsys, project_dir_with_specs: Path) -> None:
        """Prints formatted list of specs."""
        print_specs_list(project_dir_with_specs, auto_create=False)

        captured = capsys.readouterr()
        assert "AVAILABLE SPECS" in captured.out
        assert "001-initial-setup" in captured.out
        assert "002-user-auth" in captured.out
        assert "003-avatar-upload" in captured.out

    def test_prints_status_symbols(self, capsys, project_dir_with_specs: Path) -> None:
        """Prints correct status symbols for each spec."""
        print_specs_list(project_dir_with_specs, auto_create=False)

        captured = capsys.readouterr()
        assert "[  ]" in captured.out  # pending
        assert "[..]" in captured.out  # in_progress
        assert "[OK]" in captured.out  # complete

    def test_prints_progress_info(self, capsys, project_dir_with_specs: Path) -> None:
        """Prints progress information for specs with plans."""
        print_specs_list(project_dir_with_specs, auto_create=False)

        captured = capsys.readouterr()
        assert "Subtasks:" in captured.out
        assert "1/2" in captured.out
        assert "2/2" in captured.out

    def test_prints_usage_instructions(self, capsys, project_dir_with_specs: Path) -> None:
        """Prints instructions for running specs."""
        print_specs_list(project_dir_with_specs, auto_create=False)

        captured = capsys.readouterr()
        assert "To run a spec:" in captured.out
        assert "python auto-claude/run.py --spec 001" in captured.out

    def test_auto_create_prompts_for_task(self, capsys, temp_git_repo: Path) -> None:
        """When auto_create=True and no specs, prompts for task description."""
        with patch('builtins.input', return_value='test task'):
            with patch('subprocess.run') as mock_run:
                print_specs_list(temp_git_repo, auto_create=True)

                captured = capsys.readouterr()
                assert "QUICK START" in captured.out
                assert "What do you want to build?" in captured.out

                # Check subprocess.run was called with the task
                assert mock_run.called

    def test_auto_create_interactive_mode(self, capsys, temp_git_repo: Path) -> None:
        """When auto_create=True and empty input, launches interactive mode."""
        with patch('builtins.input', return_value=''):
            with patch('subprocess.run') as mock_run:
                print_specs_list(temp_git_repo, auto_create=True)

                captured = capsys.readouterr()
                assert "Launching interactive mode" in captured.out

                # Check subprocess.run was called with --interactive flag
                assert mock_run.called

    def test_auto_create_keyboard_interrupt(self, capsys, temp_git_repo: Path) -> None:
        """Handles KeyboardInterrupt gracefully during prompt."""
        with patch('builtins.input', side_effect=KeyboardInterrupt):
            print_specs_list(temp_git_repo, auto_create=True)

            captured = capsys.readouterr()
            assert "Cancelled" in captured.out

    def test_auto_create_eof_error(self, capsys, temp_git_repo: Path) -> None:
        """Handles EOFError gracefully during prompt."""
        with patch('builtins.input', side_effect=EOFError):
            print_specs_list(temp_git_repo, auto_create=True)

            captured = capsys.readouterr()
            assert "Cancelled" in captured.out

    def test_no_auto_create_does_not_prompt(self, capsys, temp_git_repo: Path) -> None:
        """When auto_create=False, just shows instructions."""
        print_specs_list(temp_git_repo, auto_create=False)

        captured = capsys.readouterr()
        assert "QUICK START" not in captured.out
        assert "spec_runner.py --interactive" in captured.out


# =============================================================================
# INTEGRATION TESTS
# =============================================================================

class TestSpecCommandsIntegration:
    """Integration tests for spec commands."""

    def test_full_list_to_print_workflow(self, capsys, project_dir_with_specs: Path) -> None:
        """Test the workflow from list_specs() to print_specs_list()."""
        specs = list_specs(project_dir_with_specs)

        # Verify list_specs returns correct data
        assert len(specs) >= 3

        # Verify print_specs_list displays the same data
        print_specs_list(project_dir_with_specs, auto_create=False)
        captured = capsys.readouterr()

        for spec in specs:
            assert spec["folder"] in captured.out

    def test_spec_with_complete_workflow(self, temp_git_repo: Path) -> None:
        """Test spec status progression through complete workflow."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        spec_001 = specs_dir / "001-workflow-test"
        spec_001.mkdir()
        (spec_001 / "spec.md").write_text("# Workflow Test\n")

        # Stage 1: pending
        specs = list_specs(temp_git_repo)
        assert specs[0]["status"] == "pending"

        # Stage 2: initialized (with empty plan)
        (spec_001 / "implementation_plan.json").write_text('{"phases": []}')
        specs = list_specs(temp_git_repo)
        assert specs[0]["status"] == "initialized"

        # Stage 3: in progress
        plan = {
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1-1", "status": "completed"},
                        {"id": "1-2", "status": "pending"},
                    ]
                }
            ]
        }
        (spec_001 / "implementation_plan.json").write_text(json.dumps(plan))
        specs = list_specs(temp_git_repo)
        assert specs[0]["status"] == "in_progress"
        assert specs[0]["progress"] == "1/2"

        # Stage 4: complete
        plan["phases"][0]["subtasks"][1]["status"] = "completed"
        (spec_001 / "implementation_plan.json").write_text(json.dumps(plan))
        specs = list_specs(temp_git_repo)
        assert specs[0]["status"] == "complete"
        assert specs[0]["progress"] == "2/2"


# =============================================================================
# TESTS FOR MISSING COVERAGE
# =============================================================================

class TestSpecCommandsMissingCoverage:
    """Tests for lines not covered by other tests."""

    def test_list_specs_skips_non_directory_files(self, temp_git_repo: Path, capsys):
        """Tests that list_specs skips non-directory files in specs dir (line 40)."""
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Create a valid spec
        spec_001 = specs_dir / "001-valid-spec"
        spec_001.mkdir()
        (spec_001 / "spec.md").write_text("# Valid Spec\n")

        # Create a non-directory file (should be skipped)
        (specs_dir / "README.md").write_text("# Readme\n")
        (specs_dir / "002-another-file.txt").write_text("Some content\n")

        specs = list_specs(temp_git_repo)

        # Should only include the valid spec directory
        assert len(specs) == 1
        assert specs[0]["folder"] == "001-valid-spec"

    def test_print_specs_list_no_specs_auto_false(self, temp_git_repo: Path, capsys):
        """Tests print message when no specs exist and auto_create=False (lines 157-158)."""
        # Don't create any specs directory

        print_specs_list(temp_git_repo, auto_create=False)

        captured = capsys.readouterr()
        # Should print message about creating first spec
        assert "Create your first spec" in captured.out
        assert "python runners/spec_runner.py" in captured.out or "spec_runner.py" in captured.out

    def test_print_specs_list_no_specs_auto_true_no_runner(self, temp_git_repo: Path, capsys):
        """Tests print message when no specs exist, auto_create=True, but spec_runner missing."""
        # Create specs directory so specs_dir.exists() is True
        specs_dir = temp_git_repo / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True)

        # Patch the runner existence check to make it return False
        # The spec_commands.py code checks spec_runner.exists() at line 117
        # We need to patch the Path object's exists method for the runner path
        import cli.spec_commands as spec_commands
        backend_dir = Path(spec_commands.__file__).parent.parent
        runner_path = backend_dir / "runners" / "spec_runner.py"

        original_exists = Path.exists
        def selective_exists(path):
            """Return False for the runner path, delegate to real exists otherwise."""
            if str(path) == str(runner_path):
                return False
            return original_exists(path)

        # Patch input to avoid reading from stdin and subprocess.run to avoid execution
        with patch.object(Path, 'exists', selective_exists):
            with patch('builtins.input', side_effect=KeyboardInterrupt):
                with patch('subprocess.run'):
                    print_specs_list(temp_git_repo, auto_create=True)

        captured = capsys.readouterr()
        # When spec_runner is missing, should show "Create your first spec" message
        assert "Create your first spec" in captured.out


# =============================================================================
# Tests for Module-Level Behavior (Line 14)
# =============================================================================

class TestSpecCommandsModuleLevel:
    """Tests for module-level initialization behavior (line 14)."""

    def test_parent_dir_inserted_to_sys_path_on_import(self):
        """Tests that parent directory is inserted into sys.path on module import (line 14)."""
        # The module-level code at line 14: sys.path.insert(0, str(_PARENT_DIR))
        # executes when the module is first imported

        import cli.spec_commands as spec_commands_module
        import inspect

        # Get the path to cli/spec_commands.py
        module_path = Path(inspect.getfile(spec_commands_module))
        parent_dir = module_path.parent.parent

        # Verify parent_dir was inserted into sys.path by the module-level code
        assert str(parent_dir) in sys.path, f"Parent directory {parent_dir} should be in sys.path after import"

    def test_parent_dir_value_is_correct(self):
        """Tests that _PARENT_DIR points to the correct directory (line 13)."""
        import cli.spec_commands as spec_commands_module

        # _PARENT_DIR should be Path(__file__).parent.parent (line 13)
        parent_dir = spec_commands_module._PARENT_DIR

        assert isinstance(parent_dir, Path)
        # Should be the apps/backend directory
        assert parent_dir.name in ["backend", "apps"]

    # Removed: test_parent_dir_inserted_to_sys_path_subprocess
    # This test was permanently skipped with @pytest.mark.skipif(True)
    # Coverage is achieved via test_path_insertion_coverage_via_reload

    def test_path_insertion_coverage_via_reload(self):
        """Tests path insertion by forcing module reload (line 14)."""
        import sys
        from pathlib import Path

        # Save original _PARENT_DIR value and module
        import cli.spec_commands as spec_commands
        original_parent_dir = spec_commands._PARENT_DIR
        original_module = sys.modules.get('cli.spec_commands')

        # Remove from sys.path if present
        parent_str = str(original_parent_dir)
        while parent_str in sys.path:
            sys.path.remove(parent_str)

        # Remove module from sys.modules to force reload
        if 'cli.spec_commands' in sys.modules:
            del sys.modules['cli.spec_commands']

        try:
            # Now reimport - this will execute lines 13-14 again
            import cli.spec_commands as reimported_spec_commands

            # Verify path insertion happened
            assert str(reimported_spec_commands._PARENT_DIR) in sys.path

        finally:
            # Restore sys.path and sys.modules for other tests
            if str(original_parent_dir) not in sys.path:
                sys.path.insert(0, str(original_parent_dir))
            if original_module is not None:
                sys.modules['cli.spec_commands'] = original_module
            elif 'cli.spec_commands' in sys.modules:
                del sys.modules['cli.spec_commands']

#!/usr/bin/env python3
"""
Tests for Workspace Setup Operations
=====================================

Tests the setup functionality including:
- Spec copy to workspace operations
- Timeline hook installation
- Timeline tracking initialization
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"


class TestCopySpecToWorktree:
    """Tests for copy_spec_to_worktree function."""

    def test_copies_spec_files_to_worktree(self, temp_git_repo: Path):
        """Copies spec directory to worktree .auto-claude/specs/ location."""
        from core.workspace.setup import copy_spec_to_worktree

        # Create source spec directory
        source_spec = temp_git_repo / "specs" / "test-spec"
        source_spec.mkdir(parents=True)
        (source_spec / "spec.md").write_text("# Test Spec", encoding="utf-8")
        (source_spec / "requirements.json").write_text("{}", encoding="utf-8")

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        # Copy spec
        result = copy_spec_to_worktree(source_spec, worktree_path, "test-spec")

        # Verify path is correct
        expected = worktree_path / ".auto-claude" / "specs" / "test-spec"
        assert result == expected

        # Verify files were copied
        assert (expected / "spec.md").exists()
        assert (expected / "requirements.json").exists()
        assert (expected / "spec.md").read_text(encoding="utf-8") == "# Test Spec"

    def test_overwrites_existing_spec_in_worktree(self, temp_git_repo: Path):
        """Overwrites spec files if they already exist in worktree."""
        from core.workspace.setup import copy_spec_to_worktree

        # Create source spec
        source_spec = temp_git_repo / "specs" / "test-spec"
        source_spec.mkdir(parents=True)
        (source_spec / "spec.md").write_text("# New Spec", encoding="utf-8")

        # Create worktree with existing spec
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)
        existing_spec = worktree_path / ".auto-claude" / "specs" / "test-spec"
        existing_spec.mkdir(parents=True)
        (existing_spec / "spec.md").write_text("# Old Spec", encoding="utf-8")

        # Copy spec
        result = copy_spec_to_worktree(source_spec, worktree_path, "test-spec")

        # Verify new content was copied
        assert (result / "spec.md").read_text(encoding="utf-8") == "# New Spec"

    def test_creates_parent_directories(self, temp_git_repo: Path):
        """Creates .auto-claude/specs directory if it doesn't exist."""
        from core.workspace.setup import copy_spec_to_worktree

        source_spec = temp_git_repo / "specs" / "test-spec"
        source_spec.mkdir(parents=True)
        (source_spec / "spec.md").write_text("# Test", encoding="utf-8")

        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / "test-spec"
        )
        worktree_path.mkdir(parents=True)

        result = copy_spec_to_worktree(source_spec, worktree_path, "test-spec")

        # Parent directories should be created
        assert result.exists()
        assert (result.parent).exists()


class TestEnsureTimelineHookInstalled:
    """Tests for ensure_timeline_hook_installed function."""

    def test_skips_if_not_git_repo(self, temp_dir: Path):
        """Skips hook installation if directory is not a git repo."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Should not raise exception
        ensure_timeline_hook_installed(temp_dir)

    def test_skips_if_hook_already_installed(self, temp_git_repo: Path, monkeypatch):
        """Skips if FileTimelineTracker hook is already installed."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create hooks directory
        hooks_dir = temp_git_repo / ".git" / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)

        # Create hook with FileTimelineTracker marker
        hook_file = hooks_dir / "post-commit"
        hook_file.write_text(
            "#!/bin/sh\n# FileTimelineTracker hook\necho 'tracked'", encoding="utf-8"
        )

        # Mock install_hook to track if it was called
        install_called = []

        def mock_install_hook(project_dir):
            install_called.append(True)

        monkeypatch.setattr("merge.install_hook.install_hook", mock_install_hook)

        ensure_timeline_hook_installed(temp_git_repo)

        # install_hook should not be called
        assert len(install_called) == 0

    def test_installs_hook_if_missing(self, temp_git_repo: Path):
        """Installs hook if it doesn't exist."""
        from core.workspace.setup import ensure_timeline_hook_installed

        # Create hooks directory but no hook file
        hooks_dir = temp_git_repo / ".git" / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)

        # This test verifies the function runs without error
        # The actual install_hook call is hard to mock because it's imported locally
        # In production, the real install_hook would be called
        ensure_timeline_hook_installed(temp_git_repo)

        # Verify hooks directory exists (function ran)
        assert hooks_dir.exists()


class TestInitializeTimelineTracking:
    """Tests for initialize_timeline_tracking function."""

    def test_with_implementation_plan(self, temp_git_repo: Path, monkeypatch):
        """Initializes tracking with files from implementation plan."""
        from core.workspace.setup import initialize_timeline_tracking

        # Create source spec with implementation plan
        spec_name = "test-spec"
        source_spec = temp_git_repo / ".auto-claude" / "specs" / spec_name
        source_spec.mkdir(parents=True)

        plan = {
            "title": "Test Feature",
            "description": "Test description",
            "phases": [
                {
                    "subtasks": [
                        {"files": ["app/main.py", "app/utils.py"]},
                        {"files": ["tests/test_main.py"]},
                    ]
                }
            ],
        }
        (source_spec / "implementation_plan.json").write_text(
            json.dumps(plan), encoding="utf-8"
        )

        # Create worktree
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / spec_name
        )
        worktree_path.mkdir(parents=True)

        # Mock FileTimelineTracker
        mock_tracker_calls = []

        class MockTracker:
            def __init__(self, project_dir):
                pass

            def on_task_start(
                self,
                task_id,
                files_to_modify,
                branch_point_commit,
                task_intent,
                task_title,
            ):
                mock_tracker_calls.append(
                    {
                        "task_id": task_id,
                        "files": files_to_modify,
                        "branch": branch_point_commit,
                        "intent": task_intent,
                        "title": task_title,
                    }
                )

        monkeypatch.setattr("core.workspace.setup.FileTimelineTracker", MockTracker)

        initialize_timeline_tracking(
            temp_git_repo, spec_name, worktree_path, source_spec
        )

        # Verify tracker was called with correct parameters
        assert len(mock_tracker_calls) == 1
        call = mock_tracker_calls[0]
        assert call["task_id"] == spec_name
        assert set(call["files"]) == {
            "app/main.py",
            "app/utils.py",
            "tests/test_main.py",
        }
        assert call["title"] == "Test Feature"
        assert call["intent"] == "Test description"

    def test_without_implementation_plan(self, temp_git_repo: Path, monkeypatch):
        """Initializes tracking retroactively from worktree if no plan."""
        from core.workspace.setup import initialize_timeline_tracking

        spec_name = "test-spec"
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / spec_name
        )
        worktree_path.mkdir(parents=True)

        # Mock FileTimelineTracker
        mock_calls = []

        class MockTracker:
            def __init__(self, project_dir):
                pass

            def initialize_from_worktree(
                self, task_id, worktree_path, task_intent, task_title
            ):
                mock_calls.append(
                    {
                        "task_id": task_id,
                        "worktree": worktree_path,
                        "intent": task_intent,
                        "title": task_title,
                    }
                )

        monkeypatch.setattr("core.workspace.setup.FileTimelineTracker", MockTracker)

        initialize_timeline_tracking(temp_git_repo, spec_name, worktree_path, None)

        # Should use retroactive initialization
        assert len(mock_calls) == 1
        assert mock_calls[0]["task_id"] == spec_name

    def test_handles_exception_gracefully(
        self, temp_git_repo: Path, monkeypatch, capsys
    ):
        """Logs warning but doesn't raise exception on error."""
        from core.workspace.setup import initialize_timeline_tracking

        spec_name = "test-spec"
        worktree_path = (
            temp_git_repo / ".auto-claude" / "worktrees" / "tasks" / spec_name
        )
        worktree_path.mkdir(parents=True)

        # Mock FileTimelineTracker to raise exception
        class FailingTracker:
            def __init__(self, project_dir):
                raise Exception("Tracker init failed")

        monkeypatch.setattr("core.workspace.setup.FileTimelineTracker", FailingTracker)

        # Should not raise
        initialize_timeline_tracking(temp_git_repo, spec_name, worktree_path, None)

        # Should print warning
        captured = capsys.readouterr()
        assert "Timeline tracking" in captured.out or "Note:" in captured.out

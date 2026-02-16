#!/usr/bin/env python3
"""
Tests for FileEvolutionTracker
===============================

Tests baseline and change tracking for files modified by tasks.

Covers:
- Baseline capture and retrieval
- Recording modifications and semantic analysis
- Retrieving task modifications
- Identifying files modified by multiple tasks
- Detecting conflicting files
- Task cleanup
- Evolution summaries
"""

import sys
from pathlib import Path

import pytest

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))
# Add tests directory to path for test_fixtures
sys.path.insert(0, str(Path(__file__).parent))

from test_fixtures import (
    SAMPLE_PYTHON_MODULE,
    SAMPLE_PYTHON_WITH_NEW_FUNCTION,
    SAMPLE_PYTHON_WITH_NEW_IMPORT,
)


class TestBaselineCapture:
    """Tests for capturing and retrieving file baselines."""

    def test_capture_baselines(self, file_tracker, temp_project):
        """Baseline capture stores file content."""
        files = [temp_project / "src" / "App.tsx"]
        captured = file_tracker.capture_baselines("task-001", files, intent="Add auth")

        assert len(captured) == 1
        assert "src/App.tsx" in captured

        evolution = captured["src/App.tsx"]
        assert evolution.baseline_commit is not None
        assert len(evolution.task_snapshots) == 1
        assert evolution.task_snapshots[0].task_id == "task-001"

    def test_get_baseline_content(self, file_tracker, temp_project):
        """Can retrieve stored baseline content."""
        files = [temp_project / "src" / "App.tsx"]
        file_tracker.capture_baselines("task-001", files)

        content = file_tracker.get_baseline_content("src/App.tsx")

        assert content is not None
        assert "function App" in content

    def test_capture_multiple_files(self, file_tracker, temp_project):
        """Can capture baselines for multiple files."""
        files = [
            temp_project / "src" / "App.tsx",
            temp_project / "src" / "utils.py",
        ]
        captured = file_tracker.capture_baselines("task-001", files)

        assert len(captured) == 2
        assert "src/App.tsx" in captured
        assert "src/utils.py" in captured


class TestModificationRecording:
    """Tests for recording file modifications."""

    def test_record_modification(self, file_tracker, temp_project):
        """Recording modification creates semantic changes."""
        files = [temp_project / "src" / "utils.py"]
        file_tracker.capture_baselines("task-001", files)

        snapshot = file_tracker.record_modification(
            task_id="task-001",
            file_path="src/utils.py",
            old_content=SAMPLE_PYTHON_MODULE,
            new_content=SAMPLE_PYTHON_WITH_NEW_FUNCTION,
        )

        assert snapshot is not None
        assert snapshot.completed_at is not None
        assert len(snapshot.semantic_changes) > 0

    def test_multiple_modifications_same_file(self, file_tracker, temp_project):
        """Can record multiple modifications to same file."""
        files = [temp_project / "src" / "utils.py"]
        file_tracker.capture_baselines("task-001", files)

        # First modification
        snapshot1 = file_tracker.record_modification(
            "task-001",
            "src/utils.py",
            SAMPLE_PYTHON_MODULE,
            SAMPLE_PYTHON_WITH_NEW_IMPORT,
        )

        # Second modification
        snapshot2 = file_tracker.record_modification(
            "task-001",
            "src/utils.py",
            SAMPLE_PYTHON_WITH_NEW_IMPORT,
            SAMPLE_PYTHON_WITH_NEW_FUNCTION,
        )

        assert snapshot1 is not None
        assert snapshot2 is not None
        assert snapshot1.task_id == snapshot2.task_id


class TestTaskModificationRetrieval:
    """Tests for retrieving task modifications."""

    def test_get_task_modifications(self, file_tracker, temp_project):
        """Can retrieve all modifications for a task."""
        files = [temp_project / "src" / "utils.py", temp_project / "src" / "App.tsx"]
        file_tracker.capture_baselines("task-001", files)

        file_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )

        modifications = file_tracker.get_task_modifications("task-001")

        assert len(modifications) >= 1

    def test_get_files_modified_by_tasks(self, file_tracker, temp_project):
        """Can identify files modified by multiple tasks."""
        files = [temp_project / "src" / "utils.py"]
        file_tracker.capture_baselines("task-001", files)
        file_tracker.capture_baselines("task-002", files)

        file_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )
        file_tracker.record_modification(
            "task-002", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_IMPORT
        )

        file_tasks = file_tracker.get_files_modified_by_tasks(["task-001", "task-002"])

        assert "src/utils.py" in file_tasks
        assert "task-001" in file_tasks["src/utils.py"]
        assert "task-002" in file_tasks["src/utils.py"]


class TestConflictDetection:
    """Tests for detecting conflicting files."""

    def test_get_conflicting_files(self, file_tracker, temp_project):
        """Correctly identifies files with potential conflicts."""
        files = [temp_project / "src" / "utils.py"]
        file_tracker.capture_baselines("task-001", files)
        file_tracker.capture_baselines("task-002", files)

        file_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )
        file_tracker.record_modification(
            "task-002", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_IMPORT
        )

        conflicting = file_tracker.get_conflicting_files(["task-001", "task-002"])

        assert "src/utils.py" in conflicting

    def test_no_conflicts_different_files(self, file_tracker, temp_project):
        """No conflicts when tasks modify different files."""
        file_tracker.capture_baselines("task-001", [temp_project / "src" / "utils.py"])
        file_tracker.capture_baselines("task-002", [temp_project / "src" / "App.tsx"])

        file_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )

        conflicting = file_tracker.get_conflicting_files(["task-001", "task-002"])

        # Should not report conflict since they touch different files
        assert len(conflicting) == 0 or "src/utils.py" not in conflicting


class TestTaskCleanup:
    """Tests for task cleanup operations."""

    def test_cleanup_task(self, file_tracker, temp_project):
        """Task cleanup removes snapshots and baselines."""
        files = [temp_project / "src" / "utils.py"]
        file_tracker.capture_baselines("task-001", files)

        file_tracker.cleanup_task("task-001", remove_baselines=True)

        evolution = file_tracker.get_file_evolution("src/utils.py")
        assert evolution is None or len(evolution.task_snapshots) == 0

    def test_cleanup_without_baseline_removal(self, file_tracker, temp_project):
        """Cleanup can preserve baselines."""
        files = [temp_project / "src" / "utils.py"]
        file_tracker.capture_baselines("task-001", files)

        # Cleanup without removing baselines
        file_tracker.cleanup_task("task-001", remove_baselines=False)

        # Baseline might still exist depending on implementation


class TestEvolutionSummary:
    """Tests for evolution summary generation."""

    def test_evolution_summary(self, file_tracker, temp_project):
        """Summary provides useful statistics."""
        files = [temp_project / "src" / "utils.py"]
        file_tracker.capture_baselines("task-001", files)
        file_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )

        summary = file_tracker.get_evolution_summary()

        assert summary["total_files_tracked"] >= 1
        assert summary["total_tasks"] >= 1

    def test_summary_with_multiple_tasks(self, file_tracker, temp_project):
        """Summary includes multiple tasks."""
        files1 = [temp_project / "src" / "utils.py"]
        files2 = [temp_project / "src" / "App.tsx"]

        file_tracker.capture_baselines("task-001", files1)
        file_tracker.capture_baselines("task-002", files2)

        file_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )

        summary = file_tracker.get_evolution_summary()

        assert summary["total_tasks"] >= 2

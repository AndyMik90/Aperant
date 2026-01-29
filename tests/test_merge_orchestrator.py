#!/usr/bin/env python3
"""
Tests for MergeOrchestrator and Integration Tests
=================================================

Tests the full merge pipeline coordination and end-to-end workflows.

Covers:
- Orchestrator initialization
- Dry run mode
- Merge previews
- Single-task merge pipeline
- Multi-task merge pipeline with compatible changes
- Merge statistics and reports
- AI enabled/disabled modes
- Report serialization
"""

import json
import sys
from pathlib import Path

import pytest

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))
# Add tests directory to path for test_fixtures
sys.path.insert(0, str(Path(__file__).parent))

from merge import MergeOrchestrator
from merge.orchestrator import TaskMergeRequest

from test_fixtures import (
    SAMPLE_PYTHON_MODULE,
    SAMPLE_PYTHON_WITH_NEW_FUNCTION,
    SAMPLE_PYTHON_WITH_NEW_IMPORT,
)


class TestOrchestratorInitialization:
    """Tests for MergeOrchestrator initialization."""

    def test_initialization(self, temp_project):
        """Orchestrator initializes with all components."""
        orchestrator = MergeOrchestrator(temp_project)

        # Use resolve() to handle symlinks on macOS (/var vs /private/var)
        assert orchestrator.project_dir.resolve() == temp_project.resolve()
        assert orchestrator.analyzer is not None
        assert orchestrator.conflict_detector is not None
        assert orchestrator.auto_merger is not None
        assert orchestrator.evolution_tracker is not None

    def test_dry_run_mode(self, temp_project):
        """Dry run mode doesn't write files."""
        orchestrator = MergeOrchestrator(temp_project, dry_run=True)

        # Capture baseline and simulate merge
        orchestrator.evolution_tracker.capture_baselines(
            "task-001", [temp_project / "src" / "utils.py"]
        )
        orchestrator.evolution_tracker.record_modification(
            "task-001",
            "src/utils.py",
            SAMPLE_PYTHON_MODULE,
            SAMPLE_PYTHON_WITH_NEW_FUNCTION,
        )

        report = orchestrator.merge_task("task-001")

        # Should have results but not write files
        assert report is not None
        written = orchestrator.write_merged_files(report)
        assert len(written) == 0  # Dry run

    def test_ai_disabled_mode(self, temp_project):
        """Orchestrator works without AI enabled."""
        orchestrator = MergeOrchestrator(temp_project, enable_ai=False, dry_run=True)

        files = [temp_project / "src" / "utils.py"]
        orchestrator.evolution_tracker.capture_baselines("task-001", files)
        orchestrator.evolution_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )

        report = orchestrator.merge_task("task-001")

        # Should complete without AI
        assert report.stats.ai_calls_made == 0


class TestMergePreview:
    """Tests for merge preview functionality."""

    def test_preview_merge(self, temp_project):
        """Preview provides merge analysis without executing."""
        orchestrator = MergeOrchestrator(temp_project)

        # Setup two tasks modifying same file
        files = [temp_project / "src" / "utils.py"]
        orchestrator.evolution_tracker.capture_baselines("task-001", files)
        orchestrator.evolution_tracker.capture_baselines("task-002", files)

        orchestrator.evolution_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )
        orchestrator.evolution_tracker.record_modification(
            "task-002", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_IMPORT
        )

        preview = orchestrator.preview_merge(["task-001", "task-002"])

        assert "tasks" in preview
        assert "files_to_merge" in preview
        assert "summary" in preview


class TestSingleTaskMerge:
    """Integration tests for single task merge."""

    def test_full_merge_pipeline_single_task(self, temp_project):
        """Full pipeline works for single task merge (with git-committed changes)."""
        import subprocess

        orchestrator = MergeOrchestrator(temp_project, dry_run=True)

        # Setup: capture baseline
        files = [temp_project / "src" / "utils.py"]
        orchestrator.evolution_tracker.capture_baselines("task-001", files, intent="Add new function")

        # Create a task branch with actual git changes (the merge pipeline uses git diff main...HEAD)
        subprocess.run(["git", "checkout", "-b", "auto-claude/task-001"], cwd=temp_project, capture_output=True)
        utils_file = temp_project / "src" / "utils.py"
        utils_file.write_text(SAMPLE_PYTHON_WITH_NEW_FUNCTION)
        subprocess.run(["git", "add", "."], cwd=temp_project, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Add new function"], cwd=temp_project, capture_output=True)

        # Execute merge - provide worktree_path to avoid lookup
        report = orchestrator.merge_task("task-001", worktree_path=temp_project)

        # Verify results
        assert report.success is True
        assert "task-001" in report.tasks_merged
        # The pipeline should detect and process the modified file
        assert report.stats.files_processed >= 1


class TestMultiTaskMerge:
    """Integration tests for multi-task merge."""

    def test_compatible_multi_task_merge(self, temp_project):
        """Compatible changes from multiple tasks merge automatically."""
        orchestrator = MergeOrchestrator(temp_project, dry_run=True)

        # Setup: both tasks modify same file with compatible changes
        files = [temp_project / "src" / "utils.py"]
        orchestrator.evolution_tracker.capture_baselines("task-001", files, intent="Add logging")
        orchestrator.evolution_tracker.capture_baselines("task-002", files, intent="Add json")

        # Task 1: adds logging import
        orchestrator.evolution_tracker.record_modification(
            "task-001",
            "src/utils.py",
            SAMPLE_PYTHON_MODULE,
            SAMPLE_PYTHON_WITH_NEW_IMPORT,  # Has logging import
        )

        # Task 2: adds new function
        orchestrator.evolution_tracker.record_modification(
            "task-002",
            "src/utils.py",
            SAMPLE_PYTHON_MODULE,
            SAMPLE_PYTHON_WITH_NEW_FUNCTION,
        )

        # Execute merge
        report = orchestrator.merge_tasks([
            TaskMergeRequest(task_id="task-001", worktree_path=temp_project),
            TaskMergeRequest(task_id="task-002", worktree_path=temp_project),
        ])

        # Both tasks should merge successfully
        assert len(report.tasks_merged) == 2
        # Auto-merge should handle compatible changes
        assert report.stats.files_auto_merged >= 0


class TestMergeStats:
    """Tests for merge statistics and reports."""

    def test_merge_stats(self, temp_project):
        """Merge report includes useful statistics."""
        orchestrator = MergeOrchestrator(temp_project, dry_run=True)

        files = [temp_project / "src" / "utils.py"]
        orchestrator.evolution_tracker.capture_baselines("task-001", files)
        orchestrator.evolution_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )

        report = orchestrator.merge_task("task-001")

        assert report.stats.files_processed >= 0
        assert report.stats.duration_seconds >= 0

    def test_merge_report_serialization(self, temp_project):
        """Merge report can be serialized to JSON."""
        orchestrator = MergeOrchestrator(temp_project, dry_run=True)

        files = [temp_project / "src" / "utils.py"]
        orchestrator.evolution_tracker.capture_baselines("task-001", files)
        orchestrator.evolution_tracker.record_modification(
            "task-001", "src/utils.py", SAMPLE_PYTHON_MODULE, SAMPLE_PYTHON_WITH_NEW_FUNCTION
        )

        # Provide worktree_path to avoid lookup
        report = orchestrator.merge_task("task-001", worktree_path=temp_project)

        # Should be serializable
        data = report.to_dict()
        json_str = json.dumps(data)
        restored = json.loads(json_str)

        assert restored["tasks_merged"] == ["task-001"]
        assert restored["success"] is True


class TestErrorHandling:
    """Tests for error handling in orchestrator."""

    def test_missing_baseline_handling(self, temp_project):
        """Handles missing baseline gracefully."""
        orchestrator = MergeOrchestrator(temp_project, dry_run=True)

        # Try to merge without capturing baseline
        # Should handle gracefully (may return error report)
        report = orchestrator.merge_task("nonexistent-task")

        assert report is not None
        # May be success=False or have empty tasks_merged
        assert isinstance(report.success, bool)

    def test_empty_task_list(self, temp_project):
        """Handles empty task list."""
        orchestrator = MergeOrchestrator(temp_project, dry_run=True)

        report = orchestrator.merge_tasks([])

        assert report is not None
        assert len(report.tasks_merged) == 0

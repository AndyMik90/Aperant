#!/usr/bin/env python3
"""
Tests for Parallel Merge Infrastructure
========================================

Tests data structures and async merge runner for parallel merging.

Covers:
- ParallelMergeTask data structure
- ParallelMergeResult data structure (success, auto-merge, failure)
- Parallel merge runner with empty and populated task lists
- Base content handling (optional for new files)
"""

import sys
from pathlib import Path

import pytest

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from workspace import ParallelMergeTask, ParallelMergeResult
from core.workspace import _run_parallel_merges


class TestParallelMergeDataclasses:
    """Tests for parallel merge data structures."""

    def test_parallel_merge_task_creation(self, tmp_path):
        """ParallelMergeTask can be created with required fields."""
        task = ParallelMergeTask(
            file_path="src/App.tsx",
            main_content="const main = 1;",
            worktree_content="const main = 2;",
            base_content="const main = 0;",
            spec_name="001-test",
            project_dir=tmp_path,
        )

        assert task.file_path == "src/App.tsx"
        assert task.main_content == "const main = 1;"
        assert task.worktree_content == "const main = 2;"
        assert task.base_content == "const main = 0;"
        assert task.spec_name == "001-test"
        assert task.project_dir == tmp_path

    def test_parallel_merge_task_optional_base(self, tmp_path):
        """ParallelMergeTask works with None base_content."""
        task = ParallelMergeTask(
            file_path="src/new-file.tsx",
            main_content="// main version",
            worktree_content="// worktree version",
            base_content=None,  # New file, no common ancestor
            spec_name="001-new-feature",
            project_dir=tmp_path,
        )

        assert task.base_content is None
        assert task.file_path == "src/new-file.tsx"

    def test_parallel_merge_result_success(self):
        """ParallelMergeResult can represent successful merge."""
        result = ParallelMergeResult(
            file_path="src/App.tsx",
            merged_content="const main = 'merged';",
            success=True,
            was_auto_merged=False,
        )

        assert result.success is True
        assert result.merged_content == "const main = 'merged';"
        assert result.was_auto_merged is False
        assert result.error is None

    def test_parallel_merge_result_auto_merged(self):
        """ParallelMergeResult can indicate auto-merge (no AI)."""
        result = ParallelMergeResult(
            file_path="src/utils.py",
            merged_content="# Auto-merged content",
            success=True,
            was_auto_merged=True,
        )

        assert result.success is True
        assert result.was_auto_merged is True

    def test_parallel_merge_result_failure(self):
        """ParallelMergeResult can represent failed merge."""
        result = ParallelMergeResult(
            file_path="src/complex.ts",
            merged_content=None,
            success=False,
            error="AI could not resolve conflict",
        )

        assert result.success is False
        assert result.merged_content is None
        assert result.error == "AI could not resolve conflict"


class TestParallelMergeRunner:
    """Tests for the parallel merge runner."""

    def test_run_parallel_merges_empty_list(self, tmp_path):
        """Running with empty task list returns empty results."""
        import asyncio
        results = asyncio.run(_run_parallel_merges([], tmp_path))
        assert results == []

    def test_parallel_merge_task_with_data(self, tmp_path):
        """ParallelMergeTask holds merge data correctly."""
        task = ParallelMergeTask(
            file_path="src/test.py",
            main_content="def main(): pass",
            worktree_content="def main():\n    print('hi')",
            base_content="def main(): pass",
            spec_name="001-feature",
            project_dir=tmp_path,
        )

        assert "main" in task.main_content
        assert "hi" in task.worktree_content
        assert task.spec_name == "001-feature"


class TestSimple3WayMerge:
    """Tests for the simple 3-way merge logic."""

    def test_identical_files_merge(self, tmp_path):
        """When both versions are identical, return that version."""
        import asyncio

        task = ParallelMergeTask(
            file_path="src/test.py",
            main_content="def main(): pass",
            worktree_content="def main(): pass",  # Same as main
            base_content="def main(): pass",  # Same as both
            spec_name="001-no-change",
            project_dir=tmp_path,
        )

        results = asyncio.run(_run_parallel_merges([task], tmp_path))
        assert len(results) == 1
        assert results[0].success is True
        assert results[0].was_auto_merged is True
        assert results[0].merged_content == "def main(): pass"

    def test_only_worktree_changed(self, tmp_path):
        """When only worktree changed, take worktree version."""
        import asyncio

        task = ParallelMergeTask(
            file_path="src/test.py",
            main_content="def main(): pass",  # Same as base
            worktree_content="def main():\n    print('new')",  # Changed
            base_content="def main(): pass",
            spec_name="001-worktree-only",
            project_dir=tmp_path,
        )

        results = asyncio.run(_run_parallel_merges([task], tmp_path))
        assert len(results) == 1
        assert results[0].success is True
        assert results[0].was_auto_merged is True
        assert "print('new')" in results[0].merged_content

    def test_only_main_changed(self, tmp_path):
        """When only main changed, take main version."""
        import asyncio

        task = ParallelMergeTask(
            file_path="src/test.py",
            main_content="def main():\n    print('main')",  # Changed
            worktree_content="def main(): pass",  # Same as base
            base_content="def main(): pass",
            spec_name="001-main-only",
            project_dir=tmp_path,
        )

        results = asyncio.run(_run_parallel_merges([task], tmp_path))
        assert len(results) == 1
        assert results[0].success is True
        assert results[0].was_auto_merged is True
        assert "print('main')" in results[0].merged_content

    def test_no_base_but_identical(self, tmp_path):
        """When no base and both identical, return that version."""
        import asyncio

        task = ParallelMergeTask(
            file_path="src/new.py",
            main_content="# Same content",
            worktree_content="# Same content",
            base_content=None,  # New file, no base
            spec_name="001-new-identical",
            project_dir=tmp_path,
        )

        results = asyncio.run(_run_parallel_merges([task], tmp_path))
        assert len(results) == 1
        assert results[0].success is True
        assert results[0].was_auto_merged is True


class TestParallelMergeIntegration:
    """Integration tests for parallel merge flow."""

    def test_multiple_file_merge_structure(self, tmp_path):
        """Multiple ParallelMergeTasks can be created."""
        tasks = [
            ParallelMergeTask(
                file_path=f"src/file{i}.py",
                main_content=f"# File {i} main",
                worktree_content=f"# File {i} feature",
                base_content=f"# File {i} base",
                spec_name="001-multi",
                project_dir=tmp_path,
            )
            for i in range(3)
        ]

        assert len(tasks) == 3
        assert tasks[0].file_path == "src/file0.py"
        assert tasks[2].file_path == "src/file2.py"

    def test_result_collection(self):
        """ParallelMergeResults can be collected."""
        results = [
            ParallelMergeResult(
                file_path=f"file{i}.py",
                merged_content=f"# Merged {i}",
                success=True,
                was_auto_merged=i % 2 == 0,
            )
            for i in range(5)
        ]

        assert len(results) == 5
        # Check auto-merge pattern
        assert results[0].was_auto_merged is True
        assert results[1].was_auto_merged is False
        assert results[2].was_auto_merged is True

    def test_error_result_handling(self):
        """Error results are properly structured."""
        error_result = ParallelMergeResult(
            file_path="problematic.py",
            merged_content=None,
            success=False,
            error="Complex conflict requires manual review",
        )

        assert error_result.success is False
        assert error_result.error is not None
        assert "manual review" in error_result.error

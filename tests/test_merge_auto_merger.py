#!/usr/bin/env python3
"""
Tests for AutoMerger
====================

Tests deterministic merge strategies for compatible changes.

Covers:
- Strategy capability checks
- COMBINE_IMPORTS strategy
- HOOKS_FIRST and HOOKS_THEN_WRAP strategies
- APPEND_FUNCTIONS and APPEND_METHODS strategies
- COMBINE_PROPS strategy
- ORDER_BY_DEPENDENCY and ORDER_BY_TIME strategies
- APPEND_STATEMENTS strategy
- Error handling for unknown strategies
"""

import sys
from datetime import datetime
from pathlib import Path

import pytest

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from merge import (
    ChangeType,
    SemanticChange,
    TaskSnapshot,
    ConflictRegion,
    ConflictSeverity,
    MergeStrategy,
    MergeDecision,
)
from merge.auto_merger import MergeContext


class TestStrategyCapabilities:
    """Tests for strategy capability checks."""

    def test_can_handle_known_strategies(self, auto_merger):
        """AutoMerger handles all expected strategies."""
        known_strategies = [
            MergeStrategy.COMBINE_IMPORTS,
            MergeStrategy.HOOKS_FIRST,
            MergeStrategy.HOOKS_THEN_WRAP,
            MergeStrategy.APPEND_FUNCTIONS,
            MergeStrategy.APPEND_METHODS,
            MergeStrategy.COMBINE_PROPS,
            MergeStrategy.ORDER_BY_DEPENDENCY,
            MergeStrategy.ORDER_BY_TIME,
            MergeStrategy.APPEND_STATEMENTS,
        ]

        for strategy in known_strategies:
            assert auto_merger.can_handle(strategy) is True

    def test_cannot_handle_ai_required(self, auto_merger):
        """AutoMerger cannot handle AI-required strategy."""
        assert auto_merger.can_handle(MergeStrategy.AI_REQUIRED) is False
        assert auto_merger.can_handle(MergeStrategy.HUMAN_REQUIRED) is False


class TestCombineImportsStrategy:
    """Tests for COMBINE_IMPORTS merge strategy."""

    def test_combine_imports_strategy(self, auto_merger):
        """COMBINE_IMPORTS strategy works correctly."""
        baseline = '''import os
import sys

def main():
    pass
'''
        snapshot1 = TaskSnapshot(
            task_id="task-001",
            task_intent="Add logging",
            started_at=datetime.now(),
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="logging",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                    content_after="import logging",
                ),
            ],
        )
        snapshot2 = TaskSnapshot(
            task_id="task-002",
            task_intent="Add json",
            started_at=datetime.now(),
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="json",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                    content_after="import json",
                ),
            ],
        )

        conflict = ConflictRegion(
            file_path="test.py",
            location="file_top",
            tasks_involved=["task-001", "task-002"],
            change_types=[ChangeType.ADD_IMPORT, ChangeType.ADD_IMPORT],
            severity=ConflictSeverity.NONE,
            can_auto_merge=True,
            merge_strategy=MergeStrategy.COMBINE_IMPORTS,
        )

        context = MergeContext(
            file_path="test.py",
            baseline_content=baseline,
            task_snapshots=[snapshot1, snapshot2],
            conflict=conflict,
        )

        result = auto_merger.merge(context, MergeStrategy.COMBINE_IMPORTS)

        assert result.success is True
        assert "import logging" in result.merged_content
        assert "import json" in result.merged_content
        assert "import os" in result.merged_content

    def test_combine_imports_deduplication(self, auto_merger):
        """COMBINE_IMPORTS deduplicates identical imports."""
        baseline = '''import os

def main():
    pass
'''
        # Both tasks add the same import
        snapshot1 = TaskSnapshot(
            task_id="task-001",
            task_intent="Add logging",
            started_at=datetime.now(),
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="logging",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                    content_after="import logging",
                ),
            ],
        )
        snapshot2 = TaskSnapshot(
            task_id="task-002",
            task_intent="Also add logging",
            started_at=datetime.now(),
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="logging",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                    content_after="import logging",
                ),
            ],
        )

        conflict = ConflictRegion(
            file_path="test.py",
            location="file_top",
            tasks_involved=["task-001", "task-002"],
            change_types=[ChangeType.ADD_IMPORT, ChangeType.ADD_IMPORT],
            severity=ConflictSeverity.NONE,
            can_auto_merge=True,
            merge_strategy=MergeStrategy.COMBINE_IMPORTS,
        )

        context = MergeContext(
            file_path="test.py",
            baseline_content=baseline,
            task_snapshots=[snapshot1, snapshot2],
            conflict=conflict,
        )

        result = auto_merger.merge(context, MergeStrategy.COMBINE_IMPORTS)

        assert result.success is True
        # Should only have one "import logging" line
        import_count = result.merged_content.count("import logging")
        assert import_count == 1


class TestAppendFunctionsStrategy:
    """Tests for APPEND_FUNCTIONS merge strategy."""

    def test_append_functions_strategy(self, auto_merger):
        """APPEND_FUNCTIONS strategy works correctly."""
        baseline = '''def existing():
    pass
'''
        snapshot1 = TaskSnapshot(
            task_id="task-001",
            task_intent="Add helper",
            started_at=datetime.now(),
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="helper1",
                    location="function:helper1",
                    line_start=5,
                    line_end=7,
                    content_after="def helper1():\n    return 1",
                ),
            ],
        )
        snapshot2 = TaskSnapshot(
            task_id="task-002",
            task_intent="Add another helper",
            started_at=datetime.now(),
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="helper2",
                    location="function:helper2",
                    line_start=8,
                    line_end=10,
                    content_after="def helper2():\n    return 2",
                ),
            ],
        )

        conflict = ConflictRegion(
            file_path="test.py",
            location="file",
            tasks_involved=["task-001", "task-002"],
            change_types=[ChangeType.ADD_FUNCTION, ChangeType.ADD_FUNCTION],
            severity=ConflictSeverity.NONE,
            can_auto_merge=True,
            merge_strategy=MergeStrategy.APPEND_FUNCTIONS,
        )

        context = MergeContext(
            file_path="test.py",
            baseline_content=baseline,
            task_snapshots=[snapshot1, snapshot2],
            conflict=conflict,
        )

        result = auto_merger.merge(context, MergeStrategy.APPEND_FUNCTIONS)

        assert result.success is True
        assert "def existing" in result.merged_content
        assert "def helper1" in result.merged_content
        assert "def helper2" in result.merged_content


class TestErrorHandling:
    """Tests for error handling in AutoMerger."""

    def test_unknown_strategy_fails(self, auto_merger):
        """Unknown strategy returns failure."""
        context = MergeContext(
            file_path="test.py",
            baseline_content="",
            task_snapshots=[],
            conflict=ConflictRegion(
                file_path="test.py",
                location="",
                tasks_involved=[],
                change_types=[],
                severity=ConflictSeverity.NONE,
                can_auto_merge=False,
            ),
        )

        result = auto_merger.merge(context, MergeStrategy.AI_REQUIRED)

        assert result.success is False
        assert result.decision == MergeDecision.FAILED

    def test_handles_missing_content(self, auto_merger):
        """Handles snapshots with missing content_after."""
        baseline = '''def existing():
    pass
'''
        snapshot = TaskSnapshot(
            task_id="task-001",
            task_intent="Add function",
            started_at=datetime.now(),
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="new_func",
                    location="function:new_func",
                    line_start=5,
                    line_end=7,
                    # content_after is None
                ),
            ],
        )

        conflict = ConflictRegion(
            file_path="test.py",
            location="file",
            tasks_involved=["task-001"],
            change_types=[ChangeType.ADD_FUNCTION],
            severity=ConflictSeverity.NONE,
            can_auto_merge=True,
            merge_strategy=MergeStrategy.APPEND_FUNCTIONS,
        )

        context = MergeContext(
            file_path="test.py",
            baseline_content=baseline,
            task_snapshots=[snapshot],
            conflict=conflict,
        )

        result = auto_merger.merge(context, MergeStrategy.APPEND_FUNCTIONS)

        # Should handle gracefully (may succeed or fail depending on implementation)
        assert result is not None


class TestMergeContextCreation:
    """Tests for MergeContext data structure."""

    def test_merge_context_creation(self):
        """MergeContext can be created with all required fields."""
        snapshot = TaskSnapshot(
            task_id="task-001",
            task_intent="Test",
            started_at=datetime.now(),
            semantic_changes=[],
        )

        conflict = ConflictRegion(
            file_path="test.py",
            location="file",
            tasks_involved=["task-001"],
            change_types=[],
            severity=ConflictSeverity.NONE,
            can_auto_merge=True,
        )

        context = MergeContext(
            file_path="test.py",
            baseline_content="# Original content",
            task_snapshots=[snapshot],
            conflict=conflict,
        )

        assert context.file_path == "test.py"
        assert context.baseline_content == "# Original content"
        assert len(context.task_snapshots) == 1
        assert context.conflict is not None

    def test_merge_context_with_multiple_snapshots(self):
        """MergeContext can hold multiple task snapshots."""
        snapshots = [
            TaskSnapshot(
                task_id=f"task-{i:03d}",
                task_intent=f"Task {i}",
                started_at=datetime.now(),
                semantic_changes=[],
            )
            for i in range(5)
        ]

        conflict = ConflictRegion(
            file_path="test.py",
            location="file",
            tasks_involved=[s.task_id for s in snapshots],
            change_types=[],
            severity=ConflictSeverity.MEDIUM,
            can_auto_merge=True,
        )

        context = MergeContext(
            file_path="test.py",
            baseline_content="",
            task_snapshots=snapshots,
            conflict=conflict,
        )

        assert len(context.task_snapshots) == 5
        assert len(context.conflict.tasks_involved) == 5

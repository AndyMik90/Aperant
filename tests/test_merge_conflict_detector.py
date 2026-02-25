#!/usr/bin/env python3
"""
Tests for ConflictDetector
===========================

Tests the rule-based conflict detection system.

Covers:
- Single vs. multi-task conflict detection
- Compatible change patterns (imports, hooks, functions)
- Incompatible change patterns (overlapping modifications)
- Conflict severity assessment
- Merge strategy suggestion
- Human-readable conflict explanations
"""

import sys
from pathlib import Path

import pytest

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from merge import (
    ChangeType,
    SemanticChange,
    FileAnalysis,
    ConflictSeverity,
    MergeStrategy,
)


class TestBasicConflictDetection:
    """Basic conflict detection tests."""

    def test_no_conflicts_with_single_task(self, conflict_detector):
        """No conflicts reported with only one task."""
        analysis = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="os",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({"task-001": analysis})
        assert len(conflicts) == 0

    def test_no_conflicts_with_no_overlaps(self, conflict_detector):
        """No conflicts when tasks touch different files."""
        analysis1 = FileAnalysis(
            file_path="file1.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="func1",
                    location="function:func1",
                    line_start=1,
                    line_end=5,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="file2.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="func2",
                    location="function:func2",
                    line_start=1,
                    line_end=5,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        assert len(conflicts) == 0


class TestCompatibleChanges:
    """Tests for compatible change patterns that can auto-merge."""

    def test_compatible_import_additions(self, conflict_detector):
        """Multiple import additions are compatible."""
        analysis1 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="os",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="sys",
                    location="file_top",
                    line_start=2,
                    line_end=2,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        # Should have a conflict region but it's auto-mergeable
        if conflicts:
            assert all(c.can_auto_merge for c in conflicts)
            assert all(c.merge_strategy == MergeStrategy.COMBINE_IMPORTS for c in conflicts)

    def test_compatible_hook_additions(self, conflict_detector):
        """Multiple hook additions at same location are compatible."""
        analysis1 = FileAnalysis(
            file_path="App.tsx",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_HOOK_CALL,
                    target="useAuth",
                    location="function:App",
                    line_start=5,
                    line_end=5,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="App.tsx",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_HOOK_CALL,
                    target="useTheme",
                    location="function:App",
                    line_start=6,
                    line_end=6,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        # Hook additions should be compatible
        if conflicts:
            mergeable = [c for c in conflicts if c.can_auto_merge]
            assert len(mergeable) == len(conflicts)

    def test_compatible_function_additions(self, conflict_detector):
        """Multiple function additions are compatible."""
        analysis1 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="helper1",
                    location="function:helper1",
                    line_start=10,
                    line_end=15,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="helper2",
                    location="function:helper2",
                    line_start=20,
                    line_end=25,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        # Function additions should be auto-mergeable
        if conflicts:
            assert all(c.can_auto_merge for c in conflicts)


class TestIncompatibleChanges:
    """Tests for incompatible changes that require AI or human review."""

    def test_incompatible_function_modifications(self, conflict_detector):
        """Multiple function modifications at same location conflict."""
        analysis1 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="hello",
                    location="function:hello",
                    line_start=5,
                    line_end=10,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="hello",
                    location="function:hello",
                    line_start=5,
                    line_end=12,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        # Should detect a conflict that's not auto-mergeable
        assert len(conflicts) > 0
        assert any(not c.can_auto_merge for c in conflicts)

    def test_overlapping_modifications(self, conflict_detector):
        """Overlapping modifications in same code region conflict."""
        analysis1 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="process",
                    location="function:process",
                    line_start=10,
                    line_end=30,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="process",
                    location="function:process",
                    line_start=15,
                    line_end=35,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        assert len(conflicts) > 0
        assert any(not c.can_auto_merge for c in conflicts)


class TestSeverityAssessment:
    """Tests for conflict severity assessment."""

    def test_severity_assessment(self, conflict_detector):
        """Conflict severity is assessed correctly."""
        # Critical: overlapping function modifications
        analysis1 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="main",
                    location="function:main",
                    line_start=1,
                    line_end=10,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="main",
                    location="function:main",
                    line_start=5,
                    line_end=15,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        assert len(conflicts) > 0
        # Should be high or critical severity
        assert conflicts[0].severity in {ConflictSeverity.HIGH, ConflictSeverity.CRITICAL}

    def test_low_severity_for_compatible_changes(self, conflict_detector):
        """Compatible changes have low severity."""
        analysis1 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="os",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="sys",
                    location="file_top",
                    line_start=2,
                    line_end=2,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        if conflicts:
            assert all(c.severity in {ConflictSeverity.NONE, ConflictSeverity.LOW} for c in conflicts)


class TestConflictExplanation:
    """Tests for human-readable conflict explanations."""

    def test_explain_conflict(self, conflict_detector):
        """Conflict explanation is human-readable."""
        from merge import ConflictRegion

        conflict = ConflictRegion(
            file_path="test.py",
            location="function:main",
            tasks_involved=["task-001", "task-002"],
            change_types=[ChangeType.MODIFY_FUNCTION, ChangeType.MODIFY_FUNCTION],
            severity=ConflictSeverity.HIGH,
            can_auto_merge=False,
            merge_strategy=MergeStrategy.AI_REQUIRED,
            reason="Multiple modifications to same function",
        )

        explanation = conflict_detector.explain_conflict(conflict)

        assert "test.py" in explanation
        assert "task-001" in explanation
        assert "task-002" in explanation
        assert "function:main" in explanation

    def test_explanation_includes_severity(self, conflict_detector):
        """Conflict explanation includes severity level."""
        from merge import ConflictRegion

        conflict = ConflictRegion(
            file_path="app.py",
            location="function:critical_func",
            tasks_involved=["task-1"],
            change_types=[ChangeType.MODIFY_FUNCTION],
            severity=ConflictSeverity.CRITICAL,
            can_auto_merge=False,
        )

        explanation = conflict_detector.explain_conflict(conflict)
        assert "CRITICAL" in explanation or "critical" in explanation.lower()


class TestMergeStrategySelection:
    """Tests for merge strategy selection."""

    def test_combine_imports_strategy(self, conflict_detector):
        """Import conflicts suggest COMBINE_IMPORTS strategy."""
        analysis1 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="os",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="sys",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        if conflicts:
            import_conflicts = [c for c in conflicts if ChangeType.ADD_IMPORT in c.change_types]
            if import_conflicts:
                assert import_conflicts[0].merge_strategy == MergeStrategy.COMBINE_IMPORTS

    def test_ai_required_strategy(self, conflict_detector):
        """Complex modifications suggest AI_REQUIRED strategy."""
        analysis1 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="complex",
                    location="function:complex",
                    line_start=1,
                    line_end=50,
                ),
            ],
        )
        analysis2 = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="complex",
                    location="function:complex",
                    line_start=10,
                    line_end=60,
                ),
            ],
        )

        conflicts = conflict_detector.detect_conflicts({
            "task-001": analysis1,
            "task-002": analysis2,
        })

        assert len(conflicts) > 0
        complex_conflicts = [c for c in conflicts if not c.can_auto_merge]
        if complex_conflicts:
            assert complex_conflicts[0].merge_strategy in {
                MergeStrategy.AI_REQUIRED,
                MergeStrategy.HUMAN_REQUIRED
            }

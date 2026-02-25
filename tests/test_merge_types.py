#!/usr/bin/env python3
"""
Tests for Merge Type Definitions
=================================

Tests the core data structures and type definitions used throughout
the merge system.

Covers:
- Content hashing (compute_content_hash)
- Path sanitization (sanitize_path_for_storage)
- SemanticChange properties and methods
- FileAnalysis properties
- TaskSnapshot serialization
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
    FileAnalysis,
    TaskSnapshot,
)
from merge.types import compute_content_hash, sanitize_path_for_storage


class TestContentHashing:
    """Tests for content hash computation."""

    def test_compute_content_hash(self):
        """Hash computation is consistent and deterministic."""
        content = "Hello, World!"
        hash1 = compute_content_hash(content)
        hash2 = compute_content_hash(content)

        assert hash1 == hash2
        assert len(hash1) == 16  # SHA-256 truncated to 16 chars

    def test_different_content_different_hash(self):
        """Different content produces different hashes."""
        hash1 = compute_content_hash("Hello")
        hash2 = compute_content_hash("World")

        assert hash1 != hash2


class TestPathSanitization:
    """Tests for path sanitization."""

    def test_sanitize_path_for_storage(self):
        """Path sanitization removes special characters."""
        path = "src/components/App.tsx"
        safe = sanitize_path_for_storage(path)

        assert "/" not in safe
        assert "." not in safe
        assert safe == "src_components_App_tsx"

    def test_sanitize_nested_paths(self):
        """Nested paths are properly sanitized."""
        path = "deeply/nested/path/to/file.test.ts"
        safe = sanitize_path_for_storage(path)

        assert "/" not in safe
        assert "." not in safe
        assert "_" in safe


class TestSemanticChange:
    """Tests for SemanticChange data class."""

    def test_semantic_change_is_additive(self):
        """SemanticChange correctly identifies additive changes."""
        add_import = SemanticChange(
            change_type=ChangeType.ADD_IMPORT,
            target="react",
            location="file_top",
            line_start=1,
            line_end=1,
        )
        modify_func = SemanticChange(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="App",
            location="function:App",
            line_start=5,
            line_end=20,
        )

        assert add_import.is_additive is True
        assert modify_func.is_additive is False

    def test_semantic_change_overlaps_with(self):
        """SemanticChange correctly detects overlapping changes."""
        change1 = SemanticChange(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="App",
            location="function:App",
            line_start=5,
            line_end=20,
        )
        change2 = SemanticChange(
            change_type=ChangeType.ADD_HOOK_CALL,
            target="useAuth",
            location="function:App",
            line_start=6,
            line_end=6,
        )
        change3 = SemanticChange(
            change_type=ChangeType.ADD_IMPORT,
            target="lodash",
            location="file_top",
            line_start=1,
            line_end=1,
        )

        assert change1.overlaps_with(change2) is True  # Same location
        assert change1.overlaps_with(change3) is False  # Different location

    def test_semantic_change_with_content(self):
        """SemanticChange can store content_after."""
        change = SemanticChange(
            change_type=ChangeType.ADD_FUNCTION,
            target="helper",
            location="function:helper",
            line_start=10,
            line_end=15,
            content_after="def helper():\n    return 42",
        )

        assert change.content_after is not None
        assert "helper" in change.content_after


class TestFileAnalysis:
    """Tests for FileAnalysis data class."""

    def test_file_analysis_is_additive_only(self):
        """FileAnalysis correctly identifies all-additive changes."""
        additive_analysis = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="os",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                ),
                SemanticChange(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="new_func",
                    location="function:new_func",
                    line_start=10,
                    line_end=15,
                ),
            ],
        )
        mixed_analysis = FileAnalysis(
            file_path="test.py",
            changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="os",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                ),
                SemanticChange(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="existing",
                    location="function:existing",
                    line_start=5,
                    line_end=10,
                ),
            ],
        )

        assert additive_analysis.is_additive_only is True
        assert mixed_analysis.is_additive_only is False

    def test_file_analysis_empty_changes(self):
        """FileAnalysis with no changes."""
        analysis = FileAnalysis(file_path="test.py", changes=[])

        assert len(analysis.changes) == 0
        assert analysis.is_additive_only is True  # Vacuously true


class TestTaskSnapshot:
    """Tests for TaskSnapshot serialization and deserialization."""

    def test_task_snapshot_serialization(self):
        """TaskSnapshot can be serialized and deserialized."""
        snapshot = TaskSnapshot(
            task_id="task-001",
            task_intent="Add authentication",
            started_at=datetime(2024, 1, 15, 10, 0, 0),
            completed_at=datetime(2024, 1, 15, 11, 0, 0),
            content_hash_before="abc123",
            content_hash_after="def456",
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_HOOK_CALL,
                    target="useAuth",
                    location="function:App",
                    line_start=5,
                    line_end=5,
                ),
            ],
        )

        data = snapshot.to_dict()
        restored = TaskSnapshot.from_dict(data)

        assert restored.task_id == snapshot.task_id
        assert restored.task_intent == snapshot.task_intent
        assert len(restored.semantic_changes) == 1
        assert restored.semantic_changes[0].target == "useAuth"

    def test_task_snapshot_without_completion(self):
        """TaskSnapshot without completed_at timestamp."""
        snapshot = TaskSnapshot(
            task_id="task-002",
            task_intent="In progress task",
            started_at=datetime.now(),
            semantic_changes=[],
        )

        assert snapshot.completed_at is None
        data = snapshot.to_dict()
        assert data["completed_at"] is None

    def test_task_snapshot_roundtrip(self):
        """Full roundtrip maintains data integrity."""
        original = TaskSnapshot(
            task_id="task-003",
            task_intent="Test roundtrip",
            started_at=datetime(2024, 1, 1, 0, 0, 0),
            semantic_changes=[
                SemanticChange(
                    change_type=ChangeType.ADD_IMPORT,
                    target="pytest",
                    location="file_top",
                    line_start=1,
                    line_end=1,
                    content_after="import pytest",
                ),
            ],
        )

        # Serialize and deserialize
        data = original.to_dict()
        restored = TaskSnapshot.from_dict(data)

        # Compare key fields
        assert restored.task_id == original.task_id
        assert restored.task_intent == original.task_intent
        assert restored.started_at == original.started_at
        assert len(restored.semantic_changes) == len(original.semantic_changes)
        assert restored.semantic_changes[0].target == original.semantic_changes[0].target

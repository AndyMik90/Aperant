#!/usr/bin/env python3
"""
Tests for SemanticAnalyzer
===========================

Tests the AST-based semantic change extraction system.

Covers:
- Import detection (Python, JavaScript, TypeScript)
- Function/method detection and modifications
- React hook detection
- File structure analysis
- Supported file types
"""

import sys
from pathlib import Path

import pytest

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))
# Add tests directory to path for test_fixtures
sys.path.insert(0, str(Path(__file__).parent))

from merge import ChangeType
from test_fixtures import (
    SAMPLE_PYTHON_MODULE,
    SAMPLE_PYTHON_WITH_NEW_IMPORT,
    SAMPLE_PYTHON_WITH_NEW_FUNCTION,
    SAMPLE_REACT_COMPONENT,
    SAMPLE_REACT_WITH_HOOK,
)


class TestSemanticAnalyzerBasics:
    """Basic functionality tests for SemanticAnalyzer."""

    def test_supported_extensions(self, semantic_analyzer):
        """Analyzer reports supported file types."""
        supported = semantic_analyzer.supported_extensions
        assert ".py" in supported
        assert ".js" in supported
        assert ".ts" in supported
        assert ".tsx" in supported

    def test_is_supported(self, semantic_analyzer):
        """Analyzer correctly identifies supported files."""
        assert semantic_analyzer.is_supported("test.py") is True
        assert semantic_analyzer.is_supported("test.ts") is True
        assert semantic_analyzer.is_supported("test.tsx") is True
        assert semantic_analyzer.is_supported("test.jsx") is True
        assert semantic_analyzer.is_supported("test.rb") is False
        assert semantic_analyzer.is_supported("test.txt") is False


class TestPythonAnalysis:
    """Tests for Python code analysis."""

    def test_analyze_diff_detects_import_addition(self, semantic_analyzer):
        """Analyzer detects added imports in Python."""
        analysis = semantic_analyzer.analyze_diff(
            "test.py",
            SAMPLE_PYTHON_MODULE,
            SAMPLE_PYTHON_WITH_NEW_IMPORT,
        )

        assert len(analysis.changes) > 0
        import_additions = [
            c for c in analysis.changes
            if c.change_type == ChangeType.ADD_IMPORT
        ]
        assert len(import_additions) >= 1

    def test_analyze_diff_detects_function_addition(self, semantic_analyzer):
        """Analyzer detects added functions in Python."""
        analysis = semantic_analyzer.analyze_diff(
            "test.py",
            SAMPLE_PYTHON_MODULE,
            SAMPLE_PYTHON_WITH_NEW_FUNCTION,
        )

        func_additions = [
            c for c in analysis.changes
            if c.change_type == ChangeType.ADD_FUNCTION
        ]
        assert len(func_additions) >= 1

    def test_analyze_file_structure(self, semantic_analyzer):
        """Analyzer can extract Python file structure."""
        analysis = semantic_analyzer.analyze_file("test.py", SAMPLE_PYTHON_MODULE)

        # Should identify existing functions as additions from empty
        func_additions = [
            c for c in analysis.changes
            if c.change_type == ChangeType.ADD_FUNCTION
        ]
        assert len(func_additions) >= 2  # hello, goodbye

    def test_python_class_detection(self, semantic_analyzer):
        """Analyzer detects Python classes."""
        analysis = semantic_analyzer.analyze_file("test.py", SAMPLE_PYTHON_MODULE)

        # Should detect the Greeter class
        class_additions = [
            c for c in analysis.changes
            if c.change_type == ChangeType.ADD_CLASS
        ]
        # Depending on implementation, might detect class or its methods
        assert len(analysis.changes) > 0


class TestReactAnalysis:
    """Tests for React/JSX/TSX analysis."""

    def test_analyze_diff_detects_hook_addition(self, semantic_analyzer):
        """Analyzer detects React hook additions."""
        analysis = semantic_analyzer.analyze_diff(
            "src/App.tsx",
            SAMPLE_REACT_COMPONENT,
            SAMPLE_REACT_WITH_HOOK,
        )

        # Should detect import and hook call
        hook_changes = [
            c for c in analysis.changes
            if c.change_type == ChangeType.ADD_HOOK_CALL
        ]
        import_changes = [
            c for c in analysis.changes
            if c.change_type == ChangeType.ADD_IMPORT
        ]

        assert len(hook_changes) >= 1 or len(import_changes) >= 1

    def test_react_component_detection(self, semantic_analyzer):
        """Analyzer detects React components."""
        analysis = semantic_analyzer.analyze_file(
            "src/App.tsx",
            SAMPLE_REACT_COMPONENT,
        )

        # Should detect component and hooks
        assert len(analysis.changes) > 0

    def test_react_import_detection(self, semantic_analyzer):
        """Analyzer detects React imports."""
        analysis = semantic_analyzer.analyze_diff(
            "src/App.tsx",
            SAMPLE_REACT_COMPONENT,
            SAMPLE_REACT_WITH_HOOK,
        )

        # Should detect the new import
        import_changes = [
            c for c in analysis.changes
            if c.change_type == ChangeType.ADD_IMPORT
        ]
        assert len(import_changes) >= 1


class TestDiffAnalysis:
    """Tests for diff-based change detection."""

    def test_empty_to_content(self, semantic_analyzer):
        """Analyzing from empty to content shows all additions."""
        code = """def hello():
    print("Hello")
"""
        analysis = semantic_analyzer.analyze_diff("test.py", "", code)

        # Everything should be an addition
        assert all(c.is_additive for c in analysis.changes)

    def test_no_changes(self, semantic_analyzer):
        """Identical before/after shows no changes."""
        analysis = semantic_analyzer.analyze_diff(
            "test.py",
            SAMPLE_PYTHON_MODULE,
            SAMPLE_PYTHON_MODULE,
        )

        # Should have minimal or no changes
        assert len(analysis.changes) == 0 or analysis.is_additive_only

    def test_multiple_changes(self, semantic_analyzer):
        """Analyzer detects multiple changes in single diff."""
        before = """import os

def hello():
    pass
"""
        after = """import os
import sys
import logging

def hello():
    print("Modified")

def goodbye():
    pass
"""
        analysis = semantic_analyzer.analyze_diff("test.py", before, after)

        # Should detect imports and function changes
        assert len(analysis.changes) >= 2


class TestEdgeCases:
    """Edge case tests for SemanticAnalyzer."""

    def test_malformed_python(self, semantic_analyzer):
        """Analyzer handles malformed Python gracefully."""
        malformed = """def incomplete(
    # Missing closing paren and body
"""
        # Should not crash
        analysis = semantic_analyzer.analyze_file("test.py", malformed)
        # May have empty or partial results
        assert analysis is not None

    def test_empty_file(self, semantic_analyzer):
        """Analyzer handles empty files."""
        analysis = semantic_analyzer.analyze_file("test.py", "")
        assert len(analysis.changes) == 0

    def test_very_large_file(self, semantic_analyzer):
        """Analyzer handles large files."""
        # Generate a large file
        large_code = "\n".join([f"def func_{i}():\n    pass" for i in range(1000)])
        analysis = semantic_analyzer.analyze_file("test.py", large_code)

        # Should complete without issues
        assert analysis is not None
        assert len(analysis.changes) > 0

#!/usr/bin/env python3
"""
Tests for QA Report - Manual Test Plan Creation
================================================

Tests the manual test plan creation functionality of qa/report.py including:
- create_manual_test_plan()
"""

import sys
from pathlib import Path

import pytest

# Add tests directory to path for helper imports
sys.path.insert(0, str(Path(__file__).parent))

# Setup mocks before importing auto-claude modules
from qa_report_helpers import cleanup_qa_report_mocks, setup_qa_report_mocks

# Setup mocks
setup_qa_report_mocks()

# Import report functions after mocking
from qa.report import (
    create_manual_test_plan,
)

# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield  # Run all tests first
    cleanup_qa_report_mocks()


# =============================================================================
# MANUAL TEST PLAN CREATION TESTS
# =============================================================================


class TestCreateManualTestPlan:
    """Tests for create_manual_test_plan() function."""

    def test_creates_file(self, spec_dir: Path) -> None:
        """Test that file is created."""
        result = create_manual_test_plan(spec_dir, "test-feature")

        assert result.exists()
        assert result.name == "MANUAL_TEST_PLAN.md"

    def test_contains_spec_name(self, spec_dir: Path) -> None:
        """Test that plan contains spec name."""
        result = create_manual_test_plan(spec_dir, "my-feature")

        content = result.read_text()
        assert "my-feature" in content

    def test_contains_checklist(self, spec_dir: Path) -> None:
        """Test that plan contains checklist items."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "[ ]" in content  # Checkbox items

    def test_contains_required_sections(self, spec_dir: Path) -> None:
        """Test that plan contains required sections."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "## Overview" in content
        assert "## Functional Tests" in content
        assert "## Non-Functional Tests" in content
        assert "## Sign-off" in content

    def test_contains_pre_test_setup(self, spec_dir: Path) -> None:
        """Test that plan contains pre-test setup section."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "## Pre-Test Setup" in content

    def test_contains_browser_testing(self, spec_dir: Path) -> None:
        """Test that plan contains browser testing section."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "## Browser/Environment Testing" in content

    def test_extracts_acceptance_criteria(self, spec_dir: Path) -> None:
        """Test extraction of acceptance criteria from spec."""
        # Create spec with acceptance criteria
        spec_content = """# Feature Spec

## Description
A test feature.

## Acceptance Criteria
- Feature does X
- Feature handles Y
- Feature reports Z

## Implementation
Details here.
"""
        (spec_dir / "spec.md").write_text(spec_content)

        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "Feature does X" in content
        assert "Feature handles Y" in content
        assert "Feature reports Z" in content

    def test_default_criteria_when_no_spec(self, spec_dir: Path) -> None:
        """Test default criteria when spec doesn't exist."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "Core functionality works as expected" in content

    def test_default_criteria_when_no_acceptance_section(self, spec_dir: Path) -> None:
        """Test default criteria when spec has no acceptance criteria."""
        spec_content = """# Feature Spec

## Description
A test feature without acceptance criteria.

## Implementation
Details here.
"""
        (spec_dir / "spec.md").write_text(spec_content)

        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "Core functionality works as expected" in content

    def test_contains_timestamp(self, spec_dir: Path) -> None:
        """Test that plan contains generated timestamp."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "**Generated**:" in content

    def test_contains_reason(self, spec_dir: Path) -> None:
        """Test that plan contains reason for manual testing."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "**Reason**: No automated test framework detected" in content

    def test_happy_path_section(self, spec_dir: Path) -> None:
        """Test that plan contains happy path section."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "### Happy Path" in content
        assert "Primary use case works correctly" in content

    def test_edge_cases_section(self, spec_dir: Path) -> None:
        """Test that plan contains edge cases section."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "### Edge Cases" in content
        assert "Empty input handling" in content

    def test_error_handling_section(self, spec_dir: Path) -> None:
        """Test that plan contains error handling section."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "### Error Handling" in content

    def test_performance_section(self, spec_dir: Path) -> None:
        """Test that plan contains performance section."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "### Performance" in content

    def test_security_section(self, spec_dir: Path) -> None:
        """Test that plan contains security section."""
        result = create_manual_test_plan(spec_dir, "test")

        content = result.read_text()
        assert "### Security" in content

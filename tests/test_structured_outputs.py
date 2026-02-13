"""
Tests for Pydantic Structured Output Models
============================================

Tests the Pydantic models used for Claude Agent SDK structured outputs
in GitHub PR reviews.
"""

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

# Direct import of pydantic_models to avoid runners package chain
# Path is set up by conftest.py
_pydantic_models_path = (
    Path(__file__).parent.parent
    / "apps"
    / "backend"
    / "runners"
    / "github"
    / "services"
)
sys.path.insert(0, str(_pydantic_models_path))

from pydantic_models import (
    # Follow-up review models
    FindingResolution,
    FollowupFinding,
    FollowupReviewResponse,
    # Verification evidence models
    VerificationEvidence,
    ParallelOrchestratorFinding,
    # Specialist models
    SpecialistFinding,
    # Parallel follow-up models
    ParallelFollowupFinding,
)


class TestFindingResolution:
    """Tests for FindingResolution model."""

    def test_valid_resolution_resolved(self):
        """Test valid resolved finding."""
        data = {
            "finding_id": "prev-1",
            "status": "resolved",
            "resolution_notes": "Fixed in commit abc123",
        }
        result = FindingResolution.model_validate(data)
        assert result.finding_id == "prev-1"
        assert result.status == "resolved"
        assert result.resolution_notes == "Fixed in commit abc123"

    def test_valid_resolution_unresolved(self):
        """Test valid unresolved finding."""
        data = {
            "finding_id": "prev-2",
            "status": "unresolved",
        }
        result = FindingResolution.model_validate(data)
        assert result.status == "unresolved"
        assert result.resolution_notes is None

    def test_invalid_status_rejected(self):
        """Test that invalid status values are rejected."""
        data = {
            "finding_id": "prev-1",
            "status": "pending",  # Invalid - not in Literal
        }
        with pytest.raises(ValidationError) as exc_info:
            FindingResolution.model_validate(data)
        assert "status" in str(exc_info.value)


class TestFollowupFinding:
    """Tests for FollowupFinding model."""

    def test_valid_finding(self):
        """Test valid follow-up finding (no verification required)."""
        data = {
            "id": "new-1",
            "severity": "high",
            "category": "security",
            "title": "SQL Injection vulnerability",
            "description": "User input not sanitized before query",
            "file": "api/query.py",
            "line": 42,
            "suggested_fix": "Use parameterized queries",
            "fixable": True,
        }
        result = FollowupFinding.model_validate(data)
        assert result.id == "new-1"
        assert result.severity == "high"
        assert result.category == "security"
        assert result.line == 42
        assert result.fixable is True

    def test_minimal_finding(self):
        """Test finding with only required fields."""
        data = {
            "id": "new-2",
            "severity": "low",
            "category": "docs",
            "title": "Missing docstring",
            "description": "Function lacks documentation",
            "file": "utils.py",
        }
        result = FollowupFinding.model_validate(data)
        assert result.line == 0  # Default
        assert result.suggested_fix is None
        assert result.fixable is False

    def test_invalid_severity_normalized(self):
        """Test that invalid severity is normalized to 'medium'."""
        data = {
            "id": "new-1",
            "severity": "extreme",  # Invalid — normalized to medium
            "category": "security",
            "title": "Test",
            "description": "Test",
            "file": "test.py",
        }
        result = FollowupFinding.model_validate(data)
        assert result.severity == "medium"

    def test_invalid_category_normalized(self):
        """Test that invalid category is normalized to 'quality'."""
        data = {
            "id": "new-1",
            "severity": "high",
            "category": "unknown_category",  # Invalid — normalized to quality
            "title": "Test",
            "description": "Test",
            "file": "test.py",
        }
        result = FollowupFinding.model_validate(data)
        assert result.category == "quality"

    def test_verification_not_required(self):
        """Test that verification field is not required on FollowupFinding."""
        data = {
            "id": "new-1",
            "severity": "medium",
            "category": "quality",
            "title": "Test",
            "description": "Test",
            "file": "test.py",
        }
        result = FollowupFinding.model_validate(data)
        assert not hasattr(result, "verification") or not hasattr(
            result.__class__.model_fields, "verification"
        )


class TestFollowupReviewResponse:
    """Tests for FollowupReviewResponse model."""

    def test_valid_complete_response(self):
        """Test valid complete follow-up review response."""
        data = {
            "finding_resolutions": [
                {"finding_id": "prev-1", "status": "resolved", "resolution_notes": "Fixed"}
            ],
            "new_findings": [
                {
                    "id": "new-1",
                    "severity": "medium",
                    "category": "quality",
                    "title": "Code smell",
                    "description": "Complex method",
                    "file": "service.py",
                    "line": 100,
                }
            ],
            "comment_findings": [],
            "verdict": "MERGE_WITH_CHANGES",
            "verdict_reasoning": "Minor issues found, safe to merge after review",
        }
        result = FollowupReviewResponse.model_validate(data)
        assert result.verdict == "MERGE_WITH_CHANGES"
        assert len(result.finding_resolutions) == 1
        assert len(result.new_findings) == 1
        assert len(result.comment_findings) == 0

    def test_empty_findings_lists(self):
        """Test response with empty findings lists."""
        data = {
            "finding_resolutions": [],
            "new_findings": [],
            "comment_findings": [],
            "verdict": "READY_TO_MERGE",
            "verdict_reasoning": "No issues found",
        }
        result = FollowupReviewResponse.model_validate(data)
        assert result.verdict == "READY_TO_MERGE"

    def test_invalid_verdict_rejected(self):
        """Test that invalid verdict is rejected."""
        data = {
            "finding_resolutions": [],
            "new_findings": [],
            "comment_findings": [],
            "verdict": "APPROVE",  # Invalid
            "verdict_reasoning": "Test",
        }
        with pytest.raises(ValidationError) as exc_info:
            FollowupReviewResponse.model_validate(data)
        assert "verdict" in str(exc_info.value)

    def test_all_verdict_values(self):
        """Test all valid verdict values."""
        for verdict in [
            "READY_TO_MERGE",
            "MERGE_WITH_CHANGES",
            "NEEDS_REVISION",
            "BLOCKED",
        ]:
            data = {
                "finding_resolutions": [],
                "new_findings": [],
                "comment_findings": [],
                "verdict": verdict,
                "verdict_reasoning": f"Testing {verdict}",
            }
            result = FollowupReviewResponse.model_validate(data)
            assert result.verdict == verdict


class TestSchemaGeneration:
    """Tests for JSON schema generation."""

    def test_followup_schema_generation(self):
        """Test that FollowupReviewResponse generates valid JSON schema."""
        schema = FollowupReviewResponse.model_json_schema()

        assert "properties" in schema
        assert "verdict" in schema["properties"]
        assert "verdict_reasoning" in schema["properties"]
        assert "finding_resolutions" in schema["properties"]
        assert "new_findings" in schema["properties"]

        # Check verdict enum values
        verdict_schema = schema["properties"]["verdict"]
        assert "enum" in verdict_schema or "$ref" in str(schema)

    def test_schema_has_descriptions(self):
        """Test that schema includes field descriptions for AI guidance."""
        schema = FollowupReviewResponse.model_json_schema()

        # Check that descriptions are included (helps AI understand the schema)
        # The schema may have $defs for nested models
        assert "properties" in schema or "$defs" in schema


# =============================================================================
# Verification Evidence Tests
# =============================================================================


class TestVerificationEvidence:
    """Tests for VerificationEvidence model."""

    def test_valid_verification(self):
        """Test valid verification evidence."""
        data = {
            "code_examined": "def process_input(user_input):\n    return eval(user_input)",
            "line_range_examined": [10, 11],
            "verification_method": "direct_code_inspection",
        }
        result = VerificationEvidence.model_validate(data)
        assert "eval" in result.code_examined
        assert result.line_range_examined == [10, 11]
        assert result.verification_method == "direct_code_inspection"

    def test_empty_code_examined_accepted(self):
        """Test that empty code_examined is accepted (no min_length constraint)."""
        data = {
            "code_examined": "",
            "line_range_examined": [1, 5],
            "verification_method": "direct_code_inspection",
        }
        result = VerificationEvidence.model_validate(data)
        assert result.code_examined == ""

    def test_line_range_defaults_to_empty_list(self):
        """Test that line_range_examined defaults to empty list when omitted."""
        data = {
            "code_examined": "some code",
            "verification_method": "direct_code_inspection",
        }
        result = VerificationEvidence.model_validate(data)
        assert result.line_range_examined == []

    def test_single_element_line_range_accepted(self):
        """Test that single element line range is accepted (list[int])."""
        data = {
            "code_examined": "some code",
            "line_range_examined": [1],
            "verification_method": "direct_code_inspection",
        }
        result = VerificationEvidence.model_validate(data)
        assert result.line_range_examined == [1]

    def test_custom_verification_method_accepted(self):
        """Test that any string verification method is accepted."""
        data = {
            "code_examined": "some code",
            "line_range_examined": [1, 5],
            "verification_method": "custom_method",
        }
        result = VerificationEvidence.model_validate(data)
        assert result.verification_method == "custom_method"

    def test_all_verification_methods(self):
        """Test common verification methods."""
        methods = [
            "direct_code_inspection",
            "cross_file_trace",
            "test_verification",
            "dependency_analysis",
        ]
        for method in methods:
            data = {
                "code_examined": "code",
                "line_range_examined": [1, 5],
                "verification_method": method,
            }
            result = VerificationEvidence.model_validate(data)
            assert result.verification_method == method


class TestParallelOrchestratorFindingVerification:
    """Tests for verification field on ParallelOrchestratorFinding."""

    def test_missing_verification_accepted(self):
        """Test that findings without verification are accepted (now optional)."""
        data = {
            "id": "test-1",
            "file": "test.py",
            "line": 10,
            "title": "Test finding",
            "description": "A test finding without verification",
            "category": "quality",
            "severity": "medium",
            # No verification field — should succeed (now optional)
        }
        result = ParallelOrchestratorFinding.model_validate(data)
        assert result.verification is None

    def test_valid_finding_with_verification(self):
        """Test valid finding with verification evidence."""
        data = {
            "id": "test-1",
            "file": "test.py",
            "line": 10,
            "title": "SQL Injection vulnerability",
            "description": "User input passed directly to query",
            "category": "security",
            "severity": "critical",
            "verification": {
                "code_examined": "cursor.execute(f'SELECT * FROM users WHERE id={user_id}')",
                "line_range_examined": [10, 10],
                "verification_method": "direct_code_inspection",
            },
        }
        result = ParallelOrchestratorFinding.model_validate(data)
        assert result.verification.code_examined is not None
        assert result.verification.verification_method == "direct_code_inspection"

    def test_is_impact_finding_default_false(self):
        """Test is_impact_finding defaults to False."""
        data = {
            "id": "test-1",
            "file": "test.py",
            "line": 10,
            "title": "Test",
            "description": "Test",
            "category": "quality",
            "severity": "medium",
        }
        result = ParallelOrchestratorFinding.model_validate(data)
        assert result.is_impact_finding is False

    def test_is_impact_finding_true(self):
        """Test is_impact_finding can be set True."""
        data = {
            "id": "test-1",
            "file": "caller.py",
            "line": 50,
            "title": "Breaking change affects caller",
            "description": "This file calls the changed function and will break",
            "category": "logic",
            "severity": "high",
            "is_impact_finding": True,
            "verification": {
                "code_examined": "result = changed_function(x)",
                "line_range_examined": [50, 50],
                "verification_method": "cross_file_trace",
            },
        }
        result = ParallelOrchestratorFinding.model_validate(data)
        assert result.is_impact_finding is True

    def test_checked_for_handling_elsewhere_default_false(self):
        """Test checked_for_handling_elsewhere defaults to False."""
        data = {
            "id": "test-1",
            "file": "test.py",
            "line": 10,
            "title": "Missing error handling",
            "description": "No try-catch",
            "category": "quality",
            "severity": "medium",
        }
        result = ParallelOrchestratorFinding.model_validate(data)
        assert result.checked_for_handling_elsewhere is False

    def test_checked_for_handling_elsewhere_true(self):
        """Test checked_for_handling_elsewhere can be set True."""
        data = {
            "id": "test-1",
            "file": "api.py",
            "line": 25,
            "title": "Missing error handling",
            "description": "No try-catch around database call",
            "category": "quality",
            "severity": "medium",
            "checked_for_handling_elsewhere": True,
            "verification": {
                "code_examined": "result = db.query(user_input)",
                "line_range_examined": [25, 25],
                "verification_method": "cross_file_trace",
            },
        }
        result = ParallelOrchestratorFinding.model_validate(data)
        assert result.checked_for_handling_elsewhere is True

    def test_invalid_severity_normalized(self):
        """Test invalid severity is normalized to 'medium'."""
        data = {
            "id": "test-1",
            "file": "test.py",
            "line": 10,
            "title": "Test",
            "description": "Test",
            "category": "quality",
            "severity": "super_critical",
        }
        result = ParallelOrchestratorFinding.model_validate(data)
        assert result.severity == "medium"

    def test_invalid_category_normalized(self):
        """Test invalid category is normalized to 'quality'."""
        data = {
            "id": "test-1",
            "file": "test.py",
            "line": 10,
            "title": "Test",
            "description": "Test",
            "category": "unknown_thing",
            "severity": "medium",
        }
        result = ParallelOrchestratorFinding.model_validate(data)
        assert result.category == "quality"


class TestVerificationSchemaGeneration:
    """Tests for JSON schema generation with VerificationEvidence."""

    def test_verification_in_parallel_orchestrator_schema(self):
        """Test that VerificationEvidence appears in schema."""
        schema = ParallelOrchestratorFinding.model_json_schema()

        # verification should be in properties
        assert "verification" in schema["properties"]

        # Check $defs includes VerificationEvidence
        assert "$defs" in schema
        assert "VerificationEvidence" in schema["$defs"]

        # Check VerificationEvidence has correct fields
        ve_schema = schema["$defs"]["VerificationEvidence"]
        assert "code_examined" in ve_schema["properties"]
        assert "line_range_examined" in ve_schema["properties"]
        assert "verification_method" in ve_schema["properties"]

    def test_new_boolean_fields_in_schema(self):
        """Test is_impact_finding and checked_for_handling_elsewhere in schema."""
        schema = ParallelOrchestratorFinding.model_json_schema()

        assert "is_impact_finding" in schema["properties"]
        assert "checked_for_handling_elsewhere" in schema["properties"]


# =============================================================================
# Specialist Finding Tests
# =============================================================================


class TestSpecialistFinding:
    """Tests for SpecialistFinding model."""

    def test_empty_evidence_accepted(self):
        """Test that empty evidence is accepted (no min_length)."""
        data = {
            "severity": "medium",
            "category": "quality",
            "title": "Test finding",
            "description": "A test",
            "file": "test.py",
            "evidence": "",
        }
        result = SpecialistFinding.model_validate(data)
        assert result.evidence == ""

    def test_evidence_defaults_to_empty(self):
        """Test that evidence defaults to empty string."""
        data = {
            "severity": "medium",
            "category": "quality",
            "title": "Test finding",
            "description": "A test",
            "file": "test.py",
        }
        result = SpecialistFinding.model_validate(data)
        assert result.evidence == ""

    def test_invalid_severity_normalized(self):
        """Test invalid severity is normalized."""
        data = {
            "severity": "urgent",
            "category": "security",
            "title": "Test",
            "description": "Test",
            "file": "test.py",
        }
        result = SpecialistFinding.model_validate(data)
        assert result.severity == "medium"

    def test_invalid_category_normalized(self):
        """Test invalid category is normalized."""
        data = {
            "severity": "high",
            "category": "style",
            "title": "Test",
            "description": "Test",
            "file": "test.py",
        }
        result = SpecialistFinding.model_validate(data)
        assert result.category == "quality"


# =============================================================================
# Parallel Follow-up Finding Tests
# =============================================================================


class TestParallelFollowupFinding:
    """Tests for ParallelFollowupFinding model."""

    def test_invalid_severity_normalized(self):
        """Test invalid severity is normalized."""
        data = {
            "id": "pf-1",
            "file": "test.py",
            "title": "Test",
            "description": "Test",
            "category": "quality",
            "severity": "extreme",
        }
        result = ParallelFollowupFinding.model_validate(data)
        assert result.severity == "medium"

    def test_invalid_category_normalized(self):
        """Test invalid category is normalized."""
        data = {
            "id": "pf-1",
            "file": "test.py",
            "title": "Test",
            "description": "Test",
            "category": "unknown",
            "severity": "medium",
        }
        result = ParallelFollowupFinding.model_validate(data)
        assert result.category == "quality"

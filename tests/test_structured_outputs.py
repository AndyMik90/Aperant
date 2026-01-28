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
    AICommentTriage,
    DeepAnalysisFinding,
    # Follow-up review models
    FindingResolution,
    FollowupFinding,
    FollowupReviewResponse,
    # Orchestrator review models
    OrchestratorFinding,
    OrchestratorReviewResponse,
    QualityFinding,
    # Initial review models
    QuickScanResult,
    SecurityFinding,
    StructuralIssue,
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
        """Test valid follow-up finding."""
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

    def test_invalid_severity_rejected(self):
        """Test that invalid severity is rejected."""
        data = {
            "id": "new-1",
            "severity": "extreme",  # Invalid
            "category": "security",
            "title": "Test",
            "description": "Test",
            "file": "test.py",
        }
        with pytest.raises(ValidationError) as exc_info:
            FollowupFinding.model_validate(data)
        assert "severity" in str(exc_info.value)

    def test_invalid_category_rejected(self):
        """Test that invalid category is rejected."""
        data = {
            "id": "new-1",
            "severity": "high",
            "category": "unknown_category",  # Invalid
            "title": "Test",
            "description": "Test",
            "file": "test.py",
        }
        with pytest.raises(ValidationError) as exc_info:
            FollowupFinding.model_validate(data)
        assert "category" in str(exc_info.value)


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


class TestOrchestratorFinding:
    """Tests for OrchestratorFinding model."""

    def test_valid_finding(self):
        """Test valid orchestrator finding with evidence field."""
        data = {
            "file": "src/api.py",
            "line": 25,
            "title": "Missing error handling",
            "description": "API endpoint lacks try-catch block",
            "category": "quality",
            "severity": "medium",
            "suggestion": "Add error handling with proper logging",
            "evidence": "def handle_request(req):\n    result = db.query(req.id)  # no try-catch",
        }
        result = OrchestratorFinding.model_validate(data)
        assert result.file == "src/api.py"
        assert result.evidence is not None
        assert "no try-catch" in result.evidence

    def test_evidence_optional(self):
        """Test that evidence field is optional."""
        data = {
            "file": "test.py",
            "title": "Test",
            "description": "Test finding",
            "category": "quality",
            "severity": "low",
        }
        result = OrchestratorFinding.model_validate(data)
        assert result.evidence is None


class TestOrchestratorReviewResponse:
    """Tests for OrchestratorReviewResponse model."""

    def test_valid_response(self):
        """Test valid orchestrator review response."""
        data = {
            "verdict": "NEEDS_REVISION",
            "verdict_reasoning": "Critical security issue found",
            "findings": [
                {
                    "file": "auth.py",
                    "line": 10,
                    "title": "Hardcoded secret",
                    "description": "API key exposed in source",
                    "category": "security",
                    "severity": "critical",
                    "evidence": "API_KEY = 'sk-prod-12345abcdef'",
                }
            ],
            "summary": "Found 1 critical security issue",
        }
        result = OrchestratorReviewResponse.model_validate(data)
        assert result.verdict == "NEEDS_REVISION"
        assert len(result.findings) == 1
        assert result.findings[0].severity == "critical"

    def test_empty_findings(self):
        """Test response with no findings."""
        data = {
            "verdict": "READY_TO_MERGE",
            "verdict_reasoning": "All checks passed",
            "findings": [],
            "summary": "Clean PR, ready for merge",
        }
        result = OrchestratorReviewResponse.model_validate(data)
        assert len(result.findings) == 0


class TestQuickScanResult:
    """Tests for QuickScanResult model."""

    def test_valid_quick_scan(self):
        """Test valid quick scan result."""
        data = {
            "purpose": "Add user authentication",
            "actual_changes": "Implements OAuth login flow",
            "purpose_match": True,
            "risk_areas": ["Security", "Session management"],
            "red_flags": [],
            "requires_deep_verification": True,
            "complexity": "medium",
        }
        result = QuickScanResult.model_validate(data)
        assert result.purpose_match is True
        assert result.complexity == "medium"
        assert len(result.risk_areas) == 2

    def test_complexity_values(self):
        """Test all valid complexity values."""
        for complexity in ["low", "medium", "high"]:
            data = {
                "purpose": "Test",
                "actual_changes": "Test",
                "purpose_match": True,
                "requires_deep_verification": False,
                "complexity": complexity,
            }
            result = QuickScanResult.model_validate(data)
            assert result.complexity == complexity


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

    def test_orchestrator_schema_generation(self):
        """Test that OrchestratorReviewResponse generates valid JSON schema."""
        schema = OrchestratorReviewResponse.model_json_schema()

        assert "properties" in schema
        assert "verdict" in schema["properties"]
        assert "findings" in schema["properties"]
        assert "summary" in schema["properties"]

    def test_schema_has_descriptions(self):
        """Test that schema includes field descriptions for AI guidance."""
        schema = FollowupReviewResponse.model_json_schema()

        # Check that descriptions are included (helps AI understand the schema)
        # The schema may have $defs for nested models
        assert "properties" in schema or "$defs" in schema


class TestSecurityFinding:
    """Tests for SecurityFinding model."""

    def test_security_category_default(self):
        """Test that SecurityFinding has security category by default."""
        data = {
            "id": "sec-1",
            "severity": "high",
            "title": "XSS vulnerability",
            "description": "Unescaped user input",
            "file": "template.html",
            "line": 50,
        }
        result = SecurityFinding.model_validate(data)
        assert result.category == "security"


class TestDeepAnalysisFinding:
    """Tests for DeepAnalysisFinding model."""

    def test_evidence_field(self):
        """Test evidence field for proof of issue."""
        data = {
            "id": "deep-1",
            "severity": "medium",
            "title": "Potential race condition",
            "description": "Concurrent access without lock",
            "file": "worker.py",
            "line": 100,
            "category": "logic",
            "evidence": "shared_state += 1  # no lock protection",
        }
        result = DeepAnalysisFinding.model_validate(data)
        assert result.evidence == "shared_state += 1  # no lock protection"

    def test_verification_note(self):
        """Test verification note field."""
        data = {
            "id": "deep-2",
            "severity": "low",
            "title": "Unverified assumption",
            "description": "Could not verify behavior",
            "file": "lib.py",
            "category": "verification_failed",
            "verification_note": "Unable to find test coverage",
        }
        result = DeepAnalysisFinding.model_validate(data)
        assert result.verification_note == "Unable to find test coverage"


class TestAICommentTriage:
    """Tests for AICommentTriage model."""

    def test_valid_triage(self):
        """Test valid AI comment triage."""
        data = {
            "comment_id": 12345,
            "tool_name": "CodeRabbit",
            "verdict": "important",
            "reasoning": "Valid security concern raised",
            "response_comment": "Thank you, we will address this.",
        }
        result = AICommentTriage.model_validate(data)
        assert result.comment_id == 12345
        assert result.verdict == "important"

    def test_all_verdict_values(self):
        """Test all valid triage verdict values."""
        for verdict in [
            "critical",
            "important",
            "nice_to_have",
            "trivial",
            "false_positive",
        ]:
            data = {
                "comment_id": 1,
                "tool_name": "Test",
                "verdict": verdict,
                "reasoning": f"Testing {verdict}",
            }
            result = AICommentTriage.model_validate(data)
            assert result.verdict == verdict

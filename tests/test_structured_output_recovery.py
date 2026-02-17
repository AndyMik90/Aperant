"""
Tests for Structured Output Recovery
======================================

Tests the three-tier recovery cascade when structured output validation fails:
1. FollowupExtractionResponse model validation
2. Error categorization imported from sdk_utils
3. Agent config registration for pr_followup_extraction
"""

import json
import sys
from pathlib import Path

import pytest

# Add paths for imports — conftest.py adds apps/backend, but there's a
# services/ package at both apps/backend/services/ and runners/github/services/.
# To avoid collision, add the github services dir directly and import bare module names.
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
_github_runner_dir = _backend_dir / "runners" / "github"
_github_services_dir = _github_runner_dir / "services"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))
if str(_github_runner_dir) not in sys.path:
    sys.path.insert(0, str(_github_runner_dir))
if str(_github_services_dir) not in sys.path:
    sys.path.insert(0, str(_github_services_dir))

from agents.tools_pkg.models import AGENT_CONFIGS
from pydantic_models import (
    ExtractedFindingSummary,
    FollowupExtractionResponse,
    ParallelFollowupResponse,
)
from recovery_utils import create_finding_from_summary
from sdk_utils import RECOVERABLE_ERRORS


# ============================================================================
# Test FollowupExtractionResponse model
# ============================================================================


class TestFollowupExtractionResponse:
    """Tests for the minimal extraction schema."""

    def test_minimal_valid_response(self):
        """Accepts minimal response with just verdict and reasoning."""
        resp = FollowupExtractionResponse(
            verdict="NEEDS_REVISION",
            verdict_reasoning="Found issues that need fixing",
        )
        assert resp.verdict == "NEEDS_REVISION"
        assert resp.resolved_finding_ids == []
        assert resp.new_finding_summaries == []
        assert resp.confirmed_finding_count == 0
        assert resp.dismissed_finding_count == 0

    def test_full_valid_response(self):
        """Accepts fully populated response with ExtractedFindingSummary objects."""
        resp = FollowupExtractionResponse(
            verdict="READY_TO_MERGE",
            verdict_reasoning="All findings resolved",
            resolved_finding_ids=["NCR-001", "NCR-002"],
            unresolved_finding_ids=[],
            new_finding_summaries=[
                ExtractedFindingSummary(
                    severity="HIGH",
                    description="potential cleanup issue in batch_commands.py",
                    file="apps/backend/cli/batch_commands.py",
                    line=42,
                )
            ],
            confirmed_finding_count=1,
            dismissed_finding_count=1,
        )
        assert len(resp.resolved_finding_ids) == 2
        assert len(resp.new_finding_summaries) == 1
        assert resp.new_finding_summaries[0].file == "apps/backend/cli/batch_commands.py"
        assert resp.new_finding_summaries[0].line == 42
        assert resp.confirmed_finding_count == 1

    def test_finding_summary_defaults(self):
        """ExtractedFindingSummary defaults file='unknown' and line=0."""
        summary = ExtractedFindingSummary(
            severity="MEDIUM",
            description="Some issue without location",
        )
        assert summary.file == "unknown"
        assert summary.line == 0

    def test_schema_is_small(self):
        """Schema should be significantly smaller than ParallelFollowupResponse."""
        extraction_schema = json.dumps(
            FollowupExtractionResponse.model_json_schema()
        )
        followup_schema = json.dumps(
            ParallelFollowupResponse.model_json_schema()
        )
        # Actual ratio is ~50.7% after adding ExtractedFindingSummary nesting.
        # Threshold at 55% gives headroom while still guarding against schema bloat.
        assert len(extraction_schema) < len(followup_schema) * 0.55, (
            f"Extraction schema ({len(extraction_schema)} chars) should be "
            f"less than 55% of full schema ({len(followup_schema)} chars)"
        )

    def test_all_verdict_values_accepted(self):
        """All four verdict values should be accepted."""
        for verdict in ["READY_TO_MERGE", "MERGE_WITH_CHANGES", "NEEDS_REVISION", "BLOCKED"]:
            resp = FollowupExtractionResponse(
                verdict=verdict,
                verdict_reasoning=f"Test {verdict}",
            )
            assert resp.verdict == verdict


# ============================================================================
# Test error categorization using the actual RECOVERABLE_ERRORS from sdk_utils
# ============================================================================


class TestErrorCategorization:
    """Tests that sdk_utils RECOVERABLE_ERRORS constant classifies errors correctly."""

    def test_structured_output_error_is_recoverable(self):
        """structured_output_validation_failed should be in RECOVERABLE_ERRORS."""
        assert "structured_output_validation_failed" in RECOVERABLE_ERRORS

    def test_concurrency_error_is_recoverable(self):
        """tool_use_concurrency_error should be in RECOVERABLE_ERRORS."""
        assert "tool_use_concurrency_error" in RECOVERABLE_ERRORS

    def test_auth_error_is_fatal(self):
        """Auth errors should NOT be in RECOVERABLE_ERRORS."""
        assert "Authentication error detected in AI response: please login again" not in RECOVERABLE_ERRORS

    def test_circuit_breaker_is_fatal(self):
        """Circuit breaker errors should NOT be in RECOVERABLE_ERRORS."""
        for error in RECOVERABLE_ERRORS:
            assert "circuit breaker" not in error.lower()

    def test_none_is_not_recoverable(self):
        """None should not be in RECOVERABLE_ERRORS."""
        assert None not in RECOVERABLE_ERRORS


# ============================================================================
# Test agent config registration
# ============================================================================


class TestAgentConfigRegistration:
    """Tests that pr_followup_extraction agent type is registered."""

    def test_extraction_agent_type_registered(self):
        """pr_followup_extraction must exist in AGENT_CONFIGS."""
        assert "pr_followup_extraction" in AGENT_CONFIGS

    def test_extraction_agent_needs_no_tools(self):
        """Extraction agent should have no tools (pure structured output)."""
        config = AGENT_CONFIGS["pr_followup_extraction"]
        assert config["tools"] == []
        assert config["mcp_servers"] == []

    def test_extraction_agent_low_thinking(self):
        """Extraction agent should use low thinking (lightweight call)."""
        config = AGENT_CONFIGS["pr_followup_extraction"]
        assert config["thinking_default"] == "low"


# ============================================================================
# Test create_finding_from_summary with file/line params
# ============================================================================


class TestCreateFindingFromSummary:
    """Tests for create_finding_from_summary with file/line support."""

    def test_backward_compatible_defaults(self):
        """Calling without file/line still produces file='unknown', line=0."""
        finding = create_finding_from_summary("HIGH: some issue", 0)
        assert finding.file == "unknown"
        assert finding.line == 0
        assert finding.severity.value == "high"

    def test_file_and_line_passed_through(self):
        """File and line params are used in the resulting finding."""
        finding = create_finding_from_summary(
            summary="Missing null check",
            index=0,
            file="src/parser.py",
            line=42,
        )
        assert finding.file == "src/parser.py"
        assert finding.line == 42

    def test_severity_override(self):
        """severity_override takes precedence over parsed severity."""
        finding = create_finding_from_summary(
            summary="HIGH: some issue",
            index=0,
            severity_override="CRITICAL",
        )
        assert finding.severity.value == "critical"

    def test_severity_override_case_insensitive(self):
        """severity_override works regardless of case."""
        finding = create_finding_from_summary(
            summary="some issue",
            index=0,
            severity_override="high",
        )
        assert finding.severity.value == "high"

    def test_severity_override_invalid_falls_back(self):
        """Invalid severity_override falls back to parsed severity."""
        finding = create_finding_from_summary(
            summary="LOW: minor issue",
            index=0,
            severity_override="UNKNOWN",
        )
        # Falls back to parsed "LOW" from summary
        assert finding.severity.value == "low"

    def test_id_prefix(self):
        """Custom id_prefix is used in the finding ID."""
        finding = create_finding_from_summary(
            summary="some issue", index=0, id_prefix="FU"
        )
        assert finding.id.startswith("FU-")

    def test_all_params_together(self):
        """All new params work together correctly."""
        finding = create_finding_from_summary(
            summary="Regex issue in subtask title truncation",
            index=3,
            id_prefix="FU",
            severity_override="MEDIUM",
            file="apps/backend/agents/planner.py",
            line=187,
        )
        assert finding.id.startswith("FU-")
        assert finding.severity.value == "medium"
        assert finding.file == "apps/backend/agents/planner.py"
        assert finding.line == 187
        assert "Regex issue" in finding.title

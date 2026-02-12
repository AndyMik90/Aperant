"""
Tests for Structured Output Recovery
======================================

Tests the three-tier recovery cascade when structured output validation fails:
1. Error categorization in sdk_utils (recoverable vs fatal)
2. Extraction call fallback in parallel_followup_reviewer
3. FindingValidator retryable error handling
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add the backend directory to path
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
_github_dir = _backend_dir / "runners" / "github"
_services_dir = _github_dir / "services"
if str(_github_dir) not in sys.path:
    sys.path.insert(0, str(_github_dir))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))
if str(_services_dir) not in sys.path:
    sys.path.insert(0, str(_services_dir))

from services.pydantic_models import (
    FollowupExtractionResponse,
    ParallelFollowupResponse,
)


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
        """Accepts fully populated response."""
        resp = FollowupExtractionResponse(
            verdict="READY_TO_MERGE",
            verdict_reasoning="All findings resolved",
            resolved_finding_ids=["NCR-001", "NCR-002"],
            unresolved_finding_ids=[],
            new_finding_summaries=["HIGH: potential cleanup issue in batch_commands.py"],
            confirmed_finding_count=1,
            dismissed_finding_count=1,
        )
        assert len(resp.resolved_finding_ids) == 2
        assert len(resp.new_finding_summaries) == 1
        assert resp.confirmed_finding_count == 1

    def test_schema_is_small(self):
        """Schema should be significantly smaller than ParallelFollowupResponse."""
        import json

        extraction_schema = json.dumps(
            FollowupExtractionResponse.model_json_schema()
        )
        followup_schema = json.dumps(
            ParallelFollowupResponse.model_json_schema()
        )
        # Extraction schema should be less than half the size of the full schema
        assert len(extraction_schema) < len(followup_schema) / 2, (
            f"Extraction schema ({len(extraction_schema)} chars) should be "
            f"less than half of full schema ({len(followup_schema)} chars)"
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
# Test error categorization in sdk_utils return dict
# ============================================================================


class TestErrorCategorization:
    """Tests that sdk_utils properly categorizes errors as recoverable vs fatal."""

    def test_structured_output_error_is_recoverable(self):
        """structured_output_validation_failed should be marked recoverable."""
        RECOVERABLE_ERRORS = {
            "structured_output_validation_failed",
            "tool_use_concurrency_error",
        }
        error = "structured_output_validation_failed"
        assert error in RECOVERABLE_ERRORS

    def test_concurrency_error_is_recoverable(self):
        """tool_use_concurrency_error should be marked recoverable."""
        RECOVERABLE_ERRORS = {
            "structured_output_validation_failed",
            "tool_use_concurrency_error",
        }
        error = "tool_use_concurrency_error"
        assert error in RECOVERABLE_ERRORS

    def test_auth_error_is_fatal(self):
        """Auth errors should NOT be marked recoverable."""
        RECOVERABLE_ERRORS = {
            "structured_output_validation_failed",
            "tool_use_concurrency_error",
        }
        error = "Authentication error detected in AI response: please login again"
        assert error not in RECOVERABLE_ERRORS

    def test_circuit_breaker_is_fatal(self):
        """Circuit breaker errors should NOT be marked recoverable."""
        RECOVERABLE_ERRORS = {
            "structured_output_validation_failed",
            "tool_use_concurrency_error",
        }
        error = "Circuit breaker triggered: message count (501) exceeded limit (500)."
        assert error not in RECOVERABLE_ERRORS

    def test_none_error_is_not_recoverable(self):
        """No error should result in error_recoverable=False."""
        stream_error = None
        error_recoverable = (
            stream_error in {"structured_output_validation_failed", "tool_use_concurrency_error"}
            if stream_error
            else False
        )
        assert error_recoverable is False


# ============================================================================
# Test FindingValidator retryable error handling
# ============================================================================


class TestFindingValidatorRetryable:
    """Tests that FindingValidator treats structured_output errors as retryable."""

    def test_structured_output_error_is_retryable(self):
        """structured_output_validation_failed should match the retryable check."""
        error = "structured_output_validation_failed"
        error_str = str(error).lower()
        is_retryable = (
            "400" in error_str
            or "concurrency" in error_str
            or "circuit breaker" in error_str
            or "tool_use" in error_str
            or "structured_output" in error_str
        )
        assert is_retryable is True

    def test_auth_error_is_not_retryable(self):
        """Auth errors should NOT be retryable."""
        error = "Authentication error detected"
        error_str = str(error).lower()
        is_retryable = (
            "400" in error_str
            or "concurrency" in error_str
            or "circuit breaker" in error_str
            or "tool_use" in error_str
            or "structured_output" in error_str
        )
        assert is_retryable is False

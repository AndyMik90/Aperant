"""
Unit Tests for Linear Validation Agent

Tests for:
- Version label calculation (semantic versioning logic)
- Cache TTL enforcement (1-hour timeout)
- Batch validation limits (max 5 tickets)
- Label auto-selection logic
- Retry logic with exponential backoff
- Error formatting and user-friendly messages
"""

import tempfile
from pathlib import Path
from unittest.mock import call

import pytest
from agents.linear_validator import (
    LinearValidationAgent,
    RetryConfig,
    calculate_version_label,
    format_validation_error,
    is_transient_error,
    validate_batch_limit,
)


class TestVersionLabelCalculation:
    """Test semantic versioning logic for version labels."""

    def test_version_label_bug_critical_patch_increment(self):
        """Bug tickets with critical priority should get patch increment."""
        result = calculate_version_label("2.7.4", "bug", "critical")
        assert result == "2.7.5", f"Expected 2.7.5 for critical bug, got {result}"

    def test_version_label_bug_high_priority_patch_increment(self):
        """Bug tickets with high priority should get patch increment."""
        result = calculate_version_label("2.7.4", "bug", "high")
        assert result == "2.7.5", f"Expected 2.7.5 for high priority bug, got {result}"

    def test_version_label_bugfix_patch_increment(self):
        """Bugfix tickets should get patch increment."""
        result = calculate_version_label("2.7.4", "bugfix", "normal")
        assert result == "2.7.5", f"Expected 2.7.5 for bugfix, got {result}"

    def test_version_label_fix_patch_increment(self):
        """Fix tickets should get patch increment."""
        result = calculate_version_label("2.7.4", "fix", "normal")
        assert result == "2.7.5", f"Expected 2.7.5 for fix, got {result}"

    def test_version_label_feature_minor_increment(self):
        """Feature tickets should get minor increment."""
        result = calculate_version_label("2.7.4", "feature", "normal")
        assert result == "2.8.0", f"Expected 2.8.0 for feature, got {result}"

    def test_version_label_enhancement_minor_increment(self):
        """Enhancement tickets should get minor increment."""
        result = calculate_version_label("2.7.4", "enhancement", "normal")
        assert result == "2.8.0", f"Expected 2.8.0 for enhancement, got {result}"

    def test_version_label_new_minor_increment(self):
        """New feature tickets should get minor increment."""
        result = calculate_version_label("2.7.4", "new", "normal")
        assert result == "2.8.0", f"Expected 2.8.0 for new feature, got {result}"

    def test_version_label_enhancement_always_minor_increment(self):
        """Enhancement tickets always get minor increment, regardless of priority."""
        result = calculate_version_label("2.7.4", "enhancement", "urgent")
        assert result == "2.8.0", f"Expected 2.8.0 for enhancement, got {result}"

    def test_version_label_priority_1_non_bug_minor_increment(self):
        """Priority 1 (urgent) non-bug work types get minor increment."""
        result = calculate_version_label("2.7.4", "enhancement", 1)
        assert result == "2.8.0", (
            f"Expected 2.8.0 for priority 1 enhancement, got {result}"
        )

    def test_version_label_priority_2_non_bug_minor_increment(self):
        """Priority 2 (high) non-bug work types get minor increment."""
        result = calculate_version_label("2.7.4", "enhancement", 2)
        assert result == "2.8.0", (
            f"Expected 2.8.0 for priority 2 enhancement, got {result}"
        )

    def test_version_label_normal_priority_minor_increment(self):
        """Normal priority non-bug should get minor increment."""
        result = calculate_version_label("2.7.4", "enhancement", "normal")
        assert result == "2.8.0", f"Expected 2.8.0 for normal priority, got {result}"

    def test_version_label_low_priority_minor_increment(self):
        """Low priority should get minor increment."""
        result = calculate_version_label("2.7.4", "enhancement", "low")
        assert result == "2.8.0", f"Expected 2.8.0 for low priority, got {result}"

    def test_version_label_priority_3_minor_increment(self):
        """Priority 3 (normal) should get minor increment."""
        result = calculate_version_label("2.7.4", "enhancement", 3)
        assert result == "2.8.0", f"Expected 2.8.0 for priority 3, got {result}"

    def test_version_label_priority_4_minor_increment(self):
        """Priority 4 (low) should get minor increment."""
        result = calculate_version_label("2.7.4", "enhancement", 4)
        assert result == "2.8.0", f"Expected 2.8.0 for priority 4, got {result}"

    def test_version_label_missing_patch(self):
        """Handle version without patch component."""
        result = calculate_version_label("2.7", "bug", "critical")
        assert result == "2.7.1", (
            f"Expected 2.7.1 for version without patch, got {result}"
        )

    def test_version_label_missing_patch_minor_increment(self):
        """Handle version without patch for minor increment."""
        result = calculate_version_label("2.7", "feature", "normal")
        assert result == "2.8.0", (
            f"Expected 2.8.0 for feature without patch, got {result}"
        )

    def test_version_label_invalid_format(self):
        """Handle invalid version format gracefully."""
        result = calculate_version_label("invalid", "bug", "critical")
        assert "version format unclear" in result, (
            f"Expected version format unclear message, got {result}"
        )

    def test_version_label_empty_string(self):
        """Handle empty version string."""
        result = calculate_version_label("", "bug", "critical")
        assert "version format unclear" in result, (
            f"Expected version format unclear message, got {result}"
        )

    def test_version_label_case_insensitive(self):
        """Work type should be case-insensitive."""
        result1 = calculate_version_label("2.7.4", "BUG", "critical")
        result2 = calculate_version_label("2.7.4", "Bug", "critical")
        result3 = calculate_version_label("2.7.4", "bug", "critical")
        assert result1 == result2 == result3 == "2.7.5"

    def test_version_label_whitespace_handling(self):
        """Work type with whitespace should be trimmed."""
        result = calculate_version_label("2.7.4", "  bug  ", "critical")
        assert result == "2.7.5", f"Expected 2.7.5 with whitespace, got {result}"


class TestCacheTTLEnforcement:
    """Test cache TTL is set to 1 hour (3600 seconds)."""

    def test_cache_ttl_constant(self):
        """CACHE_TTL_SECONDS should be 3600 (1 hour)."""
        assert LinearValidationAgent.CACHE_TTL_SECONDS == 3600

    def test_cache_initialization(self):
        """Agent should initialize cache with correct TTL."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Verify cache is initialized
            assert agent.cache is not None
            assert hasattr(agent, "CACHE_TTL_SECONDS")
            assert agent.CACHE_TTL_SECONDS == 3600


class TestBatchValidationLimit:
    """Test batch validation limit of 5 tickets."""

    def test_batch_validation_5_tickets_passes(self):
        """Max 5 tickets should pass validation."""
        # Should not raise
        validate_batch_limit(["t1", "t2", "t3", "t4", "t5"])

    def test_batch_validation_1_ticket_passes(self):
        """Single ticket should pass validation."""
        validate_batch_limit(["t1"])

    def test_batch_validation_0_tickets_passes(self):
        """Empty list should pass validation."""
        validate_batch_limit([])

    def test_batch_validation_6_tickets_raises(self):
        """6+ tickets should raise ValueError."""
        with pytest.raises(ValueError, match="Maximum 5 tickets"):
            validate_batch_limit(["t1", "t2", "t3", "t4", "t5", "t6"])

    def test_batch_validation_10_tickets_raises(self):
        """10 tickets should raise ValueError with correct count."""
        with pytest.raises(ValueError, match="Got 10 tickets"):
            validate_batch_limit(
                ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"]
            )

    def test_batch_validation_error_message(self):
        """Error message should include max and actual count."""
        with pytest.raises(ValueError) as exc_info:
            validate_batch_limit(["t1", "t2", "t3", "t4", "t5", "t6", "t7"])

        error_msg = str(exc_info.value)
        assert "Maximum 5 tickets" in error_msg
        assert "Got 7 tickets" in error_msg


class TestLinearValidationAgentClassMethods:
    """Test LinearValidationAgent class methods."""

    @pytest.mark.asyncio
    async def test_agent_validate_batch_5_tickets(self):
        """Agent method should allow 5 tickets."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Should not raise
            await agent.validate_batch(
                [
                    {"id": "t1"},
                    {"id": "t2"},
                    {"id": "t3"},
                    {"id": "t4"},
                    {"id": "t5"},
                ]
            )

    @pytest.mark.asyncio
    async def test_agent_validate_batch_6_tickets_raises(self):
        """Agent method should raise on 6+ tickets."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            with pytest.raises(ValueError, match="Maximum 5 tickets"):
                await agent.validate_batch(
                    [
                        {"id": "t1"},
                        {"id": "t2"},
                        {"id": "t3"},
                        {"id": "t4"},
                        {"id": "t5"},
                        {"id": "t6"},
                    ]
                )

    def test_agent_compute_version_label_bug(self):
        """Agent method should calculate patch increment for bugs."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            result = agent.compute_version_label("2.7.4", "bug", "critical")
            assert result == "2.7.5"

    def test_agent_compute_version_label_feature(self):
        """Agent method should calculate minor increment for features."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            result = agent.compute_version_label("2.7.4", "feature", "normal")
            assert result == "2.8.0"


class TestCacheKeyGeneration:
    """Test cache key generation logic."""

    def test_cache_key_format(self):
        """Cache key should be in format 'issue_id:timestamp' with sanitized colons."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Colons in timestamp are sanitized to underscores for cache safety
            cache_key = agent._get_cache_key("LIN-123", "2024-01-18T10:00:00Z")
            assert cache_key == "LIN-123:2024-01-18T10_00_00Z"

    def test_cache_key_different_timestamps(self):
        """Different timestamps should produce different cache keys."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            key1 = agent._get_cache_key("LIN-123", "2024-01-18T10:00:00Z")
            key2 = agent._get_cache_key("LIN-123", "2024-01-18T11:00:00Z")
            assert key1 != key2

    def test_cache_key_with_colon_in_issue_id(self):
        """Issue IDs with colons should be sanitized to prevent delimiter conflicts."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Colons in issue_id and timestamp are replaced with underscores
            cache_key = agent._get_cache_key("LIN:123", "2024-01-18T10:00:00Z")
            assert cache_key == "LIN_123:2024-01-18T10_00_00Z"

    def test_cache_key_with_control_characters(self):
        """Control characters in timestamp should be sanitized."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Newlines should be replaced with underscores
            cache_key = agent._get_cache_key(
                "LIN-123", "2024-01-18T10:00:00Z\nwith\nnewline"
            )
            assert "\n" not in cache_key
            assert "\r" not in cache_key

    def test_cache_key_empty_timestamp_uses_default(self):
        """Empty timestamp should use 'unknown' default."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            cache_key = agent._get_cache_key("LIN-123", "")
            assert cache_key == "LIN-123:unknown"

    def test_cache_key_none_timestamp_uses_default(self):
        """None timestamp should use 'unknown' default."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            cache_key = agent._get_cache_key("LIN-123", None)  # type: ignore
            assert cache_key == "LIN-123:unknown"

    def test_cache_key_empty_issue_id_raises(self):
        """Empty issue_id should raise ValueError."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            with pytest.raises(ValueError, match="Invalid issue_id"):
                agent._get_cache_key("", "2024-01-18T10:00:00Z")

    def test_cache_key_none_issue_id_raises(self):
        """None issue_id should raise ValueError."""
        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            with pytest.raises(ValueError, match="Invalid issue_id"):
                agent._get_cache_key(None, "2024-01-18T10:00:00Z")  # type: ignore


class TestTransientErrorDetection:
    """Test transient error detection for retry logic."""

    def test_timeout_is_transient(self):
        """Timeout errors should be considered transient."""
        assert is_transient_error(Exception("Request timeout"))

    def test_connection_error_is_transient(self):
        """Connection errors should be considered transient."""
        assert is_transient_error(Exception("Connection refused"))

    def test_network_error_is_transient(self):
        """Network errors should be considered transient."""
        assert is_transient_error(Exception("Network unreachable"))

    def test_429_rate_limit_is_transient(self):
        """HTTP 429 rate limit errors should be considered transient."""
        assert is_transient_error(Exception("HTTP 429: Too Many Requests"))

    def test_503_service_unavailable_is_transient(self):
        """HTTP 503 service unavailable should be considered transient."""
        assert is_transient_error(Exception("HTTP 503: Service Unavailable"))

    def test_500_internal_server_error_is_transient(self):
        """HTTP 500 internal server error should be considered transient."""
        assert is_transient_error(Exception("HTTP 500: Internal Server Error"))

    def test_502_bad_gateway_is_transient(self):
        """HTTP 502 bad gateway should be considered transient."""
        assert is_transient_error(Exception("HTTP 502: Bad Gateway"))

    def test_401_unauthorized_is_not_transient(self):
        """HTTP 401 unauthorized should NOT be considered transient."""
        assert not is_transient_error(Exception("HTTP 401: Unauthorized"))

    def test_404_not_found_is_not_transient(self):
        """HTTP 404 not found should NOT be considered transient."""
        assert not is_transient_error(Exception("HTTP 404: Not Found"))

    def test_validation_error_is_not_transient(self):
        """Validation errors should NOT be considered transient."""
        assert not is_transient_error(Exception("Invalid input: missing field"))


class TestRetryConfiguration:
    """Test retry configuration for exponential backoff."""

    def test_default_retry_config(self):
        """Default retry config should have sensible defaults."""
        config = RetryConfig()
        assert config.max_retries == 3
        assert config.base_delay == 1.0
        assert config.max_delay == 60.0
        assert config.exponential_base == 2.0
        assert config.jitter is True

    def test_custom_retry_config(self):
        """Custom retry config should use provided values."""
        config = RetryConfig(
            max_retries=5,
            base_delay=2.0,
            max_delay=120.0,
            exponential_base=3.0,
            jitter=False,
        )
        assert config.max_retries == 5
        assert config.base_delay == 2.0
        assert config.max_delay == 120.0
        assert config.exponential_base == 3.0
        assert config.jitter is False


class TestValidationErrorFormatting:
    """Test error formatting for user-friendly messages."""

    def test_timeout_error_formatting(self):
        """Timeout errors should have helpful message."""
        error = Exception("Request timed out after 30 seconds")
        message = format_validation_error(error)
        assert "timed out" in message.lower()

    def test_authentication_error_formatting(self):
        """Authentication errors should mention API key."""
        error = Exception("HTTP 401: Unauthorized")
        message = format_validation_error(error)
        assert "authentication" in message.lower() or "api key" in message.lower()

    def test_rate_limit_error_formatting(self):
        """Rate limit errors should suggest waiting."""
        error = Exception("HTTP 429: Too Many Requests")
        message = format_validation_error(error)
        assert "rate limit" in message.lower() or "wait" in message.lower()

    def test_network_error_formatting(self):
        """Network errors should suggest checking connection."""
        error = Exception("Connection refused")
        message = format_validation_error(error)
        assert "network" in message.lower() or "connection" in message.lower()

    def test_parse_error_formatting(self):
        """Parse errors should mention response format."""
        error = Exception("Failed to parse JSON response")
        message = format_validation_error(error)
        assert "process" in message.lower() or "parse" in message.lower()


class TestLabelExtraction:
    """Test label extraction from issue data."""

    def test_extract_labels_from_list(self):
        """Labels should be extracted correctly from a list."""
        issue_data = {
            "labels": [
                {"name": "bug"},
                {"name": "high-priority"},
                {"name": "backend"},
            ]
        }
        labels = [label.get("name", "") for label in issue_data.get("labels", [])]
        assert labels == ["bug", "high-priority", "backend"]

    def test_extract_labels_from_empty_list(self):
        """Empty labels list should produce empty list."""
        issue_data = {"labels": []}
        labels = [label.get("name", "") for label in issue_data.get("labels", [])]
        assert labels == []

    def test_extract_labels_from_missing_field(self):
        """Missing labels field should use default empty list."""
        issue_data = {}
        labels = [label.get("name", "") for label in issue_data.get("labels", [])]
        assert labels == []

    def test_extract_labels_handles_missing_name(self):
        """Labels without name field should default to empty string."""
        issue_data = {
            "labels": [
                {"name": "bug"},
                {"color": "red"},  # Missing name
                {"name": "backend"},
            ]
        }
        labels = [label.get("name", "") for label in issue_data.get("labels", [])]
        assert labels == ["bug", "", "backend"]


class TestValidationExceptions:
    """Test Linear validation exception classes."""

    def test_validation_error_base_class_instantiation(self):
        """ValidationError base class should initialize with all parameters."""
        from agents.linear_validator import ValidationError

        error = ValidationError(
            message="Base validation error",
            issue_id="LIN-123",
            details={"key": "value"},
        )
        assert str(error) == "[LIN-123] Base validation error"
        assert error.issue_id == "LIN-123"
        assert error.details == {"key": "value"}

    def test_validation_error_without_issue_id(self):
        """ValidationError should format correctly without issue_id."""
        from agents.linear_validator import ValidationError

        error = ValidationError(message="Base validation error")
        assert str(error) == "Base validation error"
        assert error.issue_id is None
        assert error.details == {}

    def test_validation_timeout_error_instantiation(self):
        """ValidationTimeoutError should initialize with required parameters."""
        from agents.linear_validator import ValidationTimeoutError

        error = ValidationTimeoutError(issue_id="LIN-456", timeout_seconds=30.5)
        assert error.issue_id == "LIN-456"
        assert error.details == {"timeout_seconds": 30.5}
        assert "timed out after 30 seconds" in str(error).lower()

    def test_authentication_error_instantiation(self):
        """AuthenticationError should initialize with message."""
        from agents.linear_validator import AuthenticationError

        error = AuthenticationError()
        assert error.issue_id is None
        assert error.details == {"error_type": "authentication"}
        assert "LINEAR_API_KEY" in str(error)

    def test_rate_limit_error_instantiation(self):
        """RateLimitError should initialize with default message."""
        from agents.linear_validator import RateLimitError

        error = RateLimitError()
        assert error.issue_id is None
        assert error.details == {
            "error_type": "rate_limit",
            "retry_after": None,
        }
        assert "rate limit exceeded" in str(error).lower()

    def test_rate_limit_error_with_retry_after(self):
        """RateLimitError should include retry_after in message."""
        from agents.linear_validator import RateLimitError

        error = RateLimitError(retry_after=120.5)
        assert "Retry after 120 seconds" in str(error)
        assert error.details["retry_after"] == 120.5

    def test_network_error_instantiation(self):
        """NetworkError should initialize with issue_id."""
        from agents.linear_validator import NetworkError

        error = NetworkError(issue_id="LIN-999", details="Connection refused")
        assert error.issue_id == "LIN-999"
        assert error.details == {"error_type": "network"}
        assert "internet connection" in str(error).lower()

    def test_ticket_not_found_error_instantiation(self):
        """TicketNotFoundError should initialize with issue_id."""
        from agents.linear_validator import TicketNotFoundError

        error = TicketNotFoundError(issue_id="LIN-404")
        assert error.issue_id == "LIN-404"
        assert error.details == {"error_type": "not_found"}

    def test_invalid_response_error_instantiation(self):
        """InvalidResponseError should initialize with issue_id."""
        from agents.linear_validator import InvalidResponseError

        error = InvalidResponseError(issue_id="LIN-500")
        assert error.issue_id == "LIN-500"
        assert error.details == {
            "error_type": "invalid_response",
            "reason": "",
        }

    def test_exception_hierarchy(self):
        """All validation exceptions should inherit from ValidationError."""
        from agents.linear_validator import (
            AuthenticationError,
            InvalidResponseError,
            NetworkError,
            RateLimitError,
            TicketNotFoundError,
            ValidationError,
            ValidationTimeoutError,
        )

        assert issubclass(ValidationTimeoutError, ValidationError)
        assert issubclass(AuthenticationError, ValidationError)
        assert issubclass(RateLimitError, ValidationError)
        assert issubclass(NetworkError, ValidationError)
        assert issubclass(TicketNotFoundError, ValidationError)
        assert issubclass(InvalidResponseError, ValidationError)


class TestRetryWithExponentialBackoff:
    """Test retry logic with exponential backoff."""

    @pytest.mark.asyncio
    async def test_success_on_first_attempt_no_retry(self):
        """Successful execution on first attempt should not retry."""
        from unittest.mock import AsyncMock

        from agents.linear_validator import retry_with_exponential_backoff

        async_func = AsyncMock(return_value="success")

        result = await retry_with_exponential_backoff(async_func)

        assert result == "success"
        assert async_func.call_count == 1

    @pytest.mark.asyncio
    async def test_retry_on_timeout_transient_error(self):
        """Should retry on timeout transient error."""
        from unittest.mock import AsyncMock, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(
            side_effect=[
                Exception("Request timeout"),
                Exception("Request timeout"),
                "success",
            ]
        )

        with patch("asyncio.sleep"):
            result = await retry_with_exponential_backoff(
                async_func,
                config=RetryConfig(max_retries=3, base_delay=0.1),
                context="test_timeout",
            )

        assert result == "success"
        assert async_func.call_count == 3

    @pytest.mark.asyncio
    async def test_no_retry_on_401_non_transient_error(self):
        """Should NOT retry on HTTP 401 unauthorized error."""
        from unittest.mock import AsyncMock, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(side_effect=Exception("HTTP 401: Unauthorized"))

        with patch("asyncio.sleep"):
            with pytest.raises(Exception, match="HTTP 401"):
                await retry_with_exponential_backoff(
                    async_func,
                    config=RetryConfig(max_retries=3),
                )

        assert async_func.call_count == 1

    @pytest.mark.asyncio
    async def test_no_retry_on_404_non_transient_error(self):
        """Should NOT retry on HTTP 404 not found error."""
        from unittest.mock import AsyncMock, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(side_effect=Exception("HTTP 404: Not Found"))

        with patch("asyncio.sleep"):
            with pytest.raises(Exception, match="HTTP 404"):
                await retry_with_exponential_backoff(
                    async_func,
                    config=RetryConfig(max_retries=3),
                )

        assert async_func.call_count == 1

    @pytest.mark.asyncio
    async def test_exponential_backoff_delay_calculation(self):
        """Delay should be calculated as base_delay * exponential_base^attempt."""
        import asyncio
        from unittest.mock import AsyncMock, call, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(
            side_effect=[
                Exception("timeout"),
                Exception("timeout"),
                Exception("timeout"),
                "success",
            ]
        )

        # With base_delay=2.0 and exponential_base=2.0:
        # Attempt 0: delay = 2.0 * 2^0 = 2.0
        # Attempt 1: delay = 2.0 * 2^1 = 4.0
        # Attempt 2: delay = 2.0 * 2^2 = 8.0
        sleep_mock = patch("asyncio.sleep")
        with sleep_mock as mock_sleep:
            result = await retry_with_exponential_backoff(
                async_func,
                config=RetryConfig(
                    max_retries=3, base_delay=2.0, exponential_base=2.0, jitter=False
                ),
            )

        assert result == "success"
        assert async_func.call_count == 4
        # Verify sleep was called 3 times with correct delays
        assert mock_sleep.call_count == 3
        mock_sleep.assert_has_calls([call(2.0), call(4.0), call(8.0)])

    @pytest.mark.asyncio
    async def test_jitter_application_when_enabled(self):
        """Jitter should be applied when enabled, randomizing delay."""
        from unittest.mock import AsyncMock, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(
            side_effect=[
                Exception("timeout"),
                "success",
            ]
        )

        # Patch random to return predictable value (0.75)
        # With base_delay=1.0, jitter: delay = 1.0 * (0.5 + 0.75) = 1.25
        with (
            patch("random.random", return_value=0.75),
            patch("asyncio.sleep") as mock_sleep,
        ):
            result = await retry_with_exponential_backoff(
                async_func,
                config=RetryConfig(max_retries=2, base_delay=1.0, jitter=True),
            )

        assert result == "success"
        # Jitter should result in non-integer delay
        mock_sleep.assert_called_once()
        sleep_arg = mock_sleep.call_args[0][0]
        # With 0.75 random, delay = 1.0 * (0.5 + 0.75) = 1.25
        assert sleep_arg == 1.25

    @pytest.mark.asyncio
    async def test_no_jitter_when_disabled(self):
        """Delay should be exact when jitter is disabled."""
        from unittest.mock import AsyncMock, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(
            side_effect=[
                Exception("timeout"),
                "success",
            ]
        )

        # Without jitter, delay should be exactly base_delay * exponential_base^attempt
        # Attempt 0: delay = 2.0 * 3^0 = 2.0
        with patch("asyncio.sleep") as mock_sleep:
            result = await retry_with_exponential_backoff(
                async_func,
                config=RetryConfig(
                    max_retries=2,
                    base_delay=2.0,
                    exponential_base=3.0,
                    jitter=False,
                ),
            )

        assert result == "success"
        mock_sleep.assert_called_once_with(2.0)

    @pytest.mark.asyncio
    async def test_max_delay_capping(self):
        """Delay should be capped at max_delay value."""
        from unittest.mock import AsyncMock, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(
            side_effect=[
                Exception("timeout"),
                Exception("timeout"),
                Exception("timeout"),
                "success",
            ]
        )

        # With base_delay=10, exponential_base=3:
        # Attempt 0: 10 * 3^0 = 10 (capped to 15)
        # Attempt 1: 10 * 3^1 = 30 (capped to 15)
        # Attempt 2: 10 * 3^2 = 90 (capped to 15)
        with patch("asyncio.sleep") as mock_sleep:
            result = await retry_with_exponential_backoff(
                async_func,
                config=RetryConfig(
                    max_retries=3,
                    base_delay=10.0,
                    max_delay=15.0,
                    exponential_base=3.0,
                    jitter=False,
                ),
            )

        assert result == "success"
        assert mock_sleep.call_count == 3
        # All delays should be capped at 15.0
        mock_sleep.assert_has_calls([call(10.0), call(15.0), call(15.0)])

    @pytest.mark.asyncio
    async def test_max_retries_exhaustion(self):
        """Should raise last exception after max_retries exhausted."""
        from unittest.mock import AsyncMock, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(side_effect=Exception("Connection timeout"))

        with patch("asyncio.sleep"):
            with pytest.raises(Exception, match="Connection timeout"):
                await retry_with_exponential_backoff(
                    async_func,
                    config=RetryConfig(max_retries=2, base_delay=0.1),
                )

        # Should be called max_retries + 1 (initial + 2 retries = 3 total)
        assert async_func.call_count == 3

    @pytest.mark.asyncio
    async def test_custom_retry_configuration(self):
        """Should use custom retry configuration when provided."""
        from unittest.mock import AsyncMock, patch

        from agents.linear_validator import (
            RetryConfig,
            retry_with_exponential_backoff,
        )

        async_func = AsyncMock(
            side_effect=[
                Exception("timeout"),
                Exception("timeout"),
                Exception("timeout"),
                Exception("timeout"),
                Exception("timeout"),
                "success",
            ]
        )

        custom_config = RetryConfig(
            max_retries=5,
            base_delay=0.5,
            max_delay=10.0,
            exponential_base=2.0,
            jitter=False,
        )

        with patch("asyncio.sleep") as mock_sleep:
            result = await retry_with_exponential_backoff(
                async_func,
                config=custom_config,
            )

        assert result == "success"
        assert async_func.call_count == 6
        # Verify exponential delays: 0.5, 1.0, 2.0, 4.0, 8.0
        mock_sleep.assert_has_calls(
            [call(0.5), call(1.0), call(2.0), call(4.0), call(8.0)]
        )


class TestValidationResultParsing:
    """Test parsing of AI validation result responses."""

    def test_parse_valid_json_all_fields(self):
        """Valid JSON response with all fields should parse correctly."""
        import json

        response_text = """{
  "contentAnalysis": {
    "title": "Fix login bug",
    "descriptionSummary": "Users cannot login with SSO",
    "requirements": ["Reproduce SSO login issue", "Fix OAuth flow"]
  },
  "completenessValidation": {
    "isComplete": true,
    "missingFields": [],
    "feasibilityScore": 85,
    "feasibilityReasoning": "Clear bug with known reproduction steps"
  },
  "suggestedLabels": ["bug", "auth", "high-priority"],
  "versionRecommendation": {
    "recommendedVersion": "2.7.5",
    "versionType": "patch",
    "reasoning": "Bug fix requires patch increment"
  },
  "taskProperties": {
    "category": "bug",
    "complexity": "medium",
    "impact": "high",
    "priority": "p2",
    "rationale": "Affects user login functionality"
  }
}"""

        parsed = json.loads(response_text)

        assert parsed["contentAnalysis"]["title"] == "Fix login bug"
        assert (
            parsed["contentAnalysis"]["descriptionSummary"]
            == "Users cannot login with SSO"
        )
        assert len(parsed["contentAnalysis"]["requirements"]) == 2
        assert parsed["completenessValidation"]["isComplete"] is True
        assert parsed["completenessValidation"]["feasibilityScore"] == 85
        assert len(parsed["suggestedLabels"]) == 3
        assert parsed["versionRecommendation"]["versionType"] == "patch"
        assert parsed["taskProperties"]["category"] == "bug"

    def test_parse_json_in_markdown_code_block(self):
        """JSON wrapped in markdown code block should be extracted."""
        import json
        import re

        response_text = """Here's my analysis:

```json
{
  "contentAnalysis": {
    "title": "Add user settings page",
    "descriptionSummary": "Create settings UI for users",
    "requirements": ["Design UI", "Implement form"]
  },
  "completenessValidation": {
    "isComplete": false,
    "missingFields": ["No mockups provided"],
    "feasibilityScore": 70,
    "feasibilityReasoning": "Standard CRUD but needs design"
  },
  "suggestedLabels": ["feature", "frontend"],
  "versionRecommendation": {
    "recommendedVersion": "2.8.0",
    "versionType": "minor",
    "reasoning": "New feature requires minor increment"
  },
  "taskProperties": {
    "category": "feature",
    "complexity": "medium",
    "impact": "medium",
    "priority": "p3",
    "rationale": "Nice to have feature"
  }
}
```

I hope this helps!"""

        # Extract JSON from markdown code block
        match = re.search(r"```json\s*(.*?)\s*```", response_text, re.DOTALL)
        assert match is not None
        json_str = match.group(1)
        parsed = json.loads(json_str)

        assert parsed["contentAnalysis"]["title"] == "Add user settings page"
        assert parsed["completenessValidation"]["isComplete"] is False
        assert parsed["completenessValidation"]["missingFields"] == [
            "No mockups provided"
        ]

    def test_parse_malformed_json_raises_error(self):
        """Malformed JSON should raise JSON decode error."""
        import json

        response_text = """{
  "contentAnalysis": {
    "title": "Broken JSON"
  },
  # This is a comment - invalid JSON
  "invalid": [
}"""

        with pytest.raises(json.JSONDecodeError):
            json.loads(response_text)

    def test_parse_response_with_text_around_json(self):
        """Response with explanatory text before/after JSON should extract JSON."""
        import json
        import re

        response_text = """I've analyzed this ticket and here are my findings:

The ticket is well-structured but missing some details.

```json
{
  "contentAnalysis": {
    "title": "API Rate Limiting",
    "descriptionSummary": "Implement rate limiting on API endpoints",
    "requirements": ["Add rate limiter middleware", "Configure limits"]
  },
  "completenessValidation": {
    "isComplete": true,
    "missingFields": [],
    "feasibilityScore": 90,
    "feasibilityReasoning": "Standard implementation pattern"
  },
  "suggestedLabels": ["feature", "backend", "api"],
  "versionRecommendation": {
    "recommendedVersion": "1.1.0",
    "versionType": "minor",
    "reasoning": "New feature"
  },
  "taskProperties": {
    "category": "feature",
    "complexity": "medium",
    "impact": "medium",
    "priority": "p3",
    "rationale": "Infrastructure improvement"
  }
}
```

Let me know if you need more details!"""

        # Extract JSON from markdown code block
        match = re.search(r"```json\s*(.*?)\s*```", response_text, re.DOTALL)
        assert match is not None
        json_str = match.group(1)
        parsed = json.loads(json_str)

        assert parsed["contentAnalysis"]["title"] == "API Rate Limiting"
        assert parsed["suggestedLabels"] == ["feature", "backend", "api"]

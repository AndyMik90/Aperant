"""
Tests for GitHub Automation Errors (errors.py)
==============================================

Tests the structured error system, exception classes,
and error handling utilities.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from runners.github.errors import (
    ErrorCategory,
    ErrorSeverity,
    StructuredError,
    GitHubAutomationError,
    AuthenticationError,
    PermissionDeniedError,
    TokenExpiredError,
    InsufficientScopeError,
    RateLimitError,
    CostLimitError,
    NetworkError,
    TimeoutError,
    APIError,
    ServiceUnavailableError,
    ValidationError,
    InvalidInputError,
    NotFoundError,
    InvalidStateError,
    ConflictError,
    AlreadyExistsError,
    BotDetectedError,
    CancelledError,
    ConfigurationError,
    capture_error,
    format_error_for_ui,
    Result,
)


# ============================================================================
# ErrorCategory Tests
# ============================================================================


class TestErrorCategory:
    """Tests for ErrorCategory enum."""

    def test_authentication_categories(self):
        """Test authentication-related error categories."""
        assert ErrorCategory.AUTHENTICATION == "authentication"
        assert ErrorCategory.PERMISSION == "permission"
        assert ErrorCategory.TOKEN_EXPIRED == "token_expired"
        assert ErrorCategory.INSUFFICIENT_SCOPE == "insufficient_scope"

    def test_rate_limit_categories(self):
        """Test rate limiting error categories."""
        assert ErrorCategory.RATE_LIMITED == "rate_limited"
        assert ErrorCategory.COST_EXCEEDED == "cost_exceeded"

    def test_network_categories(self):
        """Test network/API error categories."""
        assert ErrorCategory.NETWORK == "network"
        assert ErrorCategory.TIMEOUT == "timeout"
        assert ErrorCategory.API_ERROR == "api_error"
        assert ErrorCategory.SERVICE_UNAVAILABLE == "service_unavailable"

    def test_validation_categories(self):
        """Test validation error categories."""
        assert ErrorCategory.VALIDATION == "validation"
        assert ErrorCategory.INVALID_INPUT == "invalid_input"
        assert ErrorCategory.NOT_FOUND == "not_found"

    def test_state_categories(self):
        """Test state error categories."""
        assert ErrorCategory.INVALID_STATE == "invalid_state"
        assert ErrorCategory.CONFLICT == "conflict"
        assert ErrorCategory.ALREADY_EXISTS == "already_exists"

    def test_internal_categories(self):
        """Test internal error categories."""
        assert ErrorCategory.INTERNAL == "internal"
        assert ErrorCategory.CONFIGURATION == "configuration"

    def test_bot_categories(self):
        """Test bot/automation error categories."""
        assert ErrorCategory.BOT_DETECTED == "bot_detected"
        assert ErrorCategory.CANCELLED == "cancelled"


# ============================================================================
# ErrorSeverity Tests
# ============================================================================


class TestErrorSeverity:
    """Tests for ErrorSeverity enum."""

    def test_severity_levels(self):
        """Test severity levels."""
        assert ErrorSeverity.INFO == "info"
        assert ErrorSeverity.WARNING == "warning"
        assert ErrorSeverity.ERROR == "error"
        assert ErrorSeverity.CRITICAL == "critical"


# ============================================================================
# StructuredError Tests
# ============================================================================


class TestStructuredError:
    """Tests for StructuredError dataclass."""

    def test_create_minimal(self):
        """Test creating a minimal StructuredError."""
        error = StructuredError(
            message="Something went wrong",
            category=ErrorCategory.INTERNAL
        )
        assert error.message == "Something went wrong"
        assert error.category == ErrorCategory.INTERNAL
        assert error.severity == ErrorSeverity.ERROR  # default

    def test_create_with_all_fields(self):
        """Test creating StructuredError with all fields."""
        error = StructuredError(
            message="API error",
            category=ErrorCategory.API_ERROR,
            severity=ErrorSeverity.CRITICAL,
            code="API_001",
            correlation_id="abc-123",
            details={"status_code": 500},
            retryable=True,
            retry_after_seconds=60,
            action_hint="Retry later",
            help_url="https://example.com/help",
            source="orchestrator.review_pr",
            pr_number=42,
            issue_number=100,
            repo="owner/repo"
        )
        assert error.message == "API error"
        assert error.code == "API_001"
        assert error.correlation_id == "abc-123"
        assert error.retryable is True
        assert error.retry_after_seconds == 60
        assert error.pr_number == 42

    def test_timestamp_default_factory(self):
        """Test timestamp is set by default factory."""
        before = datetime.now(timezone.utc).isoformat()
        error = StructuredError(
            message="Test",
            category=ErrorCategory.INTERNAL
        )
        after = datetime.now(timezone.utc).isoformat()
        # Timestamp should be between before and after
        assert before <= error.timestamp <= after

    def test_to_dict(self):
        """Test converting to dictionary."""
        error = StructuredError(
            message="Test error",
            category=ErrorCategory.VALIDATION,
            severity=ErrorSeverity.WARNING,
            code="VAL_001",
            correlation_id="corr-123",
            details={"field": "email"},
            retryable=True,
            action_hint="Fix the email format"
        )
        result = error.to_dict()
        assert result["message"] == "Test error"
        assert result["category"] == "validation"
        assert result["severity"] == "warning"
        assert result["code"] == "VAL_001"
        assert result["correlation_id"] == "corr-123"
        assert result["details"]["field"] == "email"
        assert result["retryable"] is True
        assert result["action_hint"] == "Fix the email format"

    def test_from_exception_basic(self):
        """Test creating from exception."""
        exc = ValueError("Invalid value")
        error = StructuredError.from_exception(exc)
        assert error.message == "Invalid value"
        assert error.category == ErrorCategory.INTERNAL
        assert error.code == "ValueError"
        assert error.stack_trace is not None

    def test_from_exception_with_category(self):
        """Test creating from exception with custom category."""
        exc = ValueError("Invalid value")
        error = StructuredError.from_exception(
            exc,
            category=ErrorCategory.VALIDATION,
            severity=ErrorSeverity.WARNING
        )
        assert error.category == ErrorCategory.VALIDATION
        assert error.severity == ErrorSeverity.WARNING

    def test_from_exception_with_correlation_id(self):
        """Test creating from exception with correlation ID."""
        exc = RuntimeError("Failed")
        error = StructuredError.from_exception(
            exc,
            correlation_id="test-123"
        )
        assert error.correlation_id == "test-123"


# ============================================================================
# GitHubAutomationError Tests
# ============================================================================


class TestGitHubAutomationError:
    """Tests for GitHubAutomationError base class."""

    def test_basic_error(self):
        """Test basic error creation."""
        error = GitHubAutomationError("Something failed")
        assert error.message == "Something failed"
        assert error.category == ErrorCategory.INTERNAL
        assert error.severity == ErrorSeverity.ERROR
        assert error.retryable is False

    def test_error_with_details(self):
        """Test error with details."""
        error = GitHubAutomationError(
            "Failed",
            details={"attempt": 3, "max_attempts": 5}
        )
        assert error.details["attempt"] == 3
        assert error.details["max_attempts"] == 5

    def test_error_with_correlation_id(self):
        """Test error with correlation ID."""
        error = GitHubAutomationError(
            "Failed",
            correlation_id="corr-xyz"
        )
        assert error.correlation_id == "corr-xyz"

    def test_to_structured_error(self):
        """Test converting to StructuredError."""
        error = GitHubAutomationError(
            "Test error",
            details={"key": "value"},
            correlation_id="abc",
            source="test.module",
            pr_number=10
        )
        structured = error.to_structured_error()
        assert structured.message == "Test error"
        assert structured.category == ErrorCategory.INTERNAL
        assert structured.details["key"] == "value"
        assert structured.correlation_id == "abc"
        assert structured.source == "test.module"
        assert structured.pr_number == 10
        assert structured.stack_trace is not None


# ============================================================================
# Authentication Error Tests
# ============================================================================


class TestAuthenticationErrors:
    """Tests for authentication-related errors."""

    def test_authentication_error(self):
        """Test AuthenticationError."""
        error = AuthenticationError("Auth failed")
        assert error.message == "Auth failed"
        assert error.category == ErrorCategory.AUTHENTICATION
        assert error.action_hint == "Check your GitHub token configuration"

    def test_permission_denied_error(self):
        """Test PermissionDeniedError."""
        error = PermissionDeniedError("No access")
        assert error.category == ErrorCategory.PERMISSION
        assert error.action_hint == "Ensure you have the required permissions"

    def test_token_expired_error(self):
        """Test TokenExpiredError."""
        error = TokenExpiredError("Token expired")
        assert error.category == ErrorCategory.TOKEN_EXPIRED
        assert error.action_hint == "Regenerate your GitHub token"

    def test_insufficient_scope_error(self):
        """Test InsufficientScopeError."""
        error = InsufficientScopeError("Missing scopes")
        assert error.category == ErrorCategory.INSUFFICIENT_SCOPE
        assert error.action_hint == "Regenerate token with required scopes: repo, read:org"


# ============================================================================
# Rate Limit Error Tests
# ============================================================================


class TestRateLimitErrors:
    """Tests for rate limit related errors."""

    def test_rate_limit_error_basic(self):
        """Test RateLimitError with default retry."""
        error = RateLimitError("Rate limited")
        assert error.category == ErrorCategory.RATE_LIMITED
        assert error.severity == ErrorSeverity.WARNING
        assert error.retryable is True
        assert error.retry_after_seconds == 60

    def test_rate_limit_error_custom_retry(self):
        """Test RateLimitError with custom retry after."""
        error = RateLimitError("Rate limited", retry_after_seconds=120)
        assert error.retry_after_seconds == 120
        assert "120" in error.action_hint

    def test_rate_limit_to_structured(self):
        """Test RateLimitError converts to StructuredError."""
        error = RateLimitError("Too many requests", retry_after_seconds=30)
        structured = error.to_structured_error()
        assert structured.retry_after_seconds == 30

    def test_cost_limit_error(self):
        """Test CostLimitError."""
        error = CostLimitError("Budget exceeded")
        assert error.category == ErrorCategory.COST_EXCEEDED
        assert error.action_hint == "Increase cost limit in settings or wait until reset"


# ============================================================================
# Network/API Error Tests
# ============================================================================


class TestNetworkAPIErrors:
    """Tests for network and API errors."""

    def test_network_error(self):
        """Test NetworkError."""
        error = NetworkError("Connection failed")
        assert error.category == ErrorCategory.NETWORK
        assert error.retryable is True
        assert error.action_hint == "Check your internet connection and retry"

    def test_timeout_error(self):
        """Test TimeoutError."""
        error = TimeoutError("Request timed out")
        assert error.category == ErrorCategory.TIMEOUT
        assert error.retryable is True
        assert error.action_hint == "The operation took too long. Try again"

    def test_api_error_basic(self):
        """Test APIError without status code."""
        error = APIError("API failed")
        assert error.category == ErrorCategory.API_ERROR
        assert error.status_code is None
        assert error.retryable is False

    def test_api_error_with_status_4xx(self):
        """Test APIError with 4xx status code."""
        error = APIError("Not found", status_code=404)
        assert error.status_code == 404
        assert error.details["status_code"] == 404
        assert error.retryable is False

    def test_api_error_with_status_5xx(self):
        """Test APIError with 5xx status code."""
        error = APIError("Server error", status_code=503)
        assert error.status_code == 503
        assert error.retryable is True
        assert error.action_hint == "GitHub service issue. Retry later"

    def test_service_unavailable_error(self):
        """Test ServiceUnavailableError."""
        error = ServiceUnavailableError("Maintenance mode")
        assert error.category == ErrorCategory.SERVICE_UNAVAILABLE
        assert error.retryable is True
        assert error.action_hint == "Service temporarily unavailable. Retry in a few minutes"


# ============================================================================
# Validation Error Tests
# ============================================================================


class TestValidationErrors:
    """Tests for validation-related errors."""

    def test_validation_error(self):
        """Test ValidationError."""
        error = ValidationError("Invalid data")
        assert error.category == ErrorCategory.VALIDATION

    def test_invalid_input_error(self):
        """Test InvalidInputError."""
        error = InvalidInputError("Bad input")
        assert error.category == ErrorCategory.INVALID_INPUT

    def test_not_found_error(self):
        """Test NotFoundError."""
        error = NotFoundError("Resource missing")
        assert error.category == ErrorCategory.NOT_FOUND


# ============================================================================
# State Error Tests
# ============================================================================


class TestStateErrors:
    """Tests for state-related errors."""

    def test_invalid_state_error(self):
        """Test InvalidStateError."""
        error = InvalidStateError("Wrong state")
        assert error.category == ErrorCategory.INVALID_STATE

    def test_conflict_error(self):
        """Test ConflictError."""
        error = ConflictError("Concurrent modification")
        assert error.category == ErrorCategory.CONFLICT
        assert error.action_hint == "Another operation is in progress. Wait and retry"

    def test_already_exists_error(self):
        """Test AlreadyExistsError."""
        error = AlreadyExistsError("Duplicate resource")
        assert error.category == ErrorCategory.ALREADY_EXISTS


# ============================================================================
# Bot/Operation Error Tests
# ============================================================================


class TestBotOperationErrors:
    """Tests for bot detection and operation errors."""

    def test_bot_detected_error(self):
        """Test BotDetectedError."""
        error = BotDetectedError("Bot comment detected")
        assert error.category == ErrorCategory.BOT_DETECTED
        assert error.severity == ErrorSeverity.INFO
        assert error.action_hint == "Skipped to prevent infinite bot loops"

    def test_cancelled_error(self):
        """Test CancelledError."""
        error = CancelledError("User cancelled")
        assert error.category == ErrorCategory.CANCELLED
        assert error.severity == ErrorSeverity.INFO

    def test_configuration_error(self):
        """Test ConfigurationError."""
        error = ConfigurationError("Invalid config")
        assert error.category == ErrorCategory.CONFIGURATION
        assert error.action_hint == "Check your configuration settings"


# ============================================================================
# capture_error Tests
# ============================================================================


class TestCaptureError:
    """Tests for capture_error utility function."""

    def test_capture_github_automation_error(self):
        """Test capturing GitHubAutomationError."""
        error = AuthenticationError("Auth failed", correlation_id="test-123")
        structured = capture_error(error, source="test.module")
        assert structured.message == "Auth failed"
        assert structured.category == ErrorCategory.AUTHENTICATION
        assert structured.source == "test.module"
        assert structured.correlation_id == "test-123"

    def test_capture_with_pr_context(self):
        """Test capturing with PR context."""
        error = NotFoundError("PR not found")
        structured = capture_error(
            error,
            pr_number=42,
            repo="owner/repo"
        )
        assert structured.pr_number == 42
        assert structured.repo == "owner/repo"

    def test_capture_with_issue_context(self):
        """Test capturing with issue context."""
        error = ValidationError("Invalid issue")
        structured = capture_error(
            error,
            issue_number=100,
            repo="owner/repo"
        )
        assert structured.issue_number == 100
        assert structured.repo == "owner/repo"

    def test_capture_timeout_error(self):
        """Test capturing built-in TimeoutError."""
        exc = TimeoutError("Operation timed out")
        structured = capture_error(exc)
        assert structured.category == ErrorCategory.TIMEOUT
        assert structured.retryable is True

    def test_capture_connection_error(self):
        """Test capturing ConnectionError."""
        exc = ConnectionError("Connection failed")
        structured = capture_error(exc)
        assert structured.category == ErrorCategory.NETWORK
        assert structured.retryable is True

    def test_capture_permission_error(self):
        """Test capturing PermissionError."""
        exc = PermissionError("Access denied")
        structured = capture_error(exc)
        assert structured.category == ErrorCategory.PERMISSION

    def test_capture_file_not_found_error(self):
        """Test capturing FileNotFoundError."""
        exc = FileNotFoundError("File missing")
        structured = capture_error(exc)
        assert structured.category == ErrorCategory.NOT_FOUND

    def test_capture_value_error(self):
        """Test capturing ValueError."""
        exc = ValueError("Invalid value")
        structured = capture_error(exc)
        assert structured.category == ErrorCategory.VALIDATION

    def test_capture_generic_exception(self):
        """Test capturing generic exception."""
        exc = RuntimeError("Unknown error")
        structured = capture_error(exc)
        assert structured.category == ErrorCategory.INTERNAL
        assert structured.retryable is False


# ============================================================================
# format_error_for_ui Tests
# ============================================================================


class TestFormatErrorForUI:
    """Tests for format_error_for_ui function."""

    def test_format_basic_error(self):
        """Test formatting basic error."""
        error = StructuredError(
            message="Test error",
            category=ErrorCategory.INTERNAL,
            severity=ErrorSeverity.ERROR
        )
        result = format_error_for_ui(error)
        assert result["title"] == "Internal Error"
        assert result["message"] == "Test error"
        assert result["severity"] == "error"
        assert result["retryable"] is False
        assert "action" in result
        assert "details" in result
        assert "expandable" in result

    def test_format_authentication_error(self):
        """Test formatting authentication error."""
        error = StructuredError(
            message="Auth failed",
            category=ErrorCategory.AUTHENTICATION,
            action_hint="Check token"
        )
        result = format_error_for_ui(error)
        assert result["title"] == "Authentication Failed"
        assert result["action"] == "Check token"

    def test_format_rate_limit_error(self):
        """Test formatting rate limit error."""
        error = StructuredError(
            message="Too many requests",
            category=ErrorCategory.RATE_LIMITED,
            retryable=True,
            retry_after_seconds=60
        )
        result = format_error_for_ui(error)
        assert result["title"] == "Rate Limited"
        assert result["retryable"] is True
        assert result["retry_after"] == 60

    def test_format_with_code_and_correlation(self):
        """Test formatting with code and correlation ID."""
        error = StructuredError(
            message="API error",
            category=ErrorCategory.API_ERROR,
            code="API_001",
            correlation_id="corr-123",
            details={"status": 500}
        )
        result = format_error_for_ui(error)
        assert result["details"]["code"] == "API_001"
        assert result["details"]["correlation_id"] == "corr-123"
        assert result["details"]["status"] == 500

    def test_format_with_stack_trace(self):
        """Test formatting with stack trace."""
        error = StructuredError(
            message="Error",
            category=ErrorCategory.INTERNAL,
            stack_trace="Line 1\nLine 2",
            help_url="https://help.example.com"
        )
        result = format_error_for_ui(error)
        assert result["expandable"]["stack_trace"] == "Line 1\nLine 2"
        assert result["expandable"]["help_url"] == "https://help.example.com"

    def test_all_error_titles(self):
        """Test that all error categories have titles."""
        titles = {
            ErrorCategory.AUTHENTICATION: "Authentication Failed",
            ErrorCategory.PERMISSION: "Permission Denied",
            ErrorCategory.TOKEN_EXPIRED: "Token Expired",
            ErrorCategory.INSUFFICIENT_SCOPE: "Insufficient Permissions",
            ErrorCategory.RATE_LIMITED: "Rate Limited",
            ErrorCategory.COST_EXCEEDED: "Cost Limit Exceeded",
            ErrorCategory.NETWORK: "Network Error",
            ErrorCategory.TIMEOUT: "Operation Timed Out",
            ErrorCategory.API_ERROR: "GitHub API Error",
            ErrorCategory.SERVICE_UNAVAILABLE: "Service Unavailable",
            ErrorCategory.VALIDATION: "Validation Error",
            ErrorCategory.INVALID_INPUT: "Invalid Input",
            ErrorCategory.NOT_FOUND: "Not Found",
            ErrorCategory.INVALID_STATE: "Invalid State",
            ErrorCategory.CONFLICT: "Conflict Detected",
            ErrorCategory.ALREADY_EXISTS: "Already Exists",
            ErrorCategory.INTERNAL: "Internal Error",
            ErrorCategory.CONFIGURATION: "Configuration Error",
            ErrorCategory.BOT_DETECTED: "Bot Activity Detected",
            ErrorCategory.CANCELLED: "Operation Cancelled",
        }
        for category, expected_title in titles.items():
            error = StructuredError(
                message="Test",
                category=category
            )
            result = format_error_for_ui(error)
            assert result["title"] == expected_title


# ============================================================================
# Result Type Tests
# ============================================================================


class TestResult:
    """Tests for Result type."""

    def test_success_result(self):
        """Test creating success result."""
        result = Result.success(data={"findings": []})
        assert result.ok is True
        assert result.data == {"findings": []}
        assert result.error is None

    def test_success_without_data(self):
        """Test creating success result without data."""
        result = Result.success()
        assert result.ok is True
        assert result.data is None

    def test_failure_result(self):
        """Test creating failure result."""
        error = StructuredError(
            message="Failed",
            category=ErrorCategory.INTERNAL
        )
        result = Result.failure(error)
        assert result.ok is False
        assert result.error == error
        assert result.data is None

    def test_from_exception(self):
        """Test creating result from exception."""
        exc = ValueError("Invalid")
        result = Result.from_exception(exc)
        assert result.ok is False
        assert result.error is not None
        assert result.error.message == "Invalid"

    def test_to_dict_success(self):
        """Test converting success result to dict."""
        result = Result.success(data={"key": "value"})
        result_dict = result.to_dict()
        assert result_dict["ok"] is True
        assert result_dict["data"] == {"key": "value"}
        assert result_dict["error"] is None

    def test_to_dict_failure(self):
        """Test converting failure result to dict."""
        error = StructuredError(
            message="Error",
            category=ErrorCategory.INTERNAL
        )
        result = Result.failure(error)
        result_dict = result.to_dict()
        assert result_dict["ok"] is False
        assert result_dict["error"]["message"] == "Error"
        assert result_dict["data"] is None

    def test_result_pattern_usage(self):
        """Test typical Result pattern usage."""
        # Success case
        result = Result.success(data={"user": "alice"})
        if result.ok:
            assert result.data["user"] == "alice"
        else:
            assert False, "Should be ok"

        # Failure case
        error = StructuredError(
            message="Not found",
            category=ErrorCategory.NOT_FOUND
        )
        result = Result.failure(error)
        if not result.ok:
            assert result.error.message == "Not found"
        else:
            assert False, "Should not be ok"

"""
Auto-Claude Exception Hierarchy
===============================

Domain-specific exceptions for better error handling and debugging.
All exceptions inherit from AutoClaudeError for easy catching.

Usage:
    from core.exceptions import (
        AutoClaudeError,
        AgentError,
        PlanningError,
        CodingError,
        APIError,
        RateLimitError,
        AuthenticationError,
        ConfigurationError,
        SpecError,
        WorktreeError,
    )

    try:
        await run_agent()
    except RateLimitError as e:
        print(f"Rate limited, retry after {e.retry_after}s")
    except AgentError as e:
        print(f"Agent error: {e}")
    except AutoClaudeError as e:
        print(f"Auto-Claude error: {e}")
"""

from typing import Any


class AutoClaudeError(Exception):
    """
    Base exception for all Auto-Claude errors.

    All domain-specific exceptions inherit from this class,
    allowing callers to catch all Auto-Claude errors with a single except clause.

    Attributes:
        message: Human-readable error message
        details: Optional dictionary with additional context
    """

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        self.message = message
        self.details = details or {}
        super().__init__(message)

    def __str__(self) -> str:
        if self.details:
            detail_str = ", ".join(f"{k}={v}" for k, v in self.details.items())
            return f"{self.message} ({detail_str})"
        return self.message


# =============================================================================
# Agent Errors
# =============================================================================


class AgentError(AutoClaudeError):
    """
    Base exception for agent-related errors.

    Raised when an agent fails to complete its task.
    """

    pass


class PlanningError(AgentError):
    """
    Error during planning phase.

    Raised when the planner agent fails to create or update a plan.
    """

    def __init__(
        self,
        message: str,
        spec_dir: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if spec_dir:
            details["spec_dir"] = spec_dir
        super().__init__(message, details)


class CodingError(AgentError):
    """
    Error during coding phase.

    Raised when the coder agent fails to implement a subtask.
    """

    def __init__(
        self,
        message: str,
        subtask_id: str | None = None,
        session_num: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if subtask_id:
            details["subtask_id"] = subtask_id
        if session_num is not None:
            details["session_num"] = session_num
        super().__init__(message, details)


class QAError(AgentError):
    """
    Error during QA review or fixing phase.

    Raised when QA validation or fix agent encounters an error.
    """

    def __init__(
        self,
        message: str,
        qa_phase: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if qa_phase:
            details["qa_phase"] = qa_phase
        super().__init__(message, details)


class RecoveryError(AgentError):
    """
    Error during agent recovery.

    Raised when recovery from a stuck state fails.
    """

    def __init__(
        self,
        message: str,
        recovery_attempt: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if recovery_attempt is not None:
            details["recovery_attempt"] = recovery_attempt
        super().__init__(message, details)


# =============================================================================
# API Errors
# =============================================================================


class APIError(AutoClaudeError):
    """
    Base exception for external API errors.

    Raised when an API call fails (Claude API, Linear, GitHub, etc.)
    """

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        api_name: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if status_code is not None:
            details["status_code"] = status_code
        if api_name:
            details["api_name"] = api_name
        super().__init__(message, details)


class RateLimitError(APIError):
    """
    API rate limit exceeded.

    Attributes:
        retry_after: Seconds to wait before retrying (if provided by API)
    """

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        retry_after: float | None = None,
        api_name: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.retry_after = retry_after
        details = details or {}
        if retry_after is not None:
            details["retry_after"] = retry_after
            message = f"{message}, retry after {retry_after}s"
        super().__init__(message, status_code=429, api_name=api_name, details=details)


class AuthenticationError(APIError):
    """
    API authentication failed.

    Raised when API credentials are invalid or expired.
    """

    def __init__(
        self,
        message: str = "Authentication failed",
        api_name: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message, status_code=401, api_name=api_name, details=details)


class TokenError(AuthenticationError):
    """
    Token-specific authentication error.

    Raised when OAuth/API token is invalid, expired, or missing.
    """

    def __init__(
        self,
        message: str = "Token invalid or expired",
        token_type: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if token_type:
            details["token_type"] = token_type
        super().__init__(message, details=details)


# =============================================================================
# Configuration Errors
# =============================================================================


class ConfigurationError(AutoClaudeError):
    """
    Invalid configuration.

    Raised when project or agent configuration is invalid or missing.
    """

    def __init__(
        self,
        message: str,
        config_key: str | None = None,
        expected_type: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if config_key:
            details["config_key"] = config_key
        if expected_type:
            details["expected_type"] = expected_type
        super().__init__(message, details)


class EnvironmentError(ConfigurationError):
    """
    Missing or invalid environment variable.

    Raised when a required environment variable is missing or invalid.
    """

    def __init__(
        self,
        message: str,
        env_var: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if env_var:
            details["env_var"] = env_var
        super().__init__(message, details=details)


# =============================================================================
# Spec and Plan Errors
# =============================================================================


class SpecError(AutoClaudeError):
    """
    Error related to spec files or structure.

    Raised when spec.md or implementation_plan.json has issues.
    """

    def __init__(
        self,
        message: str,
        spec_dir: str | None = None,
        file_name: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if spec_dir:
            details["spec_dir"] = spec_dir
        if file_name:
            details["file_name"] = file_name
        super().__init__(message, details)


class PlanValidationError(SpecError):
    """
    Implementation plan validation failed.

    Raised when implementation_plan.json fails schema validation.
    """

    def __init__(
        self,
        message: str,
        validation_errors: list[str] | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if validation_errors:
            details["validation_errors"] = validation_errors
        super().__init__(message, details=details)


# =============================================================================
# Worktree and Git Errors
# =============================================================================


class WorktreeError(AutoClaudeError):
    """
    Error related to git worktree operations.

    Raised when worktree creation, switch, or cleanup fails.
    """

    def __init__(
        self,
        message: str,
        worktree_path: str | None = None,
        branch: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if worktree_path:
            details["worktree_path"] = worktree_path
        if branch:
            details["branch"] = branch
        super().__init__(message, details)


class GitError(AutoClaudeError):
    """
    Git command or operation failed.

    Raised when a git command returns an error.
    """

    def __init__(
        self,
        message: str,
        git_command: str | None = None,
        exit_code: int | None = None,
        stderr: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if git_command:
            details["git_command"] = git_command
        if exit_code is not None:
            details["exit_code"] = exit_code
        if stderr:
            details["stderr"] = stderr[:200]  # Truncate long error messages
        super().__init__(message, details)


# =============================================================================
# Security Errors
# =============================================================================


class SecurityError(AutoClaudeError):
    """
    Security violation detected.

    Raised when a security constraint is violated
    (e.g., command injection attempt, path traversal).
    """

    def __init__(
        self,
        message: str,
        violation_type: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if violation_type:
            details["violation_type"] = violation_type
        super().__init__(message, details)


class CommandBlockedError(SecurityError):
    """
    Bash command blocked by security policy.

    Raised when a command is not in the allowlist.
    """

    def __init__(
        self,
        message: str,
        command: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if command:
            # Sanitize command in case it contains sensitive info
            details["command"] = command[:100]
        super().__init__(message, violation_type="command_blocked", details=details)


# =============================================================================
# Memory and Integration Errors
# =============================================================================


class MemoryError(AutoClaudeError):
    """
    Error related to memory system (Graphiti, local files).

    Raised when memory operations fail.
    """

    def __init__(
        self,
        message: str,
        memory_type: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if memory_type:
            details["memory_type"] = memory_type
        super().__init__(message, details)


class IntegrationError(AutoClaudeError):
    """
    Error from external integration (Linear, GitHub, GitLab).

    Base class for integration-specific errors.
    """

    def __init__(
        self,
        message: str,
        integration: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        details = details or {}
        if integration:
            details["integration"] = integration
        super().__init__(message, details)

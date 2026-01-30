"""
Linear Validation Agent Module
===============================

AI-powered ticket validation agent that analyzes Linear tickets and recommends
labels, version tags, and task properties using Claude Opus model.

This agent implements a 5-step validation workflow:
1. Analyze ticket content (title, description, requirements)
2. Validate completeness and technical feasibility
3. Auto-select appropriate labels/tags
4. Determine version label based on semantic versioning
5. Recommend task properties (category, complexity, impact, priority)
"""

import asyncio
import json
import logging
import os
import random
import re
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypeVar

import diskcache
import requests
from core.client import create_client
from integrations.linear.linear_utils import get_linear_authorization_header
from phase_config import get_phase_model, get_phase_thinking_budget
from task_logger import LogPhase

from .session import run_agent_session

# Import metadata module for workspace context
from integrations.linear import linear_metadata

if TYPE_CHECKING:
    from core.client import ClaudeSDKClient

logger = logging.getLogger(__name__)

# Debug flag for Linear validation (controlled by DEBUG_LINEAR_VALIDATION env var)
DEBUG_LINEAR_VALIDATION = (
    os.getenv("DEBUG_LINEAR_VALIDATION", "false").lower() == "true"
)

T = TypeVar("T")


class RetryConfig:
    """Configuration for retry behavior with exponential backoff."""

    def __init__(
        self,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0,
        exponential_base: float = 2.0,
        jitter: bool = True,
    ):
        """
        Initialize retry configuration.

        Args:
            max_retries: Maximum number of retry attempts
            base_delay: Initial delay in seconds
            max_delay: Maximum delay between retries
            exponential_base: Base for exponential backoff calculation
            jitter: Whether to add random jitter to delays
        """
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter


# Transient error patterns that warrant retries
TRANSIENT_ERROR_PATTERNS = [
    "timeout",
    "connection",
    "network",
    "temporarily",
    "unavailable",
    "rate limit",
    "429",  # HTTP 429 Too Many Requests
    "503",  # HTTP 503 Service Unavailable
    "502",  # HTTP 502 Bad Gateway
    "500",  # HTTP 500 Internal Server Error
]


def is_transient_error(error: Exception) -> bool:
    """
    Determine if an error is transient and worth retrying.

    Args:
        error: The exception to check

    Returns:
        True if the error appears to be transient
    """
    error_message = str(error).lower()
    return any(pattern in error_message for pattern in TRANSIENT_ERROR_PATTERNS)


async def retry_with_exponential_backoff(
    func: Callable[..., Awaitable[T]],
    config: RetryConfig | None = None,
    context: str = "operation",
) -> T:
    """
    Retry an async function with exponential backoff.

    Args:
        func: Async function to retry
        config: Retry configuration (uses defaults if None)
        context: Description of the operation for logging

    Returns:
        Result of the function call

    Raises:
        Exception: The last exception if all retries are exhausted
    """
    if config is None:
        config = RetryConfig()

    last_error: Exception | None = None

    for attempt in range(config.max_retries + 1):
        try:
            return await func()
        except Exception as e:
            last_error = e

            # Don't retry if this is the last attempt or error is not transient
            if attempt >= config.max_retries or not is_transient_error(e):
                logger.error(
                    f"[{context}] Failed on attempt {attempt + 1}/{config.max_retries + 1}: {e}"
                )
                raise

            # Calculate delay with exponential backoff
            delay = config.base_delay * (config.exponential_base**attempt)

            # Add jitter to avoid thundering herd
            if config.jitter:
                delay = delay * (0.5 + random.random())

            # Cap at max_delay (applies after jitter)
            delay = min(delay, config.max_delay)

            logger.warning(
                f"[{context}] Transient error on attempt {attempt + 1}/{config.max_retries + 1}: {e}. "
                f"Retrying in {delay:.1f}s..."
            )

            await asyncio.sleep(delay)

    # Should never reach here, but type checkers need it
    assert last_error is not None
    raise last_error


class ValidationError(Exception):
    """Base exception for Linear validation errors."""

    def __init__(
        self,
        message: str,
        issue_id: str | None = None,
        details: dict[str, Any] | None = None,
    ):
        """
        Initialize a validation error.

        Args:
            message: Human-readable error message
            issue_id: Associated Linear issue ID (if applicable)
            details: Additional error details
        """
        self.issue_id = issue_id
        self.details = details or {}
        super().__init__(message)

    def __str__(self) -> str:
        base_msg = super().__str__()
        if self.issue_id:
            return f"[{self.issue_id}] {base_msg}"
        return base_msg


class ValidationTimeoutError(ValidationError):
    """Validation timed out."""

    def __init__(self, issue_id: str, timeout_seconds: float):
        super().__init__(
            f"Validation timed out after {timeout_seconds:.0f} seconds. "
            f"The AI agent took too long to respond. This can happen with "
            f"complex tickets or slow network connections.",
            issue_id=issue_id,
            details={"timeout_seconds": timeout_seconds},
        )


class AuthenticationError(ValidationError):
    """Linear API authentication failed."""

    def __init__(self, details: str = ""):
        super().__init__(
            f"Failed to authenticate with Linear API. Please check your LINEAR_API_KEY "
            f"in the project's .env file. {details}",
            details={"error_type": "authentication"},
        )


class RateLimitError(ValidationError):
    """Linear API rate limit exceeded."""

    def __init__(self, retry_after: float | None = None):
        message = "Linear API rate limit exceeded. Please try again later."
        if retry_after:
            message += f" Retry after {retry_after:.0f} seconds."
        super().__init__(
            message, details={"error_type": "rate_limit", "retry_after": retry_after}
        )


class NetworkError(ValidationError):
    """Network connectivity issue."""

    def __init__(self, issue_id: str, details: str = ""):
        super().__init__(
            f"Network error while validating ticket. Please check your internet "
            f"connection and try again. {details}",
            issue_id=issue_id,
            details={"error_type": "network"},
        )


class TicketNotFoundError(ValidationError):
    """Linear ticket not found."""

    def __init__(self, issue_id: str):
        super().__init__(
            f"Ticket '{issue_id}' not found in Linear. Please verify the ticket ID "
            f"and ensure you have access to this ticket.",
            issue_id=issue_id,
            details={"error_type": "not_found"},
        )


class InvalidResponseError(ValidationError):
    """AI agent returned invalid/unparseable response."""

    def __init__(self, issue_id: str, reason: str = ""):
        super().__init__(
            f"Failed to parse AI agent response. The response format was invalid or "
            f"incomplete. Please try again. {reason}",
            issue_id=issue_id,
            details={"error_type": "invalid_response", "reason": reason},
        )


def format_validation_error(error: Exception, issue_id: str | None = None) -> str:
    """
    Format a validation error for display to users.

    Args:
        error: The exception to format
        issue_id: Associated ticket ID (if applicable)

    Returns:
        User-friendly error message
    """
    if isinstance(error, ValidationError):
        return str(error)

    # Map common error types to helpful messages
    error_message = str(error).lower()

    if "timeout" in error_message:
        return "The validation request timed out. The ticket may be too complex or the network is slow. Please try again."

    if "401" in error_message or "unauthorized" in error_message:
        return (
            "Authentication failed. Please check your LINEAR_API_KEY in the .env file."
        )

    if "403" in error_message or "forbidden" in error_message:
        return "Access denied. Please verify your Linear API key has the necessary permissions."

    if "404" in error_message or "not found" in error_message:
        if issue_id:
            return f"Ticket '{issue_id}' not found. Please verify the ticket ID."
        return "Ticket not found. Please verify the ticket ID."

    if "429" in error_message or "rate limit" in error_message:
        return "Rate limit exceeded. Please wait a moment and try again."

    if "connection" in error_message or "network" in error_message:
        return "Network connection failed. Please check your internet connection and try again."

    if "500" in error_message or "502" in error_message or "503" in error_message:
        return "Linear service is temporarily unavailable. Please try again later."

    if "json" in error_message or "parse" in error_message:
        return "Failed to process the AI response. The ticket data may be malformed. Please try again."

    # Generic fallback - log actual error for debugging, return safe message to user
    logger.error(f"Unexpected validation error: {error}", exc_info=True)
    return "Validation failed due to an unexpected error. Please try again."


class LinearValidationAgent:
    """
    AI-powered Linear ticket validation agent.

    Uses Claude Opus model to analyze tickets, validate completeness,
    auto-select labels, determine version, and recommend properties.
    """

    CACHE_TTL_SECONDS = 3600  # 1 hour TTL
    DEFAULT_SESSION_TIMEOUT = 300  # 5 minutes default timeout for validation

    def __init__(
        self,
        spec_dir: Path,
        project_dir: Path,
        model: str | None = None,
        session_timeout: float | None = None,
        progress_callback: Callable[[str, int, int, str], None] | None = None,
    ):
        """
        Initialize the Linear validation agent.

        Args:
            spec_dir: Directory containing the spec (for context)
            project_dir: Root directory for the project
            model: Claude model override (optional, will use phase_config if None)
            session_timeout: Timeout in seconds for validation sessions (default: 300s)
            progress_callback: Optional callback for progress updates (phase, step, total, message)
        """
        self.spec_dir = Path(spec_dir)
        self.project_dir = Path(project_dir)
        self._model_override = model
        self.session_timeout = (
            session_timeout
            if session_timeout is not None
            else self.DEFAULT_SESSION_TIMEOUT
        )
        self._progress_callback = progress_callback

        # Initialize diskcache for validation results
        cache_dir = self.spec_dir / ".cache" / "linear_validator"
        cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache = diskcache.Cache(str(cache_dir))

        # Workspace metadata (fetched on demand)
        self._workspace_metadata: dict[str, Any] | None = None

    def _emit_progress(self, phase: str, step: int, total: int, message: str) -> None:
        """Emit a progress update if a callback is registered.

        Args:
            phase: Current validation phase (e.g., "content_analysis", "completeness")
            step: Current step number (1-indexed)
            total: Total number of steps
            message: Human-readable progress message
        """
        if self._progress_callback:
            self._progress_callback(phase, step, total, message)

    def create_client(self) -> "ClaudeSDKClient":
        """
        Create a Claude SDK client configured for Linear validation.

        Uses agent_type="linear_validator" to enable:
        - Linear MCP tools for ticket operations
        - Graphiti memory for context
        - Context7 for documentation lookup
        - Auto-claude tools for progress tracking

        Model and thinking budget are resolved from phase_config:
        - Uses get_phase_model() to get the model from user settings
        - Uses get_phase_thinking_budget() to get the thinking budget
        - Falls back to Opus with 10000 tokens if phase_config unavailable

        Returns:
            Configured ClaudeSDKClient instance (fresh each time, no caching)
        """
        print("[LINEAR_VALIDATOR] create_client START", flush=True)
        print(f"[LINEAR_VALIDATOR] project_dir: {self.project_dir}", flush=True)
        print(f"[LINEAR_VALIDATOR] spec_dir: {self.spec_dir}", flush=True)

        # Resolve model from phase_config or use override
        if self._model_override:
            model = self._model_override
            print(f"[LINEAR_VALIDATOR] Using model override: {model}", flush=True)
        else:
            # Use phase_config to resolve model for 'coding' phase (Linear validation is similar)
            try:
                model = get_phase_model(self.spec_dir, "coding", cli_model=None)
                print(
                    f"[LINEAR_VALIDATOR] Resolved model from phase_config: {model}",
                    flush=True,
                )
            except Exception as e:
                # Fallback to Opus if phase_config fails
                model = "claude-opus-4-5-20251101"
                print(
                    f"[LINEAR_VALIDATOR] phase_config failed, using fallback: {model}",
                    flush=True,
                )
                print(
                    f"[LINEAR_VALIDATOR] Exception was: {type(e).__name__}: {e}",
                    flush=True,
                )

        # Resolve thinking budget from phase_config
        try:
            max_thinking_tokens = get_phase_thinking_budget(
                self.spec_dir, "coding", cli_thinking=None
            )
            print(
                f"[LINEAR_VALIDATOR] Thinking budget: {max_thinking_tokens}", flush=True
            )
        except Exception as e:
            # Fallback to 10000 tokens if phase_config fails
            max_thinking_tokens = 10000
            print(
                f"[LINEAR_VALIDATOR] Using fallback thinking budget: {max_thinking_tokens}",
                flush=True,
            )
            print(
                f"[LINEAR_VALIDATOR] Exception was: {type(e).__name__}: {e}", flush=True
            )

        # Create a fresh client each time (no caching to avoid concurrency issues)
        print(
            f"[LINEAR_VALIDATOR] Calling create_client with model={model}, agent_type=linear_validator...",
            flush=True,
        )
        try:
            client = create_client(
                self.project_dir,
                self.spec_dir,
                model,
                agent_type="linear_validator",
                max_thinking_tokens=max_thinking_tokens,
            )
            print("[LINEAR_VALIDATOR] create_client succeeded", flush=True)
            return client
        except Exception as e:
            print(
                f"[LINEAR_VALIDATOR] ERROR in create_client: {type(e).__name__}: {e}",
                flush=True,
            )
            import traceback

            traceback.print_exc()
            raise

    def _get_cache_key(self, issue_id: str, validation_timestamp: str) -> str:
        """
        Generate cache key from issue ID and validation timestamp.

        Args:
            issue_id: Linear issue identifier (e.g., "LIN-123")
            validation_timestamp: Timestamp of issue update/validation

        Returns:
            Cache key string

        Raises:
            ValueError: If issue_id is empty or validation_timestamp is invalid
        """
        # Validate issue_id
        if not issue_id or not isinstance(issue_id, str):
            raise ValueError(
                f"Invalid issue_id: {issue_id!r}. Must be a non-empty string."
            )

        # Validate validation_timestamp
        if not validation_timestamp or not isinstance(validation_timestamp, str):
            # Use a default timestamp if not provided (allows caching tickets without timestamps)
            validation_timestamp = "unknown"

        # Sanitize inputs to prevent cache key collisions
        # Replace colons in issue_id with underscores (colons are our delimiter)
        safe_issue_id = issue_id.replace(":", "_")
        # Remove any control characters
        safe_timestamp = (
            validation_timestamp.replace(":", "_").replace("\n", "_").replace("\r", "_")
        )

        return f"{safe_issue_id}:{safe_timestamp}"

    def _get_cached_result(
        self, issue_id: str, validation_timestamp: str, skip_cache: bool = False
    ) -> dict[str, Any] | None:
        """
        Retrieve cached validation result if valid.

        Args:
            issue_id: Linear issue identifier
            validation_timestamp: Timestamp for cache key
            skip_cache: If True, always return None (force re-validation)

        Returns:
            Cached validation result or None if cache invalid/expired
        """
        if skip_cache:
            return None

        cache_key = self._get_cache_key(issue_id, validation_timestamp)

        try:
            result = self.cache.get(cache_key, default=None)
            if result is not None:
                logger.info(f"✓ Using cached validation for {issue_id}")
                return result
        except Exception as e:
            logger.warning(f"Failed to retrieve cache for {issue_id}: {e}")

        return None

    def _save_result(
        self, issue_id: str, validation_timestamp: str, result: dict[str, Any]
    ) -> None:
        """
        Save validation result to cache with TTL.

        Args:
            issue_id: Linear issue identifier
            validation_timestamp: Timestamp for cache key
            result: Validation result to cache
        """
        cache_key = self._get_cache_key(issue_id, validation_timestamp)

        try:
            self.cache.set(cache_key, result, expire=self.CACHE_TTL_SECONDS)
            logger.info(
                f"✓ Cached validation result for {issue_id} (TTL: {self.CACHE_TTL_SECONDS}s)"
            )
        except Exception as e:
            logger.warning(f"Failed to cache result for {issue_id}: {e}")

    def _get_workspace_metadata(self) -> dict[str, Any]:
        """
        Fetch workspace metadata from Linear (labels, users, teams, projects).

        Uses in-memory cache to avoid repeated API calls during the agent's lifetime.
        The underlying metadata module has its own 1-hour TTL cache.

        Returns:
            Dict with workspace metadata including labels, users, teams, projects.

        Raises:
            AuthenticationError: If LINEAR_API_KEY is not set
            NetworkError: If Linear API call fails
        """
        if self._workspace_metadata is not None:
            return self._workspace_metadata

        api_key = os.environ.get("LINEAR_API_KEY")
        if not api_key:
            raise AuthenticationError(
                "LINEAR_API_KEY not found in environment. "
                "Please set it in your .env file."
            )

        try:
            logger.info("[LINEAR_VALIDATOR] Fetching workspace metadata...")
            self._workspace_metadata = linear_metadata.fetch_linear_workspace_metadata(
                api_key
            )
            logger.info(
                f"[LINEAR_VALIDATOR] Fetched {len(self._workspace_metadata.get('labels', []))} labels, "
                f"{len(self._workspace_metadata.get('users', []))} users, "
                f"{len(self._workspace_metadata.get('teams', []))} teams, "
                f"{len(self._workspace_metadata.get('projects', []))} projects"
            )
            return self._workspace_metadata
        except requests.exceptions.RequestException as e:
            logger.error(f"[LINEAR_VALIDATOR] Failed to fetch workspace metadata: {e}")
            # Continue without metadata - validation will still work but without context
            return {}

    def _fetch_linear_issue(self, issue_id: str) -> dict[str, Any]:
        """
        Fetch Linear issue data using GraphQL API.

        Args:
            issue_id: Linear issue identifier (e.g., "LIN-123" or just "123")

        Returns:
            Dict with issue data including title, description, labels, etc.

        Raises:
            TicketNotFoundError: If issue not found
            AuthenticationError: If API key is invalid
            NetworkError: If network request fails
        """
        api_key = os.environ.get("LINEAR_API_KEY")
        if not api_key:
            raise AuthenticationError(
                "LINEAR_API_KEY not found in environment. "
                "Please set it in your .env file."
            )

        # Extract numeric ID from issue identifier (e.g., "LIN-123" -> "123")
        # Use the identifier as-is for GraphQL (Linear accepts LIN-123 or just 123)
        numeric_id = issue_id.replace("LIN-", "")

        print(f"[LINEAR_VALIDATOR] _fetch_linear_issue START: {issue_id}", flush=True)

        # GraphQL query to fetch issue data
        query = """
        query IssueQuery($issueId: String!) {
            issue(id: $issueId) {
                id
                identifier
                title
                description
                state {
                    id
                    name
                    type
                }
                priority
                labels {
                    nodes {
                        id
                        name
                        color
                    }
                }
                assignee {
                    id
                    name
                }
                project {
                    id
                    name
                }
                createdAt
                updatedAt
                dueDate
            }
        }
        """

        # Get correct Authorization header for Linear API
        # Linear personal API keys (starting with 'lin_api_') should NOT use Bearer prefix
        # OAuth tokens should use 'Bearer' prefix
        print("[LINEAR_VALIDATOR] Getting Linear auth header...", flush=True)
        try:
            authorization = get_linear_authorization_header(api_key)
            print(
                f"[LINEAR_VALIDATOR] Auth header obtained (length: {len(authorization)})",
                flush=True,
            )
        except ValueError as e:
            print(f"[LINEAR_VALIDATOR] ERROR getting auth header: {e}", flush=True)
            raise

        headers = {
            "Authorization": authorization,
            "Content-Type": "application/json",
        }

        try:
            print("[LINEAR_VALIDATOR] Calling Linear API...", flush=True)
            response = requests.post(
                "https://api.linear.app/graphql",
                json={"query": query, "variables": {"issueId": numeric_id}},
                headers=headers,
                timeout=10,
            )
            print(
                f"[LINEAR_VALIDATOR] Linear API response status: {response.status_code}",
                flush=True,
            )
            response.raise_for_status()
            data = response.json()

            if "errors" in data:
                error_msg = data["errors"][0].get("message", "Unknown error")
                print(f"[LINEAR_VALIDATOR] Linear API error: {error_msg}", flush=True)
                if (
                    "not found" in error_msg.lower()
                    or "does not exist" in error_msg.lower()
                ):
                    raise TicketNotFoundError(issue_id)
                raise NetworkError(issue_id, details=f"Linear API error: {error_msg}")

            issue_data = data.get("data", {}).get("issue")
            if not issue_data:
                print("[LINEAR_VALIDATOR] ERROR: No issue data in response", flush=True)
                raise TicketNotFoundError(issue_id)

            print(
                f"[LINEAR_VALIDATOR] Issue data fetched successfully: {issue_data.get('identifier')}",
                flush=True,
            )

            # Transform to the format expected by validate_ticket
            return {
                "id": issue_data.get("id"),
                "identifier": issue_data.get("identifier"),
                "title": issue_data.get("title", ""),
                "description": issue_data.get("description", ""),
                "state": issue_data.get("state", {}),
                "priority": issue_data.get("priority"),
                "labels": issue_data.get("labels", {}).get("nodes", []),
                "assignee": issue_data.get("assignee"),
                "project": issue_data.get("project"),
                "createdAt": issue_data.get("createdAt"),
                "updatedAt": issue_data.get("updatedAt"),
                "dueDate": issue_data.get("dueDate"),
            }

        except requests.exceptions.Timeout:
            raise NetworkError(issue_id, details="Timeout fetching from Linear API")
        except requests.exceptions.RequestException as e:
            raise NetworkError(issue_id, details=f"Network error: {e}")

    async def validate_ticket(
        self,
        issue_id: str,
        issue_data: dict[str, Any] | None = None,
        current_version: str | None = None,
        skip_cache: bool = False,
    ) -> dict[str, Any]:
        """
        Perform 5-step AI validation workflow on a Linear ticket.

        Args:
            issue_id: Linear issue identifier (e.g., "LIN-123")
            issue_data: Raw issue data from Linear (title, description, labels, etc.)
                       If not provided, will be fetched from Linear API automatically.
            current_version: Current project version (e.g., "2.7.4") for version calculation
            skip_cache: If True, force re-validation even if cache exists

        Returns:
            Validation result dict with:
            - issue_id: The ticket identifier
            - analysis: Content analysis (title, description, requirements summary)
            - completeness: Validation of required fields
            - recommended_labels: Suggested labels based on content
            - version_label: Recommended version label (e.g., "2.7.5" or "2.8.0")
            - properties: Task properties (category, complexity, impact, priority)
            - confidence: Overall confidence score (0-1)
            - reasoning: Detailed explanation of recommendations
        """
        print(f"[LINEAR_VALIDATOR] validate_ticket START: {issue_id}", flush=True)
        print(
            f"[LINEAR_VALIDATOR] issue_data provided: {issue_data is not None}",
            flush=True,
        )
        print(f"[LINEAR_VALIDATOR] skip_cache: {skip_cache}", flush=True)

        # Fetch issue data from Linear API if not provided
        if issue_data is None:
            print(
                "[LINEAR_VALIDATOR] Fetching issue data from Linear API...", flush=True
            )
            logger.info(f"Fetching issue data for {issue_id} from Linear API")
            try:
                issue_data = await asyncio.to_thread(self._fetch_linear_issue, issue_id)
                print("[LINEAR_VALIDATOR] Issue data fetched successfully", flush=True)
                print(
                    f"[LINEAR_VALIDATOR] Issue title: {issue_data.get('title', 'N/A')}",
                    flush=True,
                )
            except Exception as e:
                print(
                    f"[LINEAR_VALIDATOR] ERROR fetching issue: {type(e).__name__}: {e}",
                    flush=True,
                )
                raise

        # Extract validation timestamp from issue data
        validation_timestamp = issue_data.get("updatedAt", "")
        print(
            f"[LINEAR_VALIDATOR] Validation timestamp: {validation_timestamp}",
            flush=True,
        )

        # Check cache first
        print("[LINEAR_VALIDATOR] Checking cache...", flush=True)
        cached_result = self._get_cached_result(
            issue_id, validation_timestamp, skip_cache
        )
        if cached_result is not None:
            print("[LINEAR_VALIDATOR] RETURNING cached result", flush=True)
            return cached_result
        print(
            "[LINEAR_VALIDATOR] No cached result, proceeding with validation",
            flush=True,
        )

        # Debug logging for validation start
        if DEBUG_LINEAR_VALIDATION:
            logger.debug(f"[LINEAR_VALIDATION] Starting validation for {issue_id}")

        # Emit initial progress: starting validation
        self._emit_progress(
            "initialization", 0, 8, f"Starting validation for {issue_id}"
        )

        # Perform validation if not cached
        print("[LINEAR_VALIDATOR] Creating SDK client...", flush=True)
        try:
            client = self.create_client()
            print("[LINEAR_VALIDATOR] SDK client created successfully", flush=True)
        except Exception as e:
            print(
                f"[LINEAR_VALIDATOR] ERROR creating client: {type(e).__name__}: {e}",
                flush=True,
            )
            import traceback

            traceback.print_exc()
            raise

        # Fetch workspace metadata for context-aware recommendations
        print("[LINEAR_VALIDATOR] Fetching workspace metadata...", flush=True)
        try:
            workspace_metadata = self._get_workspace_metadata()
        except AuthenticationError:
            logger.warning("[LINEAR_VALIDATOR] Could not fetch workspace metadata, continuing without it")
            workspace_metadata = {}

        # Build validation prompt with 5-step workflow
        print("[LINEAR_VALIDATOR] Building validation prompt...", flush=True)
        prompt = self._build_validation_prompt(
            issue_id, issue_data, current_version, workspace_metadata
        )
        print(f"[LINEAR_VALIDATOR] Prompt built: {len(prompt)} characters", flush=True)

        # Debug: Log prompt (truncated)
        if DEBUG_LINEAR_VALIDATION:
            prompt_preview = prompt[:500] + "..." if len(prompt) > 500 else prompt
            logger.debug(
                f"[LINEAR_VALIDATION] Prompt ({len(prompt)} chars): {prompt_preview}"
            )

        # Run validation session with streaming and retry logic
        print("[LINEAR_VALIDATOR] Starting validation session...", flush=True)
        async with client:

            async def run_validation_session():
                """Run the validation session with retry and timeout support."""
                # Emit progress: Phase 1 starting
                self._emit_progress(
                    "content_analysis", 1, 7, "Analyzing ticket content..."
                )

                # Debug: Phase 1 start
                phase_start_time = time.time() if DEBUG_LINEAR_VALIDATION else 0
                if DEBUG_LINEAR_VALIDATION:
                    logger.debug(
                        "[LINEAR_VALIDATION] Phase 1: Content Analysis - starting"
                    )
                phase_start_time = time.time() if DEBUG_LINEAR_VALIDATION else 0
                if DEBUG_LINEAR_VALIDATION:
                    logger.debug(
                        "[LINEAR_VALIDATION] Phase 1: Content Analysis - starting"
                    )

                # Create a heartbeat task that emits progress during the long AI call
                heartbeat_steps = [
                    (
                        "codebase_search",
                        2,
                        "Searching codebase for related implementation...",
                    ),
                    ("ai_analysis_start", 3, "AI analysis in progress..."),
                    ("completeness_check", 4, "Validating ticket completeness..."),
                    ("labels_selection", 5, "Selecting appropriate labels..."),
                    ("version_calculation", 6, "Calculating version label..."),
                    ("properties_recommendation", 7, "Recommending task properties..."),
                ]
                heartbeat_index = 0

                async def heartbeat_task():
                    """Emit heartbeat progress updates during AI processing."""
                    nonlocal heartbeat_index
                    for phase, step, message in heartbeat_steps:
                        await asyncio.sleep(2)  # Wait 2 seconds between updates
                        self._emit_progress(phase, step, 7, message)
                        heartbeat_index += 1

                # Start heartbeat task
                heartbeat = asyncio.create_task(heartbeat_task())

                # Wrap the session call with timeout
                try:
                    status, response = await asyncio.wait_for(
                        run_agent_session(
                            client,
                            prompt,
                            self.spec_dir,
                            verbose=False,
                            phase=LogPhase.CODING,
                        ),
                        timeout=self.session_timeout,
                    )

                    # Cancel heartbeat as we're done
                    heartbeat.cancel()
                    try:
                        await heartbeat
                    except asyncio.CancelledError:
                        # Expected when cancelling the heartbeat task - ignore
                        pass

                    # Debug: Phase 1 complete, Phases 2-5 are handled by the AI in a single call
                    if DEBUG_LINEAR_VALIDATION:
                        phase_elapsed = time.time() - phase_start_time
                        logger.debug(
                            f"[LINEAR_VALIDATION] Phase 1: Content Analysis - complete ({phase_elapsed:.2f}s)"
                        )

                    # Emit progress: AI analysis complete, parsing results
                    self._emit_progress(
                        "ai_analysis_complete",
                        7,
                        7,
                        "AI analysis complete, parsing results...",
                    )

                    # Debug: Log response (truncated)
                    if DEBUG_LINEAR_VALIDATION:
                        response_preview = (
                            response[:1000] + "..."
                            if len(response) > 1000
                            else response
                        )
                        logger.debug(
                            f"[LINEAR_VALIDATION] Raw AI response ({len(response)} chars): {response_preview}"
                        )

                    return response
                except asyncio.TimeoutError:
                    heartbeat.cancel()
                    logger.error(
                        f"Validation session for {issue_id} timed out after {self.session_timeout}s"
                    )
                    raise ValidationTimeoutError(issue_id, self.session_timeout)
                except Exception:
                    heartbeat.cancel()
                    raise

            # Configure retry with exponential backoff for transient errors
            retry_config = RetryConfig(
                max_retries=3,
                base_delay=1.0,
                max_delay=30.0,
                exponential_base=2.0,
                jitter=True,
            )

            response = await retry_with_exponential_backoff(
                run_validation_session,
                config=retry_config,
                context=f"validate_ticket({issue_id})",
            )

        # Parse and structure the validation results
        parse_start_time = time.time() if DEBUG_LINEAR_VALIDATION else 0
        if DEBUG_LINEAR_VALIDATION:
            logger.debug("[LINEAR_VALIDATION] Parsing validation result")

        result = self._parse_validation_result(
            issue_id, response, issue_data, current_version
        )

        print("[LINEAR_VALIDATOR] Parsing complete", flush=True)
        print(
            f"[LINEAR_VALIDATOR] Result structure: analysis={bool(result.get('analysis'))}, "
            f"codebase_verification={bool(result.get('codebase_verification'))}, "
            f"completeness={bool(result.get('completeness'))}, "
            f"labels={len(result.get('recommended_labels', []))}",
            flush=True,
        )

        if DEBUG_LINEAR_VALIDATION:
            parse_elapsed = time.time() - parse_start_time
            logger.debug(
                f"[LINEAR_VALIDATION] Phases 2-5: Completeness, Labels, Version, Properties - complete ({parse_elapsed:.2f}s)"
            )
            logger.debug(
                f"[LINEAR_VALIDATION] Confidence: {result.get('confidence', 0):.2f}, "
                f"Work Type: {result.get('analysis', {}).get('work_type', 'unknown')}, "
                f"Recommended Labels: {result.get('recommended_labels', [])}"
            )

        # Save to cache
        print("[LINEAR_VALIDATOR] Saving to cache...", flush=True)
        self._save_result(issue_id, validation_timestamp, result)

        if DEBUG_LINEAR_VALIDATION:
            logger.debug(f"[LINEAR_VALIDATION] Validation complete for {issue_id}")

        print(f"[LINEAR_VALIDATOR] validate_ticket COMPLETE for {issue_id}", flush=True)
        return result

    def _build_validation_prompt(
        self,
        issue_id: str,
        issue_data: dict[str, Any],
        current_version: str | None,
        workspace_metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Build the validation prompt with 5-step workflow instructions.

        Args:
            issue_id: Linear issue identifier
            issue_data: Raw issue data from Linear
            current_version: Current project version for version calculation
            workspace_metadata: Optional workspace metadata (labels, users, projects)

        Returns:
            Formatted prompt string
        """
        title = issue_data.get("title", "")
        description = issue_data.get("description", "")
        state = issue_data.get("state", {}).get("name", "Unknown")
        priority = issue_data.get("priority", 0)
        labels = [label.get("name", "") for label in issue_data.get("labels", [])]
        assignee = (
            issue_data.get("assignee", {}).get("name", "Unassigned")
            if issue_data.get("assignee")
            else "Unassigned"
        )

        version_context = ""
        if current_version:
            version_context = f"""
Current Project Version: {current_version}

Version Label Rules:
- CRITICAL or HIGH priority bugs → Patch increment (e.g., 2.7.4 → 2.7.5)
- New features or enhancements → Minor increment (e.g., 2.7.4 → 2.8.0)
- If version cannot be parsed, default to minor increment
"""

        # Build workspace context section from metadata
        workspace_context = ""
        if workspace_metadata:
            available_labels = workspace_metadata.get("labels", [])
            available_users = workspace_metadata.get("users", [])
            available_projects = workspace_metadata.get("projects", [])

            # Format labels as a list
            labels_list = ", ".join([label.get("name", "") for label in available_labels[:20]])  # Limit to 20 labels
            if len(available_labels) > 20:
                labels_list += f", ... ({len(available_labels)} total)"

            # Format users (name and email)
            users_list = ", ".join([
                f"{user.get('displayName') or user.get('name', 'Unknown')} ({user.get('email', 'no-email')})"
                for user in available_users[:15]  # Limit to 15 users
            ])
            if len(available_users) > 15:
                users_list += f", ... ({len(available_users)} total)"

            # Format projects
            projects_list = ", ".join([project.get("name", "") for project in available_projects[:10]])  # Limit to 10 projects
            if len(available_projects) > 10:
                projects_list += f", ... ({len(available_projects)} total)"

            workspace_context = f"""
## Workspace Context

IMPORTANT: Your label and assignee recommendations MUST come from the following available options:

**Available Labels ({len(available_labels)} total):**
{labels_list}

**Available Assignees ({len(available_users)} total):**
{users_list}

**Available Projects ({len(available_projects)} total):**
{projects_list}

**CRITICAL CONSTRAINTS:**
- ONLY recommend labels that exist in the available labels list above
- ONLY suggest assignees from the available users list above
- ONLY recommend projects from the available projects list above
- If you cannot find appropriate labels from the available list, choose the closest match or omit
"""

        prompt = f"""You are an expert ticket validation agent for Linear. Analyze the following ticket and provide recommendations.

## Ticket Information

**Issue ID:** {issue_id}
**Title:** {title}
**Description:** {description if description else "(No description provided)"}
**Status:** {state}
**Priority:** {priority}
**Labels:** {", ".join(labels) if labels else "None"}
**Assignee:** {assignee}

{version_context}

## Codebase-Aware Validation Workflow

IMPORTANT: You have access to codebase search tools (Read, Grep, Glob). Use them to validate ticket claims against actual code.

### Phase 1: Ticket Analysis (Steps 1-2)

#### Step 1: Analyze Ticket Content
- Summarize the ticket's main objective
- Identify key requirements or acceptance criteria
- Note any technical constraints or dependencies
- Identify the type of work (bug, feature, enhancement, refactoring, etc.)

#### Step 2: Search Codebase for Related Implementation
CRITICAL: Before assessing feasibility, you MUST search the codebase:

1. **Use Grep to search for related code:**
   - Search for function names, class names, or keywords from the ticket title/description
   - Example: If ticket mentions "user authentication", search for patterns like "auth", "login", "authenticate"
   - Use the Grep tool to find relevant files

2. **Use Glob to find related files:**
   - Search for files in relevant directories (e.g., "src/components/**/*auth*", "apps/backend/**/*user*")
   - Look for test files, configuration files, or documentation

3. **Use Read to examine source files:**
   - Read relevant source files to understand current implementation
   - Check if similar functionality already exists
   - Identify code patterns, conventions, and dependencies

4. **Document your findings:**
   - List file paths you examined
   - Note any existing implementations that relate to this ticket
   - Identify potential conflicts or duplications
   - Assess if the ticket's claims match the actual codebase

### Phase 2: Completeness & Feasibility (Steps 3-4)

#### Step 3: Validate Completeness
- Check if title is clear and descriptive
- Verify description provides sufficient context
- Identify missing information (requirements, reproduction steps, etc.)
- Based on your codebase search, assess if technical claims are accurate

#### Step 4: Assess Feasibility (Codebase-Based)
IMPORTANT: Base your feasibility assessment on ACTUAL code analysis:

- **Feasibility Score (0-100):** Consider:
  - Code complexity discovered through file analysis
  - Dependencies identified in the codebase
  - Existing patterns that can be leveraged
  - Technical constraints found in source code
  - Whether similar implementations already exist

- **Provide evidence:** Reference specific files, functions, or code patterns you found

### Phase 3: Recommendations (Step 5)

#### Step 5: Generate Recommendations
Based on BOTH ticket content AND codebase analysis:

**Auto-Select Labels** (CRITICAL: Choose from Available Labels section above):
{"- **IMPORTANT:** ONLY select labels that exist in the 'Available Labels' list in the Workspace Context section above" if workspace_metadata else "- Select appropriate labels for this ticket"}
- Choose 3-5 most relevant labels based on:
  - Work type (bug, feature, enhancement, refactor, documentation, testing, performance)
  - Component area (backend, frontend, database, api, ui/ux, infrastructure)
  - Complexity (simple, medium, complex - based on actual code examined)
  - Impact level (low, medium, high, critical - based on affected files)

**Determine Version Label:**
{"Calculate the appropriate version label based on the current version and ticket type." if current_version else "Recommend whether this should be a patch or minor version increment."}

Rules:
- Bug fixes (especially critical/high priority) → Patch increment (last number + 1)
- New features/enhancements → Minor increment (middle number + 1, last = 0)
- Use semantic versioning: MAJOR.MINOR.PATCH

**Recommend Task Properties:**
1. **Category:** backend, frontend, fullstack, devops, testing, documentation
2. **Complexity:** simple (1-2 hours), medium (half day), complex (1-2 days) - BASED ON CODE ANALYZED
3. **Impact:** low (internal), medium (user-visible), high (blocking), critical (production issue)
4. **Priority:** urgent (1), high (2), normal (3), low (4)

## Output Format

Please provide your results in the following structured format:

```json
{{
  "analysis": {{
    "objective": "Brief summary of the ticket's objective",
    "requirements": ["List of key requirements"],
    "dependencies": ["List of technical constraints or dependencies"],
    "work_type": "bug|feature|enhancement|refactor|documentation|testing|performance"
  }},
  "codebase_verification": {{
    "searched_files": ["path/to/file1.ts", "path/to/file2.py"],
    "related_implementations": [
      {{
        "file": "path/to/existing/code.ts",
        "description": "Brief description of what this code does",
        "relevance": "similar|duplicate|conflicting|dependency"
      }}
    ],
    "patterns_found": ["pattern1", "pattern2"],
    "technical_constraints": ["constraint1 identified from code analysis"],
    "existing_solutions": "Description of any existing solutions found"
  }},
  "completeness": {{
    "title_clear": true|false,
    "description_sufficient": true|false,
    "missing_info": ["List of missing information"],
    "feasibility_score": 0-100,
    "feasibility_reasoning": "Detailed explanation based on ACTUAL CODE ANALYSIS. Reference specific files examined.",
    "rating": "complete|needs_clarification|incomplete"
  }},
  "recommended_labels": [
    "label1",
    "label2",
    "label3"
  ],{f'''
  "recommended_assignee": "User Name (email@example.com)",
  "recommended_project": "Project Name",''' if workspace_metadata else ''}
  "version_label": "{current_version + " (patch/minor)" if current_version else "To be determined"}",
  "properties": {{
    "category": "backend|frontend|fullstack|devops|testing|documentation",
    "complexity": "simple|medium|complex",
    "impact": "low|medium|high|critical",
    "priority": 1|2|3|4
  }},
  "confidence": 0.85,
  "reasoning": "Detailed explanation including CODEBASE VERIFICATION RESULTS. Reference files examined and findings."
}}
```

Begin your analysis with codebase search now.
"""
        return prompt

    def _parse_validation_result(
        self,
        issue_id: str,
        response: str,
        issue_data: dict[str, Any],
        current_version: str | None,
    ) -> dict[str, Any]:
        """
        Parse the validation result from the agent response.

        Args:
            issue_id: Linear issue identifier
            response: Raw response text from the agent
            issue_data: Original issue data for fallback
            current_version: Current project version

        Returns:
            Structured validation result dict
        """
        print(
            f"[LINEAR_VALIDATOR] _parse_validation_result START: {issue_id}", flush=True
        )
        print(
            f"[LINEAR_VALIDATOR] Response length: {len(response)} characters",
            flush=True,
        )
        print(f"[LINEAR_VALIDATOR] Response preview: {response[:500]}...", flush=True)

        # Try to extract JSON from the response (first from code blocks, then full text)
        json_match = re.search(r"```json\s*(\{[\s\S]*?\})\s*```", response, re.DOTALL)

        if not json_match:
            print(
                "[LINEAR_VALIDATOR] No JSON code block found, trying brace extraction...",
                flush=True,
            )
            # If no code block, try to extract balanced JSON by counting braces
            start = response.find("{")
            if start != -1:
                depth = 0
                for i, ch in enumerate(response[start:], start):
                    if ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            try:
                                result = json.loads(response[start : i + 1])
                                result["issue_id"] = issue_id
                                result["raw_response"] = response
                                print(
                                    "[LINEAR_VALIDATOR] Parsed JSON via brace extraction",
                                    flush=True,
                                )
                                return result
                            except json.JSONDecodeError:
                                print(
                                    "[LINEAR_VALIDATOR] JSON decode error during brace extraction",
                                    flush=True,
                                )
                                break

        # If json_match is set (from code block), try to parse it
        if json_match:
            try:
                result = json.loads(json_match.group(1))
                result["issue_id"] = issue_id
                result["raw_response"] = response
                print(
                    "[LINEAR_VALIDATOR] Parsed JSON from code block successfully",
                    flush=True,
                )
                print(
                    f"[LINEAR_VALIDATOR] Result keys: {list(result.keys())}", flush=True
                )
                return result
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse JSON from response for {issue_id}")

        # Fallback: construct minimal result from issue data
        return {
            "issue_id": issue_id,
            "analysis": {
                "objective": issue_data.get("title", "Unknown"),
                "requirements": [],
                "dependencies": [],
                "work_type": "unknown",
            },
            "completeness": {
                "title_clear": bool(issue_data.get("title")),
                "description_sufficient": bool(issue_data.get("description")),
                "missing_info": [],
                "feasibility_score": 0,
                "rating": "needs_clarification",
            },
            "recommended_labels": [],
            "version_label": current_version or "To be determined",
            "properties": {
                "category": "backend",
                "complexity": "medium",
                "impact": "medium",
                "priority": issue_data.get("priority", 3),
            },
            "confidence": 0.0,
            "reasoning": "Failed to parse agent response. Manual review required.",
            "raw_response": response,
        }

    async def validate_batch(
        self,
        issues: list[dict[str, Any]],
        current_version: str | None = None,
        max_concurrent: int = 2,
        skip_cache: bool = False,
    ) -> dict[str, Any]:
        """
        Validate multiple tickets in batch (max 5) with concurrent queue.

        Uses a semaphore to limit concurrent validations and avoid overwhelming
        the API. Tickets are validated in parallel but with controlled concurrency.

        Partial failure handling: Successful validations are returned even if
        some tickets fail. Results are separated into successful and failed groups.

        Args:
            issues: List of issue dicts with 'id' and 'data' keys
            current_version: Current project version for version calculation
            max_concurrent: Maximum number of concurrent validations (default: 2)
            skip_cache: If True, bypass cache and fetch fresh data (default: False)

        Returns:
            Dict with:
            - successful: List of successful validation results
            - failed: List of failed validation results with error details
            - summary: Summary statistics (total, succeeded, failed)

        Raises:
            ValueError: If batch size exceeds maximum, issues lack required 'id' field,
                        or max_concurrent is less than 1
        """
        # Validate max_concurrent parameter
        if not isinstance(max_concurrent, int) or max_concurrent < 1:
            raise ValueError("max_concurrent must be an integer >= 1")

        # Validate all issues have required 'id' field
        issue_ids = []
        for issue in issues:
            issue_id = issue.get("id")
            if not issue_id:
                raise ValueError("All issues must include a non-empty 'id'")
            issue_ids.append(issue_id)

        # Validate batch size limit (module-level function)
        validate_batch_limit(issue_ids)

        # Semaphore to limit concurrent validations
        semaphore = asyncio.Semaphore(max_concurrent)

        async def validate_with_semaphore(issue: dict[str, Any]) -> dict[str, Any]:
            """Validate a single ticket with semaphore control."""
            issue_id = issue.get("id")
            issue_data = issue.get("data", {})

            async with semaphore:
                try:
                    logger.info(
                        f"[Queue] Validating {issue_id} (concurrent: {max_concurrent}, skip_cache: {skip_cache})"
                    )
                    result = await self.validate_ticket(
                        issue_id, issue_data, current_version, skip_cache
                    )
                    logger.info(f"[Queue] Completed {issue_id}")
                    return result
                except Exception as e:
                    logger.error(f"[Queue] Failed {issue_id}: {e}")
                    # Return structured error result
                    return {
                        "issue_id": issue_id,
                        "error": format_validation_error(e, issue_id),
                        "error_type": type(e).__name__,
                        "confidence": 0.0,
                        "failed": True,
                    }

        # Create validation tasks for all issues
        tasks = [validate_with_semaphore(issue) for issue in issues]

        # Execute all tasks concurrently (limited by semaphore)
        results = await asyncio.gather(*tasks, return_exceptions=False)

        # Separate successful and failed results
        successful = [r for r in results if not r.get("failed") and not r.get("error")]
        failed = [r for r in results if r.get("failed") or r.get("error")]

        # Log summary
        logger.info(
            f"[Batch] Completed: {len(successful)}/{len(issues)} successful, "
            f"{len(failed)}/{len(issues)} failed"
        )

        return {
            "successful": successful,
            "failed": failed,
            "summary": {
                "total": len(issues),
                "succeeded": len(successful),
                "failed": len(failed),
            },
        }

    def compute_version_label(
        self,
        current_version: str,
        work_type: str,
        priority: int | str,
    ) -> str:
        """
        Calculate the appropriate version label based on semantic versioning.

        This is a convenience method that delegates to the module-level function.
        See the module-level calculate_version_label for full documentation.

        Args:
            current_version: Current version (e.g., "2.7.4")
            work_type: Type of work (bug, feature, enhancement, etc.)
            priority: Priority level (1-4, or name like "critical", "high", "normal", "low")

        Returns:
            New version label (e.g., "2.7.5" for patch, "2.8.0" for minor)
        """
        # Call module-level function directly (defined in same file at line 1034)
        return calculate_version_label(current_version, work_type, priority)


def validate_batch_limit(issue_ids: list[str]) -> None:
    """
    Validate that the batch size does not exceed the maximum.

    This module-level function validates batch size limits for Linear ticket validation.
    Maximum batch size is 5 tickets to ensure efficient processing.

    Args:
        issue_ids: List of issue IDs to validate

    Raises:
        ValueError: If batch size exceeds maximum of 5 tickets
    """
    MAX_BATCH_SIZE = 5
    if len(issue_ids) > MAX_BATCH_SIZE:
        raise ValueError(
            f"Maximum {MAX_BATCH_SIZE} tickets allowed per batch. "
            f"Got {len(issue_ids)} tickets."
        )


def calculate_version_label(
    current_version: str,
    work_type: str,
    priority: int | str,
) -> str:
    """
    Calculate the appropriate version label based on semantic versioning.

    This function implements semantic versioning logic:
    - Bug fixes (especially critical/high priority) → Patch increment (2.7.4 → 2.7.5)
    - New features or enhancements → Minor increment (2.7.4 → 2.8.0)

    Args:
        current_version: Current version (e.g., "2.7.4")
        work_type: Type of work (bug, feature, enhancement, etc.)
        priority: Priority level (1-4, or name like "critical", "high", "normal", "low")

    Returns:
        New version label (e.g., "2.7.5" for patch, "2.8.0" for minor)
    """
    try:
        # Parse version string
        parts = current_version.split(".")
        if len(parts) < 2:
            # Cannot parse, return current with note
            return f"{current_version} (version format unclear)"

        # At this point, parts has at least 2 elements (guaranteed by early return above)
        major = int(parts[0])
        minor = int(parts[1])
        patch = int(parts[2]) if len(parts) > 2 else 0

        # Determine if patch or minor increment based on work type
        work_type_lower = work_type.lower().strip()

        # Bug fixes get patch increment
        if work_type_lower in ("bug", "bugfix", "fix"):
            # Patch increment: 2.7.4 → 2.7.5
            return f"{major}.{minor}.{patch + 1}"

        # Features and enhancements get minor increment
        if work_type_lower in ("feature", "enhancement", "new"):
            # Minor increment: 2.7.4 → 2.8.0
            return f"{major}.{minor + 1}.0"

        # For other work types, check priority to decide
        # Critical/high priority issues → patch, others → minor
        is_high_priority = False

        if isinstance(priority, str):
            priority_lower = priority.lower().strip()
            is_high_priority = priority_lower in ("critical", "high", "urgent")
        elif isinstance(priority, int):
            is_high_priority = priority <= 2  # Urgent (1) or High (2)

        if is_high_priority:
            # High priority → patch increment
            return f"{major}.{minor}.{patch + 1}"
        else:
            # Normal/low priority → minor increment
            return f"{major}.{minor + 1}.0"

    except (ValueError, IndexError, AttributeError):
        # Cannot parse version, return current with note
        return f"{current_version} (version format unclear)"


def create_linear_validator(
    spec_dir: Path,
    project_dir: Path,
    model: str = "claude-opus-4-5-20251101",
    progress_callback: Callable[[str, int, int, str], None] | None = None,
) -> LinearValidationAgent:
    """
    Factory function to create a Linear validation agent.

    Args:
        spec_dir: Directory containing the spec
        project_dir: Root directory for the project
        model: Claude model to use (default: Opus)
        progress_callback: Optional callback for progress updates (phase, step, total, message)

    Returns:
        Configured LinearValidationAgent instance
    """
    return LinearValidationAgent(
        spec_dir, project_dir, model, progress_callback=progress_callback
    )

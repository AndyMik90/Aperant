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
import logging
import os
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypeVar

import diskcache
import requests
from core.client import create_client

if TYPE_CHECKING:
    from core.client import ClaudeSDKClient

logger = logging.getLogger(__name__)

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
    func: Callable[..., T],
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
            delay = min(
                config.base_delay * (config.exponential_base**attempt), config.max_delay
            )

            # Add jitter to avoid thundering herd
            if config.jitter:
                import random

                delay = delay * (0.5 + random.random())

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

    # Generic fallback
    return f"Validation failed: {error}"


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
        model: str = "claude-opus-4-5-20251101",
        session_timeout: float | None = None,
    ):
        """
        Initialize the Linear validation agent.

        Args:
            spec_dir: Directory containing the spec (for context)
            project_dir: Root directory for the project
            model: Claude model to use (default: Opus for best analysis)
            session_timeout: Timeout in seconds for validation sessions (default: 300s)
        """
        self.spec_dir = Path(spec_dir)
        self.project_dir = Path(project_dir)
        self.model = model
        self.session_timeout = (
            session_timeout
            if session_timeout is not None
            else self.DEFAULT_SESSION_TIMEOUT
        )
        self._client = None

        # Initialize diskcache for validation results
        cache_dir = self.spec_dir / ".cache" / "linear_validator"
        cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache = diskcache.Cache(str(cache_dir))

    def create_client(self) -> "ClaudeSDKClient":
        """
        Create a Claude SDK client configured for Linear validation.

        Uses agent_type="linear_validator" to enable:
        - Linear MCP tools for ticket operations
        - Graphiti memory for context
        - Context7 for documentation lookup
        - Auto-claude tools for progress tracking

        Returns:
            Configured ClaudeSDKClient instance
        """
        if self._client is None:
            self._client = create_client(
                self.project_dir,
                self.spec_dir,
                self.model,
                agent_type="linear_validator",
                max_thinking_tokens=10000,  # High thinking for complex analysis
            )
        return self._client

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
        numeric_id = issue_id.replace("LIN-", "").replace("-", "")

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

        headers = {
            "Authorization": api_key,
            "Content-Type": "application/json",
        }

        try:
            response = requests.post(
                "https://api.linear.app/graphql",
                json={"query": query, "variables": {"issueId": numeric_id}},
                headers=headers,
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()

            if "errors" in data:
                error_msg = data["errors"][0].get("message", "Unknown error")
                if (
                    "not found" in error_msg.lower()
                    or "does not exist" in error_msg.lower()
                ):
                    raise TicketNotFoundError(issue_id, f"Issue {issue_id} not found")
                raise NetworkError(f"Linear API error: {error_msg}")

            issue_data = data.get("data", {}).get("issue")
            if not issue_data:
                raise TicketNotFoundError(issue_id, f"Issue {issue_id} not found")

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
            raise NetworkError(f"Timeout fetching issue {issue_id} from Linear API")
        except requests.exceptions.RequestException as e:
            raise NetworkError(f"Network error fetching issue {issue_id}: {e}")

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
        # Fetch issue data from Linear API if not provided
        if issue_data is None:
            logger.info(f"Fetching issue data for {issue_id} from Linear API")
            issue_data = self._fetch_linear_issue(issue_id)

        # Extract validation timestamp from issue data
        validation_timestamp = issue_data.get("updatedAt", "")

        # Check cache first
        cached_result = self._get_cached_result(
            issue_id, validation_timestamp, skip_cache
        )
        if cached_result is not None:
            return cached_result

        # Perform validation if not cached
        client = self.create_client()

        # Build validation prompt with 5-step workflow
        prompt = self._build_validation_prompt(issue_id, issue_data, current_version)

        # Run validation session with streaming and retry logic
        async with client:

            async def run_validation_session():
                """Run the validation session with retry and timeout support."""
                # Wrap the session call with timeout
                try:
                    _, response = await asyncio.wait_for(
                        client.create_agent_session(
                            name=f"linear-validation-{issue_id}",
                            starting_message=prompt,
                        ),
                        timeout=self.session_timeout,
                    )
                    return response
                except asyncio.TimeoutError:
                    logger.error(
                        f"Validation session for {issue_id} timed out after {self.session_timeout}s"
                    )
                    raise ValidationTimeoutError(issue_id, self.session_timeout)

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
        result = self._parse_validation_result(
            issue_id, response, issue_data, current_version
        )

        # Save to cache
        self._save_result(issue_id, validation_timestamp, result)

        return result

    def _build_validation_prompt(
        self,
        issue_id: str,
        issue_data: dict[str, Any],
        current_version: str | None,
    ) -> str:
        """
        Build the validation prompt with 5-step workflow instructions.

        Args:
            issue_id: Linear issue identifier
            issue_data: Raw issue data from Linear
            current_version: Current project version for version calculation

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

## 5-Step Validation Workflow

Please complete the following 5 steps and provide your results in a structured format:

### Step 1: Analyze Ticket Content
- Summarize the ticket's main objective
- Identify key requirements or acceptance criteria
- Note any technical constraints or dependencies
- Identify the type of work (bug, feature, enhancement, refactoring, etc.)

### Step 2: Validate Completeness
- Check if title is clear and descriptive
- Verify description provides sufficient context
- Identify missing information (requirements, reproduction steps, etc.)
- Assess technical feasibility
- Rate completeness: Complete, Needs Clarification, or Incomplete

### Step 3: Auto-Select Labels
Based on the ticket content, recommend appropriate labels from these common categories:
- **Type:** bug, feature, enhancement, refactor, documentation, testing, performance
- **Component:** backend, frontend, database, api, ui/ux, infrastructure
- **Complexity:** simple, medium, complex
- **Impact:** low, medium, high, critical

### Step 4: Determine Version Label
{"Calculate the appropriate version label based on the current version and ticket type." if current_version else "Recommend whether this should be a patch or minor version increment."}

Rules:
- Bug fixes (especially critical/high priority) → Patch increment (last number + 1)
- New features/enhancements → Minor increment (middle number + 1, last = 0)
- Use semantic versioning: MAJOR.MINOR.PATCH

### Step 5: Recommend Task Properties
Provide recommendations for:
1. **Category:** backend, frontend, fullstack, devops, testing, documentation
2. **Complexity:** simple (1-2 hours), medium (half day), complex (1-2 days)
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
  "completeness": {{
    "title_clear": true|false,
    "description_sufficient": true|false,
    "missing_info": ["List of missing information"],
    "feasibility": "feasible|needs_clarification|not_feasible",
    "rating": "complete|needs_clarification|incomplete"
  }},
  "recommended_labels": [
    "label1",
    "label2",
    "label3"
  ],
  "version_label": "{current_version + " (patch/minor)" if current_version else "To be determined"}",
  "properties": {{
    "category": "backend|frontend|fullstack|devops|testing|documentation",
    "complexity": "simple|medium|complex",
    "impact": "low|medium|high|critical",
    "priority": 1|2|3|4
  }},
  "confidence": 0.85,
  "reasoning": "Detailed explanation of your recommendations and rationale"
}}
```

Begin your analysis now.
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
        import json
        import re

        # Try to extract JSON from the response (first from code blocks, then full text)
        json_match = re.search(r"```json\s*(\{[\\s\\S]*?\})\s*```", response, re.DOTALL)

        if not json_match:
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
                                return result
                            except json.JSONDecodeError:
                                break
            # Fallback to regex for simple cases
            json_match = re.search(r"(\{.*?\})", response, re.DOTALL)

        if json_match:
            try:
                result = json.loads(json_match.group(1))
                result["issue_id"] = issue_id
                result["raw_response"] = response
                return result
            except json.JSONDecodeError:
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
                "feasibility": "needs_clarification",
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

    def validate_batch_limit(self, issue_ids: list[str]) -> None:
        """
        Validate that the batch size does not exceed the maximum.

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

    async def validate_batch(
        self,
        issues: list[dict[str, Any]],
        current_version: str | None = None,
        max_concurrent: int = 2,
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

        Returns:
            Dict with:
            - successful: List of successful validation results
            - failed: List of failed validation results with error details
            - summary: Summary statistics (total, succeeded, failed)

        Raises:
            ValueError: If batch size exceeds maximum
        """
        issue_ids = [issue.get("id") for issue in issues]
        self.validate_batch_limit(issue_ids)

        # Semaphore to limit concurrent validations
        semaphore = asyncio.Semaphore(max_concurrent)

        async def validate_with_semaphore(issue: dict[str, Any]) -> dict[str, Any]:
            """Validate a single ticket with semaphore control."""
            issue_id = issue.get("id")
            issue_data = issue.get("data", {})

            async with semaphore:
                try:
                    logger.info(
                        f"[Queue] Validating {issue_id} (concurrent: {max_concurrent})"
                    )
                    result = await self.validate_ticket(
                        issue_id, issue_data, current_version
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

    def calculate_version_label(
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
        # Call module-level function via globals to avoid name conflict
        return globals()["calculate_version_label"](
            current_version, work_type, priority
        )


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

        major = int(parts[0]) if len(parts) > 0 else 0
        minor = int(parts[1]) if len(parts) > 1 else 0
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
) -> LinearValidationAgent:
    """
    Factory function to create a Linear validation agent.

    Args:
        spec_dir: Directory containing the spec
        project_dir: Root directory for the project
        model: Claude model to use (default: Opus)

    Returns:
        Configured LinearValidationAgent instance
    """
    return LinearValidationAgent(spec_dir, project_dir, model)

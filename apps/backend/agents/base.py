"""
Base Module for Agent System
=============================

Shared imports, types, and constants used across agent modules.
"""

import logging
import re

# Configure logging
logger = logging.getLogger(__name__)

# Configuration constants
AUTO_CONTINUE_DELAY_SECONDS = 3
HUMAN_INTERVENTION_FILE = "PAUSE"

# Retry configuration for 400 tool concurrency errors
MAX_CONCURRENCY_RETRIES = 5  # Maximum number of retries for tool concurrency errors
INITIAL_RETRY_DELAY_SECONDS = (
    2  # Initial retry delay (doubles each retry: 2s, 4s, 8s, 16s, 32s)
)
MAX_RETRY_DELAY_SECONDS = 32  # Cap retry delay at 32 seconds

# Pause file constants for intelligent error recovery
# These files signal pause/resume between frontend and backend
RATE_LIMIT_PAUSE_FILE = "RATE_LIMIT_PAUSE"  # Created when rate limited
AUTH_FAILURE_PAUSE_FILE = "AUTH_PAUSE"  # Created when auth fails
RESUME_FILE = "RESUME"  # Created by frontend to signal resume

# Maximum time to wait for rate limit reset (2 hours)
# If reset time is beyond this, task should fail rather than wait indefinitely
MAX_RATE_LIMIT_WAIT_SECONDS = 7200

# Wait intervals for pause/resume checking
RATE_LIMIT_CHECK_INTERVAL_SECONDS = (
    30  # Check for RESUME file every 30 seconds during rate limit wait
)
AUTH_RESUME_CHECK_INTERVAL_SECONDS = 10  # Check for re-authentication every 10 seconds
AUTH_RESUME_MAX_WAIT_SECONDS = 86400  # Maximum wait for re-authentication (24 hours)


def sanitize_error_message(error_message: str, max_length: int = 500) -> str:
    """
    Sanitize error messages to remove potentially sensitive information.

    Redacts:
    - API keys (sk-..., key-...)
    - Bearer tokens
    - Token/secret values

    Args:
        error_message: The raw error message to sanitize
        max_length: Maximum length to truncate to (default 500)

    Returns:
        Sanitized and truncated error message
    """
    if not error_message:
        return ""

    # Redact patterns that look like API keys or tokens
    # Pattern: sk-... (OpenAI/Anthropic keys like sk-ant-api03-...)
    sanitized = re.sub(
        r"\bsk-[a-zA-Z0-9._\-]{20,}\b", "[REDACTED_API_KEY]", error_message
    )

    # Pattern: key-... (generic API keys)
    sanitized = re.sub(r"\bkey-[a-zA-Z0-9._\-]{20,}\b", "[REDACTED_API_KEY]", sanitized)

    # Pattern: Bearer ... (bearer tokens)
    sanitized = re.sub(
        r"\bBearer\s+[a-zA-Z0-9._\-]{20,}\b", "Bearer [REDACTED_TOKEN]", sanitized
    )

    # Pattern: token= or token: followed by long strings
    sanitized = re.sub(
        r"(token[=:]\s*)[a-zA-Z0-9._\-]{20,}\b",
        r"\1[REDACTED_TOKEN]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # Pattern: secret= or secret: followed by strings
    sanitized = re.sub(
        r"(secret[=:]\s*)[a-zA-Z0-9._\-]{20,}\b",
        r"\1[REDACTED_SECRET]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # Truncate to max length
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length] + "..."

    return sanitized

"""
Secret Scrubber for Memory Storage
===================================

Detects and redacts sensitive information (API keys, tokens, credentials,
private keys, connection strings) before any data is persisted to memory.

Applied at every memory write path — both file-based and Graphiti — to
prevent credentials from leaking into stored conversations, session insights,
patterns, gotchas, or codebase maps.

Ported from Shipyard's src/memory/scrubber.ts with 17 regex patterns.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

REDACTED = "[REDACTED]"


@dataclass
class ScrubResult:
    """Result of scrubbing text for secrets."""

    text: str
    redaction_count: int = 0
    redacted_types: list[str] = field(default_factory=list)


# 17 secret patterns — order matters (specific patterns before generic ones)
SECRET_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("AWS Access Key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("GitHub Token", re.compile(r"ghp_[a-zA-Z0-9]{36}")),
    ("GitHub OAuth Token", re.compile(r"gho_[a-zA-Z0-9]{36}")),
    ("GitHub App Token", re.compile(r"ghu_[a-zA-Z0-9]{36}")),
    ("GitHub Refresh Token", re.compile(r"ghr_[a-zA-Z0-9]{36}")),
    ("Anthropic API Key", re.compile(r"sk-ant-api03-[a-zA-Z0-9_-]{90,}")),
    ("OpenAI API Key", re.compile(r"sk-proj-[a-zA-Z0-9_-]{40,}")),
    ("Stripe Live Key", re.compile(r"sk_live_[a-zA-Z0-9]{24,}")),
    ("Stripe Test Key", re.compile(r"sk_test_[a-zA-Z0-9]{24,}")),
    ("Slack Token", re.compile(r"xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}")),
    ("NPM Token", re.compile(r"npm_[a-zA-Z0-9]{36}")),
    (
        "Private Key",
        re.compile(
            r"-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----"
        ),
    ),
    ("JWT Token", re.compile(r"eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*")),
    ("Bearer Token", re.compile(r"[Bb]earer\s+[a-zA-Z0-9_-]{20,}")),
    (
        "Database URL",
        re.compile(r"(?:postgres|mysql|mongodb|redis)://[^:]+:[^@]+@[^\s]+", re.IGNORECASE),
    ),
    (
        "Azure Connection String",
        re.compile(
            r"DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+;EndpointSuffix=[^\s\"']*",
            re.IGNORECASE,
        ),
    ),
    (
        "Generic API Key",
        re.compile(r"[aA][pP][iI][-_]?[kK][eE][yY]\s*[=:]\s*['\"]?[a-zA-Z0-9_-]{20,}['\"]?"),
    ),
    (
        "Password Assignment",
        re.compile(r"password\s*[=:]\s*['\"]?[^\s'\"]{8,}['\"]?", re.IGNORECASE),
    ),
]


def scrub_secrets(text: str) -> ScrubResult:
    """
    Scrub sensitive information from text.

    Args:
        text: Input text that may contain secrets

    Returns:
        ScrubResult with redacted text, count, and types found
    """
    if not text:
        return ScrubResult(text="")

    scrubbed = text
    redaction_count = 0
    redacted_types: list[str] = []

    for name, pattern in SECRET_PATTERNS:
        matches = pattern.findall(scrubbed)
        if matches:
            redaction_count += len(matches)
            if name not in redacted_types:
                redacted_types.append(name)
            scrubbed = pattern.sub(REDACTED, scrubbed)

    if redaction_count > 0:
        logger.info(
            "Scrubbed %d secret(s) of type(s): %s",
            redaction_count,
            ", ".join(redacted_types),
        )

    return ScrubResult(
        text=scrubbed,
        redaction_count=redaction_count,
        redacted_types=redacted_types,
    )


def scrub_text(text: str) -> str:
    """
    Convenience wrapper — scrub and return just the cleaned text.

    Args:
        text: Input text that may contain secrets

    Returns:
        Text with secrets replaced by [REDACTED]
    """
    return scrub_secrets(text).text


def scrub_dict(data: dict[str, Any]) -> dict[str, Any]:
    """
    Recursively scrub all string values in a dictionary.

    Processes nested dicts, lists, and string values. Non-string leaves
    are left untouched.

    Args:
        data: Dictionary that may contain secrets in its values

    Returns:
        New dictionary with all string values scrubbed
    """
    return _scrub_value(data)


def _scrub_value(value: Any) -> Any:
    """Recursively scrub a value."""
    if isinstance(value, str):
        return scrub_text(value)
    elif isinstance(value, dict):
        return {k: _scrub_value(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [_scrub_value(item) for item in value]
    return value


def contains_secrets(text: str) -> bool:
    """
    Check if text contains any secrets (without modifying).

    Args:
        text: Text to check

    Returns:
        True if any secret patterns match
    """
    if not text:
        return False

    for _, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            return True
    return False

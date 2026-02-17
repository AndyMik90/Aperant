"""
Recovery Utilities for PR Review
=================================

Shared helpers for extraction recovery in followup and parallel followup reviewers.

These utilities consolidate duplicated logic for:
- Parsing "SEVERITY: description" patterns from extraction summaries
- Generating consistent, traceable finding IDs with prefixes
- Creating PRReviewFinding objects from extraction data
"""

from __future__ import annotations

import hashlib

try:
    from ..models import (
        PRReviewFinding,
        ReviewCategory,
        ReviewSeverity,
    )
except (ImportError, ValueError, SystemError):
    from models import (
        PRReviewFinding,
        ReviewCategory,
        ReviewSeverity,
    )

# Severity mapping for parsing "SEVERITY: description" patterns
_EXTRACTION_SEVERITY_MAP: list[tuple[str, ReviewSeverity]] = [
    ("CRITICAL:", ReviewSeverity.CRITICAL),
    ("HIGH:", ReviewSeverity.HIGH),
    ("MEDIUM:", ReviewSeverity.MEDIUM),
    ("LOW:", ReviewSeverity.LOW),
]


def parse_severity_from_summary(
    summary: str,
) -> tuple[ReviewSeverity, str]:
    """Parse a "SEVERITY: description" pattern from an extraction summary.

    Args:
        summary: Raw summary string, e.g. "HIGH: Missing null check in parser.py"

    Returns:
        Tuple of (severity, cleaned_description).
        Defaults to MEDIUM severity if no prefix is found.
    """
    upper_summary = summary.upper()
    for sev_name, sev_val in _EXTRACTION_SEVERITY_MAP:
        if upper_summary.startswith(sev_name):
            return sev_val, summary[len(sev_name) :].strip()
    return ReviewSeverity.MEDIUM, summary


def generate_recovery_finding_id(
    index: int, description: str, prefix: str = "FR"
) -> str:
    """Generate a consistent, traceable finding ID for recovery findings.

    Args:
        index: The index of the finding in the extraction list.
        description: The finding description (used for hash uniqueness).
        prefix: ID prefix for traceability. Default "FR" (Followup Recovery).
                Use "FU" for parallel followup findings.

    Returns:
        A prefixed finding ID like "FR-A1B2C3D4" or "FU-A1B2C3D4".
    """
    content = f"extraction-{index}-{description}"
    hex_hash = (
        hashlib.md5(content.encode(), usedforsecurity=False).hexdigest()[:8].upper()
    )
    return f"{prefix}-{hex_hash}"


def create_finding_from_summary(
    summary: str,
    index: int,
    id_prefix: str = "FR",
    severity_override: str | None = None,
    file: str = "unknown",
    line: int = 0,
) -> PRReviewFinding:
    """Create a PRReviewFinding from an extraction summary string.

    Parses "SEVERITY: description" patterns, generates a traceable finding ID,
    and returns a fully constructed PRReviewFinding.

    Args:
        summary: Raw summary string, e.g. "HIGH: Missing null check in parser.py"
        index: The index of the finding in the extraction list.
        id_prefix: ID prefix for traceability. Default "FR" (Followup Recovery).
        severity_override: If provided, use this severity instead of parsing from summary.
        file: File path where the issue was found (default "unknown").
        line: Line number in the file (default 0).

    Returns:
        A PRReviewFinding with parsed severity, generated ID, and description.
    """
    severity, description = parse_severity_from_summary(summary)

    # Use severity_override if provided
    if severity_override is not None:
        severity_map = {k.rstrip(":"): v for k, v in _EXTRACTION_SEVERITY_MAP}
        severity = severity_map.get(severity_override.upper(), severity)

    finding_id = generate_recovery_finding_id(index, description, prefix=id_prefix)

    return PRReviewFinding(
        id=finding_id,
        severity=severity,
        category=ReviewCategory.QUALITY,
        title=description[:80],
        description=f"[Recovered via extraction] {description}",
        file=file,
        line=line,
    )

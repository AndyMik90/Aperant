"""
Validation Module
=================

Spec validation with auto-fix capabilities.
"""

import json
from datetime import datetime
from pathlib import Path


def create_minimal_research(spec_dir: Path, reason: str = "No research needed") -> Path:
    """Create minimal research.json file."""
    research_file = spec_dir / "research.json"

    with open(research_file, "w", encoding="utf-8") as f:
        json.dump(
            {
                "integrations_researched": [],
                "research_skipped": True,
                "reason": reason,
                "created_at": datetime.now().isoformat(),
            },
            f,
            indent=2,
        )

    return research_file


def create_minimal_critique(
    spec_dir: Path, reason: str = "Critique not required"
) -> Path:
    """Create minimal critique_report.json file."""
    critique_file = spec_dir / "critique_report.json"

    with open(critique_file, "w", encoding="utf-8") as f:
        json.dump(
            {
                "issues_found": [],
                "no_issues_found": True,
                "critique_summary": reason,
                "created_at": datetime.now().isoformat(),
            },
            f,
            indent=2,
        )

    return critique_file


def create_empty_hints(spec_dir: Path, enabled: bool, reason: str) -> Path:
    """Create empty graph_hints.json file."""
    hints_file = spec_dir / "graph_hints.json"

    with open(hints_file, "w", encoding="utf-8") as f:
        json.dump(
            {
                "enabled": enabled,
                "reason": reason,
                "hints": [],
                "created_at": datetime.now().isoformat(),
            },
            f,
            indent=2,
        )

    return hints_file

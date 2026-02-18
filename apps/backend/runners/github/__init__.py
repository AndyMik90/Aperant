"""
GitHub Automation Runners
=========================

Standalone runner system for GitHub automation:
- PR Review: AI-powered code review with fix suggestions
- Issue Triage: Duplicate/spam/feature-creep detection
- Issue Auto-Fix: Automatic spec creation and execution from issues

This is SEPARATE from the main task execution pipeline (spec_runner, run.py, etc.)
to maintain modularity and avoid breaking existing features.

LAZY IMPORTS: To enable testing and coverage tracking of individual modules,
the orchestrator is only imported when actually accessed (not at package import time).
"""

from __future__ import annotations

# Import models directly - they have minimal dependencies
from .models import (
    AutoFixState,
    AutoFixStatus,
    GitHubRunnerConfig,
    PRReviewFinding,
    PRReviewResult,
    ReviewCategory,
    ReviewSeverity,
    TriageCategory,
    TriageResult,
)

# Lazy import for orchestrator to avoid loading heavy dependencies at package import time
# This enables testing individual modules (like gh_client) without triggering
# the entire dependency tree
def __getattr__(name: str):
    """Lazy import orchestrator only when actually accessed."""
    if name == "GitHubOrchestrator":
        from .orchestrator import GitHubOrchestrator
        return GitHubOrchestrator
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    # Orchestrator (lazy loaded)
    "GitHubOrchestrator",
    # Models (eagerly loaded)
    "PRReviewResult",
    "PRReviewFinding",
    "TriageResult",
    "AutoFixState",
    "GitHubRunnerConfig",
    # Enums
    "ReviewSeverity",
    "ReviewCategory",
    "TriageCategory",
    "AutoFixStatus",
]

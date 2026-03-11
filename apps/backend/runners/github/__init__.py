"""
GitHub Automation Runners
=========================

Standalone runner system for GitHub automation:
- PR Review: AI-powered code review with fix suggestions
- Issue Triage: Duplicate/spam/feature-creep detection
- Issue Auto-Fix: Automatic spec creation and execution from issues

This is SEPARATE from the main task execution pipeline (spec_runner, run.py, etc.)
to maintain modularity and avoid breaking existing features.
"""

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

__all__ = [
    # Orchestrator
    "GitHubOrchestrator",
    # Models
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


def __getattr__(name: str):
    if name == "GitHubOrchestrator":
        from .orchestrator import GitHubOrchestrator

        return GitHubOrchestrator
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

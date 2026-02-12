"""
GitLab Automation Runner
=========================

CLI interface for GitLab automation features:
- MR Review: AI-powered merge request review
- Follow-up Review: Review changes since last review

Note: The main() function is intentionally not imported here to avoid
path conflicts when importing submodules. Import directly from runner:
    from runners.gitlab.runner import main
"""

from .models import (
    AutoFixState,
    AutoFixStatus,
    GitLabRunnerConfig,
    MRReviewFinding,
    MRReviewResult,
    ReviewCategory,
    ReviewSeverity,
    TriageCategory,
)
from .orchestrator import GitLabOrchestrator

__all__ = [
    # Orchestrator
    "GitLabOrchestrator",
    # Models
    "MRReviewResult",
    "MRReviewFinding",
    "TriageResult",
    "AutoFixState",
    "GitLabRunnerConfig",
    # Enums
    "ReviewSeverity",
    "ReviewCategory",
    "TriageCategory",
    "AutoFixStatus",
]


def __getattr__(name: str):
    """Lazy import for main function."""
    if name == "main":
        from runners.gitlab.runner import main as _main

        return _main
    if name == "TriageResult":
        from .models import TriageResult as _TriageResult

        return _TriageResult
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

"""
GitHub Orchestrator Services
============================

Service layer for GitHub automation workflows.

NOTE: Uses lazy imports to avoid circular dependency with context_gatherer.py.
The circular import chain was: orchestrator → context_gatherer → services.io_utils
→ services/__init__ → pr_review_engine → context_gatherer (circular!)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .autofix_processor import AutoFixProcessor
    from .batch_processor import BatchProcessor
    from .enrichment_engine import EnrichmentEngine
    from .investigation_label_manager import InvestigationLabelManager
    from .investigation_models import (
        FixAdvice,
        ImpactAssessment,
        InvestigationReport,
        InvestigationState,
        ReproductionAnalysis,
        RootCauseAnalysis,
    )
    from .investigation_report_builder import build_github_comment, build_summary
    from .issue_investigation_orchestrator import IssueInvestigationOrchestrator
    from .parallel_agent_base import ParallelAgentOrchestrator, SpecialistConfig
    from .pr_review_engine import PRReviewEngine
    from .prompt_manager import PromptManager
    from .response_parsers import ResponseParser
    from .split_engine import SplitEngine
    from .triage_engine import TriageEngine

# Lazy import mapping - classes are loaded on first access
_LAZY_IMPORTS: dict[str, tuple[str, str]] = {
    "AutoFixProcessor": (".autofix_processor", "AutoFixProcessor"),
    "BatchProcessor": (".batch_processor", "BatchProcessor"),
    "EnrichmentEngine": (".enrichment_engine", "EnrichmentEngine"),
    "InvestigationReport": (".investigation_models", "InvestigationReport"),
    "InvestigationState": (".investigation_models", "InvestigationState"),
    "InvestigationLabelManager": (
        ".investigation_label_manager",
        "InvestigationLabelManager",
    ),
    "IssueInvestigationOrchestrator": (
        ".issue_investigation_orchestrator",
        "IssueInvestigationOrchestrator",
    ),
    "build_github_comment": (
        ".investigation_report_builder",
        "build_github_comment",
    ),
    "build_summary": (
        ".investigation_report_builder",
        "build_summary",
    ),
    "RootCauseAnalysis": (".investigation_models", "RootCauseAnalysis"),
    "ImpactAssessment": (".investigation_models", "ImpactAssessment"),
    "FixAdvice": (".investigation_models", "FixAdvice"),
    "ReproductionAnalysis": (".investigation_models", "ReproductionAnalysis"),
    "ParallelAgentOrchestrator": (".parallel_agent_base", "ParallelAgentOrchestrator"),
    "PRReviewEngine": (".pr_review_engine", "PRReviewEngine"),
    "PromptManager": (".prompt_manager", "PromptManager"),
    "ResponseParser": (".response_parsers", "ResponseParser"),
    "SpecialistConfig": (".parallel_agent_base", "SpecialistConfig"),
    "SplitEngine": (".split_engine", "SplitEngine"),
    "TriageEngine": (".triage_engine", "TriageEngine"),
}

__all__ = [
    "PromptManager",
    "ResponseParser",
    "PRReviewEngine",
    "TriageEngine",
    "EnrichmentEngine",
    "SplitEngine",
    "AutoFixProcessor",
    "BatchProcessor",
    "ParallelAgentOrchestrator",
    "SpecialistConfig",
    "InvestigationLabelManager",
    "InvestigationReport",
    "InvestigationState",
    "IssueInvestigationOrchestrator",
    "build_github_comment",
    "build_summary",
    "RootCauseAnalysis",
    "ImpactAssessment",
    "FixAdvice",
    "ReproductionAnalysis",
]

# Cache for lazily loaded modules
_loaded: dict[str, object] = {}


def __getattr__(name: str) -> object:
    """Lazy import handler - loads classes on first access."""
    if name in _LAZY_IMPORTS:
        if name not in _loaded:
            module_name, attr_name = _LAZY_IMPORTS[name]
            import importlib

            module = importlib.import_module(module_name, __name__)
            _loaded[name] = getattr(module, attr_name)
        return _loaded[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    """Expose lazy imports in dir() and for static analysis."""
    return list(_LAZY_IMPORTS.keys())

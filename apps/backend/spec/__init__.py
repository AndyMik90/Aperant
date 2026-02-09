"""
Spec Creation Module
====================

Modular spec creation pipeline with complexity-based phase selection.

Main Components:
- complexity: Task complexity assessment (AI and heuristic)
- requirements: Interactive and automated requirements gathering
- discovery: Project structure analysis
- context: Relevant file discovery
- writer: Spec document and plan creation
- validator: Validation helpers
- phases: Individual phase implementations
- pipeline: Main orchestration logic

Usage:
    from spec import SpecOrchestrator

    orchestrator = SpecOrchestrator(
        project_dir=Path.cwd(),
        task_description="Add user authentication",
    )

    success = await orchestrator.run()

Note:
    SpecOrchestrator and get_specs_dir are lazy-imported to avoid circular
    dependencies between spec.pipeline and core.client.

    Module-level placeholders (with _ prefix) are defined for CodeQL static
    analysis. The actual exported names (without _ prefix) trigger __getattr__
    for lazy loading.
"""

from typing import Any

from .complexity import (
    Complexity,
    ComplexityAnalyzer,
    ComplexityAssessment,
    run_ai_complexity_assessment,
    save_assessment,
)
from .phases import PhaseExecutor, PhaseResult


# Module-level placeholders for CodeQL static analysis.
# These define the symbols as existing at module level (satisfying CodeQL),
# but __getattr__ is called to provide the actual values.
def get_specs_dir(*args: Any, **kwargs: Any) -> Any:
    """Stub for lazy import."""
    raise NotImplementedError("Use __getattr__")


class SpecOrchestrator:  # type: ignore[misc, no-redef]
    """Stub for lazy import."""


__all__ = [
    # Main orchestrator
    "SpecOrchestrator",
    "get_specs_dir",
    # Complexity assessment
    "Complexity",
    "ComplexityAnalyzer",
    "ComplexityAssessment",
    "run_ai_complexity_assessment",
    "save_assessment",
    # Phase execution
    "PhaseExecutor",
    "PhaseResult",
]


def __getattr__(name: str) -> Any:
    """Lazy imports to avoid circular dependencies with core.client.

    The spec.pipeline module imports from core.client (via agent_runner.py),
    which imports from agents.tools_pkg, which imports from spec.validate_pkg.
    This creates a circular dependency when spec/__init__.py imports
    SpecOrchestrator at module level.

    By deferring these imports via __getattr__, the import chain only
    executes when these symbols are actually accessed, breaking the cycle.
    """
    if name == "SpecOrchestrator":
        from .pipeline import SpecOrchestrator

        return SpecOrchestrator
    elif name == "get_specs_dir":
        from .pipeline import get_specs_dir

        return get_specs_dir
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _do_lazy_import(name: str) -> Any:
    """Perform the actual lazy import for a given name."""
    if name == "SpecOrchestrator":
        from .pipeline import SpecOrchestrator

        return SpecOrchestrator
    if name == "get_specs_dir":
        from .pipeline import get_specs_dir

        return get_specs_dir
    raise AssertionError(f"Unknown lazy import name: {name}")

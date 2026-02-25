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
    dependencies between spec.pipeline and core.client. The import chain:
    spec.pipeline.agent_runner imports core.client, which imports
    agents.tools_pkg, which imports from spec.validate_pkg, causing a cycle
    when spec/__init__.py imports SpecOrchestrator at module level.
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

    Imported objects are cached in globals() to avoid repeated imports.
    """
    if name in ("SpecOrchestrator", "get_specs_dir"):
        from .pipeline import SpecOrchestrator, get_specs_dir

        # Cache in globals so subsequent accesses bypass __getattr__
        globals().update(SpecOrchestrator=SpecOrchestrator, get_specs_dir=get_specs_dir)
        return globals()[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

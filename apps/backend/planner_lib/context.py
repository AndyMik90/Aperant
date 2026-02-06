"""
Context loading and workflow detection for implementation planner.
"""

import json
import re
from pathlib import Path

from implementation_plan import WorkflowType

from .models import PlannerContext


def _normalize_workflow_type(value: str) -> str:
    """Normalize workflow type strings for consistent mapping.

    Strips whitespace, lowercases the value and removes underscores so variants
    like 'bug_fix' or 'BugFix' map to the same key.
    """
    normalized = (value or "").strip().lower()
    return normalized.replace("_", "")


_WORKFLOW_TYPE_MAPPING: dict[str, WorkflowType] = {
    "feature": WorkflowType.FEATURE,
    "refactor": WorkflowType.REFACTOR,
    "investigation": WorkflowType.INVESTIGATION,
    "migration": WorkflowType.MIGRATION,
    "simple": WorkflowType.SIMPLE,
    "bugfix": WorkflowType.INVESTIGATION,
}


class ContextLoader:
    """Loads context files and determines workflow type."""

    def __init__(self, spec_dir: Path):
        self.spec_dir = spec_dir

    def load_context(self) -> PlannerContext:
        """Load all context files from spec directory."""
        # Read spec.md
        spec_file = self.spec_dir / "spec.md"
        spec_content = (
            spec_file.read_text(encoding="utf-8") if spec_file.exists() else ""
        )

        # Read project_index.json
        index_file = self.spec_dir / "project_index.json"
        project_index = {}
        if index_file.exists():
            try:
                with open(index_file, encoding="utf-8") as f:
                    project_index = json.load(f)
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                pass  # Use empty dict on error

        # Read context.json
        context_file = self.spec_dir / "context.json"
        task_context = {}
        if context_file.exists():
            try:
                with open(context_file, encoding="utf-8") as f:
                    task_context = json.load(f)
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                pass  # Use empty dict on error

        # Determine services involved
        services = task_context.get("scoped_services", [])
        if not services:
            services = list(project_index.get("services", {}).keys())

        # Determine workflow type from multiple sources (priority order)
        workflow_type = self._determine_workflow_type(spec_content)

        return PlannerContext(
            spec_content=spec_content,
            project_index=project_index,
            task_context=task_context,
            services_involved=services,
            workflow_type=workflow_type,
            files_to_modify=task_context.get("files_to_modify", []),
            files_to_reference=task_context.get("files_to_reference", []),
        )

    def _determine_workflow_type(self, spec_content: str) -> WorkflowType:
        """Determine workflow type from multiple sources.

        Priority order (highest to lowest):
        1. requirements.json - User's explicit intent
        2. complexity_assessment.json - AI's assessment
        3. spec.md explicit declaration - Spec writer's declaration
        4. Keyword-based detection - Last resort fallback
        """

        # 1. Check requirements.json (user's explicit intent)
        requirements_file = self.spec_dir / "requirements.json"
        if requirements_file.exists():
            try:
                with open(requirements_file, encoding="utf-8") as f:
                    requirements = json.load(f)
                declared_type = _normalize_workflow_type(
                    requirements.get("workflow_type", "")
                )
                if declared_type in _WORKFLOW_TYPE_MAPPING:
                    return _WORKFLOW_TYPE_MAPPING[declared_type]
            except (json.JSONDecodeError, KeyError):
                pass

        # 2. Check complexity_assessment.json (AI's assessment)
        assessment_file = self.spec_dir / "complexity_assessment.json"
        if assessment_file.exists():
            try:
                with open(assessment_file, encoding="utf-8") as f:
                    assessment = json.load(f)
                declared_type = _normalize_workflow_type(
                    assessment.get("workflow_type", "")
                )
                if declared_type in _WORKFLOW_TYPE_MAPPING:
                    return _WORKFLOW_TYPE_MAPPING[declared_type]
            except (json.JSONDecodeError, KeyError):
                pass

        # 3. & 4. Fall back to spec content detection
        return self._detect_workflow_type_from_spec(spec_content)

    def _detect_workflow_type_from_spec(self, spec_content: str) -> WorkflowType:
        """Detect workflow type from spec content (fallback method).

        Priority:
        1. Explicit Type: declaration in spec.md
        2. Keyword-based detection (last resort)
        """
        content_lower = spec_content.lower()

        # Check for explicit workflow type declaration in spec
        # Look for patterns like "**Type**: feature" or "Type: refactor"
        explicit_type_patterns = [
            r"\*\*type\*\*:\s*(\w+)",  # **Type**: feature
            r"type:\s*(\w+)",  # Type: feature
            r"workflow\s*type:\s*(\w+)",  # Workflow Type: feature
        ]

        for pattern in explicit_type_patterns:
            match = re.search(pattern, content_lower)
            if match:
                declared_type = _normalize_workflow_type(match.group(1))
                if declared_type in _WORKFLOW_TYPE_MAPPING:
                    return _WORKFLOW_TYPE_MAPPING[declared_type]

        # FALLBACK: Keyword-based detection (only if no explicit type found)
        # Investigation indicators
        investigation_keywords = [
            "bug",
            "fix",
            "issue",
            "broken",
            "not working",
            "investigate",
            "debug",
        ]
        if any(kw in content_lower for kw in investigation_keywords):
            # Check if it's clearly a bug investigation
            if (
                "unknown" in content_lower
                or "intermittent" in content_lower
                or "random" in content_lower
            ):
                return WorkflowType.INVESTIGATION

        # Refactor indicators - only match if the INTENT is to refactor, not incidental mentions
        # These should be in headings or task descriptions, not implementation notes
        refactor_keywords = [
            "migrate",
            "refactor",
            "convert",
            "upgrade",
            "replace",
            "move from",
            "transition",
        ]
        # Check if refactor keyword appears in a heading or workflow type context
        for line in spec_content.split("\n"):
            line_lower = line.lower().strip()
            # Only trigger on headings or explicit task descriptions
            if line_lower.startswith(("#", "**", "- [ ]", "- [x]")):
                if any(kw in line_lower for kw in refactor_keywords):
                    return WorkflowType.REFACTOR

        # Migration indicators (data)
        migration_keywords = [
            "data migration",
            "migrate data",
            "import",
            "export",
            "batch",
        ]
        if any(kw in content_lower for kw in migration_keywords):
            return WorkflowType.MIGRATION

        # Default to feature
        return WorkflowType.FEATURE

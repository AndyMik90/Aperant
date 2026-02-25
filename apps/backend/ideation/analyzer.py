"""
Project context analysis for ideation generation.

Gathers project context including:
- Tech stack
- Existing features
- Target audience
- Planned features
- Graph hints from Graphiti
"""

import json
import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from debug import (
    debug_success,
    debug_warning,
)
from graphiti_providers import get_graph_hints, is_graphiti_enabled


class ProjectAnalyzer:
    """Analyzes project context for ideation generation."""

    def __init__(
        self,
        project_dir: Path,
        output_dir: Path,
        include_roadmap_context: bool = True,
        include_kanban_context: bool = True,
    ):
        self.project_dir = Path(project_dir)
        self.output_dir = Path(output_dir)
        self.include_roadmap = include_roadmap_context
        self.include_kanban = include_kanban_context

    def gather_context(self) -> dict:
        """Gather context from project for ideation."""
        context = {
            "existing_features": [],
            "tech_stack": [],
            "target_audience": None,
            "planned_features": [],
        }

        # Get project index (from .auto-claude - the installed instance)
        project_index_path = self.project_dir / ".auto-claude" / "project_index.json"
        if project_index_path.exists():
            try:
                with open(project_index_path, encoding="utf-8") as f:
                    index = json.load(f)
                    # Extract tech stack from services
                    for service_name, service_info in index.get("services", {}).items():
                        if service_info.get("language"):
                            context["tech_stack"].append(service_info["language"])
                        if service_info.get("framework"):
                            context["tech_stack"].append(service_info["framework"])
                    context["tech_stack"] = list(set(context["tech_stack"]))
            except (json.JSONDecodeError, KeyError):
                pass

        # Get roadmap context if enabled
        if self.include_roadmap:
            roadmap_path = (
                self.project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
            )
            if roadmap_path.exists():
                try:
                    with open(roadmap_path, encoding="utf-8") as f:
                        roadmap = json.load(f)
                        # Extract planned features
                        for feature in roadmap.get("features", []):
                            context["planned_features"].append(feature.get("title", ""))
                        # Get target audience
                        audience = roadmap.get("target_audience", {})
                        context["target_audience"] = audience.get("primary")
                except (json.JSONDecodeError, KeyError):
                    pass

            # Also check discovery for audience
            discovery_path = (
                self.project_dir / ".auto-claude" / "roadmap" / "roadmap_discovery.json"
            )
            if discovery_path.exists() and not context["target_audience"]:
                try:
                    with open(discovery_path, encoding="utf-8") as f:
                        discovery = json.load(f)
                        audience = discovery.get("target_audience", {})
                        context["target_audience"] = audience.get("primary_persona")

                        # Also get existing features
                        current_state = discovery.get("current_state", {})
                        context["existing_features"] = current_state.get(
                            "existing_features", []
                        )
                except (json.JSONDecodeError, KeyError):
                    pass

        # Get kanban context if enabled
        if self.include_kanban:
            specs_dir = self.project_dir / ".auto-claude" / "specs"
            if specs_dir.exists():
                for spec_dir in specs_dir.iterdir():
                    if spec_dir.is_dir():
                        spec_file = spec_dir / "spec.md"
                        if spec_file.exists():
                            # Extract title from spec
                            content = spec_file.read_text(encoding="utf-8")
                            lines = content.split("\n")
                            for line in lines:
                                if line.startswith("# "):
                                    context["planned_features"].append(line[2:].strip())
                                    break

        # Remove duplicates from planned features
        context["planned_features"] = list(set(context["planned_features"]))

        return context

    async def get_graph_hints(self, ideation_type: str) -> list[dict]:
        """Get graph hints for a specific ideation type from Graphiti.

        This runs in parallel with ideation agents to provide historical context.
        """
        if not is_graphiti_enabled():
            return []

        # Create a query based on ideation type
        query_map = {
            "code_improvements": "code patterns, quick wins, and improvement opportunities that worked well",
            "ui_ux_improvements": "UI and UX improvements and user interface patterns",
            "documentation_gaps": "documentation improvements and common user confusion points",
            "security_hardening": "security vulnerabilities and hardening measures",
            "performance_optimizations": "performance bottlenecks and optimization techniques",
            "code_quality": "code quality improvements and refactoring patterns",
        }

        query = query_map.get(ideation_type, f"ideas for {ideation_type}")

        try:
            hints = await get_graph_hints(
                query=query,
                project_id=str(self.project_dir),
                max_results=5,
            )
            debug_success(
                "ideation_analyzer", f"Got {len(hints)} graph hints for {ideation_type}"
            )
            return hints
        except Exception as e:
            debug_warning(
                "ideation_analyzer", f"Graph hints failed for {ideation_type}: {e}"
            )
            return []

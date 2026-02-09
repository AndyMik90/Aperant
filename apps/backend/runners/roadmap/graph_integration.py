"""
Graphiti integration for retrieving graph hints during roadmap generation.
"""

from datetime import datetime
from pathlib import Path

from core.file_utils import write_json_atomic
from debug import debug, debug_error, debug_success
from graphiti_providers import get_graph_hints, is_graphiti_enabled
from ui import print_status

from .models import RoadmapPhaseResult


class GraphHintsProvider:
    """Provides graph-based hints for roadmap generation using Graphiti."""

    def __init__(self, output_dir: Path, project_dir: Path, refresh: bool = False):
        self.output_dir = output_dir
        self.project_dir = project_dir
        self.refresh = refresh
        self.hints_file = output_dir / "graph_hints.json"

    async def retrieve_hints(self) -> RoadmapPhaseResult:
        """Retrieve graph hints for roadmap generation from Graphiti (if enabled).

        This is a lightweight integration - hints are optional and cached.
        """
        debug("roadmap_graph", "Starting graph hints retrieval")

        if self.hints_file.exists() and not self.refresh:
            debug(
                "roadmap_graph",
                "graph_hints.json already exists, skipping",
                hints_file=str(self.hints_file),
            )
            print_status("graph_hints.json already exists", "success")
            return RoadmapPhaseResult(
                "graph_hints", True, [str(self.hints_file)], [], 0
            )

        if not is_graphiti_enabled():
            debug("roadmap_graph", "Graphiti not enabled, creating placeholder")
            print_status("Graphiti not enabled, skipping graph hints", "info")
            self._create_disabled_hints_file()
            return RoadmapPhaseResult(
                "graph_hints", True, [str(self.hints_file)], [], 0
            )

        debug("roadmap_graph", "Querying Graphiti for roadmap insights")
        print_status("Querying Graphiti for roadmap insights...", "progress")

        try:
            hints = await get_graph_hints(
                query="product roadmap features priorities and strategic direction",
                project_id=str(self.project_dir),
                max_results=10,
            )

            debug_success("roadmap_graph", f"Retrieved {len(hints)} graph hints")

            self._save_hints(hints)

            if hints:
                print_status(f"Retrieved {len(hints)} graph hints", "success")
            else:
                print_status("No relevant graph hints found", "info")

            return RoadmapPhaseResult(
                "graph_hints", True, [str(self.hints_file)], [], 0
            )

        except Exception as e:
            debug_error("roadmap_graph", "Graph query failed", error=str(e))
            print_status(f"Graph query failed: {e}", "warning")
            self._save_error_hints(str(e))
            return RoadmapPhaseResult(
                "graph_hints", True, [str(self.hints_file)], [str(e)], 0
            )

    def _create_disabled_hints_file(self):
        """Create a hints file indicating Graphiti is disabled."""
        write_json_atomic(
            self.hints_file,
            {
                "enabled": False,
                "reason": "Graphiti not configured",
                "hints": [],
                "created_at": datetime.now().isoformat(),
            },
        )

    def _save_hints(self, hints: list):
        """Save retrieved hints to file."""
        write_json_atomic(
            self.hints_file,
            {
                "enabled": True,
                "hints": hints,
                "hint_count": len(hints),
                "created_at": datetime.now().isoformat(),
            },
        )

    def _save_error_hints(self, error: str):
        """Save error information to hints file."""
        write_json_atomic(
            self.hints_file,
            {
                "enabled": True,
                "error": error,
                "hints": [],
                "created_at": datetime.now().isoformat(),
            },
        )

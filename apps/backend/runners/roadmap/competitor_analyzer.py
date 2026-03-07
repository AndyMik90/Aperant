"""
Competitor analysis functionality for roadmap generation.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from core.file_utils import write_json_atomic
from ui import muted, print_status

from .models import RoadmapPhaseResult

if TYPE_CHECKING:
    from .executor import AgentExecutor

MAX_RETRIES = 3


class CompetitorAnalyzer:
    """Analyzes competitors and market gaps for roadmap generation."""

    def __init__(
        self,
        output_dir: Path,
        refresh: bool,
        agent_executor: "AgentExecutor",
    ):
        self.output_dir = output_dir
        self.refresh = refresh
        self.agent_executor = agent_executor
        self.analysis_file = output_dir / "competitor_analysis.json"
        self.manual_competitors_file = output_dir / "manual_competitors.json"
        self.discovery_file = output_dir / "roadmap_discovery.json"
        self.project_index_file = output_dir / "project_index.json"

    async def analyze(self, enabled: bool = False) -> RoadmapPhaseResult:
        """Run competitor analysis to research competitors and user feedback (if enabled).

        This is an optional phase - it gracefully degrades if disabled or if analysis fails.
        Competitor insights enhance roadmap features but are not required.
        """
        if not enabled:
            print_status("Competitor analysis not enabled, skipping", "info")
            manual_competitors = self._get_manual_competitors()
            self._create_disabled_analysis_file()
            if manual_competitors:
                self._merge_manual_competitors(manual_competitors)
            return RoadmapPhaseResult(
                "competitor_analysis", True, [str(self.analysis_file)], [], 0
            )

        if self.analysis_file.exists() and not self.refresh:
            print_status("competitor_analysis.json already exists", "success")
            return RoadmapPhaseResult(
                "competitor_analysis", True, [str(self.analysis_file)], [], 0
            )

        # Preserve manual competitors before any path that overwrites the file
        manual_competitors = self._get_manual_competitors()

        if not self.discovery_file.exists():
            print_status(
                "Discovery file not found, skipping competitor analysis", "warning"
            )
            self._create_error_analysis_file(
                "Discovery file not found - cannot analyze competitors without project context"
            )
            if manual_competitors:
                self._merge_manual_competitors(manual_competitors)
            return RoadmapPhaseResult(
                "competitor_analysis",
                True,
                [str(self.analysis_file)],
                ["Discovery file not found"],
                0,
            )

        errors = []
        for attempt in range(MAX_RETRIES):
            print_status(
                f"Running competitor analysis agent (attempt {attempt + 1})...",
                "progress",
            )

            context = self._build_context()
            success, output = await self.agent_executor.run_agent(
                "competitor_analysis.md",
                additional_context=context,
            )

            if success and self.analysis_file.exists():
                validation_result = self._validate_analysis()
                if validation_result is not None:
                    if manual_competitors:
                        self._merge_manual_competitors(manual_competitors)
                    return validation_result
                errors.append(f"Attempt {attempt + 1}: Validation failed")
            else:
                errors.append(
                    f"Attempt {attempt + 1}: Agent did not create competitor analysis file"
                )

        # Graceful degradation: if all retries fail, create empty analysis and continue
        print_status(
            "Competitor analysis failed, continuing without competitor insights",
            "warning",
        )
        for err in errors:
            print(f"  {muted('Error:')} {err}")

        self._create_error_analysis_file("Analysis failed after retries", errors)
        if manual_competitors:
            self._merge_manual_competitors(manual_competitors)

        # Return success=True for graceful degradation (don't block roadmap generation)
        return RoadmapPhaseResult(
            "competitor_analysis", True, [str(self.analysis_file)], errors, MAX_RETRIES
        )

    def _get_manual_competitors(self) -> list[dict]:
        """Extract manually-added competitors from the dedicated manual file and analysis file.

        Reads from manual_competitors.json (primary, never overwritten by agent) and
        falls back to competitor_analysis.json. Deduplicates by competitor ID.
        Returns a list of competitor dicts where source == 'manual'.
        """
        competitors_by_id: dict[str, dict] = {}

        # Primary source: dedicated manual competitors file (never overwritten by agent)
        if self.manual_competitors_file.exists():
            try:
                with open(self.manual_competitors_file, encoding="utf-8") as f:
                    data = json.load(f)
                for c in data.get("competitors", []):
                    if isinstance(c, dict) and c.get("id"):
                        competitors_by_id[c["id"]] = c
            except (json.JSONDecodeError, OSError) as e:
                print_status(
                    f"Warning: could not read manual competitors file: {e}", "warning"
                )

        # Fallback: also check analysis file for manual competitors
        if self.analysis_file.exists():
            try:
                with open(self.analysis_file, encoding="utf-8") as f:
                    data = json.load(f)
                for c in data.get("competitors", []):
                    if (
                        isinstance(c, dict)
                        and c.get("source") == "manual"
                        and c.get("id")
                        and c["id"] not in competitors_by_id
                    ):
                        competitors_by_id[c["id"]] = c
            except (json.JSONDecodeError, OSError) as e:
                print_status(
                    f"Warning: could not read manual competitors from analysis: {e}",
                    "warning",
                )

        return list(competitors_by_id.values())

    def _merge_manual_competitors(self, manual_competitors: list[dict]) -> None:
        """Merge manual competitors back into the newly-generated analysis file.

        Appends manual competitors that don't already exist (by ID) in the file.
        """
        if not manual_competitors:
            return

        try:
            with open(self.analysis_file, encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print_status(f"Warning: failed to merge manual competitors: {e}", "warning")
            return

        existing_ids = {
            c.get("id") for c in data.get("competitors", []) if isinstance(c, dict)
        }

        for competitor in manual_competitors:
            if competitor.get("id") not in existing_ids:
                data.setdefault("competitors", []).append(competitor)

        write_json_atomic(self.analysis_file, data, indent=2)

    def _build_context(self) -> str:
        """Build context string for the competitor analysis agent."""
        return f"""
**Discovery File**: {self.discovery_file}
**Project Index**: {self.project_index_file}
**Output File**: {self.analysis_file}

Research competitors based on the project type and target audience from roadmap_discovery.json.
Use WebSearch to find competitors and analyze user feedback (reviews, complaints, feature requests).
Output your findings to competitor_analysis.json.
"""

    def _validate_analysis(self) -> RoadmapPhaseResult | None:
        """Validate the competitor analysis file.

        Returns RoadmapPhaseResult if validation succeeds, None otherwise.
        """
        try:
            with open(self.analysis_file, encoding="utf-8") as f:
                data = json.load(f)

            if "competitors" in data:
                competitor_count = len(data.get("competitors", []))
                pain_point_count = sum(
                    len(c.get("pain_points", [])) for c in data.get("competitors", [])
                )
                print_status(
                    f"Analyzed {competitor_count} competitors, found {pain_point_count} pain points",
                    "success",
                )
                return RoadmapPhaseResult(
                    "competitor_analysis", True, [str(self.analysis_file)], [], 0
                )

        except json.JSONDecodeError as e:
            print_status(
                f"Warning: competitor analysis file is not valid JSON: {e}",
                "warning",
            )

        return None

    def _create_disabled_analysis_file(self):
        """Create an analysis file indicating the feature is disabled."""
        write_json_atomic(
            self.analysis_file,
            {
                "enabled": False,
                "reason": "Competitor analysis not enabled by user",
                "competitors": [],
                "market_gaps": [],
                "insights_summary": {
                    "top_pain_points": [],
                    "differentiator_opportunities": [],
                    "market_trends": [],
                },
                "created_at": datetime.now().isoformat(),
            },
            indent=2,
        )

    def _create_error_analysis_file(self, error: str, errors: list[str] | None = None):
        """Create an analysis file with error information."""
        data = {
            "enabled": True,
            "error": error,
            "competitors": [],
            "market_gaps": [],
            "insights_summary": {
                "top_pain_points": [],
                "differentiator_opportunities": [],
                "market_trends": [],
            },
            "created_at": datetime.now().isoformat(),
        }
        if errors:
            data["errors"] = errors

        write_json_atomic(self.analysis_file, data, indent=2)

"""
Competitor analysis functionality for roadmap generation.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

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
        self.discovery_file = output_dir / "roadmap_discovery.json"
        self.project_index_file = output_dir / "project_index.json"

    async def analyze(self, enabled: bool = False) -> RoadmapPhaseResult:
        """Run competitor analysis to research competitors and user feedback (if enabled).

        This is an optional phase - it gracefully degrades if disabled or if analysis fails.
        Competitor insights enhance roadmap features but are not required.
        """
        if not enabled:
            print_status("Competitor analysis not enabled, skipping", "info")
            self._create_disabled_analysis_file()
            return RoadmapPhaseResult(
                "competitor_analysis", True, [str(self.analysis_file)], [], 0
            )

        if self.analysis_file.exists() and not self.refresh:
            print_status("competitor_analysis.json already exists", "success")
            return RoadmapPhaseResult(
                "competitor_analysis", True, [str(self.analysis_file)], [], 0
            )

        if not self.discovery_file.exists():
            print_status(
                "Discovery file not found, skipping competitor analysis", "warning"
            )
            self._create_error_analysis_file(
                "Discovery file not found - cannot analyze competitors without project context"
            )
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

        # Return success=True for graceful degradation (don't block roadmap generation)
        return RoadmapPhaseResult(
            "competitor_analysis", True, [str(self.analysis_file)], errors, MAX_RETRIES
        )

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

        except json.JSONDecodeError:
            pass

        return None

    def _create_disabled_analysis_file(self):
        """Create an analysis file indicating the feature is disabled."""
        with open(self.analysis_file, "w", encoding="utf-8") as f:
            json.dump(
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
                f,
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

        with open(self.analysis_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

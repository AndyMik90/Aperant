"""
Core phases for roadmap generation.
"""

import json
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from debug import (
    debug,
    debug_detailed,
    debug_error,
    debug_success,
    debug_warning,
)
from ui import print_status

from .models import RoadmapPhaseResult

if TYPE_CHECKING:
    from .executor import AgentExecutor, ScriptExecutor

MAX_RETRIES = 3


class ProjectIndexPhase:
    """Handles project index creation and validation."""

    def __init__(
        self,
        output_dir: Path,
        refresh: bool,
        script_executor: "ScriptExecutor",
    ):
        self.output_dir = output_dir
        self.refresh = refresh
        self.script_executor = script_executor
        self.project_index = output_dir / "project_index.json"
        self.auto_build_index = Path(__file__).parent.parent / "project_index.json"

    async def execute(self) -> RoadmapPhaseResult:
        """Ensure project index exists."""
        debug("roadmap_phase", "Starting phase: project_index")

        debug_detailed(
            "roadmap_phase",
            "Checking for existing project index",
            project_index=str(self.project_index),
            auto_build_index=str(self.auto_build_index),
        )

        # Check if we can copy existing index
        if self.auto_build_index.exists() and not self.project_index.exists():
            debug(
                "roadmap_phase", "Copying existing project_index.json from ac-jerry"
            )
            shutil.copy(self.auto_build_index, self.project_index)
            print_status("Copied existing project_index.json", "success")
            debug_success("roadmap_phase", "Project index copied successfully")
            return RoadmapPhaseResult(
                "project_index", True, [str(self.project_index)], [], 0
            )

        if self.project_index.exists() and not self.refresh:
            debug("roadmap_phase", "project_index.json already exists, skipping")
            print_status("project_index.json already exists", "success")
            return RoadmapPhaseResult(
                "project_index", True, [str(self.project_index)], [], 0
            )

        # Run analyzer
        debug("roadmap_phase", "Running project analyzer to create index")
        print_status("Running project analyzer...", "progress")
        success, output = self.script_executor.run_script(
            "analyzer.py", ["--output", str(self.project_index)]
        )

        if success and self.project_index.exists():
            debug_success("roadmap_phase", "Created project_index.json")
            print_status("Created project_index.json", "success")
            return RoadmapPhaseResult(
                "project_index", True, [str(self.project_index)], [], 0
            )

        debug_error(
            "roadmap_phase",
            "Failed to create project index",
            output=output[:500] if output else None,
        )
        return RoadmapPhaseResult("project_index", False, [], [output], 1)


class DiscoveryPhase:
    """Handles project discovery and audience understanding."""

    def __init__(
        self,
        output_dir: Path,
        refresh: bool,
        agent_executor: "AgentExecutor",
    ):
        self.output_dir = output_dir
        self.refresh = refresh
        self.agent_executor = agent_executor
        self.discovery_file = output_dir / "roadmap_discovery.json"
        self.project_index_file = output_dir / "project_index.json"

    async def execute(self) -> RoadmapPhaseResult:
        """Run discovery phase to understand project and audience."""
        debug("roadmap_phase", "Starting phase: discovery")

        if self.discovery_file.exists() and not self.refresh:
            debug("roadmap_phase", "roadmap_discovery.json already exists, skipping")
            print_status("roadmap_discovery.json already exists", "success")
            return RoadmapPhaseResult(
                "discovery", True, [str(self.discovery_file)], [], 0
            )

        errors = []
        for attempt in range(MAX_RETRIES):
            debug("roadmap_phase", f"Discovery attempt {attempt + 1}/{MAX_RETRIES}")
            print_status(
                f"Running discovery agent (attempt {attempt + 1})...", "progress"
            )

            context = self._build_context()
            success, output = await self.agent_executor.run_agent(
                "roadmap_discovery.md",
                additional_context=context,
            )

            if success and self.discovery_file.exists():
                validation_result = self._validate_discovery(attempt)
                if validation_result is not None:
                    return validation_result
                errors.append(f"Validation failed on attempt {attempt + 1}")
            else:
                debug_warning(
                    "roadmap_phase",
                    f"Discovery attempt {attempt + 1} failed - file not created",
                )
                errors.append(
                    f"Attempt {attempt + 1}: Agent did not create discovery file"
                )

        debug_error(
            "roadmap_phase", "Discovery phase failed after all retries", errors=errors
        )
        return RoadmapPhaseResult("discovery", False, [], errors, MAX_RETRIES)

    def _build_context(self) -> str:
        """Build context string for the discovery agent."""
        return f"""
**Project Index**: {self.project_index_file}
**Output Directory**: {self.output_dir}
**Output File**: {self.discovery_file}

IMPORTANT: This runs NON-INTERACTIVELY. Do NOT ask questions or wait for user input.

Your task:
1. Analyze the project (read README, code structure, git history)
2. Infer target audience, vision, and constraints from your analysis
3. IMMEDIATELY create {self.discovery_file} with your findings

Do NOT ask questions. Make educated inferences and create the file.
"""

    def _validate_discovery(self, attempt: int) -> RoadmapPhaseResult | None:
        """Validate the discovery file.

        Returns RoadmapPhaseResult if validation succeeds, None otherwise.
        """
        try:
            with open(self.discovery_file) as f:
                data = json.load(f)

            required = ["project_name", "target_audience", "product_vision"]
            missing = [k for k in required if k not in data]

            if not missing:
                debug_success(
                    "roadmap_phase",
                    "Created valid roadmap_discovery.json",
                    attempt=attempt + 1,
                )
                print_status("Created valid roadmap_discovery.json", "success")
                return RoadmapPhaseResult(
                    "discovery", True, [str(self.discovery_file)], [], attempt
                )
            else:
                debug_warning("roadmap_phase", f"Missing required fields: {missing}")
                return None

        except json.JSONDecodeError as e:
            debug_error("roadmap_phase", "Invalid JSON in discovery file", error=str(e))
            return None


class FeaturesPhase:
    """Handles feature generation and prioritization."""

    def __init__(
        self,
        output_dir: Path,
        refresh: bool,
        agent_executor: "AgentExecutor",
    ):
        self.output_dir = output_dir
        self.refresh = refresh
        self.agent_executor = agent_executor
        self.roadmap_file = output_dir / "roadmap.json"
        self.discovery_file = output_dir / "roadmap_discovery.json"
        self.project_index_file = output_dir / "project_index.json"

    async def execute(self) -> RoadmapPhaseResult:
        """Generate and prioritize features for the roadmap."""
        debug("roadmap_phase", "Starting phase: features")

        if not self.discovery_file.exists():
            debug_error(
                "roadmap_phase",
                "Discovery file not found - cannot generate features",
                discovery_file=str(self.discovery_file),
            )
            return RoadmapPhaseResult(
                "features", False, [], ["Discovery file not found"], 0
            )

        if self.roadmap_file.exists() and not self.refresh:
            debug("roadmap_phase", "roadmap.json already exists, skipping")
            print_status("roadmap.json already exists", "success")
            return RoadmapPhaseResult("features", True, [str(self.roadmap_file)], [], 0)

        errors = []
        for attempt in range(MAX_RETRIES):
            debug("roadmap_phase", f"Features attempt {attempt + 1}/{MAX_RETRIES}")
            print_status(
                f"Running feature generation agent (attempt {attempt + 1})...",
                "progress",
            )

            context = self._build_context()
            success, output = await self.agent_executor.run_agent(
                "roadmap_features.md",
                additional_context=context,
            )

            if success and self.roadmap_file.exists():
                validation_result = self._validate_features(attempt)
                if validation_result is not None:
                    return validation_result
                errors.append(f"Validation failed on attempt {attempt + 1}")
            else:
                debug_warning(
                    "roadmap_phase",
                    f"Features attempt {attempt + 1} failed - file not created",
                )
                errors.append(
                    f"Attempt {attempt + 1}: Agent did not create roadmap file"
                )

        debug_error(
            "roadmap_phase", "Features phase failed after all retries", errors=errors
        )
        return RoadmapPhaseResult("features", False, [], errors, MAX_RETRIES)

    def _build_context(self) -> str:
        """Build context string for the features agent."""
        return f"""
**Discovery File**: {self.discovery_file}
**Project Index**: {self.project_index_file}
**Output File**: {self.roadmap_file}

Based on the discovery data:
1. Generate features that address user pain points
2. Prioritize using MoSCoW framework
3. Organize into phases
4. Create milestones
5. Map dependencies

Output the complete roadmap to roadmap.json.
"""

    def _validate_features(self, attempt: int) -> RoadmapPhaseResult | None:
        """Validate the roadmap features file.

        Returns RoadmapPhaseResult if validation succeeds, None otherwise.
        """
        try:
            with open(self.roadmap_file) as f:
                data = json.load(f)

            required = ["phases", "features", "vision", "target_audience"]
            missing = [k for k in required if k not in data]
            feature_count = len(data.get("features", []))

            # Validate target_audience structure with type checking
            target_audience = data.get("target_audience", {})
            if not isinstance(target_audience, dict):
                debug_warning(
                    "roadmap_phase",
                    f"Invalid target_audience type: expected dict, got {type(target_audience).__name__}",
                )
                missing.append("target_audience (invalid type)")
            elif not target_audience.get("primary"):
                missing.append("target_audience.primary")

            debug_detailed(
                "roadmap_phase",
                "Validating roadmap.json",
                missing_fields=missing,
                feature_count=feature_count,
            )

            if not missing and feature_count >= 3:
                debug_success(
                    "roadmap_phase",
                    "Created valid roadmap.json",
                    attempt=attempt + 1,
                    feature_count=feature_count,
                )
                print_status("Created valid roadmap.json", "success")
                return RoadmapPhaseResult(
                    "features", True, [str(self.roadmap_file)], [], attempt
                )
            else:
                if missing:
                    debug_warning(
                        "roadmap_phase", f"Missing required fields: {missing}"
                    )
                else:
                    debug_warning(
                        "roadmap_phase",
                        f"Roadmap has only {feature_count} features (min 3)",
                    )
                return None

        except json.JSONDecodeError as e:
            debug_error("roadmap_phase", "Invalid JSON in roadmap file", error=str(e))
            return None

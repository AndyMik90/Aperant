"""
Ideation Runner - Main orchestration logic.

Orchestrates the ideation creation process through multiple phases:
1. Project Index - Analyze project structure
2. Context & Graph Hints - Gather context in parallel
3. Ideation Generation - Generate ideas in parallel
4. Merge - Combine all outputs
"""

import asyncio
import json
import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from debug import debug, debug_section
from ui import Icons, box, icon, muted, print_section, print_status

from .config import IdeationConfigManager
from .generator import IDEATION_TYPE_LABELS
from .output_streamer import OutputStreamer
from .phase_executor import PhaseExecutor
from .project_index_phase import ProjectIndexPhase
from .types import IdeationPhaseResult

# Configuration
MAX_RETRIES = 3
IDEATION_TIMEOUT_SECONDS = 5 * 60  # 5 minutes max for all ideation types


class IdeationOrchestrator:
    """Orchestrates the ideation creation process."""

    def __init__(
        self,
        project_dir: Path,
        output_dir: Path | None = None,
        enabled_types: list[str] | None = None,
        include_roadmap_context: bool = True,
        include_kanban_context: bool = True,
        max_ideas_per_type: int = 5,
        model: str = "sonnet",  # Changed from "opus" (fix #433)
        thinking_level: str = "medium",
        refresh: bool = False,
        append: bool = False,
        fast_mode: bool = False,
    ):
        """Initialize the ideation orchestrator.

        Args:
            project_dir: Project directory to analyze
            output_dir: Output directory for ideation files (defaults to .auto-claude/ideation)
            enabled_types: List of ideation types to generate (defaults to all)
            include_roadmap_context: Include roadmap files in analysis
            include_kanban_context: Include kanban board in analysis
            max_ideas_per_type: Maximum ideas to generate per type
            model: Claude model to use
            thinking_level: Thinking level for extended reasoning
            refresh: Force regeneration of existing files
            append: Preserve existing ideas when merging
            fast_mode: Enable Fast Mode for faster Opus 4.6 output
        """
        # Initialize configuration manager
        self.config_manager = IdeationConfigManager(
            project_dir=project_dir,
            output_dir=output_dir,
            enabled_types=enabled_types,
            include_roadmap_context=include_roadmap_context,
            include_kanban_context=include_kanban_context,
            max_ideas_per_type=max_ideas_per_type,
            model=model,
            thinking_level=thinking_level,
            refresh=refresh,
            append=append,
            fast_mode=fast_mode,
        )

        # Expose configuration for convenience
        self.project_dir = self.config_manager.project_dir
        self.output_dir = self.config_manager.output_dir
        self.model = self.config_manager.model
        self.refresh = self.config_manager.refresh
        self.append = self.config_manager.append
        self.enabled_types = self.config_manager.enabled_types
        self.max_ideas_per_type = self.config_manager.max_ideas_per_type

        # Initialize phase executor
        self.phase_executor = PhaseExecutor(
            output_dir=self.output_dir,
            generator=self.config_manager.generator,
            analyzer=self.config_manager.analyzer,
            prioritizer=self.config_manager.prioritizer,
            formatter=self.config_manager.formatter,
            enabled_types=self.enabled_types,
            max_ideas_per_type=self.max_ideas_per_type,
            refresh=self.refresh,
            append=self.append,
        )

        # Initialize project index phase
        self.project_index_phase = ProjectIndexPhase(
            self.project_dir, self.output_dir, self.refresh
        )

        # Initialize output streamer
        self.output_streamer = OutputStreamer()

    async def run(self) -> bool:
        """Run the complete ideation generation process.

        Returns:
            True if successful, False otherwise
        """
        debug_section("ideation_runner", "Starting Ideation Generation")
        debug(
            "ideation_runner",
            "Configuration",
            project_dir=str(self.project_dir),
            output_dir=str(self.output_dir),
            model=self.model,
            enabled_types=self.enabled_types,
            refresh=self.refresh,
            append=self.append,
        )

        print(
            box(
                f"Project: {self.project_dir}\n"
                f"Output: {self.output_dir}\n"
                f"Model: {self.model}\n"
                f"Types: {', '.join(self.enabled_types)}",
                title="IDEATION GENERATOR",
                style="heavy",
            )
        )

        results = []

        # Phase 1: Project Index
        debug("ideation_runner", "Starting Phase 1: Project Analysis")
        print_section("PHASE 1: PROJECT ANALYSIS", Icons.FOLDER)
        result = await self.project_index_phase.execute()
        results.append(result)
        if not result.success:
            print_status("Project analysis failed", "error")
            return False

        # Phase 2: Context & Graph Hints (in parallel)
        print_section("PHASE 2: CONTEXT & GRAPH HINTS (PARALLEL)", Icons.SEARCH)

        # Run context gathering and graph hints in parallel
        context_task = self.phase_executor.execute_context()
        hints_task = self.phase_executor.execute_graph_hints()
        context_result, hints_result = await asyncio.gather(context_task, hints_task)

        results.append(hints_result)
        results.append(context_result)

        if not context_result.success:
            print_status("Context gathering failed", "error")
            return False
        # Note: hints_result.success is always True (graceful degradation)

        # Phase 3: Run all ideation types IN PARALLEL
        debug(
            "ideation_runner",
            "Starting Phase 3: Generating Ideas",
            types=self.enabled_types,
            parallel=True,
        )
        print_section("PHASE 3: GENERATING IDEAS (PARALLEL)", Icons.SUBTASK)
        print_status(
            f"Starting {len(self.enabled_types)} ideation agents in parallel...",
            "progress",
        )

        # Create tasks explicitly so we can cancel them on timeout
        ideation_task_objs = [
            asyncio.create_task(
                self.output_streamer.stream_ideation_result(
                    ideation_type, self.phase_executor, MAX_RETRIES
                )
            )
            for ideation_type in self.enabled_types
        ]

        # Run all ideation types concurrently with timeout protection
        # 5 minute timeout prevents infinite hangs if one type stalls
        try:
            ideation_results = await asyncio.wait_for(
                asyncio.gather(*ideation_task_objs, return_exceptions=True),
                timeout=IDEATION_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            print_status(
                "Ideation generation timed out after 5 minutes",
                "error",
            )
            # Cancel all pending tasks to prevent resource leaks
            for task in ideation_task_objs:
                if not task.done():
                    task.cancel()
            # Wait for cancellation to complete and preserve results from completed tasks
            # Tasks that finished before timeout will return their results;
            # cancelled tasks will return CancelledError
            results_after_cancel = await asyncio.gather(
                *ideation_task_objs, return_exceptions=True
            )
            # Convert CancelledError to timeout exception, preserve completed results
            ideation_results = [
                Exception("Ideation timed out")
                if isinstance(res, asyncio.CancelledError)
                else res
                for res in results_after_cancel
            ]

        # Process results
        for i, result in enumerate(ideation_results):
            ideation_type = self.enabled_types[i]
            if isinstance(result, Exception):
                print_status(
                    f"{IDEATION_TYPE_LABELS[ideation_type]} ideation failed with exception: {result}",
                    "error",
                )
                results.append(
                    IdeationPhaseResult(
                        phase="ideation",
                        ideation_type=ideation_type,
                        success=False,
                        output_files=[],
                        ideas_count=0,
                        errors=[str(result)],
                        retries=0,
                    )
                )
            else:
                results.append(result)
                if result.success:
                    print_status(
                        f"{IDEATION_TYPE_LABELS[ideation_type]}: {result.ideas_count} ideas",
                        "success",
                    )
                else:
                    print_status(
                        f"{IDEATION_TYPE_LABELS[ideation_type]} ideation failed",
                        "warning",
                    )
                    for err in result.errors:
                        print(f"  {muted('Error:')} {err}")

        # Final Phase: Merge
        print_section("PHASE 4: MERGE & FINALIZE", Icons.SUCCESS)
        result = await self.phase_executor.execute_merge()
        results.append(result)

        # Summary
        self._print_summary()

        return True

    def _print_summary(self) -> None:
        """Print summary of ideation generation results."""
        ideation_file = self.output_dir / "ideation.json"
        if ideation_file.exists():
            with open(ideation_file, encoding="utf-8") as f:
                ideation = json.load(f)

            ideas = ideation.get("ideas", [])
            summary = ideation.get("summary", {})
            by_type = summary.get("by_type", {})

            print(
                box(
                    f"Total Ideas: {len(ideas)}\n\n"
                    f"By Type:\n"
                    + "\n".join(
                        f"  {icon(Icons.ARROW_RIGHT)} {IDEATION_TYPE_LABELS.get(t, t)}: {c}"
                        for t, c in by_type.items()
                    )
                    + f"\n\nIdeation saved to: {ideation_file}",
                    title=f"{icon(Icons.SUCCESS)} IDEATION COMPLETE",
                    style="heavy",
                )
            )

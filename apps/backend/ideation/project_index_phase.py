"""
Project index phase execution.

Handles the project indexing phase which analyzes project structure
and creates a comprehensive index of the codebase.
"""

import shutil
from pathlib import Path

from ui import print_status

from .script_runner import ScriptRunner
from .types import IdeationPhaseResult


class ProjectIndexPhase:
    """Executes the project indexing phase."""

    def __init__(self, project_dir: Path, output_dir: Path, refresh: bool = False):
        """Initialize the project index phase.

        Args:
            project_dir: Project directory to analyze
            output_dir: Output directory for ideation files
            refresh: Force regeneration of existing index
        """
        self.project_dir = project_dir
        self.output_dir = output_dir
        self.refresh = refresh
        self.script_runner = ScriptRunner(project_dir)

    async def execute(self) -> IdeationPhaseResult:
        """Ensure project index exists.

        Returns:
            IdeationPhaseResult with project index data
        """
        project_index = self.output_dir / "project_index.json"
        auto_build_index = self.project_dir / ".ac.jerry" / "project_index.json"

        # Check if we can copy existing index
        if auto_build_index.exists():
            shutil.copy(auto_build_index, project_index)
            print_status("Copied existing project_index.json", "success")
            return IdeationPhaseResult(
                "project_index", None, True, [str(project_index)], 0, [], 0
            )

        if project_index.exists() and not self.refresh:
            print_status("project_index.json already exists", "success")
            return IdeationPhaseResult(
                "project_index", None, True, [str(project_index)], 0, [], 0
            )

        # Run analyzer
        print_status("Running project analyzer...", "progress")
        success, output = self.script_runner.run_script(
            "analyzer.py", ["--output", str(project_index)]
        )

        if success and project_index.exists():
            print_status("Created project_index.json", "success")
            return IdeationPhaseResult(
                "project_index", None, True, [str(project_index)], 0, [], 0
            )

        return IdeationPhaseResult("project_index", None, False, [], 0, [output], 1)

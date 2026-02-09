"""
Configuration management for ideation generation.

Handles initialization of directories, component setup, and configuration validation.
"""

from pathlib import Path

from init import init_auto_claude_dir

from .analyzer import ProjectAnalyzer
from .formatter import IdeationFormatter
from .generator import IDEATION_TYPES, IdeationGenerator
from .prioritizer import IdeaPrioritizer


class IdeationConfigManager:
    """Manages configuration and initialization for ideation generation."""

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
        """Initialize configuration manager.

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
        """
        self.project_dir = Path(project_dir)
        self.model = model
        self.thinking_level = thinking_level
        self.refresh = refresh
        self.append = append
        self.enabled_types = enabled_types or IDEATION_TYPES.copy()
        self.include_roadmap_context = include_roadmap_context
        self.include_kanban_context = include_kanban_context
        self.max_ideas_per_type = max_ideas_per_type

        # Setup output directory
        self.output_dir = self._setup_output_dir(output_dir)

        # Initialize components
        self.generator = IdeationGenerator(
            self.project_dir,
            self.output_dir,
            self.model,
            self.thinking_level,
            self.max_ideas_per_type,
            fast_mode=fast_mode,
        )
        self.analyzer = ProjectAnalyzer(
            self.project_dir,
            self.output_dir,
            self.include_roadmap_context,
            self.include_kanban_context,
        )
        self.prioritizer = IdeaPrioritizer(self.output_dir)
        self.formatter = IdeationFormatter(self.output_dir, self.project_dir)

    def _setup_output_dir(self, output_dir: Path | None) -> Path:
        """Setup and create output directory structure.

        Args:
            output_dir: Optional custom output directory

        Returns:
            Path to output directory
        """
        if output_dir:
            out_dir = Path(output_dir)
        else:
            # Initialize .auto-claude directory and ensure it's in .gitignore
            init_auto_claude_dir(self.project_dir)
            out_dir = self.project_dir / ".auto-claude" / "ideation"

        out_dir.mkdir(parents=True, exist_ok=True)

        # Create screenshots directory for UI/UX analysis
        (out_dir / "screenshots").mkdir(exist_ok=True)

        return out_dir

#!/usr/bin/env python3
"""
Roadmap Creation Orchestrator
=============================

AI-powered roadmap generation for projects.
Analyzes project structure, understands target audience, and generates
a strategic feature roadmap.

Usage:
    cd apps/backend
    python runners/roadmap_runner.py --project /path/to/project
    python runners/roadmap_runner.py --project /path/to/project --refresh
    python runners/roadmap_runner.py --project /path/to/project --output roadmap.json
"""

import asyncio
import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Validate platform-specific dependencies BEFORE any imports that might
# trigger graphiti_core -> real_ladybug -> pywintypes import chain (ACS-253)
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file with centralized error handling
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

from debug import debug, debug_error, debug_warning

# Import from refactored roadmap package (now a subpackage of runners)
from runners.roadmap import RoadmapOrchestrator


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="AI-powered roadmap generation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--project",
        type=Path,
        default=Path.cwd(),
        help="Project directory (default: current directory)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output directory for roadmap files (default: project/auto-claude/roadmap)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="sonnet",  # Changed from "opus" (fix #433)
        help="Model to use (haiku, sonnet, opus, or full model ID)",
    )
    parser.add_argument(
        "--thinking-level",
        type=str,
        default="medium",
        choices=["none", "low", "medium", "high", "ultrathink"],
        help="Thinking level for extended reasoning (default: medium)",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Force regeneration even if roadmap exists",
    )
    parser.add_argument(
        "--competitor-analysis",
        action="store_true",
        dest="enable_competitor_analysis",
        help="Enable competitor analysis phase",
    )
    parser.add_argument(
        "--refresh-competitor-analysis",
        action="store_true",
        dest="refresh_competitor_analysis",
        help="Force refresh competitor analysis even if it exists (requires --competitor-analysis)",
    )
    parser.add_argument(
        "--language",
        type=str,
        default="en",
        help="Output language for generated content (en, zh-CN, fr, etc.)",
    )

    args = parser.parse_args()

    debug(
        "roadmap_runner",
        "CLI invoked",
        project=str(args.project),
        output=str(args.output) if args.output else None,
        model=args.model,
        refresh=args.refresh,
    )

    # Validate project directory
    project_dir = args.project.resolve()
    if not project_dir.exists():
        debug_error(
            "roadmap_runner",
            "Project directory does not exist",
            project_dir=str(project_dir),
        )
        print(f"Error: Project directory does not exist: {project_dir}")
        sys.exit(1)

    debug(
        "roadmap_runner", "Creating RoadmapOrchestrator", project_dir=str(project_dir)
    )

    orchestrator = RoadmapOrchestrator(
        project_dir=project_dir,
        output_dir=args.output,
        model=args.model,
        thinking_level=args.thinking_level,
        refresh=args.refresh,
        enable_competitor_analysis=args.enable_competitor_analysis,
        refresh_competitor_analysis=args.refresh_competitor_analysis,
        language=args.language,
    )

    try:
        success = asyncio.run(orchestrator.run())
        debug("roadmap_runner", "Roadmap generation finished", success=success)
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        debug_warning("roadmap_runner", "Roadmap generation interrupted by user")
        print("\n\nRoadmap generation interrupted.")
        sys.exit(1)


if __name__ == "__main__":
    main()

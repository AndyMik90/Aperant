#!/usr/bin/env python3
"""
Ideation Creation Orchestrator (Facade)
========================================

This is a facade that maintains backward compatibility with the original
ideation_runner.py interface while delegating to the refactored modular
components in the ideation/ package.

AI-powered ideation generation for projects.
Analyzes project context, existing features, and generates three types of ideas:
1. Low-Hanging Fruit - Quick wins building on existing patterns
2. UI/UX Improvements - Visual and interaction enhancements
3. High-Value Features - Strategic features for target users

Usage:
    python auto-claude/ideation_runner.py --project /path/to/project
    python auto-claude/ideation_runner.py --project /path/to/project --types low_hanging_fruit,high_value_features
    python auto-claude/ideation_runner.py --project /path/to/project --refresh
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

# Import from refactored modules
from ideation import (
    IdeationConfig,
    IdeationOrchestrator,
    IdeationPhaseResult,
)
from ideation.generator import IDEATION_TYPE_LABELS, IDEATION_TYPES
from phase_config import sanitize_thinking_level

# Re-export for backward compatibility
__all__ = [
    "IdeationOrchestrator",
    "IdeationConfig",
    "IdeationPhaseResult",
    "IDEATION_TYPES",
    "IDEATION_TYPE_LABELS",
]


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="AI-powered ideation generation",
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
        help="Output directory for ideation files (default: project/auto-claude/ideation)",
    )
    parser.add_argument(
        "--types",
        type=str,
        help=f"Comma-separated ideation types to run (options: {','.join(IDEATION_TYPES)})",
    )
    parser.add_argument(
        "--no-roadmap",
        action="store_true",
        help="Don't include roadmap context",
    )
    parser.add_argument(
        "--no-kanban",
        action="store_true",
        help="Don't include kanban context",
    )
    parser.add_argument(
        "--max-ideas",
        type=int,
        default=5,
        help="Maximum ideas per type (default: 5)",
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
        help="Thinking level for extended reasoning (low, medium, high)",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Force regeneration even if ideation exists",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append new ideas to existing session instead of replacing",
    )
    parser.add_argument(
        "--fast-mode",
        action="store_true",
        help="Enable Fast Mode for faster Opus 4.6 output",
    )

    args = parser.parse_args()

    # Validate and sanitize thinking level (handles legacy values like 'ultrathink')
    args.thinking_level = sanitize_thinking_level(args.thinking_level)

    # Validate project directory
    project_dir = args.project.resolve()
    if not project_dir.exists():
        print(f"Error: Project directory does not exist: {project_dir}")
        sys.exit(1)

    # Parse types
    enabled_types = None
    if args.types:
        enabled_types = [t.strip() for t in args.types.split(",")]
        invalid_types = [t for t in enabled_types if t not in IDEATION_TYPES]
        if invalid_types:
            print(f"Error: Invalid ideation types: {invalid_types}")
            print(f"Valid types: {IDEATION_TYPES}")
            sys.exit(1)

    orchestrator = IdeationOrchestrator(
        project_dir=project_dir,
        output_dir=args.output,
        enabled_types=enabled_types,
        include_roadmap_context=not args.no_roadmap,
        include_kanban_context=not args.no_kanban,
        max_ideas_per_type=args.max_ideas,
        model=args.model,
        thinking_level=args.thinking_level,
        refresh=args.refresh,
        append=args.append,
        fast_mode=args.fast_mode,
    )

    try:
        success = asyncio.run(orchestrator.run())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nIdeation generation interrupted.")
        sys.exit(1)


if __name__ == "__main__":
    main()

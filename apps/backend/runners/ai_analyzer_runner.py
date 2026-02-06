#!/usr/bin/env python3
"""
AI-Enhanced Project Analyzer - CLI Entry Point

Runs AI analysis to extract deep insights after programmatic analysis.
Uses Claude Agent SDK for intelligent codebase understanding.

Example:
    # Run full analysis
    python ai_analyzer_runner.py --project-dir /path/to/project

    # Run specific analyzers only
    python ai_analyzer_runner.py --analyzers security performance

    # Skip cache
    python ai_analyzer_runner.py --skip-cache
"""

import asyncio
import json
from pathlib import Path


def main() -> int:
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="AI-Enhanced Project Analyzer")
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Project directory to analyze",
    )
    parser.add_argument(
        "--index",
        type=str,
        default="comprehensive_analysis.json",
        help="Path to programmatic analysis JSON",
    )
    parser.add_argument(
        "--skip-cache", action="store_true", help="Skip cached results and re-analyze"
    )
    parser.add_argument(
        "--analyzers",
        nargs="+",
        help="Run only specific analyzers (code_relationships, business_logic, etc.)",
    )

    args = parser.parse_args()

    # Load programmatic analysis
    index_path = args.project_dir / args.index
    if not index_path.exists():
        print(f"✗ Error: Programmatic analysis not found: {index_path}")
        print(f"Run: python analyzer.py --project-dir {args.project_dir} --index")
        return 1

    project_index = json.loads(index_path.read_text(encoding="utf-8"))

    # Import here to avoid import errors if dependencies are missing
    try:
        from ai_analyzer import AIAnalyzerRunner
    except ImportError as e:
        print(f"✗ Error: Failed to import AI analyzer: {e}")
        print("Make sure all dependencies are installed.")
        return 1

    # Create and run analyzer
    analyzer = AIAnalyzerRunner(args.project_dir, project_index)

    # Run async analysis
    insights = asyncio.run(
        analyzer.run_full_analysis(
            skip_cache=args.skip_cache, selected_analyzers=args.analyzers
        )
    )

    # Print summary
    analyzer.print_summary(insights)

    return 0


if __name__ == "__main__":
    exit(main())

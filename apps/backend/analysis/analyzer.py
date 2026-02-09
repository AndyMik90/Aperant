#!/usr/bin/env python3
"""
Codebase Analyzer
=================

Automatically detects project structure, frameworks, and services.
Supports monorepos with multiple services.

Usage:
    # Index entire project (creates project_index.json)
    python ac-jerry/analyzer.py --index

    # Analyze specific service
    python ac-jerry/analyzer.py --service backend

    # Output to specific file
    python ac-jerry/analyzer.py --index --output path/to/output.json

The analyzer will:
1. Detect if this is a monorepo or single project
2. Find all services/packages and analyze each separately
3. Map interdependencies between services
4. Identify infrastructure (Docker, CI/CD)
5. Document conventions (linting, testing)

This module now serves as a facade to the modular analyzer system in the analyzers/ package.
All actual implementation is in focused submodules for better maintainability.
"""

from __future__ import annotations

import json
from pathlib import Path

# Import from the new modular structure
from .analyzers import (
    ProjectAnalyzer,
    ServiceAnalyzer,
    analyze_project,
    analyze_service,
)

# Re-export for backward compatibility
__all__ = [
    "ServiceAnalyzer",
    "ProjectAnalyzer",
    "analyze_project",
    "analyze_service",
]


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Analyze project structure, frameworks, and services"
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Project directory to analyze (default: current directory)",
    )
    parser.add_argument(
        "--index",
        action="store_true",
        help="Create full project index (default behavior)",
    )
    parser.add_argument(
        "--service",
        type=str,
        default=None,
        help="Analyze a specific service only",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output file for JSON results",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only output JSON, no status messages",
    )

    args = parser.parse_args()

    # Determine what to analyze
    if args.service:
        results = analyze_service(args.project_dir, args.service, args.output)
    else:
        results = analyze_project(args.project_dir, args.output)

    # Print results
    if not args.quiet or not args.output:
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

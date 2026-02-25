#!/usr/bin/env python3
"""
Task Context Builder
====================

Builds focused context for a specific task by searching relevant services.
This is the "RAG-like" component that finds what files matter for THIS task.

Usage:
    # Find context for a task across specific services
    python auto-claude/context.py \
        --services backend,scraper \
        --keywords "retry,error,proxy" \
        --task "Add retry logic when proxies fail" \
        --output auto-claude/specs/001-retry/context.json

    # Use project index to auto-suggest services
    python auto-claude/context.py \
        --task "Add retry logic when proxies fail" \
        --output context.json

The context builder will:
1. Load project index (from analyzer)
2. Search specified services for relevant files
3. Find similar implementations to reference
4. Output focused context for AI agents
"""

import json
from pathlib import Path

from context import (
    ContextBuilder,
    FileMatch,
    TaskContext,
)
from context.serialization import serialize_context

# Backward compatibility exports
__all__ = [
    "ContextBuilder",
    "FileMatch",
    "TaskContext",
    "build_task_context",
]


def build_task_context(
    project_dir: Path,
    task: str,
    services: list[str] | None = None,
    keywords: list[str] | None = None,
    output_file: Path | None = None,
) -> dict:
    """
    Build context for a task and optionally save to file.

    Args:
        project_dir: Path to project root
        task: Task description
        services: Services to search (None = auto-detect)
        keywords: Keywords to search for (None = extract from task)
        output_file: Optional path to save JSON output

    Returns:
        Context as a dictionary
    """
    builder = ContextBuilder(project_dir)
    context = builder.build_context(task, services, keywords)

    result = serialize_context(context)

    if output_file:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(f"Task context saved to: {output_file}")

    return result


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Build task-specific context by searching the codebase"
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Project directory (default: current directory)",
    )
    parser.add_argument(
        "--task",
        type=str,
        required=True,
        help="Description of the task",
    )
    parser.add_argument(
        "--services",
        type=str,
        default=None,
        help="Comma-separated list of services to search",
    )
    parser.add_argument(
        "--keywords",
        type=str,
        default=None,
        help="Comma-separated list of keywords to search for",
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

    # Parse comma-separated args
    services = args.services.split(",") if args.services else None
    keywords = args.keywords.split(",") if args.keywords else None

    result = build_task_context(
        args.project_dir,
        args.task,
        services,
        keywords,
        args.output,
    )

    if not args.quiet or not args.output:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

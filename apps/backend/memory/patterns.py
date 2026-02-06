#!/usr/bin/env python3
"""
Patterns and Gotchas Management
================================

Functions for managing code patterns and gotchas (pitfalls to avoid).
"""

import logging
from pathlib import Path

from .graphiti_helpers import get_graphiti_memory, is_graphiti_memory_enabled, run_async
from .paths import get_memory_dir

logger = logging.getLogger(__name__)


def append_gotcha(spec_dir: Path, gotcha: str) -> None:
    """
    Append a gotcha (pitfall to avoid) to the gotchas list.

    Gotchas are deduplicated - if the same gotcha already exists,
    it won't be added again.

    Args:
        spec_dir: Path to spec directory
        gotcha: Description of the pitfall to avoid

    Example:
        append_gotcha(spec_dir, "Database connections must be closed in workers")
        append_gotcha(spec_dir, "API rate limits: 100 req/min per IP")
    """
    memory_dir = get_memory_dir(spec_dir)
    gotchas_file = memory_dir / "gotchas.md"

    # Load existing gotchas
    existing_gotchas = set()
    if gotchas_file.exists():
        content = gotchas_file.read_text(encoding="utf-8")
        # Extract bullet points
        for line in content.split("\n"):
            line = line.strip()
            if line.startswith("- "):
                existing_gotchas.add(line[2:].strip())

    # Add new gotcha if not duplicate
    gotcha_stripped = gotcha.strip()
    if gotcha_stripped and gotcha_stripped not in existing_gotchas:
        # Append to file
        with open(gotchas_file, "a", encoding="utf-8") as f:
            if gotchas_file.stat().st_size == 0:
                # First entry - add header
                f.write("# Gotchas and Pitfalls\n\n")
                f.write("Things to watch out for in this codebase:\n\n")
            f.write(f"- {gotcha_stripped}\n")

        # Also save to Graphiti if enabled
        if is_graphiti_memory_enabled():
            try:
                graphiti = run_async(get_graphiti_memory(spec_dir))
                if graphiti:
                    run_async(graphiti.save_gotcha(gotcha_stripped))
                    run_async(graphiti.close())
            except Exception as e:
                logger.warning(f"Graphiti gotcha save failed: {e}")


def load_gotchas(spec_dir: Path) -> list[str]:
    """
    Load all gotchas.

    Args:
        spec_dir: Path to spec directory

    Returns:
        List of gotcha strings
    """
    memory_dir = get_memory_dir(spec_dir)
    gotchas_file = memory_dir / "gotchas.md"

    if not gotchas_file.exists():
        return []

    content = gotchas_file.read_text(encoding="utf-8")
    gotchas = []

    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("- "):
            gotchas.append(line[2:].strip())

    return gotchas


def append_pattern(spec_dir: Path, pattern: str) -> None:
    """
    Append a code pattern to follow.

    Patterns are deduplicated - if the same pattern already exists,
    it won't be added again.

    Args:
        spec_dir: Path to spec directory
        pattern: Description of the code pattern

    Example:
        append_pattern(spec_dir, "Use try/except with specific exceptions")
        append_pattern(spec_dir, "All API responses use {success: bool, data: any, error: string}")
    """
    memory_dir = get_memory_dir(spec_dir)
    patterns_file = memory_dir / "patterns.md"

    # Load existing patterns
    existing_patterns = set()
    if patterns_file.exists():
        content = patterns_file.read_text(encoding="utf-8")
        # Extract bullet points
        for line in content.split("\n"):
            line = line.strip()
            if line.startswith("- "):
                existing_patterns.add(line[2:].strip())

    # Add new pattern if not duplicate
    pattern_stripped = pattern.strip()
    if pattern_stripped and pattern_stripped not in existing_patterns:
        # Append to file
        with open(patterns_file, "a", encoding="utf-8") as f:
            if patterns_file.stat().st_size == 0:
                # First entry - add header
                f.write("# Code Patterns\n\n")
                f.write("Established patterns to follow in this codebase:\n\n")
            f.write(f"- {pattern_stripped}\n")

        # Also save to Graphiti if enabled
        if is_graphiti_memory_enabled():
            try:
                graphiti = run_async(get_graphiti_memory(spec_dir))
                if graphiti:
                    run_async(graphiti.save_pattern(pattern_stripped))
                    run_async(graphiti.close())
            except Exception as e:
                logger.warning(f"Graphiti pattern save failed: {e}")


def load_patterns(spec_dir: Path) -> list[str]:
    """
    Load all code patterns.

    Args:
        spec_dir: Path to spec directory

    Returns:
        List of pattern strings
    """
    memory_dir = get_memory_dir(spec_dir)
    patterns_file = memory_dir / "patterns.md"

    if not patterns_file.exists():
        return []

    content = patterns_file.read_text(encoding="utf-8")
    patterns = []

    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("- "):
            patterns.append(line[2:].strip())

    return patterns

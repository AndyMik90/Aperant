"""
Memory Storage Pruner
======================

Auto-prunes oldest memory entries when total storage for a spec exceeds
a configurable cap (default 1024 MB). Pruning order:

1. Oldest session insight files (by filename number)
2. Codebase map entries (oldest by metadata timestamp, then alphabetical)
3. Lessons learned entries (oldest first)

Patterns and gotchas are NOT pruned — they're small and always relevant.

Integration:
    Called from build_commands.py after build-complete (before retrospective).
    Can also be called manually via CLI: python -m memory --action prune
"""

import json
import logging
from pathlib import Path

from .paths import get_memory_dir

logger = logging.getLogger(__name__)

# Default memory cap in megabytes
DEFAULT_MEMORY_CAP_MB = 1024


def get_memory_size(spec_dir: Path) -> int:
    """
    Calculate total memory storage size in bytes for a spec.

    Walks the memory directory recursively and sums all file sizes.

    Args:
        spec_dir: Path to spec directory

    Returns:
        Total size in bytes (0 if memory dir doesn't exist)
    """
    memory_dir = spec_dir / "memory"
    if not memory_dir.exists():
        return 0

    total = 0
    for f in memory_dir.rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
            except OSError:
                continue
    return total


def get_memory_size_breakdown(spec_dir: Path) -> dict[str, int]:
    """
    Get per-category size breakdown of memory storage.

    Args:
        spec_dir: Path to spec directory

    Returns:
        Dict mapping category names to byte sizes:
            - session_insights: total size of session_*.json files
            - codebase_map: size of codebase_map.json
            - patterns: size of patterns.md
            - gotchas: size of gotchas.md
            - lessons: size of lessons_learned.json
            - other: any other files in memory/
    """
    memory_dir = spec_dir / "memory"
    if not memory_dir.exists():
        return {}

    breakdown: dict[str, int] = {
        "session_insights": 0,
        "codebase_map": 0,
        "patterns": 0,
        "gotchas": 0,
        "lessons": 0,
        "other": 0,
    }

    for f in memory_dir.rglob("*"):
        if not f.is_file():
            continue
        try:
            size = f.stat().st_size
        except OSError:
            continue

        rel = f.relative_to(memory_dir)
        name = rel.parts[0] if rel.parts else f.name

        if name == "session_insights":
            breakdown["session_insights"] += size
        elif f.name == "codebase_map.json":
            breakdown["codebase_map"] += size
        elif f.name == "patterns.md":
            breakdown["patterns"] += size
        elif f.name == "gotchas.md":
            breakdown["gotchas"] += size
        elif f.name == "lessons_learned.json":
            breakdown["lessons"] += size
        else:
            breakdown["other"] += size

    return breakdown


def prune_session_insights(spec_dir: Path, max_keep: int = 50) -> int:
    """
    Prune oldest session insight files, keeping the most recent.

    Args:
        spec_dir: Path to spec directory
        max_keep: Maximum number of session insight files to keep

    Returns:
        Number of files deleted
    """
    insights_dir = spec_dir / "memory" / "session_insights"
    if not insights_dir.exists():
        return 0

    session_files = sorted(insights_dir.glob("session_*.json"))
    if len(session_files) <= max_keep:
        return 0

    to_delete = session_files[: len(session_files) - max_keep]
    deleted = 0
    for f in to_delete:
        try:
            f.unlink()
            deleted += 1
        except OSError as e:
            logger.warning("Failed to delete session insight %s: %s", f.name, e)

    if deleted:
        logger.info("Pruned %d oldest session insight files", deleted)
    return deleted


def prune_codebase_map(spec_dir: Path, max_entries: int = 500) -> int:
    """
    Prune codebase map to max_entries, removing alphabetically-first entries.

    Keeps the most recently-added entries (entries are appended, so later
    entries in sorted order are more recent). Always preserves _metadata.

    Args:
        spec_dir: Path to spec directory
        max_entries: Maximum number of file entries to keep

    Returns:
        Number of entries removed
    """
    memory_dir = get_memory_dir(spec_dir)
    map_file = memory_dir / "codebase_map.json"

    if not map_file.exists():
        return 0

    try:
        with open(map_file) as f:
            codebase_map = json.load(f)
    except (OSError, json.JSONDecodeError):
        return 0

    # Separate metadata
    metadata = codebase_map.pop("_metadata", None)
    entries = list(codebase_map.keys())

    if len(entries) <= max_entries:
        if metadata:
            codebase_map["_metadata"] = metadata
        return 0

    # Sort alphabetically and remove the first (oldest/least relevant) entries
    entries.sort()
    to_remove = entries[: len(entries) - max_entries]

    for key in to_remove:
        del codebase_map[key]

    # Restore metadata with updated count
    if metadata:
        metadata["total_files"] = len(codebase_map)
        codebase_map["_metadata"] = metadata

    with open(map_file, "w") as f:
        json.dump(codebase_map, f, indent=2, sort_keys=True)

    logger.info("Pruned %d entries from codebase map", len(to_remove))
    return len(to_remove)


def prune_lessons(spec_dir: Path, max_entries: int = 20) -> int:
    """
    Prune lessons_learned.json, keeping the most recent entries.

    Args:
        spec_dir: Path to spec directory
        max_entries: Maximum number of lesson entries to keep

    Returns:
        Number of entries removed
    """
    memory_dir = get_memory_dir(spec_dir)
    lessons_file = memory_dir / "lessons_learned.json"

    if not lessons_file.exists():
        return 0

    try:
        with open(lessons_file) as f:
            lessons = json.load(f)
    except (OSError, json.JSONDecodeError):
        return 0

    if not isinstance(lessons, list) or len(lessons) <= max_entries:
        return 0

    removed = len(lessons) - max_entries
    lessons = lessons[-max_entries:]  # Keep most recent

    with open(lessons_file, "w") as f:
        json.dump(lessons, f, indent=2)

    logger.info("Pruned %d oldest lesson entries", removed)
    return removed


def prune_memory(
    spec_dir: Path,
    cap_mb: int = DEFAULT_MEMORY_CAP_MB,
    max_sessions: int = 50,
    max_map_entries: int = 500,
    max_lessons: int = 20,
) -> dict[str, int]:
    """
    Auto-prune memory storage for a spec when over the storage cap.

    Pruning is applied in order until under cap or all categories pruned:
    1. Session insights (oldest files first)
    2. Codebase map (alphabetically-first entries)
    3. Lessons learned (oldest entries first)

    Args:
        spec_dir: Path to spec directory
        cap_mb: Memory storage cap in megabytes
        max_sessions: Max session insight files to keep
        max_map_entries: Max codebase map entries to keep
        max_lessons: Max lesson entries to keep

    Returns:
        Dict with pruning results:
            - size_before: bytes before pruning
            - size_after: bytes after pruning
            - sessions_pruned: number of session files deleted
            - map_entries_pruned: number of map entries removed
            - lessons_pruned: number of lesson entries removed
    """
    cap_bytes = cap_mb * 1024 * 1024
    size_before = get_memory_size(spec_dir)

    result = {
        "size_before": size_before,
        "size_after": size_before,
        "sessions_pruned": 0,
        "map_entries_pruned": 0,
        "lessons_pruned": 0,
    }

    if size_before <= cap_bytes:
        logger.debug(
            "Memory usage %d bytes is under cap %d bytes — no pruning needed",
            size_before,
            cap_bytes,
        )
        return result

    logger.info(
        "Memory usage %d bytes exceeds cap %d bytes — pruning",
        size_before,
        cap_bytes,
    )

    # Stage 1: Prune session insights
    result["sessions_pruned"] = prune_session_insights(spec_dir, max_sessions)
    current_size = get_memory_size(spec_dir)
    if current_size <= cap_bytes:
        result["size_after"] = current_size
        return result

    # Stage 2: Prune codebase map
    result["map_entries_pruned"] = prune_codebase_map(spec_dir, max_map_entries)
    current_size = get_memory_size(spec_dir)
    if current_size <= cap_bytes:
        result["size_after"] = current_size
        return result

    # Stage 3: Prune lessons
    result["lessons_pruned"] = prune_lessons(spec_dir, max_lessons)
    result["size_after"] = get_memory_size(spec_dir)

    return result

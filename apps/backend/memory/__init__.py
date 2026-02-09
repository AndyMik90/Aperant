#!/usr/bin/env python3
"""
Session Memory System
=====================

Persists learnings between autonomous coding sessions to avoid rediscovering
codebase patterns, gotchas, and insights.

Architecture Decision:
    Memory System Hierarchy:

    PRIMARY: Graphiti (when GRAPHITI_ENABLED=true)
        - Graph-based knowledge storage with LadybugDB (embedded Kuzu database)
        - Semantic search across sessions
        - Cross-project context retrieval
        - Rich relationship modeling

    FALLBACK: File-based (when Graphiti is disabled)
        - Zero external dependencies (no database required)
        - Human-readable files for debugging and inspection
        - Guaranteed availability (no network/service failures)
        - Simple backup and version control integration

    The agent.py orchestrator uses save_session_memory() which:
    1. Tries Graphiti first if enabled
    2. Falls back to file-based if Graphiti is disabled or fails

    This ensures memory is ALWAYS saved, regardless of configuration.

Each spec has its own memory directory:
    ac-jerry/specs/001-feature/memory/
        ├── codebase_map.json      # Key files and their purposes
        ├── patterns.md            # Code patterns to follow
        ├── gotchas.md             # Pitfalls to avoid
        └── session_insights/
            ├── session_001.json   # What session 1 learned
            └── session_002.json   # What session 2 learned

Public API:
    # Graphiti helpers
    - is_graphiti_memory_enabled() -> bool

    # Directory management
    - get_memory_dir(spec_dir) -> Path
    - get_session_insights_dir(spec_dir) -> Path
    - clear_memory(spec_dir) -> None

    # Session insights
    - save_session_insights(spec_dir, session_num, insights) -> None
    - load_all_insights(spec_dir) -> list[dict]

    # Codebase map
    - update_codebase_map(spec_dir, discoveries) -> None
    - load_codebase_map(spec_dir) -> dict[str, str]

    # Patterns and gotchas
    - append_pattern(spec_dir, pattern) -> None
    - load_patterns(spec_dir) -> list[str]
    - append_gotcha(spec_dir, gotcha) -> None
    - load_gotchas(spec_dir) -> list[str]

    # Summary
    - get_memory_summary(spec_dir) -> dict

    # Secret scrubbing
    - scrub_text(text) -> str
    - scrub_dict(data) -> dict
    - contains_secrets(text) -> bool
"""

# Graphiti integration
# Codebase map
from .codebase_map import load_codebase_map, update_codebase_map
from .graphiti_helpers import is_graphiti_memory_enabled

# Directory management
from .paths import clear_memory, get_memory_dir, get_session_insights_dir

# Patterns and gotchas
from .patterns import (
    append_gotcha,
    append_pattern,
    load_gotchas,
    load_patterns,
)

# Session insights
from .sessions import load_all_insights, save_session_insights

# Secret scrubbing
from .scrubber import contains_secrets, scrub_dict, scrub_text

# Summary utilities
from .summary import get_memory_summary

__all__ = [
    # Graphiti helpers
    "is_graphiti_memory_enabled",
    # Directory management
    "get_memory_dir",
    "get_session_insights_dir",
    "clear_memory",
    # Session insights
    "save_session_insights",
    "load_all_insights",
    # Codebase map
    "update_codebase_map",
    "load_codebase_map",
    # Patterns and gotchas
    "append_pattern",
    "load_patterns",
    "append_gotcha",
    "load_gotchas",
    # Summary
    "get_memory_summary",
    # Secret scrubbing
    "scrub_text",
    "scrub_dict",
    "contains_secrets",
]

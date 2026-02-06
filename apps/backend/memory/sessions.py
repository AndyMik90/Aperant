#!/usr/bin/env python3
"""
Session Insights Management
============================

Functions for saving and loading session insights.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .graphiti_helpers import (
    is_graphiti_memory_enabled,
    run_async,
    save_to_graphiti_async,
)
from .paths import get_session_insights_dir

logger = logging.getLogger(__name__)


def save_session_insights(
    spec_dir: Path, session_num: int, insights: dict[str, Any]
) -> None:
    """
    Save insights from a completed session.

    Args:
        spec_dir: Path to spec directory
        session_num: Session number (1-indexed)
        insights: Dictionary containing session learnings with keys:
            - subtasks_completed: list[str] - Subtask IDs completed
            - discoveries: dict - New file purposes, patterns, gotchas found
                - files_understood: dict[str, str] - {path: purpose}
                - patterns_found: list[str] - Pattern descriptions
                - gotchas_encountered: list[str] - Gotcha descriptions
            - what_worked: list[str] - Successful approaches
            - what_failed: list[str] - Unsuccessful approaches
            - recommendations_for_next_session: list[str] - Suggestions

    Example:
        insights = {
            "subtasks_completed": ["subtask-1", "subtask-2"],
            "discoveries": {
                "files_understood": {
                    "src/api/auth.py": "JWT authentication handler"
                },
                "patterns_found": ["Use async/await for all DB calls"],
                "gotchas_encountered": ["Must close DB connections in workers"]
            },
            "what_worked": ["Added comprehensive error handling first"],
            "what_failed": ["Tried inline validation - should use middleware"],
            "recommendations_for_next_session": ["Focus on integration tests next"]
        }
    """
    insights_dir = get_session_insights_dir(spec_dir)
    session_file = insights_dir / f"session_{session_num:03d}.json"

    # Build complete insight structure
    session_data = {
        "session_number": session_num,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "subtasks_completed": insights.get("subtasks_completed", []),
        "discoveries": insights.get(
            "discoveries",
            {"files_understood": {}, "patterns_found": [], "gotchas_encountered": []},
        ),
        "what_worked": insights.get("what_worked", []),
        "what_failed": insights.get("what_failed", []),
        "recommendations_for_next_session": insights.get(
            "recommendations_for_next_session", []
        ),
    }

    # Write to file (always use file-based storage)
    with open(session_file, "w", encoding="utf-8") as f:
        json.dump(session_data, f, indent=2)

    # Also save to Graphiti if enabled (non-blocking, errors logged but not raised)
    if is_graphiti_memory_enabled():
        try:
            run_async(save_to_graphiti_async(spec_dir, session_num, session_data))
            logger.info(f"Session {session_num} insights also saved to Graphiti")
        except Exception as e:
            # Don't fail the save if Graphiti fails - file-based is the primary storage
            logger.warning(f"Graphiti save failed (file-based save succeeded): {e}")


def load_all_insights(spec_dir: Path) -> list[dict[str, Any]]:
    """
    Load all session insights, ordered by session number.

    Args:
        spec_dir: Path to spec directory

    Returns:
        List of insight dictionaries, oldest to newest
    """
    insights_dir = get_session_insights_dir(spec_dir)

    if not insights_dir.exists():
        return []

    # Find all session JSON files
    session_files = sorted(insights_dir.glob("session_*.json"))

    insights = []
    for session_file in session_files:
        try:
            with open(session_file, encoding="utf-8") as f:
                insights.append(json.load(f))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            # Skip corrupted files
            continue

    return insights

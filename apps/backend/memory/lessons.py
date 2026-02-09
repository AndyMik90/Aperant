"""
Lessons Learned Storage
========================

Stores post-build retrospective lessons at both the spec level and project
level. Lessons capture what worked, what didn't, and actionable insights
that improve future builds.

Spec-level storage:
    {spec_dir}/memory/lessons_learned.json

Project-level promotion:
    Key lessons are appended to PROJECT_MEMORY.md under "Agent Learnings".

Retrieval:
    load_lessons_for_context() returns formatted lessons relevant to a query,
    for injection into the coder agent's prompt.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .paths import get_memory_dir
from .scrubber import scrub_dict, scrub_text

logger = logging.getLogger(__name__)

LESSONS_FILENAME = "lessons_learned.json"


def save_lessons(
    spec_dir: Path,
    lessons: dict[str, Any],
) -> bool:
    """
    Save lessons learned for a spec.

    Args:
        spec_dir: Spec directory
        lessons: Structured lessons dict with keys:
            - what_worked: list[str]
            - what_didnt_work: list[str]
            - key_insights: list[str]
            - recommendations: list[str]
            - spec_name: str
            - timestamp: str (auto-set if missing)

    Returns:
        True if saved successfully
    """
    memory_dir = get_memory_dir(spec_dir)
    lessons_file = memory_dir / LESSONS_FILENAME

    # Scrub secrets before persisting
    lessons = scrub_dict(lessons)

    # Add metadata
    lessons.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    lessons.setdefault("spec_name", spec_dir.name)

    try:
        # Load existing lessons if present (append mode)
        existing = []
        if lessons_file.exists():
            try:
                existing = json.loads(lessons_file.read_text(encoding="utf-8"))
                if not isinstance(existing, list):
                    existing = [existing]
            except (json.JSONDecodeError, ValueError):
                existing = []

        existing.append(lessons)

        lessons_file.write_text(
            json.dumps(existing, indent=2, default=str),
            encoding="utf-8",
        )
        logger.info("Lessons learned saved to %s", lessons_file)
        return True

    except Exception as e:
        logger.warning("Failed to save lessons learned: %s", e)
        return False


def load_lessons(spec_dir: Path) -> list[dict[str, Any]]:
    """
    Load all lessons for a spec.

    Args:
        spec_dir: Spec directory

    Returns:
        List of lesson dicts (newest first)
    """
    memory_dir = get_memory_dir(spec_dir)
    lessons_file = memory_dir / LESSONS_FILENAME

    if not lessons_file.exists():
        return []

    try:
        data = json.loads(lessons_file.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return list(reversed(data))
        return [data]
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Failed to load lessons: %s", e)
        return []


def promote_lessons_to_project(
    project_dir: Path,
    lessons: dict[str, Any],
    spec_name: str,
) -> int:
    """
    Promote key lessons to PROJECT_MEMORY.md.

    Takes the most actionable insights and appends them to the project-level
    memory so future specs benefit from past learnings.

    Args:
        project_dir: Project root directory
        lessons: Structured lessons dict
        spec_name: Spec name for attribution

    Returns:
        Number of entries promoted
    """
    from .project_memory import append_to_project_memory

    promoted = 0

    # Promote key insights as learnings
    for insight in lessons.get("key_insights", []):
        insight = scrub_text(insight)
        if insight and len(insight) > 10:
            if append_to_project_memory(
                project_dir, "learnings", insight, f"Spec {spec_name}"
            ):
                promoted += 1

    # Promote what_worked as patterns
    for item in lessons.get("what_worked", []):
        item = scrub_text(item)
        if item and len(item) > 10:
            if append_to_project_memory(
                project_dir, "patterns", item, f"Spec {spec_name}"
            ):
                promoted += 1

    # Promote what_didnt_work as gotchas
    for item in lessons.get("what_didnt_work", []):
        item = scrub_text(item)
        if item and len(item) > 10:
            if append_to_project_memory(
                project_dir, "gotchas", item, f"Spec {spec_name}"
            ):
                promoted += 1

    if promoted:
        logger.info(
            "Promoted %d lesson(s) from spec %s to PROJECT_MEMORY.md",
            promoted,
            spec_name,
        )

    return promoted


def load_lessons_for_context(
    spec_dir: Path,
    max_lessons: int = 3,
    max_chars: int = 1500,
) -> str | None:
    """
    Load lessons formatted for injection into the coder agent's prompt.

    Returns a markdown section with the most recent lessons, truncated
    to stay within token budget.

    Args:
        spec_dir: Spec directory
        max_lessons: Maximum number of lesson entries to include
        max_chars: Maximum total characters

    Returns:
        Formatted markdown string or None if no lessons exist
    """
    lessons_list = load_lessons(spec_dir)
    if not lessons_list:
        return None

    sections = ["## Lessons Learned from Previous Builds\n"]

    for lesson in lessons_list[:max_lessons]:
        # What worked
        worked = lesson.get("what_worked", [])
        if worked:
            sections.append("**What worked:**")
            for item in worked[:3]:
                sections.append(f"- {item}")

        # What didn't work
        failed = lesson.get("what_didnt_work", [])
        if failed:
            sections.append("**What didn't work:**")
            for item in failed[:3]:
                sections.append(f"- {item}")

        # Key insights
        insights = lesson.get("key_insights", [])
        if insights:
            sections.append("**Key insights:**")
            for item in insights[:3]:
                sections.append(f"- {item}")

        # Recommendations
        recs = lesson.get("recommendations", [])
        if recs:
            sections.append("**Recommendations:**")
            for item in recs[:3]:
                sections.append(f"- {item}")

        sections.append("")

    result = "\n".join(sections)

    # Truncate if too long
    if len(result) > max_chars:
        result = result[:max_chars].rsplit("\n", 1)[0] + "\n\n_(truncated)_"

    return result

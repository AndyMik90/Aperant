"""
Post-Build Retrospective
=========================

After QA passes, synthesizes all session insights into a structured
retrospective: what worked, what didn't, key insights, and recommendations.

Uses a cheap LLM call (Haiku) to analyze aggregated session data and produce
actionable lessons learned that persist for future builds.

Integration:
    Called from build_commands.py after QA approval.
    Results saved via memory.lessons.save_lessons() and promoted to
    PROJECT_MEMORY.md.
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

RETROSPECTIVE_SYSTEM_PROMPT = (
    "You are a senior software engineering retrospective facilitator. "
    "You analyze completed autonomous coding sessions and extract actionable "
    "lessons learned. Always respond with valid JSON only, no markdown "
    "formatting or explanations."
)

RETROSPECTIVE_PROMPT_TEMPLATE = """\
Analyze the following session data from a completed autonomous coding build
and produce a structured retrospective.

## Build Context

- **Spec:** {spec_name}
- **Total Sessions:** {total_sessions}
- **Subtasks Completed:** {subtasks_completed}

## Session Insights

{session_summaries}

## Instructions

Synthesize the above into a JSON object with these keys:

{{
  "what_worked": ["list of approaches/strategies that led to successful outcomes"],
  "what_didnt_work": ["list of approaches that failed or caused problems"],
  "key_insights": ["list of important learnings about the codebase, tools, or process"],
  "recommendations": ["list of actionable recommendations for future similar builds"]
}}

Rules:
- Each list should have 2-5 items
- Be specific and actionable, not generic
- Focus on learnings that transfer to future tasks
- If sessions had failures and retries, note what recovery strategy worked
- Output ONLY the JSON object
"""


def _format_session_summaries(insights_list: list[dict]) -> str:
    """Format session insights into a readable summary for the LLM."""
    if not insights_list:
        return "(No session data available)"

    parts = []
    for insight in insights_list:
        session_num = insight.get("session_number", "?")
        completed = insight.get("subtasks_completed", [])
        worked = insight.get("what_worked", [])
        failed = insight.get("what_failed", [])
        recommendations = insight.get("recommendations_for_next_session", [])

        discoveries = insight.get("discoveries", {})
        patterns = discoveries.get("patterns_found", [])
        gotchas = discoveries.get("gotchas_encountered", [])

        lines = [f"### Session {session_num}"]
        if completed:
            lines.append(f"- Completed: {', '.join(completed)}")
        if worked:
            lines.append(f"- Worked: {'; '.join(worked)}")
        if failed:
            lines.append(f"- Failed: {'; '.join(failed)}")
        if patterns:
            lines.append(f"- Patterns: {'; '.join(patterns[:3])}")
        if gotchas:
            lines.append(f"- Gotchas: {'; '.join(gotchas[:3])}")
        if recommendations:
            lines.append(f"- Recommendations: {'; '.join(recommendations[:3])}")

        parts.append("\n".join(lines))

    return "\n\n".join(parts)


async def run_retrospective(
    spec_dir: Path,
    project_dir: Path,
) -> dict | None:
    """
    Run the post-build retrospective analysis.

    Aggregates all session insights for the spec and uses a cheap LLM call
    to synthesize lessons learned.

    Args:
        spec_dir: Spec directory
        project_dir: Project root directory

    Returns:
        Structured lessons dict or None if failed
    """
    # Load all session insights
    try:
        from memory.sessions import load_all_insights
        insights_list = load_all_insights(spec_dir)
    except Exception as e:
        logger.warning("Failed to load session insights for retrospective: %s", e)
        return None

    if not insights_list:
        logger.info("No session insights available for retrospective")
        return None

    # Count completed subtasks across all sessions
    all_completed = set()
    for insight in insights_list:
        for sid in insight.get("subtasks_completed", []):
            all_completed.add(sid)

    # Build the prompt
    session_summaries = _format_session_summaries(insights_list)
    prompt = RETROSPECTIVE_PROMPT_TEMPLATE.format(
        spec_name=spec_dir.name,
        total_sessions=len(insights_list),
        subtasks_completed=len(all_completed),
        session_summaries=session_summaries,
    )

    # Use simple_client for cheap LLM call
    try:
        from core.simple_client import create_simple_client

        client = create_simple_client(
            agent_type="insights",
            system_prompt=RETROSPECTIVE_SYSTEM_PROMPT,
            cwd=project_dir,
        )

        async with client:
            await client.query(prompt)

            response_text = ""
            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        if type(block).__name__ == "TextBlock" and hasattr(block, "text"):
                            if block.text:
                                response_text += block.text

        if not response_text.strip():
            logger.warning("Retrospective LLM returned empty response")
            return None

        return _parse_retrospective(response_text)

    except Exception as e:
        logger.warning("Retrospective LLM call failed: %s", e)
        return _fallback_retrospective(insights_list)


def _parse_retrospective(response_text: str) -> dict | None:
    """Parse the LLM response into a structured lessons dict."""
    text = response_text.strip()

    # Handle markdown code blocks
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    if not text:
        return None

    try:
        lessons = json.loads(text)
        if not isinstance(lessons, dict):
            return None

        # Ensure required keys
        lessons.setdefault("what_worked", [])
        lessons.setdefault("what_didnt_work", [])
        lessons.setdefault("key_insights", [])
        lessons.setdefault("recommendations", [])

        return lessons

    except json.JSONDecodeError as e:
        logger.warning("Failed to parse retrospective JSON: %s", e)
        return None


def _fallback_retrospective(insights_list: list[dict]) -> dict:
    """
    Generate a basic retrospective from raw session data when LLM fails.

    Aggregates what_worked/what_failed across all sessions.
    """
    what_worked = []
    what_failed = []
    patterns = []
    gotchas = []

    for insight in insights_list:
        what_worked.extend(insight.get("what_worked", []))
        what_failed.extend(insight.get("what_failed", []))

        discoveries = insight.get("discoveries", {})
        patterns.extend(discoveries.get("patterns_found", []))
        gotchas.extend(discoveries.get("gotchas_encountered", []))

    return {
        "what_worked": list(dict.fromkeys(what_worked))[:5],
        "what_didnt_work": list(dict.fromkeys(what_failed))[:5],
        "key_insights": list(dict.fromkeys(patterns))[:5],
        "recommendations": [],
    }

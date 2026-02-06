"""
Insight Extractor
=================

Automatically extracts structured insights from completed coding sessions.
Runs after each session to capture rich, actionable knowledge for Graphiti memory.

Uses the Claude Agent SDK (same as the rest of the system) for extraction.
Falls back to generic insights if extraction fails (never blocks the build).
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Check for Claude SDK availability
try:
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    SDK_AVAILABLE = True
except ImportError:
    SDK_AVAILABLE = False
    ClaudeAgentOptions = None
    ClaudeSDKClient = None

from core.auth import ensure_claude_code_oauth_token, get_auth_token

# Default model for insight extraction (fast and cheap)
# Note: Using Haiku 4.5 for fast, cheap extraction. Haiku does not support
# extended thinking, so thinking_default is set to "none" in models.py
DEFAULT_EXTRACTION_MODEL = "claude-haiku-4-5-20251001"

# Maximum diff size to send to the LLM (avoid context limits)
MAX_DIFF_CHARS = 15000

# Maximum attempt history entries to include
MAX_ATTEMPTS_TO_INCLUDE = 3


def is_extraction_enabled() -> bool:
    """Check if insight extraction is enabled."""
    # Extraction requires Claude SDK and authentication token
    if not SDK_AVAILABLE:
        return False
    if not get_auth_token():
        return False
    enabled_str = os.environ.get("INSIGHT_EXTRACTION_ENABLED", "true").lower()
    return enabled_str in ("true", "1", "yes")


def get_extraction_model() -> str:
    """Get the model to use for insight extraction."""
    return os.environ.get("INSIGHT_EXTRACTOR_MODEL", DEFAULT_EXTRACTION_MODEL)


# =============================================================================
# Git Helpers
# =============================================================================


def get_session_diff(
    project_dir: Path,
    commit_before: str | None,
    commit_after: str | None,
) -> str:
    """
    Get the git diff between two commits.

    Args:
        project_dir: Project root directory
        commit_before: Commit hash before session (or None)
        commit_after: Commit hash after session (or None)

    Returns:
        Diff text (truncated if too large)
    """
    if not commit_before or not commit_after:
        return "(No commits to diff)"

    if commit_before == commit_after:
        return "(No changes - same commit)"

    try:
        result = subprocess.run(
            ["git", "diff", commit_before, commit_after],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        diff = result.stdout

        if len(diff) > MAX_DIFF_CHARS:
            # Truncate and add note
            diff = (
                diff[:MAX_DIFF_CHARS] + f"\n\n... (truncated, {len(diff)} chars total)"
            )

        return diff if diff else "(Empty diff)"

    except subprocess.TimeoutExpired:
        logger.warning("Git diff timed out")
        return "(Git diff timed out)"
    except Exception as e:
        logger.warning(f"Failed to get git diff: {e}")
        return f"(Failed to get diff: {e})"


def get_changed_files(
    project_dir: Path,
    commit_before: str | None,
    commit_after: str | None,
) -> list[str]:
    """
    Get list of files changed between two commits.

    Args:
        project_dir: Project root directory
        commit_before: Commit hash before session
        commit_after: Commit hash after session

    Returns:
        List of changed file paths
    """
    if not commit_before or not commit_after or commit_before == commit_after:
        return []

    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", commit_before, commit_after],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=10,
        )
        files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
        return files

    except Exception as e:
        logger.warning(f"Failed to get changed files: {e}")
        return []


def get_commit_messages(
    project_dir: Path,
    commit_before: str | None,
    commit_after: str | None,
) -> str:
    """Get commit messages between two commits."""
    if not commit_before or not commit_after or commit_before == commit_after:
        return "(No commits)"

    try:
        result = subprocess.run(
            ["git", "log", "--oneline", f"{commit_before}..{commit_after}"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip() if result.stdout.strip() else "(No commits)"

    except Exception as e:
        logger.warning(f"Failed to get commit messages: {e}")
        return f"(Failed: {e})"


# =============================================================================
# Input Gathering
# =============================================================================


def gather_extraction_inputs(
    spec_dir: Path,
    project_dir: Path,
    subtask_id: str,
    session_num: int,
    commit_before: str | None,
    commit_after: str | None,
    success: bool,
    recovery_manager: Any,
) -> dict:
    """
    Gather all inputs needed for insight extraction.

    Args:
        spec_dir: Spec directory
        project_dir: Project root
        subtask_id: The subtask that was worked on
        session_num: Session number
        commit_before: Commit before session
        commit_after: Commit after session
        success: Whether session succeeded
        recovery_manager: Recovery manager with attempt history

    Returns:
        Dict with all inputs for the extractor
    """
    # Get subtask description from implementation plan
    subtask_description = _get_subtask_description(spec_dir, subtask_id)

    # Get git diff
    diff = get_session_diff(project_dir, commit_before, commit_after)

    # Get changed files
    changed_files = get_changed_files(project_dir, commit_before, commit_after)

    # Get commit messages
    commit_messages = get_commit_messages(project_dir, commit_before, commit_after)

    # Get attempt history
    attempt_history = _get_attempt_history(recovery_manager, subtask_id)

    return {
        "subtask_id": subtask_id,
        "subtask_description": subtask_description,
        "session_num": session_num,
        "success": success,
        "diff": diff,
        "changed_files": changed_files,
        "commit_messages": commit_messages,
        "attempt_history": attempt_history,
    }


def _get_subtask_description(spec_dir: Path, subtask_id: str) -> str:
    """Get subtask description from implementation plan."""
    plan_file = spec_dir / "implementation_plan.json"
    if not plan_file.exists():
        return f"Subtask: {subtask_id}"

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        # Search through phases for the subtask
        for phase in plan.get("phases", []):
            for subtask in phase.get("subtasks", []):
                if subtask.get("id") == subtask_id:
                    return subtask.get("description", f"Subtask: {subtask_id}")

        return f"Subtask: {subtask_id}"

    except Exception as e:
        logger.warning(f"Failed to load subtask description: {e}")
        return f"Subtask: {subtask_id}"


def _get_attempt_history(recovery_manager: Any, subtask_id: str) -> list[dict]:
    """Get previous attempt history for this subtask."""
    if not recovery_manager:
        return []

    try:
        history = recovery_manager.get_subtask_history(subtask_id)
        attempts = history.get("attempts", [])

        # Limit to recent attempts
        return attempts[-MAX_ATTEMPTS_TO_INCLUDE:]

    except Exception as e:
        logger.warning(f"Failed to get attempt history: {e}")
        return []


# =============================================================================
# LLM Extraction
# =============================================================================


def _build_extraction_prompt(inputs: dict) -> str:
    """Build the prompt for insight extraction."""
    prompt_file = Path(__file__).parent / "prompts" / "insight_extractor.md"

    if prompt_file.exists():
        base_prompt = prompt_file.read_text(encoding="utf-8")
    else:
        # Fallback if prompt file missing
        base_prompt = """Extract structured insights from this coding session.
Output ONLY valid JSON with: file_insights, patterns_discovered, gotchas_discovered, approach_outcome, recommendations"""

    # Build session context
    session_context = f"""
---

## SESSION DATA

### Subtask
- **ID**: {inputs["subtask_id"]}
- **Description**: {inputs["subtask_description"]}
- **Session Number**: {inputs["session_num"]}
- **Outcome**: {"SUCCESS" if inputs["success"] else "FAILED"}

### Files Changed
{chr(10).join(f"- {f}" for f in inputs["changed_files"]) if inputs["changed_files"] else "(No files changed)"}

### Commit Messages
{inputs["commit_messages"]}

### Git Diff
```diff
{inputs["diff"]}
```

### Previous Attempts
{_format_attempt_history(inputs["attempt_history"])}

---

Now analyze this session and output ONLY the JSON object.
"""

    return base_prompt + session_context


def _format_attempt_history(attempts: list[dict]) -> str:
    """Format attempt history for the prompt."""
    if not attempts:
        return "(First attempt - no previous history)"

    lines = []
    for i, attempt in enumerate(attempts, 1):
        success = "SUCCESS" if attempt.get("success") else "FAILED"
        approach = attempt.get("approach", "Unknown approach")
        error = attempt.get("error", "")
        lines.append(f"**Attempt {i}** ({success}): {approach}")
        if error:
            lines.append(f"  Error: {error}")

    return "\n".join(lines)


async def run_insight_extraction(
    inputs: dict, project_dir: Path | None = None
) -> dict | None:
    """
    Run the insight extraction using Claude Agent SDK.

    Args:
        inputs: Gathered session inputs
        project_dir: Project directory for SDK context (optional)

    Returns:
        Extracted insights dict or None if failed
    """
    if not SDK_AVAILABLE:
        logger.warning("Claude SDK not available, skipping insight extraction")
        return None

    if not get_auth_token():
        logger.warning("No authentication token found, skipping insight extraction")
        return None

    # Ensure SDK can find the token
    ensure_claude_code_oauth_token()

    model = get_extraction_model()
    prompt = _build_extraction_prompt(inputs)

    # Use current directory if project_dir not specified
    cwd = str(project_dir.resolve()) if project_dir else os.getcwd()

    try:
        # Use simple_client for insight extraction
        from pathlib import Path

        from core.simple_client import create_simple_client

        client = create_simple_client(
            agent_type="insights",
            model=model,
            system_prompt=(
                "You are an expert code analyst. You extract structured insights from coding sessions. "
                "Always respond with valid JSON only, no markdown formatting or explanations."
            ),
            cwd=Path(cwd) if cwd else None,
        )

        # Use async context manager
        async with client:
            await client.query(prompt)

            # Collect the response
            response_text = ""
            message_count = 0
            text_blocks_found = 0

            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                message_count += 1

                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        # Must check block type - only TextBlock has .text attribute
                        block_type = type(block).__name__
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            text_blocks_found += 1
                            if block.text:  # Only add non-empty text
                                response_text += block.text
                            else:
                                logger.debug(
                                    f"Found empty TextBlock in response (block #{text_blocks_found})"
                                )

            # Log response collection summary
            logger.debug(
                f"Insight extraction response: {message_count} messages, "
                f"{text_blocks_found} text blocks, {len(response_text)} chars collected"
            )

            # Validate we received content before parsing
            if not response_text.strip():
                logger.warning(
                    f"Insight extraction returned empty response. "
                    f"Messages received: {message_count}, TextBlocks found: {text_blocks_found}. "
                    f"This may indicate the AI model did not respond with text content."
                )
                return None

        # Parse JSON from response
        return parse_insights(response_text)

    except Exception as e:
        logger.warning(f"Insight extraction failed: {e}")
        return None


def parse_insights(response_text: str) -> dict | None:
    """
    Parse the LLM response into structured insights.

    Args:
        response_text: Raw LLM response

    Returns:
        Parsed insights dict or None if parsing failed
    """
    # Try to extract JSON from the response
    text = response_text.strip()

    # Early validation - check for empty response
    if not text:
        logger.warning("Cannot parse insights: response text is empty")
        return None

    # Handle markdown code blocks
    if text.startswith("```"):
        # Remove code block markers
        lines = text.split("\n")
        # Remove first line (```json or ```)
        if lines[0].startswith("```"):
            lines = lines[1:]
        # Remove last line if it's ```
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

        # Check again after removing code blocks
        if not text:
            logger.warning(
                "Cannot parse insights: response contained only markdown code block markers with no content"
            )
            return None

    try:
        insights = json.loads(text)

        # Validate structure
        if not isinstance(insights, dict):
            logger.warning(
                f"Insights is not a dict, got type: {type(insights).__name__}"
            )
            return None

        # Ensure required keys exist with defaults
        insights.setdefault("file_insights", [])
        insights.setdefault("patterns_discovered", [])
        insights.setdefault("gotchas_discovered", [])
        insights.setdefault("approach_outcome", {})
        insights.setdefault("recommendations", [])

        return insights

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse insights JSON: {e}")
        # Show more context in the error message
        preview_length = min(500, len(text))
        logger.warning(
            f"Response text preview (first {preview_length} chars): {text[:preview_length]}"
        )
        if len(text) > preview_length:
            logger.warning(f"... (total length: {len(text)} chars)")
        return None


# =============================================================================
# Main Entry Point
# =============================================================================


async def extract_session_insights(
    spec_dir: Path,
    project_dir: Path,
    subtask_id: str,
    session_num: int,
    commit_before: str | None,
    commit_after: str | None,
    success: bool,
    recovery_manager: Any,
) -> dict:
    """
    Extract insights from a completed coding session.

    This is the main entry point called from post_session_processing().
    Falls back to generic insights if extraction fails.

    Args:
        spec_dir: Spec directory
        project_dir: Project root
        subtask_id: Subtask that was worked on
        session_num: Session number
        commit_before: Commit before session
        commit_after: Commit after session
        success: Whether session succeeded
        recovery_manager: Recovery manager with attempt history

    Returns:
        Insights dict (rich if extraction succeeded, generic if failed)
    """
    # Check if extraction is enabled
    if not is_extraction_enabled():
        logger.info("Insight extraction disabled")
        return _get_generic_insights(subtask_id, success)

    # Check for no changes
    if commit_before == commit_after:
        logger.info("No changes to extract insights from")
        return _get_generic_insights(subtask_id, success)

    try:
        # Gather inputs
        inputs = gather_extraction_inputs(
            spec_dir=spec_dir,
            project_dir=project_dir,
            subtask_id=subtask_id,
            session_num=session_num,
            commit_before=commit_before,
            commit_after=commit_after,
            success=success,
            recovery_manager=recovery_manager,
        )

        # Run extraction
        extracted = await run_insight_extraction(inputs, project_dir=project_dir)

        if extracted:
            # Add metadata
            extracted["subtask_id"] = subtask_id
            extracted["session_num"] = session_num
            extracted["success"] = success
            extracted["changed_files"] = inputs["changed_files"]

            logger.info(
                f"Extracted insights: {len(extracted.get('file_insights', []))} file insights, "
                f"{len(extracted.get('patterns_discovered', []))} patterns, "
                f"{len(extracted.get('gotchas_discovered', []))} gotchas"
            )
            return extracted
        else:
            logger.warning("Extraction returned no results, using generic insights")
            return _get_generic_insights(subtask_id, success)

    except Exception as e:
        logger.warning(f"Insight extraction failed: {e}, using generic insights")
        return _get_generic_insights(subtask_id, success)


def _get_generic_insights(subtask_id: str, success: bool) -> dict:
    """Return generic insights when extraction fails or is disabled."""
    return {
        "file_insights": [],
        "patterns_discovered": [],
        "gotchas_discovered": [],
        "approach_outcome": {
            "success": success,
            "approach_used": f"Implemented subtask: {subtask_id}",
            "why_it_worked": None,
            "why_it_failed": None,
            "alternatives_tried": [],
        },
        "recommendations": [],
        "subtask_id": subtask_id,
        "success": success,
        "changed_files": [],
    }


# =============================================================================
# CLI for Testing
# =============================================================================

if __name__ == "__main__":
    import argparse
    import asyncio

    parser = argparse.ArgumentParser(description="Test insight extraction")
    parser.add_argument("--spec-dir", type=Path, required=True, help="Spec directory")
    parser.add_argument(
        "--project-dir", type=Path, required=True, help="Project directory"
    )
    parser.add_argument(
        "--commit-before", type=str, required=True, help="Commit before session"
    )
    parser.add_argument(
        "--commit-after", type=str, required=True, help="Commit after session"
    )
    parser.add_argument(
        "--subtask-id", type=str, default="test-subtask", help="Subtask ID"
    )

    args = parser.parse_args()

    async def main():
        insights = await extract_session_insights(
            spec_dir=args.spec_dir,
            project_dir=args.project_dir,
            subtask_id=args.subtask_id,
            session_num=1,
            commit_before=args.commit_before,
            commit_after=args.commit_after,
            success=True,
            recovery_manager=None,
        )
        print(json.dumps(insights, indent=2))

    asyncio.run(main())

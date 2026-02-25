"""
Linear Updater - Python-Orchestrated Linear Updates
====================================================

Provides reliable Linear updates via focused mini-agent calls.
Instead of relying on agents to remember Linear updates in long prompts,
the Python orchestrator triggers small, focused agents at key transitions.

Design Principles:
- ONE task per spec (not one issue per subtask)
- Python orchestrator controls when updates happen
- Small prompts that can't lose context
- Graceful degradation if Linear unavailable

Status Flow:
  Todo -> In Progress -> In Review -> (human) -> Done
    |         |              |
    |         |              +-- QA approved, awaiting human merge
    |         +-- Planner/Coder working
    +-- Task created from spec
"""

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

# Linear status constants (matching Valma AI team setup)
STATUS_TODO = "Todo"
STATUS_IN_PROGRESS = "In Progress"
STATUS_IN_REVIEW = "In Review"  # Custom status for QA phase
STATUS_DONE = "Done"
STATUS_CANCELED = "Canceled"

# State file name
LINEAR_TASK_FILE = ".linear_task.json"

# Linear MCP tools needed for updates
LINEAR_TOOLS = [
    "mcp__linear-server__list_teams",
    "mcp__linear-server__create_issue",
    "mcp__linear-server__update_issue",
    "mcp__linear-server__create_comment",
    "mcp__linear-server__list_issue_statuses",
]


@dataclass
class LinearTaskState:
    """State of a Linear task for an auto-claude spec."""

    task_id: str | None = None
    task_title: str | None = None
    team_id: str | None = None
    status: str = STATUS_TODO
    created_at: str | None = None

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "task_title": self.task_title,
            "team_id": self.team_id,
            "status": self.status,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "LinearTaskState":
        return cls(
            task_id=data.get("task_id"),
            task_title=data.get("task_title"),
            team_id=data.get("team_id"),
            status=data.get("status", STATUS_TODO),
            created_at=data.get("created_at"),
        )

    def save(self, spec_dir: Path) -> None:
        """Save state to the spec directory."""
        state_file = spec_dir / LINEAR_TASK_FILE
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, spec_dir: Path) -> Optional["LinearTaskState"]:
        """Load state from the spec directory."""
        state_file = spec_dir / LINEAR_TASK_FILE
        if not state_file.exists():
            return None

        try:
            with open(state_file, encoding="utf-8") as f:
                return cls.from_dict(json.load(f))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return None


def is_linear_enabled() -> bool:
    """Check if Linear integration is available."""
    return bool(os.environ.get("LINEAR_API_KEY"))


def get_linear_api_key() -> str:
    """Get the Linear API key from environment."""
    return os.environ.get("LINEAR_API_KEY", "")


def _create_linear_client() -> ClaudeSDKClient:
    """
    Create a minimal Claude client with only Linear MCP tools.
    Used for focused mini-agent calls.
    """
    from core.auth import (
        ensure_claude_code_oauth_token,
        get_sdk_env_vars,
        require_auth_token,
    )
    from phase_config import resolve_model_id

    require_auth_token()  # Raises ValueError if no token found
    ensure_claude_code_oauth_token()

    linear_api_key = get_linear_api_key()
    if not linear_api_key:
        raise ValueError("LINEAR_API_KEY not set")

    sdk_env = get_sdk_env_vars()

    return ClaudeSDKClient(
        options=ClaudeAgentOptions(
            model=resolve_model_id("haiku"),  # Resolves via API Profile if configured
            system_prompt="You are a Linear API assistant. Execute the requested Linear operation precisely.",
            allowed_tools=LINEAR_TOOLS,
            mcp_servers={
                "linear": {
                    "type": "http",
                    "url": "https://mcp.linear.app/mcp",
                    "headers": {"Authorization": f"Bearer {linear_api_key}"},
                }
            },
            max_turns=10,  # Should complete in 1-3 turns
            env=sdk_env,  # Pass ANTHROPIC_BASE_URL etc. to subprocess
        )
    )


async def _run_linear_agent(prompt: str) -> str | None:
    """
    Run a focused mini-agent for a Linear operation.

    Args:
        prompt: The focused prompt for the Linear operation

    Returns:
        The response text, or None if failed
    """
    try:
        client = _create_linear_client()

        async with client:
            await client.query(prompt)

            response_text = ""
            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            response_text += block.text

            return response_text

    except Exception as e:
        print(f"Linear update failed: {e}")
        return None


async def create_linear_task(
    spec_dir: Path,
    title: str,
    description: str | None = None,
) -> LinearTaskState | None:
    """
    Create a new Linear task for a spec.

    Called by spec_runner.py after requirements gathering.

    Args:
        spec_dir: Spec directory to save state
        title: Task title (the task name from user)
        description: Optional task description

    Returns:
        LinearTaskState if successful, None if failed
    """
    if not is_linear_enabled():
        return None

    # Check if task already exists
    existing = LinearTaskState.load(spec_dir)
    if existing and existing.task_id:
        print(f"Linear task already exists: {existing.task_id}")
        return existing

    desc_part = f'\n   - description: "{description}"' if description else ""

    prompt = f"""Create a Linear task with these details:

1. First, use mcp__linear-server__list_teams to find the team ID
2. Then, use mcp__linear-server__create_issue with:
   - teamId: [the team ID from step 1]
   - title: "{title}"{desc_part}

After creating the issue, tell me:
- The issue ID (like "VAL-123")
- The team ID you used

Format your final response as:
TASK_ID: [the issue ID]
TEAM_ID: [the team ID]
"""

    response = await _run_linear_agent(prompt)
    if not response:
        return None

    # Parse response for task_id and team_id
    task_id = None
    team_id = None

    for line in response.split("\n"):
        line = line.strip()
        if line.startswith("TASK_ID:"):
            task_id = line.replace("TASK_ID:", "").strip()
        elif line.startswith("TEAM_ID:"):
            team_id = line.replace("TEAM_ID:", "").strip()

    if not task_id:
        print(f"Failed to parse task ID from response: {response[:200]}")
        return None

    # Create and save state
    state = LinearTaskState(
        task_id=task_id,
        task_title=title,
        team_id=team_id,
        status=STATUS_TODO,
        created_at=datetime.now().isoformat(),
    )
    state.save(spec_dir)

    print(f"Created Linear task: {task_id}")
    return state


async def update_linear_status(
    spec_dir: Path,
    new_status: str,
) -> bool:
    """
    Update the Linear task status.

    Args:
        spec_dir: Spec directory with .linear_task.json
        new_status: New status (STATUS_TODO, STATUS_IN_PROGRESS, STATUS_IN_REVIEW, STATUS_DONE)

    Returns:
        True if successful, False otherwise
    """
    if not is_linear_enabled():
        return False

    state = LinearTaskState.load(spec_dir)
    if not state or not state.task_id:
        print("No Linear task found for this spec")
        return False

    # Don't update if already at this status
    if state.status == new_status:
        return True

    prompt = f"""Update Linear issue status:

1. First, use mcp__linear-server__list_issue_statuses with teamId: "{state.team_id}" to find the state ID for "{new_status}"
2. Then, use mcp__linear-server__update_issue with:
   - issueId: "{state.task_id}"
   - stateId: [the state ID for "{new_status}" from step 1]

Confirm when done.
"""

    response = await _run_linear_agent(prompt)
    if response:
        state.status = new_status
        state.save(spec_dir)
        print(f"Updated Linear task {state.task_id} to: {new_status}")
        return True

    return False


async def add_linear_comment(
    spec_dir: Path,
    comment: str,
) -> bool:
    """
    Add a comment to the Linear task.

    Args:
        spec_dir: Spec directory with .linear_task.json
        comment: Comment text to add

    Returns:
        True if successful, False otherwise
    """
    if not is_linear_enabled():
        return False

    state = LinearTaskState.load(spec_dir)
    if not state or not state.task_id:
        print("No Linear task found for this spec")
        return False

    # Escape any quotes in the comment
    safe_comment = comment.replace('"', '\\"').replace("\n", "\\n")

    prompt = f"""Add a comment to Linear issue:

Use mcp__linear-server__create_comment with:
- issueId: "{state.task_id}"
- body: "{safe_comment}"

Confirm when done.
"""

    response = await _run_linear_agent(prompt)
    if response:
        print(f"Added comment to Linear task {state.task_id}")
        return True

    return False


# === Convenience functions for specific transitions ===


async def linear_task_started(spec_dir: Path) -> bool:
    """
    Mark task as started (In Progress).
    Called when planner session begins.
    """
    success = await update_linear_status(spec_dir, STATUS_IN_PROGRESS)
    if success:
        await add_linear_comment(spec_dir, "Build started - planning phase initiated")
    return success


async def linear_subtask_completed(
    spec_dir: Path,
    subtask_id: str,
    completed_count: int,
    total_count: int,
) -> bool:
    """
    Record subtask completion as a comment.
    Called after each successful coder session.
    """
    comment = f"Completed {subtask_id} ({completed_count}/{total_count} subtasks done)"
    return await add_linear_comment(spec_dir, comment)


async def linear_subtask_failed(
    spec_dir: Path,
    subtask_id: str,
    attempt: int,
    error_summary: str,
) -> bool:
    """
    Record subtask failure as a comment.
    Called after failed coder session.
    """
    comment = f"Subtask {subtask_id} failed (attempt {attempt}): {error_summary[:200]}"
    return await add_linear_comment(spec_dir, comment)


async def linear_build_complete(spec_dir: Path) -> bool:
    """
    Record build completion, moving to QA.
    Called when all subtasks are completed.
    """
    comment = "All subtasks completed - moving to QA validation"
    return await add_linear_comment(spec_dir, comment)


async def linear_qa_started(spec_dir: Path) -> bool:
    """
    Mark task as In Review for QA phase.
    Called when QA validation loop starts.
    """
    success = await update_linear_status(spec_dir, STATUS_IN_REVIEW)
    if success:
        await add_linear_comment(spec_dir, "QA validation started")
    return success


async def linear_qa_approved(spec_dir: Path) -> bool:
    """
    Record QA approval (stays In Review for human).
    Called when QA approves the build.
    """
    comment = "QA approved - awaiting human review for merge"
    return await add_linear_comment(spec_dir, comment)


async def linear_qa_rejected(
    spec_dir: Path,
    issues_count: int,
    iteration: int,
) -> bool:
    """
    Record QA rejection.
    Called when QA rejects the build.
    """
    comment = f"QA iteration {iteration}: Found {issues_count} issues - applying fixes"
    return await add_linear_comment(spec_dir, comment)


async def linear_qa_max_iterations(spec_dir: Path, iterations: int) -> bool:
    """
    Record QA max iterations reached.
    Called when QA loop exhausts retries.
    """
    comment = f"QA reached max iterations ({iterations}) - needs human intervention"
    return await add_linear_comment(spec_dir, comment)


async def linear_task_stuck(
    spec_dir: Path,
    subtask_id: str,
    attempt_count: int,
) -> bool:
    """
    Record that a subtask is stuck.
    Called when subtask exceeds retry limit.
    """
    comment = f"Subtask {subtask_id} is STUCK after {attempt_count} attempts - needs human review"
    return await add_linear_comment(spec_dir, comment)

"""
Planning Mode Agent
===================

Restricted agent for INITIAL task planning phase (Task Lifecycle V2 - Phase 3).
This agent runs when a task is first created (status: 'planning') and allows
interactive conversation with the user while creating spec.md and implementation_plan.json.

Key Differences from planner.py:
- planner.py: Creates implementation plan from existing spec.md (after spec creation)
- planning_agent.py: Interactive agent at task creation, creates both spec.md AND plan

Capabilities:
- Read any file in the codebase (for context)
- Create/edit spec.md and implementation_plan.json
- Create/edit files in memories/ directory (Anthropic memory tool)
- Create/edit files in docs/ directory
- Respond to user chat messages
- Search codebase (grep, glob)
- WebFetch/WebSearch for documentation

CANNOT:
- Execute subtasks
- Run bash commands (except safe read-only)
- Edit production code files
- Run builds or tests
- Make commits

Uses Anthropic memory tool (memory_20250818) for conversation persistence.
Memory files are stored in spec_dir/memories/ and auto-loaded on session resume.
"""

import asyncio
import logging
from pathlib import Path
from typing import Optional

from core.client import create_client
from phase_config import get_phase_model, get_phase_thinking_budget
from phase_event import ExecutionPhase, emit_phase
from task_logger import LogPhase, get_task_logger
from ui import (
    BuildState,
    Icons,
    StatusManager,
    bold,
    box,
    highlight,
    icon,
    muted,
    print_status,
)

from .memory_handlers import MemoryHandlers
from .session import run_agent_session
from .user_message_queue import get_message_queue

logger = logging.getLogger(__name__)


async def run_planning_agent(
    project_dir: Path,
    spec_dir: Path,
    task_description: str,
    model: str,
    verbose: bool = False,
) -> bool:
    """
    Run the interactive planning agent for initial task planning.

    This agent:
    1. Reads and understands the task description
    2. Explores the codebase for relevant context
    3. Discusses requirements with the user (via chat)
    4. Creates spec.md and implementation_plan.json
    5. Saves conversation context to memory for later phases

    The agent runs continuously until:
    - User approves the plan and clicks "Start Build" (transitions to coding)
    - User stops the agent manually

    Memory tool is enabled for conversation persistence:
    - On start: Checks /memories for prior context
    - During session: Saves key decisions, discoveries, requirements
    - On end: Memory already contains full context for coding phase

    Args:
        project_dir: Root directory for the project (main repo or worktree)
        spec_dir: Directory for this task's spec files
        task_description: Initial task description from user
        model: Claude model to use (respects task_metadata.json)
        verbose: Whether to show detailed output

    Returns:
        bool: True if planning completed successfully (spec.md exists), False on error
    """
    # Initialize status manager for UI updates
    status_manager = StatusManager(project_dir)
    status_manager.set_active(spec_dir.name, BuildState.PLANNING)
    emit_phase(ExecutionPhase.PLANNING, "Interactive planning")

    # Initialize task logger for persistent logging
    task_logger = get_task_logger(spec_dir)

    # Initialize memory handlers for the Anthropic memory tool
    memory_handlers = MemoryHandlers(spec_dir)

    # Show header
    content = [
        bold(f"{icon(Icons.GEAR)} PLANNING SESSION"),
        "",
        f"Task: {highlight(task_description[:100])}{'...' if len(task_description) > 100 else ''}",
        muted("I'll help you plan this task by exploring the codebase and creating a spec."),
        "",
        muted("You can chat with me to discuss requirements and refine the plan."),
        muted("When ready, click 'Start Build' to begin implementation."),
    ]
    print()
    print(box(content, width=70, style="heavy"))
    print()

    # Start planning phase in task logger
    if task_logger:
        task_logger.start_phase(LogPhase.PLANNING, "Starting interactive planning...")
        task_logger.set_session(1)

    # Initialize user message queue for real-time chat
    message_queue = None
    try:
        message_queue = get_message_queue()
        message_queue.start(asyncio.get_event_loop())
    except Exception as e:
        print_status(f"Warning: Could not initialize message queue: {e}", "warning")
        message_queue = None

    # Get phase-specific model and thinking level
    planning_model = get_phase_model(spec_dir, "planning", model)
    planning_thinking_budget = get_phase_thinking_budget(spec_dir, "planning")

    # Create client with planning agent configuration
    # Uses "planning" agent_type which restricts tools and enables memory
    client = create_client(
        project_dir,
        spec_dir,
        planning_model,
        agent_type="planning",  # Key: uses the planning config from AGENT_CONFIGS
        max_thinking_tokens=planning_thinking_budget,
    )

    # Generate initial prompt with task description
    prompt = _generate_planning_prompt(spec_dir, project_dir, task_description, memory_handlers)

    session_num = 0
    user_feedback = ""

    try:
        while True:
            session_num += 1

            # Check for user messages from frontend chat
            user_messages = []
            if message_queue:
                try:
                    user_messages = await message_queue.get_all_messages()
                except Exception as e:
                    logger.warning(f"Error reading user messages: {e}")

            if user_messages:
                user_feedback = "\n\n## User Message\n"
                user_feedback += "The user has sent the following message(s). Please respond:\n\n"
                for msg in user_messages:
                    user_feedback += f"**User** ({msg.timestamp.strftime('%H:%M:%S')}): {msg.content}\n\n"
                print_status(f"Received {len(user_messages)} message(s) from user", "info")

            # Inject user feedback into prompt if any
            current_prompt = prompt
            if user_feedback:
                current_prompt = prompt + user_feedback
                user_feedback = ""  # Clear after injecting

            # Update status for this session
            status_manager.update_session(session_num)

            # Run planning session
            print_status(f"Planning session {session_num}...", "progress")
            async with client:
                status, response = await run_agent_session(
                    client, current_prompt, spec_dir, verbose, phase=LogPhase.PLANNING
                )

            # Check if planning is complete (spec.md and implementation_plan.json exist)
            spec_file = spec_dir / "spec.md"
            plan_file = spec_dir / "implementation_plan.json"

            if spec_file.exists() and plan_file.exists():
                # Planning complete - wait for user to approve
                print()
                content = [
                    bold(f"{icon(Icons.SUCCESS)} PLANNING COMPLETE"),
                    "",
                    f"Spec: {highlight('spec.md')} - Created",
                    f"Plan: {highlight('implementation_plan.json')} - Created",
                    "",
                    muted("Review the plan and click 'Start Build' when ready."),
                    muted("You can continue chatting to refine the plan."),
                ]
                print(box(content, width=70, style="heavy"))
                print()
                status_manager.update(state=BuildState.PAUSED)

                if task_logger:
                    task_logger.end_phase(
                        LogPhase.PLANNING,
                        success=True,
                        message="Planning complete - awaiting user approval",
                    )

                # Don't exit - continue listening for user messages
                # The frontend will transition to coding when user clicks "Start Build"

            if status == "error":
                print_status("Planning session error, will retry...", "warning")
                await asyncio.sleep(2)
                continue

            if status == "complete":
                # Agent indicated it's done (rare - usually waits for user)
                break

            # Continue waiting for user input
            # In a real implementation, this would block until user sends a message
            # For now, we'll use a simple sleep and check loop
            await asyncio.sleep(1)

            # Regenerate prompt for continued conversation
            prompt = _generate_continuation_prompt(spec_dir, memory_handlers)

    except asyncio.CancelledError:
        # Don't catch cancellation - let it propagate for proper cleanup
        logger.info("Planning agent cancelled")
        raise

    except KeyboardInterrupt:
        print_status("Planning interrupted by user", "warning")
        if task_logger:
            task_logger.end_phase(
                LogPhase.PLANNING,
                success=False,
                message="Planning interrupted by user",
            )
        return False

    except Exception as e:
        # Log with full context for debugging
        logger.error("Planning agent error: %s", e, exc_info=True)
        print_status(f"Planning error: {e}", "error")
        if task_logger:
            task_logger.log_error(f"Planning error: {e}", LogPhase.PLANNING)
        status_manager.update(state=BuildState.ERROR)
        return False

    finally:
        if message_queue:
            message_queue.stop()

    # Check if we have valid outputs
    spec_file = spec_dir / "spec.md"
    return spec_file.exists()


def _load_project_learnings(project_dir: Path) -> str:
    """
    Load LEARNINGS.md from project root if it exists.
    SUG-23: Persistent Learning Memory
    """
    learnings_file = project_dir / "LEARNINGS.md"
    if not learnings_file.exists():
        return ""

    try:
        content = learnings_file.read_text(encoding="utf-8")
        # Extract just the learning entries (skip header)
        if "---" in content:
            parts = content.split("---", 1)
            if len(parts) > 1:
                learnings_section = parts[1].strip()
                if learnings_section and "No learnings recorded yet" not in learnings_section:
                    return f"""
## Project Learnings

The following learnings have been captured from previous tasks. Apply these patterns:

{learnings_section}

"""
        return ""
    except Exception as e:
        logger.warning(f"Failed to load LEARNINGS.md: {e}")
        return ""


def _generate_planning_prompt(
    spec_dir: Path,
    project_dir: Path,
    task_description: str,
    memory_handlers: MemoryHandlers,
) -> str:
    """
    Generate the initial planning prompt with task description and memory context.
    """
    # Check for existing memory from prior sessions
    memory_content = memory_handlers.view("/memories")
    has_prior_context = memory_content and "does not exist" not in memory_content.lower() and "empty" not in memory_content.lower()

    # SUG-23: Load project learnings
    learnings = _load_project_learnings(project_dir)

    prompt_parts = [
        "# Planning Session",
        "",
    ]

    # Inject learnings if available
    if learnings:
        prompt_parts.append(learnings)

    prompt_parts.extend([
        "## Task Description",
        "",
        task_description,
        "",
    ])

    if has_prior_context:
        prompt_parts.extend([
            "## Prior Session Context",
            "",
            "I found the following context from a previous planning session:",
            "",
            memory_content,
            "",
            "Please review this context and continue where we left off.",
            "",
        ])
    else:
        prompt_parts.extend([
            "## Instructions",
            "",
            "This is a new planning session. Your job is to:",
            "",
            "1. **Understand the Task**: Analyze what the user wants to build",
            "2. **Explore the Codebase**: Search for relevant files, patterns, and dependencies",
            "3. **Discuss with User**: Ask clarifying questions if needed",
            "4. **Create spec.md**: Document the detailed specification",
            "5. **Create implementation_plan.json**: Break down into subtasks",
            "",
            "### Memory Usage",
            "",
            "Use the memory tool to save important context:",
            "- User requirements and decisions",
            "- Codebase discoveries (patterns, conventions)",
            "- Design decisions and rationale",
            "",
            "This ensures context is preserved if the session is interrupted.",
            "",
            "### Important Notes",
            "",
            "- You CANNOT run bash commands or execute code",
            "- Focus on planning and documentation only",
            "- Ask the user for clarification when requirements are unclear",
            "- The user will click 'Start Build' when they're ready to begin coding",
            "",
        ])

    return "\n".join(prompt_parts)


def _generate_continuation_prompt(spec_dir: Path, memory_handlers: MemoryHandlers) -> str:
    """
    Generate a continuation prompt for ongoing planning conversation.
    """
    # Load memory context
    memory_content = memory_handlers.view("/memories")

    prompt_parts = [
        "# Continuing Planning Session",
        "",
        "You are continuing a planning session. Here's your saved context:",
        "",
    ]

    if memory_content and "does not exist" not in memory_content.lower():
        prompt_parts.extend([
            memory_content,
            "",
        ])
    else:
        prompt_parts.extend([
            "(No prior context found - this may be a fresh continuation)",
            "",
        ])

    prompt_parts.extend([
        "## Current Files",
        "",
    ])

    # Check what files exist
    spec_file = spec_dir / "spec.md"
    plan_file = spec_dir / "implementation_plan.json"

    if spec_file.exists():
        prompt_parts.append(f"- spec.md: EXISTS ({spec_file.stat().st_size} bytes)")
    else:
        prompt_parts.append("- spec.md: NOT CREATED YET")

    if plan_file.exists():
        prompt_parts.append(f"- implementation_plan.json: EXISTS ({plan_file.stat().st_size} bytes)")
    else:
        prompt_parts.append("- implementation_plan.json: NOT CREATED YET")

    prompt_parts.extend([
        "",
        "Continue assisting the user with planning. Wait for their input or questions.",
        "",
    ])

    return "\n".join(prompt_parts)

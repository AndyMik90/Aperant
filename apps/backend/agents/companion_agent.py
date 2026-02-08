"""
Companion Agent Module
======================

Provides a read-only conversational interface for users between task phases.
The companion agent loads task context and answers questions using Read/Glob/Grep tools only.
"""

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any, Optional

from core.client import create_client
from phase_config import COMPANION_CONFIG, resolve_model_id

from .user_message_queue import UserMessageQueue, get_message_queue

logger = logging.getLogger(__name__)


class CompanionAgent:
    """
    Read-only conversational agent that provides task context and answers questions.

    The companion runs between execution phases to help users understand task state,
    review specs, and prepare for the next phase. It has access to Read/Glob/Grep
    tools only - no write/edit capabilities.
    """

    def __init__(
        self,
        spec_dir: Path,
        project_dir: Path,
        task_title: str,
        current_phase: str,
        supervisor_mode: bool = False,
    ):
        """
        Initialize the companion agent.

        Args:
            spec_dir: Directory containing spec files
            project_dir: Root project directory
            task_title: Title of the task
            current_phase: Current phase (spec_complete, planning, coding_complete, qa_complete, human_review)
            supervisor_mode: If True, runs as live supervisor alongside coder agent
        """
        self.spec_dir = Path(spec_dir)
        self.project_dir = Path(project_dir)
        self.task_title = task_title
        self.current_phase = current_phase
        self.supervisor_mode = supervisor_mode
        self.message_queue: Optional[UserMessageQueue] = None

    def build_context(self) -> str:
        """
        Build task context from available spec files.

        Reads spec.md, implementation_plan.json, qa_report.md, task_metadata.json,
        and context.json from spec_dir. Each file is optional - only includes what exists.

        Returns:
            Formatted string with section headers
        """
        context_parts = []

        # Task header
        context_parts.append(f"# Task: {self.task_title}")
        context_parts.append(f"Current Phase: {self.current_phase}")
        context_parts.append("")

        # Load spec.md
        spec_file = self.spec_dir / "spec.md"
        if spec_file.exists():
            try:
                spec_content = spec_file.read_text(encoding="utf-8")
                context_parts.append("## Specification")
                context_parts.append(spec_content)
                context_parts.append("")
            except Exception as e:
                logger.debug(f"Failed to read spec.md: {e}")

        # Load implementation_plan.json
        plan_file = self.spec_dir / "implementation_plan.json"
        if plan_file.exists():
            try:
                plan_content = plan_file.read_text(encoding="utf-8")
                plan_data = json.loads(plan_content)
                context_parts.append("## Implementation Plan")
                context_parts.append(f"Status: {plan_data.get('status', 'unknown')}")

                phases = plan_data.get("phases", [])
                if phases:
                    context_parts.append(f"\nPhases ({len(phases)} total):")
                    for phase in phases:
                        phase_name = phase.get("name", "Unknown")
                        subtasks = phase.get("subtasks", [])
                        completed = sum(1 for st in subtasks if st.get("status") == "completed")
                        total = len(subtasks)
                        context_parts.append(f"  - {phase_name}: {completed}/{total} subtasks completed")
                context_parts.append("")
            except Exception as e:
                logger.debug(f"Failed to read implementation_plan.json: {e}")

        # Load qa_report.md
        qa_file = self.spec_dir / "qa_report.md"
        if qa_file.exists():
            try:
                qa_content = qa_file.read_text(encoding="utf-8")
                context_parts.append("## QA Report")
                context_parts.append(qa_content)
                context_parts.append("")
            except Exception as e:
                logger.debug(f"Failed to read qa_report.md: {e}")

        # Load task_metadata.json
        metadata_file = self.spec_dir / "task_metadata.json"
        if metadata_file.exists():
            try:
                metadata_content = metadata_file.read_text(encoding="utf-8")
                metadata = json.loads(metadata_content)
                context_parts.append("## Task Metadata")
                context_parts.append(f"Created: {metadata.get('created_at', 'unknown')}")
                if "model_overrides" in metadata:
                    context_parts.append(f"Model overrides: {metadata['model_overrides']}")
                context_parts.append("")
            except Exception as e:
                logger.debug(f"Failed to read task_metadata.json: {e}")

        # Load ralph_prompt.md
        ralph_file = self.spec_dir / "ralph_prompt.md"
        if ralph_file.exists():
            try:
                ralph_content = ralph_file.read_text(encoding="utf-8")
                context_parts.append("== RALPH CODING PROMPT ==")
                context_parts.append(ralph_content)
                context_parts.append("")
            except Exception as e:
                logger.debug(f"Failed to read ralph_prompt.md: {e}")

        # Load context.json
        context_file = self.spec_dir / "context.json"
        if context_file.exists():
            try:
                context_content = context_file.read_text(encoding="utf-8")
                context_data = json.loads(context_content)
                context_parts.append("## Codebase Context")

                # Summarize discovered files
                files = context_data.get("files", [])
                if files:
                    context_parts.append(f"Discovered {len(files)} relevant files")

                # Show key patterns
                patterns = context_data.get("patterns", [])
                if patterns:
                    context_parts.append(f"Identified {len(patterns)} patterns")

                context_parts.append("")
            except Exception as e:
                logger.debug(f"Failed to read context.json: {e}")

        return "\n".join(context_parts)

    def build_system_prompt(self) -> str:
        """
        Build system prompt with task context and instructions.

        Returns:
            System prompt for the companion/supervisor agent
        """
        context = self.build_context()

        if self.supervisor_mode:
            prompt = f"""You are a live supervisor agent monitoring an active coding session for the Auto-Claude task automation system.

A coding agent is currently implementing this task. You observe its progress and answer user questions about what is happening. You are in READ-ONLY mode.

{context}

## Your Capabilities

You have access to:
- **get_build_progress**: Check which subtasks are completed, in progress, and remaining
- **Read**: Read file contents to examine code being written
- **Glob**: Find files by pattern
- **Grep**: Search for text patterns in files

You DO NOT have access to Write, Edit, Bash, or Task tools. You cannot modify the build.

## Guidelines

1. **Answer "what are you doing?"**: Use get_build_progress to check current subtask status and report clearly
2. **Be concise**: The user is multitasking — give brief, direct answers
3. **Show progress**: Report completed/total subtasks, percentage, current subtask name
4. **Read code when asked**: If they ask about specific changes, use Read/Grep to check the actual files
5. **Don't interfere**: You observe and report — the coding agent handles implementation

## Current Context

Phase: {self.current_phase} (LIVE - coding agent is actively running)
Task: {self.task_title}
"""
        else:
            prompt = f"""You are a helpful companion agent for the Auto-Claude task automation system.

Your role is to help the user understand the current task state and answer questions about the task context. You are in READ-ONLY mode - you can read and analyze files but cannot make changes.

{context}

## Your Capabilities

You have access to the following tools:
- **get_build_progress**: Check subtask completion status
- **Read**: Read file contents to examine code, specs, or documentation
- **Glob**: Find files by pattern (e.g., "**/*.py")
- **Grep**: Search for text patterns in files

You DO NOT have access to Write, Edit, Bash, or Task tools.

## Guidelines

1. **Be conversational and helpful**: Answer questions clearly and provide relevant context
2. **Use tools when needed**: If the user asks about specific files or code, use Read/Glob/Grep to provide accurate information
3. **Stay focused on the task**: Your context is limited to this specific task - you can't modify other tasks or system settings
4. **Be honest about limitations**: If you can't perform an action (like editing files), explain why
5. **Provide actionable insights**: Help users understand what needs to happen next in the task workflow

## Current Context

Phase: {self.current_phase}
Task: {self.task_title}

The user can ask you questions about the task, review the specification, check implementation progress, or explore the codebase. Answer their questions and help them understand the task state.
"""
        return prompt

    async def run(self) -> None:
        """
        Run the companion agent session.

        Creates SDK client, initializes message queue, prints ready message,
        then loops: wait for user message, send to Claude, stream response.
        """
        # Get config from phase_config
        config = COMPANION_CONFIG
        model = resolve_model_id(config.get("model", "opus"))
        thinking_budget = config.get("thinking_budget", 2048)
        max_turns = config.get("max_turns", 25)

        logger.info(f"Starting companion agent for task: {self.task_title}")
        logger.info(f"Phase: {self.current_phase}")
        logger.info(f"Model: {model}, Thinking budget: {thinking_budget}")

        # Create SDK client with read-only tools
        try:
            client = create_client(
                project_dir=self.project_dir,
                spec_dir=self.spec_dir,
                model=model,
                agent_type="companion",  # Will use companion config from AGENT_CONFIGS
                max_thinking_tokens=thinking_budget,
            )
        except Exception as e:
            logger.error(f"Failed to create SDK client: {e}")
            self._emit_error(f"Failed to initialize companion agent: {e}")
            return

        # Initialize message queue
        self.message_queue = get_message_queue()
        loop = asyncio.get_event_loop()
        self.message_queue.start(loop)

        # Print ready message (frontend waits for this)
        print("\n__COMPANION_READY__\n", flush=True)
        logger.info("Companion agent ready for messages")

        # Build system prompt
        system_prompt = self.build_system_prompt()

        # Conversational loop
        turn_count = 0
        conversation_history = []

        try:
            while turn_count < max_turns:
                # Wait for user message
                user_message = await self._wait_for_message()

                if user_message is None:
                    # Timeout or no messages - this is normal, just check again
                    await asyncio.sleep(0.1)
                    continue

                turn_count += 1
                logger.info(f"Turn {turn_count}/{max_turns}: Processing user message")

                # Add user message to conversation
                conversation_history.append({
                    "role": "user",
                    "content": user_message
                })

                # Send to Claude SDK
                try:
                    # Emit message start marker
                    self._emit_message_start(user_message)

                    # FIX-031: Each message creates a fresh SDK session. The
                    # conversation_history list maintains context in Python memory,
                    # but the SDK session has no memory of prior turns. To enable
                    # true multi-turn conversations, either pass conversation_history
                    # as prior messages in the system prompt, or switch to a
                    # persistent SDK session that accumulates messages.
                    response = client.create_agent_session(
                        name=f"companion-{self.current_phase}",
                        starting_message=user_message,
                        system_prompt=system_prompt,
                    )

                    # Stream response through SDK markers
                    self._emit_response(response)

                    # Add assistant response to history (for multi-turn context)
                    conversation_history.append({
                        "role": "assistant",
                        "content": str(response)
                    })

                except Exception as e:
                    logger.error(f"Error during agent session: {e}")
                    self._emit_error(f"Error processing message: {e}")

        except KeyboardInterrupt:
            logger.info("Companion agent interrupted by user")
        except Exception as e:
            logger.error(f"Unexpected error in companion loop: {e}")
            self._emit_error(f"Unexpected error: {e}")
        finally:
            # Cleanup
            if self.message_queue:
                self.message_queue.stop()
            logger.info(f"Companion agent finished after {turn_count} turns")

    async def _wait_for_message(self) -> Optional[str]:
        """
        Wait for a user message from the queue.

        Returns:
            User message content, or None if timeout
        """
        if not self.message_queue:
            return None

        # Wait up to 1 second for a message
        message = await self.message_queue.get_message(timeout=1.0)

        if message:
            return message.content

        return None

    def _emit_message_start(self, content: str) -> None:
        """Emit SDK marker for user message."""
        try:
            payload = {
                "type": "user_message",
                "content": content
            }
            print(f"__SDK_MSG__:{json.dumps(payload)}", flush=True)
        except Exception as e:
            logger.debug(f"Failed to emit message start: {e}")

    def _emit_response(self, response: Any) -> None:
        """Emit SDK marker for assistant response."""
        try:
            # Convert response to string
            response_text = str(response)

            payload = {
                "type": "assistant_message",
                "content": response_text
            }
            print(f"__SDK_MSG__:{json.dumps(payload)}", flush=True)
        except Exception as e:
            logger.debug(f"Failed to emit response: {e}")

    def _emit_error(self, error: str) -> None:
        """Emit SDK marker for error."""
        try:
            payload = {
                "type": "error",
                "error": error
            }
            print(f"__SDK_MSG__:{json.dumps(payload)}", flush=True)
        except Exception as e:
            logger.debug(f"Failed to emit error: {e}")

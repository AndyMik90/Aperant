"""
Agent Session Management
========================

Handles running agent sessions and post-session processing including
memory updates, recovery tracking, and Linear integration.

SDK Message Streaming:
This module emits __SDK_MSG__ markers for the rich task monitor UI.
See docs/TASK_MONITOR_ARCHITECTURE.md for details.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from claude_agent_sdk import ClaudeSDKClient
from debug import debug, debug_detailed, debug_error, debug_section, debug_success
from insight_extractor import extract_session_insights
from linear_updater import (
    linear_subtask_completed,
    linear_subtask_failed,
)
from core.file_utils import write_json_atomic
from progress import (
    count_subtasks_detailed,
    is_build_complete,
)
from recovery import RecoveryManager
from security.tool_input_validator import get_safe_tool_input
from task_logger import LogPhase
from ui import (
    StatusManager,
    muted,
    print_key_value,
    print_status,
)

from .memory_handlers import MemoryHandlers
from .memory_manager import save_session_memory
from .user_message_queue import (
    UserMessageQueue,
    is_control_command,
    is_pause_command,
    is_stop_command,
)
from .utils import (
    find_subtask_in_plan,
    get_commit_count,
    get_latest_commit,
    load_implementation_plan,
    sync_spec_to_source,
)

# Type hint for drift monitor (optional dependency)
try:
    from drift import AgentMonitor
except ImportError:
    AgentMonitor = None

logger = logging.getLogger(__name__)


def emit_sdk_msg(msg_type: str, data: dict[str, Any]) -> None:
    """
    Emit an SDK message marker for the rich task monitor UI.

    Format: __SDK_MSG__:{"type": "...", ...data}

    This is parsed by the frontend's sdk-output-parser.ts to render
    Claude Code-style UI components (thinking blocks, diffs, etc.)
    """
    try:
        payload = {"type": msg_type, **data}
        print(f"__SDK_MSG__:{json.dumps(payload)}", flush=True)
    except Exception as e:
        # SWEEP-10: Log SDK emission failures at debug level
        logger.debug("[Session] SDK message emission failed for type %s: %s", msg_type, e)


async def _background_enrichment(
    spec_dir: Path,
    project_dir: Path,
    subtask_id: str,
    session_num: int,
    commit_before: str | None,
    commit_after: str | None,
    success: bool,
    recovery_manager: RecoveryManager,
    linear_enabled: bool = False,
) -> None:
    """
    Background enrichment: insight extraction, memory saves, Linear updates.

    Runs as a fire-and-forget asyncio task so the next subtask can start immediately.
    None of this work blocks the critical path.
    """
    try:
        # Linear update
        if linear_enabled:
            try:
                if success:
                    subtasks_detail = count_subtasks_detailed(spec_dir)
                    await linear_subtask_completed(
                        spec_dir=spec_dir,
                        subtask_id=subtask_id,
                        completed_count=subtasks_detail["completed"],
                        total_count=subtasks_detail["total"],
                    )
                else:
                    attempt_count = recovery_manager.get_attempt_count(subtask_id)
                    await linear_subtask_failed(
                        spec_dir=spec_dir,
                        subtask_id=subtask_id,
                        attempt=attempt_count,
                        error_summary="Session ended without completion",
                    )
            except Exception as e:
                logger.debug(f"[Background] Linear update failed: {e}")

        # Extract insights (LLM call — the expensive part)
        extracted_insights = None
        try:
            extracted_insights = await extract_session_insights(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                commit_before=commit_before,
                commit_after=commit_after,
                success=success,
                recovery_manager=recovery_manager,
            )
            if success and extracted_insights:
                insight_count = len(extracted_insights.get("file_insights", []))
                pattern_count = len(extracted_insights.get("patterns_discovered", []))
                if insight_count > 0 or pattern_count > 0:
                    logger.info(
                        f"[Background] Extracted {insight_count} insights, {pattern_count} patterns for {subtask_id}"
                    )
        except Exception as e:
            logger.debug(f"[Background] Insight extraction failed: {e}")

        # Save session memory (Graphiti or file-based)
        try:
            save_success, storage_type = await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                success=success,
                subtasks_completed=[subtask_id] if success else [],
                discoveries=extracted_insights,
            )
            if save_success:
                logger.info(f"[Background] Memory saved ({storage_type}) for {subtask_id}")
        except Exception as e:
            logger.debug(f"[Background] Memory save failed: {e}")

        # Promote patterns/gotchas to project-level memory
        if extracted_insights:
            try:
                from memory.project_memory import append_to_project_memory

                for pattern in extracted_insights.get("patterns_discovered", []):
                    append_to_project_memory(
                        project_dir, "patterns", pattern, f"Task {subtask_id}"
                    )
                for gotcha in extracted_insights.get("gotchas_discovered", []):
                    append_to_project_memory(
                        project_dir, "gotchas", gotcha, f"Task {subtask_id}"
                    )
            except Exception as e:
                logger.debug(f"[Background] Failed to promote insights: {e}")

    except Exception as e:
        logger.warning(f"[Background] Enrichment failed for {subtask_id}: {e}")


async def post_session_processing(
    spec_dir: Path,
    project_dir: Path,
    subtask_id: str,
    session_num: int,
    commit_before: str | None,
    commit_count_before: int,
    recovery_manager: RecoveryManager,
    linear_enabled: bool = False,
    status_manager: StatusManager | None = None,
    source_spec_dir: Path | None = None,
) -> bool:
    """
    Process session results — fast critical-path only.

    Critical path (synchronous): status check, recovery tracking, commit tracking.
    Expensive work (background): insight extraction, memory saves, Linear updates.

    Returns immediately after determining success/failure so the next subtask
    can start without waiting for LLM insight extraction or network calls.
    """
    print()
    print(muted("--- Post-Session Processing ---"))

    # Sync implementation plan back to source (for worktree mode)
    if sync_spec_to_source(spec_dir, source_spec_dir):
        print_status("Implementation plan synced to main project", "success")

    # Check if implementation plan was updated
    plan = load_implementation_plan(spec_dir)
    if not plan:
        print("  Warning: Could not load implementation plan")
        return False

    subtask = find_subtask_in_plan(plan, subtask_id)
    if not subtask:
        print(f"  Warning: Subtask {subtask_id} not found in plan")
        return False

    subtask_status = subtask.get("status", "pending")

    # Check for new commits
    commit_after = get_latest_commit(project_dir)
    commit_count_after = get_commit_count(project_dir)
    new_commits = commit_count_after - commit_count_before

    print_key_value("Subtask status", subtask_status)
    print_key_value("New commits", str(new_commits))

    if subtask_status == "completed":
        # Success! Record the attempt and good commit (fast, critical)
        print_status(f"Subtask {subtask_id} completed successfully", "success")

        if status_manager:
            subtasks = count_subtasks_detailed(spec_dir)
            status_manager.update_subtasks(
                completed=subtasks["completed"],
                total=subtasks["total"],
                in_progress=0,
            )

        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=True,
            approach=f"Implemented: {subtask.get('description', 'subtask')[:100]}",
        )

        if commit_after and commit_after != commit_before:
            recovery_manager.record_good_commit(commit_after, subtask_id)
            print_status(f"Recorded good commit: {commit_after[:8]}", "success")

        # Fire background enrichment (don't block next subtask)
        asyncio.create_task(_background_enrichment(
            spec_dir=spec_dir,
            project_dir=project_dir,
            subtask_id=subtask_id,
            session_num=session_num,
            commit_before=commit_before,
            commit_after=commit_after,
            success=True,
            recovery_manager=recovery_manager,
            linear_enabled=linear_enabled,
        ))
        print_status("Background enrichment started", "info")

        return True

    elif subtask_status == "in_progress":
        # Session ended without completion — reset subtask to pending so it can be retried
        print_status(f"Subtask {subtask_id} still in progress", "warning")

        # Reset subtask status to pending so it will be picked up on next run.
        # Reload the plan fresh to avoid clobbering concurrent changes.
        # NOTE: If this write fails, the subtask stays in_progress forever and the
        # auto-continue loop would retry it infinitely. We must propagate the error.
        plan_file = spec_dir / "implementation_plan.json"
        try:
            fresh_plan = load_implementation_plan(spec_dir)
            if fresh_plan:
                fresh_subtask = find_subtask_in_plan(fresh_plan, subtask_id)
                if fresh_subtask and fresh_subtask.get("status") == "in_progress":
                    fresh_subtask["status"] = "pending"
                    write_json_atomic(plan_file, fresh_plan, indent=2)
                    print_status(f"Reset subtask {subtask_id} from in_progress to pending", "info")
        except Exception as e:
            logger.error(f"CRITICAL: Failed to reset subtask {subtask_id} to pending: {e}")
            print_status(
                f"CRITICAL: Could not reset subtask {subtask_id} — plan file may be corrupted. "
                "Halting auto-continue to prevent infinite retry loop.",
                "error",
            )
            raise

        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=False,
            approach="Session ended with subtask in_progress",
            error="Subtask not marked as completed",
        )

        if commit_after and commit_after != commit_before:
            recovery_manager.record_good_commit(commit_after, subtask_id)
            print_status(
                f"Recorded partial progress commit: {commit_after[:8]}", "info"
            )

        # Fire background enrichment for failed session too
        asyncio.create_task(_background_enrichment(
            spec_dir=spec_dir,
            project_dir=project_dir,
            subtask_id=subtask_id,
            session_num=session_num,
            commit_before=commit_before,
            commit_after=commit_after,
            success=False,
            recovery_manager=recovery_manager,
            linear_enabled=linear_enabled,
        ))

        return False

    else:
        # Subtask still pending or failed
        print_status(
            f"Subtask {subtask_id} not completed (status: {subtask_status})", "error"
        )

        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=False,
            approach="Session ended without progress",
            error=f"Subtask status is {subtask_status}",
        )

        # Record Linear session result (if enabled)
        if linear_enabled:
            attempt_count = recovery_manager.get_attempt_count(subtask_id)
            await linear_subtask_failed(
                spec_dir=spec_dir,
                subtask_id=subtask_id,
                attempt=attempt_count,
                error_summary=f"Subtask status: {subtask_status}",
            )

        # Extract insights even from completely failed sessions
        try:
            extracted_insights = await extract_session_insights(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                commit_before=commit_before,
                commit_after=commit_after,
                success=False,
                recovery_manager=recovery_manager,
            )
        except Exception as e:
            logger.debug(f"[Session] Insight extraction failed for failed session: {e}")
            extracted_insights = None

        # Save failed session memory (to track what didn't work)
        try:
            await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                success=False,
                subtasks_completed=[],
                discoveries=extracted_insights,
            )
        except Exception as e:
            logger.debug(f"[Session] Failed to save failed session memory: {e}")

        return False


async def run_agent_session(
    client: ClaudeSDKClient,
    message: str,
    spec_dir: Path,
    verbose: bool = False,
    phase: LogPhase = LogPhase.CODING,
    message_queue: UserMessageQueue | None = None,
    drift_monitor: "AgentMonitor | None" = None,
) -> tuple[str, str]:
    """
    Run a single agent session using Claude Agent SDK with interruptible execution.

    Args:
        client: Claude SDK client
        message: The prompt to send
        spec_dir: Spec directory path
        verbose: Whether to show detailed output
        phase: Current execution phase for logging
        message_queue: Optional message queue for user interrupts during execution
        drift_monitor: Optional drift monitor for behavioral tracking

    Returns:
        (status, response_text) where status is:
        - "continue" if agent should continue working
        - "complete" if all subtasks complete
        - "paused" if user requested pause
        - "stopped" if user requested stop
        - "error" if an error occurred
    """
    debug_section("session", f"Agent Session - {phase.value}")
    debug(
        "session",
        "Starting agent session",
        spec_dir=str(spec_dir),
        phase=phase.value,
        prompt_length=len(message),
        prompt_preview=message[:200] + "..." if len(message) > 200 else message,
    )
    print("Sending prompt to Claude Agent SDK...\n")

    # Track tool state for matching results to tool calls
    current_tool = None
    current_tool_id = None
    current_tool_start_time = None
    message_count = 0
    tool_count = 0

    # Import time for drift tracking and validation
    import time

    # Validate input parameters
    if not message or not isinstance(message, str):
        raise ValueError("[Session] Invalid prompt: message must be a non-empty string")
    if not spec_dir or not spec_dir.exists():
        raise ValueError(f"[Session] Invalid spec directory: {spec_dir}")

    try:
        # Send the query
        debug("session", "Sending query to Claude SDK...")
        await client.query(message)
        debug_success("session", "Query sent successfully")

        # Collect response text and show tool use
        response_text = ""
        debug("session", "Starting to receive response stream...")
        async for msg in client.receive_response():
            msg_type = type(msg).__name__
            message_count += 1
            debug_detailed(
                "session",
                f"Received message #{message_count}",
                msg_type=msg_type,
            )

            # Handle AssistantMessage (text, thinking, and tool use)
            if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "TextBlock" and hasattr(block, "text"):
                        response_text += block.text
                        # Emit SDK message for rich UI streaming
                        emit_sdk_msg("text", {"content": block.text})
                        # Also print for terminal output
                        print(block.text, end="", flush=True)

                    elif block_type == "ThinkingBlock" and hasattr(block, "thinking"):
                        # NEW: Handle thinking blocks for rich UI
                        thinking_content = block.thinking
                        signature = getattr(block, "signature", "")
                        emit_sdk_msg("thinking", {
                            "content": thinking_content,
                            "signature": signature,
                        })
                        debug(
                            "session",
                            "Thinking block received",
                            thinking_length=len(thinking_content),
                        )

                    elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                        tool_name = block.name
                        tool_count += 1

                        # Get FULL tool input (not truncated!)
                        inp = get_safe_tool_input(block)
                        tool_id = getattr(block, "id", "")

                        # Emit SDK message with FULL input for rich UI streaming
                        emit_sdk_msg("tool_use", {
                            "id": tool_id,
                            "name": tool_name,
                            "input": inp,
                        })

                        debug(
                            "session",
                            f"Tool call #{tool_count}: {tool_name}",
                            tool_id=tool_id,
                            full_input=str(inp)[:500] if inp else None,
                        )

                        # Track current tool for result matching and drift monitoring
                        current_tool = tool_name
                        current_tool_id = tool_id
                        current_tool_start_time = time.time()

            # Handle UserMessage (tool results)
            elif msg_type == "UserMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "ToolResultBlock":
                        result_content = getattr(block, "content", "")
                        is_error = getattr(block, "is_error", False)
                        tool_use_id = getattr(block, "tool_use_id", "")

                        # Emit SDK message with FULL result for rich UI
                        # Truncate very large results (>100KB) to prevent JSON issues
                        result_str = str(result_content)
                        if len(result_str) > 102400:
                            result_str = result_str[:102400] + f"\n\n... [truncated - {len(str(result_content))} chars total]"

                        emit_sdk_msg("tool_result", {
                            "tool_use_id": tool_use_id,
                            "name": current_tool or "",
                            "content": result_str,
                            "is_error": is_error,
                        })

                        # Debug logging
                        if is_error:
                            debug_error(
                                "session",
                                f"Tool error: {current_tool}",
                                error=str(result_content)[:200],
                            )
                        else:
                            debug_detailed(
                                "session",
                                f"Tool success: {current_tool}",
                                result_length=len(str(result_content)),
                            )

                        # Track tool call in drift monitor
                        if drift_monitor and current_tool:
                            try:
                                duration_ms = (time.time() - current_tool_start_time) * 1000 if current_tool_start_time else 100.0
                                drift_monitor.track_tool(
                                    tool_name=current_tool,
                                    success=not is_error,
                                    duration_ms=duration_ms,
                                )
                                # Emit interim drift report every 10 tool calls
                                if drift_monitor.tool_count % 10 == 0:
                                    interim = drift_monitor.get_interim_report()
                                    if interim:
                                        from phase_event import emit_drift_interim
                                        emit_drift_interim(interim)
                            except Exception as e:
                                logger.debug(f"[Session] Drift tracking failed: {e}")

                        current_tool = None
                        current_tool_start_time = None

                        # PHASE 5: Check for user interrupts after each tool result
                        # This is a safe point - the tool call has completed
                        if message_queue and message_queue.has_messages():
                            user_msgs = await message_queue.get_all_messages()
                            for user_msg in user_msgs:
                                content = user_msg.content.strip()

                                # Check for control commands
                                if is_stop_command(content):
                                    print(f"\n[User interrupt: STOP requested]")
                                    emit_sdk_msg("interrupt", {
                                        "type": "stop",
                                        "message": content,
                                    })
                                    debug(
                                        "session",
                                        "User requested STOP",
                                        message=content,
                                    )
                                    # Save interrupt state to memory
                                    try:
                                        memory_handlers = MemoryHandlers(spec_dir)
                                        memory_handlers.save_interrupt_state(
                                            status="STOPPED",
                                            user_message=content,
                                        )
                                    except Exception as e:
                                        logger.debug(f"[Session] Failed to save interrupt state: {e}")
                                    return "stopped", response_text

                                if is_pause_command(content):
                                    print(f"\n[User interrupt: PAUSE requested]")
                                    emit_sdk_msg("interrupt", {
                                        "type": "pause",
                                        "message": content,
                                    })
                                    debug(
                                        "session",
                                        "User requested PAUSE",
                                        message=content,
                                    )
                                    # Save interrupt state to memory
                                    try:
                                        memory_handlers = MemoryHandlers(spec_dir)
                                        memory_handlers.save_interrupt_state(
                                            status="PAUSED",
                                            user_message=content,
                                        )
                                    except Exception as e:
                                        logger.debug(f"[Session] Failed to save interrupt state: {e}")
                                    return "paused", response_text

                                # Regular message (not a control command)
                                # Save user feedback to memory for the agent to see on next iteration
                                if not is_control_command(content):
                                    print(f"\n[User feedback received: {content[:100]}...]")
                                    emit_sdk_msg("user_feedback", {
                                        "content": content,
                                        "timestamp": user_msg.timestamp.isoformat(),
                                    })
                                    # Save feedback to memory
                                    try:
                                        memory_handlers = MemoryHandlers(spec_dir)
                                        feedback_content = f"## User Feedback ({user_msg.timestamp.strftime('%Y-%m-%d %H:%M:%S')})\n{content}\n\n"
                                        feedback_path = "/memories/user_feedback.md"
                                        if (spec_dir / "memories" / "user_feedback.md").exists():
                                            memory_handlers.insert(feedback_path, 0, feedback_content)
                                        else:
                                            memory_handlers.create(feedback_path, f"# User Feedback Log\n\n{feedback_content}")
                                    except Exception as e:
                                        logger.debug(f"[Session] Failed to save user feedback to memory: {e}")

        print("\n" + "-" * 70 + "\n")

        # Check if build is complete
        if is_build_complete(spec_dir):
            debug_success(
                "session",
                "Session completed - build is complete",
                message_count=message_count,
                tool_count=tool_count,
                response_length=len(response_text),
            )
            return "complete", response_text

        debug_success(
            "session",
            "Session completed - continuing",
            message_count=message_count,
            tool_count=tool_count,
            response_length=len(response_text),
        )
        return "continue", response_text

    except Exception as e:
        # SWEEP-3: Log with full exception details for debugging
        logger.error(
            "Session error: %s: %s",
            type(e).__name__,
            str(e),
            exc_info=True,
            extra={
                "message_count": message_count,
                "tool_count": tool_count,
                "phase": phase.value,
            }
        )
        debug_error(
            "session",
            f"Session error: {e}",
            exception_type=type(e).__name__,
            message_count=message_count,
            tool_count=tool_count,
        )
        # Emit error for rich UI
        emit_sdk_msg("error", {
            "content": f"Session error: {e}",
            "phase": phase.value,
        })
        # Return error with preserved type info for debugging
        error_detail = f"{type(e).__name__}: {str(e)[:200]}"
        print(f"Error during agent session: {error_detail}")
        return "error", error_detail

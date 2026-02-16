"""
SDK Stream Processing Utilities
================================

Shared utilities for processing Claude Agent SDK response streams.

This module extracts common SDK message processing patterns used across
parallel orchestrator and follow-up reviewers.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from typing import Any

try:
    from .io_utils import safe_print
except (ImportError, ValueError, SystemError):
    from core.io_utils import safe_print

logger = logging.getLogger(__name__)

# Check if debug mode is enabled
DEBUG_MODE = os.environ.get("DEBUG", "").lower() in ("true", "1", "yes")


def _short_model_name(model: str | None) -> str:
    """Convert full model name to a short display name for logs.

    Examples:
        claude-sonnet-4-5-20250929 -> sonnet-4.5
        claude-opus-4-5-20251101 -> opus-4.5
        claude-3-5-sonnet-20241022 -> sonnet-3.5
    """
    if not model:
        return "unknown"

    model_lower = model.lower()

    # Handle new model naming (claude-{model}-{version}-{date})
    # Check 1M context variant first (more specific match)
    if "opus-4-6-1m" in model_lower or "opus-4.6-1m" in model_lower:
        return "opus-4.6-1m"
    if "opus-4-6" in model_lower or "opus-4.6" in model_lower:
        return "opus-4.6"
    if "opus-4-5" in model_lower or "opus-4.5" in model_lower:
        return "opus-4.5"
    if "sonnet-4-5" in model_lower or "sonnet-4.5" in model_lower:
        return "sonnet-4.5"
    if "haiku-4" in model_lower:
        return "haiku-4"

    # Handle older model naming (claude-3-5-{model})
    if "3-5-sonnet" in model_lower or "3.5-sonnet" in model_lower:
        return "sonnet-3.5"
    if "3-5-haiku" in model_lower or "3.5-haiku" in model_lower:
        return "haiku-3.5"
    if "3-opus" in model_lower:
        return "opus-3"
    if "3-sonnet" in model_lower:
        return "sonnet-3"
    if "3-haiku" in model_lower:
        return "haiku-3"

    # Fallback: return last part before date (if matches pattern)
    parts = model.split("-")
    if len(parts) >= 2:
        # Try to find model type (opus, sonnet, haiku)
        for i, part in enumerate(parts):
            if part.lower() in ("opus", "sonnet", "haiku"):
                return part.lower()

    return model[:20]  # Truncate if nothing else works


def _get_tool_detail(tool_name: str, tool_input: dict[str, Any]) -> str:
    """Extract meaningful detail from tool input for user-friendly logging.

    Instead of "Using tool: Read", show "Reading sdk_utils.py"
    Instead of "Using tool: Grep", show "Searching for 'pattern'"
    """
    if tool_name == "Read":
        file_path = tool_input.get("file_path", "")
        if file_path:
            # Extract just the filename for brevity
            filename = file_path.split("/")[-1] if "/" in file_path else file_path
            return f"Reading {filename}"
        return "Reading file"

    if tool_name == "Grep":
        pattern = tool_input.get("pattern", "")
        if pattern:
            # Truncate long patterns
            pattern_preview = pattern[:40] + "..." if len(pattern) > 40 else pattern
            return f"Searching for '{pattern_preview}'"
        return "Searching codebase"

    if tool_name == "Glob":
        pattern = tool_input.get("pattern", "")
        if pattern:
            return f"Finding files matching '{pattern}'"
        return "Finding files"

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        if command:
            # Show first part of command
            cmd_preview = command[:50] + "..." if len(command) > 50 else command
            return f"Running: {cmd_preview}"
        return "Running command"

    if tool_name == "Edit":
        file_path = tool_input.get("file_path", "")
        if file_path:
            filename = file_path.split("/")[-1] if "/" in file_path else file_path
            return f"Editing {filename}"
        return "Editing file"

    if tool_name == "Write":
        file_path = tool_input.get("file_path", "")
        if file_path:
            filename = file_path.split("/")[-1] if "/" in file_path else file_path
            return f"Writing {filename}"
        return "Writing file"

    # Default fallback for unknown tools
    return f"Using tool: {tool_name}"


# Circuit breaker threshold - abort if message count exceeds this
# Prevents runaway retry loops from consuming unbounded resources
MAX_MESSAGE_COUNT = 500

# Errors that are recoverable (callers can fall back to text parsing or retry)
# vs fatal errors (auth failures, circuit breaker) that should propagate
RECOVERABLE_ERRORS = {
    "structured_output_validation_failed",
    "tool_use_concurrency_error",
}

# Abort after 1 consecutive repeat (2 total identical responses).
# Low threshold catches error loops quickly (e.g., auth errors returned as AI text).
# Normal AI responses never produce the exact same text block twice in a row.
REPEATED_RESPONSE_THRESHOLD = 1

# Max length for auth error detection - real auth errors are short (~1-2 sentences).
# Longer texts are likely AI discussion about auth topics, not actual errors.
MAX_AUTH_ERROR_LENGTH = 300


def _is_auth_error_response(text: str) -> bool:
    """
    Detect authentication/access error messages returned as AI response text.

    Some API errors are returned as conversational text rather than HTTP errors,
    causing the SDK to treat them as normal assistant responses. This leads to
    infinite retry loops as the conversation ping-pongs between prompts and
    error responses.

    Real auth error responses are short messages (~1-2 sentences). AI discussion
    text that merely mentions auth topics (e.g., PR reviews about auth features)
    is much longer. We skip texts over MAX_AUTH_ERROR_LENGTH chars to avoid
    false positives.

    Args:
        text: AI response text to check

    Returns:
        True if the text is an auth/access error, False otherwise
    """
    text_lower = text.lower().strip()
    # Real auth error responses are short messages, not long AI discussions.
    # Skip texts longer than MAX_AUTH_ERROR_LENGTH to avoid false positives
    # when AI discusses authentication topics (e.g., reviewing a PR about auth).
    if len(text_lower) > MAX_AUTH_ERROR_LENGTH:
        return False
    auth_error_patterns = [
        "please login again",
        # Catches both "does not have access to claude" and partial variants.
        # "account does not have access" was intentionally excluded — it's too
        # broad and can match short AI responses about access control generally.
        # Generic error loops are caught by REPEATED_RESPONSE_THRESHOLD instead.
        "not have access to claude",
    ]
    return any(pattern in text_lower for pattern in auth_error_patterns)


def _is_tool_concurrency_error(text: str) -> bool:
    """
    Detect the specific tool use concurrency error pattern.

    This error occurs when Claude makes multiple parallel tool_use blocks
    and some fail, corrupting the tool_use/tool_result message pairing.

    Args:
        text: Text to check for error pattern

    Returns:
        True if this is the tool concurrency error, False otherwise
    """
    text_lower = text.lower()
    # Check for the specific error message pattern
    # Pattern 1: Explicit concurrency or tool_use errors with 400
    has_400 = "400" in text_lower
    has_tool = "tool" in text_lower

    if has_400 and has_tool:
        # Look for specific keywords indicating tool concurrency issues
        error_keywords = [
            "concurrency",
            "tool_use",
            "tool use",
            "tool_result",
            "tool result",
        ]
        if any(keyword in text_lower for keyword in error_keywords):
            return True

    # Pattern 2: API error with 400 and tool mention
    if "api error" in text_lower and has_400 and has_tool:
        return True

    return False


async def process_sdk_stream(
    client: Any,
    on_thinking: Callable[[str], None] | None = None,
    on_tool_use: Callable[[str, str, dict[str, Any]], None] | None = None,
    on_tool_result: Callable[[str, bool, Any], None] | None = None,
    on_text: Callable[[str], None] | None = None,
    on_structured_output: Callable[[dict[str, Any]], None] | None = None,
    context_name: str = "SDK",
    model: str | None = None,
    max_messages: int | None = None,
    # Deprecated parameters (kept for backwards compatibility, no longer used)
    system_prompt: str | None = None,  # noqa: ARG001
    agent_definitions: dict | None = None,  # noqa: ARG001
) -> dict[str, Any]:
    """
    Process SDK response stream with customizable callbacks.

    This function handles the common pattern of:
    - Tracking thinking blocks
    - Tracking tool invocations (especially Task/subagent calls)
    - Tracking tool results
    - Collecting text output
    - Extracting structured output (per official Python SDK pattern)

    Args:
        client: Claude SDK client with receive_response() method
        on_thinking: Callback for thinking blocks - receives thinking text
        on_tool_use: Callback for tool invocations - receives (tool_name, tool_id, tool_input)
        on_tool_result: Callback for tool results - receives (tool_id, is_error, result_content)
        on_text: Callback for text output - receives text string
        on_structured_output: Callback for structured output - receives dict
        context_name: Name for logging (e.g., "ParallelOrchestrator", "ParallelFollowup")
        model: Model name for logging (e.g., "claude-sonnet-4-5-20250929")
        max_messages: Optional override for max message count circuit breaker (default: MAX_MESSAGE_COUNT)

    Returns:
        Dictionary with:
        - result_text: Accumulated text output
        - structured_output: Final structured output (if any)
        - agents_invoked: List of agent names invoked via Task tool
        - msg_count: Total message count
        - subagent_tool_ids: Mapping of tool_id -> agent_name
        - error: Error message if stream processing failed (None on success)
        - error_recoverable: Boolean indicating if the error is recoverable (fallback possible) vs fatal
        - last_assistant_text: Last non-empty assistant text block (for cleaner fallback parsing)
    """
    result_text = ""
    last_assistant_text = ""  # Last assistant text block (for cleaner fallback parsing)
    structured_output = None
    agents_invoked = []
    msg_count = 0
    stream_error = None
    # Track subagent tool IDs to log their results
    subagent_tool_ids: dict[str, str] = {}  # tool_id -> agent_name
    completed_agent_tool_ids: set[str] = set()  # tool_ids of completed agents
    # Track tool concurrency errors for retry logic
    detected_concurrency_error = False
    # Track repeated identical responses to detect error loops early
    last_response_text: str | None = None
    repeated_response_count = 0

    # Circuit breaker: max messages before aborting
    message_limit = max_messages if max_messages is not None else MAX_MESSAGE_COUNT

    safe_print(f"[{context_name}] Processing SDK stream...")
    if DEBUG_MODE:
        safe_print(f"[DEBUG {context_name}] Awaiting response stream...")

    # Track activity for progress logging
    last_progress_log = 0
    PROGRESS_LOG_INTERVAL = 10  # Log progress every N messages

    try:
        async for msg in client.receive_response():
            try:
                msg_type = type(msg).__name__
                msg_count += 1

                # Check if a previous iteration set stream_error (e.g., auth error in text block)
                if stream_error:
                    break

                # CIRCUIT BREAKER: Abort if message count exceeds threshold
                # This prevents runaway retry loops (e.g., 400 errors causing infinite retries)
                if msg_count > message_limit:
                    stream_error = (
                        f"Circuit breaker triggered: message count ({msg_count}) "
                        f"exceeded limit ({message_limit}). Possible retry loop detected."
                    )
                    logger.error(f"[{context_name}] {stream_error}")
                    safe_print(f"[{context_name}] ERROR: {stream_error}")
                    break

                # Log progress periodically so user knows AI is working
                if msg_count - last_progress_log >= PROGRESS_LOG_INTERVAL:
                    if subagent_tool_ids:
                        pending = len(subagent_tool_ids) - len(completed_agent_tool_ids)
                        if pending > 0:
                            safe_print(
                                f"[{context_name}] Processing... ({msg_count} messages, {pending} agent{'s' if pending > 1 else ''} working)"
                            )
                        else:
                            safe_print(
                                f"[{context_name}] Processing... ({msg_count} messages)"
                            )
                    else:
                        safe_print(
                            f"[{context_name}] Processing... ({msg_count} messages)"
                        )
                    last_progress_log = msg_count

                if DEBUG_MODE:
                    # Log every message type for visibility
                    msg_details = ""
                    if hasattr(msg, "type"):
                        msg_details = f" (type={msg.type})"
                    safe_print(
                        f"[DEBUG {context_name}] Message #{msg_count}: {msg_type}{msg_details}"
                    )

                # Track thinking blocks
                if msg_type == "ThinkingBlock" or (
                    hasattr(msg, "type") and msg.type == "thinking"
                ):
                    thinking_text = getattr(msg, "thinking", "") or getattr(
                        msg, "text", ""
                    )
                    if thinking_text:
                        safe_print(
                            f"[{context_name}] AI thinking: {len(thinking_text)} chars"
                        )
                        if DEBUG_MODE:
                            # Show first 200 chars of thinking
                            preview = thinking_text[:200].replace("\n", " ")
                            safe_print(
                                f"[DEBUG {context_name}] Thinking preview: {preview}..."
                            )
                        # Invoke callback
                        if on_thinking:
                            on_thinking(thinking_text)

                # Track subagent invocations (Task tool calls)
                if msg_type == "ToolUseBlock" or (
                    hasattr(msg, "type") and msg.type == "tool_use"
                ):
                    tool_name = getattr(msg, "name", "")
                    tool_id = getattr(msg, "id", "unknown")
                    tool_input = getattr(msg, "input", {})

                    if DEBUG_MODE:
                        safe_print(
                            f"[DEBUG {context_name}] Tool call: {tool_name} (id={tool_id})"
                        )

                    if tool_name == "Task":
                        # Extract which agent was invoked
                        agent_name = tool_input.get("subagent_type", "unknown")
                        agents_invoked.append(agent_name)
                        # Track this tool ID to log its result later
                        subagent_tool_ids[tool_id] = agent_name
                        # Log with model info if available
                        model_info = f" [{_short_model_name(model)}]" if model else ""
                        safe_print(
                            f"[{context_name}] Invoking agent: {agent_name}{model_info}"
                        )
                        # Log delegation prompt for debugging trigger system
                        delegation_prompt = tool_input.get("prompt", "")
                        if delegation_prompt:
                            # Show first 300 chars of delegation prompt
                            prompt_preview = delegation_prompt[:300]
                            if len(delegation_prompt) > 300:
                                prompt_preview += "..."
                            safe_print(
                                f"[{context_name}] Delegation prompt for {agent_name}: {prompt_preview}"
                            )
                    elif tool_name != "StructuredOutput":
                        # Log meaningful tool info (not just tool name)
                        tool_detail = _get_tool_detail(tool_name, tool_input)
                        safe_print(f"[{context_name}] {tool_detail}")

                    # Invoke callback for all tool uses
                    if on_tool_use:
                        on_tool_use(tool_name, tool_id, tool_input)

                # Track tool results
                if msg_type == "ToolResultBlock" or (
                    hasattr(msg, "type") and msg.type == "tool_result"
                ):
                    tool_id = getattr(msg, "tool_use_id", "unknown")
                    is_error = getattr(msg, "is_error", False)
                    result_content = getattr(msg, "content", "")

                    # Handle list of content blocks
                    if isinstance(result_content, list):
                        result_content = " ".join(
                            str(getattr(c, "text", c)) for c in result_content
                        )

                    # Check if this is a subagent result
                    if tool_id in subagent_tool_ids:
                        agent_name = subagent_tool_ids[tool_id]
                        completed_agent_tool_ids.add(tool_id)  # Mark agent as completed
                        status = "ERROR" if is_error else "complete"
                        result_preview = (
                            str(result_content)[:600].replace("\n", " ").strip()
                        )
                        safe_print(
                            f"[Agent:{agent_name}] {status}: {result_preview}{'...' if len(str(result_content)) > 600 else ''}"
                        )
                    else:
                        # Show tool completion for visibility (not gated by DEBUG)
                        status = "ERROR" if is_error else "done"
                        # Show brief preview of result for context
                        result_preview = (
                            str(result_content)[:100].replace("\n", " ").strip()
                        )
                        if result_preview:
                            safe_print(
                                f"[{context_name}] Tool result [{status}]: {result_preview}{'...' if len(str(result_content)) > 100 else ''}"
                            )

                    # Invoke callback
                    if on_tool_result:
                        on_tool_result(tool_id, is_error, result_content)

                # Collect text output and check for tool uses in content blocks
                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__

                        # Check for tool use blocks within content
                        if (
                            block_type == "ToolUseBlock"
                            or getattr(block, "type", "") == "tool_use"
                        ):
                            tool_name = getattr(block, "name", "")
                            tool_id = getattr(block, "id", "unknown")
                            tool_input = getattr(block, "input", {})

                            if tool_name == "Task":
                                agent_name = tool_input.get("subagent_type", "unknown")
                                if agent_name not in agents_invoked:
                                    agents_invoked.append(agent_name)
                                    subagent_tool_ids[tool_id] = agent_name
                                    # Log with model info if available
                                    model_info = (
                                        f" [{_short_model_name(model)}]"
                                        if model
                                        else ""
                                    )
                                    safe_print(
                                        f"[{context_name}] Invoking agent: {agent_name}{model_info}"
                                    )
                            elif tool_name != "StructuredOutput":
                                # Log meaningful tool info (not just tool name)
                                tool_detail = _get_tool_detail(tool_name, tool_input)
                                safe_print(f"[{context_name}] {tool_detail}")

                            # Invoke callback
                            if on_tool_use:
                                on_tool_use(tool_name, tool_id, tool_input)

                        # Collect text - must check block type since only TextBlock has .text
                        block_type = type(block).__name__
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            result_text += block.text
                            # Track last non-empty text for fallback parsing
                            if block.text.strip():
                                last_assistant_text = block.text
                            # Check for auth/access error returned as AI response text.
                            # Note: break exits this inner for-loop over msg.content;
                            # the outer message loop exits via `if stream_error: break`.
                            if _is_auth_error_response(block.text):
                                stream_error = (
                                    f"Authentication error detected in AI response: "
                                    f"{block.text[:200].strip()}"
                                )
                                logger.error(f"[{context_name}] {stream_error}")
                                safe_print(f"[{context_name}] ERROR: {stream_error}")
                                break
                            # Check for repeated identical responses (error loop detection).
                            # Skip empty text blocks so they don't reset the counter.
                            _stripped = block.text.strip()
                            if _stripped:
                                if _stripped == last_response_text:
                                    repeated_response_count += 1
                                    if (
                                        repeated_response_count
                                        >= REPEATED_RESPONSE_THRESHOLD
                                    ):
                                        stream_error = (
                                            f"Repeated response loop detected: same response "
                                            f"received {repeated_response_count + 1} times in a row. "
                                            f"Response: {_stripped[:200]}"
                                        )
                                        logger.error(f"[{context_name}] {stream_error}")
                                        safe_print(
                                            f"[{context_name}] ERROR: {stream_error}"
                                        )
                                        break
                                else:
                                    last_response_text = _stripped
                                    repeated_response_count = 0
                            # Check for tool concurrency error pattern in text output
                            if _is_tool_concurrency_error(block.text):
                                detected_concurrency_error = True
                                logger.warning(
                                    f"[{context_name}] Detected tool use concurrency error in response"
                                )
                                safe_print(
                                    f"[{context_name}] WARNING: Tool concurrency error detected"
                                )
                            # Always print text content preview (not just in DEBUG_MODE)
                            text_preview = block.text[:500].replace("\n", " ").strip()
                            if text_preview:
                                safe_print(
                                    f"[{context_name}] AI response: {text_preview}{'...' if len(block.text) > 500 else ''}"
                                )
                                # Invoke callback
                                if on_text:
                                    on_text(block.text)

                # ================================================================
                # STRUCTURED OUTPUT CAPTURE (Single, consolidated location)
                # Per official Python SDK docs: https://platform.claude.com/docs/en/agent-sdk/structured-outputs
                # The Python pattern is: if hasattr(message, 'structured_output')
                # ================================================================

                # Check for error_max_structured_output_retries first (SDK validation failed)
                is_result_msg = msg_type == "ResultMessage" or (
                    hasattr(msg, "type") and msg.type == "result"
                )
                if is_result_msg:
                    subtype = getattr(msg, "subtype", None)
                    if DEBUG_MODE:
                        safe_print(
                            f"[DEBUG {context_name}] ResultMessage: subtype={subtype}"
                        )
                    if subtype == "error_max_structured_output_retries":
                        # SDK failed to produce valid structured output after retries
                        logger.warning(
                            f"[{context_name}] Claude could not produce valid structured output "
                            f"after maximum retries - schema validation failed"
                        )
                        safe_print(
                            f"[{context_name}] WARNING: Structured output validation failed after retries"
                        )
                        if not stream_error:
                            stream_error = "structured_output_validation_failed"

                # Capture structured output from ANY message that has it
                # This is the official Python SDK pattern - check hasattr()
                if hasattr(msg, "structured_output") and msg.structured_output:
                    # Only capture if we don't already have it (avoid duplicates)
                    if structured_output is None:
                        structured_output = msg.structured_output
                        safe_print(f"[{context_name}] Received structured output")
                        if on_structured_output:
                            on_structured_output(msg.structured_output)
                    elif DEBUG_MODE:
                        # In debug mode, note that we skipped a duplicate
                        safe_print(
                            f"[DEBUG {context_name}] Skipping duplicate structured output"
                        )

                # Check for tool results in UserMessage (subagent results come back here)
                if msg_type == "UserMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__
                        # Check for tool result blocks
                        if (
                            block_type == "ToolResultBlock"
                            or getattr(block, "type", "") == "tool_result"
                        ):
                            tool_id = getattr(block, "tool_use_id", "unknown")
                            is_error = getattr(block, "is_error", False)
                            result_content = getattr(block, "content", "")

                            # Handle list of content blocks
                            if isinstance(result_content, list):
                                result_content = " ".join(
                                    str(getattr(c, "text", c)) for c in result_content
                                )

                            # Check if this is a subagent result
                            if tool_id in subagent_tool_ids:
                                agent_name = subagent_tool_ids[tool_id]
                                completed_agent_tool_ids.add(
                                    tool_id
                                )  # Mark agent as completed
                                status = "ERROR" if is_error else "complete"
                                result_preview = (
                                    str(result_content)[:600].replace("\n", " ").strip()
                                )
                                safe_print(
                                    f"[Agent:{agent_name}] {status}: {result_preview}{'...' if len(str(result_content)) > 600 else ''}"
                                )

                            # Invoke callback
                            if on_tool_result:
                                on_tool_result(tool_id, is_error, result_content)

            except (AttributeError, TypeError, KeyError) as msg_error:
                # Log individual message processing errors but continue
                logger.warning(
                    f"[{context_name}] Error processing message #{msg_count}: {msg_error}"
                )
                if DEBUG_MODE:
                    safe_print(
                        f"[DEBUG {context_name}] Message processing error: {msg_error}"
                    )
                # Continue processing subsequent messages

    except BrokenPipeError:
        # Pipe closed by parent process - expected during shutdown
        stream_error = "Output pipe closed"
        logger.debug(f"[{context_name}] Output pipe closed by parent process")
    except Exception as e:
        # Log stream-level errors
        stream_error = str(e)
        logger.error(f"[{context_name}] SDK stream processing failed: {e}")
        safe_print(f"[{context_name}] ERROR: Stream processing failed: {e}")

    if DEBUG_MODE:
        safe_print(f"[DEBUG {context_name}] Session ended. Total messages: {msg_count}")

    safe_print(f"[{context_name}] Session ended. Total messages: {msg_count}")

    # Set error flag if tool concurrency error was detected
    if detected_concurrency_error and not stream_error:
        stream_error = "tool_use_concurrency_error"
        logger.warning(
            f"[{context_name}] Tool use concurrency error detected - caller should retry"
        )

    # Categorize error as recoverable (fallback possible) vs fatal
    error_recoverable = stream_error in RECOVERABLE_ERRORS if stream_error else False

    return {
        "result_text": result_text,
        "last_assistant_text": last_assistant_text,
        "structured_output": structured_output,
        "agents_invoked": agents_invoked,
        "msg_count": msg_count,
        "subagent_tool_ids": subagent_tool_ids,
        "error": stream_error,
        "error_recoverable": error_recoverable,
    }

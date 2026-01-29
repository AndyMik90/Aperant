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

# ── TEMPORARY: Per-PR full agent communication logger (v2) ────────────
# Writes every message to .auto-claude/github/pr/debug_logs/<context>_<ts>.log
# Remove after measurement phase is complete.
import datetime as _dt
import json as _json
from pathlib import Path as _Path

# Derive project root dynamically from this file's location
# sdk_utils.py is at: apps/backend/runners/github/services/sdk_utils.py
# So project root is 5 levels up
_PROJECT_ROOT = _Path(__file__).resolve().parent.parent.parent.parent.parent
_PR_LOG_DIR = _PROJECT_ROOT / ".auto-claude" / "github" / "pr" / "debug_logs"


class _PRDebugLogger:
    """Writes full agent communication to a log file for review.

    Improvements (v2):
    - System prompt and agent definitions logged at session start
    - No truncation on thinking, text, tool input, or tool results
    - No duplicate logging (single structured dump per message)
    - Empty/whitespace content shown via repr()
    - Agent attribution via subagent_tool_ids mapping
    """

    def __init__(self, context_name: str, model: str | None = None):
        self._f = None
        self._subagent_tool_ids: dict[str, str] = {}  # tool_id -> agent_name

        try:
            _PR_LOG_DIR.mkdir(parents=True, exist_ok=True)
            ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
            self.path = _PR_LOG_DIR / f"{context_name}_{ts}.log"
            self._f = open(self.path, "w", encoding="utf-8")
            self._write(
                f"=== {context_name} Session Started at {_dt.datetime.now().isoformat()} ==="
            )
            if model:
                self._write(f"Model: {model}")
            self._write("")
        except OSError as e:
            # Failed to create directory or open file - logging disabled
            logger.warning(f"PR debug logger disabled: {e}")
            self.path = None

    def _write(self, text: str):
        # Skip logging if file handle was not created successfully
        if self._f is None:
            return
        try:
            self._f.write(text + "\n")
            self._f.flush()
        except (OSError, ValueError) as e:
            # File write failed (file closed, disk full, etc.) - disable logging
            logger.warning(f"PR debug logger write failed: {e}")
            self._f = None

    # ── Session preamble loggers ──────────────────────────────────────

    def log_system_prompt(self, prompt: str):
        """Log the full system prompt (no truncation)."""
        self._write(f"\n{'#' * 80}")
        self._write("# SYSTEM PROMPT (full orchestrator instructions + PR context)")
        self._write(f"# Length: {len(prompt)} chars")
        self._write(f"{'#' * 80}")
        self._write(prompt)
        self._write(f"{'#' * 80}\n")

    def log_agent_definitions(self, agents: dict):
        """Log all specialist agent definitions (prompts, tools, descriptions)."""
        self._write(f"\n{'#' * 80}")
        self._write(f"# AGENT DEFINITIONS ({len(agents)} specialists)")
        self._write(f"{'#' * 80}")
        for name, defn in agents.items():
            self._write(f"\n--- Agent: {name} ---")
            self._write(f"  description: {getattr(defn, 'description', 'N/A')}")
            self._write(f"  model: {getattr(defn, 'model', 'N/A')}")
            self._write(f"  tools: {getattr(defn, 'tools', 'N/A')}")
            prompt = getattr(defn, "prompt", "")
            self._write(f"  prompt ({len(prompt)} chars):")
            self._write(prompt)
        self._write(f"{'#' * 80}\n")

    # ── Agent attribution ─────────────────────────────────────────────

    def set_subagent_mapping(self, mapping: dict[str, str]):
        """Update the tool_id -> agent_name mapping for attribution."""
        self._subagent_tool_ids = mapping

    def _get_agent_label(self, tool_id: str) -> str:
        """Return agent label if this tool_id belongs to a known subagent."""
        agent = self._subagent_tool_ids.get(tool_id)
        return f" [Agent:{agent}]" if agent else ""

    # ── Per-message logger (single structured dump) ───────────────────

    def log_message(self, msg_count: int, msg_type: str, msg: object):
        self._write(f"\n{'=' * 80}")
        self._write(f"--- Message #{msg_count} [{msg_type}] ---")
        self._write(f"{'=' * 80}")
        self._dump_raw(msg)

    def _dump_raw(self, msg: object, indent: int = 0):
        """Dump full raw message content recursively — NO truncation."""
        prefix = "  " * indent
        # Content blocks
        if hasattr(msg, "content"):
            content = msg.content
            if isinstance(content, list):
                self._write(f"{prefix}[content] ({len(content)} blocks):")
                for i, block in enumerate(content):
                    block_type = type(block).__name__
                    self._write(f"{prefix}  [{i}] {block_type}:")
                    self._dump_block(block, indent + 2)
            elif isinstance(content, str):
                if not content or content.isspace():
                    self._write(
                        f"{prefix}[content] (string, {len(content)} chars): {repr(content)}"
                    )
                else:
                    self._write(f"{prefix}[content] (string, {len(content)} chars):")
                    self._write(content)
            else:
                self._write(f"{prefix}[content] ({type(content).__name__}):")
                self._write(f"{prefix}  {str(content)}")

        # Role / type
        if hasattr(msg, "role"):
            self._write(f"{prefix}[role] {msg.role}")
        if hasattr(msg, "type") and not hasattr(msg, "content"):
            self._write(f"{prefix}[type] {msg.type}")

        # Structured output
        if hasattr(msg, "structured_output") and msg.structured_output:
            self._write(f"{prefix}[structured_output]:")
            try:
                self._write(_json.dumps(msg.structured_output, indent=2, default=str))
            except Exception:
                self._write(f"{prefix}  {str(msg.structured_output)}")

        # Result message fields
        if hasattr(msg, "subtype"):
            self._write(f"{prefix}[subtype] {msg.subtype}")
        if hasattr(msg, "is_error"):
            self._write(f"{prefix}[is_error] {msg.is_error}")
        if hasattr(msg, "duration_ms"):
            self._write(f"{prefix}[duration_ms] {msg.duration_ms}")
        if hasattr(msg, "session_id"):
            self._write(f"{prefix}[session_id] {msg.session_id}")

        # Catch-all for messages without content blocks
        for attr in ("text", "thinking", "name", "id", "input", "tool_use_id"):
            if hasattr(msg, attr) and not hasattr(msg, "content"):
                val = getattr(msg, attr)
                if val is not None:
                    self._write(f"{prefix}[{attr}] {str(val)}")

    def _dump_block(self, block: object, indent: int = 0):
        """Dump a single content block — NO truncation."""
        prefix = "  " * indent
        block_type = getattr(block, "type", type(block).__name__)

        if block_type in ("text", "TextBlock") and hasattr(block, "text"):
            text = block.text
            if not text or text.isspace():
                self._write(f"{prefix}[text] ({len(text)} chars): {repr(text)}")
            else:
                self._write(f"{prefix}[text] ({len(text)} chars):")
                self._write(text)

        elif block_type in ("thinking", "ThinkingBlock") and hasattr(block, "thinking"):
            text = block.thinking or getattr(block, "text", "")
            self._write(f"{prefix}[thinking] ({len(text)} chars):")
            self._write(text)

        elif block_type in ("tool_use", "ToolUseBlock"):
            tool_name = getattr(block, "name", "unknown")
            tool_id = getattr(block, "id", "unknown")
            tool_input = getattr(block, "input", {})
            agent_label = self._get_agent_label(tool_id)
            self._write(f"{prefix}[tool_use] {tool_name} (id={tool_id}){agent_label}")
            try:
                self._write(_json.dumps(tool_input, indent=2, default=str))
            except Exception:
                self._write(str(tool_input))

        elif block_type in ("tool_result", "ToolResultBlock"):
            tool_id = getattr(block, "tool_use_id", "unknown")
            is_error = getattr(block, "is_error", False)
            result = getattr(block, "content", "")
            if isinstance(result, list):
                result = " ".join(str(getattr(c, "text", c)) for c in result)
            status = "ERROR" if is_error else "OK"
            agent_label = self._get_agent_label(tool_id)
            self._write(
                f"{prefix}[tool_result] (tool_id={tool_id}) {status}{agent_label}"
            )
            self._write(str(result))

        else:
            # Unknown block type — dump everything we can
            self._write(f"{prefix}[{block_type}] (raw dump):")
            for attr in dir(block):
                if not attr.startswith("_"):
                    try:
                        val = getattr(block, attr)
                        if not callable(val):
                            self._write(f"{prefix}  {attr}: {str(val)}")
                    except Exception:
                        pass

    # ── Structured output (standalone, for final result) ──────────────

    def log_structured_output(self, output: dict):
        self._write("[STRUCTURED_OUTPUT]")
        try:
            self._write(_json.dumps(output, indent=2, default=str))
        except Exception:
            self._write(str(output))

    # ── Session close ─────────────────────────────────────────────────

    def close(self, summary: dict):
        self._write("\n=== Session Ended ===")
        self._write(f"Messages: {summary.get('msg_count', '?')}")
        self._write(f"Agents invoked: {summary.get('agents_invoked', [])}")
        self._write(f"Error: {summary.get('error')}")
        self._write(f"Log file: {self.path}")
        if self._f is not None:
            try:
                self._f.close()
            except OSError as e:
                logger.warning(f"PR debug logger close failed: {e}")


# ── END TEMPORARY ──────────────────────────────────────────────────────


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


async def process_sdk_stream(
    client: Any,
    on_thinking: Callable[[str], None] | None = None,
    on_tool_use: Callable[[str, str, dict[str, Any]], None] | None = None,
    on_tool_result: Callable[[str, bool, Any], None] | None = None,
    on_text: Callable[[str], None] | None = None,
    on_structured_output: Callable[[dict[str, Any]], None] | None = None,
    context_name: str = "SDK",
    model: str | None = None,
    system_prompt: str | None = None,
    agent_definitions: dict | None = None,
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
        system_prompt: Full system prompt sent to the agent (logged at session start)
        agent_definitions: Dict of agent name -> AgentDefinition (logged at session start)

    Returns:
        Dictionary with:
        - result_text: Accumulated text output
        - structured_output: Final structured output (if any)
        - agents_invoked: List of agent names invoked via Task tool
        - msg_count: Total message count
        - subagent_tool_ids: Mapping of tool_id -> agent_name
        - error: Error message if stream processing failed (None on success)
    """
    result_text = ""
    structured_output = None
    agents_invoked = []
    msg_count = 0
    stream_error = None
    # Track subagent tool IDs to log their results
    subagent_tool_ids: dict[str, str] = {}  # tool_id -> agent_name
    completed_agent_tool_ids: set[str] = set()  # tool_ids of completed agents

    # TEMPORARY: per-PR debug file logger
    _dbg = _PRDebugLogger(context_name, model=model)

    # Log session preamble: system prompt and agent definitions
    if system_prompt:
        _dbg.log_system_prompt(system_prompt)
    if agent_definitions:
        _dbg.log_agent_definitions(agent_definitions)

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
                _dbg.log_message(msg_count, msg_type, msg)

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
                        _dbg.set_subagent_mapping(subagent_tool_ids)
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
                        _dbg.log_structured_output(msg.structured_output)
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

    result = {
        "result_text": result_text,
        "structured_output": structured_output,
        "agents_invoked": agents_invoked,
        "msg_count": msg_count,
        "subagent_tool_ids": subagent_tool_ids,
        "error": stream_error,
    }
    _dbg.close(result)
    safe_print(f"[{context_name}] Full debug log: {_dbg.path}")
    return result

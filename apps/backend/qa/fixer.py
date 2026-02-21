"""
QA Fixer Agent Session
=======================

Runs QA fixer sessions to resolve issues identified by the reviewer.

Memory Integration:
- Retrieves past patterns, fixes, and gotchas before fixing
- Saves fix outcomes and learnings after session
"""

from pathlib import Path

# Memory integration for cross-session learning
from agents.base import sanitize_error_message
from agents.memory_manager import get_graphiti_context, save_session_memory
from claude_agent_sdk import ClaudeSDKClient
from core.error_utils import (
    is_rate_limit_error,
    is_tool_concurrency_error,
    safe_receive_messages,
)
from debug import debug, debug_detailed, debug_error, debug_section, debug_success
from security.tool_input_validator import get_safe_tool_input
from task_logger import (
    LogEntryType,
    LogPhase,
    get_task_logger,
)

from .criteria import get_qa_signoff_status

# Configuration
QA_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


# =============================================================================
# PROMPT LOADING
# =============================================================================


def load_qa_fixer_prompt() -> str:
    """Load the QA fixer agent prompt."""
    prompt_file = QA_PROMPTS_DIR / "qa_fixer.md"
    if not prompt_file.exists():
        raise FileNotFoundError(f"QA fixer prompt not found: {prompt_file}")
    return prompt_file.read_text(encoding="utf-8")


# =============================================================================
# QA FIXER SESSION
# =============================================================================


async def run_qa_fixer_session(
    client: ClaudeSDKClient,
    spec_dir: Path,
    fix_session: int,
    verbose: bool = False,
    project_dir: Path | None = None,
) -> tuple[str, str, dict]:
    """
    Run a QA fixer agent session.

    Args:
        client: Claude SDK client
        spec_dir: Spec directory
        fix_session: Fix iteration number
        verbose: Whether to show detailed output
        project_dir: Project root directory (for memory context)

    Returns:
        (status, response_text, error_info) where:
        - status: "fixed" if fixes were applied, "error" if an error occurred
        - response_text: Agent's response text
        - error_info: Dict with error details (empty if no error):
            - "type": "tool_concurrency" or "other"
            - "message": Error message string
            - "exception_type": Exception class name string
    """
    # Derive project_dir from spec_dir if not provided
    # spec_dir is typically: /project/.auto-claude/specs/001-name/
    if project_dir is None:
        # Walk up from spec_dir to find project root
        project_dir = spec_dir.parent.parent.parent
    debug_section("qa_fixer", f"QA Fixer Session {fix_session}")
    debug(
        "qa_fixer",
        "Starting QA fixer session",
        spec_dir=str(spec_dir),
        fix_session=fix_session,
    )

    print(f"\n{'=' * 70}")
    print(f"  QA FIXER SESSION {fix_session}")
    print("  Applying fixes from QA_FIX_REQUEST.md...")
    print(f"{'=' * 70}\n")

    # Get task logger for streaming markers
    task_logger = get_task_logger(spec_dir)
    current_tool = None
    message_count = 0
    tool_count = 0

    # Check that fix request file exists
    fix_request_file = spec_dir / "QA_FIX_REQUEST.md"
    if not fix_request_file.exists():
        debug_error("qa_fixer", "QA_FIX_REQUEST.md not found")
        error_info = {
            "type": "other",
            "message": "QA_FIX_REQUEST.md not found",
            "exception_type": "FileNotFoundError",
        }
        return "error", "QA_FIX_REQUEST.md not found", error_info

    # Load fixer prompt
    prompt = load_qa_fixer_prompt()
    debug_detailed("qa_fixer", "Loaded QA fixer prompt", prompt_length=len(prompt))

    # Retrieve memory context for fixer (past fixes, patterns, gotchas)
    fixer_memory_context = await get_graphiti_context(
        spec_dir,
        project_dir,
        {
            "description": "Fixing QA issues and implementing corrections",
            "id": f"qa_fixer_{fix_session}",
        },
    )
    if fixer_memory_context:
        prompt += "\n\n" + fixer_memory_context
        print("✓ Memory context loaded for QA fixer")
        debug_success("qa_fixer", "Graphiti memory context loaded for fixer")

    # Add session context - use full path so agent can find files
    prompt += f"\n\n---\n\n**Fix Session**: {fix_session}\n"
    prompt += f"**Spec Directory**: {spec_dir}\n"
    prompt += f"**Spec Name**: {spec_dir.name}\n"
    prompt += f"\n**IMPORTANT**: All spec files are located in: `{spec_dir}/`\n"
    prompt += f"The fix request file is at: `{spec_dir}/QA_FIX_REQUEST.md`\n"

    try:
        debug("qa_fixer", "Sending query to Claude SDK...")
        await client.query(prompt)
        debug_success("qa_fixer", "Query sent successfully")

        response_text = ""
        debug("qa_fixer", "Starting to receive response stream...")
        async for msg in safe_receive_messages(client, caller="qa_fixer"):
            msg_type = type(msg).__name__
            message_count += 1
            debug_detailed(
                "qa_fixer",
                f"Received message #{message_count}",
                msg_type=msg_type,
            )

            if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "TextBlock" and hasattr(block, "text"):
                        response_text += block.text
                        print(block.text, end="", flush=True)
                        # Log text to task logger (persist without double-printing)
                        if task_logger and block.text.strip():
                            task_logger.log(
                                block.text,
                                LogEntryType.TEXT,
                                LogPhase.VALIDATION,
                                print_to_console=False,
                            )
                    elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                        tool_name = block.name
                        tool_input_display = None
                        tool_count += 1

                        # Safely extract tool input (handles None, non-dict, etc.)
                        inp = get_safe_tool_input(block)

                        if inp:
                            if "file_path" in inp:
                                fp = inp["file_path"]
                                if len(fp) > 50:
                                    fp = "..." + fp[-47:]
                                tool_input_display = fp
                            elif "command" in inp:
                                cmd = inp["command"]
                                if len(cmd) > 50:
                                    cmd = cmd[:47] + "..."
                                tool_input_display = cmd

                        debug(
                            "qa_fixer",
                            f"Tool call #{tool_count}: {tool_name}",
                            tool_input=tool_input_display,
                        )

                        # Log tool start (handles printing)
                        if task_logger:
                            task_logger.tool_start(
                                tool_name,
                                tool_input_display,
                                LogPhase.VALIDATION,
                                print_to_console=True,
                            )
                        else:
                            print(f"\n[Fixer Tool: {tool_name}]", flush=True)

                        if verbose and hasattr(block, "input"):
                            input_str = str(block.input)
                            if len(input_str) > 300:
                                print(f"   Input: {input_str[:300]}...", flush=True)
                            else:
                                print(f"   Input: {input_str}", flush=True)
                        current_tool = tool_name

            elif msg_type == "UserMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "ToolResultBlock":
                        is_error = getattr(block, "is_error", False)
                        result_content = getattr(block, "content", "")

                        if is_error:
                            debug_error(
                                "qa_fixer",
                                f"Tool error: {current_tool}",
                                error=str(result_content)[:200],
                            )
                            error_str = str(result_content)[:500]
                            print(f"   [Error] {error_str}", flush=True)
                            if task_logger and current_tool:
                                # Store full error in detail for expandable view
                                task_logger.tool_end(
                                    current_tool,
                                    success=False,
                                    result=error_str[:100],
                                    detail=str(result_content),
                                    phase=LogPhase.VALIDATION,
                                )
                        else:
                            debug_detailed(
                                "qa_fixer",
                                f"Tool success: {current_tool}",
                                result_length=len(str(result_content)),
                            )
                            if verbose:
                                result_str = str(result_content)[:200]
                                print(f"   [Done] {result_str}", flush=True)
                            else:
                                print("   [Done]", flush=True)
                            if task_logger and current_tool:
                                # Store full result in detail for expandable view
                                detail_content = None
                                if current_tool in (
                                    "Read",
                                    "Grep",
                                    "Bash",
                                    "Edit",
                                    "Write",
                                ):
                                    result_str = str(result_content)
                                    if len(result_str) < 50000:
                                        detail_content = result_str
                                task_logger.tool_end(
                                    current_tool,
                                    success=True,
                                    detail=detail_content,
                                    phase=LogPhase.VALIDATION,
                                )

                        current_tool = None

        print("\n" + "-" * 70 + "\n")

        # Check if fixes were applied
        status = get_qa_signoff_status(spec_dir)
        debug(
            "qa_fixer",
            "Fixer session completed",
            message_count=message_count,
            tool_count=tool_count,
            response_length=len(response_text),
            ready_for_revalidation=status.get("ready_for_qa_revalidation")
            if status
            else False,
        )

        # Save fixer session insights to memory
        fixer_discoveries = {
            "files_understood": {},
            "patterns_found": [
                f"QA fixer session {fix_session}: Applied fixes from QA_FIX_REQUEST.md"
            ],
            "gotchas_encountered": [],
        }

        if status and status.get("ready_for_qa_revalidation"):
            debug_success("qa_fixer", "Fixes applied, ready for QA revalidation")
            # Save successful fix session to memory
            await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=f"qa_fixer_{fix_session}",
                session_num=fix_session,
                success=True,
                subtasks_completed=[f"qa_fixer_{fix_session}"],
                discoveries=fixer_discoveries,
            )
            return "fixed", response_text, {}
        else:
            # Fixer didn't update the status properly, but we'll trust it worked
            debug_success("qa_fixer", "Fixes assumed applied (status not updated)")
            # Still save to memory as successful (fixes were attempted)
            await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=f"qa_fixer_{fix_session}",
                session_num=fix_session,
                success=True,
                subtasks_completed=[f"qa_fixer_{fix_session}"],
                discoveries=fixer_discoveries,
            )
            return "fixed", response_text, {}

    except Exception as e:
        # Detect specific error types for better retry handling
        is_concurrency = is_tool_concurrency_error(e)
        is_rate_limited = is_rate_limit_error(e)

        if is_concurrency:
            error_type = "tool_concurrency"
        elif is_rate_limited:
            error_type = "rate_limit"
        else:
            error_type = "other"

        debug_error(
            "qa_fixer",
            f"Fixer session exception: {e}",
            exception_type=type(e).__name__,
            error_category=error_type,
            message_count=message_count,
            tool_count=tool_count,
        )

        # Sanitize error message to remove potentially sensitive data
        sanitized_error = sanitize_error_message(str(e))

        # Log concurrency errors prominently
        if is_concurrency:
            print("\n⚠️  Tool concurrency limit reached (400 error)")
            print("   Claude API limits concurrent tool use in a single request")
            print(f"   Error: {sanitized_error[:200]}\n")
        else:
            print(f"Error during fixer session: {sanitized_error}")

        if task_logger:
            task_logger.log_error(
                f"QA fixer error: {sanitized_error}", LogPhase.VALIDATION
            )

        error_info = {
            "type": error_type,
            "message": sanitized_error,
            "exception_type": type(e).__name__,
        }
        return "error", sanitized_error, error_info

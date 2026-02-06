#!/usr/bin/env python3
"""
Insights Runner - Interactive codebase Q&A with Claude SDK

A chat interface for exploring and understanding codebases using Claude Agent SDK.
Provides conversational AI assistance for code analysis, architecture questions,
and technical documentation.

Usage:
    python insights_runner.py <project_dir> --message "Your question here"
    python insights_runner.py <project_dir> --history-file <path_to_history.json>
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    SDK_AVAILABLE = True
except ImportError:
    SDK_AVAILABLE = False
    print("Warning: Claude SDK not available", file=sys.stderr)

from core.auth import ensure_claude_code_oauth_token, get_auth_token
from integrations.models import resolve_model_id
from utils.logging import debug, debug_error, debug_success


def get_thinking_budget(thinking_level: str) -> int | None:
    """Convert thinking level string to token budget.

    Args:
        thinking_level: One of "none", "low", "medium", "high", or "ultrathink"

    Returns:
        Token budget integer, or None if thinking_level is "none"

    Raises:
        ValueError: If thinking_level is not a valid option
    """
    THINKING_BUDGETS = {
        "none": None,
        "low": 5000,
        "medium": 10000,
        "high": 16000,
        "ultrathink": 16000,  # Max budget
    }

    if thinking_level not in THINKING_BUDGETS:
        raise ValueError(
            f"Invalid thinking level: {thinking_level}. "
            f"Valid options: {', '.join(THINKING_BUDGETS.keys())}"
        )

    return THINKING_BUDGETS[thinking_level]


def build_system_prompt(project_dir: str) -> str:
    """Build the system prompt for the insights agent.

    Args:
        project_dir: Path to the project directory to analyze

    Returns:
        Formatted system prompt string with project context
    """
    return f"""You are an expert code analysis assistant helping users understand and explore a codebase.

Project location: {project_dir}

Your role is to:
- Answer questions about code structure, patterns, and architecture
- Explain how specific features or modules work
- Help locate relevant code for specific functionality
- Provide insights about code organization and best practices
- Suggest improvements when asked
- Create tasks when appropriate (see task suggestion format below)

Guidelines:
- Use Read, Glob, and Grep tools to explore the codebase
- Provide specific file paths and line numbers when referencing code
- Explain technical concepts clearly and concisely
- When unsure, explore the codebase to find accurate information
- Focus on facts from the actual code, not assumptions

Task Suggestions:
When the user asks you to create a task, wants to turn the conversation into a task, or when you believe creating a task would be helpful, output a task suggestion in this exact format on a SINGLE LINE:
__TASK_SUGGESTION__:{{"title": "Task title here", "description": "Detailed description of what the task involves", "metadata": {{"category": "feature", "complexity": "medium", "impact": "medium"}}}}

Valid categories: feature, bug_fix, refactoring, documentation, security, performance, ui_ux, infrastructure, testing
Valid complexity: trivial, small, medium, large, complex
Valid impact: low, medium, high, critical

Be conversational and helpful. Focus on providing actionable insights and clear explanations.
Keep responses concise but informative."""


async def run_with_sdk(
    project_dir: str,
    message: str,
    history: list,
    model: str = "sonnet",  # Shorthand - resolved via API Profile if configured
    thinking_level: str = "medium",
    dangerously_skip_permissions: bool = False,
) -> None:
    """Run the chat using Claude SDK with streaming.

    Args:
        project_dir: Path to the project directory to analyze
        message: The user's message/question
        history: List of previous messages in the conversation
        model: Model name to use (default: "sonnet")
        thinking_level: Extended reasoning level (default: "medium")
        dangerously_skip_permissions: If True, bypasses all permission checks (DANGEROUS)

    Raises:
        Exception: If SDK initialization or query execution fails
    """
    if not SDK_AVAILABLE:
        print("Claude SDK not available, falling back to simple mode", file=sys.stderr)
        run_simple(project_dir, message, history)
        return

    if not get_auth_token():
        print(
            "No authentication token found, falling back to simple mode",
            file=sys.stderr,
        )
        run_simple(project_dir, message, history)
        return

    # Ensure SDK can find the token
    ensure_claude_code_oauth_token()

    system_prompt = build_system_prompt(project_dir)
    project_path = Path(project_dir).resolve()

    # Build conversation context from history
    conversation_context = ""
    for msg in history[:-1]:  # Exclude the latest message
        role = "User" if msg.get("role") == "user" else "Assistant"
        conversation_context += f"\n{role}: {msg['content']}\n"

    # Build the full prompt with conversation history
    full_prompt = message
    if conversation_context.strip():
        full_prompt = f"""Previous conversation:
{conversation_context}

Current question: {message}"""

    # Convert thinking level to token budget
    max_thinking_tokens = get_thinking_budget(thinking_level)

    debug(
        "insights_runner",
        "Using model configuration",
        model=model,
        thinking_level=thinking_level,
        max_thinking_tokens=max_thinking_tokens,
        dangerously_skip_permissions=dangerously_skip_permissions,
    )

    try:
        # Build options dict - only include max_thinking_tokens if not None
        options_kwargs = {
            "model": resolve_model_id(model),  # Resolve via API Profile if configured
            "system_prompt": system_prompt,
            "allowed_tools": ["Read", "Glob", "Grep"],
            "max_turns": 30,  # Allow sufficient turns for codebase exploration
            "cwd": str(project_path),
        }

        # Only add thinking tokens if the thinking level is not "none"
        if max_thinking_tokens is not None:
            options_kwargs["max_thinking_tokens"] = max_thinking_tokens

        # Configure permission mode based on YOLO setting
        if dangerously_skip_permissions:
            debug("insights_runner", "YOLO mode enabled - bypassing all permissions")
            options_kwargs["permissionMode"] = "bypassPermissions"
            options_kwargs["allowDangerouslySkipPermissions"] = True
        else:
            debug(
                "insights_runner", "Standard mode - using acceptEdits permission mode"
            )
            options_kwargs["permissionMode"] = "acceptEdits"

        # Create Claude SDK client with appropriate settings for insights
        client = ClaudeSDKClient(options=ClaudeAgentOptions(**options_kwargs))

        # Use async context manager pattern
        async with client:
            # Send the query
            await client.query(full_prompt)

            # Stream the response
            response_text = ""
            task_suggestions = []

            async for chunk in client.stream():
                # Track content for task extraction
                if hasattr(chunk, "text"):
                    response_text += chunk.text
                    # Look for task suggestions
                    if "__TASK_SUGGESTION__:" in chunk.text:
                        try:
                            # Extract JSON after the marker
                            marker_pos = chunk.text.find("__TASK_SUGGESTION__:")
                            json_start = marker_pos + len("__TASK_SUGGESTION__:")
                            # Find the end of the JSON (assume it's on one line)
                            json_end = chunk.text.find("\n", json_start)
                            if json_end == -1:
                                json_end = len(chunk.text)
                            task_json = chunk.text[json_start:json_end].strip()
                            task_data = json.loads(task_json)
                            task_suggestions.append(task_data)
                        except json.JSONDecodeError as e:
                            debug_error(
                                "insights_runner",
                                "Failed to parse task suggestion JSON",
                                error=str(e),
                            )

                # Print the chunk to stdout for the frontend to capture
                print(
                    json.dumps({"type": "chunk", "data": chunk.model_dump()}),
                    flush=True,
                )

            # Send task suggestions if any were found
            if task_suggestions:
                debug(
                    "insights_runner",
                    "Found task suggestions",
                    count=len(task_suggestions),
                )
                print(
                    json.dumps({"type": "task_suggestions", "data": task_suggestions}),
                    flush=True,
                )

    except Exception as e:
        debug_error(
            "insights_runner",
            "SDK query failed, falling back to simple mode",
            error=str(e),
        )

        import traceback

        traceback.print_exc(file=sys.stderr)
        run_simple(project_dir, message, history)

    debug_success("insights_runner", "Query completed")


def run_simple(project_dir: str, message: str, history: list) -> None:
    """Fallback simple response when SDK is unavailable.

    Args:
        project_dir: Path to the project directory
        message: The user's message
        history: List of previous messages in the conversation
    """
    response = {
        "type": "simple_response",
        "data": {
            "content": (
                "I'm currently unable to access the Claude SDK for code analysis. "
                "This could be due to:\n"
                "1. Missing authentication token (run `claude` and type `/login`)\n"
                "2. Claude SDK package not installed\n"
                "3. Network connectivity issues\n\n"
                "Please check your configuration and try again."
            )
        },
    }
    print(json.dumps(response), flush=True)


def main():
    """CLI entry point for insights runner.

    Parses command-line arguments and initiates the insights query.
    """
    parser = argparse.ArgumentParser(
        description="Insights Chat - Interactive codebase Q&A with Claude SDK"
    )
    parser.add_argument(
        "project_dir",
        help="Project directory to analyze",
    )
    parser.add_argument(
        "--message",
        required=True,
        help="User message/question",
    )
    parser.add_argument(
        "--history-file",
        help="JSON file containing conversation history",
    )
    parser.add_argument(
        "--model",
        default="sonnet",
        help="Model to use (default: sonnet)",
    )
    parser.add_argument(
        "--thinking-level",
        default="medium",
        choices=["none", "low", "medium", "high", "ultrathink"],
        help="Thinking level for extended reasoning (default: medium)",
    )
    parser.add_argument(
        "--dangerously-skip-permissions",
        action="store_true",
        help="DANGEROUS: Bypasses all filesystem permission checks. Only use in fully trusted environments where you control the code being executed. This gives the AI unrestricted file system access.",
    )

    args = parser.parse_args()

    # Load history if provided
    history = []
    if args.history_file:
        try:
            with open(args.history_file) as f:
                history = json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load history file: {e}", file=sys.stderr)

    # Add current message to history
    history.append({"role": "user", "content": args.message})

    # Run the query
    asyncio.run(
        run_with_sdk(
            args.project_dir,
            args.message,
            history,
            args.model,
            args.thinking_level,
            args.dangerously_skip_permissions,
        )
    )


if __name__ == "__main__":
    main()

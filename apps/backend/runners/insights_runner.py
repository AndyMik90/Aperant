#!/usr/bin/env python3
"""
Insights Runner - AI chat for codebase insights using Claude SDK

This script provides an AI-powered chat interface for asking questions
about a codebase. It can also suggest tasks based on the conversation.
"""

import argparse
import asyncio
import base64
import json
import sys
import tempfile
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Validate platform-specific dependencies BEFORE any imports that might
# trigger graphiti_core -> real_ladybug -> pywintypes import chain (ACS-253)
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file with centralized error handling
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

try:
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    SDK_AVAILABLE = True
except ImportError:
    SDK_AVAILABLE = False
    ClaudeAgentOptions = None
    ClaudeSDKClient = None

from core.auth import ensure_claude_code_oauth_token, get_auth_token
from debug import (
    debug,
    debug_detailed,
    debug_error,
    debug_section,
    debug_success,
)
from phase_config import get_thinking_budget, resolve_model_id, sanitize_thinking_level


def load_project_context(project_dir: str) -> str:
    """Load project context for the AI."""
    context_parts = []

    # Load project index if available (from .auto-claude - the installed instance)
    index_path = Path(project_dir) / ".auto-claude" / "project_index.json"
    if index_path.exists():
        try:
            with open(index_path, encoding="utf-8") as f:
                index = json.load(f)
            # Summarize the index for context
            summary = {
                "project_root": index.get("project_root", ""),
                "project_type": index.get("project_type", "unknown"),
                "services": list(index.get("services", {}).keys()),
                "infrastructure": index.get("infrastructure", {}),
            }
            context_parts.append(
                f"## Project Structure\n```json\n{json.dumps(summary, indent=2)}\n```"
            )
        except Exception:
            pass

    # Load roadmap if available
    roadmap_path = Path(project_dir) / ".auto-claude" / "roadmap" / "roadmap.json"
    if roadmap_path.exists():
        try:
            with open(roadmap_path, encoding="utf-8") as f:
                roadmap = json.load(f)
            # Summarize roadmap
            features = roadmap.get("features", [])
            feature_summary = [
                {"title": f.get("title", ""), "status": f.get("status", "")}
                for f in features[:10]
            ]
            context_parts.append(
                f"## Roadmap Features\n```json\n{json.dumps(feature_summary, indent=2)}\n```"
            )
        except Exception:
            pass

    # Load existing tasks
    tasks_path = Path(project_dir) / ".auto-claude" / "specs"
    if tasks_path.exists():
        try:
            task_dirs = [d for d in tasks_path.iterdir() if d.is_dir()]
            task_names = [d.name for d in task_dirs[:10]]
            if task_names:
                context_parts.append(
                    "## Existing Tasks/Specs\n- " + "\n- ".join(task_names)
                )
        except Exception:
            pass

    return (
        "\n\n".join(context_parts)
        if context_parts
        else "No project context available yet."
    )


ALLOWED_MIME_TYPES = frozenset(
    ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]
)

MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024  # 10 MB (aligned with frontend MAX_IMAGE_SIZE)


def load_images_from_manifest(manifest_path: str) -> list[dict]:
    """Load images from a manifest JSON file.

    The manifest contains an array of objects with 'path' and 'mimeType' fields.
    Each image file is read as binary and encoded to base64.

    Returns a list of dicts with 'media_type' and 'data' (base64-encoded) fields.
    """
    images = []
    tmp_dir = Path(tempfile.gettempdir()).resolve()

    try:
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)

        for entry in manifest:
            image_path = entry.get("path")
            mime_type = entry.get("mimeType", "image/png")

            if not image_path:
                debug_error(
                    "insights_runner",
                    "Image entry missing path field",
                )
                continue

            # Validate path is within temp directory before checking existence
            try:
                resolved = Path(image_path).resolve()
                if not resolved.is_relative_to(tmp_dir):
                    debug_error(
                        "insights_runner",
                        f"Image path outside temp directory, skipping: {image_path}",
                    )
                    continue
            except (ValueError, OSError):
                debug_error(
                    "insights_runner",
                    f"Invalid image path, skipping: {image_path}",
                )
                continue

            if not resolved.exists():
                debug_error(
                    "insights_runner",
                    f"Image file not found: {image_path}",
                )
                continue

            # Validate MIME type against allowlist
            if mime_type not in ALLOWED_MIME_TYPES:
                debug_error(
                    "insights_runner",
                    f"Invalid MIME type '{mime_type}', skipping: {image_path}",
                )
                continue

            # Validate file size
            file_size = resolved.stat().st_size
            if file_size > MAX_IMAGE_FILE_SIZE:
                debug_error(
                    "insights_runner",
                    f"Image too large ({file_size} bytes), skipping: {image_path}",
                )
                continue

            try:
                with open(resolved, "rb") as img_f:
                    image_data = base64.b64encode(img_f.read()).decode("utf-8")
                images.append(
                    {
                        "media_type": mime_type,
                        "data": image_data,
                    }
                )
                debug(
                    "insights_runner",
                    "Loaded image",
                    path=image_path,
                    mime_type=mime_type,
                    size_bytes=file_size,
                )
            except Exception as e:
                debug_error(
                    "insights_runner",
                    f"Failed to read image {image_path}: {e}",
                )

    except (json.JSONDecodeError, OSError) as e:
        debug_error("insights_runner", f"Failed to load images manifest: {e}")

    return images


def build_system_prompt(project_dir: str) -> str:
    """Build the system prompt for the insights agent."""
    context = load_project_context(project_dir)

    return f"""You are an AI assistant helping developers understand and work with their codebase.
You have access to the following project context:

{context}

Your capabilities:
1. Answer questions about the codebase structure, patterns, and architecture
2. Suggest improvements, features, or bug fixes based on the code
3. Help plan implementation of new features
4. Provide code examples and explanations

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
    images: list[dict] | None = None,
) -> None:
    """Run the chat using Claude SDK with streaming."""
    if not SDK_AVAILABLE:
        print("Claude SDK not available, falling back to simple mode", file=sys.stderr)
        run_simple(project_dir, message, history, images)
        return

    if not get_auth_token():
        print(
            "No authentication token found, falling back to simple mode",
            file=sys.stderr,
        )
        run_simple(project_dir, message, history, images)
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
    )

    try:
        options_kwargs = {
            "model": resolve_model_id(model),  # Resolve via API Profile if configured
            "system_prompt": system_prompt,
            "allowed_tools": ["Read", "Glob", "Grep"],
            "max_turns": 30,  # Allow sufficient turns for codebase exploration
            "cwd": str(project_path),
        }

        options_kwargs["max_thinking_tokens"] = max_thinking_tokens

        # Create Claude SDK client with appropriate settings for insights
        client = ClaudeSDKClient(options=ClaudeAgentOptions(**options_kwargs))

        # Use async context manager pattern
        async with client:
            # Build the query - images are stored for reference but SDK doesn't support multi-modal input yet
            if images:
                debug(
                    "insights_runner",
                    "Images attached but SDK does not support multi-modal input",
                    image_count=len(images),
                )

                # TODO: When the SDK adds support for multi-modal content blocks, update this.
                image_note = f"\n\n[Note: The user attached {len(images)} image(s), but the current SDK version does not support multi-modal input. Please ask the user to describe the image content instead.]"
                print(
                    "Warning: Image attachments cannot be sent to the model in SDK mode. Sending text-only query.",
                    file=sys.stderr,
                )
                await client.query(full_prompt + image_note)
            else:
                # Send the query as plain text
                await client.query(full_prompt)

            # Stream the response
            response_text = ""
            current_tool = None

            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                debug_detailed("insights_runner", "Received message", msg_type=msg_type)

                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__
                        debug_detailed(
                            "insights_runner", "Processing block", block_type=block_type
                        )
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            text = block.text
                            debug_detailed(
                                "insights_runner", "Text block", text_length=len(text)
                            )
                            # Print text with newline to ensure proper line separation for parsing
                            print(text, flush=True)
                            response_text += text
                        elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                            # Emit tool start marker for UI feedback
                            tool_name = block.name
                            tool_input = ""

                            # Extract a brief description of what the tool is doing
                            if hasattr(block, "input") and block.input:
                                inp = block.input
                                if isinstance(inp, dict):
                                    if "pattern" in inp:
                                        tool_input = f"pattern: {inp['pattern']}"
                                    elif "file_path" in inp:
                                        # Shorten path for display
                                        fp = inp["file_path"]
                                        if len(fp) > 50:
                                            fp = "..." + fp[-47:]
                                        tool_input = fp
                                    elif "path" in inp:
                                        tool_input = inp["path"]

                            current_tool = tool_name
                            print(
                                f"__TOOL_START__:{json.dumps({'name': tool_name, 'input': tool_input})}",
                                flush=True,
                            )

                elif msg_type == "ToolResult":
                    # Tool finished executing
                    if current_tool:
                        print(
                            f"__TOOL_END__:{json.dumps({'name': current_tool})}",
                            flush=True,
                        )
                        current_tool = None

            # Ensure we have a newline at the end
            if response_text and not response_text.endswith("\n"):
                print()

            debug(
                "insights_runner",
                "Response complete",
                response_length=len(response_text),
            )

    except Exception as e:
        print(f"Error using Claude SDK: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc(file=sys.stderr)
        run_simple(project_dir, message, history, images)


def run_simple(
    project_dir: str, message: str, history: list, images: list[dict] | None = None
) -> None:
    """Simple fallback mode without SDK - uses subprocess to call claude CLI."""
    import subprocess

    if images:
        print(
            "Warning: Image attachments are not supported in simple mode and will be skipped.",
            file=sys.stderr,
        )

    system_prompt = build_system_prompt(project_dir)

    # Build conversation context
    conversation_context = ""
    for msg in history[:-1]:
        role = "User" if msg.get("role") == "user" else "Assistant"
        conversation_context += f"\n{role}: {msg['content']}\n"

    # Create the full prompt
    full_prompt = f"""{system_prompt}

Previous conversation:
{conversation_context}

User: {message}
Assistant:"""

    try:
        # Try to use claude CLI with --print for simple output
        result = subprocess.run(
            ["claude", "--print", "-p", full_prompt],
            capture_output=True,
            text=True,
            cwd=project_dir,
            timeout=120,
        )

        if result.returncode == 0:
            print(result.stdout)
        else:
            # Fallback response if claude CLI fails
            print(
                f"I apologize, but I encountered an issue processing your request. "
                f"Please ensure Claude CLI is properly configured.\n\n"
                f"Your question was: {message}\n\n"
                f"Based on the project context available, I can help you with:\n"
                f"- Understanding the codebase structure\n"
                f"- Suggesting improvements\n"
                f"- Planning new features\n\n"
                f"Please try again or check your Claude CLI configuration."
            )

    except subprocess.TimeoutExpired:
        print("Request timed out. Please try a shorter query.")
    except FileNotFoundError:
        print("Claude CLI not found. Please ensure it is installed and in your PATH.")
    except Exception as e:
        print(f"Error: {e}")


def main():
    parser = argparse.ArgumentParser(description="Insights AI Chat Runner")
    parser.add_argument("--project-dir", required=True, help="Project directory path")
    parser.add_argument("--message", required=True, help="User message")
    parser.add_argument("--history", default="[]", help="JSON conversation history")
    parser.add_argument(
        "--history-file", help="Path to JSON file containing conversation history"
    )
    parser.add_argument(
        "--model",
        default="sonnet",
        help="Model to use (haiku, sonnet, opus, or full model ID)",
    )
    parser.add_argument(
        "--thinking-level",
        default="medium",
        help="Thinking level for extended reasoning (low, medium, high)",
    )
    parser.add_argument(
        "--images-file",
        help="Path to JSON manifest file listing image file paths and MIME types",
    )
    args = parser.parse_args()

    # Validate and sanitize thinking level (handles legacy values like 'ultrathink')
    args.thinking_level = sanitize_thinking_level(args.thinking_level)

    debug_section("insights_runner", "Starting Insights Chat")

    project_dir = args.project_dir
    user_message = args.message
    model = args.model
    thinking_level = args.thinking_level

    debug(
        "insights_runner",
        "Arguments",
        project_dir=project_dir,
        message_length=len(user_message),
        model=model,
        thinking_level=thinking_level,
    )

    # Load history from file if provided, otherwise parse inline JSON
    try:
        if args.history_file:
            debug(
                "insights_runner", "Loading history from file", file=args.history_file
            )
            with open(args.history_file, encoding="utf-8") as f:
                history = json.load(f)
            debug_detailed(
                "insights_runner",
                "Loaded history from file",
                history_length=len(history),
            )
        else:
            history = json.loads(args.history)
            debug_detailed(
                "insights_runner", "Parsed inline history", history_length=len(history)
            )
    except (json.JSONDecodeError, FileNotFoundError, OSError) as e:
        debug_error("insights_runner", f"Failed to load history: {e}")
        history = []

    # Load images from manifest file if provided
    images = None
    if args.images_file:
        debug("insights_runner", "Loading images from manifest", file=args.images_file)
        images = load_images_from_manifest(args.images_file)
        if images:
            debug(
                "insights_runner",
                "Loaded images for multi-modal query",
                image_count=len(images),
            )
        else:
            debug("insights_runner", "No valid images loaded from manifest")

    # Run the async SDK function
    debug("insights_runner", "Running SDK query")
    asyncio.run(
        run_with_sdk(project_dir, user_message, history, model, thinking_level, images)
    )
    debug_success("insights_runner", "Query completed")


if __name__ == "__main__":
    main()

"""
Insights Router
===============

API endpoints for the Insights chat feature.

This router provides:
- Session management (create, switch, delete, rename)
- SSE streaming endpoint for real-time AI responses
- Integration with insights_runner.py for Claude SDK chat
"""

import asyncio
import json
import os
import sys
import tempfile
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from ..utils.security import get_secure_logger
from .projects import load_projects

router = APIRouter()
logger = get_secure_logger("auto-claude-api")


class InsightsMessage(BaseModel):
    """A single chat message."""

    id: str
    role: str  # 'user' or 'assistant'
    content: str
    timestamp: str


class InsightsSession(BaseModel):
    """An Insights chat session."""

    id: str
    title: str
    messages: list[InsightsMessage] = []
    createdAt: str
    updatedAt: str


class InsightsModelConfig(BaseModel):
    """Model configuration for insights."""

    model: str = "sonnet"
    thinkingLevel: str = "medium"


class SendMessageRequest(BaseModel):
    """Request to send a message."""

    message: str
    modelConfig: InsightsModelConfig | None = None


def get_insights_dir(project_path: Path) -> Path:
    """Get the insights sessions directory for a project."""
    return project_path / ".auto-claude" / "insights"


def get_session_file(project_path: Path, session_id: str) -> Path:
    """Get the path to a session file."""
    from ..utils.security import safe_join_path

    # Safely join path with validation
    insights_dir = get_insights_dir(project_path)
    return safe_join_path(insights_dir, f"{session_id}.json")


def get_current_session_file(project_path: Path) -> Path:
    """Get the current session pointer file."""
    return get_insights_dir(project_path) / "current_session.txt"


def load_session(project_path: Path, session_id: str) -> dict | None:
    """Load a session from disk."""
    session_file = get_session_file(project_path, session_id)
    if not session_file.exists():
        return None
    try:
        with open(session_file) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def save_session(project_path: Path, session: dict) -> None:
    """Save a session to disk."""
    insights_dir = get_insights_dir(project_path)
    insights_dir.mkdir(parents=True, exist_ok=True)

    session_file = get_session_file(project_path, session["id"])
    with open(session_file, "w") as f:
        json.dump(session, f, indent=2)


def get_current_session_id(project_path: Path) -> str | None:
    """Get the current session ID."""
    pointer_file = get_current_session_file(project_path)
    if not pointer_file.exists():
        return None
    try:
        return pointer_file.read_text().strip()
    except OSError:
        return None


def set_current_session_id(project_path: Path, session_id: str) -> None:
    """Set the current session ID."""
    insights_dir = get_insights_dir(project_path)
    insights_dir.mkdir(parents=True, exist_ok=True)

    pointer_file = get_current_session_file(project_path)
    pointer_file.write_text(session_id)


def list_all_sessions(project_path: Path) -> list[dict]:
    """List all sessions for a project."""
    insights_dir = get_insights_dir(project_path)
    if not insights_dir.exists():
        return []

    sessions = []
    for session_file in insights_dir.glob("*.json"):
        try:
            with open(session_file) as f:
                session = json.load(f)
                sessions.append(
                    {
                        "id": session.get("id", ""),
                        "title": session.get("title", "Untitled"),
                        "messageCount": len(session.get("messages", [])),
                        "createdAt": session.get("createdAt", ""),
                        "updatedAt": session.get("updatedAt", ""),
                    }
                )
        except (json.JSONDecodeError, OSError):
            continue

    # Sort by updated time, newest first
    sessions.sort(key=lambda s: s.get("updatedAt", ""), reverse=True)
    return sessions


def create_new_session(project_path: Path, title: str = "New Chat") -> dict:
    """Create a new session."""
    now = datetime.utcnow().isoformat()
    session = {
        "id": str(uuid.uuid4()),
        "title": title,
        "messages": [],
        "createdAt": now,
        "updatedAt": now,
    }
    save_session(project_path, session)
    set_current_session_id(project_path, session["id"])
    return session


def get_project_path(project_id: str) -> Path:
    """Get project path from project ID."""
    projects = load_projects()
    for p in projects:
        if p.get("id") == project_id:
            return Path(p.get("path", ""))
    raise HTTPException(status_code=404, detail="Project not found")


@router.get("/projects/{project_id}/insights/session")
async def get_insights_session(project_id: str) -> dict:
    """Get the current insights session for a project."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": True, "data": None}

    # Get current session ID
    session_id = get_current_session_id(project_path)

    if not session_id:
        # Create a new session
        session = create_new_session(project_path)
        return {"success": True, "data": session}

    # Load the session
    session = load_session(project_path, session_id)
    if not session:
        # Session file missing, create new one
        session = create_new_session(project_path)

    return {"success": True, "data": session}


@router.get("/projects/{project_id}/insights/sessions")
async def list_insights_sessions(project_id: str) -> dict:
    """List all insights sessions for a project."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": True, "data": []}

    sessions = list_all_sessions(project_path)
    return {"success": True, "data": sessions}


@router.post("/projects/{project_id}/insights/session")
async def new_insights_session(project_id: str) -> dict:
    """Create a new insights session."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    session = create_new_session(project_path)
    return {"success": True, "data": session}


@router.post("/projects/{project_id}/insights/session/{session_id}/switch")
async def switch_insights_session(project_id: str, session_id: str) -> dict:
    """Switch to a different insights session."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    session = load_session(project_path, session_id)
    if not session:
        return {"success": False, "error": "Session not found"}

    set_current_session_id(project_path, session_id)
    return {"success": True, "data": session}


@router.delete("/projects/{project_id}/insights/session/{session_id}")
async def delete_insights_session(project_id: str, session_id: str) -> dict:
    """Delete an insights session."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    session_file = get_session_file(project_path, session_id)
    if session_file.exists():
        session_file.unlink()

    # If this was the current session, clear the pointer
    current_id = get_current_session_id(project_path)
    if current_id == session_id:
        pointer_file = get_current_session_file(project_path)
        if pointer_file.exists():
            pointer_file.unlink()

    return {"success": True}


@router.patch("/projects/{project_id}/insights/session/{session_id}")
async def rename_insights_session(
    project_id: str, session_id: str, updates: dict
) -> dict:
    """Rename an insights session."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    session = load_session(project_path, session_id)
    if not session:
        return {"success": False, "error": "Session not found"}

    if "title" in updates:
        session["title"] = updates["title"]

    session["updatedAt"] = datetime.utcnow().isoformat()
    save_session(project_path, session)

    return {"success": True, "data": session}


@router.delete("/projects/{project_id}/insights/session")
async def clear_insights_session(project_id: str) -> dict:
    """Clear the current insights session (delete all messages)."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    session_id = get_current_session_id(project_path)
    if not session_id:
        return {"success": True}

    session = load_session(project_path, session_id)
    if session:
        session["messages"] = []
        session["updatedAt"] = datetime.utcnow().isoformat()
        save_session(project_path, session)

    return {"success": True}


@router.post("/projects/{project_id}/insights/message")
async def send_insights_message(
    project_id: str, request: SendMessageRequest
) -> StreamingResponse:
    """Send a message to the insights chat with SSE streaming response.

    This endpoint:
    1. Saves the user message to the session
    2. Spawns insights_runner.py as a subprocess
    3. Streams the response back via Server-Sent Events (SSE)
    4. Saves the assistant response when complete
    """
    project_path = get_project_path(project_id)

    if not project_path.exists():

        async def error_stream():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Project path not found'})}\n\n"

        return StreamingResponse(error_stream(), media_type="text/event-stream")

    # Get or create session
    session_id = get_current_session_id(project_path)
    if not session_id:
        session = create_new_session(project_path)
        session_id = session["id"]
    else:
        session = load_session(project_path, session_id)
        if not session:
            session = create_new_session(project_path)
            session_id = session["id"]

    now = datetime.utcnow().isoformat()

    # Add user message
    user_message = {
        "id": f"msg-{uuid.uuid4()}",
        "role": "user",
        "content": request.message,
        "timestamp": now,
    }
    session["messages"].append(user_message)

    # Update session title if it's the first message
    if len(session["messages"]) == 1:
        words = request.message.split()[:5]
        session["title"] = " ".join(words) + ("..." if len(words) == 5 else "")

    session["updatedAt"] = now
    save_session(project_path, session)

    # Get model config
    model = request.modelConfig.model if request.modelConfig else "sonnet"
    thinking_level = (
        request.modelConfig.thinkingLevel if request.modelConfig else "medium"
    )

    async def stream_response() -> AsyncGenerator[str, None]:
        """Stream the AI response via SSE."""
        # Send user message confirmation
        yield f"data: {json.dumps({'type': 'user_message', 'message': user_message})}\n\n"

        # Prepare conversation history for the runner
        history = session.get("messages", [])

        # Write history to temp file to avoid command line length limits
        history_file = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False
            ) as f:
                json.dump(history, f)
                history_file = f.name

            # Find Python executable (prefer virtual environment)
            python_path = sys.executable

            # Find insights_runner.py
            runner_path = _PARENT_DIR / "runners" / "insights_runner.py"

            if not runner_path.exists():
                yield f"data: {json.dumps({'type': 'error', 'error': f'Insights runner not found at {runner_path}'})}\n\n"
                return

            # Build command
            cmd = [
                python_path,
                str(runner_path),
                "--project-dir",
                str(project_path),
                "--message",
                request.message,
                "--history-file",
                history_file,
                "--model",
                model,
                "--thinking-level",
                thinking_level,
            ]

            logger.info(f"Starting insights runner: {' '.join(cmd[:4])}...")

            # Start subprocess
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(project_path),
            )

            response_text = ""

            # Stream stdout
            try:
                while True:
                    line = await asyncio.wait_for(
                        process.stdout.readline(),
                        timeout=120.0,  # 2 minute timeout per line
                    )

                    if not line:
                        break

                    text = line.decode("utf-8", errors="replace")

                    # Parse special markers from insights_runner.py
                    if text.startswith("__TOOL_START__:"):
                        try:
                            tool_data = json.loads(text[15:].strip())
                            yield f"data: {json.dumps({'type': 'tool_start', 'tool': tool_data})}\n\n"
                        except json.JSONDecodeError:
                            pass
                    elif text.startswith("__TOOL_END__:"):
                        try:
                            tool_data = json.loads(text[13:].strip())
                            yield f"data: {json.dumps({'type': 'tool_end', 'tool': tool_data})}\n\n"
                        except json.JSONDecodeError:
                            pass
                    elif text.startswith("__TASK_SUGGESTION__:"):
                        try:
                            task_data = json.loads(text[20:].strip())
                            yield f"data: {json.dumps({'type': 'task_suggestion', 'suggestedTask': task_data})}\n\n"
                        except json.JSONDecodeError:
                            pass
                    else:
                        # Regular text content
                        response_text += text
                        yield f"data: {json.dumps({'type': 'text', 'content': text})}\n\n"

            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'error', 'error': 'Response timeout'})}\n\n"
                process.kill()
                return

            # Wait for process to complete
            await process.wait()

            # Check stderr for errors
            stderr_data = await process.stderr.read()
            if stderr_data and process.returncode != 0:
                stderr_text = stderr_data.decode("utf-8", errors="replace")
                logger.error(f"Insights runner error: {stderr_text}")
                # Only yield error if we got no response
                if not response_text.strip():
                    yield f"data: {json.dumps({'type': 'error', 'error': stderr_text[:500]})}\n\n"

            # Save assistant message
            assistant_message = {
                "id": f"msg-{uuid.uuid4()}",
                "role": "assistant",
                "content": response_text.strip(),
                "timestamp": datetime.utcnow().isoformat(),
            }

            # Reload session to avoid race conditions
            current_session = load_session(project_path, session_id)
            if current_session:
                current_session["messages"].append(assistant_message)
                current_session["updatedAt"] = datetime.utcnow().isoformat()
                save_session(project_path, current_session)

            # Send completion event
            yield f"data: {json.dumps({'type': 'done', 'message': assistant_message})}\n\n"

        except Exception as e:
            logger.exception("Error in insights stream")
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        finally:
            # Clean up temp file
            if history_file and os.path.exists(history_file):
                try:
                    os.unlink(history_file)
                except Exception:
                    pass

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )

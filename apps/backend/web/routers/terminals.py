"""
Terminal Router
===============

WebSocket-based terminal (PTY) support for web mode.

This enables running interactive shell sessions from the browser
using WebSockets to communicate with PTY processes on the backend.
"""

import asyncio
import json
import os
import pty
import select
import shutil
import signal
import struct
import termios
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..utils.security import get_secure_logger

router = APIRouter()
logger = get_secure_logger("auto-claude-api")


@dataclass
class TerminalSession:
    """Represents an active terminal session."""

    id: str
    pid: int
    fd: int
    cwd: str
    shell: str
    websocket: WebSocket | None = None
    cols: int = 80
    rows: int = 24
    name: str = "Terminal"
    is_active: bool = True
    project_path: str | None = None


# Store active terminal sessions
_terminal_sessions: dict[str, TerminalSession] = {}


def get_default_shell() -> str:
    """Get the default shell for the current user."""
    # Try common shells in order of preference
    shells = [
        os.environ.get("SHELL"),
        shutil.which("zsh"),
        shutil.which("bash"),
        shutil.which("sh"),
    ]

    for shell in shells:
        if shell and os.path.exists(shell):
            return shell

    return "/bin/sh"


def create_pty_process(
    cwd: str,
    shell: str | None = None,
    env: dict | None = None,
    cols: int = 80,
    rows: int = 24,
) -> tuple[int, int]:
    """Create a PTY process with the given shell.

    Returns:
        Tuple of (pid, master_fd)
    """
    if shell is None:
        shell = get_default_shell()

    # Build environment
    process_env = os.environ.copy()
    process_env["TERM"] = "xterm-256color"
    process_env["COLORTERM"] = "truecolor"
    process_env["LANG"] = os.environ.get("LANG", "en_US.UTF-8")

    # Add any custom environment variables
    if env:
        process_env.update(env)

    # Create PTY
    pid, fd = pty.fork()

    if pid == 0:
        # Child process
        os.chdir(cwd)
        os.execve(shell, [shell, "-l"], process_env)
    else:
        # Parent process
        # Set terminal size
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        import fcntl

        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

        return pid, fd


def resize_pty(fd: int, cols: int, rows: int) -> None:
    """Resize a PTY to the given dimensions."""
    import fcntl

    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


@router.get("/terminals")
async def list_terminals(projectPath: str | None = None) -> dict:
    """List all active terminal sessions.

    Args:
        projectPath: Optional filter to only return terminals for a specific project
    """
    terminals = []
    for session_id, session in _terminal_sessions.items():
        if session.is_active:
            # Filter by project path if provided
            if projectPath and session.project_path != projectPath:
                continue

            terminals.append(
                {
                    "id": session_id,
                    "name": session.name,
                    "cwd": session.cwd,
                    "shell": session.shell,
                    "cols": session.cols,
                    "rows": session.rows,
                    "connected": session.websocket is not None,
                    "projectPath": session.project_path,
                }
            )

    return {"success": True, "data": terminals}


@router.post("/terminals")
async def create_terminal(request: dict) -> dict:
    """Create a new terminal session.

    Request body:
        - cwd: Working directory (required)
        - name: Terminal name (optional)
        - shell: Shell to use (optional, defaults to user's shell)
        - cols: Terminal width (optional, default 80)
        - rows: Terminal height (optional, default 24)
        - env: Additional environment variables (optional)
        - projectPath: Project path for filtering (optional)
    """
    cwd = request.get("cwd", str(Path.home()))
    name = request.get("name", "Terminal")
    shell = request.get("shell")
    cols = request.get("cols", 80)
    rows = request.get("rows", 24)
    env = request.get("env", {})
    project_path = request.get("projectPath")

    # Validate cwd
    cwd_path = Path(cwd)
    if not cwd_path.exists():
        return {"success": False, "error": f"Directory does not exist: {cwd}"}

    if not cwd_path.is_dir():
        return {"success": False, "error": f"Not a directory: {cwd}"}

    try:
        # Create PTY process
        if shell is None:
            shell = get_default_shell()

        pid, fd = create_pty_process(cwd, shell, env, cols, rows)

        # Generate session ID
        session_id = str(uuid.uuid4())

        # Store session
        session = TerminalSession(
            id=session_id,
            pid=pid,
            fd=fd,
            cwd=cwd,
            shell=shell,
            cols=cols,
            rows=rows,
            name=name,
            project_path=project_path,
        )
        _terminal_sessions[session_id] = session

        logger.info(
            f"Created terminal session {session_id} (pid={pid}, shell={shell}, project={project_path})"
        )

        return {
            "success": True,
            "data": {
                "id": session_id,
                "pid": pid,
                "name": name,
                "cwd": cwd,
                "shell": shell,
                "cols": cols,
                "rows": rows,
                "projectPath": project_path,
            },
        }
    except Exception as e:
        logger.exception("Failed to create terminal")
        return {"success": False, "error": str(e)}


@router.delete("/terminals/{terminal_id}")
async def close_terminal(terminal_id: str) -> dict:
    """Close a terminal session."""
    session = _terminal_sessions.get(terminal_id)

    if not session:
        return {"success": False, "error": "Terminal not found"}

    try:
        # Close the PTY
        os.close(session.fd)

        # Kill the process
        try:
            os.kill(session.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass  # Already dead

        # Close websocket if connected
        if session.websocket:
            try:
                await session.websocket.close()
            except Exception:
                pass

        # Remove from sessions
        session.is_active = False
        del _terminal_sessions[terminal_id]

        logger.info(f"Closed terminal session {terminal_id}")

        return {"success": True}
    except Exception as e:
        logger.exception(f"Failed to close terminal {terminal_id}")
        return {"success": False, "error": str(e)}


@router.post("/terminals/{terminal_id}/resize")
async def resize_terminal(terminal_id: str, request: dict) -> dict:
    """Resize a terminal."""
    session = _terminal_sessions.get(terminal_id)

    if not session:
        return {"success": False, "error": "Terminal not found"}

    cols = request.get("cols", 80)
    rows = request.get("rows", 24)

    try:
        resize_pty(session.fd, cols, rows)
        session.cols = cols
        session.rows = rows

        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/terminals/{terminal_id}/write")
async def write_to_terminal(terminal_id: str, request: dict) -> dict:
    """Write data to a terminal (for non-WebSocket usage)."""
    session = _terminal_sessions.get(terminal_id)

    if not session:
        return {"success": False, "error": "Terminal not found"}

    data = request.get("data", "")

    try:
        os.write(session.fd, data.encode())
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.websocket("/terminals/{terminal_id}/ws")
async def terminal_websocket(websocket: WebSocket, terminal_id: str):
    """WebSocket endpoint for terminal I/O.

    This handles bidirectional communication between the browser
    and the PTY process.
    """
    session = _terminal_sessions.get(terminal_id)

    if not session:
        await websocket.close(code=4004, reason="Terminal not found")
        return

    await websocket.accept()
    session.websocket = websocket

    logger.info(f"WebSocket connected to terminal {terminal_id}")

    # Set non-blocking mode on the PTY fd
    import fcntl

    flags = fcntl.fcntl(session.fd, fcntl.F_GETFL)
    fcntl.fcntl(session.fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    async def read_pty():
        """Read from PTY and send to WebSocket."""
        while session.is_active:
            try:
                # Use select to check if data is available
                readable, _, _ = select.select([session.fd], [], [], 0.1)

                if readable:
                    try:
                        data = os.read(session.fd, 4096)
                        if data:
                            await websocket.send_text(
                                data.decode("utf-8", errors="replace")
                            )
                        else:
                            # EOF - process exited
                            logger.info(f"Terminal {terminal_id} process exited")
                            break
                    except OSError as e:
                        if e.errno == 5:  # EIO - terminal closed
                            break
                        raise

                await asyncio.sleep(0.01)  # Small delay to prevent CPU spin

            except Exception as e:
                logger.error(f"Error reading from PTY: {e}")
                break

        # Notify client that terminal closed
        try:
            await websocket.send_json({"type": "exit", "code": 0})
        except Exception:
            pass

    # Start PTY reader task
    reader_task = asyncio.create_task(read_pty())

    try:
        while True:
            # Receive data from WebSocket
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            if "text" in message:
                text = message["text"]

                # Check if it's a JSON command
                try:
                    cmd = json.loads(text)
                    if cmd.get("type") == "resize":
                        cols = cmd.get("cols", 80)
                        rows = cmd.get("rows", 24)
                        resize_pty(session.fd, cols, rows)
                        session.cols = cols
                        session.rows = rows
                        continue
                except json.JSONDecodeError:
                    pass

                # Regular input - write to PTY
                try:
                    os.write(session.fd, text.encode())
                except OSError as e:
                    logger.error(f"Error writing to PTY: {e}")
                    break

            elif "bytes" in message:
                # Binary data
                try:
                    os.write(session.fd, message["bytes"])
                except OSError as e:
                    logger.error(f"Error writing to PTY: {e}")
                    break

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected from terminal {terminal_id}")
    except Exception as e:
        logger.exception(f"WebSocket error for terminal {terminal_id}")
    finally:
        # Clean up
        session.websocket = None
        reader_task.cancel()

        try:
            await reader_task
        except asyncio.CancelledError:
            pass


# Cleanup on shutdown
async def cleanup_terminals():
    """Clean up all terminal sessions."""
    for session_id in list(_terminal_sessions.keys()):
        await close_terminal(session_id)


def get_terminal_count() -> int:
    """Get the number of active terminals."""
    return len([s for s in _terminal_sessions.values() if s.is_active])

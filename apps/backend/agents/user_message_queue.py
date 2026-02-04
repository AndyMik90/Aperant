"""
User Message Queue Module
=========================

Provides real-time chat communication between the Jerry frontend and running task agents.
Messages are read from stdin in a background thread and queued for processing by the
agent main loop at iteration boundaries.

This enables users to send feedback/guidance to running agents without blocking execution.
"""

import asyncio
import json
import logging
import os
import select
import sys
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

# Platform detection for stdin timeout handling
IS_WINDOWS = sys.platform == "win32"

logger = logging.getLogger(__name__)


@dataclass
class UserMessage:
    """A message from the user sent via the frontend chat."""

    content: str
    timestamp: datetime


# Control commands that the user can send to pause/stop/resume the agent
# These are matched case-insensitively against the message content
STOP_COMMANDS = frozenset(["stop", "halt", "cancel", "abort"])
PAUSE_COMMANDS = frozenset(["pause", "wait", "hold"])
RESUME_COMMANDS = frozenset(["continue", "resume", "go", "proceed"])


def is_stop_command(message: str) -> bool:
    """Check if a message is a stop command."""
    normalized = message.strip().lower()
    return normalized in STOP_COMMANDS


def is_pause_command(message: str) -> bool:
    """Check if a message is a pause command."""
    normalized = message.strip().lower()
    return normalized in PAUSE_COMMANDS


def is_resume_command(message: str) -> bool:
    """Check if a message is a resume command."""
    normalized = message.strip().lower()
    return normalized in RESUME_COMMANDS


def is_control_command(message: str) -> bool:
    """Check if a message is any control command."""
    return is_stop_command(message) or is_pause_command(message) or is_resume_command(message)


class UserMessageQueue:
    """
    Thread-safe queue for user messages received via stdin.

    The queue runs a background thread that reads JSON messages from stdin.
    Messages are queued and can be retrieved by the agent main loop at iteration
    boundaries (non-blocking).

    Protocol:
        Frontend sends JSON lines to stdin:
        {"type": "user_message", "content": "your message here", "timestamp": "..."}

        Only messages with type="user_message" are processed; others are ignored.
    """

    def __init__(self):
        # Queue is created lazily in start() to ensure event loop exists
        self._queue: Optional[asyncio.Queue[UserMessage]] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        """Start the background stdin reader thread."""
        if self._reader_thread is not None:
            return

        self._loop = loop
        self._running = True

        # Create queue now that we have a running event loop
        try:
            self._queue = asyncio.Queue()
        except Exception as e:
            logger.warning(f"UserMessageQueue: Failed to create queue: {e}")
            self._queue = None
            return

        self._reader_thread = threading.Thread(
            target=self._stdin_reader, daemon=True, name="UserMessageReader"
        )
        self._reader_thread.start()
        logger.debug("UserMessageQueue: stdin reader thread started")

    def stop(self) -> None:
        """Stop the background reader thread."""
        self._running = False
        if self._reader_thread:
            # Thread is daemon, will stop with main process
            # Just wait briefly for clean shutdown
            self._reader_thread.join(timeout=0.5)
            self._reader_thread = None
            logger.debug("UserMessageQueue: stdin reader thread stopped")

    def _stdin_reader(self) -> None:
        """Background thread that reads JSON messages from stdin.

        Uses a timeout mechanism to allow clean shutdown when _running is False.
        On Unix, uses select() for efficient polling. On Windows, uses short sleeps
        with non-blocking fileno check to avoid indefinite blocking.
        """
        # Stdin read timeout in seconds (allows clean shutdown)
        STDIN_TIMEOUT = 0.5

        while self._running:
            try:
                # Check if stdin has data available (with timeout)
                if not IS_WINDOWS:
                    # Unix: use select for efficient polling
                    readable, _, _ = select.select([sys.stdin], [], [], STDIN_TIMEOUT)
                    if not readable:
                        continue
                else:
                    # Windows: select doesn't work on stdin, use msvcrt if available
                    # Fall back to blocking read with thread daemon cleanup
                    try:
                        import msvcrt

                        if not msvcrt.kbhit():
                            # No input available, sleep briefly and check _running
                            import time

                            time.sleep(STDIN_TIMEOUT)
                            continue
                    except (ImportError, OSError):
                        # msvcrt not available or stdin not a console
                        # Fall through to blocking read (daemon thread handles cleanup)
                        pass

                # Read one JSON message per line
                line = sys.stdin.readline()
                if not line:
                    # stdin closed (EOF)
                    logger.debug("UserMessageQueue: stdin closed")
                    break

                line = line.strip()
                if not line:
                    continue

                try:
                    msg = json.loads(line)
                    if msg.get("type") == "user_message":
                        content = msg.get("content", "")
                        if content and self._queue is not None:
                            user_msg = UserMessage(
                                content=content, timestamp=datetime.now()
                            )
                            # Schedule adding to queue on the event loop
                            if self._loop and not self._loop.is_closed():
                                asyncio.run_coroutine_threadsafe(
                                    self._queue.put(user_msg), self._loop
                                )
                                logger.info(
                                    f"UserMessageQueue: received message ({len(content)} chars)"
                                )
                except json.JSONDecodeError:
                    # Not a valid JSON message, ignore
                    # This handles any non-JSON output that might come through stdin
                    pass
            except Exception as e:
                # stdin read error, log and continue
                logger.debug(f"UserMessageQueue: stdin read error: {e}")
                continue

    async def get_message(self, timeout: float = 0.01) -> Optional[UserMessage]:
        """
        Non-blocking check for a single queued message.

        Args:
            timeout: Maximum time to wait in seconds (default 0.01s = 10ms)

        Returns:
            UserMessage if one is available, None otherwise
        """
        if self._queue is None:
            return None
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    async def get_all_messages(self) -> list[UserMessage]:
        """
        Get all currently queued messages (non-blocking).

        Returns all messages that have been queued, emptying the queue.
        Returns an empty list if no messages are available.
        """
        messages = []
        while True:
            msg = await self.get_message(timeout=0.001)
            if msg is None:
                break
            messages.append(msg)
        return messages

    def has_messages(self) -> bool:
        """Check if there are any queued messages (non-blocking)."""
        if self._queue is None:
            return False
        return not self._queue.empty()


# Global instance (singleton pattern)
_message_queue: Optional[UserMessageQueue] = None


def get_message_queue() -> UserMessageQueue:
    """
    Get the global message queue instance.

    Creates the instance on first call. The queue must be started with
    start(loop) before it will receive messages.
    """
    global _message_queue
    if _message_queue is None:
        _message_queue = UserMessageQueue()
    return _message_queue

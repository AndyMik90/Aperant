#!/usr/bin/env python3
"""
Tests for rate_limit_event handling in agents/session.py
==========================================================

Covers the SystemMessage(subtype="rate_limit_event") branch added to
run_agent_session's message loop to keep the stream open when Claude Code
is temporarily rate-limited.
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))


# ---------------------------------------------------------------------------
# Minimal fakes matching the types session.py checks by name
# ---------------------------------------------------------------------------


class SystemMessage:
    """Fake with the exact name session.py checks via type(msg).__name__."""

    def __init__(self, subtype: str, data: dict):
        self.subtype = subtype
        self.data = data


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_client(messages: list) -> MagicMock:
    """Return a mock ClaudeSDKClient whose receive_response yields *messages*."""

    async def _gen():
        for m in messages:
            yield m

    client = MagicMock()
    client.query = AsyncMock()
    client.receive_response = _gen
    return client


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSessionRateLimitHandler:
    """run_agent_session handles rate_limit_event SystemMessages gracefully."""

    @pytest.fixture(autouse=True)
    def _patch_deps(self, tmp_path):
        """Patch heavy dependencies so the session loop runs in isolation.

        self.task_logger defaults to None; set it to a MagicMock in a test to
        exercise the logger branch without fighting stacked patch() contexts.
        """
        self.spec_dir = tmp_path / "spec"
        self.spec_dir.mkdir()
        self.task_logger = None  # tests can override before calling the session

        def _get_logger(*_args, **_kwargs):
            return self.task_logger

        patches = [
            patch("agents.session.get_task_logger", side_effect=_get_logger),
            patch("agents.session.is_build_complete", return_value=False),
            patch("agents.session.debug"),
            patch("agents.session.debug_success"),
            patch("agents.session.debug_detailed"),
            patch("agents.session.debug_section"),
            patch("agents.session.debug_error"),
        ]
        for p in patches:
            p.start()
        yield
        for p in patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_rate_limit_event_does_not_raise(self):
        """A rate_limit_event SystemMessage is absorbed without raising."""
        msg = SystemMessage(subtype="rate_limit_event", data={"retry_after": 5})
        client = _make_client([msg])

        from agents.session import run_agent_session

        status, _, _ = await run_agent_session(client, "test prompt", self.spec_dir)
        assert status in ("continue", "complete"), f"Expected session to continue, got '{status}'"

    @pytest.mark.asyncio
    async def test_rate_limit_event_logs_to_task_logger(self):
        """When a task_logger is present, the rate limit event is logged."""
        self.task_logger = MagicMock()

        msg = SystemMessage(subtype="rate_limit_event", data={"retry_after": 10})
        client = _make_client([msg])

        from agents.session import run_agent_session

        await run_agent_session(client, "test prompt", self.spec_dir)

        self.task_logger.log.assert_called_once()
        logged_message = self.task_logger.log.call_args[0][0]
        assert "rate limit" in logged_message.lower()

    @pytest.mark.asyncio
    async def test_non_rate_limit_system_message_ignored(self):
        """SystemMessages with other subtypes are silently skipped."""
        msg = SystemMessage(subtype="some_other_event", data={})
        client = _make_client([msg])

        from agents.session import run_agent_session

        # Should not raise
        status, _, _ = await run_agent_session(client, "test prompt", self.spec_dir)
        assert status in ("continue", "complete"), f"Expected session to continue, got '{status}'"

    @pytest.mark.asyncio
    async def test_stream_continues_after_rate_limit_event(self):
        """Messages after the rate_limit_event are still processed."""
        rate_limit_msg = SystemMessage(
            subtype="rate_limit_event", data={"retry_after": 1}
        )
        # Follow with a plain assistant message to confirm loop continues
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        type(text_block).__name__ = "TextBlock"
        text_block.text = "hello"

        assistant_msg = MagicMock()
        type(assistant_msg).__name__ = "AssistantMessage"
        assistant_msg.content = [text_block]

        client = _make_client([rate_limit_msg, assistant_msg])

        from agents.session import run_agent_session

        status, response_text, _ = await run_agent_session(
            client, "test prompt", self.spec_dir
        )
        assert "hello" in response_text

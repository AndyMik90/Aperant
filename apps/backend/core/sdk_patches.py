"""Runtime patches for third-party SDK bugs."""

import logging

logger = logging.getLogger(__name__)


def apply_claude_agent_sdk_patches() -> None:
    """Patch claude_agent_sdk to handle rate_limit_event gracefully.

    The bundled SDK raises MessageParseError for unknown message types including
    rate_limit_event. This patch returns a SystemMessage instead of raising,
    allowing the message loop in session.py to handle it and keep the stream open
    while Claude Code waits for the rate limit to reset.

    Patches both:
    - message_parser.parse_message (the module attribute)
    - _internal.client.parse_message (the already-bound module-level name that
      the client's receive_response() generator actually calls via
      `from .message_parser import parse_message` at import time)

    Idempotent — safe to call multiple times from different entry points.
    """
    try:
        from claude_agent_sdk._internal import client as _ic
        from claude_agent_sdk._internal import message_parser as _mp
        from claude_agent_sdk.types import SystemMessage as _SystemMessage

        if getattr(_mp, "_rate_limit_patched", False):
            logger.debug("claude_agent_sdk already patched — skipping")
            return

        _orig_parse = _mp.parse_message

        def _patched_parse(data: dict) -> object:
            if isinstance(data, dict) and data.get("type") == "rate_limit_event":
                logger.warning(
                    "Rate limit event received from Claude Code — "
                    "returning as SystemMessage so the stream stays open: %s",
                    data,
                )
                return _SystemMessage(subtype="rate_limit_event", data=data)
            return _orig_parse(data)

        _patched_parse.__wrapped__ = _orig_parse  # type: ignore[attr-defined]

        _mp.parse_message = _patched_parse
        _ic.parse_message = _patched_parse
        _mp._rate_limit_patched = True  # type: ignore[attr-defined]
        logger.debug("claude_agent_sdk patched to handle rate_limit_event")
    except Exception:
        logger.warning(
            "Failed to apply claude_agent_sdk rate_limit_event patch — "
            "rate limit events may cause unexpected session failures",
            exc_info=True,
        )

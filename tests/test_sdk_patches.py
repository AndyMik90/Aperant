#!/usr/bin/env python3
"""
Tests for core.sdk_patches
============================

Covers:
- apply_claude_agent_sdk_patches() happy path
- Idempotency guard (no double-wrapping)
- rate_limit_event returns SystemMessage
- Other unknown message types still raise
- Graceful failure when SDK internals are unavailable
"""

import sys

# Ensure backend is on the path
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_sdk_mocks():
    """Build a minimal fake claude_agent_sdk module tree."""

    class _FakeMessageParseError(Exception):
        pass

    class _FakeSystemMessage:
        def __init__(self, subtype: str, data: dict):
            self.subtype = subtype
            self.data = data

    def _real_parse(data):
        msg_type = data.get("type") if isinstance(data, dict) else None
        if msg_type == "rate_limit_event":
            raise _FakeMessageParseError(f"Unknown message type: {msg_type}")
        if msg_type == "assistant":
            return MagicMock(type="assistant")
        raise _FakeMessageParseError(f"Unknown message type: {msg_type}")

    # Build fake module objects
    mp_mod = MagicMock()
    mp_mod.parse_message = _real_parse
    del mp_mod._rate_limit_patched  # ensure sentinel absent at start

    ic_mod = MagicMock()
    ic_mod.parse_message = _real_parse

    types_mod = MagicMock()
    types_mod.SystemMessage = _FakeSystemMessage

    sdk_mod = MagicMock()

    internal_mod = MagicMock()
    internal_mod.message_parser = mp_mod
    internal_mod.client = ic_mod

    return sdk_mod, internal_mod, mp_mod, ic_mod, types_mod, _FakeMessageParseError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_patch_sentinel():
    """Remove any leftover _rate_limit_patched sentinel between tests."""
    yield
    # Remove sdk_patches from sys.modules so each test gets a fresh import
    sys.modules.pop("core.sdk_patches", None)


# ---------------------------------------------------------------------------
# Tests for apply_claude_agent_sdk_patches
# ---------------------------------------------------------------------------


class TestApplyClaudeAgentSdkPatches:
    def _build_modules(self):
        sdk, internal, mp, ic, types, err = _make_sdk_mocks()
        modules = {
            "claude_agent_sdk": sdk,
            "claude_agent_sdk._internal": internal,
            "claude_agent_sdk._internal.message_parser": mp,
            "claude_agent_sdk._internal.client": ic,
            "claude_agent_sdk.types": types,
        }
        return modules, mp, ic, types, err

    def test_patches_both_call_sites(self):
        """parse_message is replaced on both _mp and _ic after patching."""
        modules, mp, ic, types, _ = self._build_modules()
        original = mp.parse_message

        with patch.dict(sys.modules, modules):
            from core.sdk_patches import apply_claude_agent_sdk_patches

            apply_claude_agent_sdk_patches()

        assert mp.parse_message is not original
        assert ic.parse_message is not original
        assert mp.parse_message is ic.parse_message

    def test_rate_limit_event_returns_system_message(self):
        """rate_limit_event data is converted to a SystemMessage without raising."""
        modules, mp, ic, types, _ = self._build_modules()

        with patch.dict(sys.modules, modules):
            from core.sdk_patches import apply_claude_agent_sdk_patches

            apply_claude_agent_sdk_patches()

        result = ic.parse_message({"type": "rate_limit_event", "retry_after": 30})
        assert type(result).__name__ == "FakeSystemMessage" or hasattr(
            result, "subtype"
        )
        assert result.subtype == "rate_limit_event"

    def test_other_unknown_types_still_raise(self):
        """Non-rate-limit unknown message types still propagate MessageParseError."""
        modules, mp, ic, types, FakeErr = self._build_modules()

        with patch.dict(sys.modules, modules):
            from core.sdk_patches import apply_claude_agent_sdk_patches

            apply_claude_agent_sdk_patches()

        with pytest.raises(FakeErr, match="Unknown message type: totally_unknown"):
            ic.parse_message({"type": "totally_unknown"})

    def test_valid_messages_pass_through(self):
        """Known message types are delegated to the original parser unchanged."""
        modules, mp, ic, types, _ = self._build_modules()

        with patch.dict(sys.modules, modules):
            from core.sdk_patches import apply_claude_agent_sdk_patches

            apply_claude_agent_sdk_patches()

        result = ic.parse_message({"type": "assistant"})
        assert result is not None

    def test_idempotent_second_call_skips_rewrap(self):
        """Calling apply_claude_agent_sdk_patches twice does not double-wrap."""
        modules, mp, ic, types, _ = self._build_modules()

        with patch.dict(sys.modules, modules):
            from core.sdk_patches import apply_claude_agent_sdk_patches

            apply_claude_agent_sdk_patches()
            patched_once = ic.parse_message
            apply_claude_agent_sdk_patches()
            patched_twice = ic.parse_message

        assert patched_once is patched_twice

    def test_sets_rate_limit_patched_sentinel(self):
        """_rate_limit_patched sentinel is set on the message_parser module."""
        modules, mp, ic, types, _ = self._build_modules()

        with patch.dict(sys.modules, modules):
            from core.sdk_patches import apply_claude_agent_sdk_patches

            apply_claude_agent_sdk_patches()

        assert getattr(mp, "_rate_limit_patched", False) is True

    def test_wrapped_attribute_preserves_original(self):
        """__wrapped__ on the patched function points to the original parser."""
        modules, mp, ic, types, _ = self._build_modules()
        original = mp.parse_message

        with patch.dict(sys.modules, modules):
            from core.sdk_patches import apply_claude_agent_sdk_patches

            apply_claude_agent_sdk_patches()

        assert mp.parse_message.__wrapped__ is original

    def test_graceful_failure_when_sdk_unavailable(self, caplog):
        """Patch fails silently with a warning when the SDK is not installed."""
        import logging

        broken = {"claude_agent_sdk._internal": None}
        with patch.dict(sys.modules, broken):
            sys.modules.pop("core.sdk_patches", None)
            with caplog.at_level(logging.WARNING, logger="core.sdk_patches"):
                from core.sdk_patches import apply_claude_agent_sdk_patches

                apply_claude_agent_sdk_patches()

        assert any("Failed to apply" in r.message for r in caplog.records)

    def test_non_dict_data_passes_to_original(self):
        """Non-dict data skips the rate_limit check and goes to original parser."""
        modules, mp, ic, types, FakeErr = self._build_modules()

        with patch.dict(sys.modules, modules):
            from core.sdk_patches import apply_claude_agent_sdk_patches

            apply_claude_agent_sdk_patches()

        # Original parser raises for non-dict / unknown input
        with pytest.raises(FakeErr):
            ic.parse_message("not-a-dict")

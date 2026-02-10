"""
Fast Mode Settings Helper
=========================

Manages the fastMode flag in ~/.claude/settings.json for temporary
per-task fast mode overrides. Shared by both client.py and simple_client.py.
"""

import json
import logging
from pathlib import Path

from core.file_utils import write_json_atomic

logger = logging.getLogger(__name__)

_fast_mode_atexit_registered = False


def _write_fast_mode_setting(enabled: bool) -> None:
    """Write fastMode value to ~/.claude/settings.json (atomic read-modify-write).

    Uses write_json_atomic from core.file_utils to prevent corruption when
    multiple concurrent task processes modify the file simultaneously.
    """
    settings_file = Path.home() / ".claude" / "settings.json"
    try:
        settings: dict = {}
        if settings_file.exists():
            settings = json.loads(settings_file.read_text(encoding="utf-8"))

        if settings.get("fastMode") != enabled:
            settings["fastMode"] = enabled
            settings_file.parent.mkdir(parents=True, exist_ok=True)
            # Atomic write using shared utility
            write_json_atomic(settings_file, settings)
            state = "true" if enabled else "false"
            logger.info(
                f"[Fast Mode] Wrote fastMode={state} to ~/.claude/settings.json"
            )
    except Exception as e:
        logger.warning(f"[Fast Mode] Could not update ~/.claude/settings.json: {e}")


def _disable_fast_mode_on_exit() -> None:
    """atexit handler: restore fastMode=false so interactive CLI sessions stay standard."""
    _write_fast_mode_setting(False)


def ensure_fast_mode_in_user_settings() -> None:
    """
    Enable fastMode in ~/.claude/settings.json and register cleanup.

    The CLI reads fastMode from user settings (loaded via --setting-sources user).
    This function:
    1. Writes fastMode=true before spawning the CLI subprocess
    2. Registers an atexit handler to restore fastMode=false when the process exits

    This ensures fast mode is a temporary override per task process, not a permanent
    setting change. The CLI subprocess reads settings at startup, so restoring false
    after exit doesn't affect running tasks — only prevents fast mode from leaking
    into subsequent interactive CLI sessions or non-fast-mode tasks.
    """
    global _fast_mode_atexit_registered

    _write_fast_mode_setting(True)

    # Register cleanup once per process — idempotent on repeated calls
    if not _fast_mode_atexit_registered:
        import atexit

        atexit.register(_disable_fast_mode_on_exit)
        _fast_mode_atexit_registered = True
        logger.info(
            "[Fast Mode] Registered atexit cleanup (will restore fastMode=false)"
        )

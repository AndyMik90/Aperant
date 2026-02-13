"""
Sentry Error Tracking for Python Backend
=========================================

Initializes Sentry for the Python backend with:
- Privacy-preserving path masking (usernames removed)
- Release tracking matching the Electron frontend
- Environment variable configuration (same as frontend)

Configuration:
- SENTRY_DSN: Required to enable Sentry (same as frontend)
- SENTRY_TRACES_SAMPLE_RATE: Performance monitoring sample rate (0-1, default: 0.1)
- SENTRY_ENVIRONMENT: Override environment (default: auto-detected)

Privacy Note:
- Usernames are masked from all file paths
- Project paths remain visible for debugging (this is expected)
- No user identifiers are collected
"""

from __future__ import annotations

import logging
import os
import re
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Track initialization state
_sentry_initialized = False
_sentry_enabled = False

# Production trace sample rate (10%)
PRODUCTION_TRACE_SAMPLE_RATE = 0.1


def _get_version() -> str:
    """
    Get the application version.

    Tries to read from package.json in the frontend directory,
    falling back to a default version.
    """
    try:
        # Try to find package.json relative to this file
        backend_dir = Path(__file__).parent.parent
        frontend_dir = backend_dir.parent / "frontend"
        package_json = frontend_dir / "package.json"

        if package_json.exists():
            import json

            with open(package_json, encoding="utf-8") as f:
                data = json.load(f)
                return data.get("version", "0.0.0")
    except Exception as e:
        logger.debug(f"Version detection failed: {e}")

    return "0.0.0"


def _mask_user_paths(text: str) -> str:
    """
    Mask user-specific paths for privacy.

    Replaces usernames in common OS path patterns:
    - macOS: /Users/username/... becomes /Users/***/...
    - Windows: C:\\Users\\username\\... becomes C:\\Users\\***\\...
    - Linux: /home/username/... becomes /home/***/...
    - WSL: /mnt/c/Users/username/... becomes /mnt/c/Users/***/...

    Note: Project paths remain visible for debugging purposes.
    """
    if not text:
        return text

    # macOS: /Users/username/...
    text = re.sub(r"/Users/[^/]+(?=/|$)", "/Users/***", text)

    # Windows: C:\Users\username\...
    text = re.sub(
        r"[A-Za-z]:\\Users\\[^\\]+(?=\\|$)",
        lambda m: f"{m.group(0)[0]}:\\Users\\***",
        text,
    )

    # Linux: /home/username/...
    text = re.sub(r"/home/[^/]+(?=/|$)", "/home/***", text)

    # WSL: /mnt/c/Users/username/... (accessing Windows filesystem from WSL)
    text = re.sub(
        r"/mnt/[a-z]/Users/[^/]+(?=/|$)",
        lambda m: f"{m.group(0)[:6]}/Users/***",
        text,
    )

    return text


def _mask_object_paths(obj: Any, _depth: int = 0) -> Any:
    """
    Recursively mask paths in an object.

    Args:
        obj: The object to mask paths in
        _depth: Current recursion depth (internal use)

    Returns:
        Object with paths masked
    """
    # Prevent stack overflow on deeply nested or circular structures
    if _depth > 50:
        return obj

    if obj is None:
        return obj

    if isinstance(obj, str):
        return _mask_user_paths(obj)

    if isinstance(obj, list):
        return [_mask_object_paths(item, _depth + 1) for item in obj]

    if isinstance(obj, dict):
        return {
            key: _mask_object_paths(value, _depth + 1) for key, value in obj.items()
        }

    return obj


def _before_send(event: dict, hint: dict) -> dict | None:
    """
    Process event before sending to Sentry.

    Applies privacy masking to all paths in the event.
    """
    if not _sentry_enabled:
        return None

    # Mask paths in exception stack traces
    if "exception" in event and "values" in event["exception"]:
        for exception in event["exception"]["values"]:
            if "stacktrace" in exception and "frames" in exception["stacktrace"]:
                for frame in exception["stacktrace"]["frames"]:
                    if "filename" in frame:
                        frame["filename"] = _mask_user_paths(frame["filename"])
                    if "abs_path" in frame:
                        frame["abs_path"] = _mask_user_paths(frame["abs_path"])
            if "value" in exception:
                exception["value"] = _mask_user_paths(exception["value"])

    # Mask paths in breadcrumbs
    if "breadcrumbs" in event:
        for breadcrumb in event.get("breadcrumbs", {}).get("values", []):
            if "message" in breadcrumb:
                breadcrumb["message"] = _mask_user_paths(breadcrumb["message"])
            if "data" in breadcrumb:
                breadcrumb["data"] = _mask_object_paths(breadcrumb["data"])

    # Mask paths in message
    if "message" in event:
        event["message"] = _mask_user_paths(event["message"])

    # Mask paths in tags
    if "tags" in event:
        event["tags"] = _mask_object_paths(event["tags"])

    # Mask paths in contexts
    if "contexts" in event:
        event["contexts"] = _mask_object_paths(event["contexts"])

    # Mask paths in extra data
    if "extra" in event:
        event["extra"] = _mask_object_paths(event["extra"])

    # Clear user info for privacy
    if "user" in event:
        event["user"] = {}

    return event


def init_sentry(
    component: str = "backend",
) -> bool:
    """
    Initialize Sentry for the Python backend.

    Args:
        component: Component name for tagging (e.g., "backend", "github-runner")

    Returns:
        True if Sentry was initialized, False otherwise
    """
    global _sentry_initialized, _sentry_enabled

    if _sentry_initialized:
        return _sentry_enabled

    _sentry_initialized = True

    # Get DSN from environment variable
    dsn = os.environ.get("SENTRY_DSN", "")

    if not dsn:
        logger.debug("[Sentry] No SENTRY_DSN configured - error reporting disabled")
        return False

    # DSN is present (checked above), so Sentry should be enabled.
    # The Electron main process only passes SENTRY_DSN to subprocesses in
    # production builds, so its presence is sufficient to gate activation.
    # In dev, set SENTRY_DSN in your environment to opt-in.
    is_packaged = getattr(sys, "frozen", False) or hasattr(sys, "__compiled__")

    try:
        import sentry_sdk
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        logger.warning("[Sentry] sentry-sdk not installed - error reporting disabled")
        return False

    # Get configuration from environment variables
    version = _get_version()
    environment = os.environ.get(
        "SENTRY_ENVIRONMENT", "production" if is_packaged else "development"
    )

    # Get sample rates
    traces_sample_rate = PRODUCTION_TRACE_SAMPLE_RATE
    try:
        env_rate = os.environ.get("SENTRY_TRACES_SAMPLE_RATE")
        if env_rate:
            parsed = float(env_rate)
            if 0 <= parsed <= 1:
                traces_sample_rate = parsed
    except (ValueError, TypeError):
        pass

    # Configure logging integration to capture errors and warnings
    logging_integration = LoggingIntegration(
        level=logging.INFO,  # Capture INFO and above as breadcrumbs
        event_level=logging.ERROR,  # Send ERROR and above as events
    )

    # Initialize Sentry with exception handling for malformed DSN
    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=environment,
            release=f"auto-claude@{version}",
            traces_sample_rate=traces_sample_rate,
            before_send=_before_send,
            integrations=[logging_integration],
            # Don't send PII
            send_default_pii=False,
        )
    except Exception as e:
        # Handle malformed DSN (e.g., missing public key) gracefully
        # This prevents crashes when SENTRY_DSN is misconfigured
        logger.warning(
            f"[Sentry] Failed to initialize - invalid DSN configuration: {e}"
        )
        logger.debug(
            "[Sentry] DSN should be in format: https://PUBLIC_KEY@o123.ingest.sentry.io/PROJECT_ID"
        )
        return False

    # Set component tag
    sentry_sdk.set_tag("component", component)

    _sentry_enabled = True
    logger.info(
        f"[Sentry] Backend initialized (component: {component}, release: auto-claude@{version}, traces: {traces_sample_rate})"
    )

    return True


def capture_exception(error: Exception, **kwargs) -> None:
    """
    Capture an exception and send to Sentry.

    Safe to call even if Sentry is not initialized.

    Args:
        error: The exception to capture
        **kwargs: Additional context to attach to the event
    """
    if not _sentry_enabled:
        logger.error(f"[Sentry] Not enabled, exception not captured: {error}")
        return

    try:
        import sentry_sdk

        with sentry_sdk.push_scope() as scope:
            for key, value in kwargs.items():
                # Apply defensive path masking for extra data
                masked_value = (
                    _mask_object_paths(value)
                    if isinstance(value, (str, dict, list))
                    else value
                )
                scope.set_extra(key, masked_value)
            sentry_sdk.capture_exception(error)
    except ImportError:
        logger.error(f"[Sentry] SDK not installed, exception not captured: {error}")
    except Exception as e:
        logger.error(f"[Sentry] Failed to capture exception: {e}")


def capture_message(message: str, level: str = "info", **kwargs) -> None:
    """
    Capture a message and send to Sentry.

    Safe to call even if Sentry is not initialized.

    Args:
        message: The message to capture
        level: Log level (debug, info, warning, error, fatal)
        **kwargs: Additional context to attach to the event
    """
    if not _sentry_enabled:
        return

    try:
        import sentry_sdk

        with sentry_sdk.push_scope() as scope:
            for key, value in kwargs.items():
                # Apply defensive path masking for extra data (same as capture_exception)
                masked_value = (
                    _mask_object_paths(value)
                    if isinstance(value, (str, dict, list))
                    else value
                )
                scope.set_extra(key, masked_value)
            sentry_sdk.capture_message(message, level=level)
    except ImportError:
        logger.debug("[Sentry] SDK not installed")
    except Exception as e:
        logger.error(f"[Sentry] Failed to capture message: {e}")


def set_context(name: str, data: dict) -> None:
    """
    Set context data for subsequent events.

    Safe to call even if Sentry is not initialized.

    Args:
        name: Context name (e.g., "pr_review", "spec")
        data: Context data dictionary
    """
    if not _sentry_enabled:
        return

    try:
        import sentry_sdk

        # Apply path masking to context data before sending to Sentry
        masked_data = _mask_object_paths(data)
        sentry_sdk.set_context(name, masked_data)
    except ImportError:
        logger.debug("[Sentry] SDK not installed")
    except Exception as e:
        logger.debug(f"Failed to set context '{name}': {e}")


def set_tag(key: str, value: str) -> None:
    """
    Set a tag for subsequent events.

    Safe to call even if Sentry is not initialized.

    Args:
        key: Tag key
        value: Tag value
    """
    if not _sentry_enabled:
        return

    try:
        import sentry_sdk

        # Apply path masking to tag value
        masked_value = _mask_user_paths(value) if isinstance(value, str) else value
        sentry_sdk.set_tag(key, masked_value)
    except ImportError:
        logger.debug("[Sentry] SDK not installed")
    except Exception as e:
        logger.debug(f"Failed to set tag '{key}': {e}")


def is_enabled() -> bool:
    """Check if Sentry is enabled."""
    return _sentry_enabled


def is_initialized() -> bool:
    """Check if Sentry initialization has been attempted."""
    return _sentry_initialized

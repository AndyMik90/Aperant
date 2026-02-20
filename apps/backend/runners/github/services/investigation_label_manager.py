"""
Investigation Label Manager
============================

Manages GitHub lifecycle labels for issue investigations.
Labels are synced one-way (app -> GitHub) with graceful error handling
so label failures never crash the investigation pipeline.

Includes debounce logic (5s) on set_investigation_label() to avoid
rapid-fire GitHub API calls during fast state transitions.

Debounce implementation:
- Non-terminal states are debounced within a 5-second window
- Terminal states (findings_ready, task_created, done) bypass debounce
- Pending state is tracked and applied on the next non-debounced call
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..gh_client import GHClient

logger = logging.getLogger(__name__)

# Debounce window in seconds for label changes per issue
_LABEL_DEBOUNCE_SECONDS = 5.0

# Default label configuration — can be overridden per-project via config
DEFAULT_LABEL_CUSTOMIZATION = {
    "prefix": "auto-claude:",
    "labels": {
        "investigating": {
            "suffix": "investigating",
            "color": "1d76db",
            "description": "Auto-Claude is investigating this issue",
        },
        "findings_ready": {
            "suffix": "findings-ready",
            "color": "0e8a16",
            "description": "Investigation complete, findings available",
        },
        "task_created": {
            "suffix": "task-created",
            "color": "5319e7",
            "description": "Kanban task created from investigation",
        },
        "building": {
            "suffix": "building",
            "color": "d93f0b",
            "description": "Task is being built by the pipeline",
        },
        "done": {
            "suffix": "done",
            "color": "0e8a16",
            "description": "Investigation complete, issue resolved",
        },
    },
}


class InvestigationLabelManager:
    """Manages GitHub lifecycle labels for issue investigations.

    Labels are synced one-way (app -> GitHub). Label API failures
    are logged but never propagated to callers.
    """

    # Terminal states that should never be debounced — these represent
    # important outcomes that must always be reflected on GitHub.
    _TERMINAL_STATES: set[str] = {"findings_ready", "task_created", "done", "completed"}

    def __init__(self, customization: dict | None = None) -> None:
        # Resolve customization from config or defaults
        custom = customization or {}
        prefix = custom.get("prefix", DEFAULT_LABEL_CUSTOMIZATION["prefix"])
        label_overrides = custom.get("labels", {})

        self.labels: dict[str, dict[str, str]] = {}
        for key, defaults in DEFAULT_LABEL_CUSTOMIZATION["labels"].items():
            overrides = label_overrides.get(key, {})
            suffix = overrides.get("suffix", defaults["suffix"])
            color = overrides.get("color", defaults["color"])
            description = overrides.get("description", defaults["description"])
            self.labels[key] = {
                "name": f"{prefix}{suffix}",
                "color": color,
                "description": description,
            }

        self.all_label_names = [label["name"] for label in self.labels.values()]

        # Track last label-change timestamp per issue for debounce
        self._last_label_time: dict[int, float] = {}
        # Track pending (debounced) label state per issue for trailing-edge apply
        self._pending_state: dict[int, str] = {}

    # Map investigation states to label keys
    _STATE_MAP: dict[str, str] = {
        "investigating": "investigating",
        "findings_ready": "findings_ready",
        "task_created": "task_created",
        "building": "building",
        "done": "done",
        "completed": "done",
    }

    async def ensure_labels_exist(self, gh_client: GHClient) -> None:
        """Create labels in the repo if they don't already exist (idempotent).

        Called once when an investigation starts. Fetches existing labels
        first to avoid 422 errors from attempting to create duplicates.
        """
        if not gh_client.repo:
            logger.warning("No repo configured for gh_client, skipping label ensure")
            return

        # Fetch existing labels to avoid noisy 422 errors
        existing_names: set[str] = set()
        try:
            import json

            result = await gh_client.run(
                ["api", f"repos/{gh_client.repo}/labels"],
                raise_on_error=False,
            )
            if result.returncode == 0:
                for label in json.loads(result.stdout):
                    existing_names.add(label.get("name", ""))
        except Exception:
            pass  # If fetch fails, try creating all labels anyway

        for key, label_def in self.labels.items():
            if label_def["name"] in existing_names:
                continue
            try:
                await gh_client.run(
                    [
                        "api",
                        "-X",
                        "POST",
                        f"repos/{gh_client.repo}/labels",
                        "-f",
                        f"name={label_def['name']}",
                        "-f",
                        f"color={label_def['color']}",
                        "-f",
                        f"description={label_def['description']}",
                    ],
                    raise_on_error=False,
                )
            except Exception as e:
                logger.debug("Label ensure for %s: %s (may already exist)", key, e)

    async def set_investigation_label(
        self,
        gh_client: GHClient,
        issue_number: int,
        state: str,
    ) -> None:
        """Set the lifecycle label for an issue, removing old ones first.

        Includes a debounce window to avoid rapid-fire GitHub API calls
        when state transitions happen in quick succession.

        Args:
            gh_client: GitHub CLI client
            issue_number: The issue number
            state: Investigation state (e.g. "investigating", "findings_ready")
        """
        label_name = self._state_to_label(state)
        if label_name is None:
            logger.warning("Unknown investigation state %r, skipping label sync", state)
            return

        # Resolve which state to apply: if there was a pending (debounced) state
        # queued from a previous call, the current call supersedes it.
        pending = self._pending_state.pop(issue_number, None)

        # Debounce: skip non-terminal states if we changed labels too recently.
        # Terminal states (findings_ready, task_created, done) always go through
        # because they represent important outcomes that must be visible on GitHub.
        now = time.monotonic()
        last_time = self._last_label_time.get(issue_number, 0.0)
        is_terminal = state in self._TERMINAL_STATES
        if not is_terminal and now - last_time < _LABEL_DEBOUNCE_SECONDS:
            logger.debug(
                "Debounced label change for issue #%d (%.1fs since last change), "
                "storing %r as pending",
                issue_number,
                now - last_time,
                state,
            )
            # Store the desired state so the next non-debounced call applies it
            self._pending_state[issue_number] = state
            return

        # If there was a pending state and the current call supersedes it, log it
        if pending and pending != state:
            logger.debug(
                "Superseding pending label state %r with %r for issue #%d",
                pending,
                state,
                issue_number,
            )

        try:
            # Add the new label first (atomic with existing labels via GitHub's API)
            await gh_client.issue_add_labels(issue_number, [label_name])

            # Then remove all other auto-claude: labels (excluding the one we just added)
            other_labels = [name for name in self.all_label_names if name != label_name]
            if other_labels:
                await gh_client.issue_remove_labels(issue_number, other_labels)

            self._last_label_time[issue_number] = now
            logger.info("Set label %s on issue #%d", label_name, issue_number)
        except Exception as e:
            logger.warning(
                "Failed to set label %s on issue #%d: %s",
                label_name,
                issue_number,
                e,
            )

    async def remove_all_investigation_labels(
        self,
        gh_client: GHClient,
        issue_number: int,
    ) -> None:
        """Remove all auto-claude: lifecycle labels from an issue."""
        try:
            await gh_client.issue_remove_labels(issue_number, self.all_label_names)
        except Exception as e:
            logger.debug(
                "Failed to remove investigation labels from #%d: %s",
                issue_number,
                e,
            )

    def _state_to_label(self, state: str) -> str | None:
        """Map an investigation state string to a GitHub label name."""
        key = self._STATE_MAP.get(state)
        if key is None:
            return None
        return self.labels[key]["name"]

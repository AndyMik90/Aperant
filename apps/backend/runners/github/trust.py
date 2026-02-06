"""
Trust Escalation Model
======================

Progressive trust system that unlocks more autonomous actions as accuracy improves:

- L0: Review-only (comment, no actions)
- L1: Auto-apply labels based on triage
- L2: Auto-close duplicates and spam
- L3: Auto-merge trivial fixes (docs, typos)
- L4: Full auto-fix with merge

Trust increases with accuracy, decreases with overrides.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import IntEnum
from pathlib import Path
from typing import Any


class TrustLevel(IntEnum):
    """Trust levels with increasing autonomy."""

    L0_REVIEW_ONLY = 0  # Comment only, no actions
    L1_LABEL = 1  # Auto-apply labels
    L2_CLOSE = 2  # Auto-close duplicates/spam
    L3_MERGE_TRIVIAL = 3  # Auto-merge trivial fixes
    L4_FULL_AUTO = 4  # Full autonomous operation

    @property
    def display_name(self) -> str:
        names = {
            0: "Review Only",
            1: "Auto-Label",
            2: "Auto-Close",
            3: "Auto-Merge Trivial",
            4: "Full Autonomous",
        }
        return names.get(self.value, "Unknown")

    @property
    def description(self) -> str:
        descriptions = {
            0: "AI can comment with suggestions but takes no actions",
            1: "AI can automatically apply labels based on triage",
            2: "AI can auto-close clear duplicates and spam",
            3: "AI can auto-merge trivial changes (docs, typos, formatting)",
            4: "AI can auto-fix issues and merge PRs autonomously",
        }
        return descriptions.get(self.value, "")

    @property
    def allowed_actions(self) -> set[str]:
        """Actions allowed at this trust level."""
        actions = {
            0: {"comment", "review"},
            1: {"comment", "review", "label", "triage"},
            2: {
                "comment",
                "review",
                "label",
                "triage",
                "close_duplicate",
                "close_spam",
            },
            3: {
                "comment",
                "review",
                "label",
                "triage",
                "close_duplicate",
                "close_spam",
                "merge_trivial",
            },
            4: {
                "comment",
                "review",
                "label",
                "triage",
                "close_duplicate",
                "close_spam",
                "merge_trivial",
                "auto_fix",
                "merge",
            },
        }
        return actions.get(self.value, set())

    def can_perform(self, action: str) -> bool:
        """Check if this trust level allows an action."""
        return action in self.allowed_actions


# Thresholds for trust level upgrades
TRUST_THRESHOLDS = {
    TrustLevel.L1_LABEL: {
        "min_actions": 20,
        "min_accuracy": 0.90,
        "min_days": 3,
    },
    TrustLevel.L2_CLOSE: {
        "min_actions": 50,
        "min_accuracy": 0.92,
        "min_days": 7,
    },
    TrustLevel.L3_MERGE_TRIVIAL: {
        "min_actions": 100,
        "min_accuracy": 0.95,
        "min_days": 14,
    },
    TrustLevel.L4_FULL_AUTO: {
        "min_actions": 200,
        "min_accuracy": 0.97,
        "min_days": 30,
    },
}


@dataclass
class AccuracyMetrics:
    """Tracks accuracy metrics for trust calculation."""

    total_actions: int = 0
    correct_actions: int = 0
    overridden_actions: int = 0
    last_action_at: str | None = None
    first_action_at: str | None = None

    # Per-action type metrics
    review_total: int = 0
    review_correct: int = 0
    label_total: int = 0
    label_correct: int = 0
    triage_total: int = 0
    triage_correct: int = 0
    close_total: int = 0
    close_correct: int = 0
    merge_total: int = 0
    merge_correct: int = 0
    fix_total: int = 0
    fix_correct: int = 0

    @property
    def accuracy(self) -> float:
        """Overall accuracy rate."""
        if self.total_actions == 0:
            return 0.0
        return self.correct_actions / self.total_actions

    @property
    def override_rate(self) -> float:
        """Rate of overridden actions."""
        if self.total_actions == 0:
            return 0.0
        return self.overridden_actions / self.total_actions

    @property
    def days_active(self) -> int:
        """Days since first action."""
        if not self.first_action_at:
            return 0
        first = datetime.fromisoformat(self.first_action_at)
        now = datetime.now(timezone.utc)
        return (now - first).days

    def record_action(
        self,
        action_type: str,
        correct: bool,
        overridden: bool = False,
    ) -> None:
        """Record an action outcome."""
        now = datetime.now(timezone.utc).isoformat()

        self.total_actions += 1
        if correct:
            self.correct_actions += 1
        if overridden:
            self.overridden_actions += 1

        self.last_action_at = now
        if not self.first_action_at:
            self.first_action_at = now

        # Update per-type metrics
        type_map = {
            "review": ("review_total", "review_correct"),
            "label": ("label_total", "label_correct"),
            "triage": ("triage_total", "triage_correct"),
            "close": ("close_total", "close_correct"),
            "merge": ("merge_total", "merge_correct"),
            "fix": ("fix_total", "fix_correct"),
        }

        if action_type in type_map:
            total_attr, correct_attr = type_map[action_type]
            setattr(self, total_attr, getattr(self, total_attr) + 1)
            if correct:
                setattr(self, correct_attr, getattr(self, correct_attr) + 1)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_actions": self.total_actions,
            "correct_actions": self.correct_actions,
            "overridden_actions": self.overridden_actions,
            "last_action_at": self.last_action_at,
            "first_action_at": self.first_action_at,
            "review_total": self.review_total,
            "review_correct": self.review_correct,
            "label_total": self.label_total,
            "label_correct": self.label_correct,
            "triage_total": self.triage_total,
            "triage_correct": self.triage_correct,
            "close_total": self.close_total,
            "close_correct": self.close_correct,
            "merge_total": self.merge_total,
            "merge_correct": self.merge_correct,
            "fix_total": self.fix_total,
            "fix_correct": self.fix_correct,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AccuracyMetrics:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class TrustState:
    """Trust state for a repository."""

    repo: str
    current_level: TrustLevel = TrustLevel.L0_REVIEW_ONLY
    metrics: AccuracyMetrics = field(default_factory=AccuracyMetrics)
    manual_override: TrustLevel | None = None  # User-set override
    last_level_change: str | None = None
    level_history: list[dict[str, Any]] = field(default_factory=list)

    @property
    def effective_level(self) -> TrustLevel:
        """Get effective trust level (considers manual override)."""
        if self.manual_override is not None:
            return self.manual_override
        return self.current_level

    def can_perform(self, action: str) -> bool:
        """Check if current trust level allows an action."""
        return self.effective_level.can_perform(action)

    def get_progress_to_next_level(self) -> dict[str, Any]:
        """Get progress toward next trust level."""
        current = self.current_level
        if current >= TrustLevel.L4_FULL_AUTO:
            return {
                "next_level": None,
                "at_max": True,
            }

        next_level = TrustLevel(current + 1)
        thresholds = TRUST_THRESHOLDS.get(next_level, {})

        min_actions = thresholds.get("min_actions", 0)
        min_accuracy = thresholds.get("min_accuracy", 0)
        min_days = thresholds.get("min_days", 0)

        return {
            "next_level": next_level.value,
            "next_level_name": next_level.display_name,
            "at_max": False,
            "actions": {
                "current": self.metrics.total_actions,
                "required": min_actions,
                "progress": min(1.0, self.metrics.total_actions / max(1, min_actions)),
            },
            "accuracy": {
                "current": self.metrics.accuracy,
                "required": min_accuracy,
                "progress": min(1.0, self.metrics.accuracy / max(0.01, min_accuracy)),
            },
            "days": {
                "current": self.metrics.days_active,
                "required": min_days,
                "progress": min(1.0, self.metrics.days_active / max(1, min_days)),
            },
        }

    def check_upgrade(self) -> TrustLevel | None:
        """Check if eligible for trust level upgrade."""
        current = self.current_level
        if current >= TrustLevel.L4_FULL_AUTO:
            return None

        next_level = TrustLevel(current + 1)
        thresholds = TRUST_THRESHOLDS.get(next_level)
        if not thresholds:
            return None

        if (
            self.metrics.total_actions >= thresholds["min_actions"]
            and self.metrics.accuracy >= thresholds["min_accuracy"]
            and self.metrics.days_active >= thresholds["min_days"]
        ):
            return next_level

        return None

    def upgrade_level(self, new_level: TrustLevel, reason: str = "auto") -> None:
        """Upgrade to a new trust level."""
        if new_level <= self.current_level:
            return

        now = datetime.now(timezone.utc).isoformat()
        self.level_history.append(
            {
                "from_level": self.current_level.value,
                "to_level": new_level.value,
                "reason": reason,
                "timestamp": now,
                "metrics_snapshot": self.metrics.to_dict(),
            }
        )
        self.current_level = new_level
        self.last_level_change = now

    def downgrade_level(self, reason: str = "override") -> None:
        """Downgrade trust level due to override or errors."""
        if self.current_level <= TrustLevel.L0_REVIEW_ONLY:
            return

        new_level = TrustLevel(self.current_level - 1)
        now = datetime.now(timezone.utc).isoformat()
        self.level_history.append(
            {
                "from_level": self.current_level.value,
                "to_level": new_level.value,
                "reason": reason,
                "timestamp": now,
            }
        )
        self.current_level = new_level
        self.last_level_change = now

    def set_manual_override(self, level: TrustLevel | None) -> None:
        """Set or clear manual trust level override."""
        self.manual_override = level
        if level is not None:
            now = datetime.now(timezone.utc).isoformat()
            self.level_history.append(
                {
                    "from_level": self.current_level.value,
                    "to_level": level.value,
                    "reason": "manual_override",
                    "timestamp": now,
                }
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "repo": self.repo,
            "current_level": self.current_level.value,
            "metrics": self.metrics.to_dict(),
            "manual_override": self.manual_override.value
            if self.manual_override
            else None,
            "last_level_change": self.last_level_change,
            "level_history": self.level_history[-20:],  # Keep last 20 changes
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TrustState:
        return cls(
            repo=data["repo"],
            current_level=TrustLevel(data.get("current_level", 0)),
            metrics=AccuracyMetrics.from_dict(data.get("metrics", {})),
            manual_override=TrustLevel(data["manual_override"])
            if data.get("manual_override") is not None
            else None,
            last_level_change=data.get("last_level_change"),
            level_history=data.get("level_history", []),
        )


class TrustManager:
    """
    Manages trust levels across repositories.

    Usage:
        trust = TrustManager(state_dir=Path(".auto-claude/github"))

        # Check if action is allowed
        if trust.can_perform("owner/repo", "auto_fix"):
            perform_auto_fix()

        # Record action outcome
        trust.record_action("owner/repo", "review", correct=True)

        # Check for upgrade
        if trust.check_and_upgrade("owner/repo"):
            print("Trust level upgraded!")
    """

    def __init__(self, state_dir: Path):
        self.state_dir = state_dir
        self.trust_dir = state_dir / "trust"
        self.trust_dir.mkdir(parents=True, exist_ok=True)
        self._states: dict[str, TrustState] = {}

    def _get_state_file(self, repo: str) -> Path:
        safe_name = repo.replace("/", "_")
        return self.trust_dir / f"{safe_name}.json"

    def get_state(self, repo: str) -> TrustState:
        """Get trust state for a repository."""
        if repo in self._states:
            return self._states[repo]

        state_file = self._get_state_file(repo)
        if state_file.exists():
            try:
                with open(state_file, encoding="utf-8") as f:
                    data = json.load(f)
                    state = TrustState.from_dict(data)
            except (json.JSONDecodeError, UnicodeDecodeError):
                # Return default state if file is corrupted
                state = TrustState(repo=repo)
        else:
            state = TrustState(repo=repo)

        self._states[repo] = state
        return state

    def save_state(self, repo: str) -> None:
        """Save trust state for a repository with secure file permissions."""
        import os

        state = self.get_state(repo)
        state_file = self._get_state_file(repo)

        # Write with restrictive permissions (0o600 = owner read/write only)
        fd = os.open(str(state_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        # os.fdopen takes ownership of fd and will close it when the with block exits
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state.to_dict(), f, indent=2)

    def get_trust_level(self, repo: str) -> TrustLevel:
        """Get current trust level for a repository."""
        return self.get_state(repo).effective_level

    def can_perform(self, repo: str, action: str) -> bool:
        """Check if an action is allowed for a repository."""
        return self.get_state(repo).can_perform(action)

    def record_action(
        self,
        repo: str,
        action_type: str,
        correct: bool,
        overridden: bool = False,
    ) -> None:
        """Record an action outcome."""
        state = self.get_state(repo)
        state.metrics.record_action(action_type, correct, overridden)

        # Check for downgrade on override
        if overridden:
            # Downgrade if override rate exceeds 10%
            if state.metrics.override_rate > 0.10 and state.metrics.total_actions >= 10:
                state.downgrade_level(reason="high_override_rate")

        self.save_state(repo)

    def check_and_upgrade(self, repo: str) -> bool:
        """Check for and apply trust level upgrade."""
        state = self.get_state(repo)
        new_level = state.check_upgrade()

        if new_level:
            state.upgrade_level(new_level, reason="threshold_met")
            self.save_state(repo)
            return True

        return False

    def set_manual_level(self, repo: str, level: TrustLevel) -> None:
        """Manually set trust level for a repository."""
        state = self.get_state(repo)
        state.set_manual_override(level)
        self.save_state(repo)

    def clear_manual_override(self, repo: str) -> None:
        """Clear manual trust level override."""
        state = self.get_state(repo)
        state.set_manual_override(None)
        self.save_state(repo)

    def get_progress(self, repo: str) -> dict[str, Any]:
        """Get progress toward next trust level."""
        state = self.get_state(repo)
        return {
            "current_level": state.effective_level.value,
            "current_level_name": state.effective_level.display_name,
            "is_manual_override": state.manual_override is not None,
            "accuracy": state.metrics.accuracy,
            "total_actions": state.metrics.total_actions,
            "override_rate": state.metrics.override_rate,
            "days_active": state.metrics.days_active,
            "progress_to_next": state.get_progress_to_next_level(),
        }

    def get_all_states(self) -> list[TrustState]:
        """Get trust states for all repos."""
        states = []
        for file in self.trust_dir.glob("*.json"):
            try:
                with open(file, encoding="utf-8") as f:
                    data = json.load(f)
                    states.append(TrustState.from_dict(data))
            except (json.JSONDecodeError, UnicodeDecodeError):
                # Skip corrupted state files
                continue
        return states

    def get_summary(self) -> dict[str, Any]:
        """Get summary of trust across all repos."""
        states = self.get_all_states()
        by_level = {}
        for state in states:
            level = state.effective_level.value
            by_level[level] = by_level.get(level, 0) + 1

        total_actions = sum(s.metrics.total_actions for s in states)
        total_correct = sum(s.metrics.correct_actions for s in states)

        return {
            "total_repos": len(states),
            "by_level": by_level,
            "total_actions": total_actions,
            "overall_accuracy": total_correct / max(1, total_actions),
        }

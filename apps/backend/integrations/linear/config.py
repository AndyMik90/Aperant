"""
Linear Integration Configuration
================================

Constants, status mappings, and configuration helpers for Linear integration.
Mirrors the approach from Linear-Coding-Agent-Harness.
"""

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

# Linear Status Constants (map to Linear workflow states)
STATUS_TODO = "Todo"
STATUS_IN_PROGRESS = "In Progress"
STATUS_DONE = "Done"
STATUS_BLOCKED = "Blocked"  # For stuck subtasks
STATUS_CANCELED = "Canceled"

# Linear Priority Constants (1=Urgent, 4=Low, 0=No priority)
PRIORITY_URGENT = 1  # Core infrastructure, blockers
PRIORITY_HIGH = 2  # Primary features, dependencies
PRIORITY_MEDIUM = 3  # Secondary features
PRIORITY_LOW = 4  # Polish, nice-to-haves
PRIORITY_NONE = 0  # No priority set

# Subtask status to Linear status mapping
SUBTASK_TO_LINEAR_STATUS = {
    "pending": STATUS_TODO,
    "in_progress": STATUS_IN_PROGRESS,
    "completed": STATUS_DONE,
    "blocked": STATUS_BLOCKED,
    "failed": STATUS_BLOCKED,  # Map failures to Blocked for visibility
    "stuck": STATUS_BLOCKED,
}

# Linear labels for categorization
LABELS = {
    "phase": "phase",  # Phase label prefix (e.g., "phase-1")
    "service": "service",  # Service label prefix (e.g., "service-backend")
    "stuck": "stuck",  # Mark stuck subtasks
    "auto_build": "auto-claude",  # All auto-claude issues
    "needs_review": "needs-review",
}

# Linear project marker file (stores team/project IDs)
LINEAR_PROJECT_MARKER = ".linear_project.json"

# Meta issue for session tracking
META_ISSUE_TITLE = "[META] Build Progress Tracker"


@dataclass
class LinearConfig:
    """Configuration for Linear integration."""

    api_key: str
    team_id: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    meta_issue_id: str | None = None
    enabled: bool = True

    @classmethod
    def from_env(cls) -> "LinearConfig":
        """Create config from environment variables."""
        api_key = os.environ.get("LINEAR_API_KEY", "")

        return cls(
            api_key=api_key,
            team_id=os.environ.get("LINEAR_TEAM_ID"),
            project_id=os.environ.get("LINEAR_PROJECT_ID"),
            enabled=bool(api_key),
        )

    def is_valid(self) -> bool:
        """Check if config has minimum required values."""
        return bool(self.api_key)


@dataclass
class LinearProjectState:
    """State of a Linear project for an auto-claude spec."""

    initialized: bool = False
    team_id: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    meta_issue_id: str | None = None
    total_issues: int = 0
    created_at: str | None = None
    issue_mapping: dict = None  # subtask_id -> issue_id mapping

    def __post_init__(self):
        if self.issue_mapping is None:
            self.issue_mapping = {}

    def to_dict(self) -> dict:
        return {
            "initialized": self.initialized,
            "team_id": self.team_id,
            "project_id": self.project_id,
            "project_name": self.project_name,
            "meta_issue_id": self.meta_issue_id,
            "total_issues": self.total_issues,
            "created_at": self.created_at,
            "issue_mapping": self.issue_mapping,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "LinearProjectState":
        return cls(
            initialized=data.get("initialized", False),
            team_id=data.get("team_id"),
            project_id=data.get("project_id"),
            project_name=data.get("project_name"),
            meta_issue_id=data.get("meta_issue_id"),
            total_issues=data.get("total_issues", 0),
            created_at=data.get("created_at"),
            issue_mapping=data.get("issue_mapping", {}),
        )

    def save(self, spec_dir: Path) -> None:
        """Save state to the spec directory."""
        marker_file = spec_dir / LINEAR_PROJECT_MARKER
        with open(marker_file, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, spec_dir: Path) -> Optional["LinearProjectState"]:
        """Load state from the spec directory."""
        marker_file = spec_dir / LINEAR_PROJECT_MARKER
        if not marker_file.exists():
            return None

        try:
            with open(marker_file, encoding="utf-8") as f:
                return cls.from_dict(json.load(f))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return None


def get_linear_status(subtask_status: str) -> str:
    """
    Map subtask status to Linear status.

    Args:
        subtask_status: Status from implementation_plan.json

    Returns:
        Corresponding Linear status string
    """
    return SUBTASK_TO_LINEAR_STATUS.get(subtask_status, STATUS_TODO)


def get_priority_for_phase(phase_num: int, total_phases: int) -> int:
    """
    Determine Linear priority based on phase number.

    Early phases are higher priority (they're dependencies).

    Args:
        phase_num: Phase number (1-indexed)
        total_phases: Total number of phases

    Returns:
        Linear priority value (1-4)
    """
    if total_phases <= 1:
        return PRIORITY_HIGH

    # First quarter of phases = Urgent
    # Second quarter = High
    # Third quarter = Medium
    # Fourth quarter = Low
    position = phase_num / total_phases

    if position <= 0.25:
        return PRIORITY_URGENT
    elif position <= 0.5:
        return PRIORITY_HIGH
    elif position <= 0.75:
        return PRIORITY_MEDIUM
    else:
        return PRIORITY_LOW


def format_subtask_description(subtask: dict, phase: dict = None) -> str:
    """
    Format a subtask as a Linear issue description.

    Args:
        subtask: Subtask dict from implementation_plan.json
        phase: Optional phase dict for context

    Returns:
        Markdown-formatted description
    """
    lines = []

    # Description
    if subtask.get("description"):
        lines.append(f"## Description\n{subtask['description']}\n")

    # Service
    if subtask.get("service"):
        lines.append(f"**Service:** {subtask['service']}")
    elif subtask.get("all_services"):
        lines.append("**Scope:** All services (integration)")

    # Phase info
    if phase:
        lines.append(f"**Phase:** {phase.get('name', phase.get('id', 'Unknown'))}")

    # Files to modify
    if subtask.get("files_to_modify"):
        lines.append("\n## Files to Modify")
        for f in subtask["files_to_modify"]:
            lines.append(f"- `{f}`")

    # Files to create
    if subtask.get("files_to_create"):
        lines.append("\n## Files to Create")
        for f in subtask["files_to_create"]:
            lines.append(f"- `{f}`")

    # Patterns to follow
    if subtask.get("patterns_from"):
        lines.append("\n## Reference Patterns")
        for f in subtask["patterns_from"]:
            lines.append(f"- `{f}`")

    # Verification
    if subtask.get("verification"):
        v = subtask["verification"]
        lines.append("\n## Verification")
        lines.append(f"**Type:** {v.get('type', 'none')}")
        if v.get("run"):
            lines.append(f"**Command:** `{v['run']}`")
        if v.get("url"):
            lines.append(f"**URL:** {v['url']}")
        if v.get("scenario"):
            lines.append(f"**Scenario:** {v['scenario']}")

    # Auto-build metadata
    lines.append("\n---")
    lines.append("*This issue was created by the Auto-Build Framework*")

    return "\n".join(lines)


def format_session_comment(
    session_num: int,
    subtask_id: str,
    success: bool,
    approach: str = "",
    error: str = "",
    git_commit: str = "",
) -> str:
    """
    Format a session result as a Linear comment.

    Args:
        session_num: Session number
        subtask_id: Subtask being worked on
        success: Whether the session succeeded
        approach: What was attempted
        error: Error message if failed
        git_commit: Git commit hash if any

    Returns:
        Markdown-formatted comment
    """
    status_emoji = "✅" if success else "❌"
    lines = [
        f"## Session #{session_num} {status_emoji}",
        f"**Subtask:** `{subtask_id}`",
        f"**Status:** {'Completed' if success else 'In Progress'}",
        f"**Time:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
    ]

    if approach:
        lines.append(f"\n**Approach:** {approach}")

    if git_commit:
        lines.append(f"\n**Commit:** `{git_commit[:8]}`")

    if error:
        lines.append(f"\n**Error:**\n```\n{error[:500]}\n```")

    return "\n".join(lines)


def format_stuck_subtask_comment(
    subtask_id: str,
    attempt_count: int,
    attempts: list[dict],
    reason: str = "",
) -> str:
    """
    Format a detailed comment for stuck subtasks.

    Args:
        subtask_id: Stuck subtask ID
        attempt_count: Number of attempts
        attempts: List of attempt records
        reason: Why it's stuck

    Returns:
        Markdown-formatted comment for escalation
    """
    lines = [
        "## ⚠️ Subtask Marked as STUCK",
        f"**Subtask:** `{subtask_id}`",
        f"**Attempts:** {attempt_count}",
        f"**Time:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
    ]

    if reason:
        lines.append(f"\n**Reason:** {reason}")

    # Add attempt history
    if attempts:
        lines.append("\n### Attempt History")
        for i, attempt in enumerate(attempts[-5:], 1):  # Last 5 attempts
            status = "✅" if attempt.get("success") else "❌"
            lines.append(f"\n**Attempt {i}:** {status}")
            if attempt.get("approach"):
                lines.append(f"- Approach: {attempt['approach'][:200]}")
            if attempt.get("error"):
                lines.append(f"- Error: {attempt['error'][:200]}")

    lines.append("\n### Recommended Actions")
    lines.append("1. Review the approach and error patterns above")
    lines.append("2. Check for missing dependencies or configuration")
    lines.append("3. Consider manual intervention or different approach")
    lines.append("4. Update HUMAN_INPUT.md with guidance for the agent")

    return "\n".join(lines)

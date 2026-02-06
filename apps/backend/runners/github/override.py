"""
GitHub Automation Override System
=================================

Handles user overrides, cancellations, and undo operations:
- Grace period for label-triggered actions
- Comment command processing (/cancel-autofix, /undo-last)
- One-click override buttons (Not spam, Not duplicate)
- Override history for audit and learning
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any

try:
    from .audit import ActorType, AuditLogger
    from .file_lock import locked_json_update
except (ImportError, ValueError, SystemError):
    from audit import ActorType, AuditLogger
    from file_lock import locked_json_update


class OverrideType(str, Enum):
    """Types of override actions."""

    CANCEL_AUTOFIX = "cancel_autofix"
    NOT_SPAM = "not_spam"
    NOT_DUPLICATE = "not_duplicate"
    NOT_FEATURE_CREEP = "not_feature_creep"
    UNDO_LAST = "undo_last"
    FORCE_RETRY = "force_retry"
    SKIP_REVIEW = "skip_review"
    APPROVE_SPEC = "approve_spec"
    REJECT_SPEC = "reject_spec"


class CommandType(str, Enum):
    """Recognized comment commands."""

    CANCEL_AUTOFIX = "/cancel-autofix"
    UNDO_LAST = "/undo-last"
    FORCE_RETRY = "/force-retry"
    SKIP_REVIEW = "/skip-review"
    APPROVE = "/approve"
    REJECT = "/reject"
    NOT_SPAM = "/not-spam"
    NOT_DUPLICATE = "/not-duplicate"
    STATUS = "/status"
    HELP = "/help"


@dataclass
class OverrideRecord:
    """Record of an override action."""

    id: str
    override_type: OverrideType
    issue_number: int | None
    pr_number: int | None
    repo: str
    actor: str  # Username who performed override
    reason: str | None
    original_state: str | None
    new_state: str | None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "override_type": self.override_type.value,
            "issue_number": self.issue_number,
            "pr_number": self.pr_number,
            "repo": self.repo,
            "actor": self.actor,
            "reason": self.reason,
            "original_state": self.original_state,
            "new_state": self.new_state,
            "created_at": self.created_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> OverrideRecord:
        return cls(
            id=data["id"],
            override_type=OverrideType(data["override_type"]),
            issue_number=data.get("issue_number"),
            pr_number=data.get("pr_number"),
            repo=data["repo"],
            actor=data["actor"],
            reason=data.get("reason"),
            original_state=data.get("original_state"),
            new_state=data.get("new_state"),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            metadata=data.get("metadata", {}),
        )


@dataclass
class GracePeriodEntry:
    """Entry tracking grace period for an automation trigger."""

    issue_number: int
    trigger_label: str
    triggered_by: str
    triggered_at: str
    expires_at: str
    cancelled: bool = False
    cancelled_by: str | None = None
    cancelled_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "issue_number": self.issue_number,
            "trigger_label": self.trigger_label,
            "triggered_by": self.triggered_by,
            "triggered_at": self.triggered_at,
            "expires_at": self.expires_at,
            "cancelled": self.cancelled,
            "cancelled_by": self.cancelled_by,
            "cancelled_at": self.cancelled_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GracePeriodEntry:
        return cls(
            issue_number=data["issue_number"],
            trigger_label=data["trigger_label"],
            triggered_by=data["triggered_by"],
            triggered_at=data["triggered_at"],
            expires_at=data["expires_at"],
            cancelled=data.get("cancelled", False),
            cancelled_by=data.get("cancelled_by"),
            cancelled_at=data.get("cancelled_at"),
        )

    def is_in_grace_period(self) -> bool:
        """Check if still within grace period."""
        if self.cancelled:
            return False
        expires = datetime.fromisoformat(self.expires_at)
        return datetime.now(timezone.utc) < expires

    def time_remaining(self) -> timedelta:
        """Get remaining time in grace period."""
        expires = datetime.fromisoformat(self.expires_at)
        remaining = expires - datetime.now(timezone.utc)
        return max(remaining, timedelta(0))


@dataclass
class ParsedCommand:
    """Parsed comment command."""

    command: CommandType
    args: list[str]
    raw_text: str
    author: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "command": self.command.value,
            "args": self.args,
            "raw_text": self.raw_text,
            "author": self.author,
        }


class OverrideManager:
    """
    Manages user overrides and cancellations.

    Usage:
        override_mgr = OverrideManager(github_dir=Path(".auto-claude/github"))

        # Start grace period when label is added
        grace = override_mgr.start_grace_period(
            issue_number=123,
            trigger_label="auto-fix",
            triggered_by="username",
        )

        # Check if still in grace period before acting
        if override_mgr.is_in_grace_period(123):
            print("Still in grace period, waiting...")

        # Process comment commands
        cmd = override_mgr.parse_comment("/cancel-autofix", "username")
        if cmd:
            result = await override_mgr.execute_command(cmd, issue_number=123)
    """

    # Default grace period: 15 minutes
    DEFAULT_GRACE_PERIOD_MINUTES = 15

    def __init__(
        self,
        github_dir: Path,
        grace_period_minutes: int = DEFAULT_GRACE_PERIOD_MINUTES,
        audit_logger: AuditLogger | None = None,
    ):
        """
        Initialize override manager.

        Args:
            github_dir: Directory for storing override state
            grace_period_minutes: Grace period duration (default: 15 min)
            audit_logger: Optional audit logger for recording overrides
        """
        self.github_dir = github_dir
        self.override_dir = github_dir / "overrides"
        self.override_dir.mkdir(parents=True, exist_ok=True)
        self.grace_period_minutes = grace_period_minutes
        self.audit_logger = audit_logger

        # Command pattern for parsing
        self._command_pattern = re.compile(
            r"^\s*(/[a-z-]+)(?:\s+(.*))?$", re.IGNORECASE | re.MULTILINE
        )

    def _get_grace_file(self) -> Path:
        """Get path to grace period tracking file."""
        return self.override_dir / "grace_periods.json"

    def _get_history_file(self) -> Path:
        """Get path to override history file."""
        return self.override_dir / "override_history.json"

    def _generate_override_id(self) -> str:
        """Generate unique override ID."""
        import uuid

        return f"ovr-{uuid.uuid4().hex[:8]}"

    # =========================================================================
    # GRACE PERIOD MANAGEMENT
    # =========================================================================

    def start_grace_period(
        self,
        issue_number: int,
        trigger_label: str,
        triggered_by: str,
        grace_minutes: int | None = None,
    ) -> GracePeriodEntry:
        """
        Start a grace period for an automation trigger.

        Args:
            issue_number: Issue that was triggered
            trigger_label: Label that triggered automation
            triggered_by: Username who added the label
            grace_minutes: Override default grace period

        Returns:
            GracePeriodEntry tracking the grace period
        """
        minutes = grace_minutes or self.grace_period_minutes
        now = datetime.now(timezone.utc)

        entry = GracePeriodEntry(
            issue_number=issue_number,
            trigger_label=trigger_label,
            triggered_by=triggered_by,
            triggered_at=now.isoformat(),
            expires_at=(now + timedelta(minutes=minutes)).isoformat(),
        )

        self._save_grace_entry(entry)
        return entry

    def _save_grace_entry(self, entry: GracePeriodEntry) -> None:
        """Save grace period entry to file."""
        grace_file = self._get_grace_file()

        def update_grace(data: dict | None) -> dict:
            if data is None:
                data = {"entries": {}}
            data["entries"][str(entry.issue_number)] = entry.to_dict()
            data["last_updated"] = datetime.now(timezone.utc).isoformat()
            return data

        import asyncio

        asyncio.run(locked_json_update(grace_file, update_grace, timeout=5.0))

    def get_grace_period(self, issue_number: int) -> GracePeriodEntry | None:
        """Get grace period entry for an issue."""
        grace_file = self._get_grace_file()
        if not grace_file.exists():
            return None

        with open(grace_file, encoding="utf-8") as f:
            data = json.load(f)

        entry_data = data.get("entries", {}).get(str(issue_number))
        if entry_data:
            return GracePeriodEntry.from_dict(entry_data)
        return None

    def is_in_grace_period(self, issue_number: int) -> bool:
        """Check if issue is still in grace period."""
        entry = self.get_grace_period(issue_number)
        if entry:
            return entry.is_in_grace_period()
        return False

    def cancel_grace_period(
        self,
        issue_number: int,
        cancelled_by: str,
    ) -> bool:
        """
        Cancel an active grace period.

        Args:
            issue_number: Issue to cancel
            cancelled_by: Username cancelling

        Returns:
            True if successfully cancelled, False if no active grace period
        """
        entry = self.get_grace_period(issue_number)
        if not entry or not entry.is_in_grace_period():
            return False

        entry.cancelled = True
        entry.cancelled_by = cancelled_by
        entry.cancelled_at = datetime.now(timezone.utc).isoformat()

        self._save_grace_entry(entry)
        return True

    # =========================================================================
    # COMMAND PARSING
    # =========================================================================

    def parse_comment(self, comment_body: str, author: str) -> ParsedCommand | None:
        """
        Parse a comment for recognized commands.

        Args:
            comment_body: Full comment text
            author: Comment author username

        Returns:
            ParsedCommand if command found, None otherwise
        """
        match = self._command_pattern.search(comment_body)
        if not match:
            return None

        cmd_text = match.group(1).lower()
        args_text = match.group(2) or ""
        args = args_text.split() if args_text else []

        # Map to command type
        command_map = {
            "/cancel-autofix": CommandType.CANCEL_AUTOFIX,
            "/undo-last": CommandType.UNDO_LAST,
            "/force-retry": CommandType.FORCE_RETRY,
            "/skip-review": CommandType.SKIP_REVIEW,
            "/approve": CommandType.APPROVE,
            "/reject": CommandType.REJECT,
            "/not-spam": CommandType.NOT_SPAM,
            "/not-duplicate": CommandType.NOT_DUPLICATE,
            "/status": CommandType.STATUS,
            "/help": CommandType.HELP,
        }

        command = command_map.get(cmd_text)
        if not command:
            return None

        return ParsedCommand(
            command=command,
            args=args,
            raw_text=comment_body,
            author=author,
        )

    def get_help_text(self) -> str:
        """Get help text for available commands."""
        return """**Available Commands:**

| Command | Description |
|---------|-------------|
| `/cancel-autofix` | Cancel pending auto-fix (works during grace period) |
| `/undo-last` | Undo the most recent automation action |
| `/force-retry` | Retry a failed operation |
| `/skip-review` | Skip AI review for this PR |
| `/approve` | Approve pending spec/action |
| `/reject` | Reject pending spec/action |
| `/not-spam` | Override spam classification |
| `/not-duplicate` | Override duplicate classification |
| `/status` | Show current automation status |
| `/help` | Show this help message |
"""

    # =========================================================================
    # OVERRIDE EXECUTION
    # =========================================================================

    async def execute_command(
        self,
        command: ParsedCommand,
        issue_number: int | None = None,
        pr_number: int | None = None,
        repo: str = "",
        current_state: str | None = None,
    ) -> dict[str, Any]:
        """
        Execute a parsed command.

        Args:
            command: Parsed command to execute
            issue_number: Issue number if applicable
            pr_number: PR number if applicable
            repo: Repository in owner/repo format
            current_state: Current state of the item

        Returns:
            Result dict with success status and message
        """
        result = {
            "success": False,
            "message": "",
            "override_id": None,
        }

        if command.command == CommandType.HELP:
            result["success"] = True
            result["message"] = self.get_help_text()
            return result

        if command.command == CommandType.STATUS:
            # Return status info
            result["success"] = True
            result["message"] = await self._get_status(issue_number, pr_number)
            return result

        # Commands that require issue/PR context
        if command.command == CommandType.CANCEL_AUTOFIX:
            if not issue_number:
                result["message"] = "Issue number required for /cancel-autofix"
                return result

            # Check grace period
            if self.is_in_grace_period(issue_number):
                if self.cancel_grace_period(issue_number, command.author):
                    result["success"] = True
                    result["message"] = f"Auto-fix cancelled for issue #{issue_number}"

                    # Record override
                    override = self._record_override(
                        override_type=OverrideType.CANCEL_AUTOFIX,
                        issue_number=issue_number,
                        repo=repo,
                        actor=command.author,
                        reason="Cancelled during grace period",
                        original_state=current_state,
                        new_state="cancelled",
                    )
                    result["override_id"] = override.id
                else:
                    result["message"] = "No active grace period to cancel"
            else:
                # Try to cancel even if past grace period
                result["success"] = True
                result["message"] = (
                    f"Auto-fix cancellation requested for issue #{issue_number}. "
                    f"Note: Grace period has expired."
                )

                override = self._record_override(
                    override_type=OverrideType.CANCEL_AUTOFIX,
                    issue_number=issue_number,
                    repo=repo,
                    actor=command.author,
                    reason="Cancelled after grace period",
                    original_state=current_state,
                    new_state="cancelled",
                )
                result["override_id"] = override.id

        elif command.command == CommandType.NOT_SPAM:
            result = self._handle_triage_override(
                OverrideType.NOT_SPAM,
                issue_number,
                repo,
                command.author,
                current_state,
            )

        elif command.command == CommandType.NOT_DUPLICATE:
            result = self._handle_triage_override(
                OverrideType.NOT_DUPLICATE,
                issue_number,
                repo,
                command.author,
                current_state,
            )

        elif command.command == CommandType.FORCE_RETRY:
            result["success"] = True
            result["message"] = (
                f"Retry requested for issue #{issue_number or pr_number}"
            )

            override = self._record_override(
                override_type=OverrideType.FORCE_RETRY,
                issue_number=issue_number,
                pr_number=pr_number,
                repo=repo,
                actor=command.author,
                original_state=current_state,
                new_state="pending",
            )
            result["override_id"] = override.id

        elif command.command == CommandType.UNDO_LAST:
            result = await self._handle_undo_last(
                issue_number, pr_number, repo, command.author
            )

        elif command.command == CommandType.APPROVE:
            result["success"] = True
            result["message"] = "Approved"

            override = self._record_override(
                override_type=OverrideType.APPROVE_SPEC,
                issue_number=issue_number,
                pr_number=pr_number,
                repo=repo,
                actor=command.author,
                original_state=current_state,
                new_state="approved",
            )
            result["override_id"] = override.id

        elif command.command == CommandType.REJECT:
            result["success"] = True
            result["message"] = "Rejected"

            override = self._record_override(
                override_type=OverrideType.REJECT_SPEC,
                issue_number=issue_number,
                pr_number=pr_number,
                repo=repo,
                actor=command.author,
                original_state=current_state,
                new_state="rejected",
            )
            result["override_id"] = override.id

        elif command.command == CommandType.SKIP_REVIEW:
            result["success"] = True
            result["message"] = f"AI review skipped for PR #{pr_number}"

            override = self._record_override(
                override_type=OverrideType.SKIP_REVIEW,
                pr_number=pr_number,
                repo=repo,
                actor=command.author,
                original_state=current_state,
                new_state="skipped",
            )
            result["override_id"] = override.id

        return result

    def _handle_triage_override(
        self,
        override_type: OverrideType,
        issue_number: int | None,
        repo: str,
        actor: str,
        current_state: str | None,
    ) -> dict[str, Any]:
        """Handle triage classification overrides."""
        result = {"success": False, "message": "", "override_id": None}

        if not issue_number:
            result["message"] = "Issue number required"
            return result

        override = self._record_override(
            override_type=override_type,
            issue_number=issue_number,
            repo=repo,
            actor=actor,
            original_state=current_state,
            new_state="feature",  # Default to feature when overriding spam/duplicate
        )

        result["success"] = True
        result["message"] = f"Classification overridden for issue #{issue_number}"
        result["override_id"] = override.id

        return result

    async def _handle_undo_last(
        self,
        issue_number: int | None,
        pr_number: int | None,
        repo: str,
        actor: str,
    ) -> dict[str, Any]:
        """Handle undo last action command."""
        result = {"success": False, "message": "", "override_id": None}

        # Find most recent action for this issue/PR
        history = self.get_override_history(
            issue_number=issue_number,
            pr_number=pr_number,
            limit=1,
        )

        if not history:
            result["message"] = "No previous action to undo"
            return result

        last_action = history[0]

        # Record the undo
        override = self._record_override(
            override_type=OverrideType.UNDO_LAST,
            issue_number=issue_number,
            pr_number=pr_number,
            repo=repo,
            actor=actor,
            original_state=last_action.new_state,
            new_state=last_action.original_state,
            metadata={"undone_action_id": last_action.id},
        )

        result["success"] = True
        result["message"] = f"Undone: {last_action.override_type.value}"
        result["override_id"] = override.id

        return result

    async def _get_status(
        self,
        issue_number: int | None,
        pr_number: int | None,
    ) -> str:
        """Get status information for an issue/PR."""
        lines = ["**Automation Status:**\n"]

        if issue_number:
            grace = self.get_grace_period(issue_number)
            if grace:
                if grace.is_in_grace_period():
                    remaining = grace.time_remaining()
                    lines.append(
                        f"- Issue #{issue_number}: In grace period "
                        f"({int(remaining.total_seconds() / 60)} min remaining)"
                    )
                elif grace.cancelled:
                    lines.append(
                        f"- Issue #{issue_number}: Cancelled by {grace.cancelled_by}"
                    )
                else:
                    lines.append(f"- Issue #{issue_number}: Grace period expired")

        # Get recent overrides
        history = self.get_override_history(
            issue_number=issue_number, pr_number=pr_number, limit=5
        )
        if history:
            lines.append("\n**Recent Actions:**")
            for record in history:
                lines.append(f"- {record.override_type.value} by {record.actor}")

        if len(lines) == 1:
            lines.append("No automation activity found.")

        return "\n".join(lines)

    # =========================================================================
    # OVERRIDE HISTORY
    # =========================================================================

    def _record_override(
        self,
        override_type: OverrideType,
        repo: str,
        actor: str,
        issue_number: int | None = None,
        pr_number: int | None = None,
        reason: str | None = None,
        original_state: str | None = None,
        new_state: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> OverrideRecord:
        """Record an override action."""
        record = OverrideRecord(
            id=self._generate_override_id(),
            override_type=override_type,
            issue_number=issue_number,
            pr_number=pr_number,
            repo=repo,
            actor=actor,
            reason=reason,
            original_state=original_state,
            new_state=new_state,
            metadata=metadata or {},
        )

        self._save_override_record(record)

        # Log to audit if available
        if self.audit_logger:
            ctx = self.audit_logger.start_operation(
                actor_type=ActorType.USER,
                actor_id=actor,
                repo=repo,
                issue_number=issue_number,
                pr_number=pr_number,
            )
            self.audit_logger.log_override(
                ctx,
                override_type=override_type.value,
                original_action=original_state or "unknown",
                actor_id=actor,
            )

        return record

    def _save_override_record(self, record: OverrideRecord) -> None:
        """Save override record to history file."""
        history_file = self._get_history_file()

        def update_history(data: dict | None) -> dict:
            if data is None:
                data = {"records": []}
            data["records"].insert(0, record.to_dict())
            # Keep last 1000 records
            data["records"] = data["records"][:1000]
            data["last_updated"] = datetime.now(timezone.utc).isoformat()
            return data

        import asyncio

        asyncio.run(locked_json_update(history_file, update_history, timeout=5.0))

    def get_override_history(
        self,
        issue_number: int | None = None,
        pr_number: int | None = None,
        override_type: OverrideType | None = None,
        limit: int = 50,
    ) -> list[OverrideRecord]:
        """
        Get override history with optional filters.

        Args:
            issue_number: Filter by issue number
            pr_number: Filter by PR number
            override_type: Filter by override type
            limit: Maximum records to return

        Returns:
            List of OverrideRecord objects, most recent first
        """
        history_file = self._get_history_file()
        if not history_file.exists():
            return []

        with open(history_file, encoding="utf-8") as f:
            data = json.load(f)

        records = []
        for record_data in data.get("records", []):
            # Apply filters
            if issue_number and record_data.get("issue_number") != issue_number:
                continue
            if pr_number and record_data.get("pr_number") != pr_number:
                continue
            if (
                override_type
                and record_data.get("override_type") != override_type.value
            ):
                continue

            records.append(OverrideRecord.from_dict(record_data))
            if len(records) >= limit:
                break

        return records

    def get_override_statistics(
        self,
        repo: str | None = None,
    ) -> dict[str, Any]:
        """Get aggregate statistics about overrides."""
        history_file = self._get_history_file()
        if not history_file.exists():
            return {"total": 0, "by_type": {}, "by_actor": {}}

        with open(history_file, encoding="utf-8") as f:
            data = json.load(f)

        stats = {
            "total": 0,
            "by_type": {},
            "by_actor": {},
        }

        for record_data in data.get("records", []):
            if repo and record_data.get("repo") != repo:
                continue

            stats["total"] += 1

            # Count by type
            otype = record_data.get("override_type", "unknown")
            stats["by_type"][otype] = stats["by_type"].get(otype, 0) + 1

            # Count by actor
            actor = record_data.get("actor", "unknown")
            stats["by_actor"][actor] = stats["by_actor"].get(actor, 0) + 1

        return stats

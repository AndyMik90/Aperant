"""
GitHub Automation Audit Logger
==============================

Structured audit logging for all GitHub automation operations.
Provides compliance trail, debugging support, and security audit capabilities.

Features:
- JSON-formatted structured logs
- Correlation ID generation per operation
- Actor tracking (user/bot/automation)
- Duration and token usage tracking
- Log rotation with configurable retention
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

# Configure module logger
logger = logging.getLogger(__name__)


class AuditAction(str, Enum):
    """Types of auditable actions."""

    # PR Review actions
    PR_REVIEW_STARTED = "pr_review_started"
    PR_REVIEW_COMPLETED = "pr_review_completed"
    PR_REVIEW_FAILED = "pr_review_failed"
    PR_REVIEW_POSTED = "pr_review_posted"

    # Issue Triage actions
    TRIAGE_STARTED = "triage_started"
    TRIAGE_COMPLETED = "triage_completed"
    TRIAGE_FAILED = "triage_failed"
    LABELS_APPLIED = "labels_applied"

    # Auto-fix actions
    AUTOFIX_STARTED = "autofix_started"
    AUTOFIX_SPEC_CREATED = "autofix_spec_created"
    AUTOFIX_BUILD_STARTED = "autofix_build_started"
    AUTOFIX_PR_CREATED = "autofix_pr_created"
    AUTOFIX_COMPLETED = "autofix_completed"
    AUTOFIX_FAILED = "autofix_failed"
    AUTOFIX_CANCELLED = "autofix_cancelled"

    # Permission actions
    PERMISSION_GRANTED = "permission_granted"
    PERMISSION_DENIED = "permission_denied"
    TOKEN_VERIFIED = "token_verified"

    # Bot detection actions
    BOT_DETECTED = "bot_detected"
    REVIEW_SKIPPED = "review_skipped"

    # Rate limiting actions
    RATE_LIMIT_WARNING = "rate_limit_warning"
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"
    COST_LIMIT_WARNING = "cost_limit_warning"
    COST_LIMIT_EXCEEDED = "cost_limit_exceeded"

    # GitHub API actions
    GITHUB_API_CALL = "github_api_call"
    GITHUB_API_ERROR = "github_api_error"
    GITHUB_API_TIMEOUT = "github_api_timeout"

    # AI Agent actions
    AI_AGENT_STARTED = "ai_agent_started"
    AI_AGENT_COMPLETED = "ai_agent_completed"
    AI_AGENT_FAILED = "ai_agent_failed"

    # Override actions
    OVERRIDE_APPLIED = "override_applied"
    CANCEL_REQUESTED = "cancel_requested"

    # State transitions
    STATE_TRANSITION = "state_transition"


class ActorType(str, Enum):
    """Types of actors that can trigger actions."""

    USER = "user"
    BOT = "bot"
    AUTOMATION = "automation"
    SYSTEM = "system"
    WEBHOOK = "webhook"


@dataclass
class AuditContext:
    """Context for an auditable operation."""

    correlation_id: str
    actor_type: ActorType
    actor_id: str | None = None
    repo: str | None = None
    pr_number: int | None = None
    issue_number: int | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "correlation_id": self.correlation_id,
            "actor_type": self.actor_type.value,
            "actor_id": self.actor_id,
            "repo": self.repo,
            "pr_number": self.pr_number,
            "issue_number": self.issue_number,
            "started_at": self.started_at.isoformat(),
            "metadata": self.metadata,
        }


@dataclass
class AuditEntry:
    """A single audit log entry."""

    timestamp: datetime
    correlation_id: str
    action: AuditAction
    actor_type: ActorType
    actor_id: str | None
    repo: str | None
    pr_number: int | None
    issue_number: int | None
    result: str  # success, failure, skipped
    duration_ms: int | None
    error: str | None
    details: dict[str, Any]
    token_usage: dict[str, int] | None  # input_tokens, output_tokens

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "correlation_id": self.correlation_id,
            "action": self.action.value,
            "actor_type": self.actor_type.value,
            "actor_id": self.actor_id,
            "repo": self.repo,
            "pr_number": self.pr_number,
            "issue_number": self.issue_number,
            "result": self.result,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "details": self.details,
            "token_usage": self.token_usage,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str)


class AuditLogger:
    """
    Structured audit logger for GitHub automation.

    Usage:
        audit = AuditLogger(log_dir=Path(".auto-claude/github/audit"))

        # Start an operation with context
        ctx = audit.start_operation(
            actor_type=ActorType.USER,
            actor_id="username",
            repo="owner/repo",
            pr_number=123,
        )

        # Log events during the operation
        audit.log(ctx, AuditAction.PR_REVIEW_STARTED)

        # ... do work ...

        # Log completion with details
        audit.log(
            ctx,
            AuditAction.PR_REVIEW_COMPLETED,
            result="success",
            details={"findings_count": 5},
        )
    """

    _instance: AuditLogger | None = None

    def __init__(
        self,
        log_dir: Path | None = None,
        retention_days: int = 30,
        max_file_size_mb: int = 100,
        enabled: bool = True,
    ):
        """
        Initialize audit logger.

        Args:
            log_dir: Directory for audit logs (default: .auto-claude/github/audit)
            retention_days: Days to retain logs (default: 30)
            max_file_size_mb: Max size per log file before rotation (default: 100MB)
            enabled: Whether audit logging is enabled (default: True)
        """
        self.log_dir = log_dir or Path(".auto-claude/github/audit")
        self.retention_days = retention_days
        self.max_file_size_mb = max_file_size_mb
        self.enabled = enabled

        if enabled:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            self._current_log_file: Path | None = None
            self._rotate_if_needed()

    @classmethod
    def get_instance(
        cls,
        log_dir: Path | None = None,
        **kwargs,
    ) -> AuditLogger:
        """Get or create singleton instance."""
        if cls._instance is None:
            cls._instance = cls(log_dir=log_dir, **kwargs)
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Reset singleton (for testing)."""
        cls._instance = None

    def _get_log_file_path(self) -> Path:
        """Get path for current day's log file."""
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return self.log_dir / f"audit_{date_str}.jsonl"

    def _rotate_if_needed(self) -> None:
        """Rotate log file if it exceeds max size."""
        if not self.enabled:
            return

        log_file = self._get_log_file_path()

        if log_file.exists():
            size_mb = log_file.stat().st_size / (1024 * 1024)
            if size_mb >= self.max_file_size_mb:
                # Rotate: add timestamp suffix
                timestamp = datetime.now(timezone.utc).strftime("%H%M%S")
                rotated = log_file.with_suffix(f".{timestamp}.jsonl")
                log_file.rename(rotated)
                logger.info(f"Rotated audit log to {rotated}")

        self._current_log_file = log_file

    def _cleanup_old_logs(self) -> None:
        """Remove logs older than retention period."""
        if not self.enabled or not self.log_dir.exists():
            return

        cutoff = datetime.now(timezone.utc).timestamp() - (
            self.retention_days * 24 * 60 * 60
        )

        for log_file in self.log_dir.glob("audit_*.jsonl"):
            if log_file.stat().st_mtime < cutoff:
                log_file.unlink()
                logger.info(f"Deleted old audit log: {log_file}")

    def generate_correlation_id(self) -> str:
        """Generate a unique correlation ID for an operation."""
        return f"gh-{uuid.uuid4().hex[:12]}"

    def start_operation(
        self,
        actor_type: ActorType,
        actor_id: str | None = None,
        repo: str | None = None,
        pr_number: int | None = None,
        issue_number: int | None = None,
        correlation_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AuditContext:
        """
        Start a new auditable operation.

        Args:
            actor_type: Type of actor (USER, BOT, AUTOMATION, SYSTEM)
            actor_id: Identifier for the actor (username, bot name, etc.)
            repo: Repository in owner/repo format
            pr_number: PR number if applicable
            issue_number: Issue number if applicable
            correlation_id: Optional existing correlation ID
            metadata: Additional context metadata

        Returns:
            AuditContext for use with log() calls
        """
        return AuditContext(
            correlation_id=correlation_id or self.generate_correlation_id(),
            actor_type=actor_type,
            actor_id=actor_id,
            repo=repo,
            pr_number=pr_number,
            issue_number=issue_number,
            metadata=metadata or {},
        )

    def log(
        self,
        context: AuditContext,
        action: AuditAction,
        result: str = "success",
        error: str | None = None,
        details: dict[str, Any] | None = None,
        token_usage: dict[str, int] | None = None,
        duration_ms: int | None = None,
    ) -> AuditEntry:
        """
        Log an audit event.

        Args:
            context: Audit context from start_operation()
            action: The action being logged
            result: Result status (success, failure, skipped)
            error: Error message if failed
            details: Additional details about the action
            token_usage: Token usage if AI-related (input_tokens, output_tokens)
            duration_ms: Duration in milliseconds if timed

        Returns:
            The created AuditEntry
        """
        # Calculate duration from context start if not provided
        if duration_ms is None and context.started_at:
            elapsed = datetime.now(timezone.utc) - context.started_at
            duration_ms = int(elapsed.total_seconds() * 1000)

        entry = AuditEntry(
            timestamp=datetime.now(timezone.utc),
            correlation_id=context.correlation_id,
            action=action,
            actor_type=context.actor_type,
            actor_id=context.actor_id,
            repo=context.repo,
            pr_number=context.pr_number,
            issue_number=context.issue_number,
            result=result,
            duration_ms=duration_ms,
            error=error,
            details=details or {},
            token_usage=token_usage,
        )

        self._write_entry(entry)
        return entry

    def _write_entry(self, entry: AuditEntry) -> None:
        """Write an entry to the log file."""
        if not self.enabled:
            return

        self._rotate_if_needed()

        try:
            log_file = self._get_log_file_path()
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(entry.to_json() + "\n")
        except Exception as e:
            logger.error(f"Failed to write audit log: {e}")

    @contextmanager
    def operation(
        self,
        action_start: AuditAction,
        action_complete: AuditAction,
        action_failed: AuditAction,
        actor_type: ActorType,
        actor_id: str | None = None,
        repo: str | None = None,
        pr_number: int | None = None,
        issue_number: int | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        """
        Context manager for auditing an operation.

        Usage:
            with audit.operation(
                action_start=AuditAction.PR_REVIEW_STARTED,
                action_complete=AuditAction.PR_REVIEW_COMPLETED,
                action_failed=AuditAction.PR_REVIEW_FAILED,
                actor_type=ActorType.AUTOMATION,
                repo="owner/repo",
                pr_number=123,
            ) as ctx:
                # Do work
                ctx.metadata["findings_count"] = 5

        Automatically logs start, completion, and failure with timing.
        """
        ctx = self.start_operation(
            actor_type=actor_type,
            actor_id=actor_id,
            repo=repo,
            pr_number=pr_number,
            issue_number=issue_number,
            metadata=metadata,
        )

        self.log(ctx, action_start, result="started")
        start_time = time.monotonic()

        try:
            yield ctx
            duration_ms = int((time.monotonic() - start_time) * 1000)
            self.log(
                ctx,
                action_complete,
                result="success",
                details=ctx.metadata,
                duration_ms=duration_ms,
            )
        except Exception as e:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            self.log(
                ctx,
                action_failed,
                result="failure",
                error=str(e),
                details=ctx.metadata,
                duration_ms=duration_ms,
            )
            raise

    def log_github_api_call(
        self,
        context: AuditContext,
        endpoint: str,
        method: str = "GET",
        status_code: int | None = None,
        duration_ms: int | None = None,
        error: str | None = None,
    ) -> None:
        """Log a GitHub API call."""
        action = (
            AuditAction.GITHUB_API_CALL if not error else AuditAction.GITHUB_API_ERROR
        )
        self.log(
            context,
            action,
            result="success" if not error else "failure",
            error=error,
            details={
                "endpoint": endpoint,
                "method": method,
                "status_code": status_code,
            },
            duration_ms=duration_ms,
        )

    def log_ai_agent(
        self,
        context: AuditContext,
        agent_type: str,
        model: str,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        duration_ms: int | None = None,
        error: str | None = None,
    ) -> None:
        """Log an AI agent invocation."""
        action = (
            AuditAction.AI_AGENT_COMPLETED if not error else AuditAction.AI_AGENT_FAILED
        )
        self.log(
            context,
            action,
            result="success" if not error else "failure",
            error=error,
            details={
                "agent_type": agent_type,
                "model": model,
            },
            token_usage={
                "input_tokens": input_tokens or 0,
                "output_tokens": output_tokens or 0,
            },
            duration_ms=duration_ms,
        )

    def log_permission_check(
        self,
        context: AuditContext,
        allowed: bool,
        reason: str,
        username: str | None = None,
        role: str | None = None,
    ) -> None:
        """Log a permission check result."""
        action = (
            AuditAction.PERMISSION_GRANTED if allowed else AuditAction.PERMISSION_DENIED
        )
        self.log(
            context,
            action,
            result="granted" if allowed else "denied",
            details={
                "reason": reason,
                "username": username,
                "role": role,
            },
        )

    def log_state_transition(
        self,
        context: AuditContext,
        from_state: str,
        to_state: str,
        reason: str | None = None,
    ) -> None:
        """Log a state machine transition."""
        self.log(
            context,
            AuditAction.STATE_TRANSITION,
            details={
                "from_state": from_state,
                "to_state": to_state,
                "reason": reason,
            },
        )

    def log_override(
        self,
        context: AuditContext,
        override_type: str,
        original_action: str,
        actor_id: str,
    ) -> None:
        """Log a user override action."""
        self.log(
            context,
            AuditAction.OVERRIDE_APPLIED,
            details={
                "override_type": override_type,
                "original_action": original_action,
                "overridden_by": actor_id,
            },
        )

    def query_logs(
        self,
        correlation_id: str | None = None,
        action: AuditAction | None = None,
        repo: str | None = None,
        pr_number: int | None = None,
        issue_number: int | None = None,
        since: datetime | None = None,
        limit: int = 100,
    ) -> list[AuditEntry]:
        """
        Query audit logs with filters.

        Args:
            correlation_id: Filter by correlation ID
            action: Filter by action type
            repo: Filter by repository
            pr_number: Filter by PR number
            issue_number: Filter by issue number
            since: Only entries after this time
            limit: Maximum entries to return

        Returns:
            List of matching AuditEntry objects
        """
        if not self.enabled or not self.log_dir.exists():
            return []

        results = []

        for log_file in sorted(self.log_dir.glob("audit_*.jsonl"), reverse=True):
            try:
                with open(log_file, encoding="utf-8") as f:
                    for line in f:
                        if not line.strip():
                            continue

                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        # Apply filters
                        if (
                            correlation_id
                            and data.get("correlation_id") != correlation_id
                        ):
                            continue
                        if action and data.get("action") != action.value:
                            continue
                        if repo and data.get("repo") != repo:
                            continue
                        if pr_number and data.get("pr_number") != pr_number:
                            continue
                        if issue_number and data.get("issue_number") != issue_number:
                            continue
                        if since:
                            entry_time = datetime.fromisoformat(data["timestamp"])
                            if entry_time < since:
                                continue

                        # Reconstruct entry
                        entry = AuditEntry(
                            timestamp=datetime.fromisoformat(data["timestamp"]),
                            correlation_id=data["correlation_id"],
                            action=AuditAction(data["action"]),
                            actor_type=ActorType(data["actor_type"]),
                            actor_id=data.get("actor_id"),
                            repo=data.get("repo"),
                            pr_number=data.get("pr_number"),
                            issue_number=data.get("issue_number"),
                            result=data["result"],
                            duration_ms=data.get("duration_ms"),
                            error=data.get("error"),
                            details=data.get("details", {}),
                            token_usage=data.get("token_usage"),
                        )
                        results.append(entry)

                        if len(results) >= limit:
                            return results

            except Exception as e:
                logger.error(f"Error reading audit log {log_file}: {e}")

        return results

    def get_operation_history(self, correlation_id: str) -> list[AuditEntry]:
        """Get all entries for a specific operation by correlation ID."""
        return self.query_logs(correlation_id=correlation_id, limit=1000)

    def get_statistics(
        self,
        repo: str | None = None,
        since: datetime | None = None,
    ) -> dict[str, Any]:
        """
        Get aggregate statistics from audit logs.

        Returns:
            Dictionary with counts by action, result, and actor type
        """
        entries = self.query_logs(repo=repo, since=since, limit=10000)

        stats = {
            "total_entries": len(entries),
            "by_action": {},
            "by_result": {},
            "by_actor_type": {},
            "total_duration_ms": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
        }

        for entry in entries:
            # Count by action
            action = entry.action.value
            stats["by_action"][action] = stats["by_action"].get(action, 0) + 1

            # Count by result
            result = entry.result
            stats["by_result"][result] = stats["by_result"].get(result, 0) + 1

            # Count by actor type
            actor = entry.actor_type.value
            stats["by_actor_type"][actor] = stats["by_actor_type"].get(actor, 0) + 1

            # Sum durations
            if entry.duration_ms:
                stats["total_duration_ms"] += entry.duration_ms

            # Sum token usage
            if entry.token_usage:
                stats["total_input_tokens"] += entry.token_usage.get("input_tokens", 0)
                stats["total_output_tokens"] += entry.token_usage.get(
                    "output_tokens", 0
                )

        return stats


# Convenience functions for quick logging
def get_audit_logger() -> AuditLogger:
    """Get the global audit logger instance."""
    return AuditLogger.get_instance()


def audit_operation(
    action_start: AuditAction,
    action_complete: AuditAction,
    action_failed: AuditAction,
    **kwargs,
):
    """Decorator for auditing function calls."""

    def decorator(func):
        async def async_wrapper(*args, **func_kwargs):
            audit = get_audit_logger()
            with audit.operation(
                action_start=action_start,
                action_complete=action_complete,
                action_failed=action_failed,
                **kwargs,
            ) as ctx:
                return await func(*args, audit_context=ctx, **func_kwargs)

        def sync_wrapper(*args, **func_kwargs):
            audit = get_audit_logger()
            with audit.operation(
                action_start=action_start,
                action_complete=action_complete,
                action_failed=action_failed,
                **kwargs,
            ) as ctx:
                return func(*args, audit_context=ctx, **func_kwargs)

        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator

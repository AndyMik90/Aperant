"""
Issue Lifecycle & Conflict Resolution
======================================

Unified state machine for issue lifecycle:
  new → triaged → approved_for_fix → building → pr_created → reviewed → merged

Prevents conflicting operations:
- Blocks auto-fix if triage = spam/duplicate
- Requires triage before auto-fix
- Auto-generated PRs must pass AI review before human notification
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


class IssueLifecycleState(str, Enum):
    """Unified issue lifecycle states."""

    # Initial state
    NEW = "new"

    # Triage states
    TRIAGING = "triaging"
    TRIAGED = "triaged"
    SPAM = "spam"
    DUPLICATE = "duplicate"

    # Approval states
    PENDING_APPROVAL = "pending_approval"
    APPROVED_FOR_FIX = "approved_for_fix"
    REJECTED = "rejected"

    # Build states
    SPEC_CREATING = "spec_creating"
    SPEC_READY = "spec_ready"
    BUILDING = "building"
    BUILD_FAILED = "build_failed"

    # PR states
    PR_CREATING = "pr_creating"
    PR_CREATED = "pr_created"
    PR_REVIEWING = "pr_reviewing"
    PR_CHANGES_REQUESTED = "pr_changes_requested"
    PR_APPROVED = "pr_approved"

    # Terminal states
    MERGED = "merged"
    CLOSED = "closed"
    WONT_FIX = "wont_fix"

    @classmethod
    def terminal_states(cls) -> set[IssueLifecycleState]:
        return {cls.MERGED, cls.CLOSED, cls.WONT_FIX, cls.SPAM, cls.DUPLICATE}

    @classmethod
    def blocks_auto_fix(cls) -> set[IssueLifecycleState]:
        """States that block auto-fix."""
        return {cls.SPAM, cls.DUPLICATE, cls.REJECTED, cls.WONT_FIX}

    @classmethod
    def requires_triage_first(cls) -> set[IssueLifecycleState]:
        """States that require triage completion first."""
        return {cls.NEW, cls.TRIAGING}


# Valid state transitions
VALID_TRANSITIONS: dict[IssueLifecycleState, set[IssueLifecycleState]] = {
    IssueLifecycleState.NEW: {
        IssueLifecycleState.TRIAGING,
        IssueLifecycleState.CLOSED,
    },
    IssueLifecycleState.TRIAGING: {
        IssueLifecycleState.TRIAGED,
        IssueLifecycleState.SPAM,
        IssueLifecycleState.DUPLICATE,
    },
    IssueLifecycleState.TRIAGED: {
        IssueLifecycleState.PENDING_APPROVAL,
        IssueLifecycleState.APPROVED_FOR_FIX,
        IssueLifecycleState.REJECTED,
        IssueLifecycleState.CLOSED,
    },
    IssueLifecycleState.SPAM: {
        IssueLifecycleState.TRIAGED,  # Override
        IssueLifecycleState.CLOSED,
    },
    IssueLifecycleState.DUPLICATE: {
        IssueLifecycleState.TRIAGED,  # Override
        IssueLifecycleState.CLOSED,
    },
    IssueLifecycleState.PENDING_APPROVAL: {
        IssueLifecycleState.APPROVED_FOR_FIX,
        IssueLifecycleState.REJECTED,
    },
    IssueLifecycleState.APPROVED_FOR_FIX: {
        IssueLifecycleState.SPEC_CREATING,
        IssueLifecycleState.REJECTED,
    },
    IssueLifecycleState.REJECTED: {
        IssueLifecycleState.PENDING_APPROVAL,  # Retry
        IssueLifecycleState.CLOSED,
    },
    IssueLifecycleState.SPEC_CREATING: {
        IssueLifecycleState.SPEC_READY,
        IssueLifecycleState.BUILD_FAILED,
    },
    IssueLifecycleState.SPEC_READY: {
        IssueLifecycleState.BUILDING,
        IssueLifecycleState.REJECTED,
    },
    IssueLifecycleState.BUILDING: {
        IssueLifecycleState.PR_CREATING,
        IssueLifecycleState.BUILD_FAILED,
    },
    IssueLifecycleState.BUILD_FAILED: {
        IssueLifecycleState.SPEC_CREATING,  # Retry
        IssueLifecycleState.CLOSED,
    },
    IssueLifecycleState.PR_CREATING: {
        IssueLifecycleState.PR_CREATED,
        IssueLifecycleState.BUILD_FAILED,
    },
    IssueLifecycleState.PR_CREATED: {
        IssueLifecycleState.PR_REVIEWING,
        IssueLifecycleState.CLOSED,
    },
    IssueLifecycleState.PR_REVIEWING: {
        IssueLifecycleState.PR_APPROVED,
        IssueLifecycleState.PR_CHANGES_REQUESTED,
    },
    IssueLifecycleState.PR_CHANGES_REQUESTED: {
        IssueLifecycleState.BUILDING,  # Fix loop
        IssueLifecycleState.CLOSED,
    },
    IssueLifecycleState.PR_APPROVED: {
        IssueLifecycleState.MERGED,
        IssueLifecycleState.CLOSED,
    },
    # Terminal states - no transitions
    IssueLifecycleState.MERGED: set(),
    IssueLifecycleState.CLOSED: set(),
    IssueLifecycleState.WONT_FIX: set(),
}


class ConflictType(str, Enum):
    """Types of conflicts that can occur."""

    TRIAGE_REQUIRED = "triage_required"
    BLOCKED_BY_CLASSIFICATION = "blocked_by_classification"
    INVALID_TRANSITION = "invalid_transition"
    CONCURRENT_OPERATION = "concurrent_operation"
    STALE_STATE = "stale_state"
    REVIEW_REQUIRED = "review_required"


@dataclass
class ConflictResult:
    """Result of conflict check."""

    has_conflict: bool
    conflict_type: ConflictType | None = None
    message: str = ""
    blocking_state: IssueLifecycleState | None = None
    resolution_hint: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "has_conflict": self.has_conflict,
            "conflict_type": self.conflict_type.value if self.conflict_type else None,
            "message": self.message,
            "blocking_state": self.blocking_state.value
            if self.blocking_state
            else None,
            "resolution_hint": self.resolution_hint,
        }


@dataclass
class StateTransition:
    """Record of a state transition."""

    from_state: IssueLifecycleState
    to_state: IssueLifecycleState
    timestamp: str
    actor: str
    reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "from_state": self.from_state.value,
            "to_state": self.to_state.value,
            "timestamp": self.timestamp,
            "actor": self.actor,
            "reason": self.reason,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StateTransition:
        return cls(
            from_state=IssueLifecycleState(data["from_state"]),
            to_state=IssueLifecycleState(data["to_state"]),
            timestamp=data["timestamp"],
            actor=data["actor"],
            reason=data.get("reason"),
            metadata=data.get("metadata", {}),
        )


@dataclass
class IssueLifecycle:
    """Lifecycle state for a single issue."""

    issue_number: int
    repo: str
    current_state: IssueLifecycleState = IssueLifecycleState.NEW
    triage_result: dict[str, Any] | None = None
    spec_id: str | None = None
    pr_number: int | None = None
    transitions: list[StateTransition] = field(default_factory=list)
    locked_by: str | None = None  # Component holding lock
    locked_at: str | None = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def can_transition_to(self, new_state: IssueLifecycleState) -> bool:
        """Check if transition is valid."""
        valid = VALID_TRANSITIONS.get(self.current_state, set())
        return new_state in valid

    def transition(
        self,
        new_state: IssueLifecycleState,
        actor: str,
        reason: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ConflictResult:
        """
        Attempt to transition to a new state.

        Returns ConflictResult indicating success or conflict.
        """
        if not self.can_transition_to(new_state):
            return ConflictResult(
                has_conflict=True,
                conflict_type=ConflictType.INVALID_TRANSITION,
                message=f"Cannot transition from {self.current_state.value} to {new_state.value}",
                blocking_state=self.current_state,
                resolution_hint=f"Valid transitions: {[s.value for s in VALID_TRANSITIONS.get(self.current_state, set())]}",
            )

        # Record transition
        transition = StateTransition(
            from_state=self.current_state,
            to_state=new_state,
            timestamp=datetime.now(timezone.utc).isoformat(),
            actor=actor,
            reason=reason,
            metadata=metadata or {},
        )
        self.transitions.append(transition)
        self.current_state = new_state
        self.updated_at = datetime.now(timezone.utc).isoformat()

        return ConflictResult(has_conflict=False)

    def check_auto_fix_allowed(self) -> ConflictResult:
        """Check if auto-fix is allowed for this issue."""
        # Check if in blocking state
        if self.current_state in IssueLifecycleState.blocks_auto_fix():
            return ConflictResult(
                has_conflict=True,
                conflict_type=ConflictType.BLOCKED_BY_CLASSIFICATION,
                message=f"Auto-fix blocked: issue is marked as {self.current_state.value}",
                blocking_state=self.current_state,
                resolution_hint="Override classification to enable auto-fix",
            )

        # Check if triage required
        if self.current_state in IssueLifecycleState.requires_triage_first():
            return ConflictResult(
                has_conflict=True,
                conflict_type=ConflictType.TRIAGE_REQUIRED,
                message="Triage required before auto-fix",
                blocking_state=self.current_state,
                resolution_hint="Run triage first",
            )

        return ConflictResult(has_conflict=False)

    def check_pr_review_required(self) -> ConflictResult:
        """Check if PR review is required before human notification."""
        if self.current_state == IssueLifecycleState.PR_CREATED:
            # PR needs AI review before notifying humans
            return ConflictResult(
                has_conflict=True,
                conflict_type=ConflictType.REVIEW_REQUIRED,
                message="AI review required before human notification",
                resolution_hint="Run AI review on the PR",
            )

        return ConflictResult(has_conflict=False)

    def acquire_lock(self, component: str) -> bool:
        """Try to acquire lock for a component."""
        if self.locked_by is not None:
            return False
        self.locked_by = component
        self.locked_at = datetime.now(timezone.utc).isoformat()
        return True

    def release_lock(self, component: str) -> bool:
        """Release lock held by a component."""
        if self.locked_by != component:
            return False
        self.locked_by = None
        self.locked_at = None
        return True

    def is_locked(self) -> bool:
        """Check if issue is locked."""
        return self.locked_by is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "issue_number": self.issue_number,
            "repo": self.repo,
            "current_state": self.current_state.value,
            "triage_result": self.triage_result,
            "spec_id": self.spec_id,
            "pr_number": self.pr_number,
            "transitions": [t.to_dict() for t in self.transitions],
            "locked_by": self.locked_by,
            "locked_at": self.locked_at,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> IssueLifecycle:
        return cls(
            issue_number=data["issue_number"],
            repo=data["repo"],
            current_state=IssueLifecycleState(data.get("current_state", "new")),
            triage_result=data.get("triage_result"),
            spec_id=data.get("spec_id"),
            pr_number=data.get("pr_number"),
            transitions=[
                StateTransition.from_dict(t) for t in data.get("transitions", [])
            ],
            locked_by=data.get("locked_by"),
            locked_at=data.get("locked_at"),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            updated_at=data.get("updated_at", datetime.now(timezone.utc).isoformat()),
        )


class LifecycleManager:
    """
    Manages issue lifecycles and resolves conflicts.

    Usage:
        lifecycle = LifecycleManager(state_dir=Path(".auto-claude/github"))

        # Get or create lifecycle for issue
        state = lifecycle.get_or_create(repo="owner/repo", issue_number=123)

        # Check if auto-fix is allowed
        conflict = state.check_auto_fix_allowed()
        if conflict.has_conflict:
            print(f"Blocked: {conflict.message}")
            return

        # Transition state
        result = lifecycle.transition(
            repo="owner/repo",
            issue_number=123,
            new_state=IssueLifecycleState.BUILDING,
            actor="automation",
        )
    """

    def __init__(self, state_dir: Path):
        self.state_dir = state_dir
        self.lifecycle_dir = state_dir / "lifecycle"
        self.lifecycle_dir.mkdir(parents=True, exist_ok=True)

    def _get_file(self, repo: str, issue_number: int) -> Path:
        safe_repo = repo.replace("/", "_")
        return self.lifecycle_dir / f"{safe_repo}_{issue_number}.json"

    def get(self, repo: str, issue_number: int) -> IssueLifecycle | None:
        """Get lifecycle for an issue."""
        file = self._get_file(repo, issue_number)
        if not file.exists():
            return None

        with open(file, encoding="utf-8") as f:
            data = json.load(f)
        return IssueLifecycle.from_dict(data)

    def get_or_create(self, repo: str, issue_number: int) -> IssueLifecycle:
        """Get or create lifecycle for an issue."""
        lifecycle = self.get(repo, issue_number)
        if lifecycle:
            return lifecycle

        lifecycle = IssueLifecycle(issue_number=issue_number, repo=repo)
        self.save(lifecycle)
        return lifecycle

    def save(self, lifecycle: IssueLifecycle) -> None:
        """Save lifecycle state."""
        file = self._get_file(lifecycle.repo, lifecycle.issue_number)
        with open(file, "w", encoding="utf-8") as f:
            json.dump(lifecycle.to_dict(), f, indent=2)

    def transition(
        self,
        repo: str,
        issue_number: int,
        new_state: IssueLifecycleState,
        actor: str,
        reason: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ConflictResult:
        """Transition issue to new state."""
        lifecycle = self.get_or_create(repo, issue_number)
        result = lifecycle.transition(new_state, actor, reason, metadata)

        if not result.has_conflict:
            self.save(lifecycle)

        return result

    def check_conflict(
        self,
        repo: str,
        issue_number: int,
        operation: str,
    ) -> ConflictResult:
        """Check for conflicts before an operation."""
        lifecycle = self.get_or_create(repo, issue_number)

        # Check lock
        if lifecycle.is_locked():
            return ConflictResult(
                has_conflict=True,
                conflict_type=ConflictType.CONCURRENT_OPERATION,
                message=f"Issue locked by {lifecycle.locked_by}",
                resolution_hint="Wait for current operation to complete",
            )

        # Operation-specific checks
        if operation == "auto_fix":
            return lifecycle.check_auto_fix_allowed()
        elif operation == "notify_human":
            return lifecycle.check_pr_review_required()

        return ConflictResult(has_conflict=False)

    def acquire_lock(
        self,
        repo: str,
        issue_number: int,
        component: str,
    ) -> bool:
        """Acquire lock for an issue."""
        lifecycle = self.get_or_create(repo, issue_number)
        if lifecycle.acquire_lock(component):
            self.save(lifecycle)
            return True
        return False

    def release_lock(
        self,
        repo: str,
        issue_number: int,
        component: str,
    ) -> bool:
        """Release lock for an issue."""
        lifecycle = self.get(repo, issue_number)
        if lifecycle and lifecycle.release_lock(component):
            self.save(lifecycle)
            return True
        return False

    def get_all_in_state(
        self,
        repo: str,
        state: IssueLifecycleState,
    ) -> list[IssueLifecycle]:
        """Get all issues in a specific state."""
        results = []
        safe_repo = repo.replace("/", "_")

        for file in self.lifecycle_dir.glob(f"{safe_repo}_*.json"):
            with open(file, encoding="utf-8") as f:
                data = json.load(f)
                lifecycle = IssueLifecycle.from_dict(data)
                if lifecycle.current_state == state:
                    results.append(lifecycle)

        return results

    def get_summary(self, repo: str) -> dict[str, int]:
        """Get count of issues by state."""
        counts: dict[str, int] = {}
        safe_repo = repo.replace("/", "_")

        for file in self.lifecycle_dir.glob(f"{safe_repo}_*.json"):
            with open(file, encoding="utf-8") as f:
                data = json.load(f)
                state = data.get("current_state", "new")
                counts[state] = counts.get(state, 0) + 1

        return counts

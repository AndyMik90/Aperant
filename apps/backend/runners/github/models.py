"""
GitHub Automation Data Models
=============================

Data structures for GitHub automation features.
Stored in .auto-claude/github/pr/ and .auto-claude/github/issues/

All save() operations use file locking to prevent corruption in concurrent scenarios.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

try:
    from .file_lock import locked_json_update, locked_json_write
except (ImportError, ValueError, SystemError):
    from file_lock import locked_json_update, locked_json_write


def _utc_now_iso() -> str:
    """Return current UTC time as ISO 8601 string with timezone info."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ReviewSeverity(str, Enum):
    """Severity levels for PR review findings."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReviewCategory(str, Enum):
    """Categories for PR review findings."""

    SECURITY = "security"
    QUALITY = "quality"
    STYLE = "style"
    TEST = "test"
    DOCS = "docs"
    PATTERN = "pattern"
    PERFORMANCE = "performance"
    VERIFICATION_FAILED = "verification_failed"  # NEW: Cannot verify requirements/paths
    REDUNDANCY = "redundancy"  # NEW: Duplicate code/logic detected


class ReviewPass(str, Enum):
    """Multi-pass review stages."""

    QUICK_SCAN = "quick_scan"
    SECURITY = "security"
    QUALITY = "quality"
    DEEP_ANALYSIS = "deep_analysis"
    STRUCTURAL = "structural"  # Feature creep, architecture, PR structure
    AI_COMMENT_TRIAGE = "ai_comment_triage"  # Verify other AI tool comments


class MergeVerdict(str, Enum):
    """Clear verdict for whether PR can be merged."""

    READY_TO_MERGE = "ready_to_merge"  # No blockers, good to go
    MERGE_WITH_CHANGES = "merge_with_changes"  # Minor issues, fix before merge
    NEEDS_REVISION = "needs_revision"  # Significant issues, needs rework
    BLOCKED = "blocked"  # Critical issues, cannot merge


# Constants for branch-behind messaging (DRY - used across multiple reviewers)
BRANCH_BEHIND_BLOCKER_MSG = (
    "Branch Out of Date: PR branch is behind the base branch and needs to be updated"
)
BRANCH_BEHIND_REASONING = (
    "Branch is out of date with base branch. Update branch first - "
    "if no conflicts arise, you can merge. If merge conflicts arise, "
    "resolve them and run follow-up review again."
)


# =============================================================================
# Verdict Helper Functions (testable logic extracted from orchestrator)
# =============================================================================


def verdict_from_severity_counts(
    critical_count: int = 0,
    high_count: int = 0,
    medium_count: int = 0,
    low_count: int = 0,
) -> MergeVerdict:
    """
    Determine merge verdict based on finding severity counts.

    This is the canonical implementation of severity-to-verdict mapping.
    Extracted here so it can be tested directly and reused.

    Args:
        critical_count: Number of critical severity findings
        high_count: Number of high severity findings
        medium_count: Number of medium severity findings
        low_count: Number of low severity findings

    Returns:
        MergeVerdict based on severity levels
    """
    if critical_count > 0:
        return MergeVerdict.BLOCKED
    elif high_count > 0 or medium_count > 0:
        return MergeVerdict.NEEDS_REVISION
    # Low findings or no findings -> ready to merge
    return MergeVerdict.READY_TO_MERGE


def apply_merge_conflict_override(
    verdict: MergeVerdict,
    has_merge_conflicts: bool,
) -> MergeVerdict:
    """
    Apply merge conflict override to verdict.

    Merge conflicts always result in BLOCKED, regardless of other verdicts.

    Args:
        verdict: The current verdict
        has_merge_conflicts: Whether PR has merge conflicts

    Returns:
        BLOCKED if conflicts exist, otherwise original verdict
    """
    if has_merge_conflicts:
        return MergeVerdict.BLOCKED
    return verdict


def apply_branch_behind_downgrade(
    verdict: MergeVerdict,
    merge_state_status: str,
) -> MergeVerdict:
    """
    Apply branch-behind status downgrade to verdict.

    BEHIND status downgrades READY_TO_MERGE and MERGE_WITH_CHANGES to NEEDS_REVISION.
    BLOCKED verdict is preserved (not downgraded).

    Args:
        verdict: The current verdict
        merge_state_status: The merge state status (e.g., "BEHIND", "CLEAN")

    Returns:
        Downgraded verdict if behind, otherwise original
    """
    if merge_state_status == "BEHIND":
        if verdict in (MergeVerdict.READY_TO_MERGE, MergeVerdict.MERGE_WITH_CHANGES):
            return MergeVerdict.NEEDS_REVISION
    return verdict


def apply_ci_status_override(
    verdict: MergeVerdict,
    failing_count: int = 0,
    pending_count: int = 0,
) -> MergeVerdict:
    """
    Apply CI status override to verdict.

    Failing CI -> BLOCKED (only for READY_TO_MERGE or MERGE_WITH_CHANGES verdicts)
    Pending CI -> NEEDS_REVISION (only for READY_TO_MERGE or MERGE_WITH_CHANGES verdicts)
    BLOCKED and NEEDS_REVISION verdicts are preserved as-is.

    Args:
        verdict: The current verdict
        failing_count: Number of failing CI checks
        pending_count: Number of pending CI checks

    Returns:
        Updated verdict based on CI status
    """
    if failing_count > 0:
        if verdict in (MergeVerdict.READY_TO_MERGE, MergeVerdict.MERGE_WITH_CHANGES):
            return MergeVerdict.BLOCKED
    elif pending_count > 0:
        if verdict in (MergeVerdict.READY_TO_MERGE, MergeVerdict.MERGE_WITH_CHANGES):
            return MergeVerdict.NEEDS_REVISION
    return verdict


def verdict_to_github_status(verdict: MergeVerdict) -> str:
    """
    Map merge verdict to GitHub review overall status.

    Args:
        verdict: The merge verdict

    Returns:
        GitHub review status: "approve", "comment", or "request_changes"
    """
    if verdict == MergeVerdict.BLOCKED:
        return "request_changes"
    elif verdict == MergeVerdict.NEEDS_REVISION:
        return "request_changes"
    elif verdict == MergeVerdict.MERGE_WITH_CHANGES:
        return "comment"
    else:
        return "approve"


class AICommentVerdict(str, Enum):
    """Verdict on AI tool comments (CodeRabbit, Cursor, Greptile, etc.)."""

    CRITICAL = "critical"  # Must be addressed before merge
    IMPORTANT = "important"  # Should be addressed
    NICE_TO_HAVE = "nice_to_have"  # Optional improvement
    TRIVIAL = "trivial"  # Can be ignored
    FALSE_POSITIVE = "false_positive"  # AI was wrong
    ADDRESSED = "addressed"  # Valid issue that was fixed in a subsequent commit


class TriageCategory(str, Enum):
    """Issue triage categories."""

    BUG = "bug"
    FEATURE = "feature"
    DOCUMENTATION = "documentation"
    QUESTION = "question"
    DUPLICATE = "duplicate"
    SPAM = "spam"
    FEATURE_CREEP = "feature_creep"


class AutoFixStatus(str, Enum):
    """Status for auto-fix operations."""

    # Initial states
    PENDING = "pending"
    ANALYZING = "analyzing"

    # Spec creation states
    CREATING_SPEC = "creating_spec"
    WAITING_APPROVAL = "waiting_approval"  # P1-3: Human review gate

    # Build states
    BUILDING = "building"
    QA_REVIEW = "qa_review"

    # PR states
    PR_CREATED = "pr_created"
    MERGE_CONFLICT = "merge_conflict"  # P1-3: Conflict resolution needed

    # Terminal states
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"  # P1-3: User cancelled

    # Special states
    STALE = "stale"  # P1-3: Issue updated after spec creation
    RATE_LIMITED = "rate_limited"  # P1-3: Waiting for rate limit reset

    @classmethod
    def terminal_states(cls) -> set[AutoFixStatus]:
        """States that represent end of workflow."""
        return {cls.COMPLETED, cls.FAILED, cls.CANCELLED}

    @classmethod
    def recoverable_states(cls) -> set[AutoFixStatus]:
        """States that can be recovered from."""
        return {cls.FAILED, cls.STALE, cls.RATE_LIMITED, cls.MERGE_CONFLICT}

    @classmethod
    def active_states(cls) -> set[AutoFixStatus]:
        """States that indicate work in progress."""
        return {
            cls.PENDING,
            cls.ANALYZING,
            cls.CREATING_SPEC,
            cls.BUILDING,
            cls.QA_REVIEW,
            cls.PR_CREATED,
        }

    def can_transition_to(self, new_state: AutoFixStatus) -> bool:
        """Check if transition to new_state is valid."""
        valid_transitions = {
            AutoFixStatus.PENDING: {
                AutoFixStatus.ANALYZING,
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.ANALYZING: {
                AutoFixStatus.CREATING_SPEC,
                AutoFixStatus.FAILED,
                AutoFixStatus.CANCELLED,
                AutoFixStatus.RATE_LIMITED,
            },
            AutoFixStatus.CREATING_SPEC: {
                AutoFixStatus.WAITING_APPROVAL,
                AutoFixStatus.BUILDING,
                AutoFixStatus.FAILED,
                AutoFixStatus.CANCELLED,
                AutoFixStatus.STALE,
            },
            AutoFixStatus.WAITING_APPROVAL: {
                AutoFixStatus.BUILDING,
                AutoFixStatus.CANCELLED,
                AutoFixStatus.STALE,
            },
            AutoFixStatus.BUILDING: {
                AutoFixStatus.QA_REVIEW,
                AutoFixStatus.FAILED,
                AutoFixStatus.CANCELLED,
                AutoFixStatus.RATE_LIMITED,
            },
            AutoFixStatus.QA_REVIEW: {
                AutoFixStatus.PR_CREATED,
                AutoFixStatus.BUILDING,  # Fix loop
                AutoFixStatus.FAILED,
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.PR_CREATED: {
                AutoFixStatus.COMPLETED,
                AutoFixStatus.MERGE_CONFLICT,
                AutoFixStatus.FAILED,
            },
            AutoFixStatus.MERGE_CONFLICT: {
                AutoFixStatus.BUILDING,  # Retry after conflict resolution
                AutoFixStatus.FAILED,
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.STALE: {
                AutoFixStatus.ANALYZING,  # Re-analyze with new issue content
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.RATE_LIMITED: {
                AutoFixStatus.PENDING,  # Resume after rate limit
                AutoFixStatus.CANCELLED,
            },
            # Terminal states - no transitions
            AutoFixStatus.COMPLETED: set(),
            AutoFixStatus.FAILED: {AutoFixStatus.PENDING},  # Allow retry
            AutoFixStatus.CANCELLED: set(),
        }
        return new_state in valid_transitions.get(self, set())


@dataclass
class PRReviewFinding:
    """A single finding from a PR review."""

    id: str
    severity: ReviewSeverity
    category: ReviewCategory
    title: str
    description: str
    file: str
    line: int
    end_line: int | None = None
    suggested_fix: str | None = None
    fixable: bool = False
    # Evidence-based validation: actual code proving the issue exists
    evidence: str | None = None  # Actual code snippet showing the issue
    verification_note: str | None = (
        None  # What evidence is missing or couldn't be verified
    )
    redundant_with: str | None = None  # Reference to duplicate code (file:line)

    # Finding validation fields (from finding-validator re-investigation)
    validation_status: str | None = (
        None  # confirmed_valid, dismissed_false_positive, needs_human_review
    )
    validation_evidence: str | None = None  # Code snippet examined during validation
    validation_explanation: str | None = None  # Why finding was validated/dismissed

    # Cross-validation fields
    # NOTE: confidence field is DEPRECATED - we use evidence-based validation, not confidence scores
    # The finding-validator determines validity by examining actual code, not by confidence thresholds
    confidence: float = 0.5  # DEPRECATED: No longer used for filtering
    source_agents: list[str] = field(
        default_factory=list
    )  # Which agents reported this finding
    cross_validated: bool = (
        False  # Whether multiple agents agreed on this finding (signal, not filter)
    )

    # Impact finding flag - indicates this finding is about code OUTSIDE the PR's changed files
    # (e.g., callers affected by contract changes). Used by _is_finding_in_scope() to allow
    # findings about related files that aren't directly in the PR diff.
    is_impact_finding: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "severity": self.severity.value,
            "category": self.category.value,
            "title": self.title,
            "description": self.description,
            "file": self.file,
            "line": self.line,
            "end_line": self.end_line,
            "suggested_fix": self.suggested_fix,
            "fixable": self.fixable,
            # Evidence-based validation fields
            "evidence": self.evidence,
            "verification_note": self.verification_note,
            "redundant_with": self.redundant_with,
            # Validation fields
            "validation_status": self.validation_status,
            "validation_evidence": self.validation_evidence,
            "validation_explanation": self.validation_explanation,
            # Cross-validation and confidence routing fields
            "confidence": self.confidence,
            "source_agents": self.source_agents,
            "cross_validated": self.cross_validated,
            # Impact finding flag
            "is_impact_finding": self.is_impact_finding,
        }

    @classmethod
    def from_dict(cls, data: dict) -> PRReviewFinding:
        return cls(
            id=data["id"],
            severity=ReviewSeverity(data["severity"]),
            category=ReviewCategory(data["category"]),
            title=data["title"],
            description=data["description"],
            file=data["file"],
            line=data["line"],
            end_line=data.get("end_line"),
            suggested_fix=data.get("suggested_fix"),
            fixable=data.get("fixable", False),
            # Evidence-based validation fields
            evidence=data.get("evidence"),
            verification_note=data.get("verification_note"),
            redundant_with=data.get("redundant_with"),
            # Validation fields
            validation_status=data.get("validation_status"),
            validation_evidence=data.get("validation_evidence"),
            validation_explanation=data.get("validation_explanation"),
            # Cross-validation and confidence routing fields
            confidence=data.get("confidence", 0.5),
            source_agents=data.get("source_agents", []),
            cross_validated=data.get("cross_validated", False),
            # Impact finding flag
            is_impact_finding=data.get("is_impact_finding", False),
        )


@dataclass
class AICommentTriage:
    """Triage result for an AI tool comment (CodeRabbit, Cursor, Greptile, etc.)."""

    comment_id: int
    tool_name: str  # "CodeRabbit", "Cursor", "Greptile", etc.
    original_comment: str
    verdict: AICommentVerdict
    reasoning: str
    response_comment: str | None = None  # Comment to post in reply

    def to_dict(self) -> dict:
        return {
            "comment_id": self.comment_id,
            "tool_name": self.tool_name,
            "original_comment": self.original_comment,
            "verdict": self.verdict.value,
            "reasoning": self.reasoning,
            "response_comment": self.response_comment,
        }

    @classmethod
    def from_dict(cls, data: dict) -> AICommentTriage:
        return cls(
            comment_id=data["comment_id"],
            tool_name=data["tool_name"],
            original_comment=data["original_comment"],
            verdict=AICommentVerdict(data["verdict"]),
            reasoning=data["reasoning"],
            response_comment=data.get("response_comment"),
        )


@dataclass
class StructuralIssue:
    """Structural issue with the PR (feature creep, architecture, etc.)."""

    id: str
    issue_type: str  # "feature_creep", "scope_creep", "architecture_violation", "poor_structure"
    severity: ReviewSeverity
    title: str
    description: str
    impact: str  # Why this matters
    suggestion: str  # How to fix

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "issue_type": self.issue_type,
            "severity": self.severity.value,
            "title": self.title,
            "description": self.description,
            "impact": self.impact,
            "suggestion": self.suggestion,
        }

    @classmethod
    def from_dict(cls, data: dict) -> StructuralIssue:
        return cls(
            id=data["id"],
            issue_type=data["issue_type"],
            severity=ReviewSeverity(data["severity"]),
            title=data["title"],
            description=data["description"],
            impact=data["impact"],
            suggestion=data["suggestion"],
        )


@dataclass
class PRReviewResult:
    """Complete result of a PR review."""

    pr_number: int
    repo: str
    success: bool
    findings: list[PRReviewFinding] = field(default_factory=list)
    summary: str = ""
    overall_status: str = "comment"  # approve, request_changes, comment
    review_id: int | None = None
    reviewed_at: str = field(default_factory=lambda: _utc_now_iso())
    error: str | None = None

    # NEW: Enhanced verdict system
    verdict: MergeVerdict = MergeVerdict.READY_TO_MERGE
    verdict_reasoning: str = ""
    blockers: list[str] = field(default_factory=list)  # Issues that MUST be fixed

    # NEW: Risk assessment
    risk_assessment: dict = field(
        default_factory=lambda: {
            "complexity": "low",  # low, medium, high
            "security_impact": "none",  # none, low, medium, critical
            "scope_coherence": "good",  # good, mixed, poor
        }
    )

    # NEW: Structural issues and AI comment triages
    structural_issues: list[StructuralIssue] = field(default_factory=list)
    ai_comment_triages: list[AICommentTriage] = field(default_factory=list)

    # NEW: Quick scan summary preserved
    quick_scan_summary: dict = field(default_factory=dict)

    # Follow-up review tracking
    reviewed_commit_sha: str | None = None  # HEAD SHA at time of review
    reviewed_file_blobs: dict[str, str] = field(
        default_factory=dict
    )  # filename → blob SHA at time of review (survives rebases)
    is_followup_review: bool = False  # True if this is a follow-up review
    previous_review_id: int | None = None  # Reference to the review this follows up on
    resolved_findings: list[str] = field(default_factory=list)  # Finding IDs now fixed
    unresolved_findings: list[str] = field(
        default_factory=list
    )  # Finding IDs still open
    new_findings_since_last_review: list[str] = field(
        default_factory=list
    )  # New issues in recent commits

    # Posted findings tracking (for frontend state sync)
    has_posted_findings: bool = False  # True if any findings have been posted to GitHub
    posted_finding_ids: list[str] = field(
        default_factory=list
    )  # IDs of posted findings
    posted_at: str | None = None  # Timestamp when findings were posted

    # In-progress review tracking
    in_progress_since: str | None = None  # ISO timestamp when active review started

    def to_dict(self) -> dict:
        return {
            "pr_number": self.pr_number,
            "repo": self.repo,
            "success": self.success,
            "findings": [f.to_dict() for f in self.findings],
            "summary": self.summary,
            "overall_status": self.overall_status,
            "review_id": self.review_id,
            "reviewed_at": self.reviewed_at,
            "error": self.error,
            # NEW fields
            "verdict": self.verdict.value,
            "verdict_reasoning": self.verdict_reasoning,
            "blockers": self.blockers,
            "risk_assessment": self.risk_assessment,
            "structural_issues": [s.to_dict() for s in self.structural_issues],
            "ai_comment_triages": [t.to_dict() for t in self.ai_comment_triages],
            "quick_scan_summary": self.quick_scan_summary,
            # Follow-up review fields
            "reviewed_commit_sha": self.reviewed_commit_sha,
            "reviewed_file_blobs": self.reviewed_file_blobs,
            "is_followup_review": self.is_followup_review,
            "previous_review_id": self.previous_review_id,
            "resolved_findings": self.resolved_findings,
            "unresolved_findings": self.unresolved_findings,
            "new_findings_since_last_review": self.new_findings_since_last_review,
            # Posted findings tracking
            "has_posted_findings": self.has_posted_findings,
            "posted_finding_ids": self.posted_finding_ids,
            "posted_at": self.posted_at,
            # In-progress review tracking
            "in_progress_since": self.in_progress_since,
        }

    @classmethod
    def from_dict(cls, data: dict) -> PRReviewResult:
        return cls(
            pr_number=data["pr_number"],
            repo=data["repo"],
            success=data["success"],
            findings=[PRReviewFinding.from_dict(f) for f in data.get("findings", [])],
            summary=data.get("summary", ""),
            overall_status=data.get("overall_status", "comment"),
            review_id=data.get("review_id"),
            reviewed_at=data.get("reviewed_at", _utc_now_iso()),
            error=data.get("error"),
            # NEW fields
            verdict=MergeVerdict(data.get("verdict", "ready_to_merge")),
            verdict_reasoning=data.get("verdict_reasoning", ""),
            blockers=data.get("blockers", []),
            risk_assessment=data.get(
                "risk_assessment",
                {
                    "complexity": "low",
                    "security_impact": "none",
                    "scope_coherence": "good",
                },
            ),
            structural_issues=[
                StructuralIssue.from_dict(s) for s in data.get("structural_issues", [])
            ],
            ai_comment_triages=[
                AICommentTriage.from_dict(t) for t in data.get("ai_comment_triages", [])
            ],
            quick_scan_summary=data.get("quick_scan_summary", {}),
            # Follow-up review fields
            reviewed_commit_sha=data.get("reviewed_commit_sha"),
            reviewed_file_blobs=data.get("reviewed_file_blobs", {}),
            is_followup_review=data.get("is_followup_review", False),
            previous_review_id=data.get("previous_review_id"),
            resolved_findings=data.get("resolved_findings", []),
            unresolved_findings=data.get("unresolved_findings", []),
            new_findings_since_last_review=data.get(
                "new_findings_since_last_review", []
            ),
            # Posted findings tracking
            has_posted_findings=data.get("has_posted_findings", False),
            posted_finding_ids=data.get("posted_finding_ids", []),
            posted_at=data.get("posted_at"),
            # In-progress review tracking
            in_progress_since=data.get("in_progress_since"),
        )

    async def save(self, github_dir: Path) -> None:
        """Save review result to .auto-claude/github/pr/ with file locking."""
        pr_dir = github_dir / "pr"
        pr_dir.mkdir(parents=True, exist_ok=True)

        review_file = pr_dir / f"review_{self.pr_number}.json"

        # Atomic locked write
        await locked_json_write(review_file, self.to_dict(), timeout=5.0)

        # Update index with locking
        await self._update_index(pr_dir)

    async def _update_index(self, pr_dir: Path) -> None:
        """Update the PR review index with file locking."""
        index_file = pr_dir / "index.json"

        def update_index(current_data):
            """Update function for atomic index update."""
            if current_data is None:
                current_data = {"reviews": [], "last_updated": None}

            # Update or add entry
            reviews = current_data.get("reviews", [])
            existing = next(
                (r for r in reviews if r["pr_number"] == self.pr_number), None
            )

            entry = {
                "pr_number": self.pr_number,
                "repo": self.repo,
                "overall_status": self.overall_status,
                "findings_count": len(self.findings),
                "reviewed_at": self.reviewed_at,
            }

            if existing:
                reviews = [
                    entry if r["pr_number"] == self.pr_number else r for r in reviews
                ]
            else:
                reviews.append(entry)

            current_data["reviews"] = reviews
            current_data["last_updated"] = _utc_now_iso()

            return current_data

        # Atomic locked update
        await locked_json_update(index_file, update_index, timeout=5.0)

    @classmethod
    def load(cls, github_dir: Path, pr_number: int) -> PRReviewResult | None:
        """Load a review result from disk."""
        review_file = github_dir / "pr" / f"review_{pr_number}.json"
        if not review_file.exists():
            return None

        with open(review_file, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


@dataclass
class FollowupReviewContext:
    """Context for a follow-up review."""

    pr_number: int
    previous_review: PRReviewResult
    previous_commit_sha: str
    current_commit_sha: str

    # Changes since last review
    commits_since_review: list[dict] = field(default_factory=list)
    files_changed_since_review: list[str] = field(default_factory=list)
    diff_since_review: str = ""

    # Comments since last review
    contributor_comments_since_review: list[dict] = field(default_factory=list)
    ai_bot_comments_since_review: list[dict] = field(default_factory=list)

    # PR reviews since last review (formal review submissions from Cursor, CodeRabbit, etc.)
    # These are different from comments - they're full review submissions with body text
    pr_reviews_since_review: list[dict] = field(default_factory=list)

    # Merge conflict status
    has_merge_conflicts: bool = False  # True if PR has conflicts with base branch
    merge_state_status: str = (
        ""  # BEHIND, BLOCKED, CLEAN, DIRTY, HAS_HOOKS, UNKNOWN, UNSTABLE
    )

    # CI status - passed to AI orchestrator so it can factor into verdict
    # Dict with: passing, failing, pending, failed_checks, awaiting_approval
    ci_status: dict = field(default_factory=dict)

    # Error flag - if set, context gathering failed and data may be incomplete
    error: str | None = None


@dataclass
class TriageResult:
    """Result of triaging a single issue."""

    issue_number: int
    repo: str
    category: TriageCategory
    confidence: float  # 0.0 to 1.0
    labels_to_add: list[str] = field(default_factory=list)
    labels_to_remove: list[str] = field(default_factory=list)
    is_duplicate: bool = False
    duplicate_of: int | None = None
    is_spam: bool = False
    is_feature_creep: bool = False
    suggested_breakdown: list[str] = field(default_factory=list)
    priority: str = "medium"  # high, medium, low
    comment: str | None = None
    triaged_at: str = field(default_factory=lambda: _utc_now_iso())

    def to_dict(self) -> dict:
        return {
            "issue_number": self.issue_number,
            "repo": self.repo,
            "category": self.category.value,
            "confidence": self.confidence,
            "labels_to_add": self.labels_to_add,
            "labels_to_remove": self.labels_to_remove,
            "is_duplicate": self.is_duplicate,
            "duplicate_of": self.duplicate_of,
            "is_spam": self.is_spam,
            "is_feature_creep": self.is_feature_creep,
            "suggested_breakdown": self.suggested_breakdown,
            "priority": self.priority,
            "comment": self.comment,
            "triaged_at": self.triaged_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> TriageResult:
        return cls(
            issue_number=data["issue_number"],
            repo=data["repo"],
            category=TriageCategory(data["category"]),
            confidence=data["confidence"],
            labels_to_add=data.get("labels_to_add", []),
            labels_to_remove=data.get("labels_to_remove", []),
            is_duplicate=data.get("is_duplicate", False),
            duplicate_of=data.get("duplicate_of"),
            is_spam=data.get("is_spam", False),
            is_feature_creep=data.get("is_feature_creep", False),
            suggested_breakdown=data.get("suggested_breakdown", []),
            priority=data.get("priority", "medium"),
            comment=data.get("comment"),
            triaged_at=data.get("triaged_at", _utc_now_iso()),
        )

    async def save(self, github_dir: Path) -> None:
        """Save triage result to .auto-claude/github/issues/ with file locking."""
        issues_dir = github_dir / "issues"
        issues_dir.mkdir(parents=True, exist_ok=True)

        triage_file = issues_dir / f"triage_{self.issue_number}.json"

        # Atomic locked write
        await locked_json_write(triage_file, self.to_dict(), timeout=5.0)

    @classmethod
    def load(cls, github_dir: Path, issue_number: int) -> TriageResult | None:
        """Load a triage result from disk."""
        triage_file = github_dir / "issues" / f"triage_{issue_number}.json"
        if not triage_file.exists():
            return None

        with open(triage_file, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


@dataclass
class AutoFixState:
    """State tracking for auto-fix operations."""

    issue_number: int
    issue_url: str
    repo: str
    status: AutoFixStatus = AutoFixStatus.PENDING
    spec_id: str | None = None
    spec_dir: str | None = None
    pr_number: int | None = None
    pr_url: str | None = None
    bot_comments: list[str] = field(default_factory=list)
    error: str | None = None
    created_at: str = field(default_factory=lambda: _utc_now_iso())
    updated_at: str = field(default_factory=lambda: _utc_now_iso())

    def to_dict(self) -> dict:
        return {
            "issue_number": self.issue_number,
            "issue_url": self.issue_url,
            "repo": self.repo,
            "status": self.status.value,
            "spec_id": self.spec_id,
            "spec_dir": self.spec_dir,
            "pr_number": self.pr_number,
            "pr_url": self.pr_url,
            "bot_comments": self.bot_comments,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> AutoFixState:
        issue_number = data["issue_number"]
        repo = data["repo"]
        # Construct issue_url if missing (for backwards compatibility with old state files)
        issue_url = (
            data.get("issue_url") or f"https://github.com/{repo}/issues/{issue_number}"
        )

        return cls(
            issue_number=issue_number,
            issue_url=issue_url,
            repo=repo,
            status=AutoFixStatus(data.get("status", "pending")),
            spec_id=data.get("spec_id"),
            spec_dir=data.get("spec_dir"),
            pr_number=data.get("pr_number"),
            pr_url=data.get("pr_url"),
            bot_comments=data.get("bot_comments", []),
            error=data.get("error"),
            created_at=data.get("created_at", _utc_now_iso()),
            updated_at=data.get("updated_at", _utc_now_iso()),
        )

    def update_status(self, status: AutoFixStatus) -> None:
        """Update status and timestamp with transition validation."""
        if not self.status.can_transition_to(status):
            raise ValueError(
                f"Invalid state transition: {self.status.value} -> {status.value}"
            )
        self.status = status
        self.updated_at = _utc_now_iso()

    async def save(self, github_dir: Path) -> None:
        """Save auto-fix state to .auto-claude/github/issues/ with file locking."""
        issues_dir = github_dir / "issues"
        issues_dir.mkdir(parents=True, exist_ok=True)

        autofix_file = issues_dir / f"autofix_{self.issue_number}.json"

        # Atomic locked write
        await locked_json_write(autofix_file, self.to_dict(), timeout=5.0)

        # Update index with locking
        await self._update_index(issues_dir)

    async def _update_index(self, issues_dir: Path) -> None:
        """Update the issues index with auto-fix queue using file locking."""
        index_file = issues_dir / "index.json"

        def update_index(current_data):
            """Update function for atomic index update."""
            if current_data is None:
                current_data = {
                    "triaged": [],
                    "auto_fix_queue": [],
                    "last_updated": None,
                }

            # Update auto-fix queue
            queue = current_data.get("auto_fix_queue", [])
            existing = next(
                (q for q in queue if q["issue_number"] == self.issue_number), None
            )

            entry = {
                "issue_number": self.issue_number,
                "repo": self.repo,
                "status": self.status.value,
                "spec_id": self.spec_id,
                "pr_number": self.pr_number,
                "updated_at": self.updated_at,
            }

            if existing:
                queue = [
                    entry if q["issue_number"] == self.issue_number else q
                    for q in queue
                ]
            else:
                queue.append(entry)

            current_data["auto_fix_queue"] = queue
            current_data["last_updated"] = _utc_now_iso()

            return current_data

        # Atomic locked update
        await locked_json_update(index_file, update_index, timeout=5.0)

    @classmethod
    def load(cls, github_dir: Path, issue_number: int) -> AutoFixState | None:
        """Load an auto-fix state from disk."""
        autofix_file = github_dir / "issues" / f"autofix_{issue_number}.json"
        if not autofix_file.exists():
            return None

        with open(autofix_file, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


@dataclass
class GitHubRunnerConfig:
    """Configuration for GitHub automation runners."""

    # Authentication
    token: str
    repo: str  # owner/repo format
    bot_token: str | None = None  # Separate bot account token

    # Auto-fix settings
    auto_fix_enabled: bool = False
    auto_fix_labels: list[str] = field(default_factory=lambda: ["auto-fix"])
    require_human_approval: bool = True

    # Permission settings
    auto_fix_allowed_roles: list[str] = field(
        default_factory=lambda: ["OWNER", "MEMBER", "COLLABORATOR"]
    )
    allow_external_contributors: bool = False

    # Triage settings
    triage_enabled: bool = False
    duplicate_threshold: float = 0.80
    spam_threshold: float = 0.75
    feature_creep_threshold: float = 0.70
    enable_triage_comments: bool = False

    # PR review settings
    pr_review_enabled: bool = False
    auto_post_reviews: bool = False
    allow_fix_commits: bool = True
    review_own_prs: bool = False  # Whether bot can review its own PRs
    use_parallel_orchestrator: bool = (
        True  # Use SDK subagent parallel orchestrator (default)
    )

    # Model settings
    # Note: Default uses shorthand "sonnet" which gets resolved via resolve_model_id()
    # to respect environment variable overrides (e.g., ANTHROPIC_DEFAULT_SONNET_MODEL)
    model: str = "sonnet"
    thinking_level: str = "medium"
    fast_mode: bool = False

    def to_dict(self) -> dict:
        return {
            "token": "***",  # Never save token
            "repo": self.repo,
            "bot_token": "***" if self.bot_token else None,
            "auto_fix_enabled": self.auto_fix_enabled,
            "auto_fix_labels": self.auto_fix_labels,
            "require_human_approval": self.require_human_approval,
            "auto_fix_allowed_roles": self.auto_fix_allowed_roles,
            "allow_external_contributors": self.allow_external_contributors,
            "triage_enabled": self.triage_enabled,
            "duplicate_threshold": self.duplicate_threshold,
            "spam_threshold": self.spam_threshold,
            "feature_creep_threshold": self.feature_creep_threshold,
            "enable_triage_comments": self.enable_triage_comments,
            "pr_review_enabled": self.pr_review_enabled,
            "review_own_prs": self.review_own_prs,
            "auto_post_reviews": self.auto_post_reviews,
            "allow_fix_commits": self.allow_fix_commits,
            "model": self.model,
            "thinking_level": self.thinking_level,
            "fast_mode": self.fast_mode,
        }

    def save_settings(self, github_dir: Path) -> None:
        """Save non-sensitive settings to config.json."""
        github_dir.mkdir(parents=True, exist_ok=True)
        config_file = github_dir / "config.json"

        # Save without tokens
        settings = self.to_dict()
        settings.pop("token", None)
        settings.pop("bot_token", None)

        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)

    @classmethod
    def load_settings(
        cls, github_dir: Path, token: str, repo: str, bot_token: str | None = None
    ) -> GitHubRunnerConfig:
        """Load settings from config.json, with tokens provided separately."""
        config_file = github_dir / "config.json"

        if config_file.exists():
            with open(config_file, encoding="utf-8") as f:
                settings = json.load(f)
        else:
            settings = {}

        return cls(
            token=token,
            repo=repo,
            bot_token=bot_token,
            auto_fix_enabled=settings.get("auto_fix_enabled", False),
            auto_fix_labels=settings.get("auto_fix_labels", ["auto-fix"]),
            require_human_approval=settings.get("require_human_approval", True),
            auto_fix_allowed_roles=settings.get(
                "auto_fix_allowed_roles", ["OWNER", "MEMBER", "COLLABORATOR"]
            ),
            allow_external_contributors=settings.get(
                "allow_external_contributors", False
            ),
            triage_enabled=settings.get("triage_enabled", False),
            duplicate_threshold=settings.get("duplicate_threshold", 0.80),
            spam_threshold=settings.get("spam_threshold", 0.75),
            feature_creep_threshold=settings.get("feature_creep_threshold", 0.70),
            enable_triage_comments=settings.get("enable_triage_comments", False),
            pr_review_enabled=settings.get("pr_review_enabled", False),
            review_own_prs=settings.get("review_own_prs", False),
            auto_post_reviews=settings.get("auto_post_reviews", False),
            allow_fix_commits=settings.get("allow_fix_commits", True),
            # Note: model is stored as shorthand and resolved via resolve_model_id()
            model=settings.get("model", "sonnet"),
            thinking_level=settings.get("thinking_level", "medium"),
        )

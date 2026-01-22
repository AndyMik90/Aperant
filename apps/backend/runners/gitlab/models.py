"""
GitLab Automation Data Models
=============================

Data structures for GitLab automation features.
Stored in .auto-claude/gitlab/mr/
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path


class ReviewSeverity(str, Enum):
    """Severity levels for MR review findings."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReviewCategory(str, Enum):
    """Categories for MR review findings."""

    SECURITY = "security"
    QUALITY = "quality"
    STYLE = "style"
    TEST = "test"
    DOCS = "docs"
    PATTERN = "pattern"
    PERFORMANCE = "performance"


class TriageCategory(str, Enum):
    """Issue triage categories."""

    BUG = "bug"
    FEATURE = "feature"
    DUPLICATE = "duplicate"
    QUESTION = "question"
    SPAM = "spam"
    INVALID = "invalid"
    WONTFIX = "wontfix"


class ReviewPass(str, Enum):
    """Multi-pass review stages."""

    QUICK_SCAN = "quick_scan"
    SECURITY = "security"
    QUALITY = "quality"
    DEEP_ANALYSIS = "deep_analysis"
    STRUCTURAL = "structural"
    AI_COMMENT_TRIAGE = "ai_comment_triage"


class MergeVerdict(str, Enum):
    """Clear verdict for whether MR can be merged."""

    READY_TO_MERGE = "ready_to_merge"
    MERGE_WITH_CHANGES = "merge_with_changes"
    NEEDS_REVISION = "needs_revision"
    BLOCKED = "blocked"


@dataclass
class TriageResult:
    """Result of issue triage."""

    issue_iid: int
    project: str
    category: TriageCategory
    confidence: float  # 0.0 to 1.0
    duplicate_of: int | None = None  # If duplicate, which issue
    reasoning: str = ""
    suggested_labels: list[str] = field(default_factory=list)
    suggested_response: str = ""

    def to_dict(self) -> dict:
        return {
            "issue_iid": self.issue_iid,
            "project": self.project,
            "category": self.category.value,
            "confidence": self.confidence,
            "duplicate_of": self.duplicate_of,
            "reasoning": self.reasoning,
            "suggested_labels": self.suggested_labels,
            "suggested_response": self.suggested_response,
        }

    @classmethod
    def from_dict(cls, data: dict) -> TriageResult:
        return cls(
            issue_iid=data["issue_iid"],
            project=data["project"],
            category=TriageCategory(data["category"]),
            confidence=data["confidence"],
            duplicate_of=data.get("duplicate_of"),
            reasoning=data.get("reasoning", ""),
            suggested_labels=data.get("suggested_labels", []),
            suggested_response=data.get("suggested_response", ""),
        )


@dataclass
class MRReviewFinding:
    """A single finding from an MR review."""

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
    # Evidence-based findings - code snippet proving the issue
    evidence_code: str | None = None
    # Pass that found this issue
    found_by_pass: ReviewPass | None = None

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
            "evidence_code": self.evidence_code,
            "found_by_pass": self.found_by_pass.value if self.found_by_pass else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> MRReviewFinding:
        found_by_pass = data.get("found_by_pass")
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
            evidence_code=data.get("evidence_code"),
            found_by_pass=ReviewPass(found_by_pass) if found_by_pass else None,
        )


@dataclass
class StructuralIssue:
    """A structural issue detected during review (feature creep, scope changes)."""

    id: str
    type: str  # "feature_creep", "scope_change", "missing_requirement", etc.
    title: str
    description: str
    severity: ReviewSeverity = ReviewSeverity.MEDIUM
    files_affected: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "description": self.description,
            "severity": self.severity.value,
            "files_affected": self.files_affected,
        }

    @classmethod
    def from_dict(cls, data: dict) -> StructuralIssue:
        return cls(
            id=data["id"],
            type=data["type"],
            title=data["title"],
            description=data["description"],
            severity=ReviewSeverity(data.get("severity", "medium")),
            files_affected=data.get("files_affected", []),
        )


@dataclass
class AICommentTriage:
    """Result of triaging another AI tool's comment."""

    comment_id: str
    tool_name: str  # "CodeRabbit", "Cursor", etc.
    original_comment: str
    triage_result: str  # "valid", "false_positive", "questionable", "addressed"
    reasoning: str
    file: str | None = None
    line: int | None = None

    def to_dict(self) -> dict:
        return {
            "comment_id": self.comment_id,
            "tool_name": self.tool_name,
            "original_comment": self.original_comment,
            "triage_result": self.triage_result,
            "reasoning": self.reasoning,
            "file": self.file,
            "line": self.line,
        }

    @classmethod
    def from_dict(cls, data: dict) -> AICommentTriage:
        return cls(
            comment_id=data["comment_id"],
            tool_name=data["tool_name"],
            original_comment=data["original_comment"],
            triage_result=data["triage_result"],
            reasoning=data["reasoning"],
            file=data.get("file"),
            line=data.get("line"),
        )


@dataclass
class MRReviewResult:
    """Complete result of an MR review."""

    mr_iid: int
    project: str
    success: bool
    findings: list[MRReviewFinding] = field(default_factory=list)
    summary: str = ""
    overall_status: str = "comment"  # approve, request_changes, comment
    reviewed_at: str = field(default_factory=lambda: datetime.now().isoformat())
    error: str | None = None

    # Verdict system
    verdict: MergeVerdict = MergeVerdict.READY_TO_MERGE
    verdict_reasoning: str = ""
    blockers: list[str] = field(default_factory=list)

    # Multi-pass review results
    structural_issues: list[StructuralIssue] = field(default_factory=list)
    ai_triages: list[AICommentTriage] = field(default_factory=list)

    # Follow-up review tracking
    reviewed_commit_sha: str | None = None
    reviewed_file_blobs: dict[str, str] = field(default_factory=dict)
    is_followup_review: bool = False
    previous_review_id: int | None = None
    resolved_findings: list[str] = field(default_factory=list)
    unresolved_findings: list[str] = field(default_factory=list)
    new_findings_since_last_review: list[str] = field(default_factory=list)

    # Posting tracking
    has_posted_findings: bool = False
    posted_finding_ids: list[str] = field(default_factory=list)

    # CI/CD status
    ci_status: str | None = None
    ci_pipeline_id: int | None = None

    def to_dict(self) -> dict:
        return {
            "mr_iid": self.mr_iid,
            "project": self.project,
            "success": self.success,
            "findings": [f.to_dict() for f in self.findings],
            "summary": self.summary,
            "overall_status": self.overall_status,
            "reviewed_at": self.reviewed_at,
            "error": self.error,
            "verdict": self.verdict.value,
            "verdict_reasoning": self.verdict_reasoning,
            "blockers": self.blockers,
            "structural_issues": [s.to_dict() for s in self.structural_issues],
            "ai_triages": [t.to_dict() for t in self.ai_triages],
            "reviewed_commit_sha": self.reviewed_commit_sha,
            "reviewed_file_blobs": self.reviewed_file_blobs,
            "is_followup_review": self.is_followup_review,
            "previous_review_id": self.previous_review_id,
            "resolved_findings": self.resolved_findings,
            "unresolved_findings": self.unresolved_findings,
            "new_findings_since_last_review": self.new_findings_since_last_review,
            "has_posted_findings": self.has_posted_findings,
            "posted_finding_ids": self.posted_finding_ids,
            "ci_status": self.ci_status,
            "ci_pipeline_id": self.ci_pipeline_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> MRReviewResult:
        return cls(
            mr_iid=data["mr_iid"],
            project=data["project"],
            success=data["success"],
            findings=[MRReviewFinding.from_dict(f) for f in data.get("findings", [])],
            summary=data.get("summary", ""),
            overall_status=data.get("overall_status", "comment"),
            reviewed_at=data.get("reviewed_at", datetime.now().isoformat()),
            error=data.get("error"),
            verdict=MergeVerdict(data.get("verdict", "ready_to_merge")),
            verdict_reasoning=data.get("verdict_reasoning", ""),
            blockers=data.get("blockers", []),
            structural_issues=[
                StructuralIssue.from_dict(s) for s in data.get("structural_issues", [])
            ],
            ai_triages=[
                AICommentTriage.from_dict(t) for t in data.get("ai_triages", [])
            ],
            reviewed_commit_sha=data.get("reviewed_commit_sha"),
            reviewed_file_blobs=data.get("reviewed_file_blobs", {}),
            is_followup_review=data.get("is_followup_review", False),
            previous_review_id=data.get("previous_review_id"),
            resolved_findings=data.get("resolved_findings", []),
            unresolved_findings=data.get("unresolved_findings", []),
            new_findings_since_last_review=data.get(
                "new_findings_since_last_review", []
            ),
            has_posted_findings=data.get("has_posted_findings", False),
            posted_finding_ids=data.get("posted_finding_ids", []),
            ci_status=data.get("ci_status"),
            ci_pipeline_id=data.get("ci_pipeline_id"),
        )

    def save(self, gitlab_dir: Path) -> None:
        """Save review result to .auto-claude/gitlab/mr/"""
        mr_dir = gitlab_dir / "mr"
        mr_dir.mkdir(parents=True, exist_ok=True)

        review_file = mr_dir / f"review_{self.mr_iid}.json"
        with open(review_file, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, gitlab_dir: Path, mr_iid: int) -> MRReviewResult | None:
        """Load a review result from disk."""
        review_file = gitlab_dir / "mr" / f"review_{mr_iid}.json"
        if not review_file.exists():
            return None

        with open(review_file, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


@dataclass
class GitLabRunnerConfig:
    """Configuration for GitLab automation runners."""

    # Authentication
    token: str
    project: str  # namespace/project format
    instance_url: str = "https://gitlab.com"

    # Model settings
    model: str = "claude-sonnet-4-5-20250929"
    thinking_level: str = "medium"

    # Auto-fix settings
    auto_fix_enabled: bool = False
    auto_fix_labels: list[str] = field(default_factory=lambda: ["auto-fix", "autofix"])

    def to_dict(self) -> dict:
        return {
            "token": "***",  # Never save token
            "project": self.project,
            "instance_url": self.instance_url,
            "model": self.model,
            "thinking_level": self.thinking_level,
            "auto_fix_enabled": self.auto_fix_enabled,
            "auto_fix_labels": self.auto_fix_labels,
        }


@dataclass
class MRContext:
    """Context for an MR review."""

    mr_iid: int
    title: str
    description: str
    author: str
    source_branch: str
    target_branch: str
    state: str
    changed_files: list[dict] = field(default_factory=list)
    diff: str = ""
    total_additions: int = 0
    total_deletions: int = 0
    commits: list[dict] = field(default_factory=list)
    head_sha: str | None = None
    repo_structure: str = ""  # Description of monorepo layout
    related_files: list[str] = field(default_factory=list)  # Imports, tests, configs
    # CI/CD pipeline status
    ci_status: str | None = None
    ci_pipeline_id: int | None = None


@dataclass
class FollowupMRContext:
    """Context for a follow-up MR review."""

    mr_iid: int
    previous_review: MRReviewResult
    previous_commit_sha: str
    current_commit_sha: str

    # Changes since last review
    commits_since_review: list[dict] = field(default_factory=list)
    files_changed_since_review: list[str] = field(default_factory=list)
    diff_since_review: str = ""


# -------------------------------------------------------------------------
# Auto-Fix Models
# -------------------------------------------------------------------------


class AutoFixStatus(str, Enum):
    """Status for auto-fix operations."""

    # Initial states
    PENDING = "pending"
    ANALYZING = "analyzing"

    # Spec creation states
    CREATING_SPEC = "creating_spec"
    WAITING_APPROVAL = "waiting_approval"  # Human review gate

    # Build states
    BUILDING = "building"
    QA_REVIEW = "qa_review"

    # MR states
    MR_CREATED = "mr_created"
    MERGE_CONFLICT = "merge_conflict"  # Conflict resolution needed

    # Terminal states
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"  # User cancelled

    # Special states
    STALE = "stale"  # Issue updated after spec creation
    RATE_LIMITED = "rate_limited"  # Waiting for rate limit reset

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
            cls.WAITING_APPROVAL,
            cls.MR_CREATED,
        }

    def can_transition_to(self, new_state: AutoFixStatus) -> bool:
        """Check if state transition is valid."""
        # Define valid transitions
        transitions = {
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
                AutoFixStatus.MR_CREATED,
                AutoFixStatus.FAILED,
                AutoFixStatus.MERGE_CONFLICT,
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.QA_REVIEW: {
                AutoFixStatus.MR_CREATED,
                AutoFixStatus.BUILDING,
                AutoFixStatus.COMPLETED,
                AutoFixStatus.FAILED,
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.MR_CREATED: {
                AutoFixStatus.COMPLETED,
                AutoFixStatus.MERGE_CONFLICT,
                AutoFixStatus.FAILED,
                AutoFixStatus.CANCELLED,
            },
            # Recoverable states
            AutoFixStatus.FAILED: {
                AutoFixStatus.ANALYZING,
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.STALE: {
                AutoFixStatus.ANALYZING,
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.RATE_LIMITED: {
                AutoFixStatus.PENDING,
                AutoFixStatus.CANCELLED,
            },
            AutoFixStatus.MERGE_CONFLICT: {
                AutoFixStatus.BUILDING,
                AutoFixStatus.CANCELLED,
            },
        }
        return new_state in transitions.get(self, set())


@dataclass
class AutoFixState:
    """State tracking for auto-fix operations."""

    issue_iid: int
    issue_url: str
    project: str
    status: AutoFixStatus = AutoFixStatus.PENDING
    spec_id: str | None = None
    spec_dir: str | None = None
    mr_iid: int | None = None  # GitLab MR IID (not database ID)
    mr_url: str | None = None
    bot_comments: list[str] = field(default_factory=list)
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> dict:
        return {
            "issue_iid": self.issue_iid,
            "issue_url": self.issue_url,
            "project": self.project,
            "status": self.status.value,
            "spec_id": self.spec_id,
            "spec_dir": self.spec_dir,
            "mr_iid": self.mr_iid,
            "mr_url": self.mr_url,
            "bot_comments": self.bot_comments,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> AutoFixState:
        issue_iid = data["issue_iid"]
        project = data["project"]
        # Construct issue_url if missing (for backwards compatibility)
        issue_url = (
            data.get("issue_url")
            or f"https://gitlab.com/{project}/-/issues/{issue_iid}"
        )

        return cls(
            issue_iid=issue_iid,
            issue_url=issue_url,
            project=project,
            status=AutoFixStatus(data.get("status", "pending")),
            spec_id=data.get("spec_id"),
            spec_dir=data.get("spec_dir"),
            mr_iid=data.get("mr_iid"),
            mr_url=data.get("mr_url"),
            bot_comments=data.get("bot_comments", []),
            error=data.get("error"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
        )

    def update_status(self, status: AutoFixStatus) -> None:
        """Update status and timestamp with transition validation."""
        if not self.status.can_transition_to(status):
            raise ValueError(
                f"Invalid state transition: {self.status.value} -> {status.value}"
            )
        self.status = status
        self.updated_at = datetime.now().isoformat()

    async def save(self, gitlab_dir: Path) -> None:
        """Save auto-fix state to .auto-claude/gitlab/issues/ with file locking."""
        try:
            from .utils.file_lock import atomic_write
        except ImportError:
            from runners.gitlab.utils.file_lock import atomic_write

        issues_dir = gitlab_dir / "issues"
        issues_dir.mkdir(parents=True, exist_ok=True)

        autofix_file = issues_dir / f"autofix_{self.issue_iid}.json"

        # Atomic write
        with atomic_write(autofix_file, encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, gitlab_dir: Path, issue_iid: int) -> AutoFixState | None:
        """Load auto-fix state from disk."""
        autofix_file = gitlab_dir / "issues" / f"autofix_{issue_iid}.json"
        if not autofix_file.exists():
            return None

        with open(autofix_file, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))

    @classmethod
    async def load_async(cls, gitlab_dir: Path, issue_iid: int) -> AutoFixState | None:
        """Async wrapper for loading state."""
        return cls.load(gitlab_dir, issue_iid)

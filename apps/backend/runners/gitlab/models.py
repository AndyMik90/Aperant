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


class ReviewPass(str, Enum):
    """Multi-pass review stages."""

    QUICK_SCAN = "quick_scan"
    SECURITY = "security"
    QUALITY = "quality"
    DEEP_ANALYSIS = "deep_analysis"


class MergeVerdict(str, Enum):
    """Clear verdict for whether MR can be merged."""

    READY_TO_MERGE = "ready_to_merge"
    MERGE_WITH_CHANGES = "merge_with_changes"
    NEEDS_REVISION = "needs_revision"
    BLOCKED = "blocked"


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
        }

    @classmethod
    def from_dict(cls, data: dict) -> MRReviewFinding:
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

    # Follow-up review tracking
    reviewed_commit_sha: str | None = None
    is_followup_review: bool = False
    previous_review_id: int | None = None
    resolved_findings: list[str] = field(default_factory=list)
    unresolved_findings: list[str] = field(default_factory=list)
    new_findings_since_last_review: list[str] = field(default_factory=list)

    # Posting tracking
    has_posted_findings: bool = False
    posted_finding_ids: list[str] = field(default_factory=list)

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
            "reviewed_commit_sha": self.reviewed_commit_sha,
            "is_followup_review": self.is_followup_review,
            "previous_review_id": self.previous_review_id,
            "resolved_findings": self.resolved_findings,
            "unresolved_findings": self.unresolved_findings,
            "new_findings_since_last_review": self.new_findings_since_last_review,
            "has_posted_findings": self.has_posted_findings,
            "posted_finding_ids": self.posted_finding_ids,
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
            reviewed_commit_sha=data.get("reviewed_commit_sha"),
            is_followup_review=data.get("is_followup_review", False),
            previous_review_id=data.get("previous_review_id"),
            resolved_findings=data.get("resolved_findings", []),
            unresolved_findings=data.get("unresolved_findings", []),
            new_findings_since_last_review=data.get(
                "new_findings_since_last_review", []
            ),
            has_posted_findings=data.get("has_posted_findings", False),
            posted_finding_ids=data.get("posted_finding_ids", []),
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
    fast_mode: bool = False

    def to_dict(self) -> dict:
        return {
            "token": "***",  # Never save token
            "project": self.project,
            "instance_url": self.instance_url,
            "model": self.model,
            "thinking_level": self.thinking_level,
            "fast_mode": self.fast_mode,
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

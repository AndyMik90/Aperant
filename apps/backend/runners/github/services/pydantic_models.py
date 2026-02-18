"""
Pydantic Models for Structured AI Outputs
==========================================

These models define JSON schemas for Claude Agent SDK structured outputs.
Used to guarantee valid, validated JSON from AI responses in PR reviews.

Usage:
    from claude_agent_sdk import query
    from .pydantic_models import FollowupReviewResponse

    async for message in query(
        prompt="...",
        options={
            "output_format": {
                "type": "json_schema",
                "schema": FollowupReviewResponse.model_json_schema()
            }
        }
    ):
        if hasattr(message, 'structured_output'):
            result = FollowupReviewResponse.model_validate(message.structured_output)
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# =============================================================================
# Verification Evidence (Optional for findings — only code_examined is consumed)
# =============================================================================


class VerificationEvidence(BaseModel):
    """Evidence that a finding was verified against actual code."""

    code_examined: str = Field(
        description="Code snippet that was examined to verify the finding",
    )
    line_range_examined: list[int] = Field(
        default_factory=list,
        description="Start and end line numbers [start, end] of the examined code",
    )
    verification_method: str = Field(
        default="direct_code_inspection",
        description="How the issue was verified (e.g. direct_code_inspection, cross_file_trace, test_verification)",
    )


# =============================================================================
# Severity / Category Validators
# =============================================================================

_VALID_SEVERITIES = {"critical", "high", "medium", "low"}


def _normalize_severity(v: str) -> str:
    """Normalize severity to a valid value, defaulting to 'medium'."""
    if isinstance(v, str):
        v = v.lower().strip()
    if v not in _VALID_SEVERITIES:
        return "medium"
    return v


def _normalize_category(v: str, valid_set: set[str], default: str = "quality") -> str:
    """Normalize category to a valid value, defaulting to given default."""
    if isinstance(v, str):
        v = v.lower().strip().replace("-", "_")
    if v not in valid_set:
        return default
    return v


# =============================================================================
# Follow-up Review Response
# =============================================================================


class FindingResolution(BaseModel):
    """Resolution status for a previous finding."""

    finding_id: str = Field(description="ID of the previous finding")
    status: Literal["resolved", "unresolved"] = Field(description="Resolution status")
    resolution_notes: str | None = Field(
        None, description="Notes on how it was resolved"
    )


_FOLLOWUP_CATEGORIES = {"security", "quality", "logic", "test", "docs"}


class FollowupFinding(BaseModel):
    """A new finding from follow-up review (simpler than initial review).

    verification is intentionally omitted — not consumed by followup_reviewer.py.
    """

    id: str = Field(description="Unique identifier for this finding")
    severity: str = Field(description="Issue severity level")
    category: str = Field(description="Issue category")
    title: str = Field(description="Brief issue title")
    description: str = Field(description="Detailed explanation of the issue")
    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    suggested_fix: str | None = Field(None, description="How to fix this issue")
    fixable: bool = Field(False, description="Whether this can be auto-fixed")

    @field_validator("severity", mode="before")
    @classmethod
    def _normalize_severity(cls, v: str) -> str:
        return _normalize_severity(v)

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v: str) -> str:
        return _normalize_category(v, _FOLLOWUP_CATEGORIES)


class FollowupReviewResponse(BaseModel):
    """Complete response schema for follow-up PR review."""

    finding_resolutions: list[FindingResolution] = Field(
        default_factory=list, description="Status of each previous finding"
    )
    new_findings: list[FollowupFinding] = Field(
        default_factory=list,
        description="New issues found in changes since last review",
    )
    comment_findings: list[FollowupFinding] = Field(
        default_factory=list, description="Issues found in contributor comments"
    )
    verdict: Literal[
        "READY_TO_MERGE", "MERGE_WITH_CHANGES", "NEEDS_REVISION", "BLOCKED"
    ] = Field(description="Overall merge verdict")
    verdict_reasoning: str = Field(description="Explanation for the verdict")


# =============================================================================
# Issue Triage Response
# =============================================================================


class IssueTriageResponse(BaseModel):
    """Response for issue triage."""

    category: Literal[
        "bug",
        "feature",
        "documentation",
        "question",
        "duplicate",
        "spam",
        "feature_creep",
    ] = Field(description="Issue category")
    confidence: float = Field(
        ge=0.0, le=1.0, description="Confidence in the categorization (0.0-1.0)"
    )
    priority: Literal["high", "medium", "low"] = Field(description="Issue priority")
    labels_to_add: list[str] = Field(
        default_factory=list, description="Labels to add to the issue"
    )
    labels_to_remove: list[str] = Field(
        default_factory=list, description="Labels to remove from the issue"
    )
    is_duplicate: bool = Field(False, description="Whether this is a duplicate issue")
    duplicate_of: int | None = Field(
        None, description="Issue number this duplicates (if duplicate)"
    )
    is_spam: bool = Field(False, description="Whether this is spam")
    is_feature_creep: bool = Field(
        False, description="Whether this bundles multiple unrelated features"
    )
    suggested_breakdown: list[str] = Field(
        default_factory=list,
        description="Suggested breakdown if feature creep detected",
    )
    comment: str | None = Field(None, description="Optional bot comment to post")


# =============================================================================
# Parallel Orchestrator Review Response (SDK Subagents)
# =============================================================================

_ORCHESTRATOR_CATEGORIES = {
    "security",
    "quality",
    "logic",
    "codebase_fit",
    "test",
    "docs",
    "redundancy",
    "pattern",
    "performance",
}


class ParallelOrchestratorFinding(BaseModel):
    """A finding from the parallel orchestrator with source agent tracking."""

    id: str = Field(description="Unique identifier for this finding")
    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    end_line: int | None = Field(None, description="End line for multi-line issues")
    title: str = Field(description="Brief issue title (max 80 chars)")
    description: str = Field(description="Detailed explanation of the issue")
    category: str = Field(description="Issue category")
    severity: str = Field(description="Issue severity level")
    verification: VerificationEvidence | None = Field(
        None,
        description="Evidence that this finding was verified against actual code",
    )
    is_impact_finding: bool = Field(
        False,
        description=(
            "True if this finding is about impact on OTHER files (not the changed file). "
            "Impact findings may reference files outside the PR's changed files list."
        ),
    )
    checked_for_handling_elsewhere: bool = Field(
        False,
        description=(
            "For 'missing X' claims (missing error handling, missing validation, etc.), "
            "True if the agent verified X is not handled elsewhere in the codebase. "
            "False if this is a 'missing X' claim but other locations were not checked."
        ),
    )
    suggested_fix: str | None = Field(None, description="How to fix this issue")
    fixable: bool = Field(False, description="Whether this can be auto-fixed")
    source_agents: list[str] = Field(
        default_factory=list,
        description="Which agents reported this finding",
    )
    cross_validated: bool = Field(
        False, description="Whether multiple agents agreed on this finding"
    )

    @field_validator("severity", mode="before")
    @classmethod
    def _normalize_severity(cls, v: str) -> str:
        return _normalize_severity(v)

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v: str) -> str:
        return _normalize_category(v, _ORCHESTRATOR_CATEGORIES)


class AgentAgreement(BaseModel):
    """Tracks agreement between agents on findings."""

    agreed_findings: list[str] = Field(
        default_factory=list,
        description="Finding IDs that multiple agents agreed on",
    )
    conflicting_findings: list[str] = Field(
        default_factory=list,
        description="Finding IDs where agents disagreed",
    )
    resolution_notes: str | None = Field(
        None, description="Notes on how conflicts were resolved"
    )


class DismissedFinding(BaseModel):
    """A finding that was validated and dismissed as a false positive.

    Included in output for transparency - users can see what was investigated and why it was dismissed.
    """

    id: str = Field(description="Original finding ID")
    original_title: str = Field(description="Original finding title")
    original_severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Original severity assigned by specialist"
    )
    original_file: str = Field(description="File where issue was claimed")
    original_line: int = Field(0, description="Line where issue was claimed")
    dismissal_reason: str = Field(
        description="Why this finding was dismissed as a false positive"
    )
    validation_evidence: str = Field(
        description="Actual code examined that disproved the finding"
    )


class ValidationSummary(BaseModel):
    """Summary of validation results for transparency."""

    total_findings_from_specialists: int = Field(
        description="Total findings reported by all specialist agents"
    )
    confirmed_valid: int = Field(
        description="Findings confirmed as real issues by validator"
    )
    dismissed_false_positive: int = Field(
        description="Findings dismissed as false positives by validator"
    )
    needs_human_review: int = Field(
        0, description="Findings that couldn't be definitively validated"
    )


_SPECIALIST_CATEGORIES = {
    "security",
    "quality",
    "logic",
    "performance",
    "pattern",
    "test",
    "docs",
}


class SpecialistFinding(BaseModel):
    """A finding from a specialist agent (used in parallel SDK sessions)."""

    severity: str = Field(description="Issue severity level")
    category: str = Field(description="Issue category")
    title: str = Field(description="Brief issue title (max 80 chars)")
    description: str = Field(description="Detailed explanation of the issue")
    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    end_line: int | None = Field(None, description="End line number if multi-line")
    suggested_fix: str | None = Field(None, description="How to fix this issue")
    evidence: str = Field(
        default="",
        description="Actual code snippet examined that shows the issue.",
    )
    is_impact_finding: bool = Field(
        False,
        description="True if this is about affected code outside the PR (callers, dependencies)",
    )

    @field_validator("severity", mode="before")
    @classmethod
    def _normalize_severity(cls, v: str) -> str:
        return _normalize_severity(v)

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v: str) -> str:
        return _normalize_category(v, _SPECIALIST_CATEGORIES)


class SpecialistResponse(BaseModel):
    """Response schema for individual specialist agent (parallel SDK sessions).

    Used when each specialist runs as its own SDK session rather than via Task tool.
    """

    specialist_name: str = Field(
        description="Name of the specialist (security, quality, logic, codebase-fit)"
    )
    analysis_summary: str = Field(description="Brief summary of what was analyzed")
    files_examined: list[str] = Field(
        default_factory=list,
        description="List of files that were examined",
    )
    findings: list[SpecialistFinding] = Field(
        default_factory=list,
        description="Issues found during analysis",
    )


class ParallelOrchestratorResponse(BaseModel):
    """Complete response schema for parallel orchestrator PR review."""

    analysis_summary: str = Field(
        description="Brief summary of what was analyzed and why agents were chosen"
    )
    agents_invoked: list[str] = Field(
        default_factory=list,
        description="List of agent names that were invoked",
    )
    validation_summary: ValidationSummary | None = Field(
        None,
        description="Summary of validation results (total, confirmed, dismissed, needs_review)",
    )
    findings: list[ParallelOrchestratorFinding] = Field(
        default_factory=list,
        description="Validated findings only (confirmed_valid or needs_human_review)",
    )
    dismissed_findings: list[DismissedFinding] = Field(
        default_factory=list,
        description=(
            "Findings that were validated and dismissed as false positives. "
            "Included for transparency - users can see what was investigated."
        ),
    )
    agent_agreement: AgentAgreement = Field(
        default_factory=AgentAgreement,
        description="Information about agent agreement on findings",
    )
    verdict: Literal["APPROVE", "COMMENT", "NEEDS_REVISION", "BLOCKED"] = Field(
        description="Overall PR verdict"
    )
    verdict_reasoning: str = Field(description="Explanation for the verdict")


# =============================================================================
# Parallel Follow-up Review Response (SDK Subagents for Follow-up)
# =============================================================================


class ResolutionVerification(BaseModel):
    """AI-verified resolution status for a previous finding."""

    finding_id: str = Field(description="ID of the previous finding")
    status: Literal["resolved", "partially_resolved", "unresolved", "cant_verify"] = (
        Field(description="Resolution status after AI verification")
    )
    evidence: str = Field(
        description="Code snippet or explanation showing the resolution status",
    )


_PARALLEL_FOLLOWUP_CATEGORIES = {
    "security",
    "quality",
    "logic",
    "test",
    "docs",
    "regression",
    "incomplete_fix",
}


class ParallelFollowupFinding(BaseModel):
    """A finding from parallel follow-up review."""

    id: str = Field(description="Unique identifier for this finding")
    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    title: str = Field(description="Brief issue title")
    description: str = Field(description="Detailed explanation of the issue")
    category: str = Field(description="Issue category")
    severity: str = Field(description="Issue severity level")
    suggested_fix: str | None = Field(None, description="How to fix this issue")
    fixable: bool = Field(False, description="Whether this can be auto-fixed")
    is_impact_finding: bool = Field(
        False,
        description="True if this finding is about impact on OTHER files outside the PR diff",
    )

    @field_validator("severity", mode="before")
    @classmethod
    def _normalize_severity(cls, v: str) -> str:
        return _normalize_severity(v)

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v: str) -> str:
        return _normalize_category(v, _PARALLEL_FOLLOWUP_CATEGORIES)


class ParallelFollowupResponse(BaseModel):
    """Complete response schema for parallel follow-up PR review.

    Simplified schema — only fields that are consumed downstream are included.
    Removing unused fields reduces schema size and validation failure rate.
    """

    agents_invoked: list[str] = Field(
        default_factory=list,
        description="List of agent names that were invoked",
    )

    resolution_verifications: list[ResolutionVerification] = Field(
        default_factory=list,
        description="Resolution status for each previous finding",
    )

    finding_validations: list[FindingValidationResult] = Field(
        default_factory=list,
        description="Re-investigation results for unresolved findings",
    )

    new_findings: list[ParallelFollowupFinding] = Field(
        default_factory=list,
        description="New issues found in changes since last review",
    )

    comment_findings: list[ParallelFollowupFinding] = Field(
        default_factory=list,
        description="Issues identified from comment analysis",
    )

    verdict: Literal[
        "READY_TO_MERGE", "MERGE_WITH_CHANGES", "NEEDS_REVISION", "BLOCKED"
    ] = Field(description="Overall merge verdict")
    verdict_reasoning: str = Field(description="Explanation for the verdict")


# =============================================================================
# Finding Validation Response (Re-investigation of unresolved findings)
# =============================================================================


class FindingValidationResult(BaseModel):
    """Result of re-investigating an unresolved finding to determine if it's real."""

    finding_id: str = Field(description="ID of the finding being validated")
    validation_status: Literal[
        "confirmed_valid", "dismissed_false_positive", "needs_human_review"
    ] = Field(description="Whether the finding is real, a false positive, or unclear")
    code_evidence: str = Field(
        description="Code snippet examined that supports the validation status",
    )
    explanation: str = Field(
        description="Why this finding was confirmed, dismissed, or flagged for human review",
    )


class FindingValidationResponse(BaseModel):
    """Complete response from the finding-validator agent."""

    validations: list[FindingValidationResult] = Field(
        default_factory=list,
        description="Validation results for each finding investigated",
    )
    summary: str = Field(
        description=(
            "Brief summary of validation results: how many confirmed, "
            "how many dismissed, how many need human review"
        )
    )


# =============================================================================
# Minimal Extraction Schema (Fallback for structured output validation failure)
# =============================================================================


class ExtractedFindingSummary(BaseModel):
    """Per-finding summary with file location for extraction recovery."""

    severity: str = Field(description="Severity level: LOW, MEDIUM, HIGH, or CRITICAL")
    description: str = Field(description="One-line description of the finding")
    file: str = Field(
        default="unknown", description="File path where the issue was found"
    )
    line: int = Field(default=0, description="Line number in the file (0 if unknown)")

    @field_validator("severity", mode="before")
    @classmethod
    def _normalize_severity(cls, v: str) -> str:
        return _normalize_severity(v)


class FollowupExtractionResponse(BaseModel):
    """Minimal extraction schema for recovering data when full structured output fails.

    Uses ExtractedFindingSummary for new findings to preserve file/line information.
    Used as an intermediate recovery step before falling back to raw text parsing.
    """

    verdict: Literal[
        "READY_TO_MERGE", "MERGE_WITH_CHANGES", "NEEDS_REVISION", "BLOCKED"
    ] = Field(description="Overall merge verdict")
    verdict_reasoning: str = Field(description="Explanation for the verdict")
    resolved_finding_ids: list[str] = Field(
        default_factory=list,
        description="IDs of previous findings that are now resolved",
    )
    unresolved_finding_ids: list[str] = Field(
        default_factory=list,
        description="IDs of previous findings that remain unresolved",
    )
    new_finding_summaries: list[ExtractedFindingSummary] = Field(
        default_factory=list,
        description="Structured summary of each new finding with file location",
    )
    confirmed_finding_count: int = Field(
        0, description="Number of findings confirmed as valid"
    )
    dismissed_finding_count: int = Field(
        0, description="Number of findings dismissed as false positives"
    )

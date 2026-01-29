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

from pydantic import BaseModel, Field

# =============================================================================
# Verification Evidence (Required for All Findings)
# =============================================================================


class VerificationEvidence(BaseModel):
    """Evidence that a finding was verified against actual code.

    All fields are required - schema enforcement guarantees evidence exists.
    This shifts quality control from programmatic filters to schema enforcement.
    """

    code_examined: str = Field(
        min_length=1,
        description=(
            "REQUIRED: Exact code snippet that was examined. "
            "Must be actual code from the file, not a description of code. "
            "Copy-paste the relevant lines directly."
        ),
    )
    line_range_examined: list[int] = Field(
        min_length=2,
        max_length=2,
        description=(
            "Start and end line numbers [start, end] of the examined code. "
            "Must match the code in code_examined."
        ),
    )
    verification_method: Literal[
        "direct_code_inspection",
        "cross_file_trace",
        "test_verification",
        "dependency_analysis",
    ] = Field(
        description=(
            "How the issue was verified: "
            "direct_code_inspection = found issue directly in the code shown; "
            "cross_file_trace = traced through imports/calls to find the issue; "
            "test_verification = verified through examination of test code; "
            "dependency_analysis = verified through analyzing dependencies"
        )
    )


# =============================================================================
# Common Finding Types
# =============================================================================


class BaseFinding(BaseModel):
    """Base class for all finding types."""

    id: str = Field(description="Unique identifier for this finding")
    severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Issue severity level"
    )
    title: str = Field(description="Brief issue title (max 80 chars)")
    description: str = Field(description="Detailed explanation of the issue")
    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    suggested_fix: str | None = Field(None, description="How to fix this issue")
    fixable: bool = Field(False, description="Whether this can be auto-fixed")
    evidence: str | None = Field(
        None,
        description="DEPRECATED: Use verification.code_examined instead. Will be removed in Phase 5.",
    )
    verification: VerificationEvidence = Field(
        description="Evidence that this finding was verified against actual code"
    )


class SecurityFinding(BaseFinding):
    """A security vulnerability finding."""

    category: Literal["security"] = Field(
        default="security", description="Always 'security' for security findings"
    )


class QualityFinding(BaseFinding):
    """A code quality or redundancy finding."""

    category: Literal[
        "redundancy", "quality", "test", "performance", "pattern", "docs"
    ] = Field(description="Issue category")
    redundant_with: str | None = Field(
        None, description="Reference to duplicate code (file:line) if redundant"
    )


class DeepAnalysisFinding(BaseFinding):
    """A finding from deep analysis with verification info."""

    category: Literal[
        "verification_failed",
        "redundancy",
        "quality",
        "pattern",
        "performance",
        "logic",
    ] = Field(description="Issue category")
    verification_note: str | None = Field(
        None, description="What evidence is missing or couldn't be verified"
    )


class StructuralIssue(BaseModel):
    """A structural issue with the PR."""

    id: str = Field(description="Unique identifier")
    issue_type: Literal[
        "feature_creep", "scope_creep", "architecture_violation", "poor_structure"
    ] = Field(description="Type of structural issue")
    severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Issue severity"
    )
    title: str = Field(description="Brief issue title")
    description: str = Field(description="Detailed explanation")
    impact: str = Field(description="Why this matters")
    suggestion: str = Field(description="How to fix")


class AICommentTriage(BaseModel):
    """Triage result for an AI tool comment."""

    comment_id: int = Field(description="GitHub comment ID")
    tool_name: str = Field(
        description="AI tool name (CodeRabbit, Cursor, Greptile, etc.)"
    )
    verdict: Literal[
        "critical",
        "important",
        "nice_to_have",
        "trivial",
        "addressed",
        "false_positive",
    ] = Field(description="Verdict on the comment")
    reasoning: str = Field(description="Why this verdict was chosen")
    response_comment: str | None = Field(
        None, description="Optional comment to post in reply"
    )


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


class FollowupFinding(BaseModel):
    """A new finding from follow-up review (simpler than initial review)."""

    id: str = Field(description="Unique identifier for this finding")
    severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Issue severity level"
    )
    category: Literal["security", "quality", "logic", "test", "docs"] = Field(
        description="Issue category"
    )
    title: str = Field(description="Brief issue title")
    description: str = Field(description="Detailed explanation of the issue")
    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    suggested_fix: str | None = Field(None, description="How to fix this issue")
    fixable: bool = Field(False, description="Whether this can be auto-fixed")
    verification: VerificationEvidence = Field(
        description="Evidence that this finding was verified against actual code"
    )


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
# Initial Review Responses (Multi-Pass)
# =============================================================================


class QuickScanResult(BaseModel):
    """Result from the quick scan pass."""

    purpose: str = Field(description="Brief description of what the PR claims to do")
    actual_changes: str = Field(
        description="Brief description of what the code actually does"
    )
    purpose_match: bool = Field(
        description="Whether actual changes match the claimed purpose"
    )
    purpose_match_note: str | None = Field(
        None, description="Explanation if purpose doesn't match actual changes"
    )
    risk_areas: list[str] = Field(
        default_factory=list, description="Areas needing careful review"
    )
    red_flags: list[str] = Field(
        default_factory=list, description="Obvious issues or concerns"
    )
    requires_deep_verification: bool = Field(
        description="Whether deep verification is needed"
    )
    complexity: Literal["low", "medium", "high"] = Field(description="PR complexity")


class SecurityPassResult(BaseModel):
    """Result from the security pass - array of security findings."""

    findings: list[SecurityFinding] = Field(
        default_factory=list, description="Security vulnerabilities found"
    )


class QualityPassResult(BaseModel):
    """Result from the quality pass - array of quality findings."""

    findings: list[QualityFinding] = Field(
        default_factory=list, description="Quality and redundancy issues found"
    )


class DeepAnalysisResult(BaseModel):
    """Result from the deep analysis pass."""

    findings: list[DeepAnalysisFinding] = Field(
        default_factory=list,
        description="Deep analysis findings with verification info",
    )


class StructuralPassResult(BaseModel):
    """Result from the structural pass."""

    issues: list[StructuralIssue] = Field(
        default_factory=list, description="Structural issues found"
    )
    verdict: Literal[
        "READY_TO_MERGE", "MERGE_WITH_CHANGES", "NEEDS_REVISION", "BLOCKED"
    ] = Field(description="Structural verdict")
    verdict_reasoning: str = Field(description="Explanation for the verdict")


class AICommentTriageResult(BaseModel):
    """Result from AI comment triage pass."""

    triages: list[AICommentTriage] = Field(
        default_factory=list, description="Triage results for each AI comment"
    )


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
# Orchestrator Review Response
# =============================================================================


class OrchestratorFinding(BaseModel):
    """A finding from the orchestrator review."""

    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    title: str = Field(description="Brief issue title")
    description: str = Field(description="Detailed explanation of the issue")
    category: Literal[
        "security",
        "quality",
        "style",
        "docs",
        "redundancy",
        "verification_failed",
        "pattern",
        "performance",
        "logic",
        "test",
    ] = Field(description="Issue category")
    severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Issue severity level"
    )
    suggestion: str | None = Field(None, description="How to fix this issue")
    evidence: str | None = Field(
        None,
        description="DEPRECATED: Use verification.code_examined instead. Will be removed in Phase 5.",
    )
    verification: VerificationEvidence = Field(
        description="Evidence that this finding was verified against actual code"
    )


class OrchestratorReviewResponse(BaseModel):
    """Complete response schema for orchestrator PR review."""

    verdict: Literal[
        "READY_TO_MERGE", "MERGE_WITH_CHANGES", "NEEDS_REVISION", "BLOCKED"
    ] = Field(description="Overall merge verdict")
    verdict_reasoning: str = Field(description="Explanation for the verdict")
    findings: list[OrchestratorFinding] = Field(
        default_factory=list, description="Issues found during review"
    )
    summary: str = Field(description="Brief summary of the review")


# =============================================================================
# Parallel Orchestrator Review Response (SDK Subagents)
# =============================================================================


class LogicFinding(BaseFinding):
    """A logic/correctness finding from the logic review agent."""

    category: Literal["logic"] = Field(
        default="logic", description="Always 'logic' for logic findings"
    )
    example_input: str | None = Field(
        None, description="Concrete input that triggers the bug"
    )
    actual_output: str | None = Field(None, description="What the buggy code produces")
    expected_output: str | None = Field(
        None, description="What the code should produce"
    )


class CodebaseFitFinding(BaseFinding):
    """A codebase fit finding from the codebase fit review agent."""

    category: Literal["codebase_fit"] = Field(
        default="codebase_fit", description="Always 'codebase_fit' for fit findings"
    )
    existing_code: str | None = Field(
        None, description="Reference to existing code that should be used instead"
    )
    codebase_pattern: str | None = Field(
        None, description="Description of the established pattern being violated"
    )


class ParallelOrchestratorFinding(BaseModel):
    """A finding from the parallel orchestrator with source agent tracking."""

    id: str = Field(description="Unique identifier for this finding")
    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    end_line: int | None = Field(None, description="End line for multi-line issues")
    title: str = Field(description="Brief issue title (max 80 chars)")
    description: str = Field(description="Detailed explanation of the issue")
    category: Literal[
        "security",
        "quality",
        "logic",
        "codebase_fit",
        "test",
        "docs",
        "redundancy",
        "pattern",
        "performance",
    ] = Field(description="Issue category")
    severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Issue severity level"
    )
    evidence: str | None = Field(
        None,
        description="DEPRECATED: Use verification.code_examined instead. Will be removed in Phase 5.",
    )
    verification: VerificationEvidence = Field(
        description="Evidence that this finding was verified against actual code"
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
        min_length=1,
        description="Actual code snippet showing the resolution status. Required.",
    )
    resolution_notes: str | None = Field(
        None, description="Detailed notes on how the issue was addressed"
    )


class ParallelFollowupFinding(BaseModel):
    """A finding from parallel follow-up review with source agent tracking."""

    id: str = Field(description="Unique identifier for this finding")
    file: str = Field(description="File path where issue was found")
    line: int = Field(0, description="Line number of the issue")
    end_line: int | None = Field(None, description="End line for multi-line issues")
    title: str = Field(description="Brief issue title (max 80 chars)")
    description: str = Field(description="Detailed explanation of the issue")
    category: Literal[
        "security",
        "quality",
        "logic",
        "test",
        "docs",
        "regression",
        "incomplete_fix",
    ] = Field(description="Issue category")
    severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Issue severity level"
    )
    evidence: str | None = Field(
        None,
        description="DEPRECATED: Use verification.code_examined instead. Will be removed in Phase 5.",
    )
    verification: VerificationEvidence = Field(
        description="Evidence that this finding was verified against actual code"
    )
    suggested_fix: str | None = Field(None, description="How to fix this issue")
    fixable: bool = Field(False, description="Whether this can be auto-fixed")
    source_agent: str = Field(
        description="Which agent reported this finding (resolution/newcode/comment)"
    )
    related_to_previous: str | None = Field(
        None, description="ID of related previous finding if this is a regression"
    )
    is_impact_finding: bool = Field(
        False,
        description=(
            "True if this finding is about impact on OTHER files (callers, dependents) "
            "outside the PR's changed files. Used by _is_finding_in_scope() to allow "
            "findings about related files that aren't directly in the PR diff."
        ),
    )


class CommentAnalysis(BaseModel):
    """Analysis of a contributor or AI comment."""

    comment_id: str = Field(description="Identifier for the comment")
    author: str = Field(description="Comment author")
    is_ai_bot: bool = Field(description="Whether this is from an AI tool")
    requires_response: bool = Field(description="Whether this comment needs a response")
    sentiment: Literal["question", "concern", "suggestion", "praise", "neutral"] = (
        Field(description="Comment sentiment/type")
    )
    summary: str = Field(description="Brief summary of the comment")
    action_needed: str | None = Field(None, description="What action is needed if any")


class ParallelFollowupResponse(BaseModel):
    """Complete response schema for parallel follow-up PR review."""

    # Analysis metadata
    analysis_summary: str = Field(
        description="Brief summary of what was analyzed in this follow-up"
    )
    agents_invoked: list[str] = Field(
        default_factory=list,
        description="List of agent names that were invoked",
    )
    commits_analyzed: int = Field(0, description="Number of new commits analyzed")
    files_changed: int = Field(
        0, description="Number of files changed since last review"
    )

    # Resolution verification (from resolution-verifier agent)
    resolution_verifications: list[ResolutionVerification] = Field(
        default_factory=list,
        description="AI-verified resolution status for each previous finding",
    )

    # Finding validations (from finding-validator agent)
    finding_validations: list[FindingValidationResult] = Field(
        default_factory=list,
        description=(
            "Re-investigation results for unresolved findings. "
            "Validates whether findings are real issues or false positives."
        ),
    )

    # New findings (from new-code-reviewer agent)
    new_findings: list[ParallelFollowupFinding] = Field(
        default_factory=list,
        description="New issues found in changes since last review",
    )

    # Comment analysis (from comment-analyzer agent)
    comment_analyses: list[CommentAnalysis] = Field(
        default_factory=list,
        description="Analysis of contributor and AI comments",
    )
    comment_findings: list[ParallelFollowupFinding] = Field(
        default_factory=list,
        description="Issues identified from comment analysis",
    )

    # Agent agreement tracking
    agent_agreement: AgentAgreement = Field(
        default_factory=AgentAgreement,
        description="Information about agent agreement on findings",
    )

    # Verdict
    verdict: Literal[
        "READY_TO_MERGE", "MERGE_WITH_CHANGES", "NEEDS_REVISION", "BLOCKED"
    ] = Field(description="Overall merge verdict")
    verdict_reasoning: str = Field(description="Explanation for the verdict")


# =============================================================================
# Finding Validation Response (Re-investigation of unresolved findings)
# =============================================================================


class FindingValidationResult(BaseModel):
    """
    Result of re-investigating an unresolved finding to validate it's actually real.

    The finding-validator agent uses this to report whether a previous finding
    is a genuine issue or a false positive that should be dismissed.

    EVIDENCE-BASED VALIDATION: No confidence scores - validation is binary.
    Either the evidence shows the issue exists, or it doesn't.
    """

    finding_id: str = Field(description="ID of the finding being validated")
    validation_status: Literal[
        "confirmed_valid", "dismissed_false_positive", "needs_human_review"
    ] = Field(
        description=(
            "Validation result: "
            "confirmed_valid = code evidence proves issue IS real; "
            "dismissed_false_positive = code evidence proves issue does NOT exist; "
            "needs_human_review = cannot find definitive evidence either way"
        )
    )
    code_evidence: str = Field(
        min_length=1,
        description=(
            "REQUIRED: Exact code snippet examined from the file. "
            "Must be actual code copy-pasted from the file, not a description. "
            "This is the proof that determines the validation status."
        ),
    )
    line_range: list[int] = Field(
        min_length=2,
        max_length=2,
        description="Start and end line numbers of the examined code [start, end]",
    )
    explanation: str = Field(
        min_length=20,
        description=(
            "Detailed explanation connecting the code_evidence to the validation_status. "
            "Must explain: (1) what the original finding claimed, (2) what the actual code shows, "
            "(3) why this proves/disproves the issue."
        ),
    )
    evidence_verified_in_file: bool = Field(
        description=(
            "True if the code_evidence was verified to exist at the specified line_range. "
            "False if the code couldn't be found (indicates hallucination in original finding)."
        )
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

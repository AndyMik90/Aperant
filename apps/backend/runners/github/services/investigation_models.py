"""
Investigation Pydantic Models
==============================

Structured output models for the AI issue investigation system.

Each specialist agent (root cause, impact, fix advisor, reproducer) returns
a structured response validated against these schemas. The combined results
form an InvestigationReport.

Usage with Claude Agent SDK structured output:
    from .investigation_models import RootCauseAnalysis

    client = create_client(
        ...,
        output_format={
            "type": "json_schema",
            "schema": RootCauseAnalysis.model_json_schema(),
        },
    )
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# =============================================================================
# Shared Sub-Models
# =============================================================================


class CodePath(BaseModel):
    """A reference to a specific code location involved in the issue."""

    file: str = Field(description="File path relative to project root")
    start_line: int = Field(description="Start line number")
    end_line: int | None = Field(
        None, description="End line number (None if single line)"
    )
    description: str = Field(
        description="What this code location does / why it matters"
    )


class SuggestedLabel(BaseModel):
    """An AI-suggested label for the GitHub issue."""

    name: str = Field(description="Label name (e.g., 'bug', 'security', 'performance')")
    reason: str = Field(description="Why this label is appropriate for the issue")
    accepted: bool | None = Field(
        None, description="Whether the user accepted this suggestion (None = pending)"
    )


class LinkedPR(BaseModel):
    """A pull request linked to or referenced by the issue."""

    number: int = Field(description="PR number")
    title: str = Field(description="PR title")
    status: Literal["open", "merged", "closed"] = Field(description="PR status")


# =============================================================================
# Root Cause Analyzer
# =============================================================================


class RootCauseAnalysis(BaseModel):
    """Structured output from the Root Cause Analyzer agent."""

    identified_root_cause: str = Field(
        description="Clear description of the identified root cause"
    )
    code_paths: list[CodePath] = Field(
        default_factory=list,
        description="Code paths involved in the issue, ordered from entry point to root cause",
    )
    confidence: Literal["high", "medium", "low"] = Field(
        description="Confidence in the root cause identification"
    )
    evidence: str = Field(
        description="Evidence supporting the root cause identification (code snippets, traces)"
    )
    related_issues: list[str] = Field(
        default_factory=list,
        description="Patterns or known issue categories this matches (e.g., 'race condition', 'null reference')",
    )
    likely_already_fixed: bool = Field(
        False,
        description="True if evidence suggests this issue has already been resolved",
    )


# =============================================================================
# Impact Assessor
# =============================================================================


class AffectedComponent(BaseModel):
    """A component or module affected by the issue."""

    file: str = Field(description="File path of the affected component")
    component: str = Field(description="Component or module name")
    impact_type: str = Field(
        description="How this component is affected (e.g. direct, indirect, dependency)"
    )
    description: str = Field(description="Description of the impact on this component")


class ImpactAssessment(BaseModel):
    """Structured output from the Impact Assessor agent."""

    severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Overall severity of the issue based on impact"
    )
    affected_components: list[AffectedComponent] = Field(
        default_factory=list,
        description="Components/modules affected by this issue",
    )
    blast_radius: str = Field(
        description="Description of how far-reaching the impact is"
    )
    user_impact: str = Field(description="How end users are affected by this issue")
    regression_risk: str = Field(description="Risk of regression if fixing this issue")


# =============================================================================
# Fix Advisor
# =============================================================================


class FixApproach(BaseModel):
    """A concrete approach to fixing the issue."""

    description: str = Field(description="Description of the fix approach")
    complexity: Literal["simple", "moderate", "complex"] = Field(
        description="Estimated complexity of implementing this fix"
    )
    files_affected: list[str] = Field(
        default_factory=list,
        description="Files that would need to be modified",
    )
    pros: list[str] = Field(
        default_factory=list,
        description="Advantages of this approach",
    )
    cons: list[str] = Field(
        default_factory=list,
        description="Disadvantages or risks of this approach",
    )


class PatternReference(BaseModel):
    """A reference to an existing codebase pattern to follow."""

    file: str = Field(description="File containing the pattern")
    description: str = Field(description="What pattern to follow and why")


class FixAdvice(BaseModel):
    """Structured output from the Fix Advisor agent."""

    approaches: list[FixApproach] = Field(
        default_factory=list,
        description="Possible fix approaches, ordered by recommendation",
    )
    recommended_approach: int = Field(
        0,
        description="Index into approaches list for the recommended approach",
    )
    files_to_modify: list[str] = Field(
        default_factory=list,
        description="All files that need modification across all approaches",
    )
    patterns_to_follow: list[PatternReference] = Field(
        default_factory=list,
        description="Existing codebase patterns the fix should follow for consistency",
    )
    gotchas: list[str] = Field(
        default_factory=list,
        description="Potential pitfalls and things to watch out for when implementing the fix",
    )


# =============================================================================
# Reproducer
# =============================================================================


class TestCoverage(BaseModel):
    """Assessment of existing test coverage for the affected code."""

    has_existing_tests: bool = Field(
        default=False,
        description="Whether there are existing tests for the affected code",
    )
    test_files: list[str] = Field(
        default_factory=list,
        description="Existing test files that cover the affected code paths",
    )
    coverage_assessment: str = Field(
        default="Unable to assess existing test coverage from available evidence",
        description="Assessment of how well the affected code is tested",
    )


class ReproductionAnalysis(BaseModel):
    """Structured output from the Reproducer agent."""

    reproducible: str = Field(
        default="unlikely",
        description="Whether the issue can be reproduced (e.g. yes, likely, unlikely, no)",
    )
    reproduction_steps: list[str] = Field(
        default_factory=list,
        description="Steps to reproduce the issue",
    )
    test_coverage: TestCoverage = Field(
        default_factory=TestCoverage, description="Assessment of existing test coverage"
    )
    related_test_files: list[str] = Field(
        default_factory=list,
        description="Test files related to the affected code",
    )
    suggested_test_approach: str = Field(
        default="Unable to determine a reliable test approach from available evidence",
        description="How to write a test that verifies the fix",
    )


# =============================================================================
# Combined Investigation Report
# =============================================================================


class InvestigationReport(BaseModel):
    """Combined report from all 4 specialist agents.

    This is the authoritative investigation result saved to disk and
    displayed in the UI. It aggregates all agent outputs plus metadata.
    """

    issue_number: int = Field(description="GitHub issue number")
    issue_title: str = Field(description="GitHub issue title")
    investigation_id: str = Field(description="Unique investigation ID")
    timestamp: str = Field(description="ISO 8601 timestamp of investigation completion")

    # Agent results
    root_cause: RootCauseAnalysis = Field(description="Root cause analysis results")
    impact: ImpactAssessment = Field(description="Impact assessment results")
    fix_advice: FixAdvice = Field(description="Fix advice results")
    reproduction: ReproductionAnalysis = Field(
        description="Reproduction analysis results"
    )

    # Overall assessment
    ai_summary: str = Field(
        description="AI-generated summary combining all agent findings"
    )
    severity: Literal["critical", "high", "medium", "low"] = Field(
        description="Overall severity computed from agent assessments"
    )
    likely_resolved: bool = Field(
        False,
        description="True if evidence suggests the issue has already been resolved",
    )

    # Metadata
    suggested_labels: list[SuggestedLabel] = Field(
        default_factory=list,
        description="AI-suggested labels for the issue",
    )
    linked_prs: list[LinkedPR] = Field(
        default_factory=list,
        description="Pull requests linked to this issue",
    )


# =============================================================================
# Investigation State
# =============================================================================


class InvestigationState(BaseModel):
    """Persistent state for an issue investigation.

    Saved to .auto-claude/issues/{issueNumber}/investigation_state.json.
    State is primarily derived from investigation data + linked task status,
    but we persist key fields for fast lookup without scanning all files.
    """

    issue_number: int = Field(description="GitHub issue number")
    spec_id: str | None = Field(
        None, description="Pre-allocated spec ID (e.g., '042-fix-login-bug')"
    )
    status: Literal[
        "investigating",
        "findings_ready",
        "resolved",
        "failed",
        "cancelled",
        "task_created",
    ] = Field(description="Current investigation status")
    started_at: str = Field(description="ISO 8601 timestamp when investigation started")
    completed_at: str | None = Field(
        None, description="ISO 8601 timestamp when investigation completed"
    )
    error: str | None = Field(None, description="Error message if investigation failed")
    linked_spec_id: str | None = Field(
        None, description="Spec ID of the kanban task created from this investigation"
    )
    github_comment_id: int | None = Field(
        None, description="ID of the GitHub comment posted with results"
    )
    model_used: str | None = Field(
        None, description="Model used for investigation (e.g., 'sonnet')"
    )
    sessions: dict[str, str | None] = Field(
        default_factory=dict,
        description="SDK session IDs per specialist for resume support. Keys are specialist names, values are session IDs or None.",
    )

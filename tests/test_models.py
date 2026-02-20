"""
Tests for GitHub Models (models.py)
====================================

Tests the data models, enums, and helper functions for GitHub automation.
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from runners.github.models import (
    # Enums
    ReviewSeverity,
    ReviewCategory,
    ReviewPass,
    MergeVerdict,
    AICommentVerdict,
    TriageCategory,
    AutoFixStatus,
    # Dataclasses
    PRReviewFinding,
    PRReviewResult,
    AICommentTriage,
    StructuralIssue,
    TriageResult,
    AutoFixState,
    FollowupReviewContext,
    GitHubRunnerConfig,
    # Helper functions
    verdict_from_severity_counts,
    apply_merge_conflict_override,
    apply_branch_behind_downgrade,
    apply_ci_status_override,
    verdict_to_github_status,
    # Constants
    BRANCH_BEHIND_BLOCKER_MSG,
    BRANCH_BEHIND_REASONING,
    _utc_now_iso,
)


# ============================================================================
# Helper Functions Tests
# ============================================================================


class TestVerdictHelperFunctions:
    """Tests for verdict helper functions."""

    def test_verdict_from_severity_counts_critical(self):
        """Test critical findings result in BLOCKED verdict."""
        verdict = verdict_from_severity_counts(critical_count=1)
        assert verdict == MergeVerdict.BLOCKED

    def test_verdict_from_severity_counts_high(self):
        """Test high findings result in NEEDS_REVISION verdict."""
        verdict = verdict_from_severity_counts(high_count=1)
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_verdict_from_severity_counts_medium(self):
        """Test medium findings result in NEEDS_REVISION verdict."""
        verdict = verdict_from_severity_counts(medium_count=1)
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_verdict_from_severity_counts_low(self):
        """Test low findings result in READY_TO_MERGE verdict."""
        verdict = verdict_from_severity_counts(low_count=5)
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_verdict_from_severity_counts_none(self):
        """Test no findings result in READY_TO_MERGE verdict."""
        verdict = verdict_from_severity_counts()
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_verdict_from_severity_counts_multiple(self):
        """Test multiple high/medium findings result in NEEDS_REVISION."""
        verdict = verdict_from_severity_counts(
            critical_count=0,
            high_count=3,
            medium_count=2,
            low_count=10
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_apply_merge_conflict_override_blocked(self):
        """Test merge conflicts always result in BLOCKED."""
        verdict = apply_merge_conflict_override(
            MergeVerdict.READY_TO_MERGE,
            has_merge_conflicts=True
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_apply_merge_conflict_override_no_conflict(self):
        """Test no conflicts preserves original verdict."""
        verdict = apply_merge_conflict_override(
            MergeVerdict.READY_TO_MERGE,
            has_merge_conflicts=False
        )
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_apply_merge_conflict_override_needs_revision(self):
        """Test conflicts override NEEDS_REVISION to BLOCKED."""
        verdict = apply_merge_conflict_override(
            MergeVerdict.NEEDS_REVISION,
            has_merge_conflicts=True
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_apply_branch_behind_downgrade_ready_to_merge(self):
        """Test BEHIND status downgrades READY_TO_MERGE to NEEDS_REVISION."""
        verdict = apply_branch_behind_downgrade(
            MergeVerdict.READY_TO_MERGE,
            "BEHIND"
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_apply_branch_behind_downgrade_merge_with_changes(self):
        """Test BEHIND status downgrades MERGE_WITH_CHANGES to NEEDS_REVISION."""
        verdict = apply_branch_behind_downgrade(
            MergeVerdict.MERGE_WITH_CHANGES,
            "BEHIND"
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_apply_branch_behind_downgrade_blocked(self):
        """Test BEHIND status preserves BLOCKED verdict."""
        verdict = apply_branch_behind_downgrade(
            MergeVerdict.BLOCKED,
            "BEHIND"
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_apply_branch_behind_downgrade_clean(self):
        """Test CLEAN status preserves original verdict."""
        verdict = apply_branch_behind_downgrade(
            MergeVerdict.READY_TO_MERGE,
            "CLEAN"
        )
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_apply_ci_status_override_failing(self):
        """Test failing CI blocks READY_TO_MERGE."""
        verdict = apply_ci_status_override(
            MergeVerdict.READY_TO_MERGE,
            failing_count=1
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_apply_ci_status_override_failing_merge_with_changes(self):
        """Test failing CI blocks MERGE_WITH_CHANGES."""
        verdict = apply_ci_status_override(
            MergeVerdict.MERGE_WITH_CHANGES,
            failing_count=2
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_apply_ci_status_override_pending(self):
        """Test pending CI downgrades READY_TO_MERGE to NEEDS_REVISION."""
        verdict = apply_ci_status_override(
            MergeVerdict.READY_TO_MERGE,
            pending_count=1
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_apply_ci_status_override_pending_merge_with_changes(self):
        """Test pending CI downgrades MERGE_WITH_CHANGES to NEEDS_REVISION."""
        verdict = apply_ci_status_override(
            MergeVerdict.MERGE_WITH_CHANGES,
            pending_count=1
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_apply_ci_status_override_preserves_blocked(self):
        """Test CI status preserves BLOCKED verdict."""
        verdict = apply_ci_status_override(
            MergeVerdict.BLOCKED,
            failing_count=5
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_apply_ci_status_override_preserves_needs_revision(self):
        """Test CI status preserves NEEDS_REVISION verdict."""
        verdict = apply_ci_status_override(
            MergeVerdict.NEEDS_REVISION,
            failing_count=1
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_verdict_to_github_status_ready_to_merge(self):
        """Test READY_TO_MERGE maps to approve."""
        status = verdict_to_github_status(MergeVerdict.READY_TO_MERGE)
        assert status == "approve"

    def test_verdict_to_github_status_merge_with_changes(self):
        """Test MERGE_WITH_CHANGES maps to comment."""
        status = verdict_to_github_status(MergeVerdict.MERGE_WITH_CHANGES)
        assert status == "comment"

    def test_verdict_to_github_status_needs_revision(self):
        """Test NEEDS_REVISION maps to request_changes."""
        status = verdict_to_github_status(MergeVerdict.NEEDS_REVISION)
        assert status == "request_changes"

    def test_verdict_to_github_status_blocked(self):
        """Test BLOCKED maps to request_changes."""
        status = verdict_to_github_status(MergeVerdict.BLOCKED)
        assert status == "request_changes"


# ============================================================================
# PRReviewFinding Tests
# ============================================================================


class TestPRReviewFinding:
    """Tests for PRReviewFinding dataclass."""

    def test_create_finding_minimal(self):
        """Test creating a finding with minimal required fields."""
        finding = PRReviewFinding(
            id="finding-1",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="SQL Injection",
            description="User input not sanitized",
            file="app.py",
            line=42
        )
        assert finding.id == "finding-1"
        assert finding.severity == ReviewSeverity.HIGH
        assert finding.category == ReviewCategory.SECURITY
        assert finding.line == 42
        assert finding.end_line is None
        assert finding.suggested_fix is None
        assert finding.fixable is False

    def test_create_finding_full(self):
        """Test creating a finding with all fields."""
        finding = PRReviewFinding(
            id="finding-2",
            severity=ReviewSeverity.MEDIUM,
            category=ReviewCategory.QUALITY,
            title="Long Function",
            description="Function exceeds 50 lines",
            file="utils.py",
            line=100,
            end_line=200,
            suggested_fix="Extract to smaller functions",
            fixable=True,
            evidence="def very_long_function():\n    # 100 lines of code",
            verification_note="Verified by reading the file",
            redundant_with="utils.py:50",
            validation_status="confirmed_valid",
            validation_evidence="Same code pattern found",
            validation_explanation="This is a genuine issue",
            confidence=0.95,
            source_agents=["security", "quality"],
            cross_validated=True,
            is_impact_finding=False
        )
        assert finding.end_line == 200
        assert finding.fixable is True
        assert finding.evidence is not None
        assert finding.cross_validated is True
        assert len(finding.source_agents) == 2

    def test_finding_to_dict(self):
        """Test converting finding to dictionary."""
        finding = PRReviewFinding(
            id="finding-3",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.STYLE,
            title="Missing Space",
            description="Missing space after comma",
            file="format.py",
            line=15,
            fixable=True,
            confidence=0.8
        )
        data = finding.to_dict()
        assert data["id"] == "finding-3"
        assert data["severity"] == "low"
        assert data["category"] == "style"
        assert data["fixable"] is True
        assert data["confidence"] == 0.8

    def test_finding_from_dict(self):
        """Test creating finding from dictionary."""
        data = {
            "id": "finding-4",
            "severity": "critical",
            "category": "security",
            "title": "Hardcoded Secret",
            "description": "API key hardcoded",
            "file": "config.py",
            "line": 10,
            "end_line": 10,
            "suggested_fix": "Use environment variable",
            "fixable": True,
            "evidence": "API_KEY = 'sk-abc123'",
            "verification_note": "Confirmed in source",
            "redundant_with": None,
            "validation_status": "confirmed_valid",
            "validation_evidence": "Secret found in code",
            "validation_explanation": "Genuine security issue",
            "confidence": 1.0,
            "source_agents": ["security"],
            "cross_validated": False,
            "is_impact_finding": False
        }
        finding = PRReviewFinding.from_dict(data)
        assert finding.id == "finding-4"
        assert finding.severity == ReviewSeverity.CRITICAL
        assert finding.category == ReviewCategory.SECURITY
        assert finding.fixable is True
        assert finding.validation_status == "confirmed_valid"

    def test_finding_round_trip(self):
        """Test finding -> dict -> finding round trip."""
        original = PRReviewFinding(
            id="finding-5",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.PERFORMANCE,
            title="Inefficient Query",
            description="N+1 query problem",
            file="models.py",
            line=50,
            suggested_fix="Use select_related",
            fixable=True,
            confidence=0.9
        )
        data = original.to_dict()
        restored = PRReviewFinding.from_dict(data)
        assert restored.id == original.id
        assert restored.severity == original.severity
        assert restored.category == original.category
        assert restored.fixable == original.fixable


# ============================================================================
# AICommentTriage Tests
# ============================================================================


class TestAICommentTriage:
    """Tests for AICommentTriage dataclass."""

    def test_create_triage_minimal(self):
        """Test creating triage with minimal fields."""
        triage = AICommentTriage(
            comment_id=123,
            tool_name="CodeRabbit",
            original_comment="Consider adding error handling",
            verdict=AICommentVerdict.NICE_TO_HAVE,
            reasoning="Valid suggestion but not blocking"
        )
        assert triage.comment_id == 123
        assert triage.tool_name == "CodeRabbit"
        assert triage.response_comment is None

    def test_create_triage_with_response(self):
        """Test creating triage with response comment."""
        triage = AICommentTriage(
            comment_id=456,
            tool_name="Cursor",
            original_comment="This is a bug",
            verdict=AICommentVerdict.CRITICAL,
            reasoning="Genuine issue that must be fixed",
            response_comment="Thanks for catching this! We'll fix it."
        )
        assert triage.response_comment is not None
        assert "Thanks" in triage.response_comment

    def test_triage_to_dict(self):
        """Test converting triage to dictionary."""
        triage = AICommentTriage(
            comment_id=789,
            tool_name="Greptile",
            original_comment="Add tests",
            verdict=AICommentVerdict.IMPORTANT,
            reasoning="Good suggestion for quality",
            response_comment="Will add tests"
        )
        data = triage.to_dict()
        assert data["comment_id"] == 789
        assert data["tool_name"] == "Greptile"
        assert data["verdict"] == "important"
        assert data["response_comment"] == "Will add tests"

    def test_triage_from_dict(self):
        """Test creating triage from dictionary."""
        data = {
            "comment_id": 999,
            "tool_name": "CodeRabbit",
            "original_comment": "Refactor this",
            "verdict": "false_positive",
            "reasoning": "Code is already optimal",
            "response_comment": "Reviewed, code is fine"
        }
        triage = AICommentTriage.from_dict(data)
        assert triage.comment_id == 999
        assert triage.verdict == AICommentVerdict.FALSE_POSITIVE


# ============================================================================
# StructuralIssue Tests
# ============================================================================


class TestStructuralIssue:
    """Tests for StructuralIssue dataclass."""

    def test_create_structural_issue(self):
        """Test creating a structural issue."""
        issue = StructuralIssue(
            id="structural-1",
            issue_type="feature_creep",
            severity=ReviewSeverity.MEDIUM,
            title="PR Scope Creep",
            description="PR includes features beyond original scope",
            impact="Makes review difficult and delays merge",
            suggestion="Split into multiple focused PRs"
        )
        assert issue.id == "structural-1"
        assert issue.issue_type == "feature_creep"
        assert issue.severity == ReviewSeverity.MEDIUM

    def test_structural_issue_to_dict(self):
        """Test converting structural issue to dictionary."""
        issue = StructuralIssue(
            id="structural-2",
            issue_type="architecture_violation",
            severity=ReviewSeverity.HIGH,
            title="Wrong Layer",
            description="Business logic in controller",
            impact="Violates separation of concerns",
            suggestion="Move to service layer"
        )
        data = issue.to_dict()
        assert data["id"] == "structural-2"
        assert data["severity"] == "high"
        assert data["issue_type"] == "architecture_violation"

    def test_structural_issue_from_dict(self):
        """Test creating structural issue from dictionary."""
        data = {
            "id": "structural-3",
            "issue_type": "poor_structure",
            "severity": "medium",
            "title": "Confusing Organization",
            "description": "Files not organized logically",
            "impact": "Hard to navigate codebase",
            "suggestion": "Group by feature"
        }
        issue = StructuralIssue.from_dict(data)
        assert issue.id == "structural-3"
        assert issue.severity == ReviewSeverity.MEDIUM


# ============================================================================
# PRReviewResult Tests
# ============================================================================


class TestPRReviewResult:
    """Tests for PRReviewResult dataclass."""

    def test_create_result_minimal(self):
        """Test creating result with minimal fields."""
        result = PRReviewResult(
            pr_number=42,
            repo="owner/repo",
            success=True
        )
        assert result.pr_number == 42
        assert result.repo == "owner/repo"
        assert result.success is True
        assert result.overall_status == "comment"
        assert result.verdict == MergeVerdict.READY_TO_MERGE
        assert len(result.findings) == 0

    def test_create_result_with_findings(self):
        """Test creating result with findings."""
        findings = [
            PRReviewFinding(
                id="f1",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Bug",
                description="Security issue",
                file="x.py",
                line=1
            ),
            PRReviewFinding(
                id="f2",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Style",
                description="Style issue",
                file="y.py",
                line=2
            )
        ]
        result = PRReviewResult(
            pr_number=123,
            repo="test/repo",
            success=True,
            findings=findings,
            summary="Found 2 issues",
            verdict=MergeVerdict.BLOCKED
        )
        assert len(result.findings) == 2
        assert result.summary == "Found 2 issues"
        assert result.verdict == MergeVerdict.BLOCKED

    def test_result_to_dict(self):
        """Test converting result to dictionary."""
        result = PRReviewResult(
            pr_number=100,
            repo="example/test",
            success=True,
            findings=[],
            summary="No issues found",
            overall_status="approve",
            verdict=MergeVerdict.READY_TO_MERGE
        )
        data = result.to_dict()
        assert data["pr_number"] == 100
        assert data["repo"] == "example/test"
        assert data["overall_status"] == "approve"
        assert data["verdict"] == "ready_to_merge"
        assert "findings" in data

    def test_result_from_dict(self):
        """Test creating result from dictionary."""
        data = {
            "pr_number": 200,
            "repo": "test/example",
            "success": True,
            "findings": [],
            "summary": "Clean PR",
            "overall_status": "approve",
            "verdict": "ready_to_merge",
            "verdict_reasoning": "No issues",
            "blockers": [],
            "risk_assessment": {
                "complexity": "low",
                "security_impact": "none",
                "scope_coherence": "good"
            },
            "structural_issues": [],
            "ai_comment_triages": [],
            "quick_scan_summary": {},
            "reviewed_commit_sha": "abc123",
            "reviewed_file_blobs": {},
            "is_followup_review": False,
            "resolved_findings": [],
            "unresolved_findings": [],
            "new_findings_since_last_review": [],
            "has_posted_findings": False,
            "posted_finding_ids": [],
            "in_progress_since": None
        }
        result = PRReviewResult.from_dict(data)
        assert result.pr_number == 200
        assert result.verdict == MergeVerdict.READY_TO_MERGE
        assert result.risk_assessment["complexity"] == "low"

    @pytest.mark.asyncio
    async def test_result_save(self, tmp_path):
        """Test saving result to disk."""
        result = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[],
            verdict=MergeVerdict.READY_TO_MERGE
        )

        mock_write = AsyncMock()
        mock_update = AsyncMock()

        with patch('runners.github.models.locked_json_write', mock_write):
            with patch('runners.github.models.locked_json_update', mock_update):
                github_dir = tmp_path / "github"
                await result.save(github_dir)

                # Check locked_json_write was called with review file
                mock_write.assert_called_once()
                call_args = mock_write.call_args
                assert call_args[0][0].name == "review_42.json"

                # Check locked_json_update was called for index
                mock_update.assert_called_once()

    @pytest.mark.asyncio
    async def test_result_load_not_found(self):
        """Test loading non-existent result returns None."""
        github_dir = Path("/nonexistent")
        result = PRReviewResult.load(github_dir, 999)
        assert result is None


# ============================================================================
# TriageResult Tests
# ============================================================================


class TestTriageResult:
    """Tests for TriageResult dataclass."""

    def test_create_triage_result_minimal(self):
        """Test creating triage result with minimal fields."""
        result = TriageResult(
            issue_number=1,
            repo="owner/repo",
            category=TriageCategory.BUG,
            confidence=0.9
        )
        assert result.issue_number == 1
        assert result.category == TriageCategory.BUG
        assert result.confidence == 0.9
        assert result.priority == "medium"
        assert result.is_duplicate is False
        assert result.is_spam is False

    def test_create_triage_result_duplicate(self):
        """Test creating duplicate triage result."""
        result = TriageResult(
            issue_number=2,
            repo="owner/repo",
            category=TriageCategory.DUPLICATE,
            confidence=0.95,
            is_duplicate=True,
            duplicate_of=42,
            labels_to_remove=["bug"],
            comment="Duplicate of #42"
        )
        assert result.is_duplicate is True
        assert result.duplicate_of == 42
        assert "bug" in result.labels_to_remove

    def test_create_triage_result_spam(self):
        """Test creating spam triage result."""
        result = TriageResult(
            issue_number=3,
            repo="owner/repo",
            category=TriageCategory.SPAM,
            confidence=0.85,
            is_spam=True
        )
        assert result.is_spam is True
        assert result.category == TriageCategory.SPAM

    def test_triage_result_to_dict(self):
        """Test converting triage result to dictionary."""
        result = TriageResult(
            issue_number=10,
            repo="test/repo",
            category=TriageCategory.FEATURE,
            confidence=0.8,
            priority="high",
            labels_to_add=["enhancement"],
            suggested_breakdown=["Step 1", "Step 2"]
        )
        data = result.to_dict()
        assert data["issue_number"] == 10
        assert data["category"] == "feature"
        assert data["priority"] == "high"
        assert "enhancement" in data["labels_to_add"]

    def test_triage_result_from_dict(self):
        """Test creating triage result from dictionary."""
        data = {
            "issue_number": 20,
            "repo": "example/repo",
            "category": "question",
            "confidence": 0.7,
            "priority": "low",
            "labels_to_add": ["question"],
            "labels_to_remove": [],
            "is_duplicate": False,
            "is_spam": False,
            "is_feature_creep": False,
            "suggested_breakdown": [],
            "comment": None
        }
        result = TriageResult.from_dict(data)
        assert result.issue_number == 20
        assert result.category == TriageCategory.QUESTION
        assert result.priority == "low"


# ============================================================================
# AutoFixStatus Tests
# ============================================================================


class TestAutoFixStatus:
    """Tests for AutoFixStatus enum."""

    def test_terminal_states(self):
        """Test terminal states classmethod."""
        terminal = AutoFixStatus.terminal_states()
        assert AutoFixStatus.COMPLETED in terminal
        assert AutoFixStatus.FAILED in terminal
        assert AutoFixStatus.CANCELLED in terminal
        assert AutoFixStatus.PENDING not in terminal

    def test_recoverable_states(self):
        """Test recoverable states classmethod."""
        recoverable = AutoFixStatus.recoverable_states()
        assert AutoFixStatus.FAILED in recoverable
        assert AutoFixStatus.STALE in recoverable
        assert AutoFixStatus.RATE_LIMITED in recoverable
        assert AutoFixStatus.MERGE_CONFLICT in recoverable

    def test_active_states(self):
        """Test active states classmethod."""
        active = AutoFixStatus.active_states()
        assert AutoFixStatus.PENDING in active
        assert AutoFixStatus.BUILDING in active
        assert AutoFixStatus.QA_REVIEW in active
        assert AutoFixStatus.COMPLETED not in active

    def test_can_transition_to_valid(self):
        """Test valid state transitions."""
        assert AutoFixStatus.PENDING.can_transition_to(AutoFixStatus.ANALYZING)
        assert AutoFixStatus.ANALYZING.can_transition_to(AutoFixStatus.CREATING_SPEC)
        assert AutoFixStatus.BUILDING.can_transition_to(AutoFixStatus.QA_REVIEW)

    def test_can_transition_to_invalid(self):
        """Test invalid state transitions."""
        assert not AutoFixStatus.PENDING.can_transition_to(AutoFixStatus.COMPLETED)
        assert not AutoFixStatus.COMPLETED.can_transition_to(AutoFixStatus.BUILDING)
        assert not AutoFixStatus.CANCELLED.can_transition_to(AutoFixStatus.ANALYZING)

    def test_all_status_values(self):
        """Test all enum values are accessible."""
        assert AutoFixStatus.PENDING.value == "pending"
        assert AutoFixStatus.ANALYZING.value == "analyzing"
        assert AutoFixStatus.CREATING_SPEC.value == "creating_spec"
        assert AutoFixStatus.WAITING_APPROVAL.value == "waiting_approval"
        assert AutoFixStatus.BUILDING.value == "building"
        assert AutoFixStatus.QA_REVIEW.value == "qa_review"
        assert AutoFixStatus.PR_CREATED.value == "pr_created"
        assert AutoFixStatus.MERGE_CONFLICT.value == "merge_conflict"
        assert AutoFixStatus.COMPLETED.value == "completed"
        assert AutoFixStatus.FAILED.value == "failed"
        assert AutoFixStatus.CANCELLED.value == "cancelled"
        assert AutoFixStatus.STALE.value == "stale"
        assert AutoFixStatus.RATE_LIMITED.value == "rate_limited"


# ============================================================================
# AutoFixState Tests
# ============================================================================


class TestAutoFixState:
    """Tests for AutoFixState dataclass."""

    def test_create_state_minimal(self):
        """Test creating state with minimal fields."""
        state = AutoFixState(
            issue_number=1,
            issue_url="https://github.com/owner/repo/issues/1",
            repo="owner/repo"
        )
        assert state.issue_number == 1
        assert state.status == AutoFixStatus.PENDING
        assert state.spec_id is None
        assert state.pr_number is None

    def test_create_state_full(self):
        """Test creating state with all fields."""
        state = AutoFixState(
            issue_number=2,
            issue_url="https://github.com/test/repo/issues/2",
            repo="test/repo",
            status=AutoFixStatus.BUILDING,
            spec_id="spec-123",
            spec_dir="/specs/spec-123",
            pr_number=10,
            pr_url="https://github.com/test/repo/pull/10",
            bot_comments=["Started build", "Build in progress"]
        )
        assert state.status == AutoFixStatus.BUILDING
        assert state.spec_id == "spec-123"
        assert state.pr_number == 10
        assert len(state.bot_comments) == 2

    def test_state_to_dict(self):
        """Test converting state to dictionary."""
        state = AutoFixState(
            issue_number=5,
            issue_url="https://github.com/owner/repo/issues/5",
            repo="owner/repo",
            status=AutoFixStatus.COMPLETED,
            pr_number=15
        )
        data = state.to_dict()
        assert data["issue_number"] == 5
        assert data["status"] == "completed"
        assert data["pr_number"] == 15
        # Token should be masked
        assert "token" not in data

    def test_state_from_dict(self):
        """Test creating state from dictionary."""
        data = {
            "issue_number": 10,
            "issue_url": "https://github.com/test/repo/issues/10",
            "repo": "test/repo",
            "status": "building",
            "spec_id": "spec-456",
            "spec_dir": "/specs/spec-456",
            "pr_number": 20,
            "pr_url": "https://github.com/test/repo/pull/20",
            "bot_comments": [],
            "error": None
        }
        state = AutoFixState.from_dict(data)
        assert state.issue_number == 10
        assert state.status == AutoFixStatus.BUILDING
        assert state.spec_id == "spec-456"

    def test_state_from_dict_missing_url(self):
        """Test from_dict constructs URL when missing."""
        data = {
            "issue_number": 15,
            "repo": "owner/repo",
            "status": "pending"
        }
        state = AutoFixState.from_dict(data)
        assert state.issue_url == "https://github.com/owner/repo/issues/15"

    def test_update_status_valid(self):
        """Test valid status update."""
        state = AutoFixState(
            issue_number=1,
            issue_url="https://github.com/owner/repo/issues/1",
            repo="owner/repo",
            status=AutoFixStatus.PENDING
        )
        state.update_status(AutoFixStatus.ANALYZING)
        assert state.status == AutoFixStatus.ANALYZING

    def test_update_status_invalid(self):
        """Test invalid status update raises ValueError."""
        state = AutoFixState(
            issue_number=1,
            issue_url="https://github.com/owner/repo/issues/1",
            repo="owner/repo",
            status=AutoFixStatus.PENDING
        )
        with pytest.raises(ValueError, match="Invalid state transition"):
            state.update_status(AutoFixStatus.COMPLETED)

    @pytest.mark.asyncio
    async def test_state_save(self, tmp_path):
        """Test saving state to disk."""
        state = AutoFixState(
            issue_number=1,
            issue_url="https://github.com/owner/repo/issues/1",
            repo="owner/repo"
        )

        mock_write = AsyncMock()
        mock_update = AsyncMock()

        with patch('runners.github.models.locked_json_write', mock_write):
            with patch('runners.github.models.locked_json_update', mock_update):
                github_dir = tmp_path / "github"
                await state.save(github_dir)

                # Check both write operations were called
                mock_write.assert_called_once()
                mock_update.assert_called_once()


# ============================================================================
# GitHubRunnerConfig Tests
# ============================================================================


class TestGitHubRunnerConfig:
    """Tests for GitHubRunnerConfig dataclass."""

    def test_create_config_minimal(self):
        """Test creating config with minimal fields."""
        config = GitHubRunnerConfig(
            token="ghp_test_token",
            repo="owner/repo"
        )
        assert config.token == "ghp_test_token"
        assert config.repo == "owner/repo"
        assert config.auto_fix_enabled is False
        assert config.pr_review_enabled is False

    def test_create_config_full(self):
        """Test creating config with all fields."""
        config = GitHubRunnerConfig(
            token="ghp_token",
            repo="test/repo",
            bot_token="ghp_bot_token",
            auto_fix_enabled=True,
            auto_fix_labels=["auto-fix", "bot"],
            require_human_approval=False,
            triage_enabled=True,
            pr_review_enabled=True,
            auto_post_reviews=True,
            model="opus",
            thinking_level="high"
        )
        assert config.bot_token == "ghp_bot_token"
        assert config.auto_fix_enabled is True
        assert config.triage_enabled is True
        assert config.model == "opus"

    def test_config_to_dict_masks_tokens(self):
        """Test to_dict masks sensitive tokens."""
        config = GitHubRunnerConfig(
            token="secret_token",
            repo="owner/repo",
            bot_token="secret_bot_token"
        )
        data = config.to_dict()
        assert data["token"] == "***"
        assert data["bot_token"] == "***"
        assert data["repo"] == "owner/repo"

    def test_config_save_settings(self):
        """Test save_settings writes to file without tokens."""
        config = GitHubRunnerConfig(
            token="secret",
            repo="test/repo",
            auto_fix_enabled=True
        )

        mock_open = MagicMock()
        mock_file = MagicMock()
        mock_open.return_value.__enter__.return_value = mock_file

        with patch('builtins.open', mock_open):
            with patch('pathlib.Path.mkdir', MagicMock()):
                config.save_settings(Path("/test/github"))

                # Check json.dump was called
                assert mock_file.write.called
                # Verify tokens not in output
                written_data = ''.join(str(call) for call in mock_file.write.call_args_list)
                assert "secret" not in written_data

    def test_config_load_settings_default(self):
        """Test load_settings with default values."""
        mock_exists = MagicMock(return_value=False)

        with patch('pathlib.Path.exists', mock_exists):
            config = GitHubRunnerConfig.load_settings(
                github_dir=Path("/nonexistent"),
                token="test_token",
                repo="owner/repo"
            )
            assert config.token == "test_token"
            assert config.repo == "owner/repo"
            assert config.auto_fix_enabled is False
            assert config.model == "sonnet"

    def test_config_load_settings_from_file(self):
        """Test load_settings reads from config file."""
        config_data = {
            "auto_fix_enabled": True,
            "pr_review_enabled": True,
            "model": "opus",
            "thinking_level": "high",
            "investigation_settings": {
                "fastInvestigations": True,
                "autoPostToGitHub": True,
                "maxParallelInvestigations": 5
            }
        }

        mock_exists = MagicMock(return_value=True)
        mock_open = MagicMock()
        mock_file = MagicMock()
        mock_file.read.return_value = json.dumps(config_data)
        mock_open.return_value.__enter__.return_value = mock_file

        with patch('pathlib.Path.exists', mock_exists):
            with patch('builtins.open', mock_open):
                config = GitHubRunnerConfig.load_settings(
                    github_dir=Path("/test/github"),
                    token="test_token",
                    repo="owner/repo"
                )
                assert config.auto_fix_enabled is True
                assert config.pr_review_enabled is True
                assert config.model == "opus"
                assert config.fast_mode is True
                assert config.investigation_max_parallel == 5


# ============================================================================
# FollowupReviewContext Tests
# ============================================================================


class TestFollowupReviewContext:
    """Tests for FollowupReviewContext dataclass."""

    def test_create_context_minimal(self):
        """Test creating context with minimal fields."""
        from runners.github.models import PRReviewResult

        previous_review = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True
        )

        context = FollowupReviewContext(
            pr_number=42,
            previous_review=previous_review,
            previous_commit_sha="abc123",
            current_commit_sha="def456"
        )
        assert context.pr_number == 42
        assert context.previous_commit_sha == "abc123"
        assert context.current_commit_sha == "def456"
        assert context.has_merge_conflicts is False

    def test_create_context_full(self):
        """Test creating context with all fields."""
        from runners.github.models import PRReviewResult

        previous_review = PRReviewResult(
            pr_number=100,
            repo="test/repo",
            success=True
        )

        context = FollowupReviewContext(
            pr_number=100,
            previous_review=previous_review,
            previous_commit_sha="old_sha",
            current_commit_sha="new_sha",
            commits_since_review=[{"sha": "commit1"}],
            files_changed_since_review=["file1.py", "file2.py"],
            diff_since_review="+ new line",
            has_merge_conflicts=True,
            merge_state_status="DIRTY",
            ci_status={"passing": 5, "failing": 1, "pending": 0}
        )
        assert context.has_merge_conflicts is True
        assert context.merge_state_status == "DIRTY"
        assert context.ci_status["failing"] == 1
        assert len(context.files_changed_since_review) == 2


# ============================================================================
# Constants Tests
# ============================================================================


class TestConstants:
    """Tests for module constants."""

    def test_branch_behind_constants(self):
        """Test branch-behind message constants are defined."""
        assert BRANCH_BEHIND_BLOCKER_MSG is not None
        assert "Branch Out of Date" in BRANCH_BEHIND_BLOCKER_MSG
        assert BRANCH_BEHIND_REASONING is not None
        assert "out of date" in BRANCH_BEHIND_REASONING.lower()


# ============================================================================
# Enum Values Tests
# ============================================================================


class TestEnumValues:
    """Tests for enum value consistency."""

    def test_review_severity_values(self):
        """Test ReviewSeverity enum has correct values."""
        assert ReviewSeverity.CRITICAL.value == "critical"
        assert ReviewSeverity.HIGH.value == "high"
        assert ReviewSeverity.MEDIUM.value == "medium"
        assert ReviewSeverity.LOW.value == "low"

    def test_review_category_values(self):
        """Test ReviewCategory enum has expected values."""
        assert ReviewCategory.SECURITY.value == "security"
        assert ReviewCategory.QUALITY.value == "quality"
        assert ReviewCategory.STYLE.value == "style"
        assert ReviewCategory.TEST.value == "test"
        assert ReviewCategory.DOCS.value == "docs"
        assert ReviewCategory.PATTERN.value == "pattern"
        assert ReviewCategory.PERFORMANCE.value == "performance"
        assert ReviewCategory.VERIFICATION_FAILED.value == "verification_failed"
        assert ReviewCategory.REDUNDANCY.value == "redundancy"

    def test_review_pass_values(self):
        """Test ReviewPass enum has correct values."""
        assert ReviewPass.QUICK_SCAN.value == "quick_scan"
        assert ReviewPass.SECURITY.value == "security"
        assert ReviewPass.QUALITY.value == "quality"
        assert ReviewPass.DEEP_ANALYSIS.value == "deep_analysis"
        assert ReviewPass.STRUCTURAL.value == "structural"
        assert ReviewPass.AI_COMMENT_TRIAGE.value == "ai_comment_triage"

    def test_merge_verdict_values(self):
        """Test MergeVerdict enum has correct values."""
        assert MergeVerdict.READY_TO_MERGE.value == "ready_to_merge"
        assert MergeVerdict.MERGE_WITH_CHANGES.value == "merge_with_changes"
        assert MergeVerdict.NEEDS_REVISION.value == "needs_revision"
        assert MergeVerdict.BLOCKED.value == "blocked"

    def test_triage_category_values(self):
        """Test TriageCategory enum has correct values."""
        assert TriageCategory.BUG.value == "bug"
        assert TriageCategory.FEATURE.value == "feature"
        assert TriageCategory.DOCUMENTATION.value == "documentation"
        assert TriageCategory.QUESTION.value == "question"
        assert TriageCategory.DUPLICATE.value == "duplicate"
        assert TriageCategory.SPAM.value == "spam"
        assert TriageCategory.FEATURE_CREEP.value == "feature_creep"

    def test_ai_comment_verdict_values(self):
        """Test AICommentVerdict enum has correct values."""
        assert AICommentVerdict.CRITICAL.value == "critical"
        assert AICommentVerdict.IMPORTANT.value == "important"
        assert AICommentVerdict.NICE_TO_HAVE.value == "nice_to_have"
        assert AICommentVerdict.TRIVIAL.value == "trivial"
        assert AICommentVerdict.FALSE_POSITIVE.value == "false_positive"
        assert AICommentVerdict.ADDRESSED.value == "addressed"


# ============================================================================
# Utility Function Tests
# ============================================================================


class TestUtilityFunctions:
    """Tests for utility functions."""

    def test_utc_now_iso_format(self):
        """Test _utc_now_iso returns ISO format string."""
        result = _utc_now_iso()
        assert isinstance(result, str)
        assert "T" in result
        assert result.endswith("Z")
        # Verify it's a valid ISO format
        # Format: YYYY-MM-DDTHH:MM:SSZ
        assert len(result) == 20

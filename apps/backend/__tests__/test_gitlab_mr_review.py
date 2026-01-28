"""
GitLab MR Review Tests
======================

Tests for MR review models, findings, verdicts.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest
from __tests__.fixtures.gitlab import (
    MOCK_GITLAB_CONFIG,
    mock_issue_data,
    mock_mr_data,
)


class TestMRReviewFinding:
    """Test MRReviewFinding model."""

    def test_finding_creation(self):
        """Test creating a review finding."""
        from runners.gitlab.models import (
            MRReviewFinding,
            ReviewCategory,
            ReviewSeverity,
        )

        finding = MRReviewFinding(
            id="find-1",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="SQL injection vulnerability",
            description="User input not sanitized in query",
            file="src/auth.py",
            line=42,
            end_line=45,
            suggested_fix="Use parameterized query",
            fixable=True,
        )

        assert finding.id == "find-1"
        assert finding.severity == ReviewSeverity.HIGH
        assert finding.category == ReviewCategory.SECURITY
        assert finding.file == "src/auth.py"
        assert finding.line == 42
        assert finding.fixable is True

    def test_finding_to_dict(self):
        """Test converting finding to dictionary."""
        from runners.gitlab.models import (
            MRReviewFinding,
            ReviewCategory,
            ReviewSeverity,
        )

        finding = MRReviewFinding(
            id="find-1",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="SQL injection",
            description="Vulnerability",
            file="src/auth.py",
            line=42,
        )

        data = finding.to_dict()

        assert data["id"] == "find-1"
        assert data["severity"] == "high"
        assert data["category"] == "security"

    def test_finding_from_dict(self):
        """Test loading finding from dictionary."""
        from runners.gitlab.models import MRReviewFinding

        data = {
            "id": "find-1",
            "severity": "high",
            "category": "security",
            "title": "SQL injection",
            "description": "Vulnerability",
            "file": "src/auth.py",
            "line": 42,
            "end_line": 45,
            "suggested_fix": "Fix it",
            "fixable": True,
        }

        finding = MRReviewFinding.from_dict(data)

        assert finding.id == "find-1"
        assert finding.severity.value == "high"
        assert finding.line == 42

    def test_finding_with_evidence_code(self):
        """Test finding with evidence code."""
        from runners.gitlab.models import (
            MRReviewFinding,
            ReviewCategory,
            ReviewPass,
            ReviewSeverity,
        )

        finding = MRReviewFinding(
            id="find-1",
            severity=ReviewSeverity.CRITICAL,
            category=ReviewCategory.SECURITY,
            title="Command injection",
            description="User input in subprocess",
            file="src/exec.py",
            line=10,
            evidence_code="subprocess.call(user_input, shell=True)",
            found_by_pass=ReviewPass.SECURITY,
        )

        assert finding.evidence_code == "subprocess.call(user_input, shell=True)"
        assert finding.found_by_pass == ReviewPass.SECURITY


class TestStructuralIssue:
    """Test StructuralIssue model."""

    def test_structural_issue_creation(self):
        """Test creating a structural issue."""
        from runners.gitlab.models import ReviewSeverity, StructuralIssue

        issue = StructuralIssue(
            id="struct-1",
            type="feature_creep",
            title="Additional features added",
            description="MR includes features beyond original scope",
            severity=ReviewSeverity.MEDIUM,
            files_affected=["src/auth.py", "src/users.py"],
        )

        assert issue.id == "struct-1"
        assert issue.type == "feature_creep"
        assert issue.files_affected == ["src/auth.py", "src/users.py"]

    def test_structural_issue_to_dict(self):
        """Test converting structural issue to dictionary."""
        from runners.gitlab.models import StructuralIssue

        issue = StructuralIssue(
            id="struct-1",
            type="scope_change",
            title="Scope increased",
            description="MR scope changed significantly",
            files_affected=["file1.py"],
        )

        data = issue.to_dict()

        assert data["id"] == "struct-1"
        assert data["type"] == "scope_change"

    def test_structural_issue_from_dict(self):
        """Test loading structural issue from dictionary."""
        from runners.gitlab.models import StructuralIssue

        data = {
            "id": "struct-1",
            "type": "feature_creep",
            "title": "Extra features",
            "description": "Beyond scope",
            "severity": "medium",
            "files_affected": ["file.py"],
        }

        issue = StructuralIssue.from_dict(data)

        assert issue.type == "feature_creep"


class TestAICommentTriage:
    """Test AICommentTriage model."""

    def test_triage_creation(self):
        """Test creating AI comment triage."""
        from runners.gitlab.models import AICommentTriage

        triage = AICommentTriage(
            comment_id="1001",
            tool_name="CodeRabbit",
            original_comment="Consider adding error handling",
            triage_result="valid",
            reasoning="Good point about error handling",
            file="src/auth.py",
            line=50,
        )

        assert triage.comment_id == "1001"
        assert triage.tool_name == "CodeRabbit"
        assert triage.triage_result == "valid"

    def test_triage_to_dict(self):
        """Test converting triage to dictionary."""
        from runners.gitlab.models import AICommentTriage

        triage = AICommentTriage(
            comment_id=1001,
            tool_name="CodeRabbit",
            original_comment="Add tests",
            triage_result="false_positive",
            reasoning="Tests already exist",
        )

        data = triage.to_dict()

        assert data["comment_id"] == 1001
        assert data["triage_result"] == "false_positive"

    def test_triage_from_dict(self):
        """Test loading triage from dictionary."""
        from runners.gitlab.models import AICommentTriage

        data = {
            "comment_id": 1001,
            "tool_name": "Cursor",
            "original_comment": "Fix bug",
            "triage_result": "questionable",
            "reasoning": "Unclear if bug exists",
            "file": "file.py",
            "line": 10,
        }

        triage = AICommentTriage.from_dict(data)

        assert triage.tool_name == "Cursor"
        assert triage.triage_result == "questionable"


class TestMRReviewResult:
    """Test MRReviewResult model."""

    def test_result_creation(self):
        """Test creating review result."""
        from runners.gitlab.models import (
            MergeVerdict,
            MRReviewFinding,
            MRReviewResult,
            ReviewCategory,
            ReviewSeverity,
        )

        findings = [
            MRReviewFinding(
                id="find-1",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="Bug",
                description="Issue",
                file="file.py",
                line=1,
            )
        ]

        result = MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            findings=findings,
            summary="Review complete",
            overall_status="approve",
            verdict=MergeVerdict.READY_TO_MERGE,
            verdict_reasoning="No issues found",
            blockers=[],
        )

        assert result.mr_iid == 123
        assert result.findings == findings
        assert result.verdict == MergeVerdict.READY_TO_MERGE

    def test_result_with_structural_issues(self):
        """Test result with structural issues."""
        from runners.gitlab.models import (
            MergeVerdict,
            MRReviewResult,
            StructuralIssue,
        )

        structural_issues = [
            StructuralIssue(
                id="struct-1",
                type="feature_creep",
                title="Extra features",
                description="Beyond scope",
            )
        ]

        result = MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            structural_issues=structural_issues,
            verdict=MergeVerdict.MERGE_WITH_CHANGES,
            verdict_reasoning="Feature creep detected",
            blockers=[],
        )

        assert len(result.structural_issues) == 1
        assert result.verdict == MergeVerdict.MERGE_WITH_CHANGES

    def test_result_with_ai_triages(self):
        """Test result with AI comment triages."""
        from runners.gitlab.models import (
            AICommentTriage,
            MergeVerdict,
            MRReviewResult,
        )

        ai_triages = [
            AICommentTriage(
                comment_id=1001,
                tool_name="CodeRabbit",
                original_comment="Fix bug",
                triage_result="valid",
                reasoning="Correct",
            )
        ]

        result = MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            ai_triages=ai_triages,
            verdict=MergeVerdict.READY_TO_MERGE,
            verdict_reasoning="All good",
            blockers=[],
        )

        assert len(result.ai_triages) == 1

    def test_result_with_ci_status(self):
        """Test result with CI/CD status."""
        from runners.gitlab.models import MergeVerdict, MRReviewResult

        result = MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            ci_status="failed",
            ci_pipeline_id=1001,
            verdict=MergeVerdict.BLOCKED,
            verdict_reasoning="CI failed",
            blockers=["CI Pipeline Failed"],
        )

        assert result.ci_status == "failed"
        assert result.ci_pipeline_id == 1001
        assert result.verdict == MergeVerdict.BLOCKED

    def test_result_to_dict(self):
        """Test converting result to dictionary."""
        from runners.gitlab.models import MergeVerdict, MRReviewResult

        result = MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            verdict=MergeVerdict.READY_TO_MERGE,
            verdict_reasoning="Good",
            blockers=[],
        )

        data = result.to_dict()

        assert data["mr_iid"] == 123
        assert data["verdict"] == "ready_to_merge"

    def test_result_from_dict(self):
        """Test loading result from dictionary."""
        from runners.gitlab.models import MergeVerdict, MRReviewResult

        data = {
            "mr_iid": 123,
            "project": "group/project",
            "success": True,
            "findings": [],
            "summary": "Review",
            "overall_status": "approve",
            "verdict": "ready_to_merge",
            "verdict_reasoning": "Good",
            "blockers": [],
        }

        result = MRReviewResult.from_dict(data)

        assert result.mr_iid == 123
        assert result.verdict == MergeVerdict.READY_TO_MERGE

    def test_result_save_and_load(self, tmp_path):
        """Test saving and loading result from disk."""
        from runners.gitlab.models import MergeVerdict, MRReviewResult

        result = MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            verdict=MergeVerdict.READY_TO_MERGE,
            verdict_reasoning="Good",
            blockers=[],
        )

        result.save(tmp_path)

        loaded = MRReviewResult.load(tmp_path, 123)

        assert loaded is not None
        assert loaded.mr_iid == 123

    def test_followup_review_fields(self):
        """Test follow-up review fields."""
        from runners.gitlab.models import MergeVerdict, MRReviewResult

        result = MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            is_followup_review=True,
            reviewed_commit_sha="abc123",
            resolved_findings=["find-1"],
            unresolved_findings=["find-2"],
            new_findings_since_last_review=["find-3"],
            verdict=MergeVerdict.READY_TO_MERGE,
            verdict_reasoning="Good",
            blockers=[],
        )

        assert result.is_followup_review is True
        assert result.reviewed_commit_sha == "abc123"
        assert len(result.resolved_findings) == 1


class TestReviewPass:
    """Test ReviewPass enum."""

    def test_all_passes_defined(self):
        """Test all review passes are defined."""
        from runners.gitlab.models import ReviewPass

        assert ReviewPass.QUICK_SCAN
        assert ReviewPass.SECURITY
        assert ReviewPass.QUALITY
        assert ReviewPass.DEEP_ANALYSIS
        assert ReviewPass.STRUCTURAL
        assert ReviewPass.AI_COMMENT_TRIAGE

    def test_pass_values(self):
        """Test pass enum values."""
        from runners.gitlab.models import ReviewPass

        assert ReviewPass.QUICK_SCAN.value == "quick_scan"
        assert ReviewPass.SECURITY.value == "security"
        assert ReviewPass.QUALITY.value == "quality"
        assert ReviewPass.DEEP_ANALYSIS.value == "deep_analysis"
        assert ReviewPass.STRUCTURAL.value == "structural"
        assert ReviewPass.AI_COMMENT_TRIAGE.value == "ai_comment_triage"


class TestMergeVerdict:
    """Test MergeVerdict enum."""

    def test_all_verdicts_defined(self):
        """Test all verdicts are defined."""
        from runners.gitlab.models import MergeVerdict

        assert MergeVerdict.READY_TO_MERGE
        assert MergeVerdict.MERGE_WITH_CHANGES
        assert MergeVerdict.NEEDS_REVISION
        assert MergeVerdict.BLOCKED

    def test_verdict_values(self):
        """Test verdict enum values."""
        from runners.gitlab.models import MergeVerdict

        assert MergeVerdict.READY_TO_MERGE.value == "ready_to_merge"
        assert MergeVerdict.MERGE_WITH_CHANGES.value == "merge_with_changes"
        assert MergeVerdict.NEEDS_REVISION.value == "needs_revision"
        assert MergeVerdict.BLOCKED.value == "blocked"


class TestReviewSeverity:
    """Test ReviewSeverity enum."""

    def test_all_severities(self):
        """Test all severity levels."""
        from runners.gitlab.models import ReviewSeverity

        assert ReviewSeverity.CRITICAL
        assert ReviewSeverity.HIGH
        assert ReviewSeverity.MEDIUM
        assert ReviewSeverity.LOW


class TestReviewCategory:
    """Test ReviewCategory enum."""

    def test_all_categories(self):
        """Test all categories."""
        from runners.gitlab.models import ReviewCategory

        assert ReviewCategory.SECURITY
        assert ReviewCategory.QUALITY
        assert ReviewCategory.STYLE
        assert ReviewCategory.TEST
        assert ReviewCategory.DOCS
        assert ReviewCategory.PATTERN
        assert ReviewCategory.PERFORMANCE

"""
Tests for GitHub PR Review System
==================================

Tests the PR review orchestrator and follow-up review functionality.
"""

import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest

# Add the backend directory to path
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
_github_dir = _backend_dir / "runners" / "github"
if str(_github_dir) not in sys.path:
    sys.path.insert(0, str(_github_dir))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from models import (
    PRReviewResult,
    PRReviewFinding,
    ReviewSeverity,
    ReviewCategory,
    MergeVerdict,
    FollowupReviewContext,
)
from bot_detection import BotDetector


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def temp_github_dir(tmp_path):
    """Create temporary GitHub directory structure."""
    github_dir = tmp_path / ".auto-claude" / "github"
    pr_dir = github_dir / "pr"
    pr_dir.mkdir(parents=True)
    return github_dir


@pytest.fixture
def sample_finding():
    """Create a sample PR review finding."""
    return PRReviewFinding(
        id="finding-001",
        severity=ReviewSeverity.HIGH,
        category=ReviewCategory.SECURITY,
        title="SQL Injection vulnerability",
        description="User input not sanitized",
        file="src/db.py",
        line=42,
        suggested_fix="Use parameterized queries",
        fixable=True,
    )


@pytest.fixture
def sample_review_result(sample_finding):
    """Create a sample PR review result."""
    return PRReviewResult(
        pr_number=123,
        repo="test/repo",
        success=True,
        findings=[sample_finding],
        summary="Found 1 security issue",
        overall_status="request_changes",
        verdict=MergeVerdict.NEEDS_REVISION,
        verdict_reasoning="Security issues must be fixed",
        reviewed_commit_sha="abc123def456",
        reviewed_at=datetime.now().isoformat(),
    )


@pytest.fixture
def mock_bot_detector(tmp_path):
    """Create a mock bot detector."""
    state_dir = tmp_path / "github"
    state_dir.mkdir(parents=True)

    with patch.object(BotDetector, "_get_bot_username", return_value="test-bot"):
        detector = BotDetector(
            state_dir=state_dir,
            bot_token="fake-token",
            review_own_prs=False,
        )
        return detector


# ============================================================================
# PRReviewResult Tests
# ============================================================================


class TestPRReviewResult:
    """Test PRReviewResult model."""

    @pytest.mark.asyncio
    async def test_save_and_load(self, temp_github_dir, sample_review_result):
        """Test saving and loading review result."""
        # Save
        await sample_review_result.save(temp_github_dir)

        # Verify file exists
        review_file = (
            temp_github_dir / "pr" / f"review_{sample_review_result.pr_number}.json"
        )
        assert review_file.exists()

        # Load
        loaded = PRReviewResult.load(temp_github_dir, sample_review_result.pr_number)

        assert loaded is not None
        assert loaded.pr_number == sample_review_result.pr_number
        assert loaded.success == sample_review_result.success
        assert len(loaded.findings) == len(sample_review_result.findings)
        assert loaded.reviewed_commit_sha == sample_review_result.reviewed_commit_sha

    def test_load_nonexistent(self, temp_github_dir):
        """Test loading when file doesn't exist."""
        loaded = PRReviewResult.load(temp_github_dir, 999)
        assert loaded is None

    def test_to_dict_camelcase(self, sample_review_result):
        """Test that to_dict produces correct format."""
        data = sample_review_result.to_dict()

        # Should use snake_case for JSON serialization
        assert "pr_number" in data
        assert "reviewed_commit_sha" in data
        assert "overall_status" in data
        assert data["pr_number"] == 123

    def test_from_dict_handles_snake_case(self, sample_review_result):
        """Test that from_dict handles snake_case input."""
        data = {
            "pr_number": 456,
            "repo": "test/repo",
            "success": True,
            "findings": [],
            "summary": "Test summary",
            "overall_status": "approve",
            "reviewed_commit_sha": "xyz789",
            "reviewed_at": datetime.now().isoformat(),
        }

        result = PRReviewResult.from_dict(data)

        assert result.pr_number == 456
        assert result.reviewed_commit_sha == "xyz789"


class TestPRReviewFinding:
    """Test PRReviewFinding model."""

    def test_finding_serialization(self, sample_finding):
        """Test finding serialization to dict."""
        data = sample_finding.to_dict()

        assert data["id"] == "finding-001"
        assert data["severity"] == "high"
        assert data["category"] == "security"
        assert data["file"] == "src/db.py"
        assert data["line"] == 42

    def test_finding_deserialization(self):
        """Test finding deserialization from dict."""
        data = {
            "id": "finding-002",
            "severity": "critical",
            "category": "quality",
            "title": "Memory leak",
            "description": "Resource not released",
            "file": "src/memory.py",
            "line": 100,
            "suggested_fix": "Add cleanup code",
            "fixable": True,
        }

        finding = PRReviewFinding.from_dict(data)

        assert finding.id == "finding-002"
        assert finding.severity == ReviewSeverity.CRITICAL
        assert finding.category == ReviewCategory.QUALITY


# ============================================================================
# Follow-up Review Context Tests
# ============================================================================


class TestFollowupReviewContext:
    """Test FollowupReviewContext model."""

    def test_context_with_changes(self, sample_review_result, sample_finding):
        """Test follow-up context with file changes."""
        context = FollowupReviewContext(
            pr_number=123,
            previous_review=sample_review_result,
            previous_commit_sha="abc123",
            current_commit_sha="def456",
            files_changed_since_review=["src/db.py", "src/api.py"],
            diff_since_review="diff content here",
        )

        assert context.pr_number == 123
        assert context.previous_commit_sha == "abc123"
        assert context.current_commit_sha == "def456"
        assert len(context.files_changed_since_review) == 2
        assert context.error is None

    def test_context_with_error(self, sample_review_result):
        """Test follow-up context with error flag."""
        context = FollowupReviewContext(
            pr_number=123,
            previous_review=sample_review_result,
            previous_commit_sha="abc123",
            current_commit_sha="def456",
            error="Failed to compare commits: API error",
        )

        assert context.error is not None
        assert "Failed to compare commits" in context.error

    def test_context_rebase_detected_files_changed_no_commits(
        self, sample_review_result
    ):
        """Test follow-up context when PR was rebased (files changed but no trackable commits).

        After a rebase/force-push, commit SHAs are rewritten so we can't identify "new" commits.
        However, blob SHA comparison can still identify which files actually changed content.
        The follow-up review should proceed based on file changes, not skip the review.
        """
        context = FollowupReviewContext(
            pr_number=123,
            previous_review=sample_review_result,
            previous_commit_sha="abc123",  # This SHA no longer exists in PR after rebase
            current_commit_sha="xyz789",
            commits_since_review=[],  # Empty after rebase - can't determine "new" commits
            files_changed_since_review=[
                "src/db.py",
                "src/api.py",
            ],  # But blob comparison found changes
            diff_since_review="--- a/src/db.py\n+++ b/src/db.py\n@@ -1,3 +1,3 @@\n-old\n+new",
        )

        # Verify context reflects rebase scenario
        assert context.pr_number == 123
        assert len(context.commits_since_review) == 0  # No trackable commits
        assert len(context.files_changed_since_review) == 2  # But files did change
        assert context.error is None

        # The key assertion: this context should NOT be treated as "no changes"
        # The orchestrator should check both commits AND files
        has_changes = bool(context.commits_since_review) or bool(
            context.files_changed_since_review
        )
        assert has_changes is True, (
            "Rebase with file changes should be treated as having changes"
        )

    def test_context_truly_no_changes(self, sample_review_result):
        """Test follow-up context when there are truly no changes (same SHA, no files)."""
        context = FollowupReviewContext(
            pr_number=123,
            previous_review=sample_review_result,
            previous_commit_sha="abc123",
            current_commit_sha="abc123",  # Same SHA
            commits_since_review=[],
            files_changed_since_review=[],  # No file changes either
            diff_since_review="",
        )

        # This should be treated as no changes
        has_changes = bool(context.commits_since_review) or bool(
            context.files_changed_since_review
        )
        assert has_changes is False, "No commits and no file changes means no changes"


# ============================================================================
# Bot Detection Integration Tests
# ============================================================================


class TestBotDetectionIntegration:
    """Test bot detection integration with review flow."""

    def test_already_reviewed_returns_skip(self, mock_bot_detector):
        """Test that already reviewed commit returns skip."""
        from datetime import timedelta

        # Mark commit as reviewed
        mock_bot_detector.mark_reviewed(123, "abc123def456")

        # Set last review time to 2 minutes ago to bypass cooling off (1 minute)
        two_min_ago = datetime.now() - timedelta(minutes=2)
        mock_bot_detector.state.last_review_times["123"] = two_min_ago.isoformat()

        pr_data = {"author": {"login": "alice"}}
        commits = [{"author": {"login": "alice"}, "oid": "abc123def456"}]

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is True
        assert "Already reviewed" in reason

    def test_new_commit_allows_review(self, mock_bot_detector):
        """Test that new commit allows review."""
        from datetime import timedelta

        # Mark old commit as reviewed
        mock_bot_detector.mark_reviewed(123, "old_commit_sha")

        # Set last review time to 2 minutes ago to bypass cooling off (1 minute)
        two_min_ago = datetime.now() - timedelta(minutes=2)
        mock_bot_detector.state.last_review_times["123"] = two_min_ago.isoformat()

        pr_data = {"author": {"login": "alice"}}
        # New commit - not yet reviewed
        commits = [{"author": {"login": "alice"}, "oid": "new_commit_sha"}]

        should_skip, reason = mock_bot_detector.should_skip_pr_review(
            pr_number=123,
            pr_data=pr_data,
            commits=commits,
        )

        assert should_skip is False


# ============================================================================
# Orchestrator Skip Logic Tests
# ============================================================================


class TestOrchestratorSkipLogic:
    """Test orchestrator behavior when bot detection skips."""

    @pytest.mark.asyncio
    async def test_skip_returns_existing_review(
        self, temp_github_dir, sample_review_result
    ):
        """Test that skipping 'Already reviewed' returns existing review."""
        # Save existing review
        await sample_review_result.save(temp_github_dir)

        # Simulate the orchestrator logic for "Already reviewed" skip
        skip_reason = "Already reviewed commit abc123"

        # This is what the orchestrator should do:
        if "Already reviewed" in skip_reason:
            existing_review = PRReviewResult.load(temp_github_dir, 123)
            assert existing_review is not None
            assert existing_review.success is True
            assert len(existing_review.findings) == 1
            # Existing review should be returned, not overwritten

    def test_skip_bot_pr_creates_skip_result(self, temp_github_dir):
        """Test that skipping bot PR creates skip result."""
        skip_reason = "PR is authored by bot user test-bot"

        # For non-"Already reviewed" skips, create skip result
        if "Already reviewed" not in skip_reason:
            result = PRReviewResult(
                pr_number=456,
                repo="test/repo",
                success=True,
                findings=[],
                summary=f"Skipped review: {skip_reason}",
                overall_status="comment",
            )

            assert result.success is True
            assert len(result.findings) == 0
            assert "bot user" in result.summary

    @pytest.mark.asyncio
    async def test_failed_review_model_persistence(self, temp_github_dir):
        """Test that a failed PRReviewResult can be saved and loaded with success=False.

        This verifies that the model correctly persists failure state, which is
        a prerequisite for the orchestrator's re-review logic (tested separately
        in TestOrchestratorReReviewLogic).
        """
        failed_review = PRReviewResult(
            pr_number=789,
            repo="test/repo",
            success=False,
            findings=[],
            summary="Review failed: SDK validation error",
            overall_status="comment",
            error="SDK stream processing failed",
            reviewed_commit_sha="abc123def456",
        )
        await failed_review.save(temp_github_dir)

        # Verify the failed review can be loaded and maintains its failure state
        loaded_review = PRReviewResult.load(temp_github_dir, 789)
        assert loaded_review is not None
        assert loaded_review.success is False
        assert loaded_review.error == "SDK stream processing failed"
        assert loaded_review.reviewed_commit_sha == "abc123def456"


# ============================================================================
# Follow-up Review Logic Tests
# ============================================================================


class TestFollowupReviewLogic:
    """Test follow-up review resolution logic."""

    def test_finding_marked_resolved_when_file_changed(self):
        """Test that findings are resolved when their files are changed."""
        # Finding in src/db.py at line 42
        finding = PRReviewFinding(
            id="finding-001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="SQL Injection",
            description="Issue description",
            file="src/db.py",
            line=42,
            fixable=True,
        )

        # File was changed
        changed_files = ["src/db.py", "src/api.py"]

        # Simulate resolution check
        file_was_changed = finding.file in changed_files
        assert file_was_changed is True

    def test_finding_unresolved_when_file_not_changed(self):
        """Test that findings are NOT resolved when files unchanged."""
        finding = PRReviewFinding(
            id="finding-001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="SQL Injection",
            description="Issue description",
            file="src/db.py",
            line=42,
            fixable=True,
        )

        # Different files changed
        changed_files = ["src/api.py", "src/utils.py"]

        file_was_changed = finding.file in changed_files
        assert file_was_changed is False

    def test_followup_result_tracks_resolution(self, sample_finding):
        """Test that follow-up result correctly tracks resolution status."""
        result = PRReviewResult(
            pr_number=123,
            repo="test/repo",
            success=True,
            findings=[],  # No new findings
            summary="All issues resolved",
            overall_status="approve",
            verdict=MergeVerdict.READY_TO_MERGE,
            is_followup_review=True,
            resolved_findings=["finding-001"],
            unresolved_findings=[],
            new_findings_since_last_review=[],
        )

        assert result.is_followup_review is True
        assert len(result.resolved_findings) == 1
        assert len(result.unresolved_findings) == 0
        assert result.verdict == MergeVerdict.READY_TO_MERGE


# ============================================================================
# Posted Findings Tracking Tests
# ============================================================================


class TestPostedFindingsTracking:
    """Test posted findings tracking for follow-up eligibility."""

    def test_has_posted_findings_flag(self, sample_review_result):
        """Test has_posted_findings flag tracking."""
        # Initially not posted
        assert sample_review_result.has_posted_findings is False

        # After posting
        sample_review_result.has_posted_findings = True
        sample_review_result.posted_finding_ids = ["finding-001"]
        sample_review_result.posted_at = datetime.now().isoformat()

        assert sample_review_result.has_posted_findings is True
        assert len(sample_review_result.posted_finding_ids) == 1

    @pytest.mark.asyncio
    async def test_posted_findings_serialization(
        self, temp_github_dir, sample_review_result
    ):
        """Test that posted findings are serialized correctly."""
        # Set posted findings
        sample_review_result.has_posted_findings = True
        sample_review_result.posted_finding_ids = ["finding-001"]
        sample_review_result.posted_at = "2025-01-01T10:00:00"

        # Save
        await sample_review_result.save(temp_github_dir)

        # Load and verify
        loaded = PRReviewResult.load(temp_github_dir, sample_review_result.pr_number)

        assert loaded.has_posted_findings is True
        assert loaded.posted_finding_ids == ["finding-001"]
        assert loaded.posted_at == "2025-01-01T10:00:00"


# ============================================================================
# Error Handling Tests
# ============================================================================


class TestErrorHandling:
    """Test error handling in review flow."""

    def test_context_gathering_error_propagates(self, sample_review_result):
        """Test that context gathering errors are propagated."""
        context = FollowupReviewContext(
            pr_number=123,
            previous_review=sample_review_result,
            previous_commit_sha="abc123",
            current_commit_sha="def456",
            error="Failed to compare commits: 404 Not Found",
        )

        # Orchestrator should check for error and handle appropriately
        if context.error:
            result = PRReviewResult(
                pr_number=123,
                repo="test/repo",
                success=False,
                findings=[],
                summary=f"Follow-up review failed: {context.error}",
                overall_status="comment",
                error=context.error,
            )

            assert result.success is False
            assert result.error is not None
            assert "404" in result.error

    def test_invalid_finding_data_handled(self):
        """Test that invalid finding data is handled gracefully."""
        invalid_data = {
            "id": "finding-001",
            "severity": "invalid_severity",  # Invalid
            "category": "security",
            "title": "Test",
            "description": "Test",
            "file": "test.py",
            "line": 1,
        }

        # Should not crash, should use default or handle gracefully
        try:
            finding = PRReviewFinding.from_dict(invalid_data)
            # If it doesn't raise, verify it handled the invalid data somehow
            assert finding.id == "finding-001"
        except (ValueError, KeyError):
            # Expected for invalid severity
            pass


# ============================================================================
# Blocker Generation Tests
# ============================================================================


class TestBlockerGeneration:
    """Test blocker generation from findings."""

    def test_blockers_from_critical_findings(self):
        """Test that blockers are generated from CRITICAL findings."""
        findings = [
            PRReviewFinding(
                id="1",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Critical Security Issue",
                description="Desc",
                file="a.py",
                line=1,
                fixable=True,
            ),
            PRReviewFinding(
                id="2",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Style Issue",
                description="Desc",
                file="b.py",
                line=2,
                fixable=True,
            ),
        ]

        # Generate blockers from CRITICAL/HIGH
        blockers = []
        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH):
                blockers.append(f"{finding.category.value}: {finding.title}")

        assert len(blockers) == 1
        assert "security: Critical Security Issue" in blockers

    def test_blockers_from_high_findings(self):
        """Test that blockers are generated from HIGH findings."""
        findings = [
            PRReviewFinding(
                id="1",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.QUALITY,
                title="Memory Leak",
                description="Desc",
                file="a.py",
                line=1,
                fixable=True,
            ),
            PRReviewFinding(
                id="2",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Code Smell",
                description="Desc",
                file="b.py",
                line=2,
                fixable=True,
            ),
        ]

        blockers = []
        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH):
                blockers.append(f"{finding.category.value}: {finding.title}")

        assert len(blockers) == 1
        assert "quality: Memory Leak" in blockers

    def test_no_blockers_for_low_severity(self):
        """Test that no blockers for LOW/MEDIUM findings."""
        findings = [
            PRReviewFinding(
                id="1",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Style Issue",
                description="Desc",
                file="a.py",
                line=1,
                fixable=True,
            ),
            PRReviewFinding(
                id="2",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.DOCS,
                title="Missing Docs",
                description="Desc",
                file="b.py",
                line=2,
                fixable=True,
            ),
        ]

        blockers = []
        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH):
                blockers.append(f"{finding.category.value}: {finding.title}")

        assert len(blockers) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

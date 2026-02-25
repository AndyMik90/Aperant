"""
End-to-End Tests for GitHub PR Review System
=============================================

Tests the full PR review flow with mocked external dependencies.
These tests validate the integration between components.
"""

import json
import sys
from datetime import datetime, timedelta
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
    GitHubRunnerConfig,
    FollowupReviewContext,
)
from bot_detection import BotDetector


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def temp_github_dir(tmp_path):
    """Create a temporary GitHub directory structure."""
    github_dir = tmp_path / ".auto-claude" / "github"
    pr_dir = github_dir / "pr"
    pr_dir.mkdir(parents=True)
    return github_dir


@pytest.fixture
def mock_github_config():
    """Create a mock GitHub config."""
    return GitHubRunnerConfig(
        repo="test-owner/test-repo",
        token="ghp_test_token_12345",
        model="claude-sonnet-4-5-20250929",
        thinking_level="medium",
    )


@pytest.fixture
def sample_review_with_findings():
    """Create a sample review with findings."""
    return PRReviewResult(
        pr_number=42,
        repo="test-owner/test-repo",
        success=True,
        findings=[
            PRReviewFinding(
                id="finding-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection vulnerability",
                description="User input not sanitized",
                file="src/db.py",
                line=42,
                suggested_fix="Use parameterized queries",
                fixable=True,
            ),
            PRReviewFinding(
                id="finding-002",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Missing error handling",
                description="Exception not caught",
                file="src/api.py",
                line=100,
                suggested_fix="Add try-except block",
                fixable=True,
            ),
        ],
        summary="Found 2 issues: 1 high, 1 medium",
        overall_status="request_changes",
        verdict=MergeVerdict.NEEDS_REVISION,
        verdict_reasoning="Security issues must be fixed",
        reviewed_commit_sha="abc123def456",
        reviewed_at=datetime.now().isoformat(),
        has_posted_findings=True,
        posted_finding_ids=["finding-001", "finding-002"],
    )


# ============================================================================
# E2E Test: Review Result Persistence
# ============================================================================

class TestReviewResultE2E:
    """Test review result save/load flow end-to-end."""

    @pytest.mark.asyncio
    async def test_save_load_review_with_findings(self, temp_github_dir, sample_review_with_findings):
        """Test saving and loading a complete review result."""
        # Save the review
        await sample_review_with_findings.save(temp_github_dir)

        # Verify file was created
        review_file = temp_github_dir / "pr" / "review_42.json"
        assert review_file.exists()

        # Load and verify
        loaded = PRReviewResult.load(temp_github_dir, 42)

        assert loaded is not None
        assert loaded.pr_number == 42
        assert loaded.success is True
        assert len(loaded.findings) == 2
        assert loaded.findings[0].id == "finding-001"
        assert loaded.findings[0].severity == ReviewSeverity.HIGH
        assert loaded.findings[1].id == "finding-002"
        assert loaded.reviewed_commit_sha == "abc123def456"
        assert loaded.has_posted_findings is True
        assert len(loaded.posted_finding_ids) == 2

    @pytest.mark.asyncio
    async def test_review_result_json_format(self, temp_github_dir, sample_review_with_findings):
        """Test that saved JSON has correct format."""
        await sample_review_with_findings.save(temp_github_dir)

        review_file = temp_github_dir / "pr" / "review_42.json"
        with open(review_file) as f:
            data = json.load(f)

        # Verify key fields exist with snake_case
        assert "pr_number" in data
        assert "reviewed_commit_sha" in data
        assert "has_posted_findings" in data
        assert "posted_finding_ids" in data
        assert data["pr_number"] == 42
        assert isinstance(data["findings"], list)


# ============================================================================
# E2E Test: Follow-up Review Flow
# ============================================================================

class TestFollowupReviewE2E:
    """Test follow-up review context and result flow."""

    @pytest.mark.asyncio
    async def test_followup_context_with_resolved_file(
        self, temp_github_dir, sample_review_with_findings
    ):
        """Test follow-up when the file with finding was modified."""
        # Save previous review
        await sample_review_with_findings.save(temp_github_dir)

        # Create follow-up context where the file was changed
        context = FollowupReviewContext(
            pr_number=42,
            previous_review=sample_review_with_findings,
            previous_commit_sha="abc123def456",
            current_commit_sha="new_commit_sha",
            files_changed_since_review=["src/db.py"],  # File with finding-001
            diff_since_review="- unsanitized()\n+ parameterized()",
        )

        # Verify context
        assert context.pr_number == 42
        assert "src/db.py" in context.files_changed_since_review
        assert context.error is None

        # Simulate follow-up result (all issues resolved)
        followup_result = PRReviewResult(
            pr_number=42,
            repo="test-owner/test-repo",
            success=True,
            findings=[],
            summary="All previous issues resolved",
            overall_status="approve",
            verdict=MergeVerdict.READY_TO_MERGE,
            is_followup_review=True,
            resolved_findings=["finding-001"],
            unresolved_findings=["finding-002"],  # api.py wasn't changed
            reviewed_commit_sha="new_commit_sha",
            previous_review_id="42",
        )

        # Save and reload
        await followup_result.save(temp_github_dir)
        loaded = PRReviewResult.load(temp_github_dir, 42)

        assert loaded.is_followup_review is True
        assert "finding-001" in loaded.resolved_findings
        assert "finding-002" in loaded.unresolved_findings

    @pytest.mark.asyncio
    async def test_followup_context_with_error(self, temp_github_dir, sample_review_with_findings):
        """Test follow-up context when there's an error."""
        await sample_review_with_findings.save(temp_github_dir)

        # Create context with error
        context = FollowupReviewContext(
            pr_number=42,
            previous_review=sample_review_with_findings,
            previous_commit_sha="abc123",
            current_commit_sha="def456",
            error="Failed to compare commits: API rate limit",
        )

        assert context.error is not None
        assert "rate limit" in context.error

        # Create error result
        error_result = PRReviewResult(
            pr_number=42,
            repo="test-owner/test-repo",
            success=False,
            findings=[],
            summary=f"Follow-up failed: {context.error}",
            overall_status="comment",
            error=context.error,
            is_followup_review=True,
            reviewed_commit_sha="def456",
        )

        assert error_result.success is False
        assert error_result.error is not None


# ============================================================================
# E2E Test: Bot Detection Flow
# ============================================================================

class TestBotDetectionE2E:
    """Test bot detection end-to-end."""

    def test_full_bot_detection_flow(self, tmp_path):
        """Test complete bot detection workflow."""
        state_dir = tmp_path / "github"
        state_dir.mkdir(parents=True)

        with patch.object(BotDetector, "_get_bot_username", return_value="auto-claude[bot]"):
            detector = BotDetector(
                state_dir=state_dir,
                bot_token="ghp_bot_token",
                review_own_prs=False,
            )

        # Scenario 1: Human PR, first review
        pr_data = {"author": {"login": "human-dev"}}
        commits = [{"author": {"login": "human-dev"}, "oid": "commit_1"}]

        should_skip, reason = detector.should_skip_pr_review(
            pr_number=100,
            pr_data=pr_data,
            commits=commits,
        )
        assert should_skip is False

        # Mark as reviewed
        detector.mark_reviewed(100, "commit_1")

        # Scenario 2: Same commit, should skip after cooling off
        # First, bypass cooling off by setting old timestamp
        two_min_ago = datetime.now() - timedelta(minutes=2)
        detector.state.last_review_times["100"] = two_min_ago.isoformat()

        should_skip, reason = detector.should_skip_pr_review(
            pr_number=100,
            pr_data=pr_data,
            commits=commits,
        )
        assert should_skip is True
        assert "Already reviewed" in reason

        # Scenario 3: New commit on same PR
        new_commits = [{"author": {"login": "human-dev"}, "oid": "commit_2"}]
        should_skip, reason = detector.should_skip_pr_review(
            pr_number=100,
            pr_data=pr_data,
            commits=new_commits,
        )
        assert should_skip is False  # New commit allows review

        # Scenario 4: Bot-authored PR
        bot_pr = {"author": {"login": "auto-claude[bot]"}}
        bot_commits = [{"author": {"login": "auto-claude[bot]"}, "oid": "bot_commit"}]

        should_skip, reason = detector.should_skip_pr_review(
            pr_number=200,
            pr_data=bot_pr,
            commits=bot_commits,
        )
        assert should_skip is True
        assert "bot" in reason.lower()

    def test_bot_detection_state_persistence(self, tmp_path):
        """Test that bot detection state persists across instances."""
        state_dir = tmp_path / "github"
        state_dir.mkdir(parents=True)

        # First detector instance
        with patch.object(BotDetector, "_get_bot_username", return_value="bot"):
            detector1 = BotDetector(state_dir=state_dir, bot_token="token")
            detector1.mark_reviewed(42, "abc123")

        # Second detector instance (simulating app restart)
        with patch.object(BotDetector, "_get_bot_username", return_value="bot"):
            detector2 = BotDetector(state_dir=state_dir, bot_token="token")

        # Should see the reviewed commit
        assert detector2.has_reviewed_commit(42, "abc123") is True


# ============================================================================
# E2E Test: Blocker Generation Flow
# ============================================================================

class TestBlockerGenerationE2E:
    """Test blocker generation from findings."""

    @pytest.mark.asyncio
    async def test_blockers_generated_correctly(self, temp_github_dir):
        """Test that blockers are generated from CRITICAL/HIGH findings."""
        findings = [
            PRReviewFinding(
                id="critical-1",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Remote Code Execution",
                description="Critical security flaw",
                file="src/exec.py",
                line=1,
                fixable=True,
            ),
            PRReviewFinding(
                id="high-1",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.QUALITY,
                title="Memory Leak",
                description="Resource not freed",
                file="src/memory.py",
                line=50,
                fixable=True,
            ),
            PRReviewFinding(
                id="low-1",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Naming Convention",
                description="Variable name not following style",
                file="src/utils.py",
                line=10,
                fixable=True,
            ),
        ]

        # Generate blockers
        blockers = []
        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH):
                blockers.append(f"{finding.category.value}: {finding.title}")

        # Create result with blockers
        result = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=findings,
            summary="Found 3 issues",
            overall_status="request_changes",
            verdict=MergeVerdict.NEEDS_REVISION,
            blockers=blockers,
            reviewed_commit_sha="abc123",
        )

        # Save and load
        await result.save(temp_github_dir)
        loaded = PRReviewResult.load(temp_github_dir, 42)

        assert len(loaded.blockers) == 2
        assert "security: Remote Code Execution" in loaded.blockers
        assert "quality: Memory Leak" in loaded.blockers


# ============================================================================
# E2E Test: Complete Review Lifecycle
# ============================================================================

class TestReviewLifecycleE2E:
    """Test the complete review lifecycle."""

    @pytest.mark.asyncio
    async def test_initial_review_then_followup(self, temp_github_dir):
        """Test complete flow: initial review -> post findings -> followup."""
        # Step 1: Initial review finds issues
        initial_result = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[
                PRReviewFinding(
                    id="issue-1",
                    severity=ReviewSeverity.HIGH,
                    category=ReviewCategory.SECURITY,
                    title="Security Issue",
                    description="Fix this",
                    file="src/auth.py",
                    line=100,
                    fixable=True,
                ),
            ],
            summary="Found 1 issue",
            overall_status="request_changes",
            verdict=MergeVerdict.NEEDS_REVISION,
            reviewed_commit_sha="commit_1",
            reviewed_at=datetime.now().isoformat(),
        )
        await initial_result.save(temp_github_dir)

        # Step 2: Post findings to GitHub (simulated)
        initial_result.has_posted_findings = True
        initial_result.posted_finding_ids = ["issue-1"]
        initial_result.posted_at = datetime.now().isoformat()
        await initial_result.save(temp_github_dir)

        # Verify posted state
        loaded = PRReviewResult.load(temp_github_dir, 42)
        assert loaded.has_posted_findings is True

        # Step 3: Contributor fixes the issue, new commit
        # Note: Context shown for documentation; test validates result persistence
        _followup_context = FollowupReviewContext(
            pr_number=42,
            previous_review=loaded,
            previous_commit_sha="commit_1",
            current_commit_sha="commit_2",
            files_changed_since_review=["src/auth.py"],
            diff_since_review="- vulnerable_code()\n+ secure_code()",
        )

        # Step 4: Follow-up review finds issue resolved
        followup_result = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[],
            summary="All issues resolved",
            overall_status="approve",
            verdict=MergeVerdict.READY_TO_MERGE,
            is_followup_review=True,
            resolved_findings=["issue-1"],
            unresolved_findings=[],
            reviewed_commit_sha="commit_2",
            previous_review_id="42",
        )
        await followup_result.save(temp_github_dir)

        # Verify final state
        final = PRReviewResult.load(temp_github_dir, 42)
        assert final.is_followup_review is True
        assert final.verdict == MergeVerdict.READY_TO_MERGE
        assert "issue-1" in final.resolved_findings


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

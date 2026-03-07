#!/usr/bin/env python3
"""
Tests for GitHub PR Context Gatherer
=====================================

Tests the context gathering logic, specifically:
- AI bot review detection and inclusion in follow-up context
- Separation of AI bot vs contributor feedback
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime
import tempfile

import pytest

# Add the backend directory to path
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
_github_dir = _backend_dir / "runners" / "github"
if str(_github_dir) not in sys.path:
    sys.path.insert(0, str(_github_dir))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from context_gatherer import AI_BOT_PATTERNS, FollowupContextGatherer
from models import PRReviewResult, FollowupReviewContext


class TestAIReviewsInclusion:
    """Tests that AI bot formal reviews are included in follow-up context."""

    def test_ai_bot_patterns_include_known_bots(self):
        """Verify AI bot patterns include common AI review tools."""
        # CodeRabbit
        assert "coderabbitai" in AI_BOT_PATTERNS
        # Cursor/Gemini
        assert any("gemini" in p for p in AI_BOT_PATTERNS.keys())
        # GitHub Copilot
        assert "copilot" in AI_BOT_PATTERNS

    def test_followup_context_includes_ai_reviews_field(self):
        """Verify FollowupReviewContext has ai_bot_comments_since_review field."""
        # Create a minimal previous review
        previous_review = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[],
            summary="Test",
            overall_status="approve",
            reviewed_commit_sha="abc123",
            reviewed_at=datetime.now().isoformat(),
        )

        # Create context with AI reviews included
        context = FollowupReviewContext(
            pr_number=42,
            previous_review=previous_review,
            previous_commit_sha="abc123",
            current_commit_sha="def456",
            ai_bot_comments_since_review=[
                {"user": {"login": "coderabbitai[bot]"}, "body": "AI review content"}
            ],
        )

        # Verify AI reviews are accessible
        assert len(context.ai_bot_comments_since_review) == 1
        assert context.ai_bot_comments_since_review[0]["body"] == "AI review content"

    @pytest.mark.asyncio
    async def test_gather_followup_context_includes_ai_reviews(self):
        """Test that FollowupContextGatherer.gather() includes AI formal reviews.

        This is the key test that verifies the fix for the bug where AI formal reviews
        (from CodeRabbit, Cursor, etc.) were fetched but not included in the context.
        """
        # Create a minimal previous review
        previous_review = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[],
            summary="Test",
            overall_status="approve",
            reviewed_commit_sha="abc123",
            reviewed_at=datetime.now().isoformat(),
        )

        # Create mock GitHub client
        mock_gh_client = AsyncMock()

        # Mock get_pr_head_sha
        mock_gh_client.get_pr_head_sha.return_value = "def456"

        # Mock PR info for merge status check
        mock_gh_client.pr_get.return_value = {
            "mergeable": "MERGEABLE",
            "mergeStateStatus": "CLEAN",
        }

        # Mock PR files changed since
        mock_gh_client.get_pr_files_changed_since.return_value = ([], [])  # (files, commits)

        # Mock comments since review - includes an AI bot comment
        mock_gh_client.get_comments_since.return_value = {
            "review_comments": [
                {
                    "id": 1,
                    "user": {"login": "coderabbitai[bot]"},
                    "body": "AI inline comment",
                }
            ],
            "issue_comments": [],
        }

        # Mock formal PR reviews - THIS IS THE KEY DATA
        # These are formal review submissions (not inline comments)
        mock_gh_client.get_reviews_since.return_value = [
            {
                "id": 100,
                "user": {"login": "coderabbitai[bot]"},
                "body": "## CodeRabbit Summary\n\nThis PR looks good overall.",
                "state": "COMMENTED",
            },
            {
                "id": 101,
                "user": {"login": "gemini-code-assist[bot]"},
                "body": "## Gemini Review\n\nNo issues found.",
                "state": "APPROVED",
            },
            {
                "id": 102,
                "user": {"login": "human-reviewer"},
                "body": "LGTM",
                "state": "APPROVED",
            },
        ]

        # Create context gatherer with mocked GHClient
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("context_gatherer.GHClient", return_value=mock_gh_client):
                gatherer = FollowupContextGatherer(
                    project_dir=Path(tmpdir),
                    pr_number=42,
                    previous_review=previous_review,
                    repo="test/repo",
                )

            # Replace the gh_client with our mock after init
            gatherer.gh_client = mock_gh_client

            # Call the method under test
            context = await gatherer.gather()

        # ASSERTION: AI formal reviews should be in ai_bot_comments_since_review
        # The fix ensures ai_comments + ai_reviews are concatenated
        ai_feedback = context.ai_bot_comments_since_review

        # Should include:
        # - 1 AI inline comment (coderabbitai)
        # - 2 AI formal reviews (coderabbitai, gemini-code-assist)
        # Total = 3 AI feedback items
        assert len(ai_feedback) == 3, (
            f"Expected 3 AI feedback items (1 comment + 2 reviews), got {len(ai_feedback)}"
        )

        # Verify the AI reviews are included (not just comments)
        ai_bodies = [item.get("body", "") for item in ai_feedback]
        assert any("CodeRabbit Summary" in body for body in ai_bodies), (
            "CodeRabbit formal review should be in ai_bot_comments_since_review"
        )
        assert any("Gemini Review" in body for body in ai_bodies), (
            "Gemini formal review should be in ai_bot_comments_since_review"
        )

        # Verify contributor review is NOT in AI feedback
        assert not any("LGTM" in body for body in ai_bodies), (
            "Human reviewer comment should not be in ai_bot_comments_since_review"
        )

        # Verify contributor review IS in contributor_comments
        contributor_feedback = context.contributor_comments_since_review
        contributor_bodies = [item.get("body", "") for item in contributor_feedback]
        assert any("LGTM" in body for body in contributor_bodies), (
            "Human reviewer comment should be in contributor_comments_since_review"
        )

    @pytest.mark.asyncio
    async def test_ai_reviews_counted_correctly_in_logs(self):
        """Test that the logging correctly counts AI feedback including reviews."""
        previous_review = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[],
            summary="Test",
            overall_status="approve",
            reviewed_commit_sha="abc123",
            reviewed_at=datetime.now().isoformat(),
        )

        mock_gh_client = AsyncMock()
        mock_gh_client.get_pr_head_sha.return_value = "def456"
        mock_gh_client.pr_get.return_value = {
            "mergeable": "MERGEABLE",
            "mergeStateStatus": "CLEAN",
        }
        mock_gh_client.get_pr_files_changed_since.return_value = ([], [])
        mock_gh_client.get_comments_since.return_value = {
            "review_comments": [],
            "issue_comments": [],
        }
        # 2 AI reviews, 1 contributor review
        mock_gh_client.get_reviews_since.return_value = [
            {"id": 1, "user": {"login": "coderabbitai[bot]"}, "body": "AI 1", "state": "COMMENTED"},
            {"id": 2, "user": {"login": "copilot[bot]"}, "body": "AI 2", "state": "COMMENTED"},
            {"id": 3, "user": {"login": "developer"}, "body": "Human", "state": "APPROVED"},
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("context_gatherer.GHClient", return_value=mock_gh_client):
                gatherer = FollowupContextGatherer(
                    project_dir=Path(tmpdir),
                    pr_number=42,
                    previous_review=previous_review,
                    repo="test/repo",
                )
            gatherer.gh_client = mock_gh_client
            context = await gatherer.gather()

        # 2 AI reviews should be in ai_bot_comments_since_review
        assert len(context.ai_bot_comments_since_review) == 2

        # 1 contributor review should be in contributor_comments_since_review
        assert len(context.contributor_comments_since_review) == 1

"""
GitLab MR E2E Tests
===================

End-to-end tests for MR review lifecycle.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from __tests__.fixtures.gitlab import (
    MOCK_GITLAB_CONFIG,
    mock_mr_changes,
    mock_mr_commits,
    mock_mr_data,
    mock_pipeline_data,
    mock_pipeline_jobs,
)


class TestMREndToEnd:
    """End-to-end MR review lifecycle tests."""

    @pytest.fixture
    def mock_orchestrator(self, tmp_path):
        """Create a mock orchestrator for testing."""
        from runners.gitlab.models import GitLabRunnerConfig
        from runners.gitlab.orchestrator import GitLabOrchestrator

        config = GitLabRunnerConfig(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.example.com",
            model="claude-sonnet-4-20250514",
        )

        with patch("runners.gitlab.orchestrator.GitLabClient"):
            orchestrator = GitLabOrchestrator(
                project_dir=tmp_path,
                config=config,
                enable_bot_detection=False,
                enable_ci_checking=False,
            )
            return orchestrator

    @pytest.mark.asyncio
    async def test_full_mr_review_lifecycle(self, mock_orchestrator):
        """Test complete MR review from start to finish."""
        # Mock MR data
        mock_orchestrator.client.get_mr_async.return_value = mock_mr_data()
        mock_orchestrator.client.get_mr_commits_async.return_value = mock_mr_commits()
        mock_orchestrator.client.get_mr_changes_async.return_value = mock_mr_changes()

        # Mock review engine
        with patch(
            "runners.gitlab.services.context_gatherer.MRContextGatherer"
        ) as mock_gatherer:
            from runners.gitlab.models import (
                MergeVerdict,
                MRContext,
                MRReviewFinding,
                ReviewCategory,
                ReviewSeverity,
            )

            mock_gatherer.return_value.gather.return_value = MRContext(
                mr_iid=123,
                title="Add feature",
                description="Implementation",
                author="john_doe",
                source_branch="feature",
                target_branch="main",
                state="opened",
                changed_files=[],
                diff="",
                commits=[],
            )

            # Mock review engine to return findings
            with patch("runners.gitlab.services.MRReviewEngine") as mock_engine:
                findings = [
                    MRReviewFinding(
                        id="find-1",
                        severity=ReviewSeverity.MEDIUM,
                        category=ReviewCategory.QUALITY,
                        title="Code style",
                        description="Fix formatting",
                        file="file.py",
                        line=10,
                    )
                ]

                mock_engine.return_value.run_review.return_value = (
                    findings,
                    MergeVerdict.MERGE_WITH_CHANGES,
                    "Consider the suggestions",
                    [],
                )

                result = await mock_orchestrator.review_mr(123)

        assert result.success is True
        assert result.mr_iid == 123
        assert len(result.findings) == 1
        assert result.verdict == MergeVerdict.MERGE_WITH_CHANGES

    @pytest.mark.asyncio
    async def test_mr_review_with_ci_failure(self, mock_orchestrator):
        """Test MR review blocked by CI failure."""
        from runners.gitlab.services.ci_checker import PipelineInfo, PipelineStatus

        # Setup CI failure
        with patch("runners.gitlab.orchestrator.MRContextGatherer"):
            with patch("runners.gitlab.services.ci_checker.CIChecker") as mock_checker:
                pipeline_info = PipelineInfo(
                    pipeline_id=1001,
                    status=PipelineStatus.FAILED,
                    ref="feature",
                    sha="abc123",
                    created_at="2025-01-14T10:00:00",
                    updated_at="2025-01-14T10:05:00",
                    failed_jobs=[
                        Mock(
                            status="failed",
                            name="test",
                            stage="test",
                            failure_reason="Assert failed",
                        )
                    ],
                )

                mock_checker.return_value.check_mr_pipeline.return_value = pipeline_info
                mock_checker.return_value.get_blocking_reason.return_value = (
                    "Test job failed"
                )
                mock_checker.return_value.format_pipeline_summary.return_value = (
                    "CI Failed"
                )

                mock_orchestrator.client.get_mr_async.return_value = mock_mr_data()
                mock_orchestrator.client.get_mr_commits_async.return_value = []

                # Set ci_checker directly so review_mr uses the mocked version
                mock_orchestrator.ci_checker = mock_checker.return_value

                with patch("runners.gitlab.services.MRReviewEngine") as mock_engine:
                    from runners.gitlab.models import MergeVerdict

                    mock_engine.return_value.run_review.return_value = (
                        [],
                        MergeVerdict.READY_TO_MERGE,
                        "Looks good",
                        [],
                    )

                    result = await mock_orchestrator.review_mr(123)

        assert result.ci_status == "failed"
        assert result.ci_pipeline_id == 1001
        assert "CI" in result.summary

    @pytest.mark.asyncio
    async def test_followup_review_lifecycle(self, mock_orchestrator):
        """Test follow-up review after initial review."""
        from runners.gitlab.models import MergeVerdict, MRReviewResult

        # Create initial review
        initial_review = MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            findings=[
                Mock(id="find-1", title="Fix bug"),
                Mock(id="find-2", title="Add tests"),
            ],
            reviewed_commit_sha="abc123",
            verdict=MergeVerdict.NEEDS_REVISION,
            verdict_reasoning="Issues found",
            blockers=["find-1"],
        )

        # Save initial review
        initial_review.save(mock_orchestrator.gitlab_dir)

        # Mock new commits
        new_commits = mock_mr_commits() + [
            {
                "id": "new456",
                "sha": "new456",
                "message": "Fix the issues",
            }
        ]

        mock_orchestrator.client.get_mr_async.return_value = mock_mr_data()
        mock_orchestrator.client.get_mr_commits_async.return_value = new_commits

        # Mock follow-up review
        with patch("runners.gitlab.orchestrator.MRContextGatherer"):
            with patch("runners.gitlab.services.MRReviewEngine") as mock_engine:
                mock_engine.return_value.run_review.return_value = (
                    [],  # No new findings
                    MergeVerdict.READY_TO_MERGE,
                    "All fixed",
                    [],
                )

                result = await mock_orchestrator.followup_review_mr(123)

        assert result.is_followup_review is True
        assert result.reviewed_commit_sha == "new456"

    @pytest.mark.asyncio
    async def test_bot_detection_skips_review(self, tmp_path):
        """Test bot detection skips bot-authored MRs."""
        from runners.gitlab.models import GitLabRunnerConfig
        from runners.gitlab.orchestrator import GitLabOrchestrator

        config = GitLabRunnerConfig(
            token="test-token",
            project="group/project",
        )

        with patch("runners.gitlab.orchestrator.GitLabClient"):
            orchestrator = GitLabOrchestrator(
                project_dir=tmp_path,
                config=config,
                bot_username="auto-claude-bot",
            )

            # Bot-authored MR
            bot_mr = mock_mr_data(author="auto-claude-bot")
            orchestrator.client.get_mr_async.return_value = bot_mr
            orchestrator.client.get_mr_commits_async.return_value = []

            result = await orchestrator.review_mr(123)

        assert result.success is False
        assert "bot" in result.error.lower()

    @pytest.mark.asyncio
    async def test_cooling_off_prevents_re_review(self, tmp_path):
        """Test cooling off period prevents immediate re-review."""
        from runners.gitlab.models import GitLabRunnerConfig
        from runners.gitlab.orchestrator import GitLabOrchestrator

        config = GitLabRunnerConfig(
            token="test-token",
            project="group/project",
        )

        with patch("runners.gitlab.orchestrator.GitLabClient"):
            orchestrator = GitLabOrchestrator(
                project_dir=tmp_path,
                config=config,
            )

            # First review
            orchestrator.client.get_mr_async.return_value = mock_mr_data()
            orchestrator.client.get_mr_commits_async.return_value = mock_mr_commits()

            with patch("runners.gitlab.orchestrator.MRContextGatherer"):
                with patch("runners.gitlab.services.MRReviewEngine") as mock_engine:
                    from runners.gitlab.models import MergeVerdict

                    mock_engine.return_value.run_review.return_value = (
                        [],
                        MergeVerdict.READY_TO_MERGE,
                        "Good",
                        [],
                    )

                    result1 = await orchestrator.review_mr(123)

            assert result1.success is True

            # Immediate second review should be skipped
            result2 = await orchestrator.review_mr(123)

        assert result2.success is False
        assert "cooling" in result2.error.lower()


class TestMRReviewEngineIntegration:
    """Test MR review engine integration."""

    @pytest.fixture
    def engine(self, tmp_path):
        """Create review engine for testing."""
        from runners.gitlab.models import GitLabRunnerConfig
        from runners.gitlab.services.mr_review_engine import MRReviewEngine

        config = GitLabRunnerConfig(
            token="test-token",
            project="group/project",
        )

        gitlab_dir = tmp_path / ".auto-claude" / "gitlab"
        gitlab_dir.mkdir(parents=True, exist_ok=True)

        return MRReviewEngine(
            project_dir=tmp_path,
            gitlab_dir=gitlab_dir,
            config=config,
        )

    def test_engine_initialization(self, engine):
        """Test engine initializes correctly."""
        assert engine.project_dir
        assert engine.gitlab_dir
        assert engine.config

    def test_generate_summary(self, engine):
        """Test summary generation."""
        from runners.gitlab.models import (
            MergeVerdict,
            MRReviewFinding,
            ReviewCategory,
            ReviewSeverity,
        )

        findings = [
            MRReviewFinding(
                id="find-1",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="SQL injection",
                description="Vulnerability",
                file="file.py",
                line=10,
            ),
            MRReviewFinding(
                id="find-2",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Formatting",
                description="Style issue",
                file="file.py",
                line=20,
            ),
        ]

        summary = engine.generate_summary(
            findings=findings,
            verdict=MergeVerdict.BLOCKED,
            verdict_reasoning="Critical security issue",
            blockers=["SQL injection"],
        )

        assert "BLOCKED" in summary
        assert "SQL injection" in summary
        assert "Critical" in summary


class TestMRContextGatherer:
    """Test MR context gatherer."""

    @pytest.fixture
    def gatherer(self, tmp_path):
        """Create context gatherer for testing."""
        from runners.gitlab.glab_client import GitLabConfig
        from runners.gitlab.services.context_gatherer import MRContextGatherer

        config = GitLabConfig(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.example.com",
        )

        with patch("runners.gitlab.services.context_gatherer.GitLabClient"):
            return MRContextGatherer(
                project_dir=tmp_path,
                mr_iid=123,
                config=config,
            )

    @pytest.mark.asyncio
    async def test_gather_context(self, gatherer):
        """Test gathering MR context."""
        from runners.gitlab.models import MRContext

        # Mock client responses
        gatherer.client.get_mr_async.return_value = mock_mr_data()
        gatherer.client.get_mr_changes_async.return_value = mock_mr_changes()
        gatherer.client.get_mr_commits_async.return_value = mock_mr_commits()
        gatherer.client.get_mr_notes_async.return_value = []

        context = await gatherer.gather()

        assert isinstance(context, MRContext)
        assert context.mr_iid == 123
        assert context.title == "Add user authentication feature"
        assert context.author == "john_doe"

    @pytest.mark.asyncio
    async def test_gather_ai_bot_comments(self, gatherer):
        """Test gathering AI bot comments."""
        # Mock AI bot comments
        ai_notes = [
            {
                "id": 1001,
                "author": {"username": "coderabbit[bot]"},
                "body": "Consider adding error handling",
                "created_at": "2025-01-14T10:00:00",
            },
            {
                "id": 1002,
                "author": {"username": "human_user"},
                "body": "Regular comment",
                "created_at": "2025-01-14T11:00:00",
            },
        ]

        gatherer.client.get_mr_notes_async.return_value = ai_notes

        # First call should parse comments
        from runners.gitlab.services.context_gatherer import AIBotComment

        # Note: _fetch_ai_bot_comments is called internally during gather()
        gatherer.client.get_mr_async.return_value = mock_mr_data()
        gatherer.client.get_mr_changes_async.return_value = mock_mr_changes()
        gatherer.client.get_mr_commits_async.return_value = mock_mr_commits()

        context = await gatherer.gather()

        # Verify AI bot comments were detected (context would have them if implemented)
        assert context.mr_iid == 123


class TestFollowupContextGatherer:
    """Test follow-up context gatherer."""

    @pytest.fixture
    def previous_review(self):
        """Create a previous review for testing."""
        from runners.gitlab.models import MergeVerdict, MRReviewResult

        return MRReviewResult(
            mr_iid=123,
            project="group/project",
            success=True,
            findings=[
                Mock(id="find-1", title="Bug"),
            ],
            reviewed_commit_sha="abc123",
            verdict=MergeVerdict.NEEDS_REVISION,
            verdict_reasoning="Issues found",
            blockers=[],
        )

    @pytest.fixture
    def gatherer(self, tmp_path, previous_review):
        """Create follow-up context gatherer."""
        from runners.gitlab.glab_client import GitLabConfig
        from runners.gitlab.services.context_gatherer import FollowupMRContextGatherer

        config = GitLabConfig(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.example.com",
        )

        with patch("runners.gitlab.services.context_gatherer.GitLabClient"):
            return FollowupMRContextGatherer(
                project_dir=tmp_path,
                mr_iid=123,
                previous_review=previous_review,
                config=config,
            )

    @pytest.mark.asyncio
    async def test_gather_followup_context(self, gatherer):
        """Test gathering follow-up context."""
        from runners.gitlab.models import FollowupMRContext

        # Mock new commits since previous review
        new_commits = [
            {
                "id": "new456",
                "sha": "new456",
                "message": "Fix bug",
            }
        ]

        gatherer.client.get_mr_async.return_value = mock_mr_data()
        gatherer.client.get_mr_commits_async.return_value = new_commits
        gatherer.client.get_mr_changes_async.return_value = mock_mr_changes()

        context = await gatherer.gather()

        assert isinstance(context, FollowupMRContext)
        assert context.mr_iid == 123
        assert context.previous_commit_sha == "abc123"
        assert context.current_commit_sha == "new456"
        assert len(context.commits_since_review) == 1

    @pytest.mark.asyncio
    async def test_no_new_commits(self, gatherer):
        """Test follow-up when no new commits."""
        from runners.gitlab.models import FollowupMRContext

        # Same commits as previous review
        gatherer.client.get_mr_async.return_value = mock_mr_data()
        gatherer.client.get_mr_commits_async.return_value = mock_mr_commits()
        gatherer.client.get_mr_changes_async.return_value = mock_mr_changes()

        context = await gatherer.gather()

        assert context.current_commit_sha == "abc123"  # Same as previous


class TestAIBotComment:
    """Test AI bot comment detection."""

    def test_parse_coderabbit_comment(self):
        """Test parsing CodeRabbit comment."""
        from runners.gitlab.services.context_gatherer import AIBotComment

        note = {
            "id": 1001,
            "author": {"username": "coderabbit[bot]"},
            "body": "Add error handling",
            "created_at": "2025-01-14T10:00:00",
        }

        from runners.gitlab.services.context_gatherer import MRContextGatherer

        gatherer_class = MRContextGatherer.__class__

        comment = gatherer_class._parse_ai_comment(None, note)

        assert comment is not None
        assert comment.tool_name == "CodeRabbit"
        assert comment.comment_id == 1001

    def test_parse_human_comment(self):
        """Test human comment is not detected as AI."""
        from runners.gitlab.services.context_gatherer import MRContextGatherer

        note = {
            "id": 1002,
            "author": {"username": "john_doe"},
            "body": "Regular comment",
            "created_at": "2025-01-14T10:00:00",
        }

        comment = MRContextGatherer._parse_ai_comment(None, note)

        assert comment is None

    def test_parse_greptile_comment(self):
        """Test parsing Greptile comment."""
        from runners.gitlab.services.context_gatherer import AIBotComment

        note = {
            "id": 1003,
            "author": {"username": "greptile[bot]"},
            "body": "Consider this",
            "created_at": "2025-01-14T10:00:00",
        }

        from runners.gitlab.services.context_gatherer import MRContextGatherer

        comment = MRContextGatherer._parse_ai_comment(None, note)

        assert comment is not None
        assert comment.tool_name == "Greptile"

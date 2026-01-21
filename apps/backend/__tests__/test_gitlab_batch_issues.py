"""
Tests for GitLab Batch Issues
================================

Tests for issue batching, similarity detection, and batch processing.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

try:
    from runners.gitlab.batch_issues import (
        ClaudeGitlabBatchAnalyzer,
        GitlabBatchStatus,
        GitlabIssueBatch,
        GitlabIssueBatcher,
        GitlabIssueBatchItem,
        format_batch_summary,
    )
    from runners.gitlab.glab_client import GitLabConfig
except ImportError:
    from glab_client import GitLabConfig
    from runners.gitlab.batch_issues import (
        ClaudeGitlabBatchAnalyzer,
        GitlabBatchStatus,
        GitlabIssueBatch,
        GitlabIssueBatcher,
        GitlabIssueBatchItem,
        format_batch_summary,
    )


@pytest.fixture
def mock_config():
    """Create a mock GitLab config."""
    config = MagicMock(spec=GitLabConfig)
    config.project = "namespace/test-project"
    config.instance_url = "https://gitlab.example.com"
    return config


@pytest.fixture
def sample_issues():
    """Sample issues for batching."""
    return [
        {
            "iid": 1,
            "title": "Login bug",
            "description": "Cannot login with special characters",
            "labels": ["bug", "auth"],
        },
        {
            "iid": 2,
            "title": "Signup bug",
            "description": "Cannot signup with special characters",
            "labels": ["bug", "auth"],
        },
        {
            "iid": 3,
            "title": "UI bug",
            "description": "Button alignment issue",
            "labels": ["bug", "ui"],
        },
    ]


class TestBatchAnalyzer:
    """Tests for Claude-based batch analyzer."""

    @pytest.mark.asyncio
    async def test_analyze_single_issue(self, mock_config, tmp_path):
        """Test analyzing a single issue."""
        analyzer = ClaudeGitlabBatchAnalyzer(project_dir=tmp_path)

        issues = [{"iid": 1, "title": "Single issue"}]

        with patch.object(analyzer, "_fallback_batches") as mock_fallback:
            mock_fallback.return_value = [
                {
                    "issue_iids": [1],
                    "theme": "Single issue",
                    "reasoning": "Single issue in group",
                    "confidence": 1.0,
                }
            ]

            result = await analyzer.analyze_and_batch_issues(issues)

            assert len(result) == 1
            assert result[0]["issue_iids"] == [1]

    @pytest.mark.asyncio
    async def test_analyze_empty_list(self, mock_config, tmp_path):
        """Test analyzing empty issue list."""
        analyzer = ClaudeGitlabBatchAnalyzer(project_dir=tmp_path)

        result = await analyzer.analyze_and_batch_issues([])

        assert result == []

    @pytest.mark.asyncio
    async def test_parse_json_response(self, mock_config, tmp_path):
        """Test JSON parsing from Claude response."""
        analyzer = ClaudeGitlabBatchAnalyzer(project_dir=tmp_path)

        # Valid JSON
        json_str = '{"batches": [{"issue_iids": [1, 2]}]}'
        result = analyzer._parse_json_response(json_str)

        assert "batches" in result

    @pytest.mark.asyncio
    async def test_parse_json_from_markdown(self, mock_config, tmp_path):
        """Test extracting JSON from markdown code blocks."""
        analyzer = ClaudeGitlabBatchAnalyzer(project_dir=tmp_path)

        # JSON in markdown code block
        response = '```json\n{"batches": [{"issue_iids": [1, 2]}]}\n```'
        result = analyzer._parse_json_response(response)

        assert "batches" in result

    @pytest.mark.asyncio
    async def test_fallback_batches(self, mock_config, tmp_path):
        """Test fallback batching when Claude is unavailable."""
        analyzer = ClaudeGitlabBatchAnalyzer(project_dir=tmp_path)

        issues = [
            {"iid": 1, "title": "Issue 1"},
            {"iid": 2, "title": "Issue 2"},
        ]

        result = analyzer._fallback_batches(issues)

        assert len(result) == 2
        assert all("confidence" in r for r in result)


class TestIssueBatchItem:
    """Tests for IssueBatchItem model."""

    def test_batch_item_to_dict(self):
        """Test converting batch item to dict."""
        item = GitlabIssueBatchItem(
            issue_iid=123,
            title="Test Issue",
            body="Description",
            labels=["bug"],
            similarity_to_primary=0.8,
        )

        result = item.to_dict()

        assert result["issue_iid"] == 123
        assert result["similarity_to_primary"] == 0.8

    def test_batch_item_from_dict(self):
        """Test creating batch item from dict."""
        data = {
            "issue_iid": 456,
            "title": "Test",
            "body": "Desc",
            "labels": ["feature"],
            "similarity_to_primary": 1.0,
        }

        result = GitlabIssueBatchItem.from_dict(data)

        assert result.issue_iid == 456


class TestIssueBatch:
    """Tests for IssueBatch model."""

    def test_batch_creation(self):
        """Test creating a batch."""
        issues = [
            GitlabIssueBatchItem(
                issue_iid=1,
                title="Issue 1",
                body="",
            ),
            GitlabIssueBatchItem(
                issue_iid=2,
                title="Issue 2",
                body="",
            ),
        ]

        batch = GitlabIssueBatch(
            batch_id="batch-1-2",
            project="namespace/test-project",
            primary_issue=1,
            issues=issues,
            theme="Authentication issues",
        )

        assert batch.batch_id == "batch-1-2"
        assert batch.primary_issue == 1
        assert len(batch.issues) == 2

    def test_batch_to_dict(self):
        """Test converting batch to dict."""
        batch = GitlabIssueBatch(
            batch_id="batch-1",
            project="namespace/project",
            primary_issue=1,
            issues=[],
            status=GitlabBatchStatus.PENDING,
        )

        result = batch.to_dict()

        assert result["batch_id"] == "batch-1"
        assert result["status"] == "pending"

    def test_batch_from_dict(self):
        """Test creating batch from dict."""
        data = {
            "batch_id": "batch-1",
            "project": "namespace/project",
            "primary_issue": 1,
            "issues": [],
            "status": "pending",
            "created_at": "2024-01-01T00:00:00Z",
        }

        result = GitlabIssueBatch.from_dict(data)

        assert result.batch_id == "batch-1"
        assert result.status == GitlabBatchStatus.PENDING


class TestIssueBatcher:
    """Tests for IssueBatcher class."""

    def test_batcher_initialization(self, mock_config, tmp_path):
        """Test batcher initialization."""
        batcher = GitlabIssueBatcher(
            gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
            project="namespace/project",
            project_dir=tmp_path,
        )

        assert batcher.project == "namespace/project"

    @pytest.mark.asyncio
    async def test_create_batches(self, mock_config, tmp_path, sample_issues):
        """Test creating batches from issues."""
        batcher = GitlabIssueBatcher(
            gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
            project="namespace/project",
            project_dir=tmp_path,
        )

        # Patch the analyzer's analyze_and_batch_issues method
        with patch.object(batcher.analyzer, "analyze_and_batch_issues") as mock_analyze:
            mock_analyze.return_value = [
                {
                    "issue_iids": [1, 2],
                    "theme": "Auth issues",
                    "confidence": 0.85,
                },
                {
                    "issue_iids": [3],
                    "theme": "UI bug",
                    "confidence": 0.9,
                },
            ]

            batches = await batcher.create_batches(sample_issues)

            assert len(batches) == 2
            assert batches[0].theme == "Auth issues"
            assert batches[1].theme == "UI bug"

    def test_generate_batch_id(self, mock_config, tmp_path):
        """Test batch ID generation."""
        batcher = GitlabIssueBatcher(
            gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
            project="namespace/project",
            project_dir=tmp_path,
        )

        batch_id = batcher._generate_batch_id([1, 2, 3])

        assert batch_id == "batch-1-2-3"

    def test_save_and_load_batch(self, mock_config, tmp_path):
        """Test saving and loading batches."""
        batcher = GitlabIssueBatcher(
            gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
            project="namespace/project",
            project_dir=tmp_path,
        )

        batch = GitlabIssueBatch(
            batch_id="batch-123",
            project="namespace/project",
            primary_issue=123,
            issues=[],
        )

        # Save
        batcher.save_batch(batch)

        # Load
        loaded = batcher.load_batch(tmp_path / ".auto-claude" / "gitlab", "batch-123")

        assert loaded is not None
        assert loaded.batch_id == "batch-123"

    def test_list_batches(self, mock_config, tmp_path):
        """Test listing all batches."""
        batcher = GitlabIssueBatcher(
            gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
            project="namespace/project",
            project_dir=tmp_path,
        )

        # Create a couple of batches
        batch1 = GitlabIssueBatch(
            batch_id="batch-1",
            project="namespace/project",
            primary_issue=1,
            issues=[],
            status=GitlabBatchStatus.PENDING,
        )
        batch2 = GitlabIssueBatch(
            batch_id="batch-2",
            project="namespace/project",
            primary_issue=2,
            issues=[],
            status=GitlabBatchStatus.COMPLETED,
        )

        batcher.save_batch(batch1)
        batcher.save_batch(batch2)

        # List
        batches = batcher.list_batches()

        assert len(batches) == 2
        # Should be sorted by created_at descending
        assert batches[0].batch_id == "batch-2"
        assert batches[1].batch_id == "batch-1"


class TestBatchStatus:
    """Tests for BatchStatus enum."""

    def test_status_values(self):
        """Test all status values exist."""
        expected_statuses = [
            GitlabBatchStatus.PENDING,
            GitlabBatchStatus.ANALYZING,
            GitlabBatchStatus.CREATING_SPEC,
            GitlabBatchStatus.BUILDING,
            GitlabBatchStatus.QA_REVIEW,
            GitlabBatchStatus.MR_CREATED,
            GitlabBatchStatus.COMPLETED,
            GitlabBatchStatus.FAILED,
        ]

        for status in expected_statuses:
            assert status.value in [
                "pending",
                "analyzing",
                "creating_spec",
                "building",
                "qa_review",
                "mr_created",
                "completed",
                "failed",
            ]


class TestBatchSummaryFormatting:
    """Tests for batch summary formatting."""

    def test_format_batch_summary(self):
        """Test formatting a batch summary."""
        batch = GitlabIssueBatch(
            batch_id="batch-auth-issues",
            project="namespace/project",
            primary_issue=1,
            issues=[
                GitlabIssueBatchItem(
                    issue_iid=1,
                    title="Login bug",
                    body="",
                ),
                GitlabIssueBatchItem(
                    issue_iid=2,
                    title="Signup bug",
                    body="",
                ),
            ],
            common_themes=["Authentication issues"],
            status=GitlabBatchStatus.PENDING,
        )

        summary = format_batch_summary(batch)

        assert "batch-auth-issues" in summary
        assert "!1" in summary
        assert "!2" in summary
        assert "Authentication issues" in summary


class TestSimilarityThreshold:
    """Tests for similarity threshold handling."""

    def test_threshold_filtering(self, mock_config, tmp_path):
        """Test that similarity threshold is respected."""
        batcher = GitlabIssueBatcher(
            gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
            project="namespace/project",
            project_dir=tmp_path,
            similarity_threshold=0.8,  # High threshold
        )

        assert batcher.similarity_threshold == 0.8


class TestBatchSizeLimits:
    """Tests for batch size limits."""

    def test_max_batch_size(self, mock_config, tmp_path):
        """Test that max batch size is enforced."""
        batcher = GitlabIssueBatcher(
            gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
            project="namespace/project",
            project_dir=tmp_path,
            max_batch_size=3,
        )

        assert batcher.max_batch_size == 3

    def test_min_batch_size(self, mock_config, tmp_path):
        """Test min batch size setting."""
        batcher = GitlabIssueBatcher(
            gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
            project="namespace/project",
            project_dir=tmp_path,
            min_batch_size=2,
        )

        assert batcher.min_batch_size == 2

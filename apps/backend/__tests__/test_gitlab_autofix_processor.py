"""
Tests for GitLab Auto-fix Processor
======================================

Tests for auto-fix workflow, permission verification, and state management.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

try:
    from runners.gitlab.autofix_processor import AutoFixProcessor
    from runners.gitlab.models import AutoFixState, AutoFixStatus, GitLabRunnerConfig
    from runners.gitlab.permissions import GitLabPermissionChecker
except ImportError:
    from models import AutoFixState, AutoFixStatus, GitLabRunnerConfig
    from runners.gitlab.autofix_processor import AutoFixProcessor
    from runners.gitlab.permissions import GitLabPermissionChecker


@pytest.fixture
def mock_config():
    """Create a mock GitLab config."""
    config = MagicMock(spec=GitLabRunnerConfig)
    config.project = "namespace/test-project"
    config.instance_url = "https://gitlab.example.com"
    config.auto_fix_enabled = True
    config.auto_fix_labels = ["auto-fix", "autofix"]
    config.token = "test-token"
    return config


@pytest.fixture
def mock_permission_checker():
    """Create a mock permission checker."""
    checker = MagicMock(spec=GitLabPermissionChecker)
    checker.verify_automation_trigger = AsyncMock()
    return checker


@pytest.fixture
def tmp_gitlab_dir(tmp_path):
    """Create a temporary GitLab directory."""
    gitlab_dir = tmp_path / ".auto-claude" / "gitlab"
    gitlab_dir.mkdir(parents=True, exist_ok=True)
    return gitlab_dir


@pytest.fixture
def processor(mock_config, mock_permission_checker, tmp_path, tmp_gitlab_dir):
    """Create an AutoFixProcessor instance."""
    return AutoFixProcessor(
        gitlab_dir=tmp_gitlab_dir,
        config=mock_config,
        permission_checker=mock_permission_checker,
        progress_callback=None,
    )


class TestProcessIssue:
    """Tests for issue processing."""

    @pytest.mark.asyncio
    async def test_process_issue_success(
        self, processor, mock_permission_checker, tmp_gitlab_dir
    ):
        """Test successful issue processing."""
        issue = {
            "iid": 123,
            "title": "Fix this bug",
            "description": "Please fix",
            "labels": ["auto-fix"],
        }

        mock_permission_checker.verify_automation_trigger.return_value = MagicMock(
            allowed=True,
            username="developer",
            role="MAINTAINER",
        )

        result = await processor.process_issue(
            issue_iid=123,
            issue=issue,
            trigger_label="auto-fix",
        )

        assert result.issue_iid == 123
        assert result.status == AutoFixStatus.CREATING_SPEC

    @pytest.mark.asyncio
    async def test_process_issue_permission_denied(
        self, processor, mock_permission_checker, tmp_gitlab_dir
    ):
        """Test issue processing with permission denied."""
        issue = {
            "iid": 456,
            "title": "Unauthorized fix",
            "labels": ["auto-fix"],
        }

        mock_permission_checker.verify_automation_trigger.return_value = MagicMock(
            allowed=False,
            username="outsider",
            role="NONE",
            reason="Not a maintainer",
        )

        with pytest.raises(PermissionError):
            await processor.process_issue(
                issue_iid=456,
                issue=issue,
                trigger_label="auto-fix",
            )

    @pytest.mark.asyncio
    async def test_process_issue_in_progress(
        self, processor, mock_permission_checker, tmp_gitlab_dir
    ):
        """Test that in-progress issues are not reprocessed."""
        issue = {
            "iid": 789,
            "title": "Already processing",
            "labels": ["auto-fix"],
        }

        # Create existing state in progress
        existing_state = AutoFixState(
            issue_iid=789,
            issue_url="https://gitlab.example.com/issue/789",
            project="namespace/test-project",
            status=AutoFixStatus.ANALYZING,
        )
        await existing_state.save(tmp_gitlab_dir)

        result = await processor.process_issue(
            issue_iid=789,
            issue=issue,
            trigger_label="auto-fix",
        )

        # Should return the existing state
        assert result.status == AutoFixStatus.ANALYZING


class TestCheckLabeledIssues:
    """Tests for checking labeled issues."""

    @pytest.mark.asyncio
    async def test_check_labeled_issues_finds_new(
        self, processor, mock_permission_checker
    ):
        """Test finding new labeled issues."""
        all_issues = [
            {
                "iid": 1,
                "title": "Has auto-fix label",
                "labels": ["auto-fix"],
            },
            {
                "iid": 2,
                "title": "Has autofix label",
                "labels": ["autofix"],
            },
            {
                "iid": 3,
                "title": "No label",
                "labels": [],
            },
        ]

        # Permission checks pass
        mock_permission_checker.verify_automation_trigger.return_value = MagicMock(
            allowed=True
        )

        result = await processor.check_labeled_issues(
            all_issues, verify_permissions=True
        )

        assert len(result) == 2
        assert result[0]["issue_iid"] == 1
        assert result[1]["issue_iid"] == 2

    @pytest.mark.asyncio
    async def test_check_labeled_issues_filters_in_queue(
        self, processor, mock_permission_checker, tmp_gitlab_dir
    ):
        """Test that issues already in queue are filtered out."""
        # Create existing state for issue 1
        existing_state = AutoFixState(
            issue_iid=1,
            issue_url="https://gitlab.example.com/issue/1",
            project="namespace/test-project",
            status=AutoFixStatus.ANALYZING,
        )
        await existing_state.save(tmp_gitlab_dir)

        all_issues = [
            {
                "iid": 1,
                "title": "Already in queue",
                "labels": ["auto-fix"],
            },
            {
                "iid": 2,
                "title": "New issue",
                "labels": ["auto-fix"],
            },
        ]

        mock_permission_checker.verify_automation_trigger.return_value = MagicMock(
            allowed=True
        )

        result = await processor.check_labeled_issues(
            all_issues, verify_permissions=True
        )

        # Should only return issue 2 (issue 1 is already in queue)
        assert len(result) == 1
        assert result[0]["issue_iid"] == 2

    @pytest.mark.asyncio
    async def test_check_labeled_issues_permission_filtering(
        self, processor, mock_permission_checker
    ):
        """Test that unauthorized issues are filtered out."""
        all_issues = [
            {
                "iid": 1,
                "title": "Authorized issue",
                "labels": ["auto-fix"],
            },
            {
                "iid": 2,
                "title": "Unauthorized issue",
                "labels": ["auto-fix"],
            },
        ]

        def make_permission_result(issue_iid, trigger_label):
            if issue_iid == 1:
                return MagicMock(allowed=True)
            else:
                return MagicMock(allowed=False, reason="Not authorized")

        mock_permission_checker.verify_automation_trigger.side_effect = (
            make_permission_result
        )

        result = await processor.check_labeled_issues(
            all_issues, verify_permissions=True
        )

        # Should only return issue 1
        assert len(result) == 1
        assert result[0]["issue_iid"] == 1


class TestGetQueue:
    """Tests for getting auto-fix queue."""

    @pytest.mark.asyncio
    async def test_get_queue_empty(self, processor, tmp_gitlab_dir):
        """Test getting queue when empty."""
        queue = await processor.get_queue()

        assert queue == []

    @pytest.mark.asyncio
    async def test_get_queue_with_items(self, processor, tmp_gitlab_dir):
        """Test getting queue with items."""
        # Create some states
        for i in [1, 2, 3]:
            state = AutoFixState(
                issue_iid=i,
                issue_url=f"https://gitlab.example.com/issue/{i}",
                project="namespace/test-project",
                status=AutoFixStatus.ANALYZING,
            )
            await state.save(tmp_gitlab_dir)

        queue = await processor.get_queue()

        assert len(queue) == 3


class TestAutoFixState:
    """Tests for AutoFixState model."""

    def test_state_creation(self, tmp_gitlab_dir):
        """Test creating and saving state."""
        state = AutoFixState(
            issue_iid=123,
            issue_url="https://gitlab.example.com/issue/123",
            project="namespace/test-project",
            status=AutoFixStatus.PENDING,
        )

        assert state.issue_iid == 123
        assert state.status == AutoFixStatus.PENDING

    def test_state_save_and_load(self, tmp_gitlab_dir):
        """Test saving and loading state."""
        state = AutoFixState(
            issue_iid=456,
            issue_url="https://gitlab.example.com/issue/456",
            project="namespace/test-project",
            status=AutoFixStatus.BUILDING,
        )

        # Save state
        import asyncio

        asyncio.run(state.save(tmp_gitlab_dir))

        # Load state
        loaded = AutoFixState.load(tmp_gitlab_dir, 456)

        assert loaded is not None
        assert loaded.issue_iid == 456
        assert loaded.status == AutoFixStatus.BUILDING

    def test_state_transition_validation(self, tmp_gitlab_dir):
        """Test that invalid state transitions are rejected."""
        state = AutoFixState(
            issue_iid=789,
            issue_url="https://gitlab.example.com/issue/789",
            project="namespace/test-project",
            status=AutoFixStatus.PENDING,
        )

        # Valid transition
        state.update_status(AutoFixStatus.ANALYZING)  # Should work

        # Invalid transition
        with pytest.raises(ValueError):
            state.update_status(AutoFixStatus.COMPLETED)  # Can't skip to completed


class TestProgressReporting:
    """Tests for progress callback handling."""

    @pytest.mark.asyncio
    async def test_progress_reported_during_processing(
        self, mock_config, tmp_path, tmp_gitlab_dir
    ):
        """Test that progress callback is stored on the processor."""
        progress_calls = []

        def progress_callback(progress):
            progress_calls.append(progress)

        processor = AutoFixProcessor(
            gitlab_dir=tmp_gitlab_dir,
            config=mock_config,
            permission_checker=MagicMock(),
            progress_callback=progress_callback,
        )

        # Verify the callback is stored
        assert processor.progress_callback is not None
        assert processor.progress_callback == progress_callback

        # Test that calling the callback works
        processor.progress_callback({"status": "test"})

        assert len(progress_calls) == 1
        assert progress_calls[0] == {"status": "test"}


class TestURLConstruction:
    """Tests for URL construction."""

    @pytest.mark.asyncio
    async def test_issue_url_construction(self, processor, mock_config):
        """Test that issue URLs are constructed correctly."""
        issue = {"iid": 123}

        state = await processor.process_issue(
            issue_iid=123,
            issue=issue,
            trigger_label=None,
        )

        assert (
            state.issue_url
            == "https://gitlab.example.com/namespace/test-project/-/issues/123"
        )

"""
GitLab CI Checker Tests
========================

Tests for CI/CD pipeline status checking.
"""

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest
from __tests__.fixtures.gitlab import (
    MOCK_GITLAB_CONFIG,
    mock_mr_data,
    mock_pipeline_data,
    mock_pipeline_jobs,
)


class TestCIChecker:
    """Test CI/CD pipeline checking functionality."""

    @pytest.fixture
    def checker(self, tmp_path):
        """Create a CIChecker instance for testing."""
        from runners.gitlab.glab_client import GitLabConfig
        from runners.gitlab.services.ci_checker import CIChecker

        config = GitLabConfig(
            token="test-token",
            project="group/project",
            instance_url="https://gitlab.example.com",
        )

        with patch("runners.gitlab.services.ci_checker.GitLabClient"):
            return CIChecker(
                project_dir=tmp_path,
                config=config,
            )

    def test_init(self, checker):
        """Test checker initializes correctly."""
        assert checker.client is not None

    def test_check_mr_pipeline_success(self, checker):
        """Test checking MR with successful pipeline."""
        pipeline_data = mock_pipeline_data(status="success")

        async def mock_get_pipelines(mr_iid):
            return [pipeline_data]

        async def mock_get_pipeline_status(pipeline_id):
            return pipeline_data

        async def mock_get_pipeline_jobs(pipeline_id):
            return mock_pipeline_jobs()

        # Setup async mocks
        import asyncio

        async def test():
            with patch.object(
                checker.client, "get_mr_pipelines_async", mock_get_pipelines
            ):
                with patch.object(
                    checker.client,
                    "get_pipeline_status_async",
                    mock_get_pipeline_status,
                ):
                    with patch.object(
                        checker.client,
                        "get_pipeline_jobs_async",
                        mock_get_pipeline_jobs,
                    ):
                        pipeline = await checker.check_mr_pipeline(123)

            assert pipeline is not None
            assert pipeline.pipeline_id == 1001
            assert pipeline.status.value == "success"
            assert pipeline.has_failures is False

        asyncio.run(test())

    def test_check_mr_pipeline_failed(self, checker):
        """Test checking MR with failed pipeline."""
        pipeline_data = mock_pipeline_data(status="failed")
        jobs_data = mock_pipeline_jobs()
        jobs_data[0]["status"] = "failed"

        import asyncio

        async def test():
            async def mock_get_pipelines(mr_iid):
                return [pipeline_data]

            async def mock_get_pipeline_status(pipeline_id):
                return pipeline_data

            async def mock_get_pipeline_jobs(pipeline_id):
                return jobs_data

            with patch.object(
                checker.client, "get_mr_pipelines_async", mock_get_pipelines
            ):
                with patch.object(
                    checker.client,
                    "get_pipeline_status_async",
                    mock_get_pipeline_status,
                ):
                    with patch.object(
                        checker.client,
                        "get_pipeline_jobs_async",
                        mock_get_pipeline_jobs,
                    ):
                        pipeline = await checker.check_mr_pipeline(123)

            assert pipeline.has_failures is True
            assert pipeline.is_blocking is True

        asyncio.run(test())

    def test_check_mr_pipeline_no_pipeline(self, checker):
        """Test checking MR with no pipeline."""
        import asyncio

        async def test():
            async def mock_get_pipelines(mr_iid):
                return []

            with patch.object(
                checker.client, "get_mr_pipelines_async", mock_get_pipelines
            ):
                pipeline = await checker.check_mr_pipeline(123)

            assert pipeline is None

        asyncio.run(test())

    def test_get_blocking_reason_success(self, checker):
        """Test getting blocking reason for successful pipeline."""
        from runners.gitlab.services.ci_checker import PipelineInfo, PipelineStatus

        pipeline = PipelineInfo(
            pipeline_id=1001,
            status=PipelineStatus.SUCCESS,
            ref="main",
            sha="abc123",
            created_at="2025-01-14T10:00:00",
            updated_at="2025-01-14T10:05:00",
            failed_jobs=[],
        )

        reason = checker.get_blocking_reason(pipeline)

        assert reason == ""

    def test_get_blocking_reason_failed(self, checker):
        """Test getting blocking reason for failed pipeline."""
        from runners.gitlab.services.ci_checker import (
            JobStatus,
            PipelineInfo,
            PipelineStatus,
        )

        pipeline = PipelineInfo(
            pipeline_id=1001,
            status=PipelineStatus.FAILED,
            ref="main",
            sha="abc123",
            created_at="2025-01-14T10:00:00",
            updated_at="2025-01-14T10:05:00",
            failed_jobs=[
                JobStatus(
                    name="test",
                    status="failed",
                    stage="test",
                    failure_reason="AssertionError",
                )
            ],
        )

        reason = checker.get_blocking_reason(pipeline)

        assert "failed" in reason.lower()

    def test_format_pipeline_summary(self, checker):
        """Test formatting pipeline summary."""
        from runners.gitlab.services.ci_checker import (
            JobStatus,
            PipelineInfo,
            PipelineStatus,
        )

        pipeline = PipelineInfo(
            pipeline_id=1001,
            status=PipelineStatus.SUCCESS,
            ref="main",
            sha="abc123",
            created_at="2025-01-14T10:00:00",
            updated_at="2025-01-14T10:05:00",
            duration=300,
            jobs=[
                JobStatus(
                    name="test",
                    status="success",
                    stage="test",
                ),
                JobStatus(
                    name="lint",
                    status="success",
                    stage="lint",
                ),
            ],
        )

        summary = checker.format_pipeline_summary(pipeline)

        assert "Pipeline #1001" in summary
        assert "SUCCESS" in summary
        assert "2 total" in summary

    def test_security_scan_detection(self, checker):
        """Test detection of security scan failures."""
        from runners.gitlab.services.ci_checker import JobStatus

        jobs = [
            JobStatus(
                name="sast",
                status="failed",
                stage="test",
                failure_reason="Vulnerability found",
            ),
            JobStatus(
                name="secret_detection",
                status="failed",
                stage="test",
                failure_reason="Secret leaked",
            ),
            JobStatus(
                name="test",
                status="success",
                stage="test",
            ),
        ]

        issues = checker._check_security_scans(jobs)

        assert len(issues) == 2
        assert any(i["type"] == "Static Application Security Testing" for i in issues)
        assert any(i["type"] == "Secret Detection" for i in issues)


class TestPipelineStatus:
    """Test PipelineStatus enum."""

    def test_status_values(self):
        """Test all status values exist."""
        from runners.gitlab.services.ci_checker import PipelineStatus

        assert PipelineStatus.PENDING.value == "pending"
        assert PipelineStatus.RUNNING.value == "running"
        assert PipelineStatus.SUCCESS.value == "success"
        assert PipelineStatus.FAILED.value == "failed"
        assert PipelineStatus.CANCELED.value == "canceled"


class TestJobStatus:
    """Test JobStatus model."""

    def test_job_status_creation(self):
        """Test creating JobStatus."""
        from runners.gitlab.services.ci_checker import JobStatus

        job = JobStatus(
            name="test",
            status="success",
            stage="test",
            started_at="2025-01-14T10:00:00",
            finished_at="2025-01-14T10:01:00",
            duration=60,
        )

        assert job.name == "test"
        assert job.status == "success"
        assert job.duration == 60


class TestPipelineInfo:
    """Test PipelineInfo model."""

    def test_pipeline_info_creation(self):
        """Test creating PipelineInfo."""
        from runners.gitlab.services.ci_checker import PipelineInfo, PipelineStatus

        pipeline = PipelineInfo(
            pipeline_id=1001,
            status=PipelineStatus.SUCCESS,
            ref="main",
            sha="abc123",
            created_at="2025-01-14T10:00:00",
            updated_at="2025-01-14T10:05:00",
        )

        assert pipeline.pipeline_id == 1001
        assert pipeline.has_failures is False
        assert pipeline.is_blocking is False

    def test_has_failures_property(self):
        """Test has_failures property."""
        from runners.gitlab.services.ci_checker import (
            JobStatus,
            PipelineInfo,
            PipelineStatus,
        )

        pipeline = PipelineInfo(
            pipeline_id=1001,
            status=PipelineStatus.FAILED,
            ref="main",
            sha="abc123",
            created_at="2025-01-14T10:00:00",
            updated_at="2025-01-14T10:05:00",
            failed_jobs=[
                JobStatus(name="test", status="failed", stage="test"),
            ],
        )

        assert pipeline.has_failures is True
        assert len(pipeline.failed_jobs) == 1

    def test_is_blocking_success(self):
        """Test is_blocking for successful pipeline."""
        from runners.gitlab.services.ci_checker import PipelineInfo, PipelineStatus

        pipeline = PipelineInfo(
            pipeline_id=1001,
            status=PipelineStatus.SUCCESS,
            ref="main",
            sha="abc123",
            created_at="2025-01-14T10:00:00",
            updated_at="2025-01-14T10:05:00",
        )

        assert pipeline.is_blocking is False

    def test_is_blocking_failed(self):
        """Test is_blocking for failed pipeline."""
        from runners.gitlab.services.ci_checker import PipelineInfo, PipelineStatus

        pipeline = PipelineInfo(
            pipeline_id=1001,
            status=PipelineStatus.FAILED,
            ref="main",
            sha="abc123",
            created_at="2025-01-14T10:00:00",
            updated_at="2025-01-14T10:05:00",
        )

        assert pipeline.is_blocking is True

    def test_is_blocking_running(self):
        """Test is_blocking for running pipeline."""
        from runners.gitlab.services.ci_checker import PipelineInfo, PipelineStatus

        pipeline = PipelineInfo(
            pipeline_id=1001,
            status=PipelineStatus.RUNNING,
            ref="main",
            sha="abc123",
            created_at="2025-01-14T10:00:00",
            updated_at="2025-01-14T10:05:00",
        )

        # Running with no failed jobs is not blocking
        assert pipeline.is_blocking is False

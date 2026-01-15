"""
CI/CD Pipeline Checker for GitLab
==================================

Checks GitLab CI/CD pipeline status for merge requests.

Features:
- Get pipeline status for an MR
- Check for failed jobs
- Detect security policy violations
- Handle workflow approvals
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path

try:
    from ..glab_client import GitLabClient, GitLabConfig
    from .io_utils import safe_print
except ImportError:
    from core.io_utils import safe_print
    from glab_client import GitLabClient, GitLabConfig


class PipelineStatus(str, Enum):
    """GitLab pipeline status."""

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELED = "canceled"
    SKIPPED = "skipped"
    MANUAL = "manual"
    UNKNOWN = "unknown"


@dataclass
class JobStatus:
    """Status of a single CI job."""

    name: str
    status: str
    stage: str
    started_at: str | None = None
    finished_at: str | None = None
    duration: float | None = None
    failure_reason: str | None = None
    retry_count: int = 0
    allow_failure: bool = False


@dataclass
class PipelineInfo:
    """Complete pipeline information."""

    pipeline_id: int
    status: PipelineStatus
    ref: str
    sha: str
    created_at: str
    updated_at: str
    finished_at: str | None = None
    duration: float | None = None
    jobs: list[JobStatus] = None
    failed_jobs: list[JobStatus] = None
    blocked_jobs: list[JobStatus] = None
    security_issues: list[dict] = None

    def __post_init__(self):
        if self.jobs is None:
            self.jobs = []
        if self.failed_jobs is None:
            self.failed_jobs = []
        if self.blocked_jobs is None:
            self.blocked_jobs = []
        if self.security_issues is None:
            self.security_issues = []

    @property
    def has_failures(self) -> bool:
        """Check if pipeline has any failed jobs."""
        return len(self.failed_jobs) > 0

    @property
    def has_security_issues(self) -> bool:
        """Check if pipeline has security scan failures."""
        return len(self.security_issues) > 0

    @property
    def is_blocking(self) -> bool:
        """Check if pipeline status blocks merge."""
        # Only SUCCESS status allows merge
        # FAILED, CANCELED, RUNNING (with blocking jobs) block merge
        if self.status == PipelineStatus.SUCCESS:
            return False
        if self.status == PipelineStatus.FAILED:
            return True
        if self.status == PipelineStatus.CANCELED:
            return True
        if self.status in (PipelineStatus.RUNNING, PipelineStatus.PENDING):
            # Check if any critical jobs are expected to fail
            return any(
                not job.allow_failure for job in self.jobs if job.status == "failed"
            )
        return False


class CIChecker:
    """
    Checks CI/CD pipeline status for GitLab MRs.

    Usage:
        checker = CIChecker(
            project_dir=Path("/path/to/project"),
            config=gitlab_config
        )
        pipeline_info = await checker.check_mr_pipeline(mr_iid=123)
        if pipeline_info.is_blocking:
            print(f"MR blocked by CI: {pipeline_info.status}")
    """

    def __init__(
        self,
        project_dir: Path,
        config: GitLabConfig | None = None,
    ):
        """
        Initialize CI checker.

        Args:
            project_dir: Path to the project directory
            config: GitLab configuration (optional)
        """
        self.project_dir = Path(project_dir)

        if config:
            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )
        else:
            # Try to load config from project
            from ..glab_client import load_gitlab_config

            config = load_gitlab_config(self.project_dir)
            if config:
                self.client = GitLabClient(
                    project_dir=self.project_dir,
                    config=config,
                )
            else:
                raise ValueError("GitLab configuration not found")

    def _parse_job_status(self, job_data: dict) -> JobStatus:
        """Parse job data from GitLab API."""
        return JobStatus(
            name=job_data.get("name", ""),
            status=job_data.get("status", "unknown"),
            stage=job_data.get("stage", ""),
            started_at=job_data.get("started_at"),
            finished_at=job_data.get("finished_at"),
            duration=job_data.get("duration"),
            failure_reason=job_data.get("failure_reason"),
            retry_count=job_data.get("retry_count", 0),
            allow_failure=job_data.get("allow_failure", False),
        )

    async def check_mr_pipeline(self, mr_iid: int) -> PipelineInfo | None:
        """
        Check pipeline status for an MR.

        Args:
            mr_iid: The MR IID

        Returns:
            PipelineInfo or None if no pipeline found
        """
        # Get pipelines for this MR
        pipelines = await self.client.get_mr_pipelines_async(mr_iid)

        if not pipelines:
            safe_print(f"[CI] No pipelines found for MR !{mr_iid}")
            return None

        # Get the most recent pipeline (last in list)
        latest_pipeline_data = pipelines[-1]

        pipeline_id = latest_pipeline_data.get("id")
        status_str = latest_pipeline_data.get("status", "unknown")

        try:
            status = PipelineStatus(status_str)
        except ValueError:
            status = PipelineStatus.UNKNOWN

        safe_print(f"[CI] MR !{mr_iid} has pipeline #{pipeline_id}: {status.value}")

        # Get detailed pipeline info
        try:
            pipeline_detail = await self.client.get_pipeline_status_async(pipeline_id)
        except Exception as e:
            safe_print(f"[CI] Error fetching pipeline details: {e}")
            pipeline_detail = latest_pipeline_data

        # Get jobs for this pipeline
        jobs_data = []
        try:
            jobs_data = await self.client.get_pipeline_jobs_async(pipeline_id)
        except Exception as e:
            safe_print(f"[CI] Error fetching pipeline jobs: {e}")

        # Parse jobs
        jobs = [self._parse_job_status(job) for job in jobs_data]

        # Find failed jobs (excluding allow_failure jobs)
        failed_jobs = [
            job for job in jobs if job.status == "failed" and not job.allow_failure
        ]

        # Find blocked/failed jobs
        blocked_jobs = [job for job in jobs if job.status in ("failed", "canceled")]

        # Check for security scan failures
        security_issues = self._check_security_scans(jobs)

        return PipelineInfo(
            pipeline_id=pipeline_id,
            status=status,
            ref=latest_pipeline_data.get("ref", ""),
            sha=latest_pipeline_data.get("sha", ""),
            created_at=latest_pipeline_data.get("created_at", ""),
            updated_at=latest_pipeline_data.get("updated_at", ""),
            finished_at=pipeline_detail.get("finished_at"),
            duration=pipeline_detail.get("duration"),
            jobs=jobs,
            failed_jobs=failed_jobs,
            blocked_jobs=blocked_jobs,
            security_issues=security_issues,
        )

    def _check_security_scans(self, jobs: list[JobStatus]) -> list[dict]:
        """
        Check for security scan failures.

        Looks for common GitLab security job patterns:
        - sast
        - secret_detection
        - container_scanning
        - dependency_scanning
        - license_scanning
        """
        issues = []

        security_patterns = {
            "sast": "Static Application Security Testing",
            "secret_detection": "Secret Detection",
            "container_scanning": "Container Scanning",
            "dependency_scanning": "Dependency Scanning",
            "license_scanning": "License Scanning",
            "api_fuzzing": "API Fuzzing",
            "dast": "Dynamic Application Security Testing",
        }

        for job in jobs:
            job_name_lower = job.name.lower()

            # Check if this is a security job
            for pattern, scan_type in security_patterns.items():
                if pattern in job_name_lower:
                    if job.status == "failed" and not job.allow_failure:
                        issues.append(
                            {
                                "type": scan_type,
                                "job_name": job.name,
                                "status": job.status,
                                "failure_reason": job.failure_reason,
                            }
                        )
                    break

        return issues

    def get_blocking_reason(self, pipeline: PipelineInfo) -> str:
        """
        Get human-readable reason for why pipeline is blocking.

        Args:
            pipeline: Pipeline info

        Returns:
            Human-readable blocking reason
        """
        if pipeline.status == PipelineStatus.SUCCESS:
            return ""

        if pipeline.status == PipelineStatus.FAILED:
            if pipeline.failed_jobs:
                failed_job_names = [job.name for job in pipeline.failed_jobs[:3]]
                if len(pipeline.failed_jobs) > 3:
                    failed_job_names.append(
                        f"... and {len(pipeline.failed_jobs) - 3} more"
                    )
                return (
                    f"Pipeline failed: {', '.join(failed_job_names)}. "
                    f"Fix these jobs before merging."
                )
            return "Pipeline failed. Check CI for details."

        if pipeline.status == PipelineStatus.CANCELED:
            return "Pipeline was canceled."

        if pipeline.status in (PipelineStatus.RUNNING, PipelineStatus.PENDING):
            return f"Pipeline is {pipeline.status.value}. Wait for completion."

        if pipeline.has_security_issues:
            return (
                f"Security scan failures detected: "
                f"{', '.join(i['type'] for i in pipeline.security_issues[:3])}"
            )

        return f"Pipeline status: {pipeline.status.value}"

    def format_pipeline_summary(self, pipeline: PipelineInfo) -> str:
        """
        Format pipeline info as a summary string.

        Args:
            pipeline: Pipeline info

        Returns:
            Formatted summary
        """
        status_emoji = {
            PipelineStatus.SUCCESS: "✅",
            PipelineStatus.FAILED: "❌",
            PipelineStatus.RUNNING: "🔄",
            PipelineStatus.PENDING: "⏳",
            PipelineStatus.CANCELED: "🚫",
            PipelineStatus.SKIPPED: "⏭️",
            PipelineStatus.UNKNOWN: "❓",
        }

        emoji = status_emoji.get(pipeline.status, "⚪")

        lines = [
            f"### CI/CD Pipeline #{pipeline.pipeline_id} {emoji}",
            f"**Status:** {pipeline.status.value.upper()}",
            f"**Branch:** {pipeline.ref}",
            f"**Commit:** {pipeline.sha[:8]}",
            "",
        ]

        if pipeline.duration:
            lines.append(
                f"**Duration:** {int(pipeline.duration // 60)}m {int(pipeline.duration % 60)}s"
            )

        if pipeline.jobs:
            lines.append(f"**Jobs:** {len(pipeline.jobs)} total")

            # Count by status
            status_counts = {}
            for job in pipeline.jobs:
                status_counts[job.status] = status_counts.get(job.status, 0) + 1

            if status_counts:
                lines.append("**Job Status:**")
                for status, count in sorted(status_counts.items()):
                    lines.append(f"  - {status}: {count}")

        # Security issues
        if pipeline.security_issues:
            lines.append("")
            lines.append("### 🚨 Security Issues")
            for issue in pipeline.security_issues:
                lines.append(f"- **{issue['type']}**: {issue['job_name']}")

        # Failed jobs
        if pipeline.failed_jobs:
            lines.append("")
            lines.append("### Failed Jobs")
            for job in pipeline.failed_jobs[:5]:
                if job.failure_reason:
                    lines.append(
                        f"- **{job.name}** ({job.stage}): {job.failure_reason}"
                    )
                else:
                    lines.append(f"- **{job.name}** ({job.stage})")
            if len(pipeline.failed_jobs) > 5:
                lines.append(f"- ... and {len(pipeline.failed_jobs) - 5} more")

        return "\n".join(lines)

    async def wait_for_pipeline_completion(
        self,
        mr_iid: int,
        timeout_seconds: int = 1800,  # 30 minutes default
        check_interval: int = 30,
    ) -> PipelineInfo | None:
        """
        Wait for pipeline to complete (for interactive workflows).

        Args:
            mr_iid: MR IID
            timeout_seconds: Maximum time to wait
            check_interval: Seconds between checks

        Returns:
            Final PipelineInfo or None if timeout
        """
        import asyncio

        safe_print(f"[CI] Waiting for MR !{mr_iid} pipeline to complete...")

        elapsed = 0
        while elapsed < timeout_seconds:
            pipeline = await self.check_mr_pipeline(mr_iid)

            if not pipeline:
                safe_print("[CI] No pipeline found")
                return None

            if pipeline.status in (
                PipelineStatus.SUCCESS,
                PipelineStatus.FAILED,
                PipelineStatus.CANCELED,
            ):
                safe_print(f"[CI] Pipeline completed: {pipeline.status.value}")
                return pipeline

            safe_print(
                f"[CI] Pipeline still running... ({elapsed}s elapsed, "
                f"{timeout_seconds - elapsed}s remaining)"
            )

            await asyncio.sleep(check_interval)
            elapsed += check_interval

        safe_print(f"[CI] Timeout waiting for pipeline ({timeout_seconds}s)")
        return None

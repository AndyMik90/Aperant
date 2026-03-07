"""
Data Retention & Cleanup
========================

Manages data retention, archival, and cleanup for the GitHub automation system.

Features:
- Configurable retention periods by state
- Automatic archival of old records
- Index pruning on startup
- GDPR-compliant deletion (full purge)
- Storage usage metrics

Usage:
    cleaner = DataCleaner(state_dir=Path(".auto-claude/github"))

    # Run automatic cleanup
    result = await cleaner.run_cleanup()
    print(f"Cleaned {result.deleted_count} records")

    # Purge specific issue/PR data
    await cleaner.purge_issue(123)

    # Get storage metrics
    metrics = cleaner.get_storage_metrics()

CLI:
    python runner.py cleanup --older-than 90d
    python runner.py cleanup --purge-issue 123
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from .purge_strategy import PurgeResult, PurgeStrategy
from .storage_metrics import StorageMetrics, StorageMetricsCalculator


class RetentionPolicy(str, Enum):
    """Retention policies for different record types."""

    COMPLETED = "completed"  # 90 days
    FAILED = "failed"  # 30 days
    CANCELLED = "cancelled"  # 7 days
    STALE = "stale"  # 14 days
    ARCHIVED = "archived"  # Indefinite (moved to archive)


# Default retention periods in days
DEFAULT_RETENTION = {
    RetentionPolicy.COMPLETED: 90,
    RetentionPolicy.FAILED: 30,
    RetentionPolicy.CANCELLED: 7,
    RetentionPolicy.STALE: 14,
}


@dataclass
class RetentionConfig:
    """
    Configuration for data retention.
    """

    completed_days: int = 90
    failed_days: int = 30
    cancelled_days: int = 7
    stale_days: int = 14
    archive_enabled: bool = True
    gdpr_mode: bool = False  # If True, deletes instead of archives

    def get_retention_days(self, policy: RetentionPolicy) -> int:
        mapping = {
            RetentionPolicy.COMPLETED: self.completed_days,
            RetentionPolicy.FAILED: self.failed_days,
            RetentionPolicy.CANCELLED: self.cancelled_days,
            RetentionPolicy.STALE: self.stale_days,
            RetentionPolicy.ARCHIVED: -1,  # Never auto-delete
        }
        return mapping.get(policy, 90)

    def to_dict(self) -> dict[str, Any]:
        return {
            "completed_days": self.completed_days,
            "failed_days": self.failed_days,
            "cancelled_days": self.cancelled_days,
            "stale_days": self.stale_days,
            "archive_enabled": self.archive_enabled,
            "gdpr_mode": self.gdpr_mode,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RetentionConfig:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class CleanupResult:
    """
    Result of a cleanup operation.
    """

    deleted_count: int = 0
    archived_count: int = 0
    pruned_index_entries: int = 0
    freed_bytes: int = 0
    errors: list[str] = field(default_factory=list)
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    dry_run: bool = False

    @property
    def duration(self) -> timedelta | None:
        if self.completed_at:
            return self.completed_at - self.started_at
        return None

    @property
    def freed_mb(self) -> float:
        return self.freed_bytes / (1024 * 1024)

    def to_dict(self) -> dict[str, Any]:
        return {
            "deleted_count": self.deleted_count,
            "archived_count": self.archived_count,
            "pruned_index_entries": self.pruned_index_entries,
            "freed_bytes": self.freed_bytes,
            "freed_mb": round(self.freed_mb, 2),
            "errors": self.errors,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat()
            if self.completed_at
            else None,
            "duration_seconds": self.duration.total_seconds()
            if self.duration
            else None,
            "dry_run": self.dry_run,
        }


# StorageMetrics is now imported from storage_metrics.py


class DataCleaner:
    """
    Manages data retention and cleanup.

    Usage:
        cleaner = DataCleaner(state_dir=Path(".auto-claude/github"))

        # Check what would be cleaned
        result = await cleaner.run_cleanup(dry_run=True)

        # Actually clean
        result = await cleaner.run_cleanup()

        # Purge specific data (GDPR)
        await cleaner.purge_issue(123)
    """

    def __init__(
        self,
        state_dir: Path,
        config: RetentionConfig | None = None,
    ):
        """
        Initialize data cleaner.

        Args:
            state_dir: Directory containing state files
            config: Retention configuration
        """
        self.state_dir = state_dir
        self.config = config or RetentionConfig()
        self.archive_dir = state_dir / "archive"
        self._storage_calculator = StorageMetricsCalculator(state_dir)
        self._purge_strategy = PurgeStrategy(state_dir)

    def get_storage_metrics(self) -> StorageMetrics:
        """
        Get current storage usage metrics.

        Returns:
            StorageMetrics with breakdown
        """
        return self._storage_calculator.calculate()

    async def run_cleanup(
        self,
        dry_run: bool = False,
        older_than_days: int | None = None,
    ) -> CleanupResult:
        """
        Run cleanup based on retention policy.

        Args:
            dry_run: If True, only report what would be cleaned
            older_than_days: Override retention days for all types

        Returns:
            CleanupResult with statistics
        """
        result = CleanupResult(dry_run=dry_run)
        now = datetime.now(timezone.utc)

        # Directories to clean
        directories = [
            (self.state_dir / "pr", "pr_reviews"),
            (self.state_dir / "issues", "issues"),
            (self.state_dir / "autofix", "autofix"),
        ]

        for dir_path, dir_type in directories:
            if not dir_path.exists():
                continue

            for file_path in dir_path.glob("*.json"):
                try:
                    cleaned = await self._process_file(
                        file_path, now, older_than_days, dry_run, result
                    )
                    if cleaned:
                        result.deleted_count += 1
                except Exception as e:
                    result.errors.append(f"Error processing {file_path}: {e}")

        # Prune indexes
        await self._prune_indexes(dry_run, result)

        # Clean up audit logs
        await self._clean_audit_logs(now, older_than_days, dry_run, result)

        result.completed_at = datetime.now(timezone.utc)
        return result

    async def _process_file(
        self,
        file_path: Path,
        now: datetime,
        older_than_days: int | None,
        dry_run: bool,
        result: CleanupResult,
    ) -> bool:
        """Process a single file for cleanup."""
        try:
            with open(file_path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            # Corrupted file, mark for deletion
            if not dry_run:
                file_size = file_path.stat().st_size
                file_path.unlink()
                result.freed_bytes += file_size
            return True

        # Get status and timestamp
        status = data.get("status", "completed").lower()
        updated_at = data.get("updated_at") or data.get("created_at")

        if not updated_at:
            return False

        try:
            record_time = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        except ValueError:
            return False

        # Determine retention policy
        policy = self._get_policy_for_status(status)
        retention_days = older_than_days or self.config.get_retention_days(policy)

        if retention_days < 0:
            return False  # Never delete

        cutoff = now - timedelta(days=retention_days)

        if record_time < cutoff:
            file_size = file_path.stat().st_size

            if not dry_run:
                if self.config.archive_enabled and not self.config.gdpr_mode:
                    # Archive instead of delete
                    await self._archive_file(file_path, data)
                    result.archived_count += 1
                else:
                    # Delete
                    file_path.unlink()

                result.freed_bytes += file_size

            return True

        return False

    def _get_policy_for_status(self, status: str) -> RetentionPolicy:
        """Map status to retention policy."""
        status_map = {
            "completed": RetentionPolicy.COMPLETED,
            "merged": RetentionPolicy.COMPLETED,
            "closed": RetentionPolicy.COMPLETED,
            "failed": RetentionPolicy.FAILED,
            "error": RetentionPolicy.FAILED,
            "cancelled": RetentionPolicy.CANCELLED,
            "stale": RetentionPolicy.STALE,
            "abandoned": RetentionPolicy.STALE,
        }
        return status_map.get(status, RetentionPolicy.COMPLETED)

    async def _archive_file(
        self,
        file_path: Path,
        data: dict[str, Any],
    ) -> None:
        """Archive a file instead of deleting."""
        # Create archive directory structure
        relative = file_path.relative_to(self.state_dir)
        archive_path = self.archive_dir / relative

        archive_path.parent.mkdir(parents=True, exist_ok=True)

        # Add archive metadata
        data["_archived_at"] = datetime.now(timezone.utc).isoformat()
        data["_original_path"] = str(file_path)

        with open(archive_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        # Remove original
        file_path.unlink()

    async def _prune_indexes(
        self,
        dry_run: bool,
        result: CleanupResult,
    ) -> None:
        """Prune stale entries from index files."""
        index_files = [
            self.state_dir / "pr" / "index.json",
            self.state_dir / "issues" / "index.json",
            self.state_dir / "autofix" / "index.json",
        ]

        for index_path in index_files:
            if not index_path.exists():
                continue

            try:
                with open(index_path, encoding="utf-8") as f:
                    index_data = json.load(f)

                if not isinstance(index_data, dict):
                    continue

                items = index_data.get("items", {})
                if not isinstance(items, dict):
                    continue

                pruned = 0
                to_remove = []

                for key, entry in items.items():
                    # Check if referenced file exists
                    file_path = entry.get("file_path") or entry.get("path")
                    if file_path:
                        if not Path(file_path).exists():
                            to_remove.append(key)
                            pruned += 1

                if to_remove and not dry_run:
                    for key in to_remove:
                        del items[key]

                    with open(index_path, "w", encoding="utf-8") as f:
                        json.dump(index_data, f, indent=2)

                result.pruned_index_entries += pruned

            except (OSError, json.JSONDecodeError, UnicodeDecodeError, KeyError):
                result.errors.append(f"Error pruning index: {index_path}")

    async def _clean_audit_logs(
        self,
        now: datetime,
        older_than_days: int | None,
        dry_run: bool,
        result: CleanupResult,
    ) -> None:
        """Clean old audit logs."""
        audit_dir = self.state_dir / "audit"
        if not audit_dir.exists():
            return

        # Default 30 day retention for audit logs (overridable)
        retention_days = older_than_days or 30
        cutoff = now - timedelta(days=retention_days)

        for log_file in audit_dir.glob("*.log"):
            try:
                # Check file modification time
                mtime = datetime.fromtimestamp(
                    log_file.stat().st_mtime, tz=timezone.utc
                )
                if mtime < cutoff:
                    file_size = log_file.stat().st_size
                    if not dry_run:
                        log_file.unlink()
                        result.freed_bytes += file_size
                    result.deleted_count += 1
            except OSError as e:
                result.errors.append(f"Error cleaning audit log {log_file}: {e}")

    async def purge_issue(
        self,
        issue_number: int,
        repo: str | None = None,
    ) -> CleanupResult:
        """
        Purge all data for a specific issue (GDPR-compliant).

        Args:
            issue_number: Issue number to purge
            repo: Optional repository filter

        Returns:
            CleanupResult
        """
        purge_result = await self._purge_strategy.purge_by_criteria(
            pattern="issue",
            key="issue_number",
            value=issue_number,
            repo=repo,
        )

        # Convert PurgeResult to CleanupResult
        return self._convert_purge_result(purge_result)

    async def purge_pr(
        self,
        pr_number: int,
        repo: str | None = None,
    ) -> CleanupResult:
        """
        Purge all data for a specific PR (GDPR-compliant).

        Args:
            pr_number: PR number to purge
            repo: Optional repository filter

        Returns:
            CleanupResult
        """
        purge_result = await self._purge_strategy.purge_by_criteria(
            pattern="pr",
            key="pr_number",
            value=pr_number,
            repo=repo,
        )

        # Convert PurgeResult to CleanupResult
        return self._convert_purge_result(purge_result)

    async def purge_repo(self, repo: str) -> CleanupResult:
        """
        Purge all data for a specific repository.

        Args:
            repo: Repository in owner/repo format

        Returns:
            CleanupResult
        """
        purge_result = await self._purge_strategy.purge_repository(repo)

        # Convert PurgeResult to CleanupResult
        return self._convert_purge_result(purge_result)

    def _convert_purge_result(self, purge_result: PurgeResult) -> CleanupResult:
        """
        Convert PurgeResult to CleanupResult.

        Args:
            purge_result: PurgeResult from PurgeStrategy

        Returns:
            CleanupResult for DataCleaner API compatibility
        """
        cleanup_result = CleanupResult(
            deleted_count=purge_result.deleted_count,
            freed_bytes=purge_result.freed_bytes,
            errors=purge_result.errors,
            started_at=purge_result.started_at,
            completed_at=purge_result.completed_at,
        )
        return cleanup_result

    def get_retention_summary(self) -> dict[str, Any]:
        """Get summary of retention settings and usage."""
        metrics = self.get_storage_metrics()

        return {
            "config": self.config.to_dict(),
            "storage": metrics.to_dict(),
            "archive_enabled": self.config.archive_enabled,
            "gdpr_mode": self.config.gdpr_mode,
        }

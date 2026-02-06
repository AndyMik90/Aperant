"""
Purge Strategy
==============

Generic GDPR-compliant data purge implementation for GitHub automation system.

Features:
- Generic purge method for issues, PRs, and repositories
- Pattern-based file discovery
- Optional repository filtering
- Archive directory cleanup
- Comprehensive error handling

Usage:
    strategy = PurgeStrategy(state_dir=Path(".auto-claude/github"))
    result = await strategy.purge_by_criteria(
        pattern="issue",
        key="issue_number",
        value=123
    )
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class PurgeResult:
    """
    Result of a purge operation.
    """

    deleted_count: int = 0
    freed_bytes: int = 0
    errors: list[str] = field(default_factory=list)
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None

    @property
    def freed_mb(self) -> float:
        return self.freed_bytes / (1024 * 1024)

    def to_dict(self) -> dict[str, Any]:
        return {
            "deleted_count": self.deleted_count,
            "freed_bytes": self.freed_bytes,
            "freed_mb": round(self.freed_mb, 2),
            "errors": self.errors,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat()
            if self.completed_at
            else None,
        }


class PurgeStrategy:
    """
    Generic purge strategy for GDPR-compliant data deletion.

    Consolidates purge_issue(), purge_pr(), and purge_repo() into a single
    flexible implementation that works for all entity types.

    Usage:
        strategy = PurgeStrategy(state_dir)

        # Purge issue
        await strategy.purge_by_criteria(
            pattern="issue",
            key="issue_number",
            value=123,
            repo="owner/repo"  # optional
        )

        # Purge PR
        await strategy.purge_by_criteria(
            pattern="pr",
            key="pr_number",
            value=456
        )

        # Purge repo (uses different logic)
        await strategy.purge_repository("owner/repo")
    """

    def __init__(self, state_dir: Path):
        """
        Initialize purge strategy.

        Args:
            state_dir: Base directory containing GitHub automation data
        """
        self.state_dir = state_dir
        self.archive_dir = state_dir / "archive"

    async def purge_by_criteria(
        self,
        pattern: str,
        key: str,
        value: Any,
        repo: str | None = None,
    ) -> PurgeResult:
        """
        Purge all data matching specified criteria (GDPR-compliant).

        This generic method eliminates duplicate purge_issue() and purge_pr()
        implementations by using pattern-based file discovery and JSON
        key matching.

        Args:
            pattern: File pattern identifier (e.g., "issue", "pr")
            key: JSON key to match (e.g., "issue_number", "pr_number")
            value: Value to match (e.g., 123, 456)
            repo: Optional repository filter in "owner/repo" format

        Returns:
            PurgeResult with deletion statistics

        Example:
            # Purge issue #123
            result = await strategy.purge_by_criteria(
                pattern="issue",
                key="issue_number",
                value=123
            )

            # Purge PR #456 from specific repo
            result = await strategy.purge_by_criteria(
                pattern="pr",
                key="pr_number",
                value=456,
                repo="owner/repo"
            )
        """
        result = PurgeResult()

        # Build file patterns to search for
        patterns = [
            f"*{value}*.json",
            f"*{pattern}-{value}*.json",
            f"*_{value}_*.json",
        ]

        # Search state directory
        for file_pattern in patterns:
            for file_path in self.state_dir.rglob(file_pattern):
                self._try_delete_file(file_path, key, value, repo, result)

        # Search archive directory
        for file_pattern in patterns:
            for file_path in self.archive_dir.rglob(file_pattern):
                self._try_delete_file_simple(file_path, result)

        result.completed_at = datetime.now(timezone.utc)
        return result

    async def purge_repository(self, repo: str) -> PurgeResult:
        """
        Purge all data for a specific repository.

        This method handles repository-level purges which have different
        logic than issue/PR purges (directory-based instead of file-based).

        Args:
            repo: Repository in "owner/repo" format

        Returns:
            PurgeResult with deletion statistics
        """
        import shutil

        result = PurgeResult()
        safe_name = repo.replace("/", "_")

        # Delete files matching repository pattern in subdirectories
        for subdir in ["pr", "issues", "autofix", "trust", "learning"]:
            dir_path = self.state_dir / subdir
            if not dir_path.exists():
                continue

            for file_path in dir_path.glob(f"{safe_name}*.json"):
                try:
                    file_size = file_path.stat().st_size
                    file_path.unlink()
                    result.deleted_count += 1
                    result.freed_bytes += file_size
                except OSError as e:
                    result.errors.append(f"Error deleting {file_path}: {e}")

        # Delete entire repository directory
        repo_dir = self.state_dir / "repos" / safe_name
        if repo_dir.exists():
            try:
                freed = self._calculate_directory_size(repo_dir)
                shutil.rmtree(repo_dir)
                result.deleted_count += 1
                result.freed_bytes += freed
            except OSError as e:
                result.errors.append(f"Error deleting repo directory {repo_dir}: {e}")

        result.completed_at = datetime.now(timezone.utc)
        return result

    def _try_delete_file(
        self,
        file_path: Path,
        key: str,
        value: Any,
        repo: str | None,
        result: PurgeResult,
    ) -> None:
        """
        Attempt to delete a file after validating its JSON contents.

        Args:
            file_path: Path to file to potentially delete
            key: JSON key to match
            value: Value to match
            repo: Optional repository filter
            result: PurgeResult to update
        """
        try:
            with open(file_path, encoding="utf-8") as f:
                data = json.load(f)

            # Verify key matches value
            if data.get(key) != value:
                return

            # Apply repository filter if specified
            if repo and data.get("repo") != repo:
                return

            # Delete the file
            file_size = file_path.stat().st_size
            file_path.unlink()
            result.deleted_count += 1
            result.freed_bytes += file_size

        except (OSError, json.JSONDecodeError, KeyError) as e:
            # Skip files that can't be read or parsed
            # Don't add to errors as this is expected for non-matching files
            pass
        except Exception as e:
            result.errors.append(f"Unexpected error deleting {file_path}: {e}")

    def _try_delete_file_simple(
        self,
        file_path: Path,
        result: PurgeResult,
    ) -> None:
        """
        Attempt to delete a file without validation (for archive cleanup).

        Args:
            file_path: Path to file to delete
            result: PurgeResult to update
        """
        try:
            file_size = file_path.stat().st_size
            file_path.unlink()
            result.deleted_count += 1
            result.freed_bytes += file_size
        except OSError as e:
            result.errors.append(f"Error deleting {file_path}: {e}")

    def _calculate_directory_size(self, path: Path) -> int:
        """
        Calculate total size of all files in a directory recursively.

        Args:
            path: Directory path to measure

        Returns:
            Total size in bytes
        """
        total = 0
        for file_path in path.rglob("*"):
            if file_path.is_file():
                try:
                    total += file_path.stat().st_size
                except OSError:
                    continue
        return total

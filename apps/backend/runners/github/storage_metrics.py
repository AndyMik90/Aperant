"""
Storage Metrics Calculator
==========================

Handles storage usage analysis and reporting for the GitHub automation system.

Features:
- Directory size calculation
- Top consumer identification
- Human-readable size formatting
- Storage breakdown by component type

Usage:
    calculator = StorageMetricsCalculator(state_dir=Path(".ac.jerry/github"))
    metrics = calculator.calculate()
    print(f"Total storage: {calculator.format_size(metrics.total_bytes)}")
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class StorageMetrics:
    """
    Storage usage metrics.
    """

    total_bytes: int = 0
    pr_reviews_bytes: int = 0
    issues_bytes: int = 0
    autofix_bytes: int = 0
    audit_logs_bytes: int = 0
    archive_bytes: int = 0
    other_bytes: int = 0

    record_count: int = 0
    archive_count: int = 0

    @property
    def total_mb(self) -> float:
        return self.total_bytes / (1024 * 1024)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_bytes": self.total_bytes,
            "total_mb": round(self.total_mb, 2),
            "breakdown": {
                "pr_reviews": self.pr_reviews_bytes,
                "issues": self.issues_bytes,
                "autofix": self.autofix_bytes,
                "audit_logs": self.audit_logs_bytes,
                "archive": self.archive_bytes,
                "other": self.other_bytes,
            },
            "record_count": self.record_count,
            "archive_count": self.archive_count,
        }


class StorageMetricsCalculator:
    """
    Calculates storage metrics for GitHub automation data.

    Usage:
        calculator = StorageMetricsCalculator(state_dir)
        metrics = calculator.calculate()
        top_dirs = calculator.get_top_consumers(metrics, limit=5)
    """

    def __init__(self, state_dir: Path):
        """
        Initialize calculator.

        Args:
            state_dir: Base directory containing GitHub automation data
        """
        self.state_dir = state_dir
        self.archive_dir = state_dir / "archive"

    def calculate(self) -> StorageMetrics:
        """
        Calculate current storage usage metrics.

        Returns:
            StorageMetrics with breakdown by component
        """
        metrics = StorageMetrics()

        # Measure each directory
        metrics.pr_reviews_bytes = self._calculate_directory_size(self.state_dir / "pr")
        metrics.issues_bytes = self._calculate_directory_size(self.state_dir / "issues")
        metrics.autofix_bytes = self._calculate_directory_size(
            self.state_dir / "autofix"
        )
        metrics.audit_logs_bytes = self._calculate_directory_size(
            self.state_dir / "audit"
        )
        metrics.archive_bytes = self._calculate_directory_size(self.archive_dir)

        # Calculate total and other
        total = self._calculate_directory_size(self.state_dir)
        counted = (
            metrics.pr_reviews_bytes
            + metrics.issues_bytes
            + metrics.autofix_bytes
            + metrics.audit_logs_bytes
            + metrics.archive_bytes
        )
        metrics.other_bytes = max(0, total - counted)
        metrics.total_bytes = total

        # Count records
        for subdir in ["pr", "issues", "autofix"]:
            metrics.record_count += self._count_records(self.state_dir / subdir)

        metrics.archive_count = self._count_records(self.archive_dir)

        return metrics

    def _calculate_directory_size(self, path: Path) -> int:
        """
        Calculate total size of all files in a directory recursively.

        Args:
            path: Directory path to measure

        Returns:
            Total size in bytes
        """
        if not path.exists():
            return 0

        total = 0
        for file_path in path.rglob("*"):
            if file_path.is_file():
                try:
                    total += file_path.stat().st_size
                except OSError:
                    # Skip files that can't be accessed
                    continue

        return total

    def _count_records(self, path: Path) -> int:
        """
        Count JSON record files in a directory.

        Args:
            path: Directory path to count

        Returns:
            Number of .json files
        """
        if not path.exists():
            return 0

        count = 0
        for file_path in path.rglob("*.json"):
            count += 1

        return count

    def get_top_consumers(
        self,
        metrics: StorageMetrics,
        limit: int = 5,
    ) -> list[tuple[str, int]]:
        """
        Get top storage consumers from metrics.

        Args:
            metrics: StorageMetrics to analyze
            limit: Maximum number of consumers to return

        Returns:
            List of (component_name, bytes) tuples sorted by size descending
        """
        consumers = [
            ("pr_reviews", metrics.pr_reviews_bytes),
            ("issues", metrics.issues_bytes),
            ("autofix", metrics.autofix_bytes),
            ("audit_logs", metrics.audit_logs_bytes),
            ("archive", metrics.archive_bytes),
            ("other", metrics.other_bytes),
        ]

        # Sort by size descending and limit
        consumers.sort(key=lambda x: x[1], reverse=True)
        return consumers[:limit]

    @staticmethod
    def format_size(bytes_value: int) -> str:
        """
        Format byte size as human-readable string.

        Args:
            bytes_value: Size in bytes

        Returns:
            Formatted string (e.g., "1.5 MB", "500 KB", "2.3 GB")
        """
        if bytes_value < 1024:
            return f"{bytes_value} B"

        kb = bytes_value / 1024
        if kb < 1024:
            return f"{kb:.1f} KB"

        mb = kb / 1024
        if mb < 1024:
            return f"{mb:.1f} MB"

        gb = mb / 1024
        return f"{gb:.2f} GB"

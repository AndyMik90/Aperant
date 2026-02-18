"""
Tests for Storage Metrics Calculator (storage_metrics.py)
=========================================================

Tests storage usage analysis and reporting for GitHub automation.
"""

from pathlib import Path
import json

import pytest

from runners.github.storage_metrics import (
    StorageMetrics,
    StorageMetricsCalculator,
)


# ============================================================================
# StorageMetrics Tests
# ============================================================================


class TestStorageMetrics:
    """Tests for StorageMetrics dataclass."""

    def test_default_values(self):
        """Test default metric values."""
        metrics = StorageMetrics()
        assert metrics.total_bytes == 0
        assert metrics.pr_reviews_bytes == 0
        assert metrics.issues_bytes == 0
        assert metrics.autofix_bytes == 0
        assert metrics.audit_logs_bytes == 0
        assert metrics.archive_bytes == 0
        assert metrics.other_bytes == 0
        assert metrics.record_count == 0
        assert metrics.archive_count == 0

    def test_total_mb_property(self):
        """Test total_mb property conversion."""
        metrics = StorageMetrics(total_bytes=1024 * 1024)  # 1 MB
        assert metrics.total_mb == 1.0

    def test_total_mb_property_large(self):
        """Test total_mb with large values."""
        metrics = StorageMetrics(total_bytes=5 * 1024 * 1024)  # 5 MB
        assert metrics.total_mb == 5.0

    def test_to_dict(self):
        """Test converting metrics to dict."""
        metrics = StorageMetrics(
            total_bytes=2048,
            pr_reviews_bytes=500,
            issues_bytes=300,
            autofix_bytes=200,
            audit_logs_bytes=100,
            archive_bytes=50,
            other_bytes=398,
            record_count=10,
            archive_count=5,
        )
        result = metrics.to_dict()
        assert result["total_bytes"] == 2048
        assert result["total_mb"] == 0.0  # < 1 MB, rounds to 0
        assert result["breakdown"]["pr_reviews"] == 500
        assert result["breakdown"]["issues"] == 300
        assert result["breakdown"]["autofix"] == 200
        assert result["breakdown"]["audit_logs"] == 100
        assert result["breakdown"]["archive"] == 50
        assert result["breakdown"]["other"] == 398
        assert result["record_count"] == 10
        assert result["archive_count"] == 5


# ============================================================================
# StorageMetricsCalculator Tests
# ============================================================================


class TestStorageMetricsCalculatorInit:
    """Tests for StorageMetricsCalculator initialization."""

    def test_init_with_path(self):
        """Test initialization with state directory."""
        state_dir = Path("/test/state")
        calculator = StorageMetricsCalculator(state_dir)
        assert calculator.state_dir == state_dir
        assert calculator.archive_dir == state_dir / "archive"


class TestCalculateDirectorySize:
    """Tests for _calculate_directory_size method."""

    def test_nonexistent_directory(self, tmp_path):
        """Test size calculation for nonexistent directory."""
        calculator = StorageMetricsCalculator(tmp_path)
        size = calculator._calculate_directory_size(tmp_path / "nonexistent")
        assert size == 0

    def test_empty_directory(self, tmp_path):
        """Test size calculation for empty directory."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        calculator = StorageMetricsCalculator(tmp_path)
        size = calculator._calculate_directory_size(empty_dir)
        assert size == 0

    def test_single_file(self, tmp_path):
        """Test size calculation with single file."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        test_file = test_dir / "file.txt"
        test_file.write_text("Hello, world!")  # 13 bytes

        calculator = StorageMetricsCalculator(tmp_path)
        size = calculator._calculate_directory_size(test_dir)
        assert size == 13

    def test_nested_files(self, tmp_path):
        """Test size calculation with nested files."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        (test_dir / "file1.txt").write_text("A" * 100)
        subdir = test_dir / "subdir"
        subdir.mkdir()
        (subdir / "file2.txt").write_text("B" * 50)

        calculator = StorageMetricsCalculator(tmp_path)
        size = calculator._calculate_directory_size(test_dir)
        assert size == 150


class TestCountRecords:
    """Tests for _count_records method."""

    def test_nonexistent_directory(self, tmp_path):
        """Test record count for nonexistent directory."""
        calculator = StorageMetricsCalculator(tmp_path)
        count = calculator._count_records(tmp_path / "nonexistent")
        assert count == 0

    def test_empty_directory(self, tmp_path):
        """Test record count for empty directory."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        calculator = StorageMetricsCalculator(tmp_path)
        count = calculator._count_records(empty_dir)
        assert count == 0

    def test_json_files_only(self, tmp_path):
        """Test that only JSON files are counted."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        (test_dir / "data1.json").write_text("{}")
        (test_dir / "data2.json").write_text("{}")
        (test_dir / "readme.txt").write_text("text")

        calculator = StorageMetricsCalculator(tmp_path)
        count = calculator._count_records(test_dir)
        assert count == 2

    def test_nested_json_files(self, tmp_path):
        """Test counting JSON files in nested directories."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        (test_dir / "data1.json").write_text("{}")
        subdir = test_dir / "subdir"
        subdir.mkdir()
        (subdir / "data2.json").write_text("{}")

        calculator = StorageMetricsCalculator(tmp_path)
        count = calculator._count_records(test_dir)
        assert count == 2


class TestCalculateMetrics:
    """Tests for calculate method."""

    def test_empty_state_directory(self, tmp_path):
        """Test calculation with empty state directory."""
        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()
        assert metrics.total_bytes == 0
        assert metrics.record_count == 0
        assert metrics.archive_count == 0

    def test_with_pr_reviews(self, tmp_path):
        """Test calculation with PR review data."""
        pr_dir = tmp_path / "pr"
        pr_dir.mkdir()
        (pr_dir / "review1.json").write_text('{"data": "x" * 100}')

        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()
        assert metrics.pr_reviews_bytes > 0
        assert metrics.record_count == 1

    def test_with_issues(self, tmp_path):
        """Test calculation with issues data."""
        issues_dir = tmp_path / "issues"
        issues_dir.mkdir()
        (issues_dir / "issue1.json").write_text('{"data": "y" * 200}')

        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()
        assert metrics.issues_bytes > 0
        assert metrics.record_count == 1

    def test_with_autofix(self, tmp_path):
        """Test calculation with autofix data."""
        autofix_dir = tmp_path / "autofix"
        autofix_dir.mkdir()
        (autofix_dir / "fix1.json").write_text('{"data": "z" * 150}')

        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()
        assert metrics.autofix_bytes > 0
        assert metrics.record_count == 1

    def test_with_audit_logs(self, tmp_path):
        """Test calculation with audit logs."""
        audit_dir = tmp_path / "audit"
        audit_dir.mkdir()
        (audit_dir / "log1.json").write_text('{"log": "entry" * 50}')

        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()
        assert metrics.audit_logs_bytes > 0

    def test_with_archive(self, tmp_path):
        """Test calculation with archive data."""
        archive_dir = tmp_path / "archive"
        archive_dir.mkdir()
        (archive_dir / "archived1.json").write_text('{"old": "data" * 80}')

        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()
        assert metrics.archive_bytes > 0
        assert metrics.archive_count == 1

    def test_complete_breakdown(self, tmp_path):
        """Test calculation with all component types."""
        # Create PR data
        pr_dir = tmp_path / "pr"
        pr_dir.mkdir()
        (pr_dir / "pr1.json").write_text('{"pr": "data" * 50}')

        # Create issues data
        issues_dir = tmp_path / "issues"
        issues_dir.mkdir()
        (issues_dir / "issue1.json").write_text('{"issue": "data" * 30}')

        # Create autofix data
        autofix_dir = tmp_path / "autofix"
        autofix_dir.mkdir()
        (autofix_dir / "fix1.json").write_text('{"fix": "data" * 40}')

        # Create audit data
        audit_dir = tmp_path / "audit"
        audit_dir.mkdir()
        (audit_dir / "audit1.json").write_text('{"audit": "log" * 20}')

        # Create archive data
        archive_dir = tmp_path / "archive"
        archive_dir.mkdir()
        (archive_dir / "archived.json").write_text('{"archive": "data" * 25}')

        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()

        assert metrics.pr_reviews_bytes > 0
        assert metrics.issues_bytes > 0
        assert metrics.autofix_bytes > 0
        assert metrics.audit_logs_bytes > 0
        assert metrics.archive_bytes > 0
        assert metrics.total_bytes > 0
        assert metrics.record_count == 3  # pr, issues, autofix
        assert metrics.archive_count == 1

    def test_other_bytes_calculated(self, tmp_path):
        """Test that 'other' bytes capture uncategorized data."""
        # Create uncategorized file
        (tmp_path / "other.txt").write_text("X" * 100)

        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()
        assert metrics.other_bytes > 0


class TestGetTopConsumers:
    """Tests for get_top_consumers method."""

    def test_empty_metrics(self):
        """Test top consumers with empty metrics."""
        calculator = StorageMetricsCalculator(Path("/tmp"))
        metrics = StorageMetrics()
        consumers = calculator.get_top_consumers(metrics)
        # All categories with 0 bytes are returned
        assert len(consumers) == 5
        assert all(size == 0 for _, size in consumers)

    def test_single_consumer(self):
        """Test top consumers with single category having data."""
        calculator = StorageMetricsCalculator(Path("/tmp"))
        metrics = StorageMetrics(pr_reviews_bytes=1000)
        consumers = calculator.get_top_consumers(metrics)
        # pr_reviews should be first with 1000 bytes
        assert consumers[0] == ("pr_reviews", 1000)

    def test_multiple_consumers_sorted(self):
        """Test that consumers are sorted by size."""
        calculator = StorageMetricsCalculator(Path("/tmp"))
        metrics = StorageMetrics(
            pr_reviews_bytes=100,
            issues_bytes=500,
            autofix_bytes=300,
            audit_logs_bytes=50,
            archive_bytes=200,
            other_bytes=25,
        )
        consumers = calculator.get_top_consumers(metrics)

        # Should be sorted descending: issues (500), autofix (300), archive (200), ...
        assert consumers[0][0] == "issues"
        assert consumers[0][1] == 500
        assert consumers[1][0] == "autofix"
        assert consumers[1][1] == 300

    def test_limit_parameter(self):
        """Test limit parameter for top consumers."""
        calculator = StorageMetricsCalculator(Path("/tmp"))
        metrics = StorageMetrics(
            pr_reviews_bytes=100,
            issues_bytes=500,
            autofix_bytes=300,
            audit_logs_bytes=50,
            archive_bytes=200,
        )
        consumers = calculator.get_top_consumers(metrics, limit=2)
        assert len(consumers) == 2


class TestFormatSize:
    """Tests for format_size static method."""

    def test_format_bytes(self):
        """Test formatting bytes."""
        result = StorageMetricsCalculator.format_size(512)
        assert result == "512 B"

    def test_format_kilobytes(self):
        """Test formatting kilobytes."""
        result = StorageMetricsCalculator.format_size(1024)
        assert result == "1.0 KB"

        result = StorageMetricsCalculator.format_size(5120)
        assert result == "5.0 KB"

    def test_format_megabytes(self):
        """Test formatting megabytes."""
        result = StorageMetricsCalculator.format_size(1024 * 1024)
        assert result == "1.0 MB"

        result = StorageMetricsCalculator.format_size(5 * 1024 * 1024)
        assert result == "5.0 MB"

    def test_format_gigabytes(self):
        """Test formatting gigabytes."""
        result = StorageMetricsCalculator.format_size(1024 * 1024 * 1024)
        assert result == "1.00 GB"

        result = StorageMetricsCalculator.format_size(2.5 * 1024 * 1024 * 1024)
        assert result == "2.50 GB"

    def test_format_fractional_kb(self):
        """Test formatting fractional kilobytes."""
        result = StorageMetricsCalculator.format_size(1536)  # 1.5 KB
        assert result == "1.5 KB"

    def test_format_fractional_mb(self):
        """Test formatting fractional megabytes."""
        result = StorageMetricsCalculator.format_size(1536 * 1024)  # 1.5 MB
        assert result == "1.5 MB"


class TestIntegration:
    """Integration tests for complete workflow."""

    def test_full_workflow(self, tmp_path):
        """Test complete metrics calculation workflow."""
        # Setup: Create various data files
        (tmp_path / "pr").mkdir()
        (tmp_path / "pr" / "review1.json").write_text('{"a": "data" * 100}')
        (tmp_path / "pr" / "review2.json").write_text('{"b": "data" * 50}')

        (tmp_path / "issues").mkdir()
        (tmp_path / "issues" / "issue1.json").write_text('{"c": "data" * 75}')

        (tmp_path / "archive").mkdir()
        (tmp_path / "archive" / "archived.json").write_text('{"d": "data" * 25}')

        # Calculate metrics
        calculator = StorageMetricsCalculator(tmp_path)
        metrics = calculator.calculate()

        # Verify metrics
        assert metrics.total_bytes > 0
        assert metrics.pr_reviews_bytes > 0
        assert metrics.issues_bytes > 0
        assert metrics.archive_bytes > 0
        assert metrics.record_count == 3  # 2 PR + 1 issue
        assert metrics.archive_count == 1

        # Get top consumers
        consumers = calculator.get_top_consumers(metrics, limit=3)
        assert len(consumers) <= 3

        # Format total size
        size_str = calculator.format_size(metrics.total_bytes)
        assert "B" in size_str or "KB" in size_str or "MB" in size_str

        # Convert to dict
        metrics_dict = metrics.to_dict()
        assert "total_bytes" in metrics_dict
        assert "breakdown" in metrics_dict

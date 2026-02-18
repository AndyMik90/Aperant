"""
Tests for Purge Strategy (purge_strategy.py)
============================================

Tests GDPR-compliant data purge implementation for GitHub automation.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from runners.github.purge_strategy import (
    PurgeResult,
    PurgeStrategy,
)


# ============================================================================
# PurgeResult Tests
# ============================================================================


class TestPurgeResult:
    """Tests for PurgeResult dataclass."""

    def test_default_values(self):
        """Test default result values."""
        result = PurgeResult()
        assert result.deleted_count == 0
        assert result.freed_bytes == 0
        assert result.errors == []
        assert isinstance(result.started_at, datetime)
        assert result.completed_at is None

    def test_freed_mb_property(self):
        """Test freed_mb property conversion."""
        result = PurgeResult(freed_bytes=1024 * 1024)  # 1 MB
        assert result.freed_mb == 1.0

    def test_freed_mb_property_large(self):
        """Test freed_mb with large values."""
        result = PurgeResult(freed_bytes=5 * 1024 * 1024)  # 5 MB
        assert result.freed_mb == 5.0

    def test_to_dict_without_completion(self):
        """Test converting result to dict before completion."""
        result = PurgeResult(
            deleted_count=5,
            freed_bytes=2048,
            errors=["error1", "error2"],
        )
        result.completed_at = None

        result_dict = result.to_dict()
        assert result_dict["deleted_count"] == 5
        assert result_dict["freed_bytes"] == 2048
        assert result_dict["freed_mb"] == 0.0  # < 1 MB
        assert result_dict["errors"] == ["error1", "error2"]
        assert result_dict["completed_at"] is None

    def test_to_dict_with_completion(self):
        """Test converting result to dict after completion."""
        result = PurgeResult(deleted_count=3, freed_bytes=1024)
        completed = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        result.completed_at = completed

        result_dict = result.to_dict()
        assert result_dict["deleted_count"] == 3
        assert result_dict["completed_at"] == completed.isoformat()


# ============================================================================
# PurgeStrategy Tests
# ============================================================================


class TestPurgeStrategyInit:
    """Tests for PurgeStrategy initialization."""

    def test_init(self, tmp_path):
        """Test initialization with state directory."""
        strategy = PurgeStrategy(tmp_path)
        assert strategy.state_dir == tmp_path
        assert strategy.archive_dir == tmp_path / "archive"


class TestPurgeByCriteria:
    """Tests for purge_by_criteria method."""

    @pytest.mark.asyncio
    async def test_purge_nonexistent(self, tmp_path):
        """Test purging when no matching files exist."""
        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_by_criteria(
            pattern="issue",
            key="issue_number",
            value=999,
        )
        assert result.deleted_count == 0
        assert result.freed_bytes == 0
        assert len(result.errors) == 0
        assert result.completed_at is not None

    @pytest.mark.asyncio
    async def test_purge_matching_file(self, tmp_path):
        """Test purging a file that matches criteria."""
        # Create test file
        test_dir = tmp_path / "issues"
        test_dir.mkdir()
        test_file = test_dir / "issue_123.json"
        data = {"issue_number": 123, "title": "Test issue"}
        test_file.write_text(json.dumps(data))

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_by_criteria(
            pattern="issue",
            key="issue_number",
            value=123,
        )

        assert result.deleted_count == 1
        assert result.freed_bytes > 0
        assert not test_file.exists()

    @pytest.mark.asyncio
    async def test_purge_with_repo_filter(self, tmp_path):
        """Test purging with repository filter."""
        # Create test files
        test_dir = tmp_path / "pr"
        test_dir.mkdir()

        # Matching file with correct repo
        matching_file = test_dir / "pr_owner_repo_456.json"
        matching_file.write_text(json.dumps({
            "pr_number": 456,
            "repo": "owner/repo"
        }))

        # File with different repo
        other_file = test_dir / "pr_other_repo_456.json"
        other_file.write_text(json.dumps({
            "pr_number": 456,
            "repo": "other/repo"
        }))

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_by_criteria(
            pattern="pr",
            key="pr_number",
            value=456,
            repo="owner/repo",
        )

        assert result.deleted_count == 1
        assert not matching_file.exists()
        assert other_file.exists()  # Should not be deleted

    @pytest.mark.asyncio
    async def test_purge_archive_files(self, tmp_path):
        """Test purging files in archive directory."""
        # Create archive directory
        archive_dir = tmp_path / "archive"
        archive_dir.mkdir()

        # Create archived file
        archived_file = archive_dir / "archived_123.json"
        archived_file.write_text('{"data": "test"}')

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_by_criteria(
            pattern="issue",
            key="issue_number",
            value=123,
        )

        # Archive files are deleted without validation
        assert result.deleted_count >= 1
        assert not archived_file.exists()

    @pytest.mark.asyncio
    async def test_purge_multiple_patterns(self, tmp_path):
        """Test purging with multiple file patterns."""
        # Create test files with different naming patterns
        issues_dir = tmp_path / "issues"
        issues_dir.mkdir()

        # File with value in name
        file1 = issues_dir / "issue-123-data.json"
        file1.write_text(json.dumps({"issue_number": 123}))

        # File with value in middle
        file2 = issues_dir / "123_issue.json"
        file2.write_text(json.dumps({"issue_number": 123}))

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_by_criteria(
            pattern="issue",
            key="issue_number",
            value=123,
        )

        assert result.deleted_count >= 1

    @pytest.mark.asyncio
    async def test_purge_skips_non_matching_key(self, tmp_path):
        """Test that files with different key values are not deleted."""
        test_dir = tmp_path / "issues"
        test_dir.mkdir()
        test_file = test_dir / "issue_999.json"
        test_file.write_text(json.dumps({"issue_number": 999}))

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_by_criteria(
            pattern="issue",
            key="issue_number",
            value=123,
        )

        assert result.deleted_count == 0
        assert test_file.exists()

    @pytest.mark.asyncio
    async def test_purge_invalid_json_skipped(self, tmp_path):
        """Test that invalid JSON files are skipped."""
        test_dir = tmp_path / "issues"
        test_dir.mkdir()
        test_file = test_dir / "invalid.json"
        test_file.write_text("{not valid json")

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_by_criteria(
            pattern="issue",
            key="issue_number",
            value=123,
        )

        # Invalid JSON should be skipped, no error reported
        assert result.deleted_count == 0
        assert len(result.errors) == 0


class TestPurgeRepository:
    """Tests for purge_repository method."""

    @pytest.mark.asyncio
    async def test_purge_nonexistent_repo(self, tmp_path):
        """Test purging repository that doesn't exist."""
        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_repository("owner/nonexistent")

        assert result.deleted_count == 0
        assert result.freed_bytes == 0

    @pytest.mark.asyncio
    async def test_purge_repository_files(self, tmp_path):
        """Test purging repository-specific files."""
        # Create test directories
        pr_dir = tmp_path / "pr"
        pr_dir.mkdir()
        issues_dir = tmp_path / "issues"
        issues_dir.mkdir()

        # Create repo-specific files
        pr_file = pr_dir / "owner_repo_pr_123.json"
        pr_file.write_text('{"data": "x" * 100}')

        issues_file = issues_dir / "owner_repo_issue_456.json"
        issues_file.write_text('{"data": "y" * 100}')

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_repository("owner/repo")

        assert result.deleted_count == 2
        assert result.freed_bytes > 0
        assert not pr_file.exists()
        assert not issues_file.exists()

    @pytest.mark.asyncio
    async def test_purge_repository_with_repo_dir(self, tmp_path):
        """Test purging entire repository directory."""
        # Create repos directory
        repos_dir = tmp_path / "repos"
        repos_dir.mkdir()
        repo_dir = repos_dir / "owner_repo"
        repo_dir.mkdir()

        # Create files in repo directory
        (repo_dir / "file1.json").write_text('{"a": "data" * 50}')
        (repo_dir / "file2.json").write_text('{"b": "data" * 50}')

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_repository("owner/repo")

        # Directory should be deleted
        assert not repo_dir.exists()
        assert result.deleted_count >= 1
        assert result.freed_bytes > 0

    @pytest.mark.asyncio
    async def test_purge_repository_skips_other_repos(self, tmp_path):
        """Test that other repository files are not deleted."""
        pr_dir = tmp_path / "pr"
        pr_dir.mkdir()

        # File from target repo
        target_file = pr_dir / "owner_repo_pr.json"
        target_file.write_text('{"data": "test"}')

        # File from different repo
        other_file = pr_dir / "other_repo_pr.json"
        other_file.write_text('{"data": "test"}')

        strategy = PurgeStrategy(tmp_path)
        await strategy.purge_repository("owner/repo")

        assert not target_file.exists()
        assert other_file.exists()

    @pytest.mark.asyncio
    async def test_purge_repository_handles_errors(self, tmp_path):
        """Test error handling during repository purge."""
        # Create a directory and make a file that will cause issues
        pr_dir = tmp_path / "pr"
        pr_dir.mkdir()

        # Create a file we can delete
        test_file = pr_dir / "owner_repo_test.json"
        test_file.write_text('{"data": "test"}')

        strategy = PurgeStrategy(tmp_path)
        result = await strategy.purge_repository("owner/repo")

        # Should complete without crashing
        assert isinstance(result, PurgeResult)
        assert result.completed_at is not None


class TestTryDeleteFile:
    """Tests for _try_delete_file method."""

    def test_deletes_matching_file(self, tmp_path):
        """Test deleting file that matches criteria."""
        test_file = tmp_path / "test.json"
        test_file.write_text(json.dumps({"issue_number": 123}))

        strategy = PurgeStrategy(tmp_path)
        result = PurgeResult()
        strategy._try_delete_file(test_file, "issue_number", 123, None, result)

        assert result.deleted_count == 1
        assert result.freed_bytes > 0
        assert not test_file.exists()

    def test_skips_non_matching_key(self, tmp_path):
        """Test skipping file with different key value."""
        test_file = tmp_path / "test.json"
        test_file.write_text(json.dumps({"issue_number": 999}))

        strategy = PurgeStrategy(tmp_path)
        result = PurgeResult()
        strategy._try_delete_file(test_file, "issue_number", 123, None, result)

        assert result.deleted_count == 0
        assert test_file.exists()

    def test_skips_non_matching_repo(self, tmp_path):
        """Test skipping file with different repo."""
        test_file = tmp_path / "test.json"
        test_file.write_text(json.dumps({
            "issue_number": 123,
            "repo": "other/repo"
        }))

        strategy = PurgeStrategy(tmp_path)
        result = PurgeResult()
        strategy._try_delete_file(test_file, "issue_number", 123, "owner/repo", result)

        assert result.deleted_count == 0
        assert test_file.exists()

    def test_handles_invalid_json(self, tmp_path):
        """Test handling invalid JSON file."""
        test_file = tmp_path / "invalid.json"
        test_file.write_text("{not valid json")

        strategy = PurgeStrategy(tmp_path)
        result = PurgeResult()
        strategy._try_delete_file(test_file, "key", 123, None, result)

        assert result.deleted_count == 0
        assert len(result.errors) == 0  # Expected, not an error


class TestTryDeleteFileSimple:
    """Tests for _try_delete_file_simple method."""

    def test_deletes_file(self, tmp_path):
        """Test simple file deletion."""
        test_file = tmp_path / "test.json"
        test_file.write_text('{"data": "test"}')

        strategy = PurgeStrategy(tmp_path)
        result = PurgeResult()
        strategy._try_delete_file_simple(test_file, result)

        assert result.deleted_count == 1
        assert result.freed_bytes > 0
        assert not test_file.exists()

    def test_handles_missing_file(self, tmp_path):
        """Test handling nonexistent file."""
        test_file = tmp_path / "nonexistent.json"

        strategy = PurgeStrategy(tmp_path)
        result = PurgeResult()
        strategy._try_delete_file_simple(test_file, result)

        # Should not crash, error might be added
        assert isinstance(result, PurgeResult)


class TestCalculateDirectorySize:
    """Tests for _calculate_directory_size method."""

    def test_empty_directory(self, tmp_path):
        """Test calculating size of empty directory."""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()

        strategy = PurgeStrategy(tmp_path)
        size = strategy._calculate_directory_size(empty_dir)
        assert size == 0

    def test_nonexistent_directory(self, tmp_path):
        """Test calculating size of nonexistent directory."""
        strategy = PurgeStrategy(tmp_path)
        size = strategy._calculate_directory_size(tmp_path / "nonexistent")
        assert size == 0

    def test_single_file(self, tmp_path):
        """Test calculating size with single file."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        test_file = test_dir / "file.txt"
        test_file.write_text("X" * 100)

        strategy = PurgeStrategy(tmp_path)
        size = strategy._calculate_directory_size(test_dir)
        assert size == 100

    def test_nested_files(self, tmp_path):
        """Test calculating size with nested files."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        (test_dir / "file1.txt").write_text("A" * 50)
        subdir = test_dir / "subdir"
        subdir.mkdir()
        (subdir / "file2.txt").write_text("B" * 75)

        strategy = PurgeStrategy(tmp_path)
        size = strategy._calculate_directory_size(test_dir)
        assert size == 125

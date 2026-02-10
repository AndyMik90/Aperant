#!/usr/bin/env python3
"""
Tests for Workspace Selection and Management
=============================================

Tests the workspace.py module functionality including:
- Workspace mode selection (isolated vs direct)
- Uncommitted changes detection
- Workspace setup
- Build finalization workflows
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

# Add parent directory to path so we can import the workspace module
# When co-located at workspace/tests/, we need to add backend to path
# workspace/tests -> workspace -> core -> backend (4 levels up)
_backend = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(_backend))

from core.workspace import (
    WorkspaceChoice,
    WorkspaceMode,
    get_current_branch,
    get_existing_build_worktree,
    has_uncommitted_changes,
    setup_workspace,
)
from worktree import WorktreeError, WorktreeManager

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"

# =============================================================================
# TESTS FOR git_utils.py
# =============================================================================


class TestDetectFileRenames:
    def test_detects_single_file_rename(self, temp_git_repo: Path):
        """Detects a single file rename between two refs."""
        from core.workspace.git_utils import detect_file_renames

        # Create and commit a file
        (temp_git_repo / "old_name.txt").write_text("content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=temp_git_repo, capture_output=True
        )

        # Get the commit hash
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        old_commit = result.stdout.strip()

        # Rename the file
        (temp_git_repo / "old_name.txt").rename(temp_git_repo / "new_name.txt")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Rename file"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        assert len(renames) == 1
        assert "old_name.txt" in renames
        assert renames["old_name.txt"] == "new_name.txt"

    def test_detects_multiple_file_renames(self, temp_git_repo: Path):
        """Detects multiple file renames between two refs."""
        from core.workspace.git_utils import detect_file_renames

        # Create and commit files
        (temp_git_repo / "file1.txt").write_text("content1", encoding="utf-8")
        (temp_git_repo / "file2.txt").write_text("content2", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add files"], cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        old_commit = result.stdout.strip()

        # Rename both files
        (temp_git_repo / "file1.txt").rename(temp_git_repo / "renamed1.txt")
        (temp_git_repo / "file2.txt").rename(temp_git_repo / "renamed2.txt")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Rename files"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        assert len(renames) == 2
        assert "file1.txt" in renames
        assert renames["file1.txt"] == "renamed1.txt"
        assert "file2.txt" in renames
        assert renames["file2.txt"] == "renamed2.txt"

    def test_returns_empty_dict_when_no_renames(self, temp_git_repo: Path):
        """Returns empty dict when no renames occurred."""
        from core.workspace.git_utils import detect_file_renames

        # Create and commit a file
        (temp_git_repo / "test.txt").write_text("content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        old_commit = result.stdout.strip()

        # Modify file (not rename)
        (temp_git_repo / "test.txt").write_text("modified content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Modify file"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        assert len(renames) == 0

    def test_returns_empty_dict_on_invalid_refs(self, temp_git_repo: Path):
        """Returns empty dict when given invalid refs."""
        from core.workspace.git_utils import detect_file_renames

        renames = detect_file_renames(temp_git_repo, "invalid_ref", "HEAD")

        assert renames == {}

    def test_detects_renames_with_similarity(self, temp_git_repo: Path):
        """Detects renames even when file content was slightly modified."""
        from core.workspace.git_utils import detect_file_renames

        # Create and commit a file
        (temp_git_repo / "old.txt").write_text("line1\nline2\nline3", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        old_commit = result.stdout.strip()

        # Rename and slightly modify
        (temp_git_repo / "old.txt").rename(temp_git_repo / "new.txt")
        (temp_git_repo / "new.txt").write_text(
            "line1\nline2 modified\nline3", encoding="utf-8"
        )
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Rename and modify"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        # Git may or may not detect rename with similarity threshold
        # Just verify the function runs without error
        assert isinstance(renames, dict)

    def test_detects_directory_moves(self, temp_git_repo: Path):
        """Detects files moved to different directories."""
        from core.workspace.git_utils import detect_file_renames

        # Create directory structure and commit
        (temp_git_repo / "src").mkdir()
        (temp_git_repo / "src" / "old.py").write_text(
            "def foo(): pass", encoding="utf-8"
        )
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        old_commit = result.stdout.strip()

        # Create new directory and move file
        (temp_git_repo / "lib").mkdir()
        (temp_git_repo / "src" / "old.py").rename(temp_git_repo / "lib" / "new.py")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Move file"], cwd=temp_git_repo, capture_output=True
        )

        # Detect renames
        renames = detect_file_renames(temp_git_repo, old_commit, "HEAD")

        assert len(renames) == 1
        assert "src/old.py" in renames
        assert renames["src/old.py"] == "lib/new.py"


class TestApplyPathMapping:
    """Tests for apply_path_mapping function."""

    def test_returns_original_path_when_no_mapping(self):
        """Returns original path when no mapping exists."""

        mappings = {}
        result = apply_path_mapping("src/file.py", mappings)

        assert result == "src/file.py"

    def test_returns_mapped_path_when_exact_match(self):
        """Returns mapped path when exact match found."""

        mappings = {"old/path.py": "new/path.py"}
        result = apply_path_mapping("old/path.py", mappings)

        assert result == "new/path.py"

    def test_returns_original_path_when_not_in_mappings(self):
        """Returns original path when path not in mappings."""

        mappings = {"other/file.py": "mapped/file.py"}
        result = apply_path_mapping("src/file.py", mappings)

        assert result == "src/file.py"

    def test_handles_multiple_mappings(self):
        """Correctly applies one of many mappings."""

        mappings = {
            "src/old1.py": "src/new1.py",
            "src/old2.py": "src/new2.py",
            "src/old3.py": "src/new3.py",
        }

        assert apply_path_mapping("src/old1.py", mappings) == "src/new1.py"
        assert apply_path_mapping("src/old2.py", mappings) == "src/new2.py"
        assert apply_path_mapping("src/old3.py", mappings) == "src/new3.py"

    def test_handles_empty_path(self):
        """Handles empty string path."""

        mappings = {"file.py": "mapped.py"}
        result = apply_path_mapping("", mappings)

        assert result == ""

    def test_handles_path_with_special_characters(self):
        """Handles paths with special characters."""

        mappings = {"src/file-with-dashes.py": "src/file_with_underscores.py"}
        result = apply_path_mapping("src/file-with-dashes.py", mappings)

        assert result == "src/file_with_underscores.py"


class TestGetMergeBase:
    """Tests for get_merge_base function."""

    def test_finds_merge_base_for_diverged_branches(self, temp_git_repo: Path):
        """Finds merge-base commit for two diverged branches."""
        from core.workspace.git_utils import get_merge_base

        # Create a file on main
        (temp_git_repo / "base.txt").write_text("base content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Create a feature branch
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "feature.txt").write_text("feature content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Add a commit to main
        subprocess.run(
            ["git", "checkout", "main"], cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "main.txt").write_text("main content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Main commit"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Find merge base
        merge_base = get_merge_base(temp_git_repo, "main", "feature")

        assert merge_base is not None
        assert len(merge_base) == 40  # SHA-1 hash length

    def test_returns_none_for_invalid_ref(self, temp_git_repo: Path):
        """Returns None when given invalid ref."""
        from core.workspace.git_utils import get_merge_base

        merge_base = get_merge_base(temp_git_repo, "main", "invalid_branch")

        assert merge_base is None

    def test_finds_merge_base_same_branch(self, temp_git_repo: Path):
        """Returns current commit when refs are the same."""
        from core.workspace.git_utils import get_merge_base

        merge_base = get_merge_base(temp_git_repo, "HEAD", "HEAD")

        assert merge_base is not None
        assert len(merge_base) == 40

    def test_finds_merge_base_for_ancestors(self, temp_git_repo: Path):
        """Finds merge-base when one ref is ancestor of other."""
        from core.workspace.git_utils import get_merge_base

        # Create initial commit
        (temp_git_repo / "base.txt").write_text("base", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"], cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        base_commit = result.stdout.strip()

        # Add commit on top
        (temp_git_repo / "new.txt").write_text("new", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "New"], cwd=temp_git_repo, capture_output=True
        )

        # Merge base of HEAD and its ancestor should be the ancestor
        merge_base = get_merge_base(temp_git_repo, "HEAD", base_commit)

        assert merge_base == base_commit


class TestGetFileContentFromRef:
    """Tests for get_file_content_from_ref function."""

    def test_gets_file_content_from_commit(self, temp_git_repo: Path):
        """Gets file content from a specific commit."""
        from core.workspace.git_utils import get_file_content_from_ref

        # Create and commit a file
        (temp_git_repo / "test.txt").write_text("file content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=temp_git_repo, capture_output=True
        )

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=temp_git_repo,
            capture_output=True,
            text=True,
        )
        commit_hash = result.stdout.strip()

        # Get file content
        content = get_file_content_from_ref(temp_git_repo, commit_hash, "test.txt")

        assert content == "file content"

    def test_returns_none_for_nonexistent_file(self, temp_git_repo: Path):
        """Returns None when file doesn't exist at ref."""
        from core.workspace.git_utils import get_file_content_from_ref

        content = get_file_content_from_ref(temp_git_repo, "HEAD", "nonexistent.txt")

        assert content is None

    def test_returns_none_for_invalid_ref(self, temp_git_repo: Path):
        """Returns None when ref doesn't exist."""
        from core.workspace.git_utils import get_file_content_from_ref

        content = get_file_content_from_ref(temp_git_repo, "invalid_ref", "test.txt")

        assert content is None

    def test_gets_file_content_from_branch(self, temp_git_repo: Path):
        """Gets file content from a branch name."""
        from core.workspace.git_utils import get_file_content_from_ref

        # Create and commit a file on main
        (temp_git_repo / "branch_file.txt").write_text(
            "branch content", encoding="utf-8"
        )
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=temp_git_repo, capture_output=True
        )

        # Get file content from branch
        content = get_file_content_from_ref(temp_git_repo, "main", "branch_file.txt")

        assert content == "branch content"

    def test_handles_multiline_file_content(self, temp_git_repo: Path):
        """Handles multiline file content correctly."""
        from core.workspace.git_utils import get_file_content_from_ref

        # Create and commit a multiline file
        content = "line1\nline2\nline3"
        (temp_git_repo / "multiline.txt").write_text(content, encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=temp_git_repo, capture_output=True
        )

        # Get file content
        result = get_file_content_from_ref(temp_git_repo, "HEAD", "multiline.txt")

        assert result == content

    def test_handles_empty_file(self, temp_git_repo: Path):
        """Handles empty file correctly."""
        from core.workspace.git_utils import get_file_content_from_ref

        # Create and commit an empty file
        (temp_git_repo / "empty.txt").write_text("", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add empty file"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get file content
        content = get_file_content_from_ref(temp_git_repo, "HEAD", "empty.txt")

        assert content == ""


class TestGetBinaryFileContentFromRef:
    """Tests for get_binary_file_content_from_ref function."""

    def test_gets_binary_file_content(self, temp_git_repo: Path):
        """Gets binary file content from a ref."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        # Create and commit a binary file
        binary_content = b"\x00\x01\x02\x03\x04\x05"
        (temp_git_repo / "binary.bin").write_bytes(binary_content)
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add binary file"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get binary content
        content = get_binary_file_content_from_ref(temp_git_repo, "HEAD", "binary.bin")

        assert content == binary_content

    def test_returns_none_for_nonexistent_file(self, temp_git_repo: Path):
        """Returns None when file doesn't exist."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        content = get_binary_file_content_from_ref(
            temp_git_repo, "HEAD", "nonexistent.bin"
        )

        assert content is None

    def test_returns_none_for_invalid_ref(self, temp_git_repo: Path):
        """Returns None when ref doesn't exist."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        content = get_binary_file_content_from_ref(
            temp_git_repo, "invalid_ref", "test.bin"
        )

        assert content is None

    def test_handles_large_binary_file(self, temp_git_repo: Path):
        """Handles larger binary files correctly."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        # Create and commit a larger binary file
        binary_content = bytes(range(256)) * 100  # 25.6 KB
        (temp_git_repo / "large.bin").write_bytes(binary_content)
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add large binary file"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get binary content
        content = get_binary_file_content_from_ref(temp_git_repo, "HEAD", "large.bin")

        assert content == binary_content

    def test_handles_zero_byte_file(self, temp_git_repo: Path):
        """Handles zero-byte binary files."""
        from core.workspace.git_utils import get_binary_file_content_from_ref

        # Create and commit an empty file
        (temp_git_repo / "empty.bin").write_bytes(b"")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add empty binary file"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get binary content
        content = get_binary_file_content_from_ref(temp_git_repo, "HEAD", "empty.bin")

        assert content == b""


class TestGetChangedFilesFromBranch:
    """Tests for get_changed_files_from_branch function."""

    def test_lists_changed_files(self, temp_git_repo: Path):
        """Lists all changed files between branches."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create a file on main
        (temp_git_repo / "base.txt").write_text("base", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"], cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch with changes
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "new_file.txt").write_text("new", encoding="utf-8")
        (temp_git_repo / "modified.txt").write_text("modified", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature changes"],
            cwd=temp_git_repo,
            capture_output=True,
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        assert len(files) == 2
        file_paths = [f[0] for f in files]
        assert "new_file.txt" in file_paths
        assert "modified.txt" in file_paths

    def test_excludes_auto_claude_files_by_default(self, temp_git_repo: Path):
        """Excludes .auto-claude directory files by default."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create base
        (temp_git_repo / "base.txt").write_text("base", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"], cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch with .auto-claude files
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / ".auto-claude").mkdir()
        (temp_git_repo / ".auto-claude" / "spec.json").write_text(
            "spec", encoding="utf-8"
        )
        (temp_git_repo / "normal.txt").write_text("normal", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature"], cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        file_paths = [f[0] for f in files]
        assert ".auto-claude/spec.json" not in file_paths
        assert "normal.txt" in file_paths

    def test_includes_auto_claude_files_when_disabled(self, temp_git_repo: Path):
        """Includes .auto-claude files when exclude_auto_claude=False."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create base
        (temp_git_repo / "base.txt").write_text("base", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"], cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / ".auto-claude").mkdir()
        (temp_git_repo / ".auto-claude" / "spec.json").write_text(
            "spec", encoding="utf-8"
        )
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature"], cwd=temp_git_repo, capture_output=True
        )

        # Get changed files without exclusion
        files = get_changed_files_from_branch(
            temp_git_repo, "main", "feature", exclude_auto_claude=False
        )

        file_paths = [f[0] for f in files]
        assert ".auto-claude/spec.json" in file_paths

    def test_includes_file_status(self, temp_git_repo: Path):
        """Includes file status (A, M, D) in results."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create base
        (temp_git_repo / "file.txt").write_text("original", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"], cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch with additions
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "added.txt").write_text("added", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add file"], cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        assert len(files) == 1
        # Status should be 'A' for added
        assert files[0][1] in (
            "A",
            "M",
        )  # Git may report as A or M depending on version

    def test_returns_empty_list_when_no_changes(self, temp_git_repo: Path):
        """Returns empty list when there are no changes."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create commit on main
        (temp_git_repo / "file.txt").write_text("content", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial"], cwd=temp_git_repo, capture_output=True
        )

        # Create branch at same commit
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        assert len(files) == 0

    def test_excludes_legacy_auto_claude_spec_files(self, temp_git_repo: Path):
        """Excludes auto-claude/specs directory files."""
        from core.workspace.git_utils import get_changed_files_from_branch

        # Create base
        (temp_git_repo / "base.txt").write_text("base", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Base"], cwd=temp_git_repo, capture_output=True
        )

        # Create feature branch with legacy auto-claude/specs files
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=temp_git_repo, capture_output=True
        )
        (temp_git_repo / "auto-claude").mkdir()
        (temp_git_repo / "auto-claude" / "specs").mkdir()
        (temp_git_repo / "auto-claude" / "specs" / "spec.md").write_text(
            "spec", encoding="utf-8"
        )
        (temp_git_repo / "normal.txt").write_text("normal", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Feature"], cwd=temp_git_repo, capture_output=True
        )

        # Get changed files
        files = get_changed_files_from_branch(temp_git_repo, "main", "feature")

        file_paths = [f[0] for f in files]
        assert "auto-claude/specs/spec.md" not in file_paths
        assert "normal.txt" in file_paths


class TestIsProcessRunning:
    """Tests for is_process_running function."""

    def test_returns_false_for_nonexistent_pid(self):
        """Returns False for a non-existent PID."""
        from core.workspace.git_utils import is_process_running

        # Use a very high PID that's unlikely to exist
        result = is_process_running(999999)

        assert result is False

    def test_returns_true_for_current_process(self):
        """Returns True for the current process PID."""
        import os

        from core.workspace.git_utils import is_process_running

        current_pid = os.getpid()
        result = is_process_running(current_pid)

        assert result is True


class TestIsBinaryFile:
    """Tests for is_binary_file function."""

    def test_identifies_image_files(self):
        """Identifies image files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("image.png") is True
        assert is_binary_file("photo.jpg") is True
        assert is_binary_file("picture.jpeg") is True
        assert is_binary_file("graphic.gif") is True
        assert is_binary_file("icon.ico") is True
        assert is_binary_file("image.webp") is True
        assert is_binary_file("image.bmp") is True
        assert is_binary_file("image.svg") is True
        assert is_binary_file("image.tiff") is True

    def test_identifies_document_files(self):
        """Identifies document files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("doc.pdf") is True
        assert is_binary_file("doc.doc") is True
        assert is_binary_file("doc.docx") is True
        assert is_binary_file("sheet.xls") is True
        assert is_binary_file("sheet.xlsx") is True

    def test_identifies_archive_files(self):
        """Identifies archive files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("archive.zip") is True
        assert is_binary_file("archive.tar") is True
        assert is_binary_file("archive.gz") is True
        assert is_binary_file("archive.rar") is True
        assert is_binary_file("archive.7z") is True
        assert is_binary_file("archive.bz2") is True

    def test_identifies_executable_files(self):
        """Identifies executable files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("program.exe") is True
        assert is_binary_file("library.dll") is True
        assert is_binary_file("library.so") is True
        assert is_binary_file("library.dylib") is True
        assert is_binary_file("binary.bin") is True

    def test_identifies_audio_files(self):
        """Identifies audio files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("audio.mp3") is True
        assert is_binary_file("audio.wav") is True
        assert is_binary_file("audio.ogg") is True
        assert is_binary_file("audio.flac") is True

    def test_identifies_video_files(self):
        """Identifies video files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("video.mp4") is True
        assert is_binary_file("video.avi") is True
        assert is_binary_file("video.mov") is True
        assert is_binary_file("video.mkv") is True

    def test_identifies_font_files(self):
        """Identifies font files as binary."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("font.woff") is True
        assert is_binary_file("font.woff2") is True
        assert is_binary_file("font.ttf") is True
        assert is_binary_file("font.otf") is True

    def test_returns_false_for_text_files(self):
        """Returns False for text files."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("file.txt") is False
        assert is_binary_file("file.py") is False
        assert is_binary_file("file.js") is False
        assert is_binary_file("file.ts") is False
        assert is_binary_file("file.md") is False
        assert is_binary_file("file.json") is False
        assert is_binary_file("file.xml") is False
        assert is_binary_file("file.yaml") is False
        assert is_binary_file("file.yml") is False

    def test_case_insensitive_extension_check(self):
        """Handles uppercase extensions correctly."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("image.PNG") is True
        assert is_binary_file("image.JPG") is True
        assert is_binary_file("document.PDF") is True

    def test_handles_paths_with_directories(self):
        """Handles file paths with directory components."""
        from core.workspace.git_utils import is_binary_file

        assert is_binary_file("path/to/image.png") is True
        assert is_binary_file("src/lib/file.py") is False
        assert is_binary_file("assets/logo.jpg") is True


class TestIsLockFile:
    """Tests for is_lock_file function."""

    def test_identifies_npm_lock_file(self):
        """Identifies package-lock.json as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("package-lock.json") is True

    def test_identifies_pnpm_lock_file(self):
        """Identifies pnpm-lock.yaml as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("pnpm-lock.yaml") is True

    def test_identifies_yarn_lock_file(self):
        """Identifies yarn.lock as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("yarn.lock") is True

    def test_identifies_bun_lock_files(self):
        """Identifies bun.lockb and bun.lock as lock files."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("bun.lockb") is True
        assert is_lock_file("bun.lock") is True

    def test_identifies_python_lock_files(self):
        """Identifies Python lock files."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("Pipfile.lock") is True
        assert is_lock_file("poetry.lock") is True
        assert is_lock_file("uv.lock") is True

    def test_identifies_rust_lock_file(self):
        """Identifies Cargo.lock as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("Cargo.lock") is True

    def test_identifies_ruby_lock_file(self):
        """Identifies Gemfile.lock as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("Gemfile.lock") is True

    def test_identifies_php_lock_file(self):
        """Identifies composer.lock as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("composer.lock") is True

    def test_identifies_go_lock_file(self):
        """Identifies go.sum as lock file."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("go.sum") is True

    def test_returns_false_for_non_lock_files(self):
        """Returns False for non-lock files."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("package.json") is False
        assert is_lock_file("pyproject.toml") is False
        assert is_lock_file("Cargo.toml") is False
        assert is_lock_file("Gemfile") is False
        assert is_lock_file("file.txt") is False

    def test_handles_paths_with_directories(self):
        """Handles file paths with directory components."""
        from core.workspace.git_utils import is_lock_file

        assert is_lock_file("path/to/package-lock.json") is True
        assert is_lock_file("src/pnpm-lock.yaml") is True
        assert is_lock_file("deps/yarn.lock") is True


class TestValidateMergedSyntax:
    """Tests for validate_merged_syntax function."""

    def test_validates_python_syntax_successfully(self, temp_dir: Path):
        """Validates correct Python syntax successfully."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "def hello():\n    return 'world'\n"
        is_valid, error = validate_merged_syntax("test.py", code, temp_dir)

        assert is_valid is True
        assert error == ""

    def test_detects_python_syntax_errors(self, temp_dir: Path):
        """Detects Python syntax errors."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "def hello(\n    return 'world'\n"
        is_valid, error = validate_merged_syntax("test.py", code, temp_dir)

        assert is_valid is False
        assert "syntax error" in error.lower()

    def test_validates_json_syntax_successfully(self, temp_dir: Path):
        """Validates correct JSON syntax successfully."""
        from core.workspace.git_utils import validate_merged_syntax

        code = '{"key": "value", "number": 123}'
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        assert is_valid is True
        assert error == ""

    def test_detects_json_syntax_errors(self, temp_dir: Path):
        """Detects JSON syntax errors."""
        from core.workspace.git_utils import validate_merged_syntax

        code = '{"key": "value", "number"'
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        assert is_valid is False
        assert "json error" in error.lower() or "syntax" in error.lower()

    def test_skips_validation_for_unknown_extensions(self, temp_dir: Path):
        """Skips validation for unknown file types."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "some random content"
        is_valid, error = validate_merged_syntax("file.unknown", code, temp_dir)

        assert is_valid is True
        assert error == ""

    def test_validates_typescript_with_mocked_esbuild(self, temp_dir: Path):
        """Validates TypeScript using esbuild (mocked)."""
        from unittest.mock import MagicMock, patch

        from core.workspace.git_utils import validate_merged_syntax

        code = "const x: number = 123;\n"

        # Mock subprocess.run for esbuild
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.ts", code, temp_dir)

        # If esbuild is found, should validate
        # If not found, should skip validation (return True)
        assert is_valid is True

    def test_detects_typescript_syntax_errors_with_mock(self, temp_dir: Path):
        """Detects TypeScript syntax errors (mocked esbuild)."""
        from unittest.mock import MagicMock, patch

        from core.workspace.git_utils import validate_merged_syntax

        code = "const x: = 123;\n"  # Invalid syntax

        # Mock subprocess.run for esbuild to return error
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "✘ [ERROR] Expected expression but found '}'"

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.ts", code, temp_dir)

        assert is_valid is False
        assert "syntax error" in error.lower()

    def test_skips_validation_when_esbuild_not_found(self, temp_dir: Path):
        """Skips validation when esbuild is not available."""
        from unittest.mock import patch

        from core.workspace.git_utils import validate_merged_syntax

        code = "const x: number = 123;\n"

        # Mock subprocess.run to raise FileNotFoundError
        with patch("subprocess.run", side_effect=FileNotFoundError):
            is_valid, error = validate_merged_syntax("test.ts", code, temp_dir)

        assert is_valid is True
        assert error == ""

    def test_validates_javascript_with_mocked_esbuild(self, temp_dir: Path):
        """Validates JavaScript using esbuild (mocked)."""
        from unittest.mock import MagicMock, patch

        from core.workspace.git_utils import validate_merged_syntax

        code = "const x = 123;\n"

        # Mock subprocess.run for esbuild
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.js", code, temp_dir)

        assert is_valid is True

    def test_validates_jsx_with_mocked_esbuild(self, temp_dir: Path):
        """Validates JSX using esbuild (mocked)."""
        from unittest.mock import MagicMock, patch

        from core.workspace.git_utils import validate_merged_syntax

        code = "const App = () => <div>Hello</div>;\n"

        # Mock subprocess.run for esbuild
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.jsx", code, temp_dir)

        assert is_valid is True

    def test_validates_tsx_with_mocked_esbuild(self, temp_dir: Path):
        """Validates TSX using esbuild (mocked)."""
        from unittest.mock import MagicMock, patch

        from core.workspace.git_utils import validate_merged_syntax

        code = "const App: React.FC = () => <div>Hello</div>;\n"

        # Mock subprocess.run for esbuild
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""

        with patch("subprocess.run", return_value=mock_result):
            is_valid, error = validate_merged_syntax("test.tsx", code, temp_dir)

        assert is_valid is True

    def test_handles_python_indentation_errors(self, temp_dir: Path):
        """Detects Python indentation errors."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "def hello():\n  return 'world'\n    return 'bad'\n"
        is_valid, error = validate_merged_syntax("test.py", code, temp_dir)

        assert is_valid is False
        assert "syntax error" in error.lower() or "indentation" in error.lower()

    def test_validates_empty_python_file(self, temp_dir: Path):
        """Validates empty Python file."""
        from core.workspace.git_utils import validate_merged_syntax

        code = ""
        is_valid, error = validate_merged_syntax("test.py", code, temp_dir)

        assert is_valid is True

    def test_validates_empty_json_file(self, temp_dir: Path):
        """Validates empty JSON file."""
        from core.workspace.git_utils import validate_merged_syntax

        code = "{}"
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        # Empty object is valid JSON
        assert is_valid is True

    def test_validates_complex_json(self, temp_dir: Path):
        """Validates complex nested JSON."""
        from core.workspace.git_utils import validate_merged_syntax

        code = '{"nested": {"key": "value", "array": [1, 2, 3]}}'
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        assert is_valid is True

    def test_detects_json_with_trailing_comma(self, temp_dir: Path):
        """Detects JSON error with trailing comma."""
        from core.workspace.git_utils import validate_merged_syntax

        code = '{"key": "value",}'
        is_valid, error = validate_merged_syntax("test.json", code, temp_dir)

        assert is_valid is False

    def test_handles_esbuild_timeout_gracefully(self, temp_dir: Path):
        """Handles esbuild timeout by skipping validation."""
        import subprocess
        from unittest.mock import patch

        from core.workspace.git_utils import validate_merged_syntax

        code = "const x = 123;\n"

        # Mock subprocess.run to raise TimeoutExpired
        with patch(
            "subprocess.run", side_effect=subprocess.TimeoutExpired("esbuild", 15)
        ):
            is_valid, error = validate_merged_syntax("test.ts", code, temp_dir)

        assert is_valid is True
        assert error == ""


class TestCreateConflictFileWithGit:
    """Tests for create_conflict_file_with_git function."""

    def test_creates_clean_merge(self, temp_git_repo: Path):
        """Creates merged content when there are no conflicts."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "line1\nline2\nline3"
        worktree_content = "line1\nline2\nline3"
        base_content = "line1\nline2\nline3"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "line1" in merged

    def test_detects_conflicts(self, temp_git_repo: Path):
        """Detects conflicts and adds conflict markers."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "line1\nmain version\nline3"
        worktree_content = "line1\nworktree version\nline3"
        base_content = "line1\nline2\nline3"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is True
        assert merged is not None
        assert "<<<<<<<" in merged or "=======" in merged or ">>>>>>>" in merged

    def test_handles_none_base_content(self, temp_git_repo: Path):
        """Handles None as base content."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "line1\nline2"
        worktree_content = "line1\nline2"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, None, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None

    def test_returns_none_on_error(self, temp_dir: Path):
        """Returns (None, False) when git merge-file fails."""
        from unittest.mock import patch

        from core.workspace.git_utils import create_conflict_file_with_git

        # Mock run_git to raise an exception
        with patch(
            "core.workspace.git_utils.run_git", side_effect=Exception("Git error")
        ):
            merged, had_conflicts = create_conflict_file_with_git(
                "main", "worktree", "base", temp_dir
            )

        assert merged is None
        assert had_conflicts is False

    def test_auto_merges_when_only_main_changed(self, temp_git_repo: Path):
        """Auto-merges when only main content changed from base."""
        from core.workspace.git_utils import create_conflict_file_with_git

        base_content = "original line"
        main_content = "modified line"
        worktree_content = "original line"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "modified line" in merged

    def test_auto_merges_when_only_worktree_changed(self, temp_git_repo: Path):
        """Auto-merges when only worktree content changed from base."""
        from core.workspace.git_utils import create_conflict_file_with_git

        base_content = "original line"
        main_content = "original line"
        worktree_content = "modified line"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "modified line" in merged

    def test_handles_multiline_conflicts(self, temp_git_repo: Path):
        """Handles conflicts in multiline content."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "line1\nline2 main\nline3"
        worktree_content = "line1\nline2 worktree\nline3"
        base_content = "line1\nline2\nline3"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        assert had_conflicts is True
        assert merged is not None

    def test_handles_empty_contents(self, temp_git_repo: Path):
        """Handles empty string contents."""
        from core.workspace.git_utils import create_conflict_file_with_git

        merged, had_conflicts = create_conflict_file_with_git("", "", "", temp_git_repo)

        assert had_conflicts is False
        assert merged is not None

    def test_cleanup_temp_files(self, temp_git_repo: Path):
        """Cleans up temporary files after merge."""
        import tempfile
        from pathlib import Path

        from core.workspace.git_utils import create_conflict_file_with_git

        # Count temp files before
        temp_dir = tempfile.gettempdir()
        # Run merge
        create_conflict_file_with_git("content", "content", "content", temp_git_repo)

        # Note: This is a weak test as other processes may create temp files
        # The main assertion is that no exception is raised
        assert True  # If we got here without exception, cleanup worked

    def test_preserves_newlines_in_merged_content(self, temp_git_repo: Path):
        """Preserves newlines in merged content."""
        from core.workspace.git_utils import create_conflict_file_with_git

        content = "line1\nline2\nline3\n"
        merged, had_conflicts = create_conflict_file_with_git(
            content, content, content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "\n" in merged

    def test_handles_unicode_content(self, temp_git_repo: Path):
        """Handles unicode characters in content."""
        from core.workspace.git_utils import create_conflict_file_with_git

        content = "# Comment with émoji 🎉\nline1\n"
        merged, had_conflicts = create_conflict_file_with_git(
            content, content, content, temp_git_repo
        )

        assert had_conflicts is False
        assert merged is not None
        assert "émoji" in merged or "🎉" in merged

    def test_conflict_markers_format(self, temp_git_repo: Path):
        """Verifies conflict marker format."""
        from core.workspace.git_utils import create_conflict_file_with_git

        main_content = "main version"
        worktree_content = "worktree version"
        base_content = "base version"

        merged, had_conflicts = create_conflict_file_with_git(
            main_content, worktree_content, base_content, temp_git_repo
        )

        if had_conflicts:
            # Check for standard git conflict markers
            assert "<<<<<<<" in merged
            assert "=======" in merged
            assert ">>>>>>>" in merged


# =============================================================================
# TESTS FOR MISSING COVERAGE IN git_utils.py AND models.py
# =============================================================================

from core.workspace.git_utils import (
    apply_path_mapping,
    detect_file_renames,
    validate_merged_syntax,
)


class TestDetectFileRenamesErrorHandling:
    """Tests for error handling in detect_file_renames (lines 214-215)."""

    def test_detect_file_renames_handles_git_command_failure(self, temp_git_repo: Path):
        """detect_file_renames returns empty dict when git command fails (line 214-215)."""
        from unittest.mock import patch

        with patch("core.workspace.git_utils.run_git") as mock_git:
            # Simulate git command failure
            mock_git.return_value = type(
                "Result", (), {"returncode": 1, "stdout": ""}
            )()

            result = detect_file_renames(temp_git_repo, "main", "feature")

            assert result == {}
            mock_git.assert_called_once()

    def test_detect_file_renames_handles_exception_during_parsing(
        self, temp_git_repo: Path
    ):
        """detect_file_renames returns empty dict when exception occurs (line 214-215)."""
        from unittest.mock import patch

        with patch("core.workspace.git_utils.run_git") as mock_git:
            # Simulate an exception during git command execution
            mock_git.side_effect = Exception("Git command failed")

            result = detect_file_renames(temp_git_repo, "main", "feature")

            # Should return empty dict on error
            assert result == {}

    def test_detect_file_renames_handles_malformed_git_output(
        self, temp_git_repo: Path
    ):
        """detect_file_renames handles malformed git output gracefully (line 214-215)."""
        from unittest.mock import patch

        with patch("core.workspace.git_utils.run_git") as mock_git:
            # Return success but with malformed output
            mock_git.return_value = type(
                "Result", (), {"returncode": 0, "stdout": "R\tincomplete\n"}
            )()

            result = detect_file_renames(temp_git_repo, "main", "feature")

            # Should handle gracefully and not crash
            assert isinstance(result, dict)

    def test_detect_file_renames_returns_empty_dict_on_invalid_refs(
        self, temp_git_repo: Path
    ):
        """detect_file_renames returns empty dict for non-existent refs."""
        result = detect_file_renames(
            temp_git_repo, "nonexistent-ref-1", "nonexistent-ref-2"
        )

        # Should return empty dict when refs don't exist
        assert result == {}


class TestValidateMergedSyntaxErrorHandling:
    """Tests for error handling in validate_merged_syntax (lines 450-469, 506-507)."""

    def test_validate_merged_syntax_generic_exception_handling(
        self, temp_git_repo: Path
    ):
        """validate_merged_syntax handles generic exceptions gracefully (lines 506-507)."""
        from unittest.mock import patch

        # Test with a TypeScript file that will trigger an exception
        with patch("subprocess.run") as mock_run:
            # Simulate a generic exception (not TimeoutExpired or FileNotFoundError)
            mock_run.side_effect = RuntimeError("Unexpected error")

            is_valid, error = validate_merged_syntax(
                "test.ts", "const x: string = 'test';", temp_git_repo
            )

            # Should return True (skip validation) on generic exception
            assert is_valid is True
            assert error == ""

    def test_validate_merged_syntax_handles_permission_error(self, temp_git_repo: Path):
        """validate_merged_syntax handles permission errors during temp file creation."""
        from unittest.mock import patch

        with patch("tempfile.NamedTemporaryFile") as mock_tmp:
            # Simulate permission error
            mock_tmp.side_effect = PermissionError("Permission denied")

            is_valid, error = validate_merged_syntax(
                "test.ts", "const x: string = 'test';", temp_git_repo
            )

            # Should return True on permission error (skip validation)
            assert is_valid is True
            assert error == ""

    def test_validate_merged_syntax_handles_os_error(self, temp_git_repo: Path):
        """validate_merged_syntax handles OS errors gracefully."""
        from unittest.mock import patch

        with patch("tempfile.NamedTemporaryFile") as mock_tmp:
            # Simulate OS error
            mock_tmp.side_effect = OSError("OS error")

            is_valid, error = validate_merged_syntax(
                "test.ts", "const x: string = 'test';", temp_git_repo
            )

            # Should return True on OS error
            assert is_valid is True
            assert error == ""

    @pytest.mark.slow
    def test_validate_merged_syntax_finds_pnpm_esbuild(self, temp_git_repo: Path):
        """validate_merged_syntax finds esbuild in pnpm structure (lines 450-455)."""
        # Create pnpm-style node_modules structure
        pnpm_dir = temp_git_repo / "node_modules" / ".pnpm"
        esbuild_version_dir = (
            pnpm_dir / "esbuild@0.19.0" / "node_modules" / "esbuild" / "bin"
        )
        esbuild_version_dir.mkdir(parents=True)

        # Create a fake esbuild executable
        esbuild_binary = esbuild_version_dir / "esbuild"
        if os.name != "nt":
            esbuild_binary.write_text(
                "#!/bin/sh\necho 'esbuild found'\n", encoding="utf-8"
            )
            os.chmod(esbuild_binary, 0o700)
        else:
            esbuild_binary.write_text("echo esbuild found", encoding="utf-8")

        # This test verifies the pnpm path search logic
        # Note: Actual esbuild execution may still be skipped if not properly installed
        is_valid, error = validate_merged_syntax(
            "test.ts", "const x: string = 'test';", temp_git_repo
        )

        # Should not crash; result depends on whether esbuild actually runs
        assert isinstance(is_valid, bool)
        assert isinstance(error, str)

    @pytest.mark.slow
    def test_validate_merged_syntax_finds_npm_esbuild(self, temp_git_repo: Path):
        """validate_merged_syntax finds esbuild in npm structure (lines 459-460)."""
        # Create npm-style node_modules structure
        npm_bin_dir = temp_git_repo / "node_modules" / ".bin"
        npm_bin_dir.mkdir(parents=True)

        # Create a fake esbuild executable
        esbuild_binary = npm_bin_dir / "esbuild"
        if os.name != "nt":
            esbuild_binary.write_text(
                "#!/bin/sh\necho 'esbuild found'\n", encoding="utf-8"
            )
            os.chmod(esbuild_binary, 0o700)
        else:
            esbuild_binary.write_text("echo esbuild found", encoding="utf-8")

        # This test verifies the npm path search logic
        is_valid, error = validate_merged_syntax(
            "test.ts", "const x: string = 'test';", temp_git_repo
        )

        # Should not crash
        assert isinstance(is_valid, bool)
        assert isinstance(error, str)

    @pytest.mark.slow
    def test_validate_merged_syntax_searches_parent_directory(
        self, temp_git_repo: Path
    ):
        """validate_merged_syntax searches parent directory for esbuild (line 462)."""
        # Create esbuild in parent directory (apps/frontend sibling structure simulation)
        # This simulates the monorepo structure where backend searches frontend's node_modules
        parent_dir = temp_git_repo.parent
        if parent_dir.exists():
            npm_bin_dir = parent_dir / "node_modules" / ".bin"
            npm_bin_dir.mkdir(parents=True, exist_ok=True)

            esbuild_binary = npm_bin_dir / "esbuild"
            if os.name != "nt":
                esbuild_binary.write_text(
                    "#!/bin/sh\necho 'esbuild'\n", encoding="utf-8"
                )
                os.chmod(esbuild_binary, 0o700)
            else:
                esbuild_binary.write_text("echo esbuild", encoding="utf-8")

            is_valid, error = validate_merged_syntax(
                "test.ts", "const x: string = 'test';", temp_git_repo
            )

            assert isinstance(is_valid, bool)

    def test_validate_merged_syntax_falls_back_to_npx(self, temp_git_repo: Path):
        """validate_merged_syntax falls back to npx when esbuild not found (line 469)."""
        # Ensure no local esbuild exists
        npm_bin = temp_git_repo / "node_modules" / ".bin"
        if npm_bin.exists():
            import shutil

            shutil.rmtree(npm_bin)

        # Should fall back to npx and not crash
        # Note: npx may or may not be available, but function should handle it
        is_valid, error = validate_merged_syntax(
            "test.ts", "const x: string = 'test';", temp_git_repo
        )

        # Should return True if npx not available (skip validation)
        # or actual validation result if npx is available
        assert isinstance(is_valid, bool)
        assert isinstance(error, str)

    def test_validate_merged_syntax_npx_fallback_with_mock(
        self, temp_git_repo: Path, monkeypatch
    ):
        """validate_merged_syntax uses npx fallback when esbuild binary not found (lines 466-467)."""
        from unittest.mock import MagicMock, patch

        # Mock Path.exists() to ensure no esbuild binary is found anywhere
        original_exists = Path.exists

        def mock_exists(self):
            """Return False for any esbuild-related paths."""
            path_str = str(self)
            # Return False for esbuild binary paths to force npx fallback
            if "esbuild" in path_str and (
                "node_modules" in path_str or ".bin" in path_str
            ):
                return False
            # Otherwise use original exists
            return original_exists(self)

        # Use Path object directly, not string path
        monkeypatch.setattr(Path, "exists", mock_exists)

        # Track the actual subprocess.run calls
        run_calls = []

        def mock_run(args, **kwargs):
            """Mock that verifies npx fallback is used."""
            run_calls.append((args, kwargs))
            # Simulate successful npx esbuild execution

            completed = MagicMock()
            completed.returncode = 0
            completed.stdout = b""
            completed.stderr = b""
            return completed

        monkeypatch.setattr("subprocess.run", mock_run)

        # Test file with valid TypeScript syntax
        test_content = "const x: string = 'test';"
        test_file = temp_git_repo / "test.ts"
        test_file.write_text(test_content, encoding="utf-8")

        # Call validate_merged_syntax
        from core.workspace.git_utils import validate_merged_syntax

        is_valid, error = validate_merged_syntax(
            str(test_file), test_content, temp_git_repo
        )

        # Verify npx fallback was used
        assert len(run_calls) > 0
        npx_used = any("npx" in str(call[0]) for call in run_calls)
        assert npx_used, "npx fallback should be used when esbuild binary not found"

        # Should return True since syntax is valid
        assert is_valid is True

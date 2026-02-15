"""
Tests for prompt_generator module functions.

Tests for worktree detection and environment context generation.
"""

import sys
from pathlib import Path

import pytest

# Note: sys.path manipulation is handled by conftest.py line 46
from prompts_pkg.prompt_generator import (
    detect_worktree_isolation,
    generate_environment_context,
)

# Skip Windows-specific tests on non-Windows platforms
is_windows = sys.platform == 'win32'
skip_on_windows = pytest.mark.skipif(not is_windows, reason="Test only applies to Windows")
skip_on_non_windows = pytest.mark.skipif(is_windows, reason="Test only applies to non-Windows platforms")


def normalize_path(path_str: str) -> str:
    """Normalize path string for cross-platform comparison."""
    # Convert to lowercase and replace backslashes with forward slashes
    return path_str.lower().replace("\\", "/")


class TestDetectWorktreeIsolation:
    """Tests for detect_worktree_isolation function."""

    def test_new_worktree_unix_path(self):
        """Test detection of new worktree location on Unix-style path."""
        # New worktree: /project/.auto-claude/worktrees/tasks/spec-name/
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature")

        is_worktree, forbidden = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert forbidden is not None
        # On Windows, paths get resolved with drive letter, so check for key parts
        norm_forbidden = normalize_path(str(forbidden))
        assert "opt/dev/project" in norm_forbidden
        assert ".auto-claude" not in norm_forbidden

    @skip_on_windows
    def test_new_worktree_windows_path(self):
        """Test detection of new worktree location on Windows."""
        # Windows path with backslashes
        project_dir = Path("E:/projects/x/.auto-claude/worktrees/tasks/009-audit")

        is_worktree, forbidden = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert forbidden is not None
        # Check the essential parts
        norm_forbidden = normalize_path(str(forbidden))
        assert "projects" in norm_forbidden and "x" in norm_forbidden
        assert ".auto-claude" not in norm_forbidden

    def test_legacy_worktree_unix_path(self):
        """Test detection of legacy worktree location on Unix-style path."""
        # Legacy worktree: /project/.worktrees/spec-name/
        project_dir = Path("/opt/dev/project/.worktrees/001-feature")

        is_worktree, forbidden = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert forbidden is not None
        # Check for key parts
        norm_forbidden = normalize_path(str(forbidden))
        assert "opt/dev/project" in norm_forbidden
        assert ".worktrees" not in norm_forbidden

    @skip_on_windows
    def test_legacy_worktree_windows_path(self):
        """Test detection of legacy worktree location on Windows."""
        from unittest.mock import patch

        project_dir = Path("C:/projects/x/.worktrees/009-audit")

        # Mock resolve() to return a fixed path on Windows-style paths
        # since resolve() on Linux would prepend current working directory
        with patch.object(Path, 'resolve', return_value=Path("C:/projects/x/.worktrees/009-audit")):
            is_worktree, forbidden = detect_worktree_isolation(project_dir)

            assert is_worktree is True
            assert forbidden is not None
            # Check the essential parts
            norm_forbidden = normalize_path(str(forbidden))
            assert "projects" in norm_forbidden
            assert ".worktrees" not in norm_forbidden

    def test_pr_worktree_unix_path(self):
        """Test detection of PR review worktree location on Unix-style path."""
        # PR worktree: /project/.auto-claude/github/pr/worktrees/123/
        project_dir = Path("/opt/dev/project/.auto-claude/github/pr/worktrees/123")

        is_worktree, forbidden = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert forbidden is not None
        # Check for key parts
        norm_forbidden = normalize_path(str(forbidden))
        assert "opt/dev/project" in norm_forbidden
        assert ".auto-claude" not in norm_forbidden

    def test_pr_worktree_windows_path(self):
        """Test detection of PR review worktree location on Windows."""
        project_dir = Path("E:/projects/auto-claude/.auto-claude/github/pr/worktrees/1528")

        is_worktree, forbidden = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert forbidden is not None
        # The forbidden path should be E:/projects/auto-claude (the project folder)
        # Note: project folder itself is named "auto-claude", so check for that
        norm_forbidden = normalize_path(str(forbidden))
        assert "projects/auto-claude" in norm_forbidden  # project folder name
        assert "github/pr/worktrees" not in norm_forbidden

    def test_not_in_worktree(self):
        """Test when not in a worktree (direct mode)."""
        # Direct mode: /project/
        project_dir = Path("/opt/dev/project")

        is_worktree, forbidden = detect_worktree_isolation(project_dir)

        assert is_worktree is False
        assert forbidden is None

    def test_deeply_nested_worktree(self):
        """Test worktree detection with deeply nested project directory."""
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/009-very-long-spec-name-for-testing")

        is_worktree, forbidden = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert forbidden is not None
        # Check for key parts
        norm_forbidden = normalize_path(str(forbidden))
        assert "opt/dev/project" in norm_forbidden
        assert ".auto-claude" not in norm_forbidden

    def test_regular_auto_claude_dir(self):
        """Test that regular .auto-claude dir is NOT detected as worktree."""
        # Just having .auto-claude in path doesn't make it a worktree
        project_dir = Path("/opt/dev/project/.auto-claude/specs/001-feature")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is False
        assert parent_path is None

    def test_empty_or_root_path(self):
        """Test edge case with minimal paths."""
        # Root path
        project_dir = Path("/")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is False
        assert parent_path is None


class TestGenerateEnvironmentContext:
    """Tests for generate_environment_context function."""

    def test_context_includes_worktree_warning(self):
        """Test that worktree isolation warning is included when in worktree."""
        spec_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify worktree warning is present
        assert "ISOLATED WORKTREE - CRITICAL" in context
        assert "FORBIDDEN PATH:" in context
        # Check that some form of the parent path is shown
        assert "opt" in context.lower() and "project" in context.lower()

    def test_context_no_worktree_warning_in_direct_mode(self):
        """Test that worktree warning is NOT included in direct mode."""
        spec_dir = Path("/opt/dev/project/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify worktree warning is NOT present
        assert "ISOLATED WORKTREE - CRITICAL" not in context
        assert "FORBIDDEN PATH:" not in context

    def test_context_includes_basic_environment(self):
        """Test that basic environment information is always included."""
        spec_dir = Path("/opt/dev/project/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify basic sections
        assert "## YOUR ENVIRONMENT" in context
        assert "**Working Directory:**" in context
        assert "**Spec Location:**" in context
        assert "implementation_plan.json" in context

    def test_context_windows_worktree(self):
        """Test worktree warning with Windows paths (from ticket ACS-394)."""
        # This is the exact scenario from the bug report
        spec_dir = Path(
            "E:/projects/x/.auto-claude/worktrees/tasks/009-audit"
            "/.auto-claude/specs/009-audit"
        )
        project_dir = Path(
            "E:/projects/x/.auto-claude/worktrees/tasks/009-audit"
        )

        context = generate_environment_context(project_dir, spec_dir)

        # Verify worktree warning includes the Windows path
        # Note: Path resolution on Windows converts forward slashes to backslashes
        assert "ISOLATED WORKTREE - CRITICAL" in context
        # The forbidden path should be the parent project
        assert "FORBIDDEN PATH:" in context

    def test_context_forbidden_path_examples(self):
        """Test that forbidden path is shown and rules are included."""
        spec_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify forbidden parent path is shown
        assert "FORBIDDEN PATH:" in context
        # Check that some form of the parent path is shown (cross-platform)
        assert "opt" in context.lower() and "project" in context.lower()

        # Verify Rules section exists
        assert "### Rules:" in context
        assert "**NEVER**" in context  # Explicit prohibition

        # Verify Why This Matters section explains consequences
        assert "### Why This Matters:" in context
        assert "Git commits made in the parent project go to the WRONG branch" in context

    def test_context_includes_isolation_mode_indicator(self):
        """Test that Isolation Mode indicator is shown when in worktree."""
        spec_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify Isolation Mode indicator is present
        assert "**Isolation Mode:** WORKTREE" in context

    def test_context_no_isolation_mode_in_direct_mode(self):
        """Test that Isolation Mode indicator is NOT shown in direct mode."""
        spec_dir = Path("/opt/dev/project/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify Isolation Mode is not present
        assert "**Isolation Mode:**" not in context

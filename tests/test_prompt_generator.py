"""
Tests for prompt_generator module functions.

Tests for worktree detection and environment context generation.
"""

from pathlib import Path

# Note: sys.path manipulation is handled by conftest.py line 46
from prompts_pkg.prompt_generator import (
    detect_worktree_isolation,
    generate_environment_context,
)


class TestDetectWorktreeIsolation:
    """Tests for detect_worktree_isolation function (core worktree detection)."""

    def test_new_worktree_pattern_unix(self):
        """Test detection of .auto-claude/worktrees/tasks/ pattern on Unix."""
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert parent_path is not None
        # Parent should be the project root before .auto-claude
        assert str(parent_path).endswith("project") or "project" in str(parent_path)

    def test_new_worktree_pattern_windows(self):
        """Test detection of .auto-claude/worktrees/tasks/ pattern on Windows."""
        project_dir = Path("E:/projects/myapp/.auto-claude/worktrees/tasks/009-audit")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert parent_path is not None

    def test_legacy_worktree_pattern_unix(self):
        """Test detection of .worktrees/ legacy pattern on Unix."""
        project_dir = Path("/opt/dev/project/.worktrees/001-feature")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert parent_path is not None

    def test_legacy_worktree_pattern_windows(self):
        """Test detection of .worktrees/ legacy pattern on Windows."""
        project_dir = Path("C:/projects/myapp/.worktrees/009-audit")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert parent_path is not None

    def test_pr_review_worktree_pattern(self):
        """Test detection of PR review worktree pattern (.auto-claude/github/pr/worktrees/)."""
        project_dir = Path("/opt/dev/project/.auto-claude/github/pr/worktrees/pr-123")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert parent_path is not None
        # Parent should be before the .auto-claude marker
        assert "project" in str(parent_path) or str(parent_path).endswith("project")

    def test_pr_review_worktree_pattern_windows(self):
        """Test PR review worktree pattern on Windows."""
        project_dir = Path("E:/projects/myapp/.auto-claude/github/pr/worktrees/pr-456")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is True
        assert parent_path is not None

    def test_not_in_worktree(self):
        """Test when not in any worktree (direct mode)."""
        project_dir = Path("/opt/dev/project")

        is_worktree, parent_path = detect_worktree_isolation(project_dir)

        assert is_worktree is False
        assert parent_path is None

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
        assert "escape isolation" in context.lower()

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
        assert "PATH CONFUSION PREVENTION" in context

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
        assert "projects" in context and "x" in context

    def test_context_forbidden_path_examples(self):
        """Test that forbidden path is shown and critical rules are included."""
        spec_dir = Path(
            "/opt/dev/project/.auto-claude/worktrees/tasks/001-feature"
            "/.auto-claude/specs/001-feature"
        )
        project_dir = Path(
            "/opt/dev/project/.auto-claude/worktrees/tasks/001-feature"
        )

        context = generate_environment_context(project_dir, spec_dir)

        # Verify forbidden parent path is shown
        assert "FORBIDDEN PATH:" in context

        # Verify rules section exists with prohibition
        assert "Rules:" in context
        assert "**NEVER**" in context  # Explicit prohibition

        # Verify consequences are explained
        assert "WRONG branch" in context

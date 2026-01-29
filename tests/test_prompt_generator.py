"""
Tests for prompt_generator module functions.

Tests for worktree detection and environment context generation.
"""

from pathlib import Path

# Note: sys.path manipulation is handled by conftest.py line 46

from prompts_pkg.prompt_generator import detect_worktree_mode, generate_environment_context


class TestDetectWorktreeMode:
    """Tests for detect_worktree_mode function."""

    def test_new_worktree_unix_path(self):
        """Test detection of new worktree location on Unix."""
        # New worktree: /project/.auto-claude/worktrees/tasks/spec-name/.auto-claude/specs/spec/
        spec_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature")

        is_worktree, forbidden = detect_worktree_mode(spec_dir)

        assert is_worktree is True
        assert forbidden == "/opt/dev/project"

    def test_new_worktree_windows_path(self):
        """Test detection of new worktree location on Windows."""
        # Windows path with backslashes
        spec_dir = Path("E:/projects/x/.auto-claude/worktrees/tasks/009-audit/.auto-claude/specs/009-audit")
        project_dir = Path("E:/projects/x/.auto-claude/worktrees/tasks/009-audit")

        is_worktree, forbidden = detect_worktree_mode(spec_dir)

        assert is_worktree is True
        assert forbidden == "E:/projects/x"

    def test_legacy_worktree_unix_path(self):
        """Test detection of legacy worktree location on Unix."""
        # Legacy worktree: /project/.worktrees/spec-name/.auto-claude/specs/spec/
        spec_dir = Path("/opt/dev/project/.worktrees/001-feature/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project/.worktrees/001-feature")

        is_worktree, forbidden = detect_worktree_mode(spec_dir)

        assert is_worktree is True
        assert forbidden == "/opt/dev/project"

    def test_legacy_worktree_windows_path(self):
        """Test detection of legacy worktree location on Windows."""
        spec_dir = Path("C:/projects/x/.worktrees/009-audit/.auto-claude/specs/009-audit")
        project_dir = Path("C:/projects/x/.worktrees/009-audit")

        is_worktree, forbidden = detect_worktree_mode(spec_dir)

        assert is_worktree is True
        assert forbidden == "C:/projects/x"

    def test_not_in_worktree(self):
        """Test when not in a worktree (direct mode)."""
        # Direct mode: /project/.auto-claude/specs/spec/
        spec_dir = Path("/opt/dev/project/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project")

        is_worktree, forbidden = detect_worktree_mode(spec_dir)

        assert is_worktree is False
        assert forbidden is None

    def test_deeply_nested_worktree(self):
        """Test worktree detection with deeply nested spec directory."""
        spec_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/009-very-long-spec-name-for-testing/.auto-claude/specs/009-very-long-spec-name-for-testing")
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/009-very-long-spec-name-for-testing")

        is_worktree, forbidden = detect_worktree_mode(spec_dir)

        assert is_worktree is True
        assert forbidden == "/opt/dev/project"


class TestGenerateEnvironmentContext:
    """Tests for generate_environment_context function."""

    def test_context_includes_worktree_warning(self):
        """Test that worktree isolation warning is included when in worktree."""
        spec_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify worktree warning is present
        assert "ISOLATED WORKTREE - CRITICAL" in context
        assert "FORBIDDEN:" in context
        assert "/opt/dev/project" in context
        assert "ESCAPES ISOLATION" in context

    def test_context_no_worktree_warning_in_direct_mode(self):
        """Test that worktree warning is NOT included in direct mode."""
        spec_dir = Path("/opt/dev/project/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify worktree warning is NOT present
        assert "ISOLATED WORKTREE - CRITICAL" not in context
        assert "FORBIDDEN:" not in context

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
        spec_dir = Path("E:/projects/x/.auto-claude/worktrees/tasks/009-audit/.auto-claude/specs/009-audit")
        project_dir = Path("E:/projects/x/.auto-claude/worktrees/tasks/009-audit")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify worktree warning includes the Windows path
        assert "ISOLATED WORKTREE - CRITICAL" in context
        assert "E:/projects/x" in context
        assert "cd E:/projects/x" in context or '"cd E:/projects/x"' in context

    def test_context_forbidden_path_examples(self):
        """Test that forbidden path is shown and critical rules are included."""
        spec_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature/.auto-claude/specs/001-feature")
        project_dir = Path("/opt/dev/project/.auto-claude/worktrees/tasks/001-feature")

        context = generate_environment_context(project_dir, spec_dir)

        # Verify forbidden parent path is shown
        assert "FORBIDDEN:" in context
        assert "/opt/dev/project" in context  # The parent project that is forbidden

        # Verify CRITICAL RULES section exists
        assert "**CRITICAL RULES:**" in context
        assert "**NEVER**" in context  # Explicit prohibition

        # Verify violation warning explains consequences
        assert "**VIOLATION WARNING:**" in context
        assert "Git commits going to wrong branch" in context

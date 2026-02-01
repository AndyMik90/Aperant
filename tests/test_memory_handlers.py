"""
Tests for Memory Handlers
=========================

Tests for the Anthropic memory tool handlers used by the planning agent.
"""

import pytest
from pathlib import Path
import tempfile
import shutil


class TestMemoryHandlers:
    """Tests for MemoryHandlers class."""

    @pytest.fixture
    def temp_spec_dir(self):
        """Create a temporary spec directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.fixture
    def handlers(self, temp_spec_dir):
        """Create MemoryHandlers instance."""
        from agents.memory_handlers import MemoryHandlers
        return MemoryHandlers(temp_spec_dir)

    def test_init_creates_memories_dir(self, temp_spec_dir):
        """Verify __init__ creates memories directory."""
        from agents.memory_handlers import MemoryHandlers
        handlers = MemoryHandlers(temp_spec_dir)
        assert (temp_spec_dir / "memories").exists()
        assert (temp_spec_dir / "memories").is_dir()

    def test_view_empty_directory(self, handlers, temp_spec_dir):
        """Verify view returns empty message for empty memories dir."""
        result = handlers.view("/memories")
        assert "empty" in result.lower() or result == ""

    def test_view_nonexistent_file(self, handlers):
        """Verify view returns error for nonexistent file."""
        result = handlers.view("/memories/nonexistent.md")
        assert "does not exist" in result.lower()

    def test_create_file(self, handlers, temp_spec_dir):
        """Verify create creates a new file."""
        result = handlers.create("/memories/test.md", "# Test\nContent here")
        assert "created successfully" in result.lower()

        file_path = temp_spec_dir / "memories" / "test.md"
        assert file_path.exists()
        assert file_path.read_text() == "# Test\nContent here"

    def test_create_file_already_exists(self, handlers, temp_spec_dir):
        """Verify create returns error if file exists."""
        # Create file first
        (temp_spec_dir / "memories" / "existing.md").write_text("existing")

        result = handlers.create("/memories/existing.md", "new content")
        assert "already exists" in result.lower()

    def test_create_nested_path(self, handlers, temp_spec_dir):
        """Verify create creates parent directories."""
        result = handlers.create("/memories/subdir/nested/file.md", "content")
        assert "created successfully" in result.lower()

        file_path = temp_spec_dir / "memories" / "subdir" / "nested" / "file.md"
        assert file_path.exists()

    def test_view_file_with_line_numbers(self, handlers, temp_spec_dir):
        """Verify view returns file contents with line numbers."""
        handlers.create("/memories/lines.md", "line1\nline2\nline3")

        result = handlers.view("/memories/lines.md")
        assert "1 |" in result or "1|" in result
        assert "line1" in result
        assert "line2" in result
        assert "line3" in result

    def test_str_replace(self, handlers, temp_spec_dir):
        """Verify str_replace replaces text in file."""
        handlers.create("/memories/replace.md", "Hello World")

        result = handlers.str_replace("/memories/replace.md", "World", "Universe")
        assert "edited" in result.lower()

        content = (temp_spec_dir / "memories" / "replace.md").read_text()
        assert content == "Hello Universe"

    def test_str_replace_not_found(self, handlers, temp_spec_dir):
        """Verify str_replace returns error if text not found."""
        handlers.create("/memories/noreplace.md", "Hello World")

        result = handlers.str_replace("/memories/noreplace.md", "NotFound", "New")
        assert "not found" in result.lower()

    def test_str_replace_multiple_occurrences(self, handlers, temp_spec_dir):
        """Verify str_replace returns error for multiple matches."""
        handlers.create("/memories/multi.md", "foo foo foo")

        result = handlers.str_replace("/memories/multi.md", "foo", "bar")
        assert "multiple" in result.lower()

    def test_insert(self, handlers, temp_spec_dir):
        """Verify insert adds text at correct line."""
        handlers.create("/memories/insert.md", "line1\nline3")

        result = handlers.insert("/memories/insert.md", 1, "line2")
        assert "edited" in result.lower()

        content = (temp_spec_dir / "memories" / "insert.md").read_text()
        assert "line1" in content
        assert "line2" in content
        assert "line3" in content

    def test_delete_file(self, handlers, temp_spec_dir):
        """Verify delete removes a file."""
        handlers.create("/memories/todelete.md", "content")
        file_path = temp_spec_dir / "memories" / "todelete.md"
        assert file_path.exists()

        result = handlers.delete("/memories/todelete.md")
        assert "deleted" in result.lower()
        assert not file_path.exists()

    def test_delete_directory(self, handlers, temp_spec_dir):
        """Verify delete removes a directory."""
        handlers.create("/memories/toremove/file.md", "content")
        dir_path = temp_spec_dir / "memories" / "toremove"
        assert dir_path.exists()

        result = handlers.delete("/memories/toremove")
        assert "deleted" in result.lower()
        assert not dir_path.exists()

    def test_rename(self, handlers, temp_spec_dir):
        """Verify rename moves a file."""
        handlers.create("/memories/old.md", "content")

        result = handlers.rename("/memories/old.md", "/memories/new.md")
        assert "renamed" in result.lower()

        assert not (temp_spec_dir / "memories" / "old.md").exists()
        assert (temp_spec_dir / "memories" / "new.md").exists()

    def test_path_traversal_blocked(self, handlers, temp_spec_dir):
        """Verify path traversal attempts are blocked."""
        with pytest.raises(ValueError, match="traversal"):
            handlers._validate_path("/memories/../../../etc/passwd")

    def test_handle_tool_call_view(self, handlers, temp_spec_dir):
        """Verify handle_tool_call routes view command."""
        handlers.create("/memories/tool.md", "tool content")

        result = handlers.handle_tool_call("view", path="/memories/tool.md")
        assert "tool content" in result

    def test_handle_tool_call_unknown_command(self, handlers):
        """Verify handle_tool_call returns error for unknown command."""
        result = handlers.handle_tool_call("unknown_command")
        assert "unknown" in result.lower()


class TestPlanningAgentConfig:
    """Tests for planning agent configuration."""

    def test_planning_config_exists(self):
        """Verify 'planning' config exists in AGENT_CONFIGS."""
        from agents.tools_pkg import AGENT_CONFIGS
        assert "planning" in AGENT_CONFIGS

    def test_planning_config_has_required_fields(self):
        """Verify planning config has all required fields."""
        from agents.tools_pkg import get_agent_config
        config = get_agent_config("planning")

        assert "tools" in config
        assert "mcp_servers" in config
        assert "thinking_default" in config

    def test_planning_cannot_run_bash(self):
        """Verify planning agent cannot run bash commands."""
        from agents.tools_pkg import can_run_bash
        assert can_run_bash("planning") is False

    def test_planning_cannot_execute_subtasks(self):
        """Verify planning agent cannot execute subtasks."""
        from agents.tools_pkg import can_execute_subtasks
        assert can_execute_subtasks("planning") is False

    def test_planning_has_memory_tool(self):
        """Verify planning agent includes memory tool."""
        from agents.tools_pkg import includes_memory_tool
        assert includes_memory_tool("planning") is True

    def test_planning_has_allowed_edit_patterns(self):
        """Verify planning agent has restricted edit patterns."""
        from agents.tools_pkg import get_allowed_edit_patterns
        patterns = get_allowed_edit_patterns("planning")

        assert "spec.md" in patterns
        assert "implementation_plan.json" in patterns
        assert "memories/**" in patterns

    def test_coder_can_run_bash(self):
        """Verify coder agent CAN run bash (contrast with planning)."""
        from agents.tools_pkg import can_run_bash
        # Default should be True for existing agents
        assert can_run_bash("coder") is True

    def test_coder_has_unrestricted_edit_patterns(self):
        """Verify coder agent has unrestricted edit patterns."""
        from agents.tools_pkg import get_allowed_edit_patterns
        patterns = get_allowed_edit_patterns("coder")

        # Coder should have **/* (or no restriction)
        assert "**/*" in patterns or patterns == ["**/*"]


class TestUserMessageControlCommands:
    """Tests for Phase 5: User message control commands."""

    def test_is_stop_command(self):
        """Verify stop commands are detected correctly."""
        from agents.user_message_queue import is_stop_command
        assert is_stop_command("stop") is True
        assert is_stop_command("STOP") is True
        assert is_stop_command("halt") is True
        assert is_stop_command("cancel") is True
        assert is_stop_command("abort") is True
        assert is_stop_command("continue") is False
        assert is_stop_command("hello") is False

    def test_is_pause_command(self):
        """Verify pause commands are detected correctly."""
        from agents.user_message_queue import is_pause_command
        assert is_pause_command("pause") is True
        assert is_pause_command("PAUSE") is True
        assert is_pause_command("wait") is True
        assert is_pause_command("hold") is True
        assert is_pause_command("continue") is False
        assert is_pause_command("stop") is False

    def test_is_resume_command(self):
        """Verify resume commands are detected correctly."""
        from agents.user_message_queue import is_resume_command
        assert is_resume_command("continue") is True
        assert is_resume_command("CONTINUE") is True
        assert is_resume_command("resume") is True
        assert is_resume_command("go") is True
        assert is_resume_command("proceed") is True
        assert is_resume_command("stop") is False
        assert is_resume_command("pause") is False

    def test_is_control_command(self):
        """Verify is_control_command detects all control commands."""
        from agents.user_message_queue import is_control_command
        # Stop commands
        assert is_control_command("stop") is True
        assert is_control_command("halt") is True
        # Pause commands
        assert is_control_command("pause") is True
        assert is_control_command("wait") is True
        # Resume commands
        assert is_control_command("continue") is True
        assert is_control_command("resume") is True
        # Not control commands
        assert is_control_command("hello") is False
        assert is_control_command("fix the bug") is False

    def test_control_commands_with_whitespace(self):
        """Verify control commands work with leading/trailing whitespace."""
        from agents.user_message_queue import is_stop_command, is_pause_command
        assert is_stop_command("  stop  ") is True
        assert is_pause_command("  pause  ") is True


class TestMemoryHandlersInterruptState:
    """Tests for save_interrupt_state functionality."""

    @pytest.fixture
    def temp_spec_dir(self):
        """Create a temporary spec directory."""
        temp_dir = tempfile.mkdtemp()
        yield Path(temp_dir)
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.fixture
    def handlers(self, temp_spec_dir):
        """Create MemoryHandlers instance."""
        from agents.memory_handlers import MemoryHandlers
        return MemoryHandlers(temp_spec_dir)

    def test_save_interrupt_state_creates_file(self, handlers, temp_spec_dir):
        """Verify save_interrupt_state creates coding_progress.md."""
        result = handlers.save_interrupt_state(
            status="PAUSED",
            current_subtask="1.1",
            user_message="wait a moment"
        )
        assert "success" in result.lower() or "created" in result.lower()

        progress_file = temp_spec_dir / "memories" / "coding_progress.md"
        assert progress_file.exists()

        content = progress_file.read_text()
        assert "PAUSED" in content
        assert "wait a moment" in content

    def test_save_interrupt_state_stopped(self, handlers, temp_spec_dir):
        """Verify save_interrupt_state works with STOPPED status."""
        result = handlers.save_interrupt_state(
            status="STOPPED",
            user_message="stop the build"
        )

        progress_file = temp_spec_dir / "memories" / "coding_progress.md"
        content = progress_file.read_text()
        assert "STOPPED" in content
        assert "stop the build" in content

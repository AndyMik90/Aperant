"""
Tests for Agent Session Management
==================================

Tests for agents/session.py which handles running agent sessions
and post-session processing including memory updates, recovery tracking,
and Linear integration.
"""

import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


class TestPostSessionProcessing:
    """Tests for post_session_processing function."""

    @pytest.fixture
    def mock_recovery_manager(self):
        """Create a mock recovery manager."""
        manager = MagicMock()
        manager.get_attempt_count.return_value = 0
        manager.record_attempt = MagicMock()
        manager.record_good_commit = MagicMock()
        return manager

    @pytest.fixture
    def mock_status_manager(self):
        """Create a mock status manager."""
        manager = MagicMock()
        manager.update_subtasks = MagicMock()
        return manager

    @pytest.fixture
    def spec_with_completed_subtask(self, temp_dir: Path) -> Path:
        """Create a spec directory with an implementation plan containing a completed subtask."""
        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        plan = {
            "spec_name": "test-spec",
            "status": "in_progress",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {
                            "id": "subtask-1",
                            "description": "Test subtask",
                            "status": "completed",
                        }
                    ],
                }
            ],
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))
        return spec_dir

    @pytest.fixture
    def spec_with_in_progress_subtask(self, temp_dir: Path) -> Path:
        """Create a spec directory with an in-progress subtask."""
        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        plan = {
            "spec_name": "test-spec",
            "status": "in_progress",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "subtasks": [
                        {
                            "id": "subtask-1",
                            "description": "Test subtask",
                            "status": "in_progress",
                        }
                    ],
                }
            ],
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))
        return spec_dir

    @pytest.mark.asyncio
    async def test_successful_subtask_completion(
        self,
        spec_with_completed_subtask,
        temp_dir,
        mock_recovery_manager,
        mock_status_manager,
    ):
        """Test post-session processing for a successfully completed subtask."""
        from agents.session import post_session_processing

        project_dir = temp_dir / "project"
        project_dir.mkdir(exist_ok=True)

        with patch("agents.session.get_latest_commit", return_value="abc123"):
            with patch("agents.session.get_commit_count", return_value=5):
                with patch("agents.session.count_subtasks_detailed", return_value={"completed": 1, "total": 2, "in_progress": 0}):
                    with patch("agents.session.extract_session_insights", new_callable=AsyncMock, return_value={}):
                        with patch("agents.session.save_session_memory", new_callable=AsyncMock, return_value=(True, "file")):
                            result = await post_session_processing(
                                spec_dir=spec_with_completed_subtask,
                                project_dir=project_dir,
                                subtask_id="subtask-1",
                                session_num=1,
                                commit_before="def456",
                                commit_count_before=4,
                                recovery_manager=mock_recovery_manager,
                                linear_enabled=False,
                                status_manager=mock_status_manager,
                            )

        assert result is True
        mock_recovery_manager.record_attempt.assert_called_once()
        mock_recovery_manager.record_good_commit.assert_called_once_with("abc123", "subtask-1")

    @pytest.mark.asyncio
    async def test_in_progress_subtask_returns_false(
        self,
        spec_with_in_progress_subtask,
        temp_dir,
        mock_recovery_manager,
        mock_status_manager,
    ):
        """Test post-session processing when subtask is still in progress."""
        from agents.session import post_session_processing

        project_dir = temp_dir / "project"
        project_dir.mkdir(exist_ok=True)

        with patch("agents.session.get_latest_commit", return_value="abc123"):
            with patch("agents.session.get_commit_count", return_value=5):
                with patch("agents.session.extract_session_insights", new_callable=AsyncMock, return_value={}):
                    with patch("agents.session.save_session_memory", new_callable=AsyncMock, return_value=(True, "file")):
                        result = await post_session_processing(
                            spec_dir=spec_with_in_progress_subtask,
                            project_dir=project_dir,
                            subtask_id="subtask-1",
                            session_num=1,
                            commit_before="def456",
                            commit_count_before=4,
                            recovery_manager=mock_recovery_manager,
                            linear_enabled=False,
                            status_manager=mock_status_manager,
                        )

        assert result is False
        # Should still record the attempt as failed
        mock_recovery_manager.record_attempt.assert_called_once()

    @pytest.mark.asyncio
    async def test_missing_implementation_plan_returns_false(
        self,
        temp_dir,
        mock_recovery_manager,
    ):
        """Test post-session processing when implementation plan is missing."""
        from agents.session import post_session_processing

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)
        project_dir = temp_dir / "project"
        project_dir.mkdir(exist_ok=True)

        result = await post_session_processing(
            spec_dir=spec_dir,
            project_dir=project_dir,
            subtask_id="subtask-1",
            session_num=1,
            commit_before="def456",
            commit_count_before=4,
            recovery_manager=mock_recovery_manager,
            linear_enabled=False,
        )

        assert result is False

    @pytest.mark.asyncio
    async def test_subtask_not_found_returns_false(
        self,
        spec_with_completed_subtask,
        temp_dir,
        mock_recovery_manager,
    ):
        """Test post-session processing when subtask ID is not found in plan."""
        from agents.session import post_session_processing

        project_dir = temp_dir / "project"
        project_dir.mkdir(exist_ok=True)

        result = await post_session_processing(
            spec_dir=spec_with_completed_subtask,
            project_dir=project_dir,
            subtask_id="nonexistent-subtask",
            session_num=1,
            commit_before="def456",
            commit_count_before=4,
            recovery_manager=mock_recovery_manager,
            linear_enabled=False,
        )

        assert result is False


class TestRunAgentSession:
    """Tests for run_agent_session function."""

    @pytest.fixture
    def mock_sdk_client(self):
        """Create a mock Claude SDK client."""
        client = AsyncMock()
        client.query = AsyncMock()
        return client

    @pytest.mark.asyncio
    async def test_session_returns_complete_when_build_complete(
        self,
        temp_dir,
        mock_sdk_client,
    ):
        """Test that session returns 'complete' when all subtasks are done."""
        from agents.session import run_agent_session
        from task_logger import LogPhase

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        # Mock the response stream
        mock_msg = MagicMock()
        mock_msg.__class__.__name__ = "AssistantMessage"
        mock_block = MagicMock()
        mock_block.__class__.__name__ = "TextBlock"
        mock_block.text = "Task completed"
        mock_msg.content = [mock_block]

        async def mock_receive():
            yield mock_msg

        mock_sdk_client.receive_response = mock_receive

        with patch("agents.session.is_build_complete", return_value=True):
            with patch("agents.session.get_task_logger", return_value=None):
                status, response = await run_agent_session(
                    mock_sdk_client,
                    "Complete this task",
                    spec_dir,
                    verbose=False,
                    phase=LogPhase.CODING,
                )

        assert status == "complete"
        assert "Task completed" in response

    @pytest.mark.asyncio
    async def test_session_returns_continue_when_not_complete(
        self,
        temp_dir,
        mock_sdk_client,
    ):
        """Test that session returns 'continue' when more work remains."""
        from agents.session import run_agent_session
        from task_logger import LogPhase

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        mock_msg = MagicMock()
        mock_msg.__class__.__name__ = "AssistantMessage"
        mock_block = MagicMock()
        mock_block.__class__.__name__ = "TextBlock"
        mock_block.text = "Working on subtask"
        mock_msg.content = [mock_block]

        async def mock_receive():
            yield mock_msg

        mock_sdk_client.receive_response = mock_receive

        with patch("agents.session.is_build_complete", return_value=False):
            with patch("agents.session.get_task_logger", return_value=None):
                status, response = await run_agent_session(
                    mock_sdk_client,
                    "Work on subtask",
                    spec_dir,
                    verbose=False,
                    phase=LogPhase.CODING,
                )

        assert status == "continue"

    @pytest.mark.asyncio
    async def test_session_returns_error_on_exception(
        self,
        temp_dir,
        mock_sdk_client,
    ):
        """Test that session returns 'error' when an exception occurs."""
        from agents.session import run_agent_session
        from task_logger import LogPhase

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        mock_sdk_client.query.side_effect = Exception("API error")

        with patch("agents.session.get_task_logger", return_value=None):
            status, response = await run_agent_session(
                mock_sdk_client,
                "Do something",
                spec_dir,
                verbose=False,
                phase=LogPhase.CODING,
            )

        assert status == "error"
        assert "API error" in response

    @pytest.mark.asyncio
    async def test_tool_use_logging(
        self,
        temp_dir,
        mock_sdk_client,
    ):
        """Test that tool use is properly logged during session."""
        from agents.session import run_agent_session
        from task_logger import LogPhase

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        # Create mock messages with tool use
        mock_assistant_msg = MagicMock()
        mock_assistant_msg.__class__.__name__ = "AssistantMessage"

        mock_tool_block = MagicMock()
        mock_tool_block.__class__.__name__ = "ToolUseBlock"
        mock_tool_block.name = "Read"
        mock_tool_block.input = {"file_path": "/test/file.py"}

        mock_text_block = MagicMock()
        mock_text_block.__class__.__name__ = "TextBlock"
        mock_text_block.text = "Reading file..."

        mock_assistant_msg.content = [mock_tool_block, mock_text_block]

        # Mock tool result
        mock_user_msg = MagicMock()
        mock_user_msg.__class__.__name__ = "UserMessage"
        mock_result_block = MagicMock()
        mock_result_block.__class__.__name__ = "ToolResultBlock"
        mock_result_block.content = "file contents..."
        mock_result_block.is_error = False
        mock_user_msg.content = [mock_result_block]

        async def mock_receive():
            yield mock_assistant_msg
            yield mock_user_msg

        mock_sdk_client.receive_response = mock_receive

        mock_logger = MagicMock()

        with patch("agents.session.is_build_complete", return_value=False):
            with patch("agents.session.get_task_logger", return_value=mock_logger):
                status, response = await run_agent_session(
                    mock_sdk_client,
                    "Read a file",
                    spec_dir,
                    verbose=False,
                    phase=LogPhase.CODING,
                )

        assert status == "continue"
        # Verify tool logging was called
        mock_logger.tool_start.assert_called()
        mock_logger.tool_end.assert_called()

#!/usr/bin/env python3
"""
Tests for QA Reviewer Agent Session
===================================

Tests the qa/reviewer.py module functionality including:
- run_qa_agent_session function
- QA session execution flow
- Error handling and edge cases
- Memory integration hooks
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# =============================================================================
# MOCK SETUP - Must happen before ANY imports from auto-claude
# =============================================================================

class _AsyncIteratorMock:
    """Async iterator mock that yields stored messages and acts as async context manager."""

    def __init__(self):
        self._messages = []
        self._index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._messages):
            raise StopAsyncIteration
        msg = self._messages[self._index]
        self._index += 1
        return msg

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False

    def set_messages(self, messages):
        self._messages = messages
        self._index = 0


class _ReceiveResponseMock:
    """Mock for receive_response that supports both .set_messages() and .return_value assignment."""

    def __init__(self):
        self._iterator = _AsyncIteratorMock()
        self.called = False  # MagicMock compatibility

    def __call__(self, *args, **kwargs):
        self.called = True
        return self._iterator

    @property
    def return_value(self):
        return self._iterator

    @return_value.setter
    def return_value(self, value):
        # When tests do mock_client.receive_response.return_value = list,
        # we set the messages on the iterator
        self._iterator.set_messages(value)


# Store original modules for cleanup
_original_modules = {}
_mocked_module_names = [
    'claude_agent_sdk',
    'ui',
    'progress',
    'task_logger',
    'linear_updater',
    'client',
    'prompts_pkg',
    'agents.memory_manager',
    'agents.base',
    'core.error_utils',
    'security.tool_input_validator',
    'debug',
]

for name in _mocked_module_names:
    if name in sys.modules:
        _original_modules[name] = sys.modules[name]

# Mock claude_agent_sdk FIRST
mock_sdk = MagicMock()
mock_sdk.ClaudeSDKClient = MagicMock()
mock_sdk.ClaudeAgentOptions = MagicMock()
mock_sdk.ClaudeCodeOptions = MagicMock()
sys.modules['claude_agent_sdk'] = mock_sdk

# Mock prompts_pkg - need to set up as a package module
mock_prompts_pkg = MagicMock()
mock_prompts_pkg.get_qa_reviewer_prompt = MagicMock(return_value="Test QA prompt")
sys.modules['prompts_pkg'] = mock_prompts_pkg
# Also mock prompts_pkg.project_context for imports in core/client.py
mock_project_context = MagicMock()
mock_prompts_pkg.project_context = mock_project_context
sys.modules['prompts_pkg.project_context'] = mock_project_context

# Mock agents.memory_manager
mock_memory_manager = MagicMock()
mock_memory_manager.get_graphiti_context = AsyncMock(return_value=None)
mock_memory_manager.save_session_memory = AsyncMock(return_value=None)
sys.modules['agents.memory_manager'] = mock_memory_manager

# Mock agents.base
mock_agents_base = MagicMock()
mock_agents_base.sanitize_error_message = lambda x: x
sys.modules['agents.base'] = mock_agents_base

# Mock core.error_utils
mock_error_utils = MagicMock()
mock_error_utils.is_rate_limit_error = MagicMock(return_value=False)
mock_error_utils.is_tool_concurrency_error = MagicMock(return_value=False)
sys.modules['core.error_utils'] = mock_error_utils

# Mock security.tool_input_validator
mock_validator = MagicMock()
mock_validator.get_safe_tool_input = lambda block: getattr(block, 'input', {})
sys.modules['security.tool_input_validator'] = mock_validator

# Mock debug
mock_debug = MagicMock()
sys.modules['debug'] = mock_debug

# Mock UI module
mock_ui = MagicMock()
sys.modules['ui'] = mock_ui

# Mock progress module
mock_progress = MagicMock()
sys.modules['progress'] = mock_progress

# Mock task_logger
mock_task_logger = MagicMock()
mock_task_logger.LogPhase = MagicMock()
mock_task_logger.LogEntryType = MagicMock()
mock_task_logger.get_task_logger = MagicMock(return_value=None)
sys.modules['task_logger'] = mock_task_logger

# Mock linear_updater
mock_linear = MagicMock()
sys.modules['linear_updater'] = mock_linear

# Mock client - create a factory that returns properly configured clients
def _create_mock_client():
    """Factory function that creates a properly configured mock client."""
    client = MagicMock()
    client.query = AsyncMock()
    client.receive_response = _ReceiveResponseMock()
    return client

mock_client_module = MagicMock()
mock_client_module.create_client = _create_mock_client
sys.modules['client'] = mock_client_module

# Now add auto-claude to path and import
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from qa.reviewer import run_qa_agent_session
from qa.criteria import save_implementation_plan


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield  # Run all tests first
    for name in _mocked_module_names:
        if name in _original_modules:
            sys.modules[name] = _original_modules[name]
        elif name in sys.modules:
            del sys.modules[name]


@pytest.fixture
def spec_dir(temp_dir):
    """Create a spec directory with basic structure."""
    spec = temp_dir / "spec"
    spec.mkdir()
    return spec


@pytest.fixture
def project_dir(temp_dir):
    """Create a project directory."""
    project = temp_dir / "project"
    project.mkdir()
    return project


@pytest.fixture
def mock_client():
    """Create a mock Claude SDK client."""
    client = MagicMock()
    client.query = AsyncMock()

    # Use the smart wrapper that supports both .set_messages() and .return_value assignment
    client.receive_response = _ReceiveResponseMock()

    return client


@pytest.fixture(autouse=True, scope='function')
def reset_shared_mocks_before_test():
    """Reset shared module-level mocks before each test.

    This ensures tests don't interfere with each other when run together
    with tests from other modules that share the same mocks.
    """
    # Reset BEFORE the test runs (this runs after conftest's pytest_runtest_call)
    mock_error_utils.is_rate_limit_error.return_value = False
    mock_error_utils.is_tool_concurrency_error.return_value = False
    mock_memory_manager.get_graphiti_context.reset_mock()
    mock_memory_manager.save_session_memory.reset_mock()

    yield

    # Reset AFTER the test runs for cleanup
    mock_error_utils.is_rate_limit_error.return_value = False
    mock_error_utils.is_tool_concurrency_error.return_value = False
    mock_memory_manager.get_graphiti_context.reset_mock()
    mock_memory_manager.save_session_memory.reset_mock()


# =============================================================================
# TEST CLASSES
# =============================================================================


class TestRunQAAgentSessionApproved:
    """Tests for run_qa_agent_session returning approved status."""

    @pytest.mark.asyncio
    async def test_approved_status(self, mock_client, spec_dir, project_dir):
        """Test that approved status is returned correctly."""
        # Setup implementation plan with approved status
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_approved_response()

        result = await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        assert result[0] == "approved"
        assert len(result[1]) > 0  # Response text
        assert result[2] == {}  # No error info

    def _create_approved_response(self):
        """Create mock response for approved QA."""
        from unittest.mock import MagicMock

        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "QA approved - all criteria met."
        msg1.content = [text_block]

        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        msg2.content = []

        return [msg1, msg2]


class TestRunQAAgentSessionRejected:
    """Tests for run_qa_agent_session returning rejected status."""

    @pytest.mark.asyncio
    async def test_rejected_status(self, mock_client, spec_dir, project_dir):
        """Test that rejected status is returned correctly."""
        # Setup implementation plan with rejected status
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "issues_found": [
                    {"title": "Test failure", "type": "unit_test"},
                ]
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_rejected_response()

        result = await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        assert result[0] == "rejected"
        assert len(result[1]) > 0  # Response text
        assert result[2] == {}  # No error info

    def _create_rejected_response(self):
        """Create mock response for rejected QA."""
        from unittest.mock import MagicMock

        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "QA rejected - found issues."
        msg1.content = [text_block]

        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        msg2.content = []

        return [msg1, msg2]


class TestRunQAAgentSessionError:
    """Tests for run_qa_agent_session error handling."""

    @pytest.mark.asyncio
    async def test_error_status_no_signoff(self, mock_client, spec_dir, project_dir):
        """Test error status when agent doesn't update signoff."""
        # Setup implementation plan without qa_signoff
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses - agent doesn't update signoff
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_no_signoff_response()

        result = await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        assert result[0] == "error"
        assert "did not update" in result[1].lower()
        assert result[2]["type"] == "other"

    def _create_no_signoff_response(self):
        """Create mock response where agent doesn't update signoff."""
        from unittest.mock import MagicMock

        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "QA review complete."
        msg1.content = [text_block]

        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        msg2.content = []

        return [msg1, msg2]

    @pytest.mark.asyncio
    async def test_exception_handling(self, mock_client, spec_dir, project_dir):
        """Test exception handling during QA session."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Test exception")

        result = await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        assert result[0] == "error"
        assert "Test exception" in result[1] or "test exception" in result[1].lower()
        assert result[2]["type"] == "other"
        assert result[2]["exception_type"] == "Exception"


class TestRunQAAgentSessionParameters:
    """Tests for run_qa_agent_session parameter handling."""

    @pytest.mark.asyncio
    async def test_with_previous_error(self, mock_client, spec_dir, project_dir):
        """Test session with previous error context."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        previous_error = {
            "error_type": "missing_implementation_plan_update",
            "error_message": "Test error",
            "consecutive_errors": 2,
        }

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_no_signoff_response()

        await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False,
            previous_error=previous_error
        )

        # Verify query was called (it should include error context)
        assert mock_client.query.called

    @pytest.mark.asyncio
    async def test_verbose_mode(self, mock_client, spec_dir, project_dir):
        """Test session with verbose mode enabled."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_no_signoff_response()

        await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            verbose=True
        )

        # Verify query was called
        assert mock_client.query.called

    def _create_no_signoff_response(self):
        """Create mock response where agent doesn't update signoff."""
        from unittest.mock import MagicMock

        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "QA review complete."
        msg1.content = [text_block]

        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        msg2.content = []

        return [msg1, msg2]


class TestRunQAAgentSessionIntegration:
    """Integration tests for QA reviewer session."""

    @pytest.mark.asyncio
    async def test_full_session_flow(self, mock_client, spec_dir, project_dir):
        """Test complete session flow from start to finish."""
        # Setup implementation plan
        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "tests_passed": {"unit": True, "integration": True},
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_full_session_response()

        result = await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            qa_session=1,
            max_iterations=50,
            verbose=False
        )

        assert result[0] == "approved"
        assert mock_client.query.called
        assert mock_client.receive_response.called

    def _create_full_session_response(self):
        """Create mock response for full session."""
        from unittest.mock import MagicMock

        # Assistant message with text
        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "QA review starting..."
        msg1.content = [text_block]

        # User message with tool results
        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        msg2.content = []

        return [msg1, msg2]


class TestMemoryIntegration:
    """Tests for memory integration in QA reviewer."""

    @pytest.mark.asyncio
    async def test_memory_context_retrieval(self, mock_client, spec_dir, project_dir):
        """Test that memory context is retrieved during session."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock memory context
        mock_memory_manager.get_graphiti_context.return_value = "Past QA insights: check for edge cases"

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_no_signoff_response()

        await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        # Verify memory context was retrieved
        assert mock_memory_manager.get_graphiti_context.called

    def _create_no_signoff_response(self):
        """Create mock response where agent doesn't update signoff."""
        from unittest.mock import MagicMock

        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "QA review complete."
        msg1.content = [text_block]

        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        msg2.content = []

        return [msg1, msg2]

    @pytest.mark.asyncio
    async def test_memory_save_on_approved(self, mock_client, spec_dir, project_dir):
        """Test that session memory is saved on approval."""
        # Setup implementation plan with approved status
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_approved_response()

        await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        # Verify memory was saved
        assert mock_memory_manager.save_session_memory.called

    def _create_approved_response(self):
        """Create mock response for approved QA."""
        from unittest.mock import MagicMock

        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "QA approved - all criteria met."
        msg1.content = [text_block]

        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        msg2.content = []

        return [msg1, msg2]

    @pytest.mark.asyncio
    async def test_memory_save_on_rejected(self, mock_client, spec_dir, project_dir):
        """Test that session memory is saved on rejection with issues."""
        # Setup implementation plan with rejected status
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "issues_found": [
                    {"title": "Test failure", "type": "unit_test"},
                ]
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_rejected_response()

        await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        # Verify memory was saved with issues
        assert mock_memory_manager.save_session_memory.called
        call_args = mock_memory_manager.save_session_memory.call_args
        assert 'discoveries' in call_args[1]

    def _create_rejected_response(self):
        """Create mock response for rejected QA."""
        from unittest.mock import MagicMock

        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "QA rejected - found issues."
        msg1.content = [text_block]

        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        msg2.content = []

        return [msg1, msg2]


class TestErrorDetection:
    """Tests for error type detection in QA reviewer."""

    @pytest.mark.asyncio
    async def test_rate_limit_error_detection(self, mock_client, spec_dir, project_dir):
        """Test that rate limit errors are properly detected."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock error detection to return rate limit
        mock_error_utils.is_rate_limit_error.return_value = True

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Rate limit exceeded")

        result = await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        assert result[0] == "error"
        assert result[2]["type"] == "rate_limit"

    @pytest.mark.asyncio
    async def test_tool_concurrency_error_detection(self, mock_client, spec_dir, project_dir):
        """Test that tool concurrency errors are properly detected."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock error detection to return concurrency error
        mock_error_utils.is_tool_concurrency_error.return_value = True

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Tool concurrency limit")

        result = await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        assert result[0] == "error"
        assert result[2]["type"] == "tool_concurrency"


class TestToolUseHandling:
    """Tests for tool use handling in QA reviewer."""

    @pytest.mark.asyncio
    async def test_tool_use_blocks(self, mock_client, spec_dir, project_dir):
        """Test that tool use blocks are handled correctly."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses with tool use
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = self._create_tool_use_response()

        await run_qa_agent_session(
            mock_client,
            project_dir,
            spec_dir,
            1,
            50,
            False
        )

        # Verify query was called
        assert mock_client.query.called

    def _create_tool_use_response(self):
        """Create mock response with tool use blocks."""
        from unittest.mock import MagicMock

        msg1 = MagicMock()
        msg1.__class__.__name__ = "AssistantMessage"
        text_block = MagicMock()
        text_block.__class__.__name__ = "TextBlock"
        text_block.text = "Checking files..."

        tool_block = MagicMock()
        tool_block.__class__.__name__ = "ToolUseBlock"
        tool_block.name = "Read"
        tool_block.input = {"file_path": "/test/file.py"}

        msg1.content = [text_block, tool_block]

        msg2 = MagicMock()
        msg2.__class__.__name__ = "UserMessage"
        result_block = MagicMock()
        result_block.__class__.__name__ = "ToolResultBlock"
        result_block.is_error = False
        result_block.content = "File content"
        msg2.content = [result_block]

        msg3 = MagicMock()
        msg3.__class__.__name__ = "AssistantMessage"
        text_block2 = MagicMock()
        text_block2.__class__.__name__ = "TextBlock"
        text_block2.text = "QA review complete."
        msg3.content = [text_block2]

        msg4 = MagicMock()
        msg4.__class__.__name__ = "UserMessage"
        msg4.content = []

        return [msg1, msg2, msg3, msg4]

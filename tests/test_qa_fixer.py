#!/usr/bin/env python3
"""
Tests for QA Fixer Agent Session
================================

Tests the qa/fixer.py module functionality including:
- load_qa_fixer_prompt function
- run_qa_fixer_session function
- QA fixer session execution flow
- Error handling and edge cases
- Memory integration hooks
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

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


# Store original modules for cleanup
_original_modules = {}
_mocked_module_names = [
    'claude_agent_sdk',
    'ui',
    'progress',
    'task_logger',
    'linear_updater',
    'client',
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
    response_iter = _AsyncIteratorMock()
    client.receive_response = MagicMock(return_value=response_iter)
    return client

mock_client_module = MagicMock()
mock_client_module.create_client = _create_mock_client
sys.modules['client'] = mock_client_module

# Now add auto-claude to path and import
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from qa.fixer import load_qa_fixer_prompt, run_qa_fixer_session
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

    # Create an async iterator for receive_response
    response_iter = _AsyncIteratorMock()

    # Make receive_response return the async iterator when called
    client.receive_response = MagicMock(return_value=response_iter)

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
# MOCK RESPONSE HELPERS
# =============================================================================

def _create_mock_response(text: str = "Fixer session complete."):
    """Create a standard mock assistant+user message pair.

    Args:
        text: Text content for the AssistantMessage's TextBlock

    Returns:
        List of mock messages [AssistantMessage, UserMessage]
    """
    from unittest.mock import MagicMock

    msg1 = MagicMock()
    msg1.__class__.__name__ = "AssistantMessage"
    text_block = MagicMock()
    text_block.__class__.__name__ = "TextBlock"
    text_block.text = text
    msg1.content = [text_block]

    msg2 = MagicMock()
    msg2.__class__.__name__ = "UserMessage"
    msg2.content = []

    return [msg1, msg2]


def _create_mock_fixed_response():
    """Create mock response for fixed QA.

    Returns:
        List of mock messages [AssistantMessage with 'Fixes applied successfully.', UserMessage]
    """
    return _create_mock_response("Fixes applied successfully.")


def _create_mock_no_signoff_response():
    """Create mock response where agent doesn't update signoff.

    Returns:
        List of mock messages [AssistantMessage with 'QA review complete.', UserMessage]
    """
    return _create_mock_response("QA review complete.")


def _create_mock_tool_use_response():
    """Create mock response with tool use blocks.

    Returns:
        List of mock messages including ToolUseBlock and ToolResultBlock
    """
    from unittest.mock import MagicMock

    msg1 = MagicMock()
    msg1.__class__.__name__ = "AssistantMessage"
    text_block = MagicMock()
    text_block.__class__.__name__ = "TextBlock"
    text_block.text = "Applying fixes..."

    tool_block = MagicMock()
    tool_block.__class__.__name__ = "ToolUseBlock"
    tool_block.name = "Edit"
    tool_block.input = {"file_path": "/test/file.py"}

    msg1.content = [text_block, tool_block]

    msg2 = MagicMock()
    msg2.__class__.__name__ = "UserMessage"
    result_block = MagicMock()
    result_block.__class__.__name__ = "ToolResultBlock"
    result_block.is_error = False
    result_block.content = "Edit successful"
    msg2.content = [result_block]

    msg3 = MagicMock()
    msg3.__class__.__name__ = "AssistantMessage"
    text_block2 = MagicMock()
    text_block2.__class__.__name__ = "TextBlock"
    text_block2.text = "Fixes complete."
    msg3.content = [text_block2]

    msg4 = MagicMock()
    msg4.__class__.__name__ = "UserMessage"
    msg4.content = []

    return [msg1, msg2, msg3, msg4]


@pytest.fixture
def fix_request_file(spec_dir):
    """Create a QA_FIX_REQUEST.md file."""
    fix_request = spec_dir / "QA_FIX_REQUEST.md"
    fix_request.write_text("# Fix Request\n\nFix the following issues:\n- Issue 1\n- Issue 2")
    return fix_request


# =============================================================================
# TEST CLASSES
# =============================================================================


class TestLoadQAFixerPrompt:
    """Tests for load_qa_fixer_prompt function."""

    def test_load_prompt_success(self, spec_dir, monkeypatch):
        """Test successful prompt loading."""
        # Create prompts directory in temp location
        prompts_dir = spec_dir / "prompts"
        prompts_dir.mkdir(parents=True, exist_ok=True)

        prompt_file = prompts_dir / "qa_fixer.md"
        prompt_content = "# QA Fixer Prompt\n\nFix the issues..."
        prompt_file.write_text(prompt_content)

        # Patch QA_PROMPTS_DIR to point to temp directory
        import qa.fixer as qa_fixer_module
        monkeypatch.setattr(qa_fixer_module, "QA_PROMPTS_DIR", prompts_dir)

        result = load_qa_fixer_prompt()

        assert result == prompt_content

    def test_load_prompt_file_not_found(self, monkeypatch):
        """Test FileNotFoundError when prompt file doesn't exist."""
        # Create an empty temp directory with no qa_fixer.md
        import tempfile
        empty_dir = Path(tempfile.mkdtemp())

        # Patch QA_PROMPTS_DIR to point to empty directory
        import qa.fixer as qa_fixer_module
        monkeypatch.setattr(qa_fixer_module, "QA_PROMPTS_DIR", empty_dir)

        with pytest.raises(FileNotFoundError):
            load_qa_fixer_prompt()

        # Clean up temp directory
        import shutil
        shutil.rmtree(empty_dir)


class TestRunQAFixerSessionFixed:
    """Tests for run_qa_fixer_session returning fixed status."""

    @pytest.mark.asyncio
    async def test_fixed_status(self, mock_client, spec_dir, fix_request_file):
        """Test that fixed status is returned when ready_for_qa_revalidation is True."""
        # Setup implementation plan with ready_for_qa_revalidation
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": True,
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_fixed_response())

        result = await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        assert result[0] == "fixed"
        assert len(result[1]) > 0  # Response text
        assert result[2] == {}  # No error info

    @pytest.mark.asyncio
    async def test_fixed_status_with_project_dir(self, mock_client, spec_dir, project_dir):
        """Test session with explicit project_dir parameter."""
        # Create fix request file
        fix_request = spec_dir / "QA_FIX_REQUEST.md"
        fix_request.write_text("# Fix Request\n\nFix issues")

        # Setup implementation plan
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": True,
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_fixed_response())

        result = await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False,
            project_dir=project_dir
        )

        assert result[0] == "fixed"


class TestRunQAFixerSessionError:
    """Tests for run_qa_fixer_session error handling."""

    @pytest.mark.asyncio
    async def test_error_missing_fix_request(self, mock_client, spec_dir):
        """Test error when QA_FIX_REQUEST.md is missing."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Don't create QA_FIX_REQUEST.md

        result = await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        assert result[0] == "error"
        assert "not found" in result[1].lower()
        assert result[2]["type"] == "other"
        assert result[2]["exception_type"] == "FileNotFoundError"

    @pytest.mark.asyncio
    async def test_exception_handling(self, mock_client, spec_dir, fix_request_file):
        """Test exception handling during fixer session."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Test exception")

        result = await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        assert result[0] == "error"
        assert "Test exception" in result[1] or "test exception" in result[1].lower()
        assert result[2]["type"] == "other"
        assert result[2]["exception_type"] == "Exception"


class TestRunQAFixerSessionParameters:
    """Tests for run_qa_fixer_session parameter handling."""

    @pytest.mark.asyncio
    async def test_verbose_mode(self, mock_client, spec_dir, fix_request_file):
        """Test session with verbose mode enabled."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_response())

        await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            verbose=True
        )

        # Verify query was called
        assert mock_client.query.called

    @pytest.mark.asyncio
    async def test_fix_session_number(self, mock_client, spec_dir, fix_request_file):
        """Test session with different fix_session numbers."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_response())

        await run_qa_fixer_session(
            mock_client,
            spec_dir,
            fix_session=3,
            verbose=False
        )

        # Verify query was called
        assert mock_client.query.called


class TestRunQAFixerSessionIntegration:
    """Integration tests for QA fixer session."""

    @pytest.mark.asyncio
    async def test_full_session_flow(self, mock_client, spec_dir, fix_request_file):
        """Test complete session flow from start to finish."""
        # Setup implementation plan
        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": True,
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_response("Applying fixes..."))

        result = await run_qa_fixer_session(
            mock_client,
            spec_dir,
            fix_session=1,
            verbose=False
        )

        assert result[0] == "fixed"
        assert mock_client.query.called
        assert mock_client.receive_response.called


class TestMemoryIntegration:
    """Tests for memory integration in QA fixer."""

    @pytest.mark.asyncio
    async def test_memory_context_retrieval(self, mock_client, spec_dir, fix_request_file):
        """Test that memory context is retrieved during session."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock memory context
        mock_memory_manager.get_graphiti_context.return_value = "Past fix patterns: check imports"

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_response())

        await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        # Verify memory context was retrieved
        assert mock_memory_manager.get_graphiti_context.called

    @pytest.mark.asyncio
    async def test_memory_save_on_fixed(self, mock_client, spec_dir, fix_request_file):
        """Test that session memory is saved when fixes are applied."""
        # Setup implementation plan
        plan = {
            "feature": "Test",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": True,
            }
        }
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_fixed_response())

        await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        # Verify memory was saved
        assert mock_memory_manager.save_session_memory.called


class TestErrorDetection:
    """Tests for error type detection in QA fixer."""

    @pytest.mark.asyncio
    async def test_rate_limit_error_detection(self, mock_client, spec_dir, fix_request_file):
        """Test that rate limit errors are properly detected."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock error detection to return rate limit
        mock_error_utils.is_rate_limit_error.return_value = True

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Rate limit exceeded")

        result = await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        assert result[0] == "error"
        assert result[2]["type"] == "rate_limit"

    @pytest.mark.asyncio
    async def test_tool_concurrency_error_detection(self, mock_client, spec_dir, fix_request_file):
        """Test that tool concurrency errors are properly detected."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock error detection to return concurrency error
        mock_error_utils.is_tool_concurrency_error.return_value = True

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Tool concurrency limit")

        result = await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        assert result[0] == "error"
        assert result[2]["type"] == "tool_concurrency"


class TestStatusNotUpdated:
    """Tests for when fixer doesn't update status."""

    @pytest.mark.asyncio
    async def test_fixed_assumed_when_status_not_updated(self, mock_client, spec_dir, fix_request_file):
        """Test that fixed is assumed even when status not updated."""
        # Setup implementation plan without ready_for_qa_revalidation
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_response())

        result = await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        # Should still return "fixed" even though status wasn't updated
        assert result[0] == "fixed"
        # Memory should still be saved
        assert mock_memory_manager.save_session_memory.called


class TestToolUseHandling:
    """Tests for tool use handling in QA fixer."""

    @pytest.mark.asyncio
    async def test_tool_use_blocks(self, mock_client, spec_dir, fix_request_file):
        """Test that tool use blocks are handled correctly."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses with tool use
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_tool_use_response())

        await run_qa_fixer_session(
            mock_client,
            spec_dir,
            1,
            False
        )

        # Verify query was called
        assert mock_client.query.called

#!/usr/bin/env python3
"""
Shared QA Test Helpers
======================

Consolidates duplicated mock setup and utilities for test_qa_fixer.py and test_qa_reviewer.py.

This module provides:
- AsyncIteratorMock: Async iterator mock for receive_response
- ReceiveResponseMock: Smart wrapper supporting both .set_messages() and .return_value
- setup_qa_mocks(): Module-level mock setup
- cleanup_qa_mocks(): Module-level cleanup
- reset_qa_mocks(): Reset shared mocks to default state
- get_mock_*(): Accessor functions for mock objects
- Mock response creation helpers
- Shared pytest fixtures
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

# Add apps/backend to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))


# =============================================================================
# ASYNC ITERATOR MOCKS
# =============================================================================

class AsyncIteratorMock:
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


class ReceiveResponseMock:
    """Mock for receive_response that supports both .set_messages() and .return_value assignment."""

    def __init__(self):
        self._iterator = AsyncIteratorMock()
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


# =============================================================================
# MODULE-LEVEL MOCKS
# =============================================================================

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
    'prompts_pkg.project_context',
    'agents.memory_manager',
    'agents.base',
    'core.error_utils',
    'security.tool_input_validator',
    'debug',
]

# Mock objects (initialized by setup_qa_mocks)
_mock_state = {
    'sdk': None,
    'prompts_pkg': None,
    'project_context': None,
    'memory_manager': None,
    'agents_base': None,
    'error_utils': None,
    'validator': None,
    'debug': None,
    'ui': None,
    'progress': None,
    'task_logger': None,
    'linear': None,
    'client_module': None,
    'setup_done': False,
    'include_prompts_pkg': False,  # Track what config was used
}


def get_mock_error_utils():
    """Get the mock_error_utils object after setup."""
    return _mock_state['error_utils']


def get_mock_memory_manager():
    """Get the mock_memory_manager object after setup."""
    return _mock_state['memory_manager']


def setup_qa_mocks(include_prompts_pkg: bool = False):
    """Set up module-level mocks for QA tests.

    Args:
        include_prompts_pkg: If True, mock prompts_pkg (needed for reviewer, not fixer)

    Call this at module level before importing from qa modules.
    """
    # Guard against redundant setup when called with same parameters
    # But allow prompts_pkg to be added if a later call needs it
    if _mock_state['setup_done']:
        # If prompts_pkg is already set up OR current call doesn't need it, skip
        if _mock_state['include_prompts_pkg'] or not include_prompts_pkg:
            return
        # Otherwise, we need to add prompts_pkg to existing setup
        # Fall through to only set up prompts_pkg below

    # If setup is done but we need to add prompts_pkg, only do that part
    if _mock_state['setup_done'] and include_prompts_pkg and not _mock_state['include_prompts_pkg']:
        # Save originals before mocking
        for name in ['prompts_pkg', 'prompts_pkg.project_context']:
            if name in sys.modules and name not in _original_modules:
                _original_modules[name] = sys.modules[name]

        # Only set up prompts_pkg
        mock_prompts_pkg = MagicMock()
        mock_prompts_pkg.get_qa_reviewer_prompt = MagicMock(return_value="Test QA prompt")
        sys.modules['prompts_pkg'] = mock_prompts_pkg
        _mock_state['prompts_pkg'] = mock_prompts_pkg
        mock_project_context = MagicMock()
        mock_prompts_pkg.project_context = mock_project_context
        sys.modules['prompts_pkg.project_context'] = mock_project_context
        _mock_state['project_context'] = mock_project_context
        _mock_state['include_prompts_pkg'] = True
        return

    # Save originals for each module individually before mocking
    # This handles multiple setup calls with different parameters
    for name in _mocked_module_names:
        if name in sys.modules and name not in _original_modules:
            _original_modules[name] = sys.modules[name]

    # Mock claude_agent_sdk FIRST
    mock_sdk = MagicMock()
    mock_sdk.ClaudeSDKClient = MagicMock()
    mock_sdk.ClaudeAgentOptions = MagicMock()
    mock_sdk.ClaudeCodeOptions = MagicMock()
    sys.modules['claude_agent_sdk'] = mock_sdk
    _mock_state['sdk'] = mock_sdk

    # Mock prompts_pkg if needed
    if include_prompts_pkg:
        mock_prompts_pkg = MagicMock()
        mock_prompts_pkg.get_qa_reviewer_prompt = MagicMock(return_value="Test QA prompt")
        sys.modules['prompts_pkg'] = mock_prompts_pkg
        _mock_state['prompts_pkg'] = mock_prompts_pkg
        # Also mock prompts_pkg.project_context for imports in core/client.py
        mock_project_context = MagicMock()
        mock_prompts_pkg.project_context = mock_project_context
        sys.modules['prompts_pkg.project_context'] = mock_project_context
        _mock_state['project_context'] = mock_project_context

    # Mock agents.memory_manager
    mock_memory_manager = MagicMock()
    mock_memory_manager.get_graphiti_context = AsyncMock(return_value=None)
    mock_memory_manager.save_session_memory = AsyncMock(return_value=None)
    sys.modules['agents.memory_manager'] = mock_memory_manager
    _mock_state['memory_manager'] = mock_memory_manager

    # Mock agents.base
    mock_agents_base = MagicMock()
    mock_agents_base.sanitize_error_message = lambda x: x
    sys.modules['agents.base'] = mock_agents_base
    _mock_state['agents_base'] = mock_agents_base

    # Mock core.error_utils
    mock_error_utils = MagicMock()
    mock_error_utils.is_rate_limit_error = MagicMock(return_value=False)
    mock_error_utils.is_tool_concurrency_error = MagicMock(return_value=False)
    sys.modules['core.error_utils'] = mock_error_utils
    _mock_state['error_utils'] = mock_error_utils

    # Mock security.tool_input_validator
    mock_validator = MagicMock()
    mock_validator.get_safe_tool_input = lambda block: getattr(block, 'input', {})
    sys.modules['security.tool_input_validator'] = mock_validator
    _mock_state['validator'] = mock_validator

    # Mock debug
    mock_debug = MagicMock()
    sys.modules['debug'] = mock_debug
    _mock_state['debug'] = mock_debug

    # Mock UI module
    mock_ui = MagicMock()
    sys.modules['ui'] = mock_ui
    _mock_state['ui'] = mock_ui

    # Mock progress module
    mock_progress = MagicMock()
    sys.modules['progress'] = mock_progress
    _mock_state['progress'] = mock_progress

    # Mock task_logger
    mock_task_logger = MagicMock()
    mock_task_logger.LogPhase = MagicMock()
    mock_task_logger.LogEntryType = MagicMock()
    mock_task_logger.get_task_logger = MagicMock(return_value=None)
    sys.modules['task_logger'] = mock_task_logger
    _mock_state['task_logger'] = mock_task_logger

    # Mock linear_updater
    mock_linear = MagicMock()
    sys.modules['linear_updater'] = mock_linear
    _mock_state['linear'] = mock_linear

    # Mock client - create a factory that returns properly configured clients
    def _create_mock_client():
        """Factory function that creates a properly configured mock client."""
        client = MagicMock()
        client.query = AsyncMock()
        client.receive_response = ReceiveResponseMock()
        return client

    mock_client_module = MagicMock()
    mock_client_module.create_client = _create_mock_client
    sys.modules['client'] = mock_client_module
    _mock_state['client_module'] = mock_client_module
    _mock_state['setup_done'] = True
    _mock_state['include_prompts_pkg'] = include_prompts_pkg


def cleanup_qa_mocks():
    """Restore original modules after tests complete.

    Call this in a module-scoped autouse fixture.
    """
    for name in _mocked_module_names:
        if name in _original_modules:
            sys.modules[name] = _original_modules[name]
        elif name in sys.modules:
            del sys.modules[name]
    _mock_state['setup_done'] = False
    _mock_state['include_prompts_pkg'] = False
    # Note: We do NOT clear _original_modules here because:
    # 1. Multiple test modules may call cleanup, and clearing would break subsequent cleanups
    # 2. The 'if name not in _original_modules' guard in setup_qa_mocks prevents stale state
    # 3. Originals are saved per-module, so different setups can coexist


def reset_qa_mocks():
    """Reset shared mocks to default state.

    Call this before and after each test to ensure isolation.
    """
    mock_error_utils = _mock_state.get('error_utils')
    mock_memory_manager = _mock_state.get('memory_manager')

    if mock_error_utils is not None:
        mock_error_utils.is_rate_limit_error.return_value = False
        mock_error_utils.is_tool_concurrency_error.return_value = False
    if mock_memory_manager is not None:
        mock_memory_manager.get_graphiti_context.reset_mock()
        mock_memory_manager.save_session_memory.reset_mock()


# =============================================================================
# MOCK RESPONSE HELPERS
# =============================================================================

def create_mock_response(text: str = "Session complete."):
    """Create a standard mock assistant+user message pair.

    Args:
        text: Text content for the AssistantMessage's TextBlock

    Returns:
        List of mock messages [AssistantMessage, UserMessage]
    """
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


def create_mock_fixed_response():
    """Create mock response for fixed QA.

    Returns:
        List of mock messages [AssistantMessage with 'Fixes applied successfully.', UserMessage]
    """
    return create_mock_response("Fixes applied successfully.")


def create_mock_tool_use_response(tool_name: str = "Bash", tool_input: dict = None):
    """Create mock response with tool use.

    Args:
        tool_name: Name of the tool being used
        tool_input: Input dict for the tool

    Returns:
        List of mock messages [AssistantMessage with ToolUseBlock, UserMessage]
    """
    if tool_input is None:
        tool_input = {"command": "echo test"}

    msg1 = MagicMock()
    msg1.__class__.__name__ = "AssistantMessage"
    tool_block = MagicMock()
    tool_block.__class__.__name__ = "ToolUseBlock"
    tool_block.name = tool_name
    tool_block.input = tool_input
    msg1.content = [tool_block]

    msg2 = MagicMock()
    msg2.__class__.__name__ = "UserMessage"
    msg2.content = []

    return [msg1, msg2]


# =============================================================================
# FIXTURE HELPERS
# =============================================================================

def create_mock_client():
    """Create a mock Claude SDK client for use in fixtures.

    Returns:
        MagicMock configured as a Claude SDK client
    """
    client = MagicMock()
    client.query = AsyncMock()
    client.receive_response = ReceiveResponseMock()
    return client

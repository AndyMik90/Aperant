#!/usr/bin/env python3
"""
QA Report Test Helpers
======================

Shared mocking setup and utilities for qa/report.py tests.

This module provides the mock setup required to test the qa/report.py module
without importing the Claude SDK which is not available in the test environment.
"""

import sys
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock

# =============================================================================
# MOCK SETUP - Must happen before ANY imports from auto-claude
# =============================================================================

# Store original modules for cleanup
_original_modules: Dict[str, Any] = {}
_mocked_module_names: List[str] = [
    'claude_agent_sdk',
    'ui',
    'progress',
    'task_logger',
    'linear_updater',
    'client',
]


def setup_qa_report_mocks() -> None:
    """Set up all required mocks for qa/report.py testing.

    This function must be called before importing any auto-claude modules.
    """
    global _original_modules

    # Store original modules for cleanup
    for name in _mocked_module_names:
        if name in sys.modules:
            _original_modules[name] = sys.modules[name]

    # Mock claude_agent_sdk FIRST (before any other imports)
    mock_sdk = MagicMock()
    mock_sdk.ClaudeSDKClient = MagicMock()
    mock_sdk.ClaudeAgentOptions = MagicMock()
    mock_sdk.ClaudeCodeOptions = MagicMock()
    sys.modules['claude_agent_sdk'] = mock_sdk

    # Mock UI module (used by progress)
    mock_ui = MagicMock()
    mock_ui.Icons = MagicMock()
    mock_ui.icon = MagicMock(return_value="")
    mock_ui.color = MagicMock()
    mock_ui.Color = MagicMock()
    mock_ui.success = MagicMock(return_value="")
    mock_ui.error = MagicMock(return_value="")
    mock_ui.warning = MagicMock(return_value="")
    mock_ui.info = MagicMock(return_value="")
    mock_ui.muted = MagicMock(return_value="")
    mock_ui.highlight = MagicMock(return_value="")
    mock_ui.bold = MagicMock(return_value="")
    mock_ui.box = MagicMock(return_value="")
    mock_ui.divider = MagicMock(return_value="")
    mock_ui.progress_bar = MagicMock(return_value="")
    mock_ui.print_header = MagicMock()
    mock_ui.print_section = MagicMock()
    mock_ui.print_status = MagicMock()
    mock_ui.print_phase_status = MagicMock()
    mock_ui.print_key_value = MagicMock()
    sys.modules['ui'] = mock_ui

    # Mock progress module
    mock_progress = MagicMock()
    mock_progress.count_subtasks = MagicMock(return_value=(3, 3))
    mock_progress.is_build_complete = MagicMock(return_value=True)
    sys.modules['progress'] = mock_progress

    # Mock task_logger
    mock_task_logger = MagicMock()
    mock_task_logger.LogPhase = MagicMock()
    mock_task_logger.LogEntryType = MagicMock()
    mock_task_logger.get_task_logger = MagicMock(return_value=None)
    sys.modules['task_logger'] = mock_task_logger

    # Mock linear_updater
    mock_linear = MagicMock()
    mock_linear.is_linear_enabled = MagicMock(return_value=False)
    mock_linear.LinearTaskState = MagicMock()
    mock_linear.linear_qa_started = MagicMock()
    mock_linear.linear_qa_approved = MagicMock()
    mock_linear.linear_qa_rejected = MagicMock()
    mock_linear.linear_qa_max_iterations = MagicMock()
    sys.modules['linear_updater'] = mock_linear

    # Mock client module
    mock_client = MagicMock()
    mock_client.create_client = MagicMock()
    sys.modules['client'] = mock_client

    # Add auto-claude path for imports
    sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))


def cleanup_qa_report_mocks() -> None:
    """Restore original modules after testing."""
    for name in _mocked_module_names:
        if name in _original_modules:
            sys.modules[name] = _original_modules[name]
        elif name in sys.modules:
            del sys.modules[name]


def get_mocked_module_names() -> List[str]:
    """Return list of module names that are mocked."""
    return _mocked_module_names.copy()

#!/usr/bin/env python3
"""
Shared Test Utilities
=====================

Common helper functions for test files.
"""

from unittest.mock import MagicMock


def _create_mock_module():
    """Create a simple mock module with necessary attributes.

    Used by test files that need to mock external modules at import time.
    """
    mock = MagicMock()
    return mock


def configure_build_mocks(
    mock_validate_env,
    mock_should_run_qa,
    mock_get_phase_model,
    mock_choose_workspace,
    mock_get_existing,
    mock_run_agent,
    successful_agent_fn,
    validate_env=True,
    should_run_qa=False,
    workspace_mode=None,
    existing_spec=None,
):
    """
    Configure common mock defaults for build command tests.

    This helper reduces the boilerplate of setting up the same 6-line mock pattern
    that was repeated 27+ times across test_cli_build_commands.py.

    Usage:
        def test_something(
            mock_validate_env, mock_should_run_qa, mock_get_phase_model,
            mock_choose_workspace, mock_get_existing, mock_run_agent,
            successful_agent_fn
        ):
            from test_utils import configure_build_mocks
            configure_build_mocks(
                mock_validate_env, mock_should_run_qa, mock_get_phase_model,
                mock_choose_workspace, mock_get_existing, mock_run_agent,
                successful_agent_fn
            )
            # ... rest of test
    """
    from workspace import WorkspaceMode

    mock_validate_env.return_value = validate_env
    mock_should_run_qa.return_value = should_run_qa
    mock_get_phase_model.side_effect = lambda spec_dir, phase, model: model or "sonnet"
    mock_choose_workspace.return_value = workspace_mode or WorkspaceMode.DIRECT
    mock_get_existing.return_value = existing_spec
    mock_run_agent.side_effect = successful_agent_fn

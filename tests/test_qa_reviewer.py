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

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

# =============================================================================
# MOCK SETUP - Must happen before ANY imports from auto-claude
# =============================================================================

# Import shared mock helpers
from tests.qa_test_helpers import (
    setup_qa_mocks,
    cleanup_qa_mocks,
    reset_qa_mocks,
    create_mock_response,
    create_mock_client,
)

# Set up mocks (reviewer needs prompts_pkg)
setup_qa_mocks(include_prompts_pkg=True)

# Import after mocks are set up
from qa.reviewer import run_qa_agent_session
from qa.criteria import save_implementation_plan


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield
    cleanup_qa_mocks()


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
    return create_mock_client()


@pytest.fixture(autouse=True, scope='function')
def reset_shared_mocks_before_test():
    """Reset shared module-level mocks before and after each test."""
    reset_qa_mocks()
    yield
    reset_qa_mocks()


# =============================================================================
# MOCK RESPONSE HELPERS (reviewer-specific)
# =============================================================================

def _create_approved_response():
    """Create mock response for approved QA."""
    return create_mock_response("QA approved - all criteria met.")


def _create_rejected_response():
    """Create mock response for rejected QA."""
    return create_mock_response("QA rejected - found issues.")


def _create_no_signoff_response():
    """Create mock response where agent doesn't update signoff."""
    return create_mock_response("QA review complete.")


def _create_tool_use_response():
    """Create mock response with tool use blocks."""
    msg1, msg2 = create_mock_response("Checking files...")
    # Add tool use block to first message
    from unittest.mock import MagicMock
    tool_block = MagicMock()
    tool_block.__class__.__name__ = "ToolUseBlock"
    tool_block.name = "Read"
    tool_block.input = {"file_path": "/test/file.py"}
    msg1.content.append(tool_block)

    return [msg1, msg2]


# =============================================================================
# TEST CLASSES
# =============================================================================


class TestRunQAAgentSessionApproved:
    """Tests for run_qa_agent_session returning approved status."""

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
        mock_client.receive_response.return_value = _create_approved_response()

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


class TestRunQAAgentSessionRejected:
    """Tests for run_qa_agent_session returning rejected status."""

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
        mock_client.receive_response.return_value = _create_rejected_response()

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


class TestRunQAAgentSessionError:
    """Tests for run_qa_agent_session error handling."""

    async def test_error_status_no_signoff(self, mock_client, spec_dir, project_dir):
        """Test error status when agent doesn't update signoff."""
        # Setup implementation plan without qa_signoff
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses - agent doesn't update signoff
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = _create_no_signoff_response()

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
        mock_client.receive_response.return_value = _create_no_signoff_response()

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

    async def test_verbose_mode(self, mock_client, spec_dir, project_dir):
        """Test session with verbose mode enabled."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = _create_no_signoff_response()

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


class TestRunQAAgentSessionIntegration:
    """Integration tests for QA reviewer session."""

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
        mock_client.receive_response.return_value = _create_approved_response()

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


class TestMemoryIntegration:
    """Tests for memory integration in QA reviewer."""

    async def test_memory_context_retrieval(self, mock_client, spec_dir, project_dir):
        """Test that memory context is retrieved during session."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = _create_no_signoff_response()

        # Patch where the function is used (in qa.reviewer module)
        with patch('qa.reviewer.get_graphiti_context', new_callable=AsyncMock) as mock_get_context:
            mock_get_context.return_value = "Past QA insights: check for edge cases"

            await run_qa_agent_session(
                mock_client,
                project_dir,
                spec_dir,
                1,
                50,
                False
            )

            # Verify memory context was retrieved
            assert mock_get_context.called

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
        mock_client.receive_response.return_value = _create_approved_response()

        # Patch where the functions are used
        with patch('qa.reviewer.get_graphiti_context', new_callable=AsyncMock, return_value=None), \
             patch('qa.reviewer.save_session_memory', new_callable=AsyncMock) as mock_save:

            await run_qa_agent_session(
                mock_client,
                project_dir,
                spec_dir,
                1,
                50,
                False
            )

            # Verify memory was saved
            assert mock_save.called

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
        mock_client.receive_response.return_value = _create_rejected_response()

        # Patch where the functions are used
        with patch('qa.reviewer.get_graphiti_context', new_callable=AsyncMock, return_value=None), \
             patch('qa.reviewer.save_session_memory', new_callable=AsyncMock) as mock_save:

            await run_qa_agent_session(
                mock_client,
                project_dir,
                spec_dir,
                1,
                50,
                False
            )

            # Verify memory was saved with issues
            assert mock_save.called


class TestErrorDetection:
    """Tests for error type detection in QA reviewer."""

    async def test_rate_limit_error_detection(self, mock_client, spec_dir, project_dir):
        """Test that rate limit errors are properly detected."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Rate limit exceeded")

        # Patch where the functions are used (qa.reviewer) not where they're defined
        with patch('qa.reviewer.is_rate_limit_error', return_value=True), \
             patch('qa.reviewer.is_tool_concurrency_error', return_value=False):

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

    async def test_tool_concurrency_error_detection(self, mock_client, spec_dir, project_dir):
        """Test that tool concurrency errors are properly detected."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Tool concurrency limit")

        # Patch where the functions are used
        with patch('qa.reviewer.is_tool_concurrency_error', return_value=True), \
             patch('qa.reviewer.is_rate_limit_error', return_value=False):

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

    async def test_tool_use_blocks(self, mock_client, spec_dir, project_dir):
        """Test that tool use blocks are handled correctly."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses with tool use
        mock_client.query.return_value = None
        mock_client.receive_response.return_value = _create_tool_use_response()

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

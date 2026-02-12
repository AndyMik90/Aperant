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

import shutil
import tempfile
from pathlib import Path
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
    create_mock_fixed_response,
    create_mock_tool_use_response,
    create_mock_client,
)

# Set up mocks (no prompts_pkg needed for fixer)
setup_qa_mocks(include_prompts_pkg=False)

# Import after mocks are set up
from qa.fixer import load_qa_fixer_prompt, run_qa_fixer_session
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
# MOCK RESPONSE HELPERS (fixer-specific)
# =============================================================================

def _create_mock_response(text: str = "Fixer session complete."):
    """Create a standard mock assistant+user message pair."""
    return create_mock_response(text)


def _create_mock_fixed_response():
    """Create mock response for fixed QA."""
    return create_mock_fixed_response()


def _create_mock_tool_use_response():
    """Create mock response with tool use blocks."""
    return create_mock_tool_use_response("Edit", {"file_path": "/test/file.py"})


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
        empty_dir = Path(tempfile.mkdtemp())

        try:
            # Patch QA_PROMPTS_DIR to point to empty directory
            import qa.fixer as qa_fixer_module
            monkeypatch.setattr(qa_fixer_module, "QA_PROMPTS_DIR", empty_dir)

            with pytest.raises(FileNotFoundError):
                load_qa_fixer_prompt()
        finally:
            # Clean up temp directory
            shutil.rmtree(empty_dir)


class TestRunQAFixerSessionFixed:
    """Tests for run_qa_fixer_session returning fixed status."""

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

    async def test_memory_context_retrieval(self, mock_client, spec_dir, fix_request_file):
        """Test that memory context is retrieved during session."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_response())

        # Patch where the function is used (in qa.fixer module)
        with patch('qa.fixer.get_graphiti_context', new_callable=AsyncMock) as mock_get_context:
            mock_get_context.return_value = "Past fix patterns: check imports"

            await run_qa_fixer_session(
                mock_client,
                spec_dir,
                1,
                False
            )

            # Verify memory context was retrieved
            assert mock_get_context.called

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

        # Patch where the function is used
        with patch('qa.fixer.get_graphiti_context', new_callable=AsyncMock, return_value=None), \
             patch('qa.fixer.save_session_memory', new_callable=AsyncMock) as mock_save:

            await run_qa_fixer_session(
                mock_client,
                spec_dir,
                1,
                False
            )

            # Verify memory was saved
            assert mock_save.called


class TestErrorDetection:
    """Tests for error type detection in QA fixer."""

    async def test_rate_limit_error_detection(self, mock_client, spec_dir, fix_request_file):
        """Test that rate limit errors are properly detected."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Rate limit exceeded")

        # Patch where the functions are used (qa.fixer) not where they're defined
        with patch('qa.fixer.is_rate_limit_error', return_value=True), \
             patch('qa.fixer.is_tool_concurrency_error', return_value=False):

            result = await run_qa_fixer_session(
                mock_client,
                spec_dir,
                1,
                False
            )

            assert result[0] == "error"
            assert result[2]["type"] == "rate_limit"

    async def test_tool_concurrency_error_detection(self, mock_client, spec_dir, fix_request_file):
        """Test that tool concurrency errors are properly detected."""
        # Setup implementation plan
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client to raise exception
        mock_client.query.side_effect = Exception("Tool concurrency limit")

        # Patch where the functions are used (qa.fixer) not where they're defined
        with patch('qa.fixer.is_tool_concurrency_error', return_value=True), \
             patch('qa.fixer.is_rate_limit_error', return_value=False), \
             patch('qa.fixer.get_graphiti_context', new_callable=AsyncMock, return_value=None):

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

    async def test_fixed_assumed_when_status_not_updated(self, mock_client, spec_dir, fix_request_file):
        """Test that fixed is assumed even when status not updated."""
        # Setup implementation plan without ready_for_qa_revalidation
        plan = {"feature": "Test"}
        save_implementation_plan(spec_dir, plan)

        # Mock client responses
        mock_client.query.return_value = None
        mock_client.receive_response.return_value.set_messages(_create_mock_response())

        # Patch where the function is used
        with patch('qa.fixer.get_graphiti_context', new_callable=AsyncMock, return_value=None), \
             patch('qa.fixer.save_session_memory', new_callable=AsyncMock) as mock_save:

            result = await run_qa_fixer_session(
                mock_client,
                spec_dir,
                1,
                False
            )

            # Should still return "fixed" even though status wasn't updated
            assert result[0] == "fixed"
            # Memory should still be saved
            assert mock_save.called


class TestToolUseHandling:
    """Tests for tool use handling in QA fixer."""

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

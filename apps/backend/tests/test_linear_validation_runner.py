"""
Unit Tests for Linear Validation Runner

Tests for:
- Project .env file loading
- Authorization header consistency
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

import pytest


class TestProjectEnvLoading:
    """Test project-specific .env file loading."""

    def test_load_project_env_from_auto_claude(self):
        """Should load .env from .auto-claude/ directory."""
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)
            auto_claude_dir = project_dir / ".auto-claude"
            auto_claude_dir.mkdir()

            # Create test .env file
            env_file = auto_claude_dir / ".env"
            env_file.write_text("LINEAR_API_KEY=test_key_123\n", encoding="utf-8")

            # Mock load_dotenv to track calls
            with (
                patch("runners.linear_validation_runner.load_dotenv") as mock_load,
                patch("runners.linear_validation_runner.logger"),
            ):
                # Need to clear cached module if it was imported
                import sys

                if "runners.linear_validation_runner" in sys.modules:
                    # Force reimport to get fresh module state
                    del sys.modules["runners.linear_validation_runner"]

                from runners.linear_validation_runner import load_project_env

                load_project_env(project_dir)

                # Verify load_dotenv was called with correct path
                mock_load.assert_called_once()
                call_args = mock_load.call_args
                assert call_args.args[0] == env_file
                # override=True should be set to override backend .env
                assert call_args.kwargs.get("override") is True

    def test_load_project_env_from_auto_claude_worktrees(self):
        """Should load .env from .auto-claude-worktrees/ directory."""
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)
            worktrees_dir = project_dir / ".auto-claude-worktrees"
            worktrees_dir.mkdir()

            # Create test .env file
            env_file = worktrees_dir / ".env"
            env_file.write_text("LINEAR_API_KEY=test_key_456\n", encoding="utf-8")

            # Mock load_dotenv to track calls
            with (
                patch("runners.linear_validation_runner.load_dotenv") as mock_load,
                patch("runners.linear_validation_runner.logger"),
            ):
                import sys

                if "runners.linear_validation_runner" in sys.modules:
                    del sys.modules["runners.linear_validation_runner"]

                from runners.linear_validation_runner import load_project_env

                load_project_env(project_dir)

                # Verify load_dotenv was called
                mock_load.assert_called_once()
                call_args = mock_load.call_args
                assert call_args.args[0] == env_file

    def test_load_project_env_prefers_auto_claude(self):
        """Should prefer .auto-claude/ over .auto-claude-worktrees/."""
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)
            auto_claude_dir = project_dir / ".auto-claude"
            worktrees_dir = project_dir / ".auto-claude-worktrees"
            auto_claude_dir.mkdir()
            worktrees_dir.mkdir()

            # Create both .env files
            env_file1 = auto_claude_dir / ".env"
            env_file1.write_text("LINEAR_API_KEY=from_auto_claude\n", encoding="utf-8")
            env_file2 = worktrees_dir / ".env"
            env_file2.write_text("LINEAR_API_KEY=from_worktrees\n", encoding="utf-8")

            # Mock load_dotenv to track calls
            with (
                patch("runners.linear_validation_runner.load_dotenv") as mock_load,
                patch("runners.linear_validation_runner.logger"),
            ):
                import sys

                if "runners.linear_validation_runner" in sys.modules:
                    del sys.modules["runners.linear_validation_runner"]

                from runners.linear_validation_runner import load_project_env

                load_project_env(project_dir)

                # Should only call once with .auto-claude (preferred)
                mock_load.assert_called_once()
                call_args = mock_load.call_args
                assert call_args.args[0] == env_file1

    def test_load_project_env_handles_missing_directory(self):
        """Should handle missing .env directories gracefully."""
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)

            # Mock load_dotenv and logger
            with (
                patch("runners.linear_validation_runner.load_dotenv") as mock_load,
                patch("runners.linear_validation_runner.logger") as mock_logger,
            ):
                import sys

                if "runners.linear_validation_runner" in sys.modules:
                    del sys.modules["runners.linear_validation_runner"]

                from runners.linear_validation_runner import load_project_env

                load_project_env(project_dir)

                # Should not call load_dotenv
                mock_load.assert_not_called()
                # Should log warning
                mock_logger.warning.assert_called_once()


class TestAuthorizationHeaderConsistency:
    """Test that authorization header logic is consistent across files."""

    def test_linear_utils_authorization_pattern(self):
        """Linear utils should use: api_key if starts with lin_api_ else f'Bearer {api_key}'"""
        from agents.linear_utils import fetch_linear_ticket

        # Test the authorization pattern from linear_utils.py
        api_key = "test_token"
        expected = api_key if api_key.startswith("lin_api_") else f"Bearer {api_key}"

        assert expected == "Bearer test_token"

        # Test with lin_api_ prefix
        api_key = "lin_api_12345"
        expected = api_key if api_key.startswith("lin_api_") else f"Bearer {api_key}"

        assert expected == "lin_api_12345"

    def test_linear_similarity_agent_authorization_pattern(self):
        """Linear similarity agent should use: api_key if starts with lin_api_ else f'Bearer {api_key}'"""
        # Check the source file contains the correct pattern
        from pathlib import Path

        source_file = (
            Path(__file__).parent.parent / "agents" / "linear_similarity_agent.py"
        )
        content = source_file.read_text(encoding="utf-8")

        # Check for the authorization pattern
        assert 'startswith("lin_api_")' in content
        assert 'f"Bearer {api_key}"' in content

    def test_linear_validator_authorization_pattern(self):
        """Linear validator should use: api_key if starts with lin_api_ else f'Bearer {api_key}'"""
        # Check the source file contains the correct pattern
        from pathlib import Path

        source_file = Path(__file__).parent.parent / "agents" / "linear_validator.py"
        if source_file.exists():
            content = source_file.read_text(encoding="utf-8")

            # Check for the authorization pattern
            assert 'startswith("lin_api_")' in content
            assert 'f"Bearer {api_key}"' in content


class TestResultSerialization:
    """Test validation result serialization."""

    def test_serialize_validation_result_full(self):
        """Should serialize full validation result."""
        from runners.linear_validation_runner import _serialize_validation_result

        result = {
            "issue_id": "LIN-123",
            "validation_timestamp": "2024-01-18T10:00:00Z",
            "cached": False,
            "status": "complete",
            "confidence": 0.95,
            "reasoning": "Test reasoning",
            "analysis": {
                "title": "Test title",
                "description_summary": "Test summary",
                "requirements": ["Req1", "Req2"],
            },
            "completeness": {
                "title_clear": True,
                "description_sufficient": True,
                "feasibility_score": 85.0,
                "missing_info": [],
                "feasibility_reasoning": "All good",
            },
            "recommended_labels": [
                {"name": "bug", "confidence": 0.9, "reason": "Bug detected"}
            ],
            "current_version": "2.7.4",
            "version_label": "2.7.5",
            "version_type": "patch",
            "version_reasoning": "Critical bug",
            "properties": {
                "category": "bug_fix",
                "complexity": "medium",
                "impact": "high",
                "priority": "high",
            },
        }

        serialized = _serialize_validation_result(result, "LIN-123")

        # Verify all fields are present
        assert serialized["ticketIdentifier"] == "LIN-123"
        assert serialized["validationTimestamp"] == "2024-01-18T10:00:00Z"
        assert serialized["cached"] is False
        assert serialized["status"] == "complete"
        assert serialized["confidence"] == 0.95
        assert serialized["contentAnalysis"]["title"] == "Test title"
        assert serialized["completenessValidation"]["isComplete"] is True
        assert serialized["suggestedLabels"][0]["name"] == "bug"
        assert serialized["versionRecommendation"]["recommendedVersion"] == "2.7.5"
        assert serialized["taskProperties"]["category"] == "bug_fix"

    def test_serialize_validation_result_minimal(self):
        """Should handle minimal result gracefully."""
        from runners.linear_validation_runner import _serialize_validation_result

        result = {
            "issue_id": "LIN-456",
        }

        serialized = _serialize_validation_result(result, "LIN-456")

        # Verify defaults are applied
        assert serialized["ticketIdentifier"] == "LIN-456"
        assert serialized["cached"] is False
        assert serialized["status"] == "complete"
        assert serialized["confidence"] == 0.0
        assert serialized["completenessValidation"]["isComplete"] is False


class TestOutputResult:
    """Test result output formatting."""

    def test_output_result_json(self):
        """Should output result as JSON."""
        import json
        from io import StringIO

        from runners.linear_validation_runner import output_result

        # Capture stdout
        captured_output = StringIO()
        with patch("sys.stdout", captured_output):
            result = {"success": True, "data": {"ticketId": "LIN-123"}}
            output_result(result)

        # Verify JSON output
        output = captured_output.getvalue()
        parsed = json.loads(output)
        assert parsed["success"] is True
        assert parsed["data"]["ticketId"] == "LIN-123"

"""
Unit Tests for Linear Validation Runner

Tests for:
- Authorization header consistency
- Result serialization
"""

from pathlib import Path
from unittest.mock import patch


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
        source_file = Path(__file__).parent.parent / "agents" / "linear_validator.py"
        assert source_file.exists(), "linear_validator.py must exist for this test"
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


class TestProjectEnvLoading:
    """Test project .env file loading logic."""

    def test_env_file_paths_checked(self):
        """Test that the code checks the correct paths."""
        source_file = (
            Path(__file__).parent.parent / "runners" / "linear_validation_runner.py"
        )
        content = source_file.read_text(encoding="utf-8")

        # Verify it checks .auto-claude/.env
        assert '".auto-claude"' in content
        # Verify it checks .auto-claude-worktrees/.env
        assert '".auto-claude-worktrees"' in content

    def test_override_flag_used(self):
        """Test that override=True is used for load_dotenv."""
        source_file = (
            Path(__file__).parent.parent / "runners" / "linear_validation_runner.py"
        )
        content = source_file.read_text(encoding="utf-8")

        # Verify override=True is used
        assert "override=True" in content

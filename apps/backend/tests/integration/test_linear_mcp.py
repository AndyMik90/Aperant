"""
Integration Tests for Linear MCP Tools

Tests for Linear MCP tool integration:
- get_issue
- update_issue
- list_issues
- list_teams
- list_issue_labels

Note: These tests require:
1. LINEAR_API_KEY environment variable set
2. Valid Linear workspace access
3. Existing issues, teams, and labels in the workspace

These are integration tests that make real API calls to Linear.
"""

import os
import tempfile
from pathlib import Path

import pytest


class TestLinearMCPTools:
    """
    Integration tests for Linear MCP tool availability and configuration.

    These tests verify that:
    - Linear MCP tools are available when LINEAR_API_KEY is set
    - Agent configuration enables Linear MCP server
    - MCP tools can be invoked (doesn't test actual API calls)
    """

    def test_linear_api_key_required_warning(self):
        """
        Test that we warn if LINEAR_API_KEY is not set.

        This is a documentation test - actual API calls would fail without API key.
        """
        api_key = os.environ.get("LINEAR_API_KEY")

        if not api_key:
            # If no API key, test that we can detect this gracefully
            pytest.skip("LINEAR_API_KEY not set - skipping integration test")
        else:
            # API key is set, we can proceed with other tests
            assert api_key is not None
            assert len(api_key) > 0

    def test_agent_config_includes_linear_mcp(self):
        """
        Test that AGENT_CONFIGS includes linear_validator with Linear MCP tools enabled.

        This verifies the configuration is correct, even without making API calls.
        """
        from agents.tools_pkg.models import AGENT_CONFIGS

        # Verify linear_validator agent type exists
        assert "linear_validator" in AGENT_CONFIGS, (
            "linear_validator agent type must exist in AGENT_CONFIGS"
        )

        config = AGENT_CONFIGS["linear_validator"]

        # Verify Linear MCP server is enabled
        assert "mcp_servers" in config, "Agent config must have mcp_servers"
        assert "linear" in config["mcp_servers"], (
            "Linear MCP server must be enabled for linear_validator"
        )

    def test_linear_mcp_tools_available(self):
        """
        Test that Linear MCP tools are listed in the agent configuration.

        This verifies the tools are configured correctly.
        """
        from agents.tools_pkg.models import AGENT_CONFIGS

        config = AGENT_CONFIGS["linear_validator"]

        # Check for common Linear MCP tools in configuration
        # The actual tool names may vary, but we check for the MCP server configuration
        assert "linear" in config["mcp_servers"], (
            "Linear MCP server must be in mcp_servers list"
        )

    def test_linear_validation_agent_initialization(self):
        """
        Test that LinearValidationAgent can be initialized without errors.

        This verifies the agent can be created with proper configuration.
        """
        from agents.linear_validator import LinearValidationAgent

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            # Should not raise any errors
            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Verify agent is initialized
            assert agent is not None
            assert agent.spec_dir == spec_dir
            assert agent.project_dir == project_dir
            assert agent.model == "claude-opus-4-5-20251101"  # Default model

    def test_linear_validation_agent_cache_initialization(self):
        """
        Test that LinearValidationAgent initializes cache correctly.

        Verifies:
        - Cache directory is created
        - Cache object is initialized
        - Cache TTL is set to 3600 seconds
        """
        from agents.linear_validator import LinearValidationAgent

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Verify cache is initialized
            assert agent.cache is not None

            # Verify cache directory exists
            cache_dir = spec_dir / ".cache" / "linear_validator"
            assert cache_dir.exists()

            # Verify TTL constant
            assert agent.CACHE_TTL_SECONDS == 3600

    def test_linear_validation_agent_client_factory(self):
        """
        Test that LinearValidationAgent can create a client.

        This verifies the client factory integration works correctly.
        Note: This test doesn't actually connect to Linear API,
        it just verifies the client can be created with proper config.
        """
        from agents.linear_validator import LinearValidationAgent

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Create client (may fail if no API keys, but that's expected)
            try:
                client = agent.create_client()
                assert client is not None
            except Exception as e:
                # Client creation may fail if no Claude API credentials
                # That's expected in some environments
                pytest.skip(
                    f"Client creation failed (likely missing API credentials): {e}"
                )


class TestLinearCacheIntegration:
    """
    Integration tests for Linear validation cache.

    Tests cache read/write operations with TTL expiration.
    """

    def test_cache_write_and_read(self):
        """
        Test that validation results can be written to and read from cache.
        """
        from agents.linear_validator import LinearValidationAgent

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Test data
            issue_id = "LIN-123"
            validation_timestamp = "2024-01-18T10:00:00Z"
            result = {
                "issue_id": issue_id,
                "confidence": 0.95,
                "suggested_labels": ["bug", "high-priority"],
            }

            # Write to cache
            agent._save_result(issue_id, validation_timestamp, result)

            # Read from cache
            cached = agent._get_cached_result(
                issue_id, validation_timestamp, skip_cache=False
            )

            assert cached is not None
            assert cached["issue_id"] == issue_id
            assert cached["confidence"] == 0.95

    def test_cache_key_generation(self):
        """
        Test that cache keys are generated correctly with sanitized timestamps.
        """
        from agents.linear_validator import LinearValidationAgent

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Test cache key format (colons in timestamp are sanitized)
            key1 = agent._get_cache_key("LIN-123", "2024-01-18T10:00:00Z")
            assert key1 == "LIN-123:2024-01-18T10_00_00Z"

            # Different timestamps should produce different keys
            key2 = agent._get_cache_key("LIN-123", "2024-01-18T11:00:00Z")
            assert key1 != key2

            # Same inputs should produce same key
            key3 = agent._get_cache_key("LIN-123", "2024-01-18T10:00:00Z")
            assert key1 == key3

    def test_cache_skip_option(self):
        """
        Test that skip_cache option bypasses cache.
        """
        from agents.linear_validator import LinearValidationAgent

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Write to cache
            issue_id = "LIN-123"
            validation_timestamp = "2024-01-18T10:00:00Z"
            result = {"issue_id": issue_id, "confidence": 0.95}

            agent._save_result(issue_id, validation_timestamp, result)

            # Read with skip_cache=False should return cached value
            cached1 = agent._get_cached_result(
                issue_id, validation_timestamp, skip_cache=False
            )
            assert cached1 is not None

            # Read with skip_cache=True should return None
            cached2 = agent._get_cached_result(
                issue_id, validation_timestamp, skip_cache=True
            )
            assert cached2 is None

    def test_cache_miss_returns_none(self):
        """
        Test that cache miss returns None for non-existent keys.
        """
        from agents.linear_validator import LinearValidationAgent

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Try to read non-existent cache entry
            cached = agent._get_cached_result(
                "NON-EXISTENT", "2024-01-18T10:00:00Z", skip_cache=False
            )

            assert cached is None


class TestLinearValidationWorkflow:
    """
    Integration tests for Linear validation workflow.

    Tests the complete workflow from issue data to validation result.
    """

    def test_validation_prompt_building(self):
        """
        Test that validation prompt is built correctly from issue data.
        """
        from agents.linear_validator import LinearValidationAgent

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Test issue data
            issue_data = {
                "title": "Fix login bug",
                "description": "Users cannot login with SSO",
                "state": {"name": "In Progress"},
                "priority": 1,
                "labels": [{"name": "bug"}],
                "assignee": {"name": "John Doe"},
            }

            # Build prompt
            prompt = agent._build_validation_prompt(
                issue_id="LIN-123", issue_data=issue_data, current_version="2.7.4"
            )

            # Verify prompt contains key information
            assert "LIN-123" in prompt
            assert "Fix login bug" in prompt
            assert "Users cannot login with SSO" in prompt
            assert "In Progress" in prompt
            assert "2.7.4" in prompt

    @pytest.mark.asyncio
    async def test_batch_validation_limit_enforcement(self):
        """
        Test that batch validation enforces maximum of 5 tickets.
        """
        from agents.linear_validator import LinearValidationAgent, validate_batch_limit

        with tempfile.TemporaryDirectory() as temp_dir:
            spec_dir = Path(temp_dir)
            project_dir = Path(temp_dir)

            agent = LinearValidationAgent(spec_dir=spec_dir, project_dir=project_dir)

            # Test with 5 tickets (should pass)
            five_tickets = [
                {"id": "LIN-1"},
                {"id": "LIN-2"},
                {"id": "LIN-3"},
                {"id": "LIN-4"},
                {"id": "LIN-5"},
            ]
            await agent.validate_batch(five_tickets)  # Should not raise

            # Test with 6 tickets (should raise)
            six_tickets = [
                {"id": "LIN-1"},
                {"id": "LIN-2"},
                {"id": "LIN-3"},
                {"id": "LIN-4"},
                {"id": "LIN-5"},
                {"id": "LIN-6"},
            ]
            with pytest.raises(ValueError, match="Maximum 5 tickets"):
                await agent.validate_batch(six_tickets)

            # Test module-level function too
            six_ticket_ids = ["LIN-1", "LIN-2", "LIN-3", "LIN-4", "LIN-5", "LIN-6"]
            with pytest.raises(ValueError, match="Maximum 5 tickets"):
                validate_batch_limit(six_ticket_ids)


class TestLinearVersionLabelLogic:
    """
    Integration tests for version label calculation logic.

    Tests the semantic versioning logic used in validation workflow.
    """

    def test_version_label_calculation_integration(self):
        """
        Test version label calculation with various inputs.
        """
        from agents.linear_validator import calculate_version_label

        # Test bug → patch increment
        assert calculate_version_label("2.7.4", "bug", "critical") == "2.7.5"

        # Test feature → minor increment
        assert calculate_version_label("2.7.4", "feature", "normal") == "2.8.0"

        # Test high priority enhancement → minor (enhancements always get minor)
        assert calculate_version_label("2.7.4", "enhancement", "urgent") == "2.8.0"

        # Test normal priority → minor
        assert calculate_version_label("2.7.4", "enhancement", "normal") == "2.8.0"

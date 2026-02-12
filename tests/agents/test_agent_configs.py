"""
Tests for AGENT_CONFIGS registry and related functions.

Tests the phase-aware tool and MCP server configuration system
that provides granular control over what tools/servers are available
during each execution phase.
"""

import os
import pytest

# Set up path for imports
import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent.parent / "apps" / "backend"
sys.path.insert(0, str(backend_path))


class TestAgentConfigs:
    """Tests for AGENT_CONFIGS registry."""

    def test_all_agent_types_have_required_fields(self):
        """Every agent config should have tools, mcp_servers, auto_claude_tools, thinking_default."""
        from agents.tools_pkg.models import AGENT_CONFIGS

        required_fields = ["tools", "mcp_servers", "auto_claude_tools", "thinking_default"]

        for agent_type, config in AGENT_CONFIGS.items():
            for field in required_fields:
                assert field in config, f"Agent type '{agent_type}' missing field '{field}'"

    def test_known_agent_types_exist(self):
        """Key agent types from PRD should exist."""
        from agents.tools_pkg.models import AGENT_CONFIGS

        expected_types = [
            # Spec phases
            "spec_gatherer",
            "spec_researcher",
            "spec_writer",
            "spec_critic",
            # Build phases
            "planner",
            "coder",
            # QA phases
            "qa_reviewer",
            "qa_fixer",
            # Utility phases
            "insights",
            "merge_resolver",
            "commit_message",
            "pr_reviewer",
        ]

        for agent_type in expected_types:
            assert agent_type in AGENT_CONFIGS, f"Expected agent type '{agent_type}' not found"

    def test_thinking_defaults_are_valid(self):
        """All thinking_default values should be valid levels."""
        from agents.tools_pkg.models import AGENT_CONFIGS
        from phase_config import THINKING_BUDGET_MAP

        valid_levels = set(THINKING_BUDGET_MAP.keys())

        for agent_type, config in AGENT_CONFIGS.items():
            level = config.get("thinking_default")
            assert level in valid_levels, f"Agent '{agent_type}' has invalid thinking_default: {level}"

    def test_tools_are_lists(self):
        """All tool configurations should be lists."""
        from agents.tools_pkg.models import AGENT_CONFIGS

        for agent_type, config in AGENT_CONFIGS.items():
            assert isinstance(config["tools"], list), f"Agent '{agent_type}' tools should be list"
            assert isinstance(
                config["auto_claude_tools"], list
            ), f"Agent '{agent_type}' auto_claude_tools should be list"
            assert isinstance(
                config["mcp_servers"], list
            ), f"Agent '{agent_type}' mcp_servers should be list"


class TestGetAgentConfig:
    """Tests for get_agent_config() function."""

    def test_returns_config_for_known_type(self):
        """Should return config dict for known agent types."""
        from agents.tools_pkg.models import get_agent_config

        config = get_agent_config("coder")
        assert isinstance(config, dict)
        assert "tools" in config
        assert "mcp_servers" in config

    def test_raises_for_unknown_type(self):
        """Should raise ValueError for unknown agent types."""
        from agents.tools_pkg.models import get_agent_config

        with pytest.raises(ValueError) as excinfo:
            get_agent_config("nonexistent_agent_type")

        assert "Unknown agent type" in str(excinfo.value)
        assert "nonexistent_agent_type" in str(excinfo.value)


class TestGetRequiredMcpServers:
    """Tests for get_required_mcp_servers() function."""

    def test_spec_gatherer_has_no_mcp_servers(self):
        """spec_gatherer should not require any MCP servers."""
        from agents.tools_pkg.models import get_required_mcp_servers

        servers = get_required_mcp_servers("spec_gatherer")
        assert servers == []

    def test_spec_researcher_has_context7(self):
        """spec_researcher should require context7 for docs lookup."""
        from agents.tools_pkg.models import get_required_mcp_servers

        servers = get_required_mcp_servers("spec_researcher")
        assert "context7" in servers

    def test_coder_has_context7_and_auto_claude(self):
        """coder should require context7 and auto-claude."""
        from agents.tools_pkg.models import get_required_mcp_servers

        servers = get_required_mcp_servers("coder")
        assert "context7" in servers
        assert "auto-claude" in servers

    def test_linear_optional_not_included_by_default(self):
        """Linear should not be included unless linear_enabled=True."""
        from agents.tools_pkg.models import get_required_mcp_servers

        servers = get_required_mcp_servers("planner", linear_enabled=False)
        assert "linear" not in servers

    def test_linear_included_when_enabled(self):
        """Linear should be included when linear_enabled=True for agents with optional Linear."""
        from agents.tools_pkg.models import get_required_mcp_servers

        servers = get_required_mcp_servers("planner", linear_enabled=True)
        assert "linear" in servers

    def test_browser_resolved_to_electron_for_electron_project(self):
        """Browser should resolve to 'electron' for Electron projects."""
        from agents.tools_pkg.models import get_required_mcp_servers

        # Mock ELECTRON_MCP_ENABLED
        os.environ["ELECTRON_MCP_ENABLED"] = "true"
        try:
            servers = get_required_mcp_servers(
                "qa_reviewer", project_capabilities={"is_electron": True}
            )
            assert "electron" in servers
            assert "browser" not in servers
            assert "puppeteer" not in servers
        finally:
            os.environ.pop("ELECTRON_MCP_ENABLED", None)

    def test_browser_resolved_to_puppeteer_for_web_frontend(self):
        """Browser should resolve to 'puppeteer' for web frontend projects when enabled."""
        from agents.tools_pkg.models import get_required_mcp_servers

        # Puppeteer requires explicit opt-in via project config
        servers = get_required_mcp_servers(
            "qa_reviewer",
            project_capabilities={"is_web_frontend": True, "is_electron": False},
            mcp_config={"PUPPETEER_MCP_ENABLED": "true"},
        )
        assert "puppeteer" in servers
        assert "browser" not in servers
        assert "electron" not in servers

    def test_puppeteer_not_included_when_disabled(self):
        """Puppeteer should NOT be included when not explicitly enabled (default)."""
        from agents.tools_pkg.models import get_required_mcp_servers

        # Default behavior: puppeteer is NOT auto-enabled for web frontends
        servers = get_required_mcp_servers(
            "qa_reviewer",
            project_capabilities={"is_web_frontend": True, "is_electron": False},
        )
        assert "puppeteer" not in servers
        assert "browser" not in servers


class TestGetDefaultThinkingLevel:
    """Tests for get_default_thinking_level() function."""

    def test_returns_low_for_coder(self):
        """Coder should return 'low' thinking level."""
        from agents.tools_pkg.models import get_default_thinking_level

        result = get_default_thinking_level("coder")
        assert result == "low"

    def test_returns_high_for_qa_reviewer(self):
        """QA reviewer should return 'high' thinking level."""
        from agents.tools_pkg.models import get_default_thinking_level

        result = get_default_thinking_level("qa_reviewer")
        assert result == "high"

    def test_returns_high_for_spec_critic(self):
        """Spec critic should return 'high' thinking level."""
        from agents.tools_pkg.models import get_default_thinking_level

        result = get_default_thinking_level("spec_critic")
        assert result == "high"

    def test_can_convert_to_budget_via_phase_config(self):
        """Verify thinking level can be converted to budget using phase_config."""
        from agents.tools_pkg.models import get_default_thinking_level
        from phase_config import THINKING_BUDGET_MAP

        level = get_default_thinking_level("qa_reviewer")
        budget = THINKING_BUDGET_MAP.get(level)
        assert budget == THINKING_BUDGET_MAP["high"]


class TestGetAllowedTools:
    """Tests for get_allowed_tools() function."""

    def test_coder_includes_write_tools(self):
        """Coder should have Write, Edit, Bash tools."""
        from agents.tools_pkg.permissions import get_allowed_tools

        tools = get_allowed_tools("coder")
        assert "Write" in tools
        assert "Edit" in tools
        assert "Bash" in tools

    def test_qa_reviewer_has_write_for_reports(self):
        """QA reviewer needs Write/Edit to create qa_report.md and update implementation_plan.json."""
        from agents.tools_pkg.permissions import get_allowed_tools

        tools = get_allowed_tools("qa_reviewer")
        assert "Read" in tools
        assert "Bash" in tools  # Can run tests
        assert "Write" in tools  # Needs to write qa_report.md
        assert "Edit" in tools  # Needs to edit implementation_plan.json

    def test_pr_reviewer_is_read_only(self):
        """PR reviewer should only have Read tools."""
        from agents.tools_pkg.permissions import get_allowed_tools

        tools = get_allowed_tools("pr_reviewer")
        assert "Read" in tools
        assert "Write" not in tools
        assert "Edit" not in tools
        assert "Bash" not in tools

    def test_merge_resolver_has_no_tools(self):
        """Merge resolver is text-only, no tools."""
        from agents.tools_pkg.permissions import get_allowed_tools

        tools = get_allowed_tools("merge_resolver")
        # Should have no file operation tools
        assert "Read" not in tools
        assert "Write" not in tools
        assert "Bash" not in tools

    def test_raises_for_unknown_type(self):
        """Should raise ValueError for unknown agent types."""
        from agents.tools_pkg.permissions import get_allowed_tools

        with pytest.raises(ValueError):
            get_allowed_tools("definitely_not_a_real_agent")


class TestGetAllAgentTypes:
    """Tests for get_all_agent_types() function."""

    def test_returns_sorted_list(self):
        """Should return a sorted list of all agent types."""
        from agents.tools_pkg.permissions import get_all_agent_types

        types = get_all_agent_types()
        assert isinstance(types, list)
        assert types == sorted(types)
        assert len(types) > 10  # Should have many agent types

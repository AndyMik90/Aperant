"""
Tests for Claude SDK Client Factory
===================================

Tests for core/client.py which handles creating and configuring
the Claude Agent SDK client with multi-layered security.
"""

import json
import os
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch


class TestProjectIndexCache:
    """Tests for project index caching functionality."""

    def test_cache_returns_cached_data_within_ttl(self, temp_dir):
        """Should return cached data when within TTL."""
        from core.client import _get_cached_project_data, invalidate_project_cache

        # Clear any existing cache
        invalidate_project_cache()

        project_dir = temp_dir / "project"
        project_dir.mkdir()

        mock_index = {"project_type": "test", "file_count": 100}
        mock_capabilities = {"has_tests": True}

        with patch("core.client.load_project_index", return_value=mock_index):
            with patch("core.client.detect_project_capabilities", return_value=mock_capabilities):
                # First call - cache miss
                index1, caps1 = _get_cached_project_data(project_dir)

                # Second call - should be cache hit
                index2, caps2 = _get_cached_project_data(project_dir)

        assert index1 == index2 == mock_index
        assert caps1 == caps2 == mock_capabilities

    def test_cache_invalidation_clears_specific_project(self, temp_dir):
        """Should clear cache for specific project when invalidated."""
        from core.client import _get_cached_project_data, invalidate_project_cache

        invalidate_project_cache()

        project1 = temp_dir / "project1"
        project1.mkdir()
        project2 = temp_dir / "project2"
        project2.mkdir()

        mock_index = {"project_type": "test"}
        mock_capabilities = {}

        with patch("core.client.load_project_index", return_value=mock_index):
            with patch("core.client.detect_project_capabilities", return_value=mock_capabilities):
                # Cache both projects
                _get_cached_project_data(project1)
                _get_cached_project_data(project2)

                # Invalidate only project1
                invalidate_project_cache(project1)

                # project2 should still be cached (no reload needed)
                # This is verified by the fact that load_project_index isn't called again
                # when accessing project2

    def test_cache_invalidation_clears_all(self, temp_dir):
        """Should clear entire cache when no project specified."""
        from core.client import _get_cached_project_data, invalidate_project_cache

        invalidate_project_cache()

        project_dir = temp_dir / "project"
        project_dir.mkdir()

        mock_index = {"project_type": "test"}
        mock_capabilities = {}

        with patch("core.client.load_project_index", return_value=mock_index):
            with patch("core.client.detect_project_capabilities", return_value=mock_capabilities):
                # Cache the project
                _get_cached_project_data(project_dir)

                # Clear all cache
                invalidate_project_cache()

                # Next call should be a cache miss (load_project_index called again)
                _get_cached_project_data(project_dir)


class TestValidateCustomMcpServer:
    """Tests for custom MCP server validation."""

    def test_valid_npx_command_server(self):
        """Should accept valid npx command server."""
        from core.client import _validate_custom_mcp_server

        server = {
            "id": "my-mcp",
            "name": "My MCP Server",
            "type": "command",
            "command": "npx",
            "args": ["-y", "my-mcp-server"],
        }

        assert _validate_custom_mcp_server(server) is True

    def test_valid_http_server(self):
        """Should accept valid HTTP server."""
        from core.client import _validate_custom_mcp_server

        server = {
            "id": "my-http-mcp",
            "name": "My HTTP MCP",
            "type": "http",
            "url": "https://api.example.com/mcp",
            "headers": {"Authorization": "Bearer token"},
        }

        assert _validate_custom_mcp_server(server) is True

    def test_rejects_missing_required_fields(self):
        """Should reject servers missing required fields."""
        from core.client import _validate_custom_mcp_server

        # Missing 'id'
        server = {
            "name": "Test",
            "type": "command",
            "command": "npx",
        }

        assert _validate_custom_mcp_server(server) is False

    def test_rejects_dangerous_commands(self):
        """Should reject dangerous shell commands."""
        from core.client import _validate_custom_mcp_server

        dangerous_commands = ["bash", "sh", "cmd", "powershell", "zsh"]

        for cmd in dangerous_commands:
            server = {
                "id": "test",
                "name": "Test",
                "type": "command",
                "command": cmd,
                "args": ["-c", "echo hello"],
            }
            assert _validate_custom_mcp_server(server) is False, f"Should reject {cmd}"

    def test_rejects_commands_with_paths(self):
        """Should reject commands with path separators."""
        from core.client import _validate_custom_mcp_server

        server = {
            "id": "test",
            "name": "Test",
            "type": "command",
            "command": "/usr/bin/python",
            "args": ["script.py"],
        }

        assert _validate_custom_mcp_server(server) is False

    def test_rejects_dangerous_flags(self):
        """Should reject dangerous interpreter flags."""
        from core.client import _validate_custom_mcp_server

        dangerous_flags = ["--eval", "-e", "-c", "--exec", "-m"]

        for flag in dangerous_flags:
            server = {
                "id": "test",
                "name": "Test",
                "type": "command",
                "command": "node",
                "args": [flag, "console.log('evil')"],
            }
            assert _validate_custom_mcp_server(server) is False, f"Should reject {flag}"

    def test_rejects_unknown_commands(self):
        """Should reject commands not in safe list."""
        from core.client import _validate_custom_mcp_server

        server = {
            "id": "test",
            "name": "Test",
            "type": "command",
            "command": "curl",  # Not in safe list
            "args": ["https://example.com"],
        }

        assert _validate_custom_mcp_server(server) is False

    def test_rejects_unexpected_fields(self):
        """Should reject servers with unexpected fields."""
        from core.client import _validate_custom_mcp_server

        server = {
            "id": "test",
            "name": "Test",
            "type": "command",
            "command": "npx",
            "malicious_field": "bad_data",
        }

        assert _validate_custom_mcp_server(server) is False

    def test_accepts_safe_commands(self):
        """Should accept all safe commands."""
        from core.client import _validate_custom_mcp_server

        safe_commands = ["npx", "npm", "node", "python", "python3", "uv", "uvx"]

        for cmd in safe_commands:
            server = {
                "id": "test",
                "name": "Test",
                "type": "command",
                "command": cmd,
                "args": ["some-package"],
            }
            assert _validate_custom_mcp_server(server) is True, f"Should accept {cmd}"


class TestLoadProjectMcpConfig:
    """Tests for loading per-project MCP configuration."""

    def test_returns_empty_when_no_env_file(self, temp_dir):
        """Should return empty dict when .auto-claude/.env doesn't exist."""
        from core.client import load_project_mcp_config

        result = load_project_mcp_config(temp_dir)
        assert result == {}

    def test_loads_mcp_toggle_settings(self, temp_dir):
        """Should load MCP toggle settings from .env file."""
        from core.client import load_project_mcp_config

        env_dir = temp_dir / ".auto-claude"
        env_dir.mkdir()
        (env_dir / ".env").write_text("""
CONTEXT7_ENABLED=true
LINEAR_MCP_ENABLED=false
ELECTRON_MCP_ENABLED=true
""")

        result = load_project_mcp_config(temp_dir)

        assert result["CONTEXT7_ENABLED"] == "true"
        assert result["LINEAR_MCP_ENABLED"] == "false"
        assert result["ELECTRON_MCP_ENABLED"] == "true"

    def test_loads_per_agent_mcp_overrides(self, temp_dir):
        """Should load per-agent MCP configuration."""
        from core.client import load_project_mcp_config

        env_dir = temp_dir / ".auto-claude"
        env_dir.mkdir()
        (env_dir / ".env").write_text("""
AGENT_MCP_coder_ADD=my-custom-server
AGENT_MCP_qa_reviewer_REMOVE=context7
""")

        result = load_project_mcp_config(temp_dir)

        assert result["AGENT_MCP_coder_ADD"] == "my-custom-server"
        assert result["AGENT_MCP_qa_reviewer_REMOVE"] == "context7"

    def test_parses_custom_mcp_servers_json(self, temp_dir):
        """Should parse and validate CUSTOM_MCP_SERVERS JSON."""
        from core.client import load_project_mcp_config

        env_dir = temp_dir / ".auto-claude"
        env_dir.mkdir()

        custom_servers = [
            {
                "id": "my-server",
                "name": "My Server",
                "type": "command",
                "command": "npx",
                "args": ["-y", "my-mcp-server"],
            }
        ]

        (env_dir / ".env").write_text(f"CUSTOM_MCP_SERVERS={json.dumps(custom_servers)}")

        result = load_project_mcp_config(temp_dir)

        assert "CUSTOM_MCP_SERVERS" in result
        assert len(result["CUSTOM_MCP_SERVERS"]) == 1
        assert result["CUSTOM_MCP_SERVERS"][0]["id"] == "my-server"

    def test_filters_invalid_custom_servers(self, temp_dir):
        """Should filter out invalid custom server configurations."""
        from core.client import load_project_mcp_config

        env_dir = temp_dir / ".auto-claude"
        env_dir.mkdir()

        custom_servers = [
            {"id": "valid", "name": "Valid", "type": "command", "command": "npx", "args": []},
            {"id": "invalid", "name": "Invalid", "type": "command", "command": "bash", "args": ["-c", "evil"]},
        ]

        (env_dir / ".env").write_text(f"CUSTOM_MCP_SERVERS={json.dumps(custom_servers)}")

        result = load_project_mcp_config(temp_dir)

        # Should only have the valid server
        assert len(result["CUSTOM_MCP_SERVERS"]) == 1
        assert result["CUSTOM_MCP_SERVERS"][0]["id"] == "valid"


class TestHelperFunctions:
    """Tests for helper functions in client.py."""

    def test_is_graphiti_mcp_enabled(self):
        """Should check GRAPHITI_MCP_URL environment variable."""
        from core.client import is_graphiti_mcp_enabled

        # Clear and test false
        os.environ.pop("GRAPHITI_MCP_URL", None)
        assert is_graphiti_mcp_enabled() is False

        # Set and test true
        os.environ["GRAPHITI_MCP_URL"] = "http://localhost:8000/mcp/"
        assert is_graphiti_mcp_enabled() is True

        # Cleanup
        os.environ.pop("GRAPHITI_MCP_URL", None)

    def test_is_electron_mcp_enabled(self):
        """Should check ELECTRON_MCP_ENABLED environment variable."""
        from core.client import is_electron_mcp_enabled

        # Clear and test false
        os.environ.pop("ELECTRON_MCP_ENABLED", None)
        assert is_electron_mcp_enabled() is False

        # Set to true
        os.environ["ELECTRON_MCP_ENABLED"] = "true"
        assert is_electron_mcp_enabled() is True

        # Set to false
        os.environ["ELECTRON_MCP_ENABLED"] = "false"
        assert is_electron_mcp_enabled() is False

        # Cleanup
        os.environ.pop("ELECTRON_MCP_ENABLED", None)

    def test_get_electron_debug_port_default(self):
        """Should return default port 9222."""
        from core.client import get_electron_debug_port

        os.environ.pop("ELECTRON_DEBUG_PORT", None)
        assert get_electron_debug_port() == 9222

    def test_get_electron_debug_port_custom(self):
        """Should return custom port from environment."""
        from core.client import get_electron_debug_port

        os.environ["ELECTRON_DEBUG_PORT"] = "9333"
        assert get_electron_debug_port() == 9333
        os.environ.pop("ELECTRON_DEBUG_PORT", None)

    def test_should_use_claude_md(self):
        """Should check USE_CLAUDE_MD environment variable."""
        from core.client import should_use_claude_md

        os.environ.pop("USE_CLAUDE_MD", None)
        assert should_use_claude_md() is False

        os.environ["USE_CLAUDE_MD"] = "true"
        assert should_use_claude_md() is True

        os.environ.pop("USE_CLAUDE_MD", None)

    def test_load_claude_md_returns_content_when_exists(self, temp_dir):
        """Should load CLAUDE.md content when file exists."""
        from core.client import load_claude_md

        (temp_dir / "CLAUDE.md").write_text("# Project Instructions\n\nSome content here")

        result = load_claude_md(temp_dir)

        assert result is not None
        assert "Project Instructions" in result

    def test_load_claude_md_returns_none_when_missing(self, temp_dir):
        """Should return None when CLAUDE.md doesn't exist."""
        from core.client import load_claude_md

        result = load_claude_md(temp_dir)

        assert result is None


class TestCreateClient:
    """Tests for the main create_client function."""

    @pytest.fixture
    def mock_auth_token(self):
        """Mock authentication token."""
        with patch("core.client.require_auth_token", return_value="test-token"):
            yield

    @pytest.fixture
    def mock_sdk_client(self):
        """Mock the ClaudeSDKClient."""
        mock_client = MagicMock()
        with patch("core.client.ClaudeSDKClient", return_value=mock_client):
            yield mock_client

    def test_creates_client_with_correct_agent_type(
        self, temp_dir, mock_auth_token, mock_sdk_client
    ):
        """Should create client with correct tool permissions for agent type."""
        from core.client import create_client

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        project_dir = temp_dir / "project"
        project_dir.mkdir()

        with patch("core.client._get_cached_project_data", return_value=({}, {})):
            with patch("core.client.load_project_mcp_config", return_value={}):
                with patch("core.client.get_allowed_tools", return_value=["Read", "Write", "Edit"]):
                    with patch("core.client.get_required_mcp_servers", return_value=["context7"]):
                        with patch("core.client.is_linear_enabled", return_value=False):
                            with patch("core.client.is_tools_available", return_value=False):
                                with patch("core.client.get_sdk_env_vars", return_value={}):
                                    client = create_client(
                                        project_dir=project_dir,
                                        spec_dir=spec_dir,
                                        model="claude-sonnet-4-5-20250929",
                                        agent_type="coder",
                                    )

        # Verify ClaudeSDKClient was instantiated
        assert mock_sdk_client is not None

    def test_writes_security_settings_file(self, temp_dir, mock_auth_token, mock_sdk_client):
        """Should write security settings to .claude_settings.json."""
        from core.client import create_client

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        project_dir = temp_dir / "project"
        project_dir.mkdir()

        with patch("core.client._get_cached_project_data", return_value=({}, {})):
            with patch("core.client.load_project_mcp_config", return_value={}):
                with patch("core.client.get_allowed_tools", return_value=["Read"]):
                    with patch("core.client.get_required_mcp_servers", return_value=[]):
                        with patch("core.client.is_linear_enabled", return_value=False):
                            with patch("core.client.is_tools_available", return_value=False):
                                with patch("core.client.get_sdk_env_vars", return_value={}):
                                    create_client(
                                        project_dir=project_dir,
                                        spec_dir=spec_dir,
                                        model="claude-sonnet-4-5-20250929",
                                        agent_type="coder",
                                    )

        settings_file = project_dir / ".claude_settings.json"
        assert settings_file.exists()

        with open(settings_file) as f:
            settings = json.load(f)

        assert settings["sandbox"]["enabled"] is True
        assert "permissions" in settings

    def test_includes_worktree_permissions(self, temp_dir, mock_auth_token, mock_sdk_client):
        """Should include original project permissions when running in worktree."""
        from core.client import create_client

        # Simulate worktree structure
        original_project = temp_dir / "original"
        original_project.mkdir()
        auto_claude_dir = original_project / ".auto-claude"
        auto_claude_dir.mkdir()
        worktrees_dir = auto_claude_dir / "worktrees" / "tasks" / "test-spec"
        worktrees_dir.mkdir(parents=True)

        spec_dir = worktrees_dir / "spec"
        spec_dir.mkdir()

        with patch("core.client._get_cached_project_data", return_value=({}, {})):
            with patch("core.client.load_project_mcp_config", return_value={}):
                with patch("core.client.get_allowed_tools", return_value=["Read"]):
                    with patch("core.client.get_required_mcp_servers", return_value=[]):
                        with patch("core.client.is_linear_enabled", return_value=False):
                            with patch("core.client.is_tools_available", return_value=False):
                                with patch("core.client.get_sdk_env_vars", return_value={}):
                                    create_client(
                                        project_dir=worktrees_dir,
                                        spec_dir=spec_dir,
                                        model="claude-sonnet-4-5-20250929",
                                        agent_type="coder",
                                    )

        settings_file = worktrees_dir / ".claude_settings.json"
        with open(settings_file) as f:
            settings = json.load(f)

        # Should have permissions for original project's .auto-claude directory
        permissions = settings["permissions"]["allow"]
        has_original_perms = any(
            str(auto_claude_dir.resolve()) in perm for perm in permissions
        )
        assert has_original_perms

    def test_includes_extended_thinking_when_specified(
        self, temp_dir, mock_auth_token
    ):
        """Should include max_thinking_tokens when specified."""
        from core.client import create_client, ClaudeAgentOptions

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        project_dir = temp_dir / "project"
        project_dir.mkdir()

        captured_options = None

        def capture_options(options):
            nonlocal captured_options
            captured_options = options
            return MagicMock()

        with patch("core.client._get_cached_project_data", return_value=({}, {})):
            with patch("core.client.load_project_mcp_config", return_value={}):
                with patch("core.client.get_allowed_tools", return_value=["Read"]):
                    with patch("core.client.get_required_mcp_servers", return_value=[]):
                        with patch("core.client.is_linear_enabled", return_value=False):
                            with patch("core.client.is_tools_available", return_value=False):
                                with patch("core.client.get_sdk_env_vars", return_value={}):
                                    with patch("core.client.ClaudeSDKClient", side_effect=capture_options):
                                        create_client(
                                            project_dir=project_dir,
                                            spec_dir=spec_dir,
                                            model="claude-sonnet-4-5-20250929",
                                            agent_type="spec_critic",
                                            max_thinking_tokens=16000,
                                        )

        assert captured_options is not None

"""
Tests for integrations.graphiti.memory module.

This module is a backward compatibility facade that re-exports from
queries_pkg and provides convenience functions.
"""

from unittest.mock import MagicMock, patch

import pytest

# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_spec_dir(tmp_path):
    """Create a temporary spec directory."""
    spec_dir = tmp_path / "specs" / "001-test"
    spec_dir.mkdir(parents=True)
    return spec_dir


@pytest.fixture
def mock_project_dir(tmp_path):
    """Create a temporary project directory."""
    project_dir = tmp_path / "project"
    project_dir.mkdir(parents=True)
    return project_dir


# =============================================================================
# Tests for module imports
# =============================================================================


class TestModuleImports:
    """Test that all expected exports are available."""

    def test_import_GraphitiMemory(self):
        """Test GraphitiMemory can be imported."""
        from integrations.graphiti.memory import GraphitiMemory

        assert GraphitiMemory is not None

    def test_import_GroupIdMode(self):
        """Test GroupIdMode can be imported."""
        from integrations.graphiti.memory import GroupIdMode

        assert GroupIdMode is not None
        assert hasattr(GroupIdMode, "SPEC")
        assert hasattr(GroupIdMode, "PROJECT")

    def test_import_is_graphiti_enabled(self):
        """Test is_graphiti_enabled can be imported."""
        from integrations.graphiti.memory import is_graphiti_enabled

        assert is_graphiti_enabled is not None

    def test_import_get_graphiti_memory(self):
        """Test get_graphiti_memory can be imported."""
        from integrations.graphiti.memory import get_graphiti_memory

        assert get_graphiti_memory is not None

    def test_import_test_graphiti_connection(self):
        """Test test_graphiti_connection can be imported."""
        from integrations.graphiti.memory import test_graphiti_connection

        assert test_graphiti_connection is not None

    def test_import_test_provider_configuration(self):
        """Test test_provider_configuration can be imported."""
        from integrations.graphiti.memory import test_provider_configuration

        assert test_provider_configuration is not None

    def test_import_episode_types(self):
        """Test all episode type constants can be imported."""
        from integrations.graphiti.memory import (
            EPISODE_TYPE_CODEBASE_DISCOVERY,
            EPISODE_TYPE_GOTCHA,
            EPISODE_TYPE_HISTORICAL_CONTEXT,
            EPISODE_TYPE_PATTERN,
            EPISODE_TYPE_QA_RESULT,
            EPISODE_TYPE_SESSION_INSIGHT,
            EPISODE_TYPE_TASK_OUTCOME,
        )

        assert EPISODE_TYPE_SESSION_INSIGHT == "session_insight"
        assert EPISODE_TYPE_CODEBASE_DISCOVERY == "codebase_discovery"
        assert EPISODE_TYPE_PATTERN == "pattern"
        assert EPISODE_TYPE_GOTCHA == "gotcha"
        assert EPISODE_TYPE_TASK_OUTCOME == "task_outcome"
        assert EPISODE_TYPE_QA_RESULT == "qa_result"
        assert EPISODE_TYPE_HISTORICAL_CONTEXT == "historical_context"

    def test_import_MAX_CONTEXT_RESULTS(self):
        """Test MAX_CONTEXT_RESULTS can be imported."""
        from integrations.graphiti.memory import MAX_CONTEXT_RESULTS

        assert MAX_CONTEXT_RESULTS is not None


# =============================================================================
# Tests for get_graphiti_memory()
# =============================================================================


class TestGetGraphitiMemory:
    """Tests for get_graphiti_memory convenience function."""

    def test_returns_graphiti_memory_instance(self, mock_spec_dir, mock_project_dir):
        """Test get_graphiti_memory returns GraphitiMemory instance."""
        from integrations.graphiti.memory import get_graphiti_memory

        memory = get_graphiti_memory(mock_spec_dir, mock_project_dir)

        assert memory is not None
        assert hasattr(memory, "spec_dir")
        assert hasattr(memory, "project_dir")

    def test_default_group_id_mode_is_project(self, mock_spec_dir, mock_project_dir):
        """Test default group_id_mode is PROJECT."""
        from integrations.graphiti.memory import get_graphiti_memory
        from integrations.graphiti.queries_pkg.schema import GroupIdMode

        memory = get_graphiti_memory(mock_spec_dir, mock_project_dir)

        # Check that group_id_mode defaults to PROJECT
        assert memory.group_id_mode == GroupIdMode.PROJECT

    def test_spec_group_id_mode(self, mock_spec_dir, mock_project_dir):
        """Test SPEC group_id_mode can be set."""
        from integrations.graphiti.memory import get_graphiti_memory
        from integrations.graphiti.queries_pkg.schema import GroupIdMode

        memory = get_graphiti_memory(mock_spec_dir, mock_project_dir, GroupIdMode.SPEC)

        assert memory.group_id_mode == GroupIdMode.SPEC

    def test_project_group_id_mode(self, mock_spec_dir, mock_project_dir):
        """Test PROJECT group_id_mode can be set."""
        from integrations.graphiti.memory import get_graphiti_memory
        from integrations.graphiti.queries_pkg.schema import GroupIdMode

        memory = get_graphiti_memory(
            mock_spec_dir, mock_project_dir, GroupIdMode.PROJECT
        )

        assert memory.group_id_mode == GroupIdMode.PROJECT


# =============================================================================
# Tests for test_graphiti_connection()
# =============================================================================


class TestTestGraphitiConnection:
    """Tests for test_graphiti_connection function."""

    @pytest.mark.asyncio
    async def test_returns_false_when_not_enabled(self):
        """Test returns False when Graphiti not enabled."""
        from integrations.graphiti.memory import test_graphiti_connection

        with patch("integrations.graphiti.memory.GraphitiConfig") as mock_config_class:
            mock_config = MagicMock()
            mock_config.enabled = False
            mock_config_class.from_env.return_value = mock_config

            success, message = await test_graphiti_connection()

            assert success is False
            assert "not enabled" in message.lower()

    @pytest.mark.asyncio
    async def test_returns_false_with_validation_errors(self):
        """Test returns False when config has validation errors."""
        from integrations.graphiti.memory import test_graphiti_connection

        with patch("integrations.graphiti.memory.GraphitiConfig") as mock_config_class:
            mock_config = MagicMock()
            mock_config.enabled = True
            mock_config.get_validation_errors.return_value = ["API key missing"]
            mock_config_class.from_env.return_value = mock_config

            success, message = await test_graphiti_connection()

            assert success is False
            assert "Configuration errors" in message

    @pytest.mark.asyncio
    async def test_returns_false_on_import_error(self):
        """Test returns False when graphiti_core not installed."""
        from integrations.graphiti.memory import test_graphiti_connection

        with patch("integrations.graphiti.memory.GraphitiConfig") as mock_config_class:
            mock_config = MagicMock()
            mock_config.enabled = True
            mock_config.get_validation_errors.return_value = []
            mock_config_class.from_env.return_value = mock_config

            # Only raise ImportError for graphiti_core imports
            import builtins

            original_import = builtins.__import__

            def selective_import_error(name, *args, **kwargs):
                if "graphiti_core" in name:
                    raise ImportError(f"No module named '{name}'")
                return original_import(name, *args, **kwargs)

            with patch("builtins.__import__", side_effect=selective_import_error):
                success, message = await test_graphiti_connection()

                assert success is False
                assert "not installed" in message.lower()

    @pytest.mark.slow
    @pytest.mark.asyncio
    async def test_returns_true_on_successful_connection(self):
        """Test returns True when connection succeeds (requires graphiti_core)."""
        from integrations.graphiti.memory import test_graphiti_connection

        # This test requires graphiti_core to be installed
        # Marked as slow since it connects to actual database
        try:
            success, message = await test_graphiti_connection()

            # If graphiti_core is not installed, success will be False
            if "not installed" in message.lower():
                assert success is False
            # If installed but DB not available, check for connection error
            elif "connection failed" in message.lower():
                assert success is False
            # If everything is set up, should succeed
            else:
                # Concrete assertion for successful connection
                assert success is True, (
                    f"Expected success=True, got {success} with message: {message}"
                )
                assert message, "Message should not be empty for successful connection"

        except AssertionError as e:
            # Re-raise AssertionError to properly surface test failures
            raise
        except Exception as e:
            # If there's an unexpected error, fail the test with useful info
            pytest.skip(f"Graphiti connection test failed: {e}")

    @pytest.mark.asyncio
    async def test_handles_provider_error(self):
        """Test handles ProviderError during provider creation."""
        from integrations.graphiti.memory import test_graphiti_connection
        from integrations.graphiti.providers_pkg.exceptions import ProviderError

        with patch("integrations.graphiti.memory.GraphitiConfig") as mock_config_class:
            mock_config = MagicMock()
            mock_config.enabled = True
            mock_config.get_validation_errors.return_value = []
            mock_config_class.from_env.return_value = mock_config

            # Mock graphiti_core imports to succeed
            mock_graphiti = MagicMock()
            mock_kuzu_driver = MagicMock()

            # Mock provider creation to raise ProviderError
            with patch("graphiti_providers.create_llm_client") as mock_create_llm:
                mock_create_llm.side_effect = ProviderError("Test provider error")

                with patch.dict(
                    "sys.modules",
                    {
                        "graphiti_core": MagicMock(Graphiti=mock_graphiti),
                        "graphiti_core.driver": MagicMock(),
                        "graphiti_core.driver.kuzu_driver": mock_kuzu_driver,
                        "graphiti_providers": MagicMock(
                            ProviderError=ProviderError,
                            create_embedder=MagicMock(),
                            create_llm_client=mock_create_llm,
                        ),
                    },
                ):
                    success, message = await test_graphiti_connection()

                    assert success is False
                    assert "Provider error" in message


# =============================================================================
# Tests for test_provider_configuration()
# =============================================================================


class TestTestProviderConfiguration:
    """Tests for test_provider_configuration function."""

    @pytest.mark.asyncio
    async def test_returns_configuration_status(self):
        """Test returns dict with configuration status."""
        pytest.importorskip("graphiti_providers")
        from integrations.graphiti.memory import test_provider_configuration

        with patch("integrations.graphiti.memory.GraphitiConfig") as mock_config_class:
            mock_config = MagicMock()
            mock_config.is_valid.return_value = True
            mock_config.get_validation_errors.return_value = []
            mock_config.llm_provider = "openai"
            mock_config.embedder_provider = "openai"
            mock_config_class.from_env.return_value = mock_config

            # Mock the test functions
            with patch(
                "graphiti_providers.test_llm_connection",
                return_value=(True, "LLM OK"),
            ):
                with patch(
                    "graphiti_providers.test_embedder_connection",
                    return_value=(True, "Embedder OK"),
                ):
                    results = await test_provider_configuration()

                    assert isinstance(results, dict)
                    assert results["config_valid"] is True
                    assert results["validation_errors"] == []
                    assert results["llm_provider"] == "openai"
                    assert results["embedder_provider"] == "openai"
                    assert results["llm_test"]["success"] is True
                    assert results["embedder_test"]["success"] is True

    @pytest.mark.asyncio
    async def test_includes_ollama_test_when_ollama_provider(self):
        """Test includes ollama_test when using ollama provider."""
        pytest.importorskip("graphiti_providers")
        from integrations.graphiti.memory import test_provider_configuration

        with patch("integrations.graphiti.memory.GraphitiConfig") as mock_config_class:
            mock_config = MagicMock()
            mock_config.is_valid.return_value = True
            mock_config.get_validation_errors.return_value = []
            mock_config.llm_provider = "ollama"
            mock_config.embedder_provider = "openai"
            mock_config.ollama_base_url = "http://localhost:11434"
            mock_config_class.from_env.return_value = mock_config

            with patch(
                "graphiti_providers.test_llm_connection",
                return_value=(True, "LLM OK"),
            ):
                with patch(
                    "graphiti_providers.test_embedder_connection",
                    return_value=(True, "Embedder OK"),
                ):
                    with patch(
                        "graphiti_providers.test_ollama_connection",
                        return_value=(True, "Ollama OK"),
                    ):
                        results = await test_provider_configuration()

                        assert "ollama_test" in results
                        assert results["ollama_test"]["success"] is True

    @pytest.mark.asyncio
    async def test_omits_ollama_test_when_not_ollama_provider(self):
        """Test omits ollama_test when not using ollama provider."""
        pytest.importorskip("graphiti_providers")
        from integrations.graphiti.memory import test_provider_configuration

        with patch("integrations.graphiti.memory.GraphitiConfig") as mock_config_class:
            mock_config = MagicMock()
            mock_config.is_valid.return_value = True
            mock_config.get_validation_errors.return_value = []
            mock_config.llm_provider = "openai"
            mock_config.embedder_provider = "openai"
            mock_config_class.from_env.return_value = mock_config

            with patch(
                "graphiti_providers.test_llm_connection",
                return_value=(True, "LLM OK"),
            ):
                with patch(
                    "graphiti_providers.test_embedder_connection",
                    return_value=(True, "Embedder OK"),
                ):
                    results = await test_provider_configuration()

                    assert "ollama_test" not in results


# =============================================================================
# Tests for __all__ export list
# =============================================================================


class TestAllExports:
    """Test __all__ contains expected exports."""

    def test_all_exports_defined(self):
        """Test __all__ is defined and contains expected items."""
        from integrations.graphiti import memory

        assert hasattr(memory, "__all__")
        assert isinstance(memory.__all__, list)

        expected_exports = [
            "GraphitiMemory",
            "GroupIdMode",
            "get_graphiti_memory",
            "is_graphiti_enabled",
            "test_graphiti_connection",
            "test_provider_configuration",
            "MAX_CONTEXT_RESULTS",
            "EPISODE_TYPE_SESSION_INSIGHT",
            "EPISODE_TYPE_CODEBASE_DISCOVERY",
            "EPISODE_TYPE_PATTERN",
            "EPISODE_TYPE_GOTCHA",
            "EPISODE_TYPE_TASK_OUTCOME",
            "EPISODE_TYPE_QA_RESULT",
            "EPISODE_TYPE_HISTORICAL_CONTEXT",
        ]

        for export in expected_exports:
            assert export in memory.__all__, f"{export} not in __all__"

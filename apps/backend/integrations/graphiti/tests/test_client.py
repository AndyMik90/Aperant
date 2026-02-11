"""
Unit tests for integrations.graphiti.queries_pkg.client module.

Tests for:
- _apply_ladybug_monkeypatch() function
- GraphitiClient class

Note: These tests use extensive mocking to avoid requiring graphiti_core,
real_ladybug, or other heavy dependencies to be installed.
"""

import builtins
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from integrations.graphiti.queries_pkg.client import (
    GraphitiClient,
    _apply_ladybug_monkeypatch,
)


@pytest.fixture(autouse=True)
def clean_modules():
    """Clean up sys.modules before and after each test."""
    # Store original modules
    original_modules = {
        "graphiti_core": sys.modules.get("graphiti_core"),
        "integrations.graphiti.queries_pkg.kuzu_driver_patched": sys.modules.get(
            "integrations.graphiti.queries_pkg.kuzu_driver_patched"
        ),
        "kuzu": sys.modules.get("kuzu"),
    }

    # Remove modules before test
    for mod in [
        "graphiti_core",
        "integrations.graphiti.queries_pkg.kuzu_driver_patched",
        "kuzu",
    ]:
        sys.modules.pop(mod, None)

    yield

    # Clean up after test
    for mod in [
        "graphiti_core",
        "integrations.graphiti.queries_pkg.kuzu_driver_patched",
        "kuzu",
    ]:
        sys.modules.pop(mod, None)

    # Restore original modules if they existed
    for mod, original in original_modules.items():
        if original is not None:
            sys.modules[mod] = original


@pytest.fixture
def graphiti_mocks():
    """Set up common graphiti mocks for GraphitiClient initialization tests.

    This fixture handles sys.modules injection and cleanup, eliminating
    the need for try/finally blocks in individual tests.
    """
    mock_llm_client = MagicMock()
    mock_embedder = MagicMock()
    mock_driver = MagicMock()

    # Create mock Graphiti instance
    mock_graphiti_instance = AsyncMock()
    mock_graphiti_instance.build_indices_and_constraints = AsyncMock()
    mock_graphiti_class = MagicMock(return_value=mock_graphiti_instance)

    # Mock graphiti_core module
    mock_graphiti_core = MagicMock()
    mock_graphiti_core.Graphiti = mock_graphiti_class

    # Mock kuzu_driver_patched module
    mock_kuzu_driver_patched = MagicMock()
    mock_kuzu_driver_patched.create_patched_kuzu_driver = MagicMock(
        return_value=mock_driver
    )

    # Inject into sys.modules
    sys.modules["graphiti_core"] = mock_graphiti_core
    sys.modules["integrations.graphiti.queries_pkg.kuzu_driver_patched"] = (
        mock_kuzu_driver_patched
    )

    yield {
        "mock_llm_client": mock_llm_client,
        "mock_embedder": mock_embedder,
        "mock_driver": mock_driver,
        "mock_graphiti_instance": mock_graphiti_instance,
        "mock_graphiti_class": mock_graphiti_class,
        "mock_graphiti_core": mock_graphiti_core,
        "mock_kuzu_driver_patched": mock_kuzu_driver_patched,
    }

    # Cleanup
    sys.modules.pop("graphiti_core", None)
    sys.modules.pop("integrations.graphiti.queries_pkg.kuzu_driver_patched", None)


def _make_mock_config(**kwargs):
    """Create a mock config with sensible defaults for GraphitiClient tests."""
    mock_config = MagicMock()
    mock_config.llm_provider = kwargs.get("llm_provider", "openai")
    mock_config.embedder_provider = kwargs.get("embedder_provider", "openai")
    mock_config.database = kwargs.get("database", "test_db")
    mock_config.get_db_path.return_value = kwargs.get("db_path", Path("/test/db"))
    mock_config.get_provider_summary.return_value = kwargs.get(
        "provider_summary", "LLM: openai, Embedder: openai"
    )
    return mock_config


@pytest.fixture
def isolate_kuzu_module():
    """Isolate sys.modules['kuzu'] for tests that modify it."""
    original_kuzu = sys.modules.pop("kuzu", None)
    yield
    if original_kuzu:
        sys.modules["kuzu"] = original_kuzu
    elif "kuzu" in sys.modules:
        del sys.modules["kuzu"]


# =============================================================================
# Tests for _apply_ladybug_monkeypatch()
# =============================================================================


class TestApplyLadybugMonkeypatch:
    """Tests for the _apply_ladybug_monkeypatch function."""

    def test_returns_true_when_real_ladybug_imports_successfully(
        self, isolate_kuzu_module
    ):
        """Returns True when real_ladybug imports successfully."""
        mock_ladybug = MagicMock()

        # Mock the import statement by patching __import__
        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                return mock_ladybug
            # Fall through to original import for other modules
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch("builtins.__import__", side_effect=import_side_effect):
            assert _apply_ladybug_monkeypatch() is True
            assert sys.modules.get("kuzu") == mock_ladybug

    def test_patches_sys_modules_kuzu_with_real_ladybug(self, isolate_kuzu_module):
        """Patches sys.modules["kuzu"] with real_ladybug."""
        mock_ladybug = MagicMock()

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                return mock_ladybug
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch("builtins.__import__", side_effect=import_side_effect):
            result = _apply_ladybug_monkeypatch()

            # Verify sys.modules["kuzu"] was patched
            assert result is True
            assert sys.modules.get("kuzu") == mock_ladybug

    def test_falls_back_to_native_kuzu_if_real_ladybug_unavailable(
        self, isolate_kuzu_module
    ):
        """Falls back to native kuzu if real_ladybug unavailable."""
        mock_kuzu = MagicMock()

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                raise ImportError("real_ladybug not found")
            elif name == "kuzu":
                # Simulate what real import does - add to sys.modules
                sys.modules["kuzu"] = mock_kuzu
                return mock_kuzu
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch("builtins.__import__", side_effect=import_side_effect):
            result = _apply_ladybug_monkeypatch()

            # Should return True if kuzu is available
            assert result is True
            # When native kuzu is imported, the import statement adds it to sys.modules
            assert sys.modules.get("kuzu") == mock_kuzu

    def test_returns_false_when_neither_available(self, isolate_kuzu_module):
        """Returns False when neither real_ladybug nor kuzu available."""

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                raise ImportError("real_ladybug not found")
            elif name == "kuzu":
                raise ImportError("kuzu not found")
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch("builtins.__import__", side_effect=import_side_effect):
            result = _apply_ladybug_monkeypatch()

            assert result is False

    def test_windows_pywin32_error_handling(self, isolate_kuzu_module):
        """Windows-specific pywin32 error handling."""
        # Create an ImportError with pywin32-related name
        import_error = ImportError("No module named 'pywintypes'")
        import_error.name = "pywintypes"

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                raise import_error
            elif name == "kuzu":
                raise ImportError("kuzu not found")
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch.object(sys, "platform", "win32"):
            with patch.object(sys, "version_info", (3, 12, 0)):
                with patch("builtins.__import__", side_effect=import_side_effect):
                    with patch(
                        "integrations.graphiti.queries_pkg.client.logger"
                    ) as mock_logger:
                        result = _apply_ladybug_monkeypatch()

                        # Should log specific error about pywin32
                        mock_logger.error.assert_called()
                        error_msg = str(mock_logger.error.call_args)
                        assert "pywin32" in error_msg or "pywintypes" in error_msg

    def test_windows_pywin32_error_detected_by_string_match(self, isolate_kuzu_module):
        """Windows pywin32 error detected by string match when name unavailable."""
        # Create ImportError without name attribute (some Python versions)
        import_error = ImportError("DLL load failed while importing pywintypes")

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                raise import_error
            elif name == "kuzu":
                raise ImportError("kuzu not found")
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch.object(sys, "platform", "win32"):
            with patch.object(sys, "version_info", (3, 12, 0)):
                with patch("builtins.__import__", side_effect=import_side_effect):
                    with patch(
                        "integrations.graphiti.queries_pkg.client.logger"
                    ) as mock_logger:
                        result = _apply_ladybug_monkeypatch()

                        # Should detect pywin32 error via string match
                        mock_logger.error.assert_called()
                        error_msg = str(mock_logger.error.call_args)
                        assert "pywin32" in error_msg

    def test_non_windows_pywin32_error_does_not_trigger_special_handling(
        self, isolate_kuzu_module
    ):
        """Non-Windows pywin32-like error doesn't trigger special handling."""
        import_error = ImportError("pywintypes not found")

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                raise import_error
            elif name == "kuzu":
                raise ImportError("kuzu not found")
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch.object(sys, "platform", "linux"):
            with patch("builtins.__import__", side_effect=import_side_effect):
                with patch(
                    "integrations.graphiti.queries_pkg.client.logger"
                ) as mock_logger:
                    result = _apply_ladybug_monkeypatch()

                    # Should use debug, not error (non-Windows)
                    # The function should still log debug, but not error about pywin32
                    assert all(
                        "pywin32" not in str(call)
                        for call in mock_logger.error.call_args_list
                    )

    def test_windows_python_311_does_not_show_pywin32_error(self, isolate_kuzu_module):
        """Windows Python 3.11 doesn't show pywin32-specific error."""
        import_error = ImportError("real_ladybug not found")

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                raise import_error
            elif name == "kuzu":
                raise ImportError("kuzu not found")
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch.object(sys, "platform", "win32"):
            with patch.object(sys, "version_info", (3, 11, 0)):  # Python 3.11
                with patch("builtins.__import__", side_effect=import_side_effect):
                    with patch(
                        "integrations.graphiti.queries_pkg.client.logger"
                    ) as mock_logger:
                        result = _apply_ladybug_monkeypatch()

                        # Should not show pywin32 error for Python 3.11
                        for call in mock_logger.error.call_args_list:
                            assert "pywin32" not in str(call)

    def test_windows_non_pywin32_import_error_logs_debug(self, isolate_kuzu_module):
        """Windows non-pywin32 import error logs debug message."""
        # Import error that doesn't contain 'pywintypes'
        import_error = ImportError("DLL load failed while importing real_ladybug")

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                raise import_error
            elif name == "kuzu":
                raise ImportError("kuzu not found")
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch.object(sys, "platform", "win32"):
            with patch("builtins.__import__", side_effect=import_side_effect):
                with patch(
                    "integrations.graphiti.queries_pkg.client.logger"
                ) as mock_logger:
                    result = _apply_ladybug_monkeypatch()

                    # Should log debug for Windows-specific import issue
                    assert any(
                        "Windows-specific import issue" in str(call)
                        for call in mock_logger.debug.call_args_list
                    )


# =============================================================================
# Tests for GraphitiClient.__init__
# =============================================================================


class TestGraphitiClientInit:
    """Tests for GraphitiClient initialization."""

    def test_sets_config_attribute(self):
        """Sets config attribute."""
        mock_config = MagicMock()

        client = GraphitiClient(mock_config)

        assert client.config is mock_config

    def test_initializes_all_attributes_to_none(self):
        """Initializes all _ attributes to None."""
        mock_config = MagicMock()

        client = GraphitiClient(mock_config)

        assert client._graphiti is None
        assert client._driver is None
        assert client._llm_client is None
        assert client._embedder is None
        assert client._initialized is False


# =============================================================================
# Tests for GraphitiClient.initialize()
# =============================================================================


class TestGraphitiClientInitialize:
    """Tests for GraphitiClient.initialize method."""

    @pytest.mark.asyncio
    async def test_returns_true_if_already_initialized(self):
        """Returns True if already initialized (idempotent)."""
        mock_config = MagicMock()
        client = GraphitiClient(mock_config)
        client._initialized = True

        result = await client.initialize()

        assert result is True  # Should return True since already initialized

    @pytest.mark.asyncio
    async def test_creates_llm_client_via_factory(self, graphiti_mocks):
        """Creates LLM client via factory."""
        mock_config = MagicMock()
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = True

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is True
                    mock_create_llm.assert_called_once_with(mock_config)

    @pytest.mark.asyncio
    async def test_creates_embedder_via_factory(self, graphiti_mocks):
        """Creates embedder via factory."""
        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = True

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is True
                    mock_create_emb.assert_called_once_with(mock_config)

    @pytest.mark.asyncio
    async def test_applies_ladybug_monkeypatch(self, graphiti_mocks):
        """Applies ladybug monkeypatch."""
        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = True

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is True
                    mock_patch.assert_called_once()

    @pytest.mark.asyncio
    async def test_creates_patched_kuzu_driver(self, graphiti_mocks):
        """Creates patched KuzuDriver."""
        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = True

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is True
                    graphiti_mocks[
                        "mock_kuzu_driver_patched"
                    ].create_patched_kuzu_driver.assert_called_once_with(
                        db=str(Path("/test/db"))
                    )

    @pytest.mark.asyncio
    async def test_builds_indices_on_first_init(self, graphiti_mocks):
        """Builds indices on first init."""
        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = True

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is True
                    graphiti_mocks[
                        "mock_graphiti_instance"
                    ].build_indices_and_constraints.assert_called_once()

    @pytest.mark.asyncio
    async def test_builds_indices_with_state_update(self, graphiti_mocks):
        """Builds indices and updates state on first init."""
        from integrations.graphiti.config import GraphitiState

        mock_config = _make_mock_config()
        state = GraphitiState()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = True

                    client = GraphitiClient(mock_config)
                    result = await client.initialize(state)

                    assert result is True
                    assert state.indices_built is True
                    assert state.initialized is True
                    assert state.database == "test_db"
                    assert state.llm_provider == "openai"
                    assert state.embedder_provider == "openai"
                    assert state.created_at is not None

    @pytest.mark.asyncio
    async def test_returns_true_on_success(self, graphiti_mocks):
        """Returns True on success."""
        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = True

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_provider_not_installed_raised_llm(
        self, graphiti_mocks
    ):
        """Returns False when ProviderNotInstalled raised for LLM."""
        from integrations.graphiti.providers_pkg import ProviderNotInstalled

        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch(
                "integrations.graphiti.queries_pkg.client.capture_exception"
            ) as mock_capture:
                mock_create_llm.side_effect = ProviderNotInstalled(
                    "openai not installed"
                )

                client = GraphitiClient(mock_config)
                result = await client.initialize()

                assert result is False
                mock_capture.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_false_when_provider_error_raised_llm(self, graphiti_mocks):
        """Returns False when ProviderError raised for LLM."""
        from integrations.graphiti.providers_pkg import ProviderError

        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch(
                "integrations.graphiti.queries_pkg.client.capture_exception"
            ) as mock_capture:
                mock_create_llm.side_effect = ProviderError("LLM config error")

                client = GraphitiClient(mock_config)
                result = await client.initialize()

                assert result is False
                mock_capture.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_false_when_provider_not_installed_raised_embedder(
        self, graphiti_mocks
    ):
        """Returns False when ProviderNotInstalled raised for embedder."""
        from integrations.graphiti.providers_pkg import ProviderNotInstalled

        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client.capture_exception"
                ) as mock_capture:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.side_effect = ProviderNotInstalled(
                        "embedder not installed"
                    )

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is False
                    mock_capture.assert_called()

    @pytest.mark.asyncio
    async def test_returns_false_when_provider_error_raised_embedder(
        self, graphiti_mocks
    ):
        """Returns False when ProviderError raised for embedder."""
        from integrations.graphiti.providers_pkg import ProviderError

        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client.capture_exception"
                ) as mock_capture:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.side_effect = ProviderError("Embedder config error")

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is False
                    mock_capture.assert_called()

    @pytest.mark.asyncio
    async def test_returns_false_when_ladybug_unavailable(self, graphiti_mocks):
        """Returns False when ladybug unavailable."""
        mock_config = _make_mock_config()

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = False  # Ladybug unavailable

                    client = GraphitiClient(mock_config)
                    result = await client.initialize()

                    assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_on_database_init_os_error(self, graphiti_mocks):
        """Returns False on database init OSError."""
        mock_config = _make_mock_config()

        # Override the mock to raise OSError
        graphiti_mocks[
            "mock_kuzu_driver_patched"
        ].create_patched_kuzu_driver.side_effect = OSError("Permission denied")

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    with patch(
                        "integrations.graphiti.queries_pkg.client.capture_exception"
                    ) as mock_capture:
                        mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                        mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                        mock_patch.return_value = True

                        client = GraphitiClient(mock_config)
                        result = await client.initialize()

                        assert result is False
                        mock_capture.assert_called()

    @pytest.mark.asyncio
    async def test_returns_false_on_database_init_permission_error(
        self, graphiti_mocks
    ):
        """Returns False on database init PermissionError."""
        mock_config = _make_mock_config()

        # Override the mock to raise PermissionError
        graphiti_mocks[
            "mock_kuzu_driver_patched"
        ].create_patched_kuzu_driver.side_effect = PermissionError("Access denied")

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    with patch(
                        "integrations.graphiti.queries_pkg.client.capture_exception"
                    ) as mock_capture:
                        mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                        mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                        mock_patch.return_value = True

                        client = GraphitiClient(mock_config)
                        result = await client.initialize()

                        assert result is False
                        mock_capture.assert_called()

    @pytest.mark.asyncio
    async def test_returns_false_on_database_init_generic_exception(
        self, graphiti_mocks
    ):
        """Returns False on database init generic Exception."""
        mock_config = _make_mock_config()

        # Override the mock to raise RuntimeError
        graphiti_mocks[
            "mock_kuzu_driver_patched"
        ].create_patched_kuzu_driver.side_effect = RuntimeError("Unexpected error")

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    with patch(
                        "integrations.graphiti.queries_pkg.client.capture_exception"
                    ) as mock_capture:
                        mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                        mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                        mock_patch.return_value = True

                        client = GraphitiClient(mock_config)
                        result = await client.initialize()

                        assert result is False
                        mock_capture.assert_called()

    @pytest.mark.asyncio
    async def test_returns_false_on_graphiti_construction_exception(self):
        """Returns False on Graphiti construction generic Exception (lines 278-286)."""
        mock_config = MagicMock()
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"
        mock_config.get_db_path.return_value = Path("/test/db")

        # Create a Graphiti class that raises exception during construction
        mock_graphiti_class = MagicMock(
            side_effect=ValueError("Graphiti construction failed")
        )

        # Mock graphiti_core module
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = mock_graphiti_class
        sys.modules["graphiti_core"] = mock_graphiti_core

        # Create mock kuzu driver to avoid import errors
        mock_kuzu = MagicMock()
        mock_kuzu_driver = MagicMock()
        mock_kuzu.Database = MagicMock()
        mock_kuzu_driver.create_patched_kuzu_driver = MagicMock(return_value=mock_kuzu)
        sys.modules["kuzu"] = mock_kuzu
        sys.modules["integrations.graphiti.queries_pkg.kuzu_driver_patched"] = (
            mock_kuzu_driver
        )

        try:
            with patch("graphiti_providers.create_llm_client") as mock_create_llm:
                with patch("graphiti_providers.create_embedder") as mock_create_emb:
                    with patch(
                        "integrations.graphiti.queries_pkg.client.capture_exception"
                    ) as mock_capture:
                        mock_create_llm.return_value = MagicMock()
                        mock_create_emb.return_value = MagicMock()

                        client = GraphitiClient(mock_config)
                        result = await client.initialize()

                        assert result is False
                        # Verify capture_exception was called with generic exception type
                        mock_capture.assert_called()
                        # Find the call with ValueError error_type
                        for call in mock_capture.call_args_list:
                            call_kwargs = call.kwargs
                            if call_kwargs.get("error_type") == "ValueError":
                                return
                        pytest.fail("ValueError exception not captured")
        finally:
            sys.modules.pop("graphiti_core", None)
            sys.modules.pop("kuzu", None)
            sys.modules.pop(
                "integrations.graphiti.queries_pkg.kuzu_driver_patched", None
            )

    @pytest.mark.asyncio
    async def test_captures_exceptions_via_sentry(self, graphiti_mocks):
        """Captures exceptions via sentry."""
        from integrations.graphiti.providers_pkg import ProviderError

        mock_config = _make_mock_config()
        error = ProviderError("Test error")

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch(
                "integrations.graphiti.queries_pkg.client.capture_exception"
            ) as mock_capture:
                mock_create_llm.side_effect = error

                client = GraphitiClient(mock_config)
                await client.initialize()

                # Verify capture_exception was called with correct parameters
                mock_capture.assert_called_once()
                call_kwargs = mock_capture.call_args[1]
                assert call_kwargs["error_type"] == "ProviderError"
                assert call_kwargs["provider_type"] == "llm"

    @pytest.mark.asyncio
    async def test_skips_building_indices_if_state_indices_built(self, graphiti_mocks):
        """Skips building indices if state.indices_built is True."""
        from integrations.graphiti.config import GraphitiState

        mock_config = _make_mock_config()
        state = GraphitiState(indices_built=True)

        with patch("graphiti_providers.create_llm_client") as mock_create_llm:
            with patch("graphiti_providers.create_embedder") as mock_create_emb:
                with patch(
                    "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                ) as mock_patch:
                    mock_create_llm.return_value = graphiti_mocks["mock_llm_client"]
                    mock_create_emb.return_value = graphiti_mocks["mock_embedder"]
                    mock_patch.return_value = True

                    client = GraphitiClient(mock_config)
                    result = await client.initialize(state)

                    assert result is True
                    # Should not build indices since they were already built
                    graphiti_mocks[
                        "mock_graphiti_instance"
                    ].build_indices_and_constraints.assert_not_called()

    @pytest.mark.asyncio
    async def test_handles_kuzu_driver_import_error(self):
        """Handles ImportError from kuzu_driver_patched."""
        mock_config = MagicMock()
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"

        # Create mock Graphiti instance
        mock_graphiti_instance = AsyncMock()
        mock_graphiti_instance.build_indices_and_constraints = AsyncMock()
        mock_graphiti_class = MagicMock(return_value=mock_graphiti_instance)

        # Mock graphiti_core module
        mock_graphiti_core = MagicMock()
        mock_graphiti_core.Graphiti = mock_graphiti_class
        sys.modules["graphiti_core"] = mock_graphiti_core

        try:
            with patch("graphiti_providers.create_llm_client") as mock_create_llm:
                with patch("graphiti_providers.create_embedder") as mock_create_emb:
                    with patch(
                        "integrations.graphiti.queries_pkg.client._apply_ladybug_monkeypatch"
                    ) as mock_patch:
                        with patch(
                            "integrations.graphiti.queries_pkg.client.capture_exception"
                        ) as mock_capture:
                            mock_create_llm.return_value = MagicMock()
                            mock_create_emb.return_value = MagicMock()
                            mock_patch.return_value = True

                            # Create import error that will be raised when trying to import
                            # We need to mock the module import itself, not just the function
                            def import_side_effect(name, *args, **kwargs):
                                if (
                                    name
                                    == "integrations.graphiti.queries_pkg.kuzu_driver_patched"
                                ):
                                    raise ImportError("kuzu_driver_patched not found")
                                return original_import(name, *args, **kwargs)

                            original_import = builtins.__import__
                            with patch(
                                "builtins.__import__", side_effect=import_side_effect
                            ):
                                client = GraphitiClient(mock_config)
                                result = await client.initialize()

                                assert result is False
                                mock_capture.assert_called()
        finally:
            sys.modules.pop("graphiti_core", None)


# =============================================================================
# Tests for GraphitiClient properties
# =============================================================================


class TestGraphitiClientProperties:
    """Tests for GraphitiClient properties."""

    def test_graphiti_property_returns_graphiti(self):
        """graphiti property returns _graphiti."""
        mock_config = MagicMock()
        client = GraphitiClient(mock_config)
        mock_graphiti = MagicMock()
        client._graphiti = mock_graphiti

        result = client.graphiti

        assert result is mock_graphiti

    def test_is_initialized_returns_initialized_flag(self):
        """is_initialized returns _initialized."""
        mock_config = MagicMock()
        client = GraphitiClient(mock_config)
        client._initialized = True

        assert client.is_initialized is True

        client._initialized = False

        assert client.is_initialized is False


# =============================================================================
# Tests for GraphitiClient.close()
# =============================================================================


class TestGraphitiClientClose:
    """Tests for GraphitiClient.close method."""

    @pytest.mark.asyncio
    async def test_closes_graphiti_connection(self):
        """Closes graphiti connection."""
        mock_config = MagicMock()
        client = GraphitiClient(mock_config)
        mock_graphiti = AsyncMock()
        client._graphiti = mock_graphiti
        client._driver = MagicMock()
        client._llm_client = MagicMock()
        client._embedder = MagicMock()
        client._initialized = True

        await client.close()

        mock_graphiti.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_resets_all_attributes(self):
        """Resets all attributes."""
        mock_config = MagicMock()
        client = GraphitiClient(mock_config)
        mock_graphiti = AsyncMock()
        client._graphiti = mock_graphiti
        client._driver = MagicMock()
        client._llm_client = MagicMock()
        client._embedder = MagicMock()
        client._initialized = True

        await client.close()

        assert client._graphiti is None
        assert client._driver is None
        assert client._llm_client is None
        assert client._embedder is None
        assert client._initialized is False

    @pytest.mark.asyncio
    async def test_handles_exceptions_gracefully(self):
        """Handles exceptions gracefully."""
        mock_config = MagicMock()
        client = GraphitiClient(mock_config)
        mock_graphiti = AsyncMock()
        mock_graphiti.close.side_effect = Exception("Close error")
        client._graphiti = mock_graphiti
        client._driver = MagicMock()
        client._llm_client = MagicMock()
        client._embedder = MagicMock()
        client._initialized = True

        # Should not raise exception
        await client.close()

        # Attributes should still be reset
        assert client._graphiti is None
        assert client._driver is None

    @pytest.mark.asyncio
    async def test_handles_close_when_graphiti_is_none(self):
        """Handles close when _graphiti is None."""
        mock_config = MagicMock()
        client = GraphitiClient(mock_config)
        client._graphiti = None

        # Should not raise exception
        await client.close()

        assert client._initialized is False


# =============================================================================
# Tests for _apply_ladybug_monkeypatch() additional scenarios
# =============================================================================


class TestApplyLadybugMonkeypatchAdditional:
    """Additional tests for ladybug monkeypatch edge cases."""

    def test_logs_debug_on_ladybug_import_failure(self, isolate_kuzu_module):
        """Logs debug message when LadybugDB import fails."""

        def import_side_effect(name, *args, **kwargs):
            if name == "real_ladybug":
                raise ImportError("real_ladybug not found")
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch("builtins.__import__", side_effect=import_side_effect):
            with patch(
                "integrations.graphiti.queries_pkg.client.logger"
            ) as mock_logger:
                # Mock kuzu to be available for fallback
                sys.modules["kuzu"] = MagicMock()
                try:
                    result = _apply_ladybug_monkeypatch()
                    assert result is True
                    # Should log debug for ladybug failure
                    mock_logger.debug.assert_called()
                finally:
                    sys.modules.pop("kuzu", None)


# =============================================================================
# Tests for GraphitiClient.initialize() ImportError paths
# =============================================================================


class TestGraphitiClientInitializeImportError:
    """Tests for GraphitiClient.initialize ImportError handling."""

    @pytest.mark.asyncio
    async def test_initialize_graphiti_core_import_error(self):
        """Returns False when graphiti_core import fails."""
        mock_config = MagicMock()
        mock_config.llm_provider = "openai"
        mock_config.embedder_provider = "openai"

        # Mock graphiti_core module import to raise ImportError
        def import_side_effect(name, *args, **kwargs):
            if name == "graphiti_core":
                raise ImportError("graphiti_core not found")
            elif name == "graphiti_providers":
                # Return mock for providers to get past that import
                mock_providers = MagicMock()
                mock_providers.create_llm_client = MagicMock(return_value=MagicMock())
                mock_providers.create_embedder = MagicMock(return_value=MagicMock())
                mock_providers.ProviderError = Exception
                mock_providers.ProviderNotInstalled = Exception
                return mock_providers
            return original_import(name, *args, **kwargs)

        original_import = builtins.__import__
        with patch("builtins.__import__", side_effect=import_side_effect):
            with patch(
                "integrations.graphiti.queries_pkg.client.capture_exception"
            ) as mock_capture:
                client = GraphitiClient(mock_config)
                result = await client.initialize()

                assert result is False
                mock_capture.assert_called()

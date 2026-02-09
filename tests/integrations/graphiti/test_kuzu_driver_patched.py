"""
Tests for integrations.graphiti.queries_pkg.kuzu_driver_patched module.

Tests cover:
- create_patched_kuzu_driver() function
- PatchedKuzuDriver class
- execute_query() method
- build_indices_and_constraints() method
- setup_schema() method
"""

import re
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_kuzu():
    """Mock kuzu module."""
    kuzu = MagicMock()
    mock_connection = MagicMock()
    kuzu.Connection = MagicMock(return_value=mock_connection)
    return kuzu


@pytest.fixture
def mock_graphiti_core():
    """Mock graphiti_core module components."""
    graphiti_core = MagicMock()
    graphiti_core.driver.driver.GraphProvider.KUZU = "kuzu"
    graphiti_core.graph_queries.get_fulltext_indices = MagicMock(return_value=[])
    return graphiti_core


# =============================================================================
# Tests for create_patched_kuzu_driver()
# =============================================================================


class TestCreatePatchedKuzuDriver:
    """Tests for create_patched_kuzu_driver function."""

    def test_create_patched_kuzu_driver_returns_driver_instance(self, mock_kuzu, mock_graphiti_core):
        """Test create_patched_kuzu_driver returns PatchedKuzuDriver instance."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver(db=":memory:")

            assert driver is not None
            assert driver._database == ":memory:"

    def test_create_patched_kuzu_driver_with_custom_max_queries(self, mock_kuzu, mock_graphiti_core):
        """Test create_patched_kuzu_driver with custom max_concurrent_queries."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver(db="/tmp/test.db", max_concurrent_queries=4)

            assert driver is not None
            assert driver._database == "/tmp/test.db"

    def test_create_patched_kuzu_driver_default_memory_db(self, mock_kuzu, mock_graphiti_core):
        """Test create_patched_kuzu_driver defaults to :memory: database."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            assert driver._database == ":memory:"


# =============================================================================
# Tests for PatchedKuzuDriver.execute_query()
# =============================================================================


class TestPatchedKuzuDriverExecuteQuery:
    """Tests for PatchedKuzuDriver.execute_query method."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_returns_results(self, mock_kuzu, mock_graphiti_core):
        """Test execute_query returns query results."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            # Mock the client and results
            mock_result = MagicMock()
            mock_result.rows_as_dict = MagicMock(return_value=[{"key": "value"}])
            driver.client = AsyncMock()
            driver.client.execute = AsyncMock(return_value=mock_result)

            results, _, _ = await driver.execute_query("MATCH (n) RETURN n LIMIT 1")

            assert results == [{"key": "value"}]

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_preserves_none_parameters(self, mock_kuzu, mock_graphiti_core):
        """Test execute_query preserves None parameters (doesn't filter them out)."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            mock_result = MagicMock()
            mock_result.rows_as_dict = MagicMock(return_value=[])
            driver.client = AsyncMock()
            driver.client.execute = AsyncMock(return_value=mock_result)

            await driver.execute_query(
                "MATCH (n) WHERE n.value = $value RETURN n",
                value=None,
                other_param="test"
            )

            # Verify execute was called with None value preserved
            call_args = driver.client.execute.call_args
            params = call_args[1]["parameters"]
            assert params["value"] is None
            assert params["other_param"] == "test"

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_removes_database_and_routing_params(self, mock_kuzu, mock_graphiti_core):
        """Test execute_query removes database_ and routing_ parameters."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            mock_result = MagicMock()
            mock_result.rows_as_dict = MagicMock(return_value=[])
            driver.client = AsyncMock()
            driver.client.execute = AsyncMock(return_value=mock_result)

            await driver.execute_query(
                "MATCH (n) RETURN n",
                database_="test_db",
                routing_="test_route",
                valid_param="keep_this"
            )

            call_args = driver.client.execute.call_args
            params = call_args[1]["parameters"]
            assert "database_" not in params
            assert "routing_" not in params
            assert params["valid_param"] == "keep_this"

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_handles_empty_results(self, mock_kuzu, mock_graphiti_core):
        """Test execute_query handles empty results."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            driver.client = AsyncMock()
            driver.client.execute = AsyncMock(return_value=None)

            results, _, _ = await driver.execute_query("MATCH (n) RETURN n")

            assert results == []

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_logs_errors(self, mock_kuzu, mock_graphiti_core):
        """Test execute_query logs errors appropriately."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            driver.client = AsyncMock()
            driver.client.execute = AsyncMock(side_effect=Exception("Query failed"))

            with pytest.raises(Exception, match="Query failed"):
                await driver.execute_query("INVALID CYPHER")


# =============================================================================
# Tests for PatchedKuzuDriver.build_indices_and_constraints()
# =============================================================================


class TestPatchedKuzuDriverBuildIndices:
    """Tests for PatchedKuzuDriver.build_indices_and_constraints method."""

    @pytest.mark.slow
    def test_build_indices_creates_fts_indexes(self, mock_kuzu, mock_graphiti_core):
        """Test build_indices_and_constraints creates FTS indexes."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name', 'description'])"
        ]

        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            driver.build_indices_and_constraints(delete_existing=False)

            # Verify the FTS index was executed
            mock_conn = mock_kuzu.Connection.return_value
            assert mock_conn.execute.call_count >= 1

    @pytest.mark.slow
    def test_build_indices_with_delete_existing(self, mock_kuzu, mock_graphiti_core):
        """Test build_indices_and_constraints with delete_existing=True."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]

        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            driver.build_indices_and_constraints(delete_existing=True)

            mock_conn = mock_kuzu.Connection.return_value
            # Should have DROP_FTS_INDEX and CREATE_FTS_INDEX calls
            assert mock_conn.execute.call_count >= 1

    @pytest.mark.slow
    def test_build_indices_handles_already_exists_error(self, mock_kuzu, mock_graphiti_core):
        """Test build_indices_and_constraints handles 'index already exists' error gracefully."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]

        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = [
            Exception("Index already exists"),  # DROP fails or CREATE finds existing
        ]

        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            # Should not raise exception
            driver.build_indices_and_constraints(delete_existing=False)

    @pytest.mark.slow
    def test_build_indices_handles_duplicate_error(self, mock_kuzu, mock_graphiti_core):
        """Test build_indices_and_constraints handles 'duplicate' error gracefully."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]

        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = [
            Exception("duplicate index"),
        ]

        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            # Should not raise exception
            driver.build_indices_and_constraints(delete_existing=False)

    @pytest.mark.slow
    def test_build_indices_closes_connection(self, mock_kuzu, mock_graphiti_core):
        """Test build_indices_and_constraints closes connection after use."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = []

        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            driver.build_indices_and_constraints(delete_existing=False)

            mock_conn = mock_kuzu.Connection.return_value
            mock_conn.close.assert_called_once()


# =============================================================================
# Tests for PatchedKuzuDriver.setup_schema()
# =============================================================================


class TestPatchedKuzuDriverSetupSchema:
    """Tests for PatchedKuzuDriver.setup_schema method."""

    @pytest.mark.slow
    def test_setup_schema_installs_fts_extension(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema installs FTS extension."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            # Mock parent's setup_schema
            with patch.object(driver.__class__.__bases__[0], "setup_schema"):
                driver.setup_schema()

                mock_conn = mock_kuzu.Connection.return_value
                # Verify INSTALL fts was called
                install_calls = [call for call in mock_conn.execute.call_args_list if "INSTALL" in str(call) and "fts" in str(call).lower()]
                # Verify LOAD EXTENSION fts was called
                load_calls = [call for call in mock_conn.execute.call_args_list if "LOAD" in str(call) and "fts" in str(call).lower()]

    @pytest.mark.slow
    def test_setup_schema_loads_fts_extension(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema loads FTS extension."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            # Mock parent's setup_schema
            with patch.object(driver.__class__.__bases__[0], "setup_schema"):
                driver.setup_schema()

                mock_conn = mock_kuzu.Connection.return_value
                # Check that LOAD EXTENSION fts was called
                load_calls = [call for call in mock_conn.execute.call_args_list if "LOAD" in str(call) and "EXTENSION" in str(call)]

    @pytest.mark.slow
    def test_setup_schema_handles_install_already_error(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema handles 'extension already installed' error."""
        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = Exception("Extension already installed")

        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            # Mock parent's setup_schema
            with patch.object(driver.__class__.__bases__[0], "setup_schema"):
                # Should not raise exception
                driver.setup_schema()

    @pytest.mark.slow
    def test_setup_schema_closes_connection(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema closes connection after use."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            # Mock parent's setup_schema
            with patch.object(driver.__class__.__bases__[0], "setup_schema"):
                driver.setup_schema()

                mock_conn = mock_kuzu.Connection.return_value
                mock_conn.close.assert_called_once()

    @pytest.mark.slow
    def test_setup_schema_calls_parent_setup_schema(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema calls parent's setup_schema."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver()

            parent_mock = MagicMock()
            with patch.object(driver.__class__.__bases__[0], "setup_schema", parent_mock):
                driver.setup_schema()

                parent_mock.assert_called_once()


# =============================================================================
# Tests for PatchedKuzuDriver._database property
# =============================================================================


class TestPatchedKuzuDriverDatabaseProperty:
    """Tests for PatchedKuzuDriver _database attribute."""

    def test_database_attribute_is_set(self, mock_kuzu, mock_graphiti_core):
        """Test that _database attribute is set during initialization."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver(db="/test/path/db")

            assert driver._database == "/test/path/db"

    def test_database_attribute_required_by_graphiti(self, mock_kuzu, mock_graphiti_core):
        """Test that _database attribute is required for Graphiti group_id checks."""
        with patch.dict("sys.modules", {"kuzu": mock_kuzu, "graphiti_core.driver.driver": mock_graphiti_core.driver, "graphiti_core.graph_queries": mock_graphiti_core.graph_queries}):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import create_patched_kuzu_driver

            driver = create_patched_kuzu_driver(db="auto_claude_memory.db")

            # The _database attribute is used by Graphiti for group_id checks
            assert hasattr(driver, "_database")
            assert driver._database == "auto_claude_memory.db"

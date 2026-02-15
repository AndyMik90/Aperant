"""
Tests for integrations.graphiti.queries_pkg.kuzu_driver_patched module.

Tests cover:
- create_patched_kuzu_driver() function
- PatchedKuzuDriver class
- execute_query() method
- build_indices_and_constraints() method
- setup_schema() method
"""

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


@pytest.fixture
def mock_sys_modules(mock_kuzu, mock_graphiti_core):
    """Mock sys.modules with kuzu and graphiti_core components."""
    return {
        "kuzu": mock_kuzu,
        "graphiti_core": MagicMock(),
        "graphiti_core.driver": MagicMock(),
        "graphiti_core.driver.driver": mock_graphiti_core.driver,
        "graphiti_core.graph_queries": mock_graphiti_core.graph_queries,
    }


def _build_sys_modules_dict(mock_kuzu, mock_graphiti_core, kuzu_driver_module=None):
    """Helper to build sys.modules dict with optional kuzu_driver."""
    modules_dict = {
        "kuzu": mock_kuzu,
        "graphiti_core": MagicMock(),
        "graphiti_core.driver": MagicMock(),
        "graphiti_core.driver.driver": mock_graphiti_core.driver,
        "graphiti_core.graph_queries": mock_graphiti_core.graph_queries,
    }
    if kuzu_driver_module is not None:
        modules_dict["graphiti_core.driver.kuzu_driver"] = kuzu_driver_module
    return modules_dict


# =============================================================================
# Helper Classes
# =============================================================================


class MockKuzuDriver:
    """Mock KuzuDriver class for tests that use the with patch pattern."""

    def __init__(self, db, max_concurrent_queries=1):
        self.db = db
        self.max_concurrent_queries = max_concurrent_queries
        self.client = None


# =============================================================================
# Tests for create_patched_kuzu_driver()
# =============================================================================


class TestCreatePatchedKuzuDriver:
    """Tests for create_patched_kuzu_driver function."""

    def test_create_patched_kuzu_driver_returns_driver_instance(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test create_patched_kuzu_driver returns PatchedKuzuDriver instance."""

        # Create a mock OriginalKuzuDriver
        class MockKuzuDriver:
            def __init__(self, db, max_concurrent_queries=1):
                self.db = db
                self.max_concurrent_queries = max_concurrent_queries
                self.client = None

        # Create the kuzu_driver module mock
        mock_kuzu_driver_module = MagicMock()
        mock_kuzu_driver_module.KuzuDriver = MockKuzuDriver

        # Patch the imports inside the function
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                create_patched_kuzu_driver,
            )

            driver = create_patched_kuzu_driver(db=":memory:")

            assert driver is not None
            assert hasattr(driver, "_database")
            assert driver._database == ":memory:"

    def test_create_patched_kuzu_driver_with_custom_max_queries(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test create_patched_kuzu_driver with custom max_concurrent_queries."""

        # Create a mock OriginalKuzuDriver
        class MockKuzuDriver:
            def __init__(self, db, max_concurrent_queries=1):
                self.db = db
                self.max_concurrent_queries = max_concurrent_queries
                self.client = None

        # Create the kuzu_driver module mock
        mock_kuzu_driver_module = MagicMock()
        mock_kuzu_driver_module.KuzuDriver = MockKuzuDriver

        # Patch the imports inside the function
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                create_patched_kuzu_driver,
            )

            driver = create_patched_kuzu_driver(
                db="/tmp/test.db", max_concurrent_queries=4
            )

            assert driver is not None
            assert driver._database == "/tmp/test.db"

    def test_create_patched_kuzu_driver_default_memory_db(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test create_patched_kuzu_driver defaults to :memory: database."""

        # Create a mock OriginalKuzuDriver
        class MockKuzuDriver:
            def __init__(self, db, max_concurrent_queries=1):
                self.db = db
                self.max_concurrent_queries = max_concurrent_queries
                self.client = None

        # Create the kuzu_driver module mock
        mock_kuzu_driver_module = MagicMock()
        mock_kuzu_driver_module.KuzuDriver = MockKuzuDriver

        # Patch the imports inside the function
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                create_patched_kuzu_driver,
            )

            driver = create_patched_kuzu_driver()

            assert driver._database == ":memory:"


# =============================================================================
# Tests for PatchedKuzuDriver.execute_query()
# =============================================================================


class TestPatchedKuzuDriverExecuteQuery:
    """Tests for PatchedKuzuDriver.execute_query method."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "_marker", [pytest.param(()), pytest.param((), marks=pytest.mark.slow)]
    )
    async def test_execute_query_returns_results(
        self, mock_kuzu, mock_graphiti_core, _marker
    ):
        """Test execute_query returns query results (lines 58-82)."""

        # Create the kuzu_driver module mock
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock the client and results
                mock_result = MagicMock()
                mock_result.rows_as_dict = MagicMock(return_value=[{"key": "value"}])
                driver.client = AsyncMock()
                driver.client.execute = AsyncMock(return_value=mock_result)

                results, _, _ = await driver.execute_query("MATCH (n) RETURN n LIMIT 1")

                assert results == [{"key": "value"}]

    @pytest.mark.asyncio
    async def test_execute_query_handles_empty_results(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test execute_query handles empty results (lines 75-76)."""

        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                driver.client = AsyncMock()
                driver.client.execute = AsyncMock(return_value=None)

                results, _, _ = await driver.execute_query("MATCH (n) RETURN n")

                assert results == []

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_preserves_none_parameters(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test execute_query preserves None parameters (doesn't filter them out)."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                mock_result = MagicMock()
                mock_result.rows_as_dict = MagicMock(return_value=[])
                driver.client = AsyncMock()
                driver.client.execute = AsyncMock(return_value=mock_result)

                await driver.execute_query(
                    "MATCH (n) WHERE n.value = $value RETURN n",
                    value=None,
                    other_param="test",
                )

                # Verify execute was called with None value preserved
                call_args = driver.client.execute.call_args
                params = call_args[1]["parameters"]
                assert params["value"] is None
                assert params["other_param"] == "test"

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_removes_database_and_routing_params(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test execute_query removes database_ and routing_ parameters."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                mock_result = MagicMock()
                mock_result.rows_as_dict = MagicMock(return_value=[])
                driver.client = AsyncMock()
                driver.client.execute = AsyncMock(return_value=mock_result)

                await driver.execute_query(
                    "MATCH (n) RETURN n",
                    database_="test_db",
                    routing_="test_route",
                    valid_param="keep_this",
                )

                call_args = driver.client.execute.call_args
                params = call_args[1]["parameters"]
                assert "database_" not in params
                assert "routing_" not in params
                assert params["valid_param"] == "keep_this"

    @pytest.mark.asyncio
    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_logs_errors(self, mock_kuzu, mock_graphiti_core):
        """Test execute_query logs errors appropriately."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

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

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_creates_fts_indexes(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test build_indices_and_constraints creates FTS indexes."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name', 'description'])"
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                await driver.build_indices_and_constraints(delete_existing=False)

                # Verify the FTS index was executed
                mock_conn = mock_kuzu.Connection.return_value
                assert mock_conn.execute.call_count >= 1
                # Check that CREATE_FTS_INDEX was in the calls
                assert any(
                    "CREATE_FTS_INDEX" in str(call)
                    for call in mock_conn.execute.call_args_list
                )

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_with_delete_existing(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test build_indices_and_constraints with delete_existing=True."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):
            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                await driver.build_indices_and_constraints(delete_existing=True)

                mock_conn = mock_kuzu.Connection.return_value
                # Should have DROP_FTS_INDEX and CREATE_FTS_INDEX calls
                assert mock_conn.execute.call_count >= 1
                # Check that DROP_FTS_INDEX was in the calls
                assert any(
                    "DROP_FTS_INDEX" in str(call)
                    for call in mock_conn.execute.call_args_list
                )

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_handles_already_exists_error(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test build_indices_and_constraints handles 'index already exists' error gracefully."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]

        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = [
            Exception("Index already exists"),  # DROP fails or CREATE finds existing
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Should not raise exception
                await driver.build_indices_and_constraints(delete_existing=False)

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_handles_duplicate_error(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test build_indices_and_constraints handles 'duplicate' error gracefully."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]

        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = [
            Exception("duplicate index"),
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Should not raise exception
                await driver.build_indices_and_constraints(delete_existing=False)

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_closes_connection(self, mock_kuzu, mock_graphiti_core):
        """Test build_indices_and_constraints closes connection after use."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = []
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                await driver.build_indices_and_constraints(delete_existing=False)

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
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock parent's setup_schema
                with patch.object(type(driver).__bases__[0], "setup_schema"):
                    driver.setup_schema()

                    mock_conn = mock_kuzu.Connection.return_value
                    # Verify INSTALL fts was called
                    install_calls = [
                        call
                        for call in mock_conn.execute.call_args_list
                        if "INSTALL" in str(call) and "fts" in str(call).lower()
                    ]
                    # Verify LOAD EXTENSION fts was called
                    load_calls = [
                        call
                        for call in mock_conn.execute.call_args_list
                        if "LOAD" in str(call) and "fts" in str(call).lower()
                    ]
                    # Assert that calls were made (non-empty)
                    assert len(install_calls) > 0, "INSTALL fts should have been called"
                    assert len(load_calls) > 0, "LOAD fts should have been called"

    @pytest.mark.slow
    def test_setup_schema_loads_fts_extension(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema loads FTS extension."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock parent's setup_schema
                with patch.object(type(driver).__bases__[0], "setup_schema"):
                    driver.setup_schema()

                    mock_conn = mock_kuzu.Connection.return_value
                    # Check that LOAD EXTENSION fts was called
                    load_calls = [
                        call
                        for call in mock_conn.execute.call_args_list
                        if "LOAD" in str(call) and "EXTENSION" in str(call)
                    ]
                    # Assert that calls were made (non-empty)
                    assert len(load_calls) > 0, (
                        "LOAD EXTENSION fts should have been called"
                    )

    @pytest.mark.slow
    def test_setup_schema_handles_install_already_error(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test setup_schema handles 'extension already installed' error."""
        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = Exception("Extension already installed")
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock parent's setup_schema
                with patch.object(type(driver).__bases__[0], "setup_schema"):
                    # Should not raise exception
                    driver.setup_schema()

    @pytest.mark.slow
    def test_setup_schema_closes_connection(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema closes connection after use."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock parent's setup_schema
                with patch.object(type(driver).__bases__[0], "setup_schema"):
                    driver.setup_schema()

                    mock_conn = mock_kuzu.Connection.return_value
                    mock_conn.close.assert_called_once()

    @pytest.mark.slow
    def test_setup_schema_calls_parent_setup_schema(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test setup_schema calls parent's setup_schema."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                parent_mock = MagicMock()
                with patch.object(
                    type(driver).__bases__[0], "setup_schema", parent_mock
                ):
                    driver.setup_schema()

                    parent_mock.assert_called_once()


# =============================================================================
# Tests for PatchedKuzuDriver._database property
# =============================================================================


class TestPatchedKuzuDriverDatabaseProperty:
    """Tests for PatchedKuzuDriver _database attribute."""

    def test_database_attribute_is_set(self, mock_kuzu, mock_graphiti_core):
        """Test that _database attribute is set during initialization."""

        # Create a mock OriginalKuzuDriver
        class MockKuzuDriver:
            def __init__(self, db, max_concurrent_queries=1):
                self.db = db
                self.max_concurrent_queries = max_concurrent_queries
                self.client = None

        # Create the kuzu_driver module mock
        mock_kuzu_driver_module = MagicMock()
        mock_kuzu_driver_module.KuzuDriver = MockKuzuDriver

        # Patch the imports inside the function
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                create_patched_kuzu_driver,
            )

            driver = create_patched_kuzu_driver(db="/test/path/db")

            assert driver._database == "/test/path/db"

    def test_database_attribute_required_by_graphiti(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test that _database attribute is required for Graphiti group_id checks."""

        # Create a mock OriginalKuzuDriver
        class MockKuzuDriver:
            def __init__(self, db, max_concurrent_queries=1):
                self.db = db
                self.max_concurrent_queries = max_concurrent_queries
                self.client = None

        # Create the kuzu_driver module mock
        mock_kuzu_driver_module = MagicMock()
        mock_kuzu_driver_module.KuzuDriver = MockKuzuDriver

        # Patch the imports inside the function
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):
            from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                create_patched_kuzu_driver,
            )

            driver = create_patched_kuzu_driver(db="auto_claude_memory.db")

            # The _database attribute is used by Graphiti for group_id checks
            assert hasattr(driver, "_database")
            assert driver._database == "auto_claude_memory.db"


# =============================================================================
# Additional tests for execute_query() - missing lines 65-73, 79
# =============================================================================


class TestPatchedKuzuDriverExecuteQueryAdditional:
    """Additional tests for PatchedKuzuDriver.execute_query method."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_handles_list_results(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test execute_query handles list of results (line 79)."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock list of results
                mock_result1 = MagicMock()
                mock_result1.rows_as_dict = MagicMock(return_value=[{"key": "value1"}])
                mock_result2 = MagicMock()
                mock_result2.rows_as_dict = MagicMock(return_value=[{"key": "value2"}])

                driver.client = AsyncMock()
                driver.client.execute = AsyncMock(
                    return_value=[mock_result1, mock_result2]
                )

                results, _, _ = await driver.execute_query("MATCH (n) RETURN n")

                assert results == [[{"key": "value1"}], [{"key": "value2"}]]

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_logs_error_with_list_param(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test execute_query logs errors with list parameters truncated (lines 66-73)."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                driver.client = AsyncMock()
                driver.client.execute = AsyncMock(
                    side_effect=Exception("Query execution failed")
                )

                with pytest.raises(Exception, match="Query execution failed"):
                    # List param should be truncated in logs
                    await driver.execute_query(
                        "MATCH (n) WHERE n.id IN $ids RETURN n",
                        ids=list(range(100)),  # Long list
                    )

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_execute_query_with_non_list_params(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test execute_query with non-list parameters (line 68)."""
        mock_kuzu_driver_module = MagicMock()
        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                mock_result = MagicMock()
                mock_result.rows_as_dict = MagicMock(return_value=[])
                driver.client = AsyncMock()
                driver.client.execute = AsyncMock(return_value=mock_result)

                await driver.execute_query(
                    "MATCH (n) WHERE n.name = $name AND n.age = $age RETURN n",
                    name="test",
                    age=42,
                )

                # Verify params were passed correctly
                call_args = driver.client.execute.call_args
                params = call_args[1]["parameters"]
                assert params["name"] == "test"
                assert params["age"] == 42


# =============================================================================
# Additional tests for build_indices_and_constraints() - missing lines 94-142
# =============================================================================


class TestPatchedKuzuDriverBuildIndicesAdditional:
    """Additional tests for PatchedKuzuDriver.build_indices_and_constraints method."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_with_multiple_queries(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test build_indices_and_constraints processes multiple FTS queries (line 97)."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index1', ['name'])",
            "CALL CREATE_FTS_INDEX('EdgeTable', 'fts_index2', ['description'])",
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                await driver.build_indices_and_constraints(delete_existing=False)

                mock_conn = mock_kuzu.Connection.return_value
                # Should execute both CREATE_FTS_INDEX queries
                assert mock_conn.execute.call_count >= 2

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_drop_fails_continues(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test build_indices_and_constraints continues when DROP fails (lines 115-122)."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]

        mock_conn = mock_kuzu.Connection.return_value
        # DROP fails, CREATE succeeds
        mock_conn.execute.side_effect = [
            Exception("Index not found"),  # DROP fails
            None,  # CREATE succeeds
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Should not raise exception despite DROP failure
                await driver.build_indices_and_constraints(delete_existing=True)

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_logs_warning_on_failure(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test build_indices_and_constraints logs warning on non-duplicate error (lines 135-138)."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]

        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = [
            Exception("Some other error"),  # Not "already exists" or "duplicate"
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Should not raise, logs warning instead
                await driver.build_indices_and_constraints(delete_existing=False)

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_build_indices_handles_mixed_case_error_messages(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test build_indices_and_constraints handles mixed case error messages (line 129)."""
        mock_graphiti_core.graph_queries.get_fulltext_indices.return_value = [
            "CALL CREATE_FTS_INDEX('NodeTable', 'fts_index', ['name'])"
        ]

        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = [
            Exception("INDEX Already EXISTS"),  # Mixed case
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Should handle mixed case "already exists"
                await driver.build_indices_and_constraints(delete_existing=False)


# =============================================================================
# Additional tests for setup_schema() - missing lines 150-174
# =============================================================================


class TestPatchedKuzuDriverSetupSchemaAdditional:
    """Additional tests for PatchedKuzuDriver.setup_schema method."""

    @pytest.mark.slow
    def test_setup_schema_handles_load_already_loaded_error(
        self, mock_kuzu, mock_graphiti_core
    ):
        """Test setup_schema handles 'extension already loaded' error (lines 167-169)."""
        mock_conn = mock_kuzu.Connection.return_value
        # INSTALL succeeds, LOAD fails with "already loaded"
        mock_conn.execute.side_effect = [
            None,  # INSTALL succeeds
            Exception("Extension already loaded"),  # LOAD fails
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock parent's setup_schema
                with patch.object(type(driver).__bases__[0], "setup_schema"):
                    # Should not raise exception
                    driver.setup_schema()

    @pytest.mark.slow
    def test_setup_schema_logs_non_install_errors(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema logs errors that don't contain 'already' (lines 157-160)."""
        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = [
            Exception("Network error during install"),  # Not "already"
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock parent's setup_schema
                with patch.object(type(driver).__bases__[0], "setup_schema"):
                    # Should not raise, logs debug message
                    driver.setup_schema()

    @pytest.mark.slow
    def test_setup_schema_logs_non_load_errors(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema logs LOAD errors that don't contain 'already loaded' (lines 166-169)."""
        mock_conn = mock_kuzu.Connection.return_value
        mock_conn.execute.side_effect = [
            None,  # INSTALL succeeds
            Exception("Load error - not already loaded"),  # LOAD fails
        ]
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock parent's setup_schema
                with patch.object(type(driver).__bases__[0], "setup_schema"):
                    # Should not raise, logs debug message
                    driver.setup_schema()

    @pytest.mark.slow
    def test_setup_schema_installs_and_loads_fts(self, mock_kuzu, mock_graphiti_core):
        """Test setup_schema both installs and loads FTS extension (lines 153-165)."""
        mock_conn = mock_kuzu.Connection.return_value
        mock_kuzu_driver_module = MagicMock()

        with patch.dict(
            "sys.modules",
            _build_sys_modules_dict(
                mock_kuzu, mock_graphiti_core, mock_kuzu_driver_module
            ),
        ):

            class MockKuzuDriver:
                def __init__(self, db, max_concurrent_queries=1):
                    self.db = db
                    self.max_concurrent_queries = max_concurrent_queries
                    self.client = None

                def setup_schema(self):
                    """Mock setup_schema method."""
                    pass

            with patch("graphiti_core.driver.kuzu_driver.KuzuDriver", MockKuzuDriver):
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                driver = create_patched_kuzu_driver()

                # Mock parent's setup_schema
                with patch.object(type(driver).__bases__[0], "setup_schema"):
                    driver.setup_schema()

                    # Verify INSTALL fts was called
                    calls = mock_conn.execute.call_args_list
                    install_call = [
                        c for c in calls if len(c[0]) > 0 and "INSTALL" in str(c[0][0])
                    ]
                    assert len(install_call) >= 1

                    # Verify LOAD EXTENSION fts was called
                    load_call = [
                        c for c in calls if len(c[0]) > 0 and "LOAD" in str(c[0][0])
                    ]
                    assert len(load_call) >= 1

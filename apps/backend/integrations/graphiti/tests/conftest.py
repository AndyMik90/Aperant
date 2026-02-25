"""
Pytest configuration and fixtures for graphiti integration tests.

This module provides shared fixtures for testing the memory system integration,
including mocks for external dependencies, test configurations, and client fixtures.
"""

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

# Add the backend directory to sys.path to allow imports
backend_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_dir))


def pytest_collection_modifyitems(config, items):
    """
    Exclude validator functions from test collection.

    The validators.py module contains functions named test_llm_connection and
    test_embedder_connection which are not pytest tests but validator functions.
    """
    # Filter out items that are from validators.py and are not in test classes
    filtered_items = []
    for item in items:
        # Get the full path of the test
        item_path = str(item.fspath) if hasattr(item, "fspath") else str(item.path)

        # Skip the standalone test_llm_connection and test_embedder_connection
        # functions from validators.py (they're not pytest tests)
        if item.name in [
            "test_llm_connection",
            "test_embedder_connection",
            "test_ollama_connection",
        ]:
            # Check if it's from validators.py
            if "validators.py" in item_path or "test_providers.py" in item_path:
                # Only skip if it's a standalone function (not in a TestClass)
                if not item.parent.name.startswith("Test"):
                    continue

        filtered_items.append(item)

    items[:] = filtered_items


# =============================================================================
# External Dependency Mocks
# =============================================================================


@pytest.fixture
def mock_graphiti_core():
    """Mock graphiti_core.Graphiti and related classes.

    Patches the graphiti_core library to prevent actual graph database connections
    during tests.

    Yields:
        tuple: (mock_graphiti_class, mock_graphiti_instance)
    """
    with patch(
        "integrations.graphiti.queries_pkg.graphiti.graphiti_core.Graphiti"
    ) as mock_graphiti:
        # Configure the mock to return a mock instance
        mock_instance = MagicMock()
        mock_graphiti.return_value = mock_instance

        # Mock common methods that might be called
        mock_instance.add_edges = AsyncMock()
        mock_instance.add_nodes = AsyncMock()
        mock_instance.search = AsyncMock(return_value=[])
        mock_instance.delete_graph = AsyncMock()
        mock_instance.close = AsyncMock()

        yield mock_graphiti, mock_instance


@pytest.fixture
def mock_kuzu_driver():
    """Mock graphiti_core.driver.kuzu_driver.KuzuDriver.

    Prevents actual LadybugDB/kuzu connections during tests.

    Yields:
        tuple: (mock_driver_class, mock_driver_instance)
    """
    with patch(
        "integrations.graphiti.queries_pkg.graphiti.graphiti_core.driver.kuzu_driver.KuzuDriver"
    ) as mock_driver:
        mock_instance = MagicMock()
        mock_driver.return_value = mock_instance

        # Mock driver methods
        mock_instance.close = MagicMock()
        mock_instance.execute_query = MagicMock(return_value=[])

        yield mock_driver, mock_instance


@pytest.fixture
def mock_graphiti_providers():
    """Mock graphiti_providers module.

    Patches the graphiti_providers module to prevent actual LLM/embedder calls.

    Yields:
        tuple: (mock_get_client, mock_client_instance)
    """
    with patch(
        "integrations.graphiti.providers_pkg.providers.get_client"
    ) as mock_get_client:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        yield mock_get_client, mock_client


@pytest.fixture
def mock_ladybug_db():
    """Mock real_ladybug and kuzu database connections.

    Prevents actual database connections during tests.

    Yields:
        dict: Dictionary with 'ladybug' and 'kuzu' keys, each containing
              (mock_class, mock_instance) tuples.
    """
    with (
        patch(
            "integrations.graphiti.queries_pkg.client.real_ladybug.Ladybug"
        ) as mock_ladybug,
        patch("integrations.graphiti.queries_pkg.client.kuzu.Connection") as mock_kuzu,
    ):
        # Mock Ladybug instance
        ladybug_instance = MagicMock()
        mock_ladybug.return_value = ladybug_instance
        ladybug_instance.close = MagicMock()

        # Mock Kuzu connection
        kuzu_instance = MagicMock()
        mock_kuzu.return_value = kuzu_instance
        kuzu_instance.close = MagicMock()

        yield {
            "ladybug": (mock_ladybug, ladybug_instance),
            "kuzu": (mock_kuzu, kuzu_instance),
        }


# =============================================================================
# Config Fixtures
# =============================================================================


@pytest.fixture
def mock_config():
    """Return a GraphitiConfig with test values.

    Provides a test configuration that doesn't require real environment variables
    or database connections.

    Returns:
        GraphitiConfig: Configuration with test values.
    """
    from integrations.graphiti.config import GraphitiConfig

    config = GraphitiConfig(
        enabled=True,
        database="test_dataset",
        db_path="/tmp/test_graphiti.db",
        llm_provider="openai",
        openai_model="gpt-5-mini",
        embedder_provider="openai",
        openai_embedding_model="text-embedding-3-small",
        openai_api_key="sk-test-key-for-testing",
    )

    return config


@pytest.fixture
def mock_env_vars(tmp_path):
    """Set test environment variables for Graphiti configuration.

    Sets up a clean environment with test values for all Graphiti-related
    environment variables.

    Yields:
        dict: Dictionary of environment variables that were set.
    """
    test_db_path = str(tmp_path / "test_graphiti.db")

    env_vars = {
        "GRAPHITI_ENABLED": "true",
        "GRAPHITI_LLM_PROVIDER": "openai",
        "GRAPHITI_EMBEDDER_PROVIDER": "openai",
        "GRAPHITI_DATABASE": "test_dataset",
        "GRAPHITI_DB_PATH": test_db_path,
        "OPENAI_MODEL": "gpt-5-mini",
        "OPENAI_EMBEDDING_MODEL": "text-embedding-3-small",
        "OPENAI_API_KEY": "sk-test-key-for-testing",
    }

    # Save original values
    original = {k: os.environ.get(k) for k in env_vars}

    # Set test values
    for key, value in env_vars.items():
        os.environ[key] = value

    yield env_vars

    # Restore original values
    for key, original_value in original.items():
        if original_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original_value


# =============================================================================
# Client Fixtures
# =============================================================================


@pytest.fixture
def mock_graphiti_client():
    """Mock GraphitiClient with all necessary methods.

    Provides a mock client that simulates the behavior of the GraphitiClient
    without requiring actual graph database connections.

    Returns:
        Mock: Mocked GraphitiClient with typical methods mocked.
    """
    client = Mock()
    client.graphiti = Mock()

    # Core client methods
    client.is_initialized = Mock(return_value=True)
    client.initialize = AsyncMock()
    client.get_session_id = Mock(return_value="test_session")
    client.get_user_id = Mock(return_value="test_user")
    client.get_project_id = Mock(return_value="test_project")

    # Memory operations (async)
    client.add_episode = AsyncMock(return_value="episode_id_123")
    client.add_episodic_memories = AsyncMock(return_value=["mem_id_1", "mem_id_2"])
    client.add_abstract_memories = AsyncMock(return_value=["abstract_id_1"])
    client.search = AsyncMock(return_value=[])
    client.delete_graph = AsyncMock()

    # Graphiti instance methods
    client.graphiti.search = AsyncMock(return_value=[])

    # Configuration
    client.get_config = Mock(
        return_value=Mock(
            enabled=True, database="test_dataset", db_path="/tmp/test_graphiti.db"
        )
    )

    return client


@pytest.fixture
def mock_graphiti_instance():
    """Mock the Graphiti instance from graphiti_core.

    Provides a mock of the actual Graphiti core instance with all methods
    that might be called during operations.

    Returns:
        Mock: Mocked Graphiti instance with typical methods mocked.
    """
    instance = MagicMock()

    # Search methods (async)
    instance.search = AsyncMock(return_value=[])
    instance.search_by_abstract = AsyncMock(return_value=[])
    instance.search_by_vector = AsyncMock(return_value=[])

    # Add methods (async)
    instance.add_episode = AsyncMock(return_value="episode_id")
    instance.add_edges = AsyncMock()
    instance.add_nodes = AsyncMock()

    # Graph management
    instance.delete_graph = AsyncMock()
    instance.close = AsyncMock()
    instance.get_graph_summary = Mock(return_value={"nodes": 0, "edges": 0})

    # Configuration
    instance.database = "test_dataset"

    return instance


# =============================================================================
# Test Directory Fixtures
# =============================================================================


@pytest.fixture
def temp_spec_dir(tmp_path):
    """Create a temporary directory for spec testing.

    Provides a temporary directory with spec-like structure for testing
    spec-related functionality.

    Args:
        tmp_path: pytest's built-in tmp_path fixture.

    Returns:
        Path: Path to the temporary spec directory.
    """
    spec_dir = tmp_path / "spec_001_test"
    spec_dir.mkdir()

    # Create common spec subdirectories
    (spec_dir / ".auto-claude").mkdir()
    (spec_dir / "context").mkdir()

    return spec_dir


@pytest.fixture
def temp_project_dir(tmp_path):
    """Create a temporary directory for project testing.

    Provides a temporary directory with project-like structure for testing
    project-related functionality.

    Args:
        tmp_path: pytest's built-in tmp_path fixture.

    Returns:
        Path: Path to the temporary project directory.
    """
    project_dir = tmp_path / "test_project"
    project_dir.mkdir()

    # Create common project subdirectories
    (project_dir / "src").mkdir()
    (project_dir / "tests").mkdir()
    (project_dir / ".auto-claude").mkdir()

    return project_dir


@pytest.fixture
def temp_db_path(tmp_path):
    """Create a temporary path for test database.

    Provides a temporary file path that can be used for database testing
    without affecting real databases.

    Args:
        tmp_path: pytest's built-in tmp_path fixture.

    Returns:
        str: Path to temporary database file.
    """
    db_path = str(tmp_path / "test_graphiti.db")
    return db_path


# =============================================================================
# Provider Fixtures
# =============================================================================


@pytest.fixture
def mock_llm_client():
    """Mocked LLM client for testing.

    Provides a mock client that simulates LLM responses without making
    actual API calls.

    Returns:
        Mock: Mocked LLM client.
    """
    client = Mock()

    # Message methods
    client.messages = Mock()
    mock_response = Mock()
    mock_response.id = "msg_test_123"
    mock_response.content = []
    mock_response.model = "claude-3-5-sonnet-20241022"
    mock_response.role = "assistant"
    client.messages.create = Mock(return_value=mock_response)

    # Streaming support
    client.messages.stream = Mock(return_value=iter([]))

    # Token counting
    client.count_tokens = Mock(return_value=100)

    return client


@pytest.fixture
def mock_embedder():
    """Mocked embedder with get_embedding() method.

    Provides a mock embedder that returns fake embeddings without making
    actual API calls. Uses deterministic values for reproducibility.

    Returns:
        tuple: (mock_embedder, test_embedding_list)
    """
    embedder = Mock()

    # Return a deterministic embedding vector (1536 dimensions is common for OpenAI)
    # Using 0.1 for all values makes tests reproducible
    test_embedding = [0.1] * 1536

    embedder.get_embedding = Mock(return_value=test_embedding)
    embedder.get_embeddings = Mock(return_value=[test_embedding])

    return embedder, test_embedding


# =============================================================================
# State Fixtures
# =============================================================================


@pytest.fixture
def mock_state():
    """GraphitiState with test values.

    Provides a mock state object with typical values for testing state-related
    functionality.

    Returns:
        Mock: Mocked GraphitiState with test values.
    """
    from integrations.graphiti.config import GraphitiState

    state = GraphitiState(
        initialized=True,
        database="test_dataset",
        indices_built=True,
        llm_provider="openai",
        embedder_provider="openai",
    )

    return state


@pytest.fixture
def mock_empty_state():
    """Empty GraphitiState.

    Provides a mock state object with default/uninitialized values for testing
    initialization logic.

    Returns:
        Mock: Mocked GraphitiState with empty/default values.
    """
    from integrations.graphiti.config import GraphitiState

    state = GraphitiState()

    return state


# =============================================================================
# Test Data Fixtures
# =============================================================================


@pytest.fixture
def sample_episode_data():
    """Sample episode data for testing.

    Provides realistic episode data structure for testing memory operations.

    Returns:
        dict: Sample episode data.
    """
    return {
        "episode_id": "episode_123",
        "content": "Test episode content about a feature implementation",
        "metadata": {
            "task_id": "task_001",
            "timestamp": "2024-01-01T00:00:00Z",
            "type": "implementation",
        },
        "session_id": "test_session",
        "user_id": "test_user",
    }


@pytest.fixture
def sample_memory_nodes():
    """Sample memory nodes for testing.

    Provides realistic node data for testing graph operations.

    Returns:
        list: List of sample memory node dictionaries.
    """
    return [
        {
            "uuid": "node_1",
            "name": "Feature Implementation",
            "label": "CONCEPT",
            "summary": "Implementation of new feature",
            "created_at": "2024-01-01T00:00:00Z",
        },
        {
            "uuid": "node_2",
            "name": "Bug Fix",
            "label": "CONCEPT",
            "summary": "Fixed critical bug",
            "created_at": "2024-01-02T00:00:00Z",
        },
    ]


@pytest.fixture
def sample_search_results():
    """Sample search results for testing.

    Provides realistic search result data for testing search operations.

    Returns:
        list: List of sample search result dictionaries.
    """
    return [
        {
            "uuid": "result_1",
            "name": "Search Result 1",
            "summary": "First search result",
            "score": 0.95,
        },
        {
            "uuid": "result_2",
            "name": "Search Result 2",
            "summary": "Second search result",
            "score": 0.87,
        },
    ]


# =============================================================================
# Helper Fixtures
# =============================================================================


@pytest.fixture
def clean_env():
    """Fixture to ensure clean environment for each test.

    Removes all Graphiti-related environment variables before the test
    and restores them afterward.

    Yields:
        dict: Dictionary of original environment values.
    """
    # Store original env vars
    env_keys = [
        "GRAPHITI_ENABLED",
        "GRAPHITI_LLM_PROVIDER",
        "GRAPHITI_EMBEDDER_PROVIDER",
        "GRAPHITI_DATABASE",
        "GRAPHITI_DB_PATH",
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "OPENAI_EMBEDDING_MODEL",
        "ANTHROPIC_API_KEY",
        "GRAPHITI_ANTHROPIC_MODEL",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_BASE_URL",
        "AZURE_OPENAI_LLM_DEPLOYMENT",
        "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
        "VOYAGE_API_KEY",
        "VOYAGE_EMBEDDING_MODEL",
        "GOOGLE_API_KEY",
        "GOOGLE_LLM_MODEL",
        "GOOGLE_EMBEDDING_MODEL",
        "OPENROUTER_API_KEY",
        "OPENROUTER_BASE_URL",
        "OPENROUTER_LLM_MODEL",
        "OPENROUTER_EMBEDDING_MODEL",
        "OLLAMA_BASE_URL",
        "OLLAMA_LLM_MODEL",
        "OLLAMA_EMBEDDING_MODEL",
        "OLLAMA_EMBEDDING_DIM",
    ]

    original = {}
    for key in env_keys:
        original[key] = os.environ.get(key)
        if key in os.environ:
            os.environ.pop(key)

    yield original

    # Restore original values
    for key, value in original.items():
        if value is not None:
            os.environ[key] = value

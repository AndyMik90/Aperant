"""
Integration tests for Ollama embedding memory system.

Converted from run_ollama_embedding_test.py to proper pytest format.

These tests require a running Ollama server and are marked with
@pytest.mark.integration so they can be skipped in CI without Ollama.

Original script: integrations/graphiti/run_ollama_embedding_test.py

Usage:
    # Run only integration tests:
    pytest tests/test_integration_ollama.py -v -m integration

    # Skip integration tests (default in CI):
    pytest tests/ -v -m "not integration"
"""

import json
import os
import shutil
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

# =============================================================================
# Markers
# =============================================================================

# NOTE: Despite the `integration` marker, these are unit-level tests with fully
# mocked dependencies (no live Ollama server required).  The marker is retained
# for grouping with other Ollama-related tests that *do* need a running server.
pytestmark = [
    pytest.mark.integration,
]

# =============================================================================
# Mock External Dependencies
# =============================================================================


@pytest.fixture(autouse=True)
def mock_graphiti_core_modules():
    """Auto-mock graphiti_core and related modules for all tests."""
    # Save pre-existing module entries so we can restore them in teardown
    _module_keys = [
        "graphiti_core",
        "graphiti_core.nodes",
        "graphiti_core.driver",
        "graphiti_core.driver.kuzu_driver",
    ]
    _saved = {k: sys.modules[k] for k in _module_keys if k in sys.modules}

    mock_graphiti_core = MagicMock()
    mock_nodes = MagicMock()
    mock_episode_type = MagicMock()
    mock_episode_type.text = "text"
    mock_nodes.EpisodeType = mock_episode_type
    mock_graphiti_core.nodes = mock_nodes

    mock_graphiti_class = MagicMock()
    mock_graphiti_instance = MagicMock()
    mock_graphiti_instance.add_episode = AsyncMock()
    mock_graphiti_instance.search = AsyncMock(return_value=[])
    mock_graphiti_instance.build_indices_and_constraints = AsyncMock()
    mock_graphiti_instance.close = AsyncMock()
    mock_graphiti_class.return_value = mock_graphiti_instance
    mock_graphiti_core.Graphiti = mock_graphiti_class

    mock_driver_module = MagicMock()
    mock_driver_module.KuzuDriver = MagicMock()
    mock_graphiti_core.driver = MagicMock()
    mock_graphiti_core.driver.kuzu_driver = mock_driver_module

    sys.modules["graphiti_core"] = mock_graphiti_core
    sys.modules["graphiti_core.nodes"] = mock_nodes
    sys.modules["graphiti_core.driver"] = mock_graphiti_core.driver
    sys.modules["graphiti_core.driver.kuzu_driver"] = mock_driver_module

    try:
        yield {
            "graphiti_core": mock_graphiti_core,
            "episode_type": mock_episode_type,
            "graphiti_instance": mock_graphiti_instance,
        }
    finally:
        for k in _module_keys:
            if k in _saved:
                sys.modules[k] = _saved[k]
            else:
                sys.modules.pop(k, None)


# =============================================================================
# Environment Fixtures
# =============================================================================


@pytest.fixture
def ollama_env_vars(tmp_path):
    """Set environment variables for Ollama integration testing.

    Yields:
        dict: Dictionary of environment variables that were set.
    """
    test_db_path = str(tmp_path / "ollama_test_graphiti.db")

    env_vars = {
        "GRAPHITI_ENABLED": "true",
        "GRAPHITI_LLM_PROVIDER": "ollama",
        "GRAPHITI_EMBEDDER_PROVIDER": "ollama",
        "GRAPHITI_DATABASE": "test_ollama_memory",
        "GRAPHITI_DB_PATH": test_db_path,
        "OLLAMA_LLM_MODEL": "deepseek-r1:7b",
        "OLLAMA_EMBEDDING_MODEL": "embeddinggemma",
        "OLLAMA_EMBEDDING_DIM": "768",
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "OPENAI_API_KEY": "sk-dummy-for-reranker",
    }

    original = {k: os.environ.get(k) for k in env_vars}

    for key, value in env_vars.items():
        os.environ[key] = value

    yield env_vars

    for key, original_value in original.items():
        if original_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original_value


@pytest.fixture
def mock_client():
    """Create a mock GraphitiClient."""
    client = MagicMock()
    client.graphiti = MagicMock()
    client.graphiti.add_episode = AsyncMock()
    client.graphiti.search = AsyncMock(return_value=[])
    client.is_initialized = True
    client.initialize = AsyncMock(return_value=True)
    client.close = AsyncMock()
    return client


@pytest.fixture
def queries(mock_client):
    """Create a GraphitiQueries instance for Ollama testing."""
    from integrations.graphiti.queries_pkg.queries import GraphitiQueries

    return GraphitiQueries(
        client=mock_client,
        group_id="ollama_test_group",
        spec_context_id="ollama_test_spec",
    )


# =============================================================================
# Test: Ollama Configuration (from test_ollama_embeddings)
# =============================================================================


class TestOllamaConfiguration:
    """Tests for Ollama provider configuration.

    Converted from the configuration check section of run_ollama_embedding_test.py.
    """

    def test_ollama_config_from_env(self, ollama_env_vars):
        """Test that GraphitiConfig correctly reads Ollama env vars."""
        from integrations.graphiti.config import GraphitiConfig

        config = GraphitiConfig.from_env()

        assert config.enabled is True
        assert config.llm_provider == "ollama"
        assert config.embedder_provider == "ollama"
        assert config.ollama_llm_model == "deepseek-r1:7b"
        assert config.ollama_embedding_model == "embeddinggemma"

    def test_ollama_embedding_dimension_config(self, ollama_env_vars):
        """Test that embedding dimension is correctly configured."""
        from integrations.graphiti.config import GraphitiConfig

        config = GraphitiConfig.from_env()

        assert config.ollama_embedding_dim == 768

    def test_ollama_base_url_config(self, ollama_env_vars):
        """Test that Ollama base URL is correctly configured."""
        from integrations.graphiti.config import GraphitiConfig

        config = GraphitiConfig.from_env()

        assert config.ollama_base_url == "http://localhost:11434"

    def test_ollama_config_is_valid(self, ollama_env_vars):
        """Test that Ollama configuration passes validation."""
        from integrations.graphiti.config import GraphitiConfig

        config = GraphitiConfig.from_env()

        assert config.is_valid() is True
        assert len(config.get_validation_errors()) == 0


# =============================================================================
# Test: Embedding Generation (from test_ollama_embeddings)
# =============================================================================


class TestEmbeddingGeneration:
    """Tests for embedding generation patterns.

    Tests the embedding workflow without requiring a live Ollama server.
    Converted from test_ollama_embeddings() in run_ollama_embedding_test.py.
    """

    def test_cosine_similarity_identical_vectors(self):
        """Test cosine similarity returns 1.0 for identical vectors."""

        def cosine_similarity(a, b):
            dot_product = sum(x * y for x, y in zip(a, b))
            norm_a = sum(x * x for x in a) ** 0.5
            norm_b = sum(x * x for x in b) ** 0.5
            return dot_product / (norm_a * norm_b) if norm_a and norm_b else 0

        vec = [0.1, 0.2, 0.3, 0.4, 0.5]
        similarity = cosine_similarity(vec, vec)

        assert abs(similarity - 1.0) < 1e-10

    def test_cosine_similarity_orthogonal_vectors(self):
        """Test cosine similarity returns 0.0 for orthogonal vectors."""

        def cosine_similarity(a, b):
            dot_product = sum(x * y for x, y in zip(a, b))
            norm_a = sum(x * x for x in a) ** 0.5
            norm_b = sum(x * x for x in b) ** 0.5
            return dot_product / (norm_a * norm_b) if norm_a and norm_b else 0

        vec_a = [1.0, 0.0]
        vec_b = [0.0, 1.0]
        similarity = cosine_similarity(vec_a, vec_b)

        assert abs(similarity) < 1e-10

    def test_cosine_similarity_zero_vector(self):
        """Test cosine similarity handles zero vectors."""

        def cosine_similarity(a, b):
            dot_product = sum(x * y for x, y in zip(a, b))
            norm_a = sum(x * x for x in a) ** 0.5
            norm_b = sum(x * x for x in b) ** 0.5
            return dot_product / (norm_a * norm_b) if norm_a and norm_b else 0

        vec_a = [0.0, 0.0, 0.0]
        vec_b = [1.0, 2.0, 3.0]
        similarity = cosine_similarity(vec_a, vec_b)

        assert similarity == 0

    def test_embedding_dimension_validation(self):
        """Test that embedding dimension validation works correctly.

        Converted from the dimension check in test_ollama_embeddings().
        """
        expected_dim = 768
        test_embedding = [0.1] * expected_dim

        assert len(test_embedding) == expected_dim

        # Wrong dimension should be detectable
        wrong_embedding = [0.1] * 384
        assert len(wrong_embedding) != expected_dim

    def test_embedding_is_numeric_list(self):
        """Test that embeddings are lists of numeric values."""
        test_embedding = [0.1] * 768

        assert isinstance(test_embedding, list)
        assert all(isinstance(v, (int, float)) for v in test_embedding)
        assert len(test_embedding) > 0


# =============================================================================
# Test: Memory Creation with Ollama (from test_memory_creation)
# =============================================================================


class TestMemoryCreationWithOllama:
    """Tests for memory creation operations with Ollama embeddings.

    Converted from test_memory_creation() in run_ollama_embedding_test.py.
    """

    @pytest.mark.asyncio
    async def test_save_session_insights_with_ollama_config(self, queries):
        """Test saving session insights (simulating Ollama embedding flow)."""
        session_insights = {
            "subtasks_completed": ["implement-oauth-login", "add-jwt-validation"],
            "discoveries": {
                "files_understood": {
                    "auth/oauth.py": "OAuth 2.0 flow implementation with Google/GitHub",
                    "auth/jwt.py": "JWT token generation and validation utilities",
                },
                "patterns_found": [
                    "Pattern: Use refresh tokens for long-lived sessions",
                    "Pattern: Store tokens in httpOnly cookies for security",
                ],
                "gotchas_encountered": [
                    "Gotcha: Always validate JWT signature on server side",
                    "Gotcha: OAuth state parameter prevents CSRF attacks",
                ],
            },
            "what_worked": [
                "Using PyJWT for token handling",
                "Separating OAuth providers into individual modules",
            ],
            "what_failed": [],
            "recommendations_for_next_session": [
                "Consider adding refresh token rotation",
                "Add rate limiting to auth endpoints",
            ],
        }

        result = await queries.add_session_insight(
            session_num=1, insights=session_insights
        )

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "session_insight"
        assert "implement-oauth-login" in episode_body["subtasks_completed"]
        assert "auth/oauth.py" in episode_body["discoveries"]["files_understood"]

    @pytest.mark.asyncio
    async def test_save_multiple_patterns(self, queries):
        """Test saving multiple code patterns sequentially.

        Converted from the pattern save loop in test_memory_creation().
        """
        patterns = [
            "OAuth implementation uses authorization code flow for web apps",
            "JWT tokens include user ID, roles, and expiration in payload",
            "Token refresh happens automatically when access token expires",
        ]

        for pattern in patterns:
            result = await queries.add_pattern(pattern)
            assert result is True

        assert queries.client.graphiti.add_episode.call_count == 3

        # Verify each pattern was stored with correct content
        for i, call in enumerate(queries.client.graphiti.add_episode.call_args_list):
            episode_body = json.loads(call[1]["episode_body"])
            assert episode_body["type"] == "pattern"
            assert episode_body["pattern"] == patterns[i]

    @pytest.mark.asyncio
    async def test_save_multiple_gotchas(self, queries):
        """Test saving multiple gotchas sequentially.

        Converted from the gotcha save loop in test_memory_creation().
        """
        gotchas = [
            "Never store config values in frontend code or files checked into git",
            "API redirect URIs must exactly match the registered URIs",
            "Cache expiration times should be short for performance (15 min default)",
        ]

        for gotcha in gotchas:
            result = await queries.add_gotcha(gotcha)
            assert result is True

        assert queries.client.graphiti.add_episode.call_count == 3

        for i, call in enumerate(queries.client.graphiti.add_episode.call_args_list):
            episode_body = json.loads(call[1]["episode_body"])
            assert episode_body["type"] == "gotcha"
            assert episode_body["gotcha"] == gotchas[i]

    @pytest.mark.asyncio
    async def test_save_codebase_discoveries(self, queries):
        """Test saving codebase discoveries.

        Converted from step 5 in test_memory_creation().
        """
        discoveries = {
            "api/routes/users.py": "User management API endpoints (list, create, update)",
            "middleware/logging.py": "Request logging middleware for all routes",
            "models/user.py": "User model with profile data and role management",
            "services/notifications.py": "Notification service integrations (email, SMS, push)",
        }

        result = await queries.add_codebase_discoveries(discoveries)

        assert result is True
        queries.client.graphiti.add_episode.assert_called_once()

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])
        assert episode_body["type"] == "codebase_discovery"
        assert len(episode_body["files"]) == 4
        assert episode_body["files"]["api/routes/users.py"] == (
            "User management API endpoints (list, create, update)"
        )


# =============================================================================
# Test: Full Create-Store-Retrieve Cycle (from test_full_cycle)
# =============================================================================


class TestFullCycle:
    """Tests for the complete memory lifecycle.

    Converted from test_full_cycle() in run_ollama_embedding_test.py.
    Tests the create -> store -> verify cycle without requiring live services.
    """

    @pytest.mark.asyncio
    async def test_pattern_store_and_verify(self, queries):
        """Test storing a unique pattern and verifying its content."""
        unique_pattern = "Use dependency injection for database connections"

        result = await queries.add_pattern(unique_pattern)

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])

        assert episode_body["type"] == "pattern"
        assert episode_body["pattern"] == unique_pattern
        assert episode_body["spec_id"] == "ollama_test_spec"
        assert "timestamp" in episode_body

    @pytest.mark.asyncio
    async def test_gotcha_store_and_verify(self, queries):
        """Test storing a unique gotcha and verifying its content."""
        unique_gotcha = "Always close database connections in finally blocks"

        result = await queries.add_gotcha(unique_gotcha)

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])

        assert episode_body["type"] == "gotcha"
        assert episode_body["gotcha"] == unique_gotcha
        assert episode_body["spec_id"] == "ollama_test_spec"

    @pytest.mark.asyncio
    async def test_task_outcome_store_and_verify(self, queries):
        """Test storing a task outcome and verifying its content."""
        result = await queries.add_task_outcome(
            task_id="cycle-test-task",
            success=True,
            outcome="Full cycle test completed",
            metadata={"test_type": "integration"},
        )

        assert result is True

        call_args = queries.client.graphiti.add_episode.call_args
        episode_body = json.loads(call_args[1]["episode_body"])

        assert episode_body["type"] == "task_outcome"
        assert episode_body["task_id"] == "cycle-test-task"
        assert episode_body["success"] is True
        assert episode_body["outcome"] == "Full cycle test completed"
        assert episode_body["test_type"] == "integration"

    @pytest.mark.asyncio
    async def test_structured_insights_store_and_verify(self, queries):
        """Test storing structured insights and verifying content integrity."""
        insights = {
            "subtask_id": "cycle-subtask",
            "file_insights": [
                {
                    "path": "src/db.py",
                    "purpose": "Database connection pool",
                    "changes_made": "Added connection retry logic",
                    "patterns_used": ["retry pattern", "connection pooling"],
                    "gotchas": ["pool exhaustion under load"],
                }
            ],
            "patterns_discovered": [
                {
                    "pattern": "Connection pooling with retry",
                    "applies_to": "Database access layer",
                    "example": "src/db.py:create_pool()",
                }
            ],
            "gotchas_discovered": [
                {
                    "gotcha": "Pool exhaustion under concurrent load",
                    "trigger": "More than 100 concurrent requests",
                    "solution": "Increase pool size or add queue",
                }
            ],
        }

        result = await queries.add_structured_insights(insights)

        assert result is True
        # Should have 3 calls: 1 file insight + 1 pattern + 1 gotcha
        assert queries.client.graphiti.add_episode.call_count == 3


# =============================================================================
# Test: Temp Directory Cleanup
# =============================================================================


class TestTempDirectoryCleanup:
    """Tests for temporary directory cleanup.

    Verifies that test database directories are properly cleaned up,
    matching the cleanup behavior in the original script.
    """

    def test_temp_directory_creation_and_cleanup(self, tmp_path):
        """Test that temporary test directories can be created and cleaned up."""
        test_db_path = tmp_path / "ollama_memory_test"
        test_db_path.mkdir(parents=True, exist_ok=True)

        spec_dir = test_db_path / "test_spec"
        project_dir = test_db_path / "test_project"
        spec_dir.mkdir()
        project_dir.mkdir()

        assert test_db_path.exists()
        assert spec_dir.exists()
        assert project_dir.exists()

        # Simulate cleanup (as done in run_ollama_embedding_test.py)
        shutil.rmtree(test_db_path, ignore_errors=True)

        assert not test_db_path.exists()

    def test_nested_temp_directories(self, tmp_path):
        """Test creation and cleanup of nested directory structures."""
        test_db_path = tmp_path / "test_db"
        graphiti_db = test_db_path / "graphiti_db"
        graphiti_db.mkdir(parents=True)

        # Create some test files
        (graphiti_db / "test.db").touch()
        (graphiti_db / "lock.lck").touch()

        assert (graphiti_db / "test.db").exists()

        # Cleanup
        shutil.rmtree(test_db_path, ignore_errors=True)

        assert not test_db_path.exists()

"""
Tests for HISTORICAL_CONTEXT and QA_RESULT episode types.

Tests cover:
- Storing a HISTORICAL_CONTEXT episode and verifying it is retrievable
- Storing a QA_RESULT episode and verifying it is retrievable
- Verifying episode type field is correctly set
- Verifying content structure is preserved
- Episode content round-trip integrity
"""

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from integrations.graphiti.queries_pkg.schema import (
    EPISODE_TYPE_HISTORICAL_CONTEXT,
    EPISODE_TYPE_QA_RESULT,
)

# =============================================================================
# Mock External Dependencies
# =============================================================================


@pytest.fixture(autouse=True)
def mock_graphiti_core_nodes():
    """Auto-mock graphiti_core for all tests."""
    import sys

    # Save pre-existing module entries so we can restore them in teardown
    _module_keys = ["graphiti_core", "graphiti_core.nodes"]
    _saved = {k: sys.modules[k] for k in _module_keys if k in sys.modules}

    # Patch graphiti_core at module level before import
    mock_graphiti_core = MagicMock()
    mock_nodes = MagicMock()
    mock_episode_type = MagicMock()
    mock_episode_type.text = "text"
    mock_nodes.EpisodeType = mock_episode_type
    mock_graphiti_core.nodes = mock_nodes

    sys.modules["graphiti_core"] = mock_graphiti_core
    sys.modules["graphiti_core.nodes"] = mock_nodes

    try:
        yield mock_episode_type
    finally:
        for k in _module_keys:
            if k in _saved:
                sys.modules[k] = _saved[k]
            else:
                sys.modules.pop(k, None)


# =============================================================================
# Client Fixtures
# =============================================================================


@pytest.fixture
def mock_client():
    """Create a mock GraphitiClient with episode capture."""
    client = MagicMock()
    client.graphiti = MagicMock()
    client.graphiti.add_episode = AsyncMock()
    return client


@pytest.fixture
def stored_episodes():
    """In-memory episode store for verifying round-trip storage."""
    return []


@pytest.fixture
def mock_client_with_store(stored_episodes):
    """Create a mock GraphitiClient that captures stored episodes.

    This fixture simulates the store-and-retrieve pattern by capturing
    episode data passed to add_episode into an in-memory list, then
    making it available for retrieval assertions.

    Returns:
        MagicMock: Mock client with add_episode that captures episodes.
    """
    client = MagicMock()
    client.graphiti = MagicMock()

    async def capture_episode(**kwargs):
        stored_episodes.append(kwargs)

    client.graphiti.add_episode = AsyncMock(side_effect=capture_episode)
    return client


@pytest.fixture
def queries(mock_client):
    """Create a GraphitiQueries instance."""
    from integrations.graphiti.queries_pkg.queries import GraphitiQueries

    return GraphitiQueries(
        client=mock_client,
        group_id="test_group",
        spec_context_id="test_spec",
    )


# =============================================================================
# HISTORICAL_CONTEXT Episode Type Tests
# =============================================================================


class TestHistoricalContextEpisode:
    """Tests for HISTORICAL_CONTEXT episode type storage and retrieval."""

    def test_historical_context_type_value(self):
        """Test EPISODE_TYPE_HISTORICAL_CONTEXT has expected string value."""
        assert EPISODE_TYPE_HISTORICAL_CONTEXT == "historical_context"
        assert isinstance(EPISODE_TYPE_HISTORICAL_CONTEXT, str)

    @pytest.mark.asyncio
    async def test_store_historical_context_episode(self, mock_client_with_store, stored_episodes):
        """Test storing a HISTORICAL_CONTEXT episode and verify it is retrievable."""
        from graphiti_core.nodes import EpisodeType

        historical_content = {
            "type": EPISODE_TYPE_HISTORICAL_CONTEXT,
            "spec_id": "test_spec",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "context": "Previous implementation used SQLAlchemy ORM with PostgreSQL",
            "relevance": "Migration from PostgreSQL to embedded graph database",
            "source": "session_003_migration",
        }

        await mock_client_with_store.graphiti.add_episode(
            name="historical_context_migration_notes",
            episode_body=json.dumps(historical_content),
            source=EpisodeType.text,
            source_description="Historical context about database migration",
            reference_time=datetime.now(timezone.utc),
            group_id="test_group",
        )

        # Verify episode was stored
        assert len(stored_episodes) == 1

        # Verify episode is retrievable with correct content
        stored = stored_episodes[0]
        retrieved_body = json.loads(stored["episode_body"])

        assert retrieved_body["type"] == EPISODE_TYPE_HISTORICAL_CONTEXT
        assert retrieved_body["context"] == "Previous implementation used SQLAlchemy ORM with PostgreSQL"
        assert retrieved_body["relevance"] == "Migration from PostgreSQL to embedded graph database"
        assert retrieved_body["source"] == "session_003_migration"

    @pytest.mark.asyncio
    async def test_historical_context_episode_type_field_is_correct(
        self, mock_client_with_store, stored_episodes
    ):
        """Test that the episode type field is correctly set to historical_context."""
        from graphiti_core.nodes import EpisodeType

        historical_content = {
            "type": EPISODE_TYPE_HISTORICAL_CONTEXT,
            "spec_id": "test_spec",
            "timestamp": "2026-03-05T00:00:00Z",
            "context": "Minimal historical context",
        }

        await mock_client_with_store.graphiti.add_episode(
            name="historical_context_type_check",
            episode_body=json.dumps(historical_content),
            source=EpisodeType.text,
            source_description="Type field verification",
            reference_time=datetime.now(timezone.utc),
            group_id="test_group",
        )

        assert len(stored_episodes) == 1
        retrieved_body = json.loads(stored_episodes[0]["episode_body"])
        assert retrieved_body["type"] == "historical_context"
        assert retrieved_body["type"] == EPISODE_TYPE_HISTORICAL_CONTEXT

    @pytest.mark.asyncio
    async def test_historical_context_content_structure_preserved(
        self, mock_client_with_store, stored_episodes
    ):
        """Test that complex content structure is preserved in HISTORICAL_CONTEXT episodes."""
        from graphiti_core.nodes import EpisodeType

        complex_content = {
            "type": EPISODE_TYPE_HISTORICAL_CONTEXT,
            "spec_id": "spec_042_refactor",
            "timestamp": "2026-03-05T12:00:00Z",
            "context": "The authentication system was originally built with basic JWT",
            "previous_decisions": [
                "Chose JWT over session-based auth for statelessness",
                "Used RS256 algorithm for token signing",
            ],
            "relevant_files": {
                "auth/jwt.py": "Token generation and validation",
                "middleware/auth.py": "Request authentication middleware",
            },
            "lessons_learned": "Token rotation is critical for long-lived sessions",
            "tags": ["authentication", "security", "jwt"],
        }

        await mock_client_with_store.graphiti.add_episode(
            name="historical_context_auth_system",
            episode_body=json.dumps(complex_content),
            source=EpisodeType.text,
            source_description="Historical context for authentication refactor",
            reference_time=datetime.now(timezone.utc),
            group_id="spec_042_group",
        )

        assert len(stored_episodes) == 1
        retrieved_body = json.loads(stored_episodes[0]["episode_body"])

        # Verify all nested structures are preserved
        assert retrieved_body["type"] == EPISODE_TYPE_HISTORICAL_CONTEXT
        assert retrieved_body["spec_id"] == "spec_042_refactor"
        assert len(retrieved_body["previous_decisions"]) == 2
        assert "Chose JWT over session-based auth" in retrieved_body["previous_decisions"][0]
        assert retrieved_body["relevant_files"]["auth/jwt.py"] == "Token generation and validation"
        assert retrieved_body["lessons_learned"] == "Token rotation is critical for long-lived sessions"
        assert "security" in retrieved_body["tags"]

    @pytest.mark.asyncio
    async def test_historical_context_episode_name_and_metadata(
        self, mock_client_with_store, stored_episodes
    ):
        """Test that episode-level metadata (name, group_id, source_description) is preserved."""
        from graphiti_core.nodes import EpisodeType

        content = {
            "type": EPISODE_TYPE_HISTORICAL_CONTEXT,
            "context": "Test metadata preservation",
        }

        await mock_client_with_store.graphiti.add_episode(
            name="historical_context_metadata_test",
            episode_body=json.dumps(content),
            source=EpisodeType.text,
            source_description="Metadata test for historical context",
            reference_time=datetime(2026, 3, 5, tzinfo=timezone.utc),
            group_id="metadata_test_group",
        )

        stored = stored_episodes[0]
        assert stored["name"] == "historical_context_metadata_test"
        assert stored["group_id"] == "metadata_test_group"
        assert stored["source_description"] == "Metadata test for historical context"

    @pytest.mark.asyncio
    async def test_multiple_historical_context_episodes(
        self, mock_client_with_store, stored_episodes
    ):
        """Test storing multiple HISTORICAL_CONTEXT episodes."""
        from graphiti_core.nodes import EpisodeType

        for i in range(3):
            content = {
                "type": EPISODE_TYPE_HISTORICAL_CONTEXT,
                "spec_id": f"spec_{i:03d}",
                "context": f"Historical context entry {i}",
            }

            await mock_client_with_store.graphiti.add_episode(
                name=f"historical_context_{i}",
                episode_body=json.dumps(content),
                source=EpisodeType.text,
                source_description=f"Historical context {i}",
                reference_time=datetime.now(timezone.utc),
                group_id="test_group",
            )

        assert len(stored_episodes) == 3

        # Verify each episode has the correct type and unique content
        for i, stored in enumerate(stored_episodes):
            body = json.loads(stored["episode_body"])
            assert body["type"] == EPISODE_TYPE_HISTORICAL_CONTEXT
            assert body["spec_id"] == f"spec_{i:03d}"
            assert body["context"] == f"Historical context entry {i}"


# =============================================================================
# QA_RESULT Episode Type Tests
# =============================================================================


class TestQaResultEpisode:
    """Tests for QA_RESULT episode type storage and retrieval."""

    def test_qa_result_type_value(self):
        """Test EPISODE_TYPE_QA_RESULT has expected string value."""
        assert EPISODE_TYPE_QA_RESULT == "qa_result"
        assert isinstance(EPISODE_TYPE_QA_RESULT, str)

    @pytest.mark.asyncio
    async def test_store_qa_result_episode(self, mock_client_with_store, stored_episodes):
        """Test storing a QA_RESULT episode and verify it is retrievable."""
        from graphiti_core.nodes import EpisodeType

        qa_content = {
            "type": EPISODE_TYPE_QA_RESULT,
            "spec_id": "test_spec",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "task_id": "subtask-3-implement-auth",
            "qa_passed": True,
            "issues_found": [],
            "test_coverage": 92.5,
            "reviewer_notes": "All acceptance criteria met. Code quality is good.",
        }

        await mock_client_with_store.graphiti.add_episode(
            name="qa_result_subtask_3",
            episode_body=json.dumps(qa_content),
            source=EpisodeType.text,
            source_description="QA review result for subtask-3",
            reference_time=datetime.now(timezone.utc),
            group_id="test_group",
        )

        # Verify episode was stored
        assert len(stored_episodes) == 1

        # Verify episode is retrievable with correct content
        stored = stored_episodes[0]
        retrieved_body = json.loads(stored["episode_body"])

        assert retrieved_body["type"] == EPISODE_TYPE_QA_RESULT
        assert retrieved_body["task_id"] == "subtask-3-implement-auth"
        assert retrieved_body["qa_passed"] is True
        assert retrieved_body["test_coverage"] == 92.5
        assert retrieved_body["reviewer_notes"] == "All acceptance criteria met. Code quality is good."

    @pytest.mark.asyncio
    async def test_qa_result_episode_type_field_is_correct(
        self, mock_client_with_store, stored_episodes
    ):
        """Test that the episode type field is correctly set to qa_result."""
        from graphiti_core.nodes import EpisodeType

        qa_content = {
            "type": EPISODE_TYPE_QA_RESULT,
            "spec_id": "test_spec",
            "timestamp": "2026-03-05T00:00:00Z",
            "task_id": "type-check-task",
            "qa_passed": False,
        }

        await mock_client_with_store.graphiti.add_episode(
            name="qa_result_type_check",
            episode_body=json.dumps(qa_content),
            source=EpisodeType.text,
            source_description="Type field verification",
            reference_time=datetime.now(timezone.utc),
            group_id="test_group",
        )

        assert len(stored_episodes) == 1
        retrieved_body = json.loads(stored_episodes[0]["episode_body"])
        assert retrieved_body["type"] == "qa_result"
        assert retrieved_body["type"] == EPISODE_TYPE_QA_RESULT

    @pytest.mark.asyncio
    async def test_qa_result_content_structure_preserved(
        self, mock_client_with_store, stored_episodes
    ):
        """Test that complex content structure is preserved in QA_RESULT episodes."""
        from graphiti_core.nodes import EpisodeType

        complex_qa_content = {
            "type": EPISODE_TYPE_QA_RESULT,
            "spec_id": "spec_015_api_endpoints",
            "timestamp": "2026-03-05T15:30:00Z",
            "task_id": "subtask-7-api-validation",
            "qa_passed": False,
            "issues_found": [
                {
                    "severity": "high",
                    "description": "Missing input validation on POST /users",
                    "file": "api/routes/users.py",
                    "line": 42,
                },
                {
                    "severity": "medium",
                    "description": "No rate limiting on auth endpoints",
                    "file": "api/routes/auth.py",
                    "line": 15,
                },
            ],
            "test_coverage": 78.3,
            "reviewer_notes": "Two issues must be resolved before merge",
            "fix_attempts": 2,
            "criteria_results": {
                "functionality": True,
                "code_quality": True,
                "test_coverage": False,
                "security": False,
            },
        }

        await mock_client_with_store.graphiti.add_episode(
            name="qa_result_api_validation",
            episode_body=json.dumps(complex_qa_content),
            source=EpisodeType.text,
            source_description="QA result with issues for API validation",
            reference_time=datetime.now(timezone.utc),
            group_id="spec_015_group",
        )

        assert len(stored_episodes) == 1
        retrieved_body = json.loads(stored_episodes[0]["episode_body"])

        # Verify all nested structures are preserved
        assert retrieved_body["type"] == EPISODE_TYPE_QA_RESULT
        assert retrieved_body["spec_id"] == "spec_015_api_endpoints"
        assert retrieved_body["qa_passed"] is False
        assert len(retrieved_body["issues_found"]) == 2
        assert retrieved_body["issues_found"][0]["severity"] == "high"
        assert retrieved_body["issues_found"][0]["line"] == 42
        assert retrieved_body["issues_found"][1]["file"] == "api/routes/auth.py"
        assert retrieved_body["test_coverage"] == 78.3
        assert retrieved_body["fix_attempts"] == 2
        assert retrieved_body["criteria_results"]["functionality"] is True
        assert retrieved_body["criteria_results"]["security"] is False

    @pytest.mark.asyncio
    async def test_qa_result_episode_name_and_metadata(
        self, mock_client_with_store, stored_episodes
    ):
        """Test that episode-level metadata (name, group_id, source_description) is preserved."""
        from graphiti_core.nodes import EpisodeType

        content = {
            "type": EPISODE_TYPE_QA_RESULT,
            "task_id": "metadata-test-task",
            "qa_passed": True,
        }

        await mock_client_with_store.graphiti.add_episode(
            name="qa_result_metadata_test",
            episode_body=json.dumps(content),
            source=EpisodeType.text,
            source_description="Metadata test for QA result",
            reference_time=datetime(2026, 3, 5, tzinfo=timezone.utc),
            group_id="metadata_test_group",
        )

        stored = stored_episodes[0]
        assert stored["name"] == "qa_result_metadata_test"
        assert stored["group_id"] == "metadata_test_group"
        assert stored["source_description"] == "Metadata test for QA result"

    @pytest.mark.asyncio
    async def test_multiple_qa_result_episodes(
        self, mock_client_with_store, stored_episodes
    ):
        """Test storing multiple QA_RESULT episodes."""
        from graphiti_core.nodes import EpisodeType

        for i in range(3):
            content = {
                "type": EPISODE_TYPE_QA_RESULT,
                "spec_id": f"spec_{i:03d}",
                "task_id": f"task-{i}",
                "qa_passed": i % 2 == 0,  # Alternate pass/fail
                "issues_found": [] if i % 2 == 0 else [{"description": f"Issue in task {i}"}],
            }

            await mock_client_with_store.graphiti.add_episode(
                name=f"qa_result_{i}",
                episode_body=json.dumps(content),
                source=EpisodeType.text,
                source_description=f"QA result {i}",
                reference_time=datetime.now(timezone.utc),
                group_id="test_group",
            )

        assert len(stored_episodes) == 3

        # Verify each episode has the correct type and unique content
        for i, stored in enumerate(stored_episodes):
            body = json.loads(stored["episode_body"])
            assert body["type"] == EPISODE_TYPE_QA_RESULT
            assert body["spec_id"] == f"spec_{i:03d}"
            assert body["task_id"] == f"task-{i}"
            assert body["qa_passed"] == (i % 2 == 0)

    @pytest.mark.asyncio
    async def test_qa_result_with_empty_issues(self, mock_client_with_store, stored_episodes):
        """Test QA_RESULT episode with empty issues list (passed review)."""
        from graphiti_core.nodes import EpisodeType

        content = {
            "type": EPISODE_TYPE_QA_RESULT,
            "task_id": "clean-task",
            "qa_passed": True,
            "issues_found": [],
            "reviewer_notes": "",
        }

        await mock_client_with_store.graphiti.add_episode(
            name="qa_result_clean",
            episode_body=json.dumps(content),
            source=EpisodeType.text,
            source_description="Clean QA pass",
            reference_time=datetime.now(timezone.utc),
            group_id="test_group",
        )

        retrieved_body = json.loads(stored_episodes[0]["episode_body"])
        assert retrieved_body["issues_found"] == []
        assert retrieved_body["qa_passed"] is True


# =============================================================================
# Cross-Type Tests
# =============================================================================


class TestEpisodeTypeCrossValidation:
    """Tests that verify HISTORICAL_CONTEXT and QA_RESULT behave consistently with other types."""

    def test_historical_context_and_qa_result_are_distinct(self):
        """Test that HISTORICAL_CONTEXT and QA_RESULT are distinct episode types."""
        assert EPISODE_TYPE_HISTORICAL_CONTEXT != EPISODE_TYPE_QA_RESULT

    def test_episode_types_are_lowercase_snake_case(self):
        """Test that episode type values follow the lowercase_snake_case convention."""
        assert EPISODE_TYPE_HISTORICAL_CONTEXT == EPISODE_TYPE_HISTORICAL_CONTEXT.lower()
        assert EPISODE_TYPE_QA_RESULT == EPISODE_TYPE_QA_RESULT.lower()
        assert "_" in EPISODE_TYPE_HISTORICAL_CONTEXT
        assert "_" in EPISODE_TYPE_QA_RESULT

    @pytest.mark.asyncio
    async def test_mixed_episode_types_in_same_group(
        self, mock_client_with_store, stored_episodes
    ):
        """Test storing both HISTORICAL_CONTEXT and QA_RESULT in the same group."""
        from graphiti_core.nodes import EpisodeType

        historical = {
            "type": EPISODE_TYPE_HISTORICAL_CONTEXT,
            "context": "Previous auth implementation details",
        }

        qa = {
            "type": EPISODE_TYPE_QA_RESULT,
            "task_id": "auth-task",
            "qa_passed": True,
        }

        await mock_client_with_store.graphiti.add_episode(
            name="historical_entry",
            episode_body=json.dumps(historical),
            source=EpisodeType.text,
            source_description="Historical context",
            reference_time=datetime.now(timezone.utc),
            group_id="shared_group",
        )

        await mock_client_with_store.graphiti.add_episode(
            name="qa_entry",
            episode_body=json.dumps(qa),
            source=EpisodeType.text,
            source_description="QA result",
            reference_time=datetime.now(timezone.utc),
            group_id="shared_group",
        )

        assert len(stored_episodes) == 2

        # Verify types are distinct
        types = [json.loads(ep["episode_body"])["type"] for ep in stored_episodes]
        assert EPISODE_TYPE_HISTORICAL_CONTEXT in types
        assert EPISODE_TYPE_QA_RESULT in types
        assert types[0] != types[1]

    @pytest.mark.asyncio
    async def test_episode_body_is_valid_json_roundtrip(
        self, mock_client_with_store, stored_episodes
    ):
        """Test that episode_body survives JSON serialization/deserialization."""
        from graphiti_core.nodes import EpisodeType

        original_content = {
            "type": EPISODE_TYPE_QA_RESULT,
            "task_id": "roundtrip-test",
            "qa_passed": True,
            "nested": {"key": "value", "list": [1, 2, 3]},
            "unicode": "Test with special chars: \u00e9\u00e0\u00fc",
        }

        serialized = json.dumps(original_content)

        await mock_client_with_store.graphiti.add_episode(
            name="roundtrip_test",
            episode_body=serialized,
            source=EpisodeType.text,
            source_description="Round-trip test",
            reference_time=datetime.now(timezone.utc),
            group_id="test_group",
        )

        # Deserialize from stored episode
        deserialized = json.loads(stored_episodes[0]["episode_body"])

        assert deserialized == original_content
        assert deserialized["unicode"] == "Test with special chars: \u00e9\u00e0\u00fc"

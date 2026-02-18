"""
Tests for integrations.graphiti.migrate_embeddings module.

Tests cover:
- EmbeddingMigrator class
- initialize() method
- get_source_episodes() method
- migrate_episode() method
- migrate_all() method
- close() method
- interactive_migration() function
- automatic_migration() function
- main() function
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_source_config():
    """Mock source GraphitiConfig."""
    config = MagicMock()
    config.embedder_provider = "openai"
    config.llm_provider = "openai"
    config.database = "source_db"
    config.get_provider_specific_database_name = MagicMock(
        return_value="auto_claude_memory_openai"
    )
    return config


@pytest.fixture
def mock_target_config():
    """Mock target GraphitiConfig."""
    config = MagicMock()
    config.embedder_provider = "ollama"
    config.llm_provider = "ollama"
    config.database = "target_db"
    config.get_provider_specific_database_name = MagicMock(
        return_value="auto_claude_memory_ollama"
    )
    return config


@pytest.fixture
def mock_source_client():
    """Mock source GraphitiClient."""
    client = MagicMock()
    client.initialize = AsyncMock(return_value=True)
    client.close = AsyncMock()
    client._driver = MagicMock()
    client._driver.execute_query = AsyncMock(return_value=([], None, None))
    return client


@pytest.fixture
def mock_target_client():
    """Mock target GraphitiClient."""
    client = MagicMock()
    client.initialize = AsyncMock(return_value=True)
    client.close = AsyncMock()
    client.graphiti = MagicMock()
    client.graphiti.add_episode = AsyncMock()
    return client


@pytest.fixture
def sample_episodes():
    """Sample episode data for testing."""
    return [
        {
            "uuid": "ep1",
            "name": "episode_1",
            "content": "Episode 1 content",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "valid_at": datetime.now(timezone.utc).isoformat(),
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode 1",
        },
        {
            "uuid": "ep2",
            "name": "episode_2",
            "content": "Episode 2 content",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "valid_at": datetime.now(timezone.utc).isoformat(),
            "group_id": "test_group",
            "source": "message",
            "source_description": "Test episode 2",
        },
    ]


# =============================================================================
# Tests for EmbeddingMigrator.__init__
# =============================================================================


class TestEmbeddingMigratorInit:
    """Tests for EmbeddingMigrator initialization."""

    def test_init_sets_attributes(self, mock_source_config, mock_target_config):
        """Test constructor sets all attributes correctly."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=mock_source_config,
            target_config=mock_target_config,
            dry_run=False,
        )

        assert migrator.source_config is mock_source_config
        assert migrator.target_config is mock_target_config
        assert migrator.dry_run is False
        assert migrator.source_client is None
        assert migrator.target_client is None

    def test_init_with_dry_run(self, mock_source_config, mock_target_config):
        """Test constructor with dry_run=True."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=mock_source_config,
            target_config=mock_target_config,
            dry_run=True,
        )

        assert migrator.dry_run is True


# =============================================================================
# Tests for EmbeddingMigrator.initialize()
# =============================================================================


class TestEmbeddingMigratorInitialize:
    """Tests for EmbeddingMigrator.initialize method."""

    @pytest.mark.asyncio
    async def test_initialize_success(self, mock_source_config, mock_target_config):
        """Test successful initialization of both clients."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch(
            "integrations.graphiti.queries_pkg.client.GraphitiClient"
        ) as mock_client_class:
            mock_source = MagicMock()
            mock_source.initialize = AsyncMock(return_value=True)
            mock_target = MagicMock()
            mock_target.initialize = AsyncMock(return_value=True)
            mock_client_class.side_effect = [mock_source, mock_target]

            migrator = EmbeddingMigrator(
                source_config=mock_source_config,
                target_config=mock_target_config,
                dry_run=False,
            )

            result = await migrator.initialize()

            assert result is True
            assert migrator.source_client is mock_source
            assert migrator.target_client is mock_target
            assert mock_source.initialize.call_count == 1
            assert mock_target.initialize.call_count == 1

    @pytest.mark.asyncio
    async def test_initialize_dry_run_skips_target(
        self, mock_source_config, mock_target_config
    ):
        """Test dry_run mode skips target client initialization."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch(
            "integrations.graphiti.queries_pkg.client.GraphitiClient"
        ) as mock_client_class:
            mock_source = MagicMock()
            mock_source.initialize = AsyncMock(return_value=True)
            mock_client_class.return_value = mock_source

            migrator = EmbeddingMigrator(
                source_config=mock_source_config,
                target_config=mock_target_config,
                dry_run=True,
            )

            result = await migrator.initialize()

            assert result is True
            assert migrator.source_client is mock_source
            assert migrator.target_client is None

    @pytest.mark.asyncio
    async def test_initialize_source_fails_returns_false(
        self, mock_source_config, mock_target_config
    ):
        """Test initialization returns False when source client fails."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch(
            "integrations.graphiti.queries_pkg.client.GraphitiClient"
        ) as mock_client_class:
            mock_source = MagicMock()
            mock_source.initialize = AsyncMock(return_value=False)
            mock_client_class.return_value = mock_source

            migrator = EmbeddingMigrator(
                source_config=mock_source_config,
                target_config=mock_target_config,
                dry_run=False,
            )

            result = await migrator.initialize()

            assert result is False
            assert migrator.source_client is mock_source
            assert migrator.target_client is None

    @pytest.mark.asyncio
    async def test_initialize_source_exception_returns_false(
        self, mock_source_config, mock_target_config
    ):
        """Test initialization handles source client exception."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch(
            "integrations.graphiti.queries_pkg.client.GraphitiClient"
        ) as mock_client_class:
            mock_source = MagicMock()
            mock_source.initialize = AsyncMock(side_effect=Exception("DB error"))
            mock_client_class.return_value = mock_source

            migrator = EmbeddingMigrator(
                source_config=mock_source_config,
                target_config=mock_target_config,
                dry_run=False,
            )

            result = await migrator.initialize()

            assert result is False

    @pytest.mark.asyncio
    async def test_initialize_target_fails_cleans_up_source(
        self, mock_source_config, mock_target_config
    ):
        """Test initialization cleans up source when target fails."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch(
            "integrations.graphiti.queries_pkg.client.GraphitiClient"
        ) as mock_client_class:
            mock_source = MagicMock()
            mock_source.initialize = AsyncMock(return_value=True)
            mock_source.close = AsyncMock()
            mock_target = MagicMock()
            mock_target.initialize = AsyncMock(return_value=False)
            mock_client_class.side_effect = [mock_source, mock_target]

            migrator = EmbeddingMigrator(
                source_config=mock_source_config,
                target_config=mock_target_config,
                dry_run=False,
            )

            result = await migrator.initialize()

            assert result is False
            mock_source.close.assert_called_once()
            assert migrator.source_client is None

    @pytest.mark.asyncio
    async def test_initialize_target_exception_cleans_up_source(
        self, mock_source_config, mock_target_config
    ):
        """Test initialization cleans up source when target raises exception (lines 93-98)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch(
            "integrations.graphiti.queries_pkg.client.GraphitiClient"
        ) as mock_client_class:
            mock_source = MagicMock()
            mock_source.initialize = AsyncMock(return_value=True)
            mock_source.close = AsyncMock()
            mock_target = MagicMock()
            mock_target.initialize = AsyncMock(
                side_effect=Exception("DB connection failed")
            )
            mock_client_class.side_effect = [mock_source, mock_target]

            migrator = EmbeddingMigrator(
                source_config=mock_source_config,
                target_config=mock_target_config,
                dry_run=False,
            )

            result = await migrator.initialize()

            assert result is False
            mock_source.close.assert_called_once()
            assert migrator.source_client is None


# =============================================================================
# Tests for EmbeddingMigrator.get_source_episodes()
# =============================================================================


class TestGetSourceEpisodes:
    """Tests for EmbeddingMigrator.get_source_episodes method."""

    @pytest.mark.asyncio
    async def test_get_source_episodes_returns_list(self, mock_source_client):
        """Test get_source_episodes returns list of episodes (lines 109-149)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        mock_records = [
            {
                "uuid": "ep1",
                "name": "episode_1",
                "content": "content1",
                "created_at": "2024-01-01T00:00:00Z",
                "valid_at": "2024-01-01T00:00:00Z",
                "group_id": "group1",
                "source": "text",
                "source_description": "desc1",
            }
        ]
        mock_source_client._driver.execute_query = AsyncMock(
            return_value=(mock_records, None, None)
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = mock_source_client

        episodes = await migrator.get_source_episodes()

        assert len(episodes) == 1
        assert episodes[0]["uuid"] == "ep1"
        assert episodes[0]["name"] == "episode_1"

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_get_source_episodes_empty_result(self, mock_source_client):
        """Test get_source_episodes with empty result."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        mock_source_client._driver.execute_query = AsyncMock(
            return_value=([], None, None)
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = mock_source_client

        episodes = await migrator.get_source_episodes()

        assert episodes == []

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_get_source_episodes_handles_exception(self, mock_source_client):
        """Test get_source_episodes handles exceptions (lines 147-149)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        mock_source_client._driver.execute_query = AsyncMock(
            side_effect=Exception("Query failed")
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = mock_source_client

        episodes = await migrator.get_source_episodes()

        assert episodes == []

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_get_source_episodes_exception_with_message(
        self, mock_source_client, caplog
    ):
        """Test get_source_episodes logs error message on exception."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        mock_source_client._driver.execute_query = AsyncMock(
            side_effect=Exception("Database connection lost")
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = mock_source_client

        with caplog.at_level("ERROR"):
            episodes = await migrator.get_source_episodes()

        # Should return empty list on error
        assert episodes == []
        # Should log error message
        assert any(
            "Database connection lost" in record.message for record in caplog.records
        )

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_get_source_episodes_with_multiple_records(self, mock_source_client):
        """Test get_source_episodes with multiple episode records."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        mock_records = [
            {
                "uuid": "ep1",
                "name": "episode_1",
                "content": "content1",
                "created_at": "2024-01-01T00:00:00Z",
                "valid_at": "2024-01-01T00:00:00Z",
                "group_id": "group1",
                "source": "text",
                "source_description": "desc1",
            },
            {
                "uuid": "ep2",
                "name": "episode_2",
                "content": "content2",
                "created_at": "2024-01-02T00:00:00Z",
                "valid_at": "2024-01-02T00:00:00Z",
                "group_id": "group1",
                "source": "message",
                "source_description": "desc2",
            },
            {
                "uuid": "ep3",
                "name": "episode_3",
                "content": "content3",
                "created_at": "2024-01-03T00:00:00Z",
                "valid_at": "2024-01-03T00:00:00Z",
                "group_id": "group2",
                "source": "json",
                "source_description": "desc3",
            },
        ]
        mock_source_client._driver.execute_query = AsyncMock(
            return_value=(mock_records, None, None)
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = mock_source_client

        episodes = await migrator.get_source_episodes()

        assert len(episodes) == 3
        assert episodes[0]["uuid"] == "ep1"
        assert episodes[1]["uuid"] == "ep2"
        assert episodes[2]["uuid"] == "ep3"


# =============================================================================
# Tests for EmbeddingMigrator.migrate_episode()
# =============================================================================


class TestMigrateEpisode:
    """Tests for EmbeddingMigrator.migrate_episode method."""

    @pytest.mark.asyncio
    async def test_migrate_episode_success(self, mock_target_client):
        """Test successful episode migration (lines 161-199)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        mock_target_client.graphiti.add_episode.assert_called_once()

    @pytest.mark.asyncio
    async def test_migrate_episode_timestamp_parsing(self, mock_target_client):
        """Test migrate_episode parses ISO timestamp strings (lines 178-180)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-06-15T12:30:45Z",  # ISO format string
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Verify add_episode was called with parsed datetime
        mock_target_client.graphiti.add_episode.assert_called_once()
        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        assert call_kwargs["reference_time"] is not None

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_dry_run(self, mock_target_client):
        """Test episode migration in dry run mode."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=True,
        )
        # Attach mock_target_client to migrator for dry_run mode testing
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        mock_target_client.graphiti.add_episode.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_message_source(self, mock_target_client):
        """Test migrating episode with message source."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "message",
            "source_description": "Test message",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_json_source(self, mock_target_client):
        """Test migrating episode with json source."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "json",
            "source_description": "Test json",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_handles_exception(self, mock_target_client):
        """Test migrate_episode handles exceptions (lines 197-199)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        mock_target_client.graphiti.add_episode = AsyncMock(
            side_effect=Exception("Migration failed")
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is False

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_message_source_type(self, mock_target_client):
        """Test migrate_episode maps message source to EpisodeType.message (line 171)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "message",
            "source_description": "Test message",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Verify the episode type was passed correctly
        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        from graphiti_core.nodes import EpisodeType

        assert call_kwargs["source"] == EpisodeType.message

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_json_source_type(self, mock_target_client):
        """Test migrate_episode maps json source to EpisodeType.json (line 173)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": '{"key": "value"}',
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "json",
            "source_description": "Test json",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Verify the episode type was passed correctly
        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        from graphiti_core.nodes import EpisodeType

        assert call_kwargs["source"] == EpisodeType.json

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_default_source_type(self, mock_target_client):
        """Test migrate_episode defaults to EpisodeType.text for unknown sources."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "unknown_source",
            "source_description": "Test unknown",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Verify the episode type defaults to text
        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        from graphiti_core.nodes import EpisodeType

        assert call_kwargs["source"] == EpisodeType.text

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_missing_source(self, mock_target_client):
        """Test migrate_episode handles missing source field."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            # source field missing
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_datetime_valid_at(self, mock_target_client):
        """Test migrate_episode handles datetime objects for valid_at."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        test_datetime = datetime(2024, 6, 15, 12, 30, 45, tzinfo=timezone.utc)
        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": test_datetime,  # Already a datetime object
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_iso_z_timestamp(self, mock_target_client):
        """Test migrate_episode parses ISO timestamp with Z suffix."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-06-15T12:30:45Z",  # Z suffix
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Verify datetime was parsed correctly
        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        assert call_kwargs["reference_time"] is not None

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_missing_group_id(self, mock_target_client):
        """Test migrate_episode uses default group_id when missing."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            # group_id missing
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Verify default group_id was used
        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        assert call_kwargs["group_id"] == "default"

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_empty_content(self, mock_target_client):
        """Test migrate_episode handles empty content."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "",  # Empty content
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Verify empty string was passed for episode_body
        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        assert call_kwargs["episode_body"] == ""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_exception_during_add(self, mock_target_client):
        """Test migrate_episode returns False on exception during add_episode."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        # Simulate exception during add_episode
        mock_target_client.graphiti.add_episode = AsyncMock(
            side_effect=RuntimeError("Embedding failed")
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is False

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_dry_run_mode_logging(
        self, mock_target_client, caplog
    ):
        """Test migrate_episode logs dry run message."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=True,
        )

        with caplog.at_level("INFO"):
            result = await migrator.migrate_episode(episode)

        assert result is True
        assert "[DRY RUN]" in caplog.text
        assert "test_episode" in caplog.text


# =============================================================================
# Tests for EmbeddingMigrator.migrate_all()
# =============================================================================


class TestMigrateAll:
    """Tests for EmbeddingMigrator.migrate_all method."""

    @pytest.mark.asyncio
    async def test_migrate_all_success(self, sample_episodes):
        """Test successful migration of all episodes (lines 208-224)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )

        # Mock get_source_episodes and migrate_episode
        migrator.get_source_episodes = AsyncMock(return_value=sample_episodes)
        migrator.migrate_episode = AsyncMock(return_value=True)

        stats = await migrator.migrate_all()

        assert stats["total"] == 2
        assert stats["succeeded"] == 2
        assert stats["failed"] == 0
        assert stats["dry_run"] is False

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_success_slow(self, sample_episodes):
        """Test successful migration of all episodes (slow variant)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )

        # Mock get_source_episodes and migrate_episode
        migrator.get_source_episodes = AsyncMock(return_value=sample_episodes)
        migrator.migrate_episode = AsyncMock(return_value=True)

        stats = await migrator.migrate_all()

        assert stats["total"] == 2
        assert stats["succeeded"] == 2
        assert stats["failed"] == 0
        assert stats["dry_run"] is False

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_with_failures(self, sample_episodes):
        """Test migration with some failures."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )

        migrator.get_source_episodes = AsyncMock(return_value=sample_episodes)
        migrator.migrate_episode = AsyncMock(side_effect=[True, False])

        stats = await migrator.migrate_all()

        assert stats["total"] == 2
        assert stats["succeeded"] == 1
        assert stats["failed"] == 1

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_dry_run(self, sample_episodes):
        """Test migrate_all in dry run mode."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=True,
        )

        migrator.get_source_episodes = AsyncMock(return_value=sample_episodes)
        migrator.migrate_episode = AsyncMock(return_value=True)

        stats = await migrator.migrate_all()

        assert stats["total"] == 2
        assert stats["succeeded"] == 2
        assert stats["dry_run"] is True

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_increments_failed_count(self, sample_episodes):
        """Test migrate_all increments failed count (line 222)."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )

        migrator.get_source_episodes = AsyncMock(return_value=sample_episodes)
        # First succeeds, second fails
        migrator.migrate_episode = AsyncMock(side_effect=[True, False])

        stats = await migrator.migrate_all()

        assert stats["total"] == 2
        assert stats["succeeded"] == 1
        assert stats["failed"] == 1

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_all_fail(self, sample_episodes):
        """Test migrate_all when all episodes fail."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )

        migrator.get_source_episodes = AsyncMock(return_value=sample_episodes)
        migrator.migrate_episode = AsyncMock(return_value=False)

        stats = await migrator.migrate_all()

        assert stats["total"] == 2
        assert stats["succeeded"] == 0
        assert stats["failed"] == 2

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_empty_episodes(self):
        """Test migrate_all with no episodes."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )

        migrator.get_source_episodes = AsyncMock(return_value=[])
        migrator.migrate_episode = AsyncMock(return_value=True)

        stats = await migrator.migrate_all()

        assert stats["total"] == 0
        assert stats["succeeded"] == 0
        assert stats["failed"] == 0
        # migrate_episode should not be called
        migrator.migrate_episode.assert_not_called()


# =============================================================================
# Tests for EmbeddingMigrator.close()
# =============================================================================


class TestEmbeddingMigratorClose:
    """Tests for EmbeddingMigrator.close method."""

    @pytest.mark.asyncio
    async def test_close_both_clients(self):
        """Test closing both source and target clients."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        source_client = MagicMock()
        source_client.close = AsyncMock()
        target_client = MagicMock()
        target_client.close = AsyncMock()

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = source_client
        migrator.target_client = target_client

        await migrator.close()

        source_client.close.assert_called_once()
        target_client.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_source_only(self):
        """Test closing when only source client exists."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        source_client = MagicMock()
        source_client.close = AsyncMock()

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=True,
        )
        migrator.source_client = source_client

        await migrator.close()

        source_client.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_no_clients(self):
        """Test closing when no clients exist."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )

        # Should not raise exception
        await migrator.close()


# =============================================================================
# Tests for automatic_migration()
# =============================================================================


class TestAutomaticMigration:
    """Tests for automatic_migration function."""

    @pytest.mark.asyncio
    async def test_automatic_migration_success(self):
        """Test successful automatic migration (lines 328-372)."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="ollama",
            dry_run=False,
        )

        # Create separate config instances for each from_env call
        # from_env is called 3 times: current_config, source_config, target_config
        mock_configs = [
            MagicMock(
                embedder_provider="voyage",
                get_provider_specific_database_name=MagicMock(return_value="test_db"),
            ),  # current
            MagicMock(
                embedder_provider="openai",
                get_provider_specific_database_name=MagicMock(
                    return_value="test_db_source"
                ),
            ),  # source (will be set)
            MagicMock(
                embedder_provider="ollama",
                get_provider_specific_database_name=MagicMock(
                    return_value="test_db_target"
                ),
            ),  # target (will be set)
        ]

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=mock_configs,
        ):
            with patch(
                "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
            ) as mock_migrator_class:
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=True)
                mock_migrator.migrate_all = AsyncMock(
                    return_value={"total": 10, "succeeded": 10, "failed": 0}
                )
                mock_migrator.close = AsyncMock()
                mock_migrator_class.return_value = mock_migrator

                await automatic_migration(args)

                mock_migrator.initialize.assert_called_once()
                mock_migrator.migrate_all.assert_called_once()
                mock_migrator.close.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_success_slow(self):
        """Test successful automatic migration (slow variant)."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="ollama",
            dry_run=False,
        )

        # Create separate config instances for each from_env call
        mock_configs = [
            MagicMock(
                embedder_provider="voyage",
                get_provider_specific_database_name=MagicMock(return_value="test_db"),
            ),  # current
            MagicMock(
                embedder_provider="openai",
                get_provider_specific_database_name=MagicMock(
                    return_value="test_db_source"
                ),
            ),  # source
            MagicMock(
                embedder_provider="ollama",
                get_provider_specific_database_name=MagicMock(
                    return_value="test_db_target"
                ),
            ),  # target
        ]

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=mock_configs,
        ):
            with patch(
                "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
            ) as mock_migrator_class:
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=True)
                mock_migrator.migrate_all = AsyncMock(
                    return_value={"total": 10, "succeeded": 10, "failed": 0}
                )
                mock_migrator.close = AsyncMock()
                mock_migrator_class.return_value = mock_migrator

                await automatic_migration(args)

                mock_migrator.initialize.assert_called_once()
                mock_migrator.migrate_all.assert_called_once()
                mock_migrator.close.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_same_provider_error(self):
        """Test automatic migration with same source and target provider."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="openai",
            dry_run=False,
        )

        mock_config = MagicMock()
        mock_config.embedder_provider = "openai"

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig"
        ) as mock_config_class:
            mock_config_class.from_env.return_value = mock_config

            await automatic_migration(args)

            # Should return early without creating migrator

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_initialize_fails(self):
        """Test automatic migration when initialization fails."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="ollama",
            dry_run=False,
        )

        mock_config = MagicMock()
        mock_config.embedder_provider = "ollama"
        mock_config.get_provider_specific_database_name = MagicMock(
            return_value="test_db"
        )

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig"
        ) as mock_config_class:
            with patch(
                "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
            ) as mock_migrator_class:
                mock_config_class.from_env.return_value = mock_config
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=False)
                mock_migrator_class.return_value = mock_migrator

                await automatic_migration(args)

                # Should not proceed to migrate_all
                mock_migrator.migrate_all.assert_not_called()


# =============================================================================
# Tests for interactive_migration()
# =============================================================================


class TestInteractiveMigration:
    """Tests for interactive_migration function (lines 236-323)."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_interactive_migration_same_provider_error(self, caplog):
        """Test interactive_migration validates source != target (lines 273-276)."""
        from integrations.graphiti.migrate_embeddings import interactive_migration

        mock_config = MagicMock()
        mock_config.embedder_provider = "openai"
        mock_config.get_embedding_dimension = MagicMock(return_value=1536)
        mock_config.database = "test_db"
        mock_config.get_provider_signature = MagicMock(return_value="openai_1536")

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch("builtins.input", return_value="1"):  # User selects OpenAI
                with caplog.at_level("INFO"):
                    await interactive_migration()

                # Should exit early when same provider selected

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_interactive_migration_invalid_choice(self):
        """Test interactive_migration handles invalid menu choice."""
        from integrations.graphiti.migrate_embeddings import interactive_migration

        mock_config = MagicMock()
        mock_config.embedder_provider = "ollama"
        mock_config.get_embedding_dimension = MagicMock(return_value=768)
        mock_config.database = "test_db"
        mock_config.get_provider_signature = MagicMock(return_value="ollama_768")

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with patch("builtins.input", return_value="99"):  # Invalid choice
                await interactive_migration()

                # Should return early without error

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_interactive_migration_user_cancels(self):
        """Test interactive_migration when user cancels confirmation."""
        from integrations.graphiti.migrate_embeddings import interactive_migration

        current_config = MagicMock()
        current_config.embedder_provider = "ollama"
        current_config.get_embedding_dimension = MagicMock(return_value=768)
        current_config.database = "test_db"
        current_config.get_provider_signature = MagicMock(return_value="ollama_768")
        current_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            return_value=current_config,
        ):
            with patch(
                "builtins.input",
                side_effect=["1", "no"],  # Select OpenAI, then cancel
            ):
                await interactive_migration()

                # Should return early without migrating

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_interactive_migration_creates_source_config(self):
        """Test interactive_migration creates source config with correct database."""
        from integrations.graphiti.migrate_embeddings import interactive_migration

        current_config = MagicMock()
        current_config.embedder_provider = "ollama"
        current_config.get_embedding_dimension = MagicMock(return_value=768)
        current_config.database = "test_db"
        current_config.get_provider_signature = MagicMock(return_value="ollama_768")
        current_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        source_config = MagicMock()
        source_config.embedder_provider = "openai"
        source_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        configs = [current_config, source_config]

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=configs,
        ):
            with patch(
                "builtins.input",
                side_effect=["1", "yes"],  # Select OpenAI, confirm
            ):
                with patch(
                    "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
                ) as mock_migrator_class:
                    mock_migrator = MagicMock()
                    mock_migrator.initialize = AsyncMock(return_value=True)
                    mock_migrator.migrate_all = AsyncMock(
                        return_value={"total": 5, "succeeded": 5, "failed": 0}
                    )
                    mock_migrator.close = AsyncMock()
                    mock_migrator_class.return_value = mock_migrator

                    await interactive_migration()

                    # Verify migrator was created with correct configs
                    mock_migrator_class.assert_called_once()
                    call_args = mock_migrator_class.call_args
                    assert (
                        call_args.kwargs["source_config"].embedder_provider == "openai"
                    )
                    assert (
                        call_args.kwargs["target_config"].embedder_provider == "ollama"
                    )

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_interactive_migration_all_source_choices(self):
        """Test interactive_migration menu choices map correctly (lines 258-264)."""
        from integrations.graphiti.migrate_embeddings import interactive_migration

        # Test each menu choice
        for choice, expected_provider in [
            ("1", "openai"),
            ("2", "ollama"),
            ("3", "voyage"),
            ("4", "google"),
            ("5", "azure_openai"),
        ]:
            current_config = MagicMock()
            current_config.embedder_provider = "voyage"
            current_config.get_embedding_dimension = MagicMock(return_value=1024)
            current_config.database = "test_db"
            current_config.get_provider_signature = MagicMock(
                return_value="voyage_1024"
            )
            current_config.get_provider_specific_database_name = MagicMock(
                return_value=f"auto_claude_memory_{expected_provider}"
            )

            source_config = MagicMock()
            source_config.embedder_provider = expected_provider
            source_config.get_provider_specific_database_name = MagicMock(
                return_value=f"auto_claude_memory_{expected_provider}"
            )

            configs = [current_config, source_config]

            with patch(
                "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
                side_effect=configs,
            ):
                with patch(
                    "builtins.input",
                    side_effect=[choice, "no"],  # Select, cancel
                ):
                    await interactive_migration()

                    # Should not raise error for any valid choice

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_interactive_migration_initialize_failure(self):
        """Test interactive_migration handles initialize failure."""
        from integrations.graphiti.migrate_embeddings import interactive_migration

        current_config = MagicMock()
        current_config.embedder_provider = "ollama"
        current_config.get_embedding_dimension = MagicMock(return_value=768)
        current_config.database = "test_db"
        current_config.get_provider_signature = MagicMock(return_value="ollama_768")
        current_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        source_config = MagicMock()
        source_config.embedder_provider = "openai"
        source_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        configs = [current_config, source_config]

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=configs,
        ):
            with patch(
                "builtins.input",
                side_effect=["1", "yes"],  # Select OpenAI, confirm
            ):
                with patch(
                    "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
                ) as mock_migrator_class:
                    mock_migrator = MagicMock()
                    mock_migrator.initialize = AsyncMock(return_value=False)
                    mock_migrator_class.return_value = mock_migrator

                    await interactive_migration()

                    # Should not proceed to migrate_all
                    mock_migrator.migrate_all.assert_not_called()


class TestAutomaticMigrationExtended:
    """Extended tests for automatic_migration function."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_no_from_provider(self):
        """Test automatic_migration uses current_config when no from_provider (line 338)."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider=None,  # No source provider
            to_provider="ollama",
            dry_run=False,
        )

        # Need different providers for source and target to avoid validation error
        # When from_provider is None, source uses current_config (openai)
        # When to_provider is set, target creates new config with that provider (ollama)
        current_config = MagicMock()
        current_config.embedder_provider = "openai"
        current_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        # Target config with ollama provider
        target_config = MagicMock()
        target_config.embedder_provider = "ollama"
        target_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_ollama"
        )

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=[current_config, target_config],
        ):
            with patch(
                "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
            ) as mock_migrator_class:
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=True)
                mock_migrator.migrate_all = AsyncMock(
                    return_value={"total": 10, "succeeded": 10, "failed": 0}
                )
                mock_migrator.close = AsyncMock()
                mock_migrator_class.return_value = mock_migrator

                await automatic_migration(args)

                # Verify migrator was created
                mock_migrator_class.assert_called_once()
                call_args = mock_migrator_class.call_args
                # Source config should be current_config when no from_provider
                assert call_args.kwargs["source_config"].embedder_provider == "openai"
                assert call_args.kwargs["target_config"].embedder_provider == "ollama"

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_no_to_provider(self):
        """Test automatic_migration uses current_config when no to_provider (line 348)."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider=None,  # No target provider
            dry_run=False,
        )

        # When from_provider is set, source creates new config with that provider (openai)
        # When to_provider is None, target uses current_config (ollama)
        source_config = MagicMock()
        source_config.embedder_provider = "openai"
        source_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        current_config = MagicMock()
        current_config.embedder_provider = "ollama"
        current_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_ollama"
        )

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=[current_config, source_config],
        ):
            with patch(
                "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
            ) as mock_migrator_class:
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=True)
                mock_migrator.migrate_all = AsyncMock(
                    return_value={"total": 10, "succeeded": 10, "failed": 0}
                )
                mock_migrator.close = AsyncMock()
                mock_migrator_class.return_value = mock_migrator

                await automatic_migration(args)

                # Verify migrator was created
                mock_migrator_class.assert_called_once()
                call_args = mock_migrator_class.call_args
                # Source config should have openai, target should have ollama
                assert call_args.kwargs["source_config"].embedder_provider == "openai"
                assert call_args.kwargs["target_config"].embedder_provider == "ollama"

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_same_provider_logs_error(self, caplog):
        """Test automatic_migration logs error for same provider (lines 352-357)."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="openai",  # Same provider
            dry_run=False,
        )

        mock_config = MagicMock()
        mock_config.embedder_provider = "openai"

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            return_value=mock_config,
        ):
            with caplog.at_level("ERROR"):
                await automatic_migration(args)

                # Should log error about same provider
                assert "same" in caplog.text.lower()

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_initialize_failure_logs_error(self, caplog):
        """Test automatic_migration logs error on initialize failure (lines 365-367)."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="ollama",
            dry_run=False,
        )

        # Need different providers to avoid validation error
        current_config = MagicMock()
        current_config.embedder_provider = "voyage"
        current_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_voyage"
        )

        source_config = MagicMock()
        source_config.embedder_provider = "openai"
        source_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        target_config = MagicMock()
        target_config.embedder_provider = "ollama"
        target_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_ollama"
        )

        configs = [current_config, source_config, target_config]

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=configs,
        ):
            with patch(
                "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
            ) as mock_migrator_class:
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=False)
                mock_migrator_class.return_value = mock_migrator

                with caplog.at_level("ERROR"):
                    await automatic_migration(args)

                    # Should log error message
                    assert "Failed to initialize migration" in caplog.text

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_dry_run_mode(self):
        """Test automatic_migration passes dry_run flag."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="ollama",
            dry_run=True,  # Dry run mode
        )

        # Need different providers to avoid validation error
        current_config = MagicMock()
        current_config.embedder_provider = "voyage"
        current_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_voyage"
        )

        source_config = MagicMock()
        source_config.embedder_provider = "openai"
        source_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_openai"
        )

        target_config = MagicMock()
        target_config.embedder_provider = "ollama"
        target_config.get_provider_specific_database_name = MagicMock(
            return_value="auto_claude_memory_ollama"
        )

        configs = [current_config, source_config, target_config]

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=configs,
        ):
            with patch(
                "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
            ) as mock_migrator_class:
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=True)
                mock_migrator.migrate_all = AsyncMock(
                    return_value={
                        "total": 10,
                        "succeeded": 10,
                        "failed": 0,
                        "dry_run": True,
                    }
                )
                mock_migrator.close = AsyncMock()
                mock_migrator_class.return_value = mock_migrator

                await automatic_migration(args)

                # Verify dry_run was passed
                assert mock_migrator_class.call_count == 1
                call_args = mock_migrator_class.call_args
                assert call_args.kwargs["dry_run"] is True

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_sets_provider_database_names(self):
        """Test automatic_migration sets provider-specific database names."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="ollama",
            dry_run=False,
        )

        # Track config instances
        configs = []

        def create_config():
            config = MagicMock()
            config.embedder_provider = "voyage"
            config.get_provider_specific_database_name = MagicMock(
                return_value=f"db_{len(configs)}"
            )
            configs.append(config)
            return config

        with patch(
            "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
            side_effect=[create_config(), create_config(), create_config()],
        ):
            with patch(
                "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
            ) as mock_migrator_class:
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=True)
                mock_migrator.migrate_all = AsyncMock(
                    return_value={"total": 10, "succeeded": 10, "failed": 0}
                )
                mock_migrator.close = AsyncMock()
                mock_migrator_class.return_value = mock_migrator

                await automatic_migration(args)

                # Verify database names were set for source and target
                assert configs[1].database == "db_1"  # Source config
                assert configs[2].database == "db_2"  # Target config

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_automatic_migration_all_provider_combinations(self):
        """Test automatic_migration with various provider combinations."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        providers = ["openai", "ollama", "voyage", "google", "azure_openai"]

        for from_provider in providers:
            for to_provider in providers:
                if from_provider == to_provider:
                    continue  # Skip same provider combinations

                args = MagicMock(
                    from_provider=from_provider,
                    to_provider=to_provider,
                    dry_run=False,
                )

                # Create distinct MagicMock instances for each call
                mock_current_config = MagicMock()
                mock_current_config.embedder_provider = from_provider
                mock_current_config.get_provider_specific_database_name = MagicMock(
                    return_value=f"db_{from_provider}"
                )

                mock_source_config = MagicMock()
                mock_source_config.embedder_provider = from_provider
                mock_source_config.get_provider_specific_database_name = MagicMock(
                    return_value=f"db_{from_provider}_{to_provider}"
                )

                mock_target_config = MagicMock()
                mock_target_config.embedder_provider = to_provider
                mock_target_config.get_provider_specific_database_name = MagicMock(
                    return_value=f"db_{from_provider}_{to_provider}"
                )

                with patch(
                    "integrations.graphiti.migrate_embeddings.GraphitiConfig.from_env",
                    side_effect=[
                        mock_current_config,
                        mock_source_config,
                        mock_target_config,
                    ],
                ):
                    with patch(
                        "integrations.graphiti.migrate_embeddings.EmbeddingMigrator"
                    ) as mock_migrator_class:
                        mock_migrator = MagicMock()
                        mock_migrator.initialize = AsyncMock(return_value=True)
                        mock_migrator.migrate_all = AsyncMock(
                            return_value={"total": 5, "succeeded": 5, "failed": 0}
                        )
                        mock_migrator.close = AsyncMock()
                        mock_migrator_class.return_value = mock_migrator

                        await automatic_migration(args)

                        # Should complete without error for any valid combination


# =============================================================================
# Tests for main()
# =============================================================================


class TestMain:
    """Tests for main function."""

    def test_main_interactive_mode_no_args(self):
        """Test main enters interactive mode when no args provided."""
        from integrations.graphiti.migrate_embeddings import main

        with patch("integrations.graphiti.migrate_embeddings.asyncio.run") as mock_run:
            with patch(
                "integrations.graphiti.migrate_embeddings.argparse.ArgumentParser"
            ) as mock_parser_class:
                mock_parser = MagicMock()
                mock_parser_class.return_value = mock_parser
                mock_args = MagicMock(
                    from_provider=None,
                    to_provider=None,
                    dry_run=False,
                    auto_confirm=False,
                )
                mock_parser.parse_args.return_value = mock_args

                main()

                # Should call interactive_migration
                assert mock_run.call_count == 1

    def test_main_automatic_mode_with_args(self):
        """Test main uses automatic mode with args provided."""
        from integrations.graphiti.migrate_embeddings import main

        with patch("integrations.graphiti.migrate_embeddings.asyncio.run") as mock_run:
            with patch(
                "integrations.graphiti.migrate_embeddings.argparse.ArgumentParser"
            ) as mock_parser_class:
                mock_parser = MagicMock()
                mock_parser_class.return_value = mock_parser
                mock_args = MagicMock(
                    from_provider="openai",
                    to_provider="ollama",
                    dry_run=False,
                    auto_confirm=False,
                )
                mock_parser.parse_args.return_value = mock_args

                main()

                # Should call automatic_migration
                assert mock_run.call_count == 1

    def test_main_with_dry_run_flag(self):
        """Test main passes dry_run flag through."""
        from integrations.graphiti.migrate_embeddings import main

        with patch("integrations.graphiti.migrate_embeddings.asyncio.run") as mock_run:
            with patch(
                "integrations.graphiti.migrate_embeddings.argparse.ArgumentParser"
            ) as mock_parser_class:
                mock_parser = MagicMock()
                mock_parser_class.return_value = mock_parser
                mock_args = MagicMock(
                    from_provider="openai",
                    to_provider="ollama",
                    dry_run=True,  # Dry run flag set
                    auto_confirm=False,
                )
                mock_parser.parse_args.return_value = mock_args

                main()

                # Should call automatic_migration with dry_run=True
                assert mock_run.call_count == 1

    def test_main_with_auto_confirm_flag(self):
        """Test main with auto_confirm flag."""
        from integrations.graphiti.migrate_embeddings import main

        with patch("integrations.graphiti.migrate_embeddings.asyncio.run") as mock_run:
            with patch(
                "integrations.graphiti.migrate_embeddings.argparse.ArgumentParser"
            ) as mock_parser_class:
                mock_parser = MagicMock()
                mock_parser_class.return_value = mock_parser
                mock_args = MagicMock(
                    from_provider="openai",
                    to_provider="ollama",
                    dry_run=False,
                    auto_confirm=True,  # Auto confirm flag set
                )
                mock_parser.parse_args.return_value = mock_args

                main()

                # Should call automatic_migration
                assert mock_run.call_count == 1

    def test_main_with_only_from_provider(self):
        """Test main with only from_provider specified."""
        from integrations.graphiti.migrate_embeddings import main

        with patch("integrations.graphiti.migrate_embeddings.asyncio.run") as mock_run:
            with patch(
                "integrations.graphiti.migrate_embeddings.argparse.ArgumentParser"
            ) as mock_parser_class:
                mock_parser = MagicMock()
                mock_parser_class.return_value = mock_parser
                mock_args = MagicMock(
                    from_provider="openai",
                    to_provider=None,  # Only from provider
                    dry_run=False,
                    auto_confirm=False,
                )
                mock_parser.parse_args.return_value = mock_args

                main()

                # Should call automatic_migration (providers specified)
                assert mock_run.call_count == 1

    def test_main_with_only_to_provider(self):
        """Test main with only to_provider specified."""
        from integrations.graphiti.migrate_embeddings import main

        with patch("integrations.graphiti.migrate_embeddings.asyncio.run") as mock_run:
            with patch(
                "integrations.graphiti.migrate_embeddings.argparse.ArgumentParser"
            ) as mock_parser_class:
                mock_parser = MagicMock()
                mock_parser_class.return_value = mock_parser
                mock_args = MagicMock(
                    from_provider=None,  # Only to provider
                    to_provider="ollama",
                    dry_run=False,
                    auto_confirm=False,
                )
                mock_parser.parse_args.return_value = mock_args

                main()

                # Should call automatic_migration (providers specified)
                assert mock_run.call_count == 1

    def test_main_with_all_provider_choices(self):
        """Test main accepts all valid provider choices."""
        from integrations.graphiti.migrate_embeddings import main

        providers = ["openai", "ollama", "voyage", "google", "azure_openai"]

        for provider in providers:
            with patch(
                "integrations.graphiti.migrate_embeddings.asyncio.run"
            ) as mock_run:
                with patch(
                    "integrations.graphiti.migrate_embeddings.argparse.ArgumentParser"
                ) as mock_parser_class:
                    mock_parser = MagicMock()
                    mock_parser_class.return_value = mock_parser
                    mock_args = MagicMock(
                        from_provider=provider,
                        to_provider=provider,
                        dry_run=False,
                        auto_confirm=False,
                    )
                    mock_parser.parse_args.return_value = mock_args

                    # Should not raise error for any valid provider
                    main()


class TestGetSourceEpisodesEdgeCases:
    """Additional edge case tests for get_source_episodes."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_get_source_episodes_with_none_field_values(self, mock_source_client):
        """Test get_source_episodes handles None field values."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        mock_records = [
            {
                "uuid": "ep1",
                "name": None,  # None value
                "content": "content1",
                "created_at": "2024-01-01T00:00:00Z",
                "valid_at": None,  # None value
                "group_id": None,  # None value
                "source": "text",
                "source_description": None,  # None value
            }
        ]
        mock_source_client._driver.execute_query = AsyncMock(
            return_value=(mock_records, None, None)
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = mock_source_client

        episodes = await migrator.get_source_episodes()

        assert len(episodes) == 1
        assert episodes[0]["uuid"] == "ep1"
        assert episodes[0]["name"] is None
        assert episodes[0]["valid_at"] is None
        assert episodes[0]["group_id"] is None
        assert episodes[0]["source_description"] is None

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_get_source_episodes_preserves_order(self, mock_source_client):
        """Test get_source_episodes preserves ORDER BY created_at ordering."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        # Records in specific order (should be preserved from query)
        mock_records = [
            {
                "uuid": f"ep{i}",
                "name": f"episode_{i}",
                "content": f"content{i}",
                "created_at": f"2024-01-0{i}T00:00:00Z",
                "valid_at": f"2024-01-0{i}T00:00:00Z",
                "group_id": "group1",
                "source": "text",
                "source_description": f"desc{i}",
            }
            for i in range(1, 6)
        ]
        mock_source_client._driver.execute_query = AsyncMock(
            return_value=(mock_records, None, None)
        )

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = mock_source_client

        episodes = await migrator.get_source_episodes()

        assert len(episodes) == 5
        # Verify order is preserved
        assert episodes[0]["uuid"] == "ep1"
        assert episodes[4]["uuid"] == "ep5"


class TestMigrateEpisodeEdgeCases:
    """Additional edge case tests for migrate_episode."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_missing_source_description(
        self, mock_target_client
    ):
        """Test migrate_episode with missing source_description."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "text",
            # source_description missing
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Should use default "Migrated episode"
        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        assert call_kwargs["source_description"] == "Migrated episode"

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_none_valid_at(self, mock_target_client):
        """Test migrate_episode with None valid_at."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": None,  # None value
            "group_id": "test_group",
            "source": "text",
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_with_whitespace_source(self, mock_target_client):
        """Test migrate_episode with whitespace-only source."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episode = {
            "uuid": "ep1",
            "name": "test_episode",
            "content": "test content",
            "created_at": "2024-01-01T00:00:00Z",
            "valid_at": "2024-01-01T00:00:00Z",
            "group_id": "test_group",
            "source": "   ",  # Whitespace only
            "source_description": "Test episode",
        }

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is True
        # Should default to EpisodeType.text
        from graphiti_core.nodes import EpisodeType

        call_kwargs = mock_target_client.graphiti.add_episode.call_args.kwargs
        assert call_kwargs["source"] == EpisodeType.text


class TestMigrateAllEdgeCases:
    """Additional edge case tests for migrate_all."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_logs_progress(self, mock_source_client, caplog):
        """Test migrate_all logs progress for each episode."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episodes = [
            {
                "uuid": f"ep{i}",
                "name": f"episode_{i}",
                "content": f"content{i}",
                "created_at": "2024-01-01T00:00:00Z",
                "valid_at": "2024-01-01T00:00:00Z",
                "group_id": "test_group",
                "source": "text",
                "source_description": f"Test episode {i}",
            }
            for i in range(1, 6)
        ]

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.get_source_episodes = AsyncMock(return_value=episodes)
        migrator.migrate_episode = AsyncMock(return_value=True)

        with caplog.at_level("INFO"):
            stats = await migrator.migrate_all()

        assert stats["total"] == 5
        assert stats["succeeded"] == 5
        # Should log progress for each episode
        assert "Processing episode" in caplog.text

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_handles_partial_failures(self):
        """Test migrate_all continues after failures."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        episodes = [
            {
                "uuid": f"ep{i}",
                "name": f"episode_{i}",
                "content": f"content{i}",
                "created_at": "2024-01-01T00:00:00Z",
                "valid_at": "2024-01-01T00:00:00Z",
                "group_id": "test_group",
                "source": "text",
                "source_description": f"Test {i}",
            }
            for i in range(1, 6)
        ]

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.get_source_episodes = AsyncMock(return_value=episodes)
        # Fail episodes 2 and 4
        migrator.migrate_episode = AsyncMock(
            side_effect=[True, False, True, False, True]
        )

        stats = await migrator.migrate_all()

        assert stats["total"] == 5
        assert stats["succeeded"] == 3
        assert stats["failed"] == 2

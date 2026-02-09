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

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

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
    config.get_provider_specific_database_name = MagicMock(return_value="auto_claude_memory_openai")
    return config


@pytest.fixture
def mock_target_config():
    """Mock target GraphitiConfig."""
    config = MagicMock()
    config.embedder_provider = "ollama"
    config.llm_provider = "ollama"
    config.database = "target_db"
    config.get_provider_specific_database_name = MagicMock(return_value="auto_claude_memory_ollama")
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

        with patch("integrations.graphiti.migrate_embeddings.GraphitiClient") as mock_client_class:
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
    async def test_initialize_dry_run_skips_target(self, mock_source_config, mock_target_config):
        """Test dry_run mode skips target client initialization."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch("integrations.graphiti.migrate_embeddings.GraphitiClient") as mock_client_class:
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
    async def test_initialize_source_fails_returns_false(self, mock_source_config, mock_target_config):
        """Test initialization returns False when source client fails."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch("integrations.graphiti.migrate_embeddings.GraphitiClient") as mock_client_class:
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
    async def test_initialize_source_exception_returns_false(self, mock_source_config, mock_target_config):
        """Test initialization handles source client exception."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch("integrations.graphiti.migrate_embeddings.GraphitiClient") as mock_client_class:
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
    async def test_initialize_target_fails_cleans_up_source(self, mock_source_config, mock_target_config):
        """Test initialization cleans up source when target fails."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        with patch("integrations.graphiti.migrate_embeddings.GraphitiClient") as mock_client_class:
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


# =============================================================================
# Tests for EmbeddingMigrator.get_source_episodes()
# =============================================================================


class TestGetSourceEpisodes:
    """Tests for EmbeddingMigrator.get_source_episodes method."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_get_source_episodes_returns_list(self, mock_source_client):
        """Test get_source_episodes returns list of episodes."""
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
        mock_source_client._driver.execute_query = AsyncMock(return_value=(mock_records, None, None))

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

        mock_source_client._driver.execute_query = AsyncMock(return_value=([], None, None))

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
        """Test get_source_episodes handles exceptions."""
        from integrations.graphiti.migrate_embeddings import EmbeddingMigrator

        mock_source_client._driver.execute_query = AsyncMock(side_effect=Exception("Query failed"))

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.source_client = mock_source_client

        episodes = await migrator.get_source_episodes()

        assert episodes == []


# =============================================================================
# Tests for EmbeddingMigrator.migrate_episode()
# =============================================================================


class TestMigrateEpisode:
    """Tests for EmbeddingMigrator.migrate_episode method."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_episode_success(self, mock_target_client):
        """Test successful episode migration."""
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
        """Test migrate_episode handles exceptions."""
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

        mock_target_client.graphiti.add_episode = AsyncMock(side_effect=Exception("Migration failed"))

        migrator = EmbeddingMigrator(
            source_config=MagicMock(),
            target_config=MagicMock(),
            dry_run=False,
        )
        migrator.target_client = mock_target_client

        result = await migrator.migrate_episode(episode)

        assert result is False


# =============================================================================
# Tests for EmbeddingMigrator.migrate_all()
# =============================================================================


class TestMigrateAll:
    """Tests for EmbeddingMigrator.migrate_all method."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_migrate_all_success(self, sample_episodes):
        """Test successful migration of all episodes."""
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
    @pytest.mark.slow
    async def test_automatic_migration_success(self):
        """Test successful automatic migration."""
        from integrations.graphiti.migrate_embeddings import automatic_migration

        args = MagicMock(
            from_provider="openai",
            to_provider="ollama",
            dry_run=False,
        )

        mock_config = MagicMock()
        mock_config.embedder_provider = "ollama"
        mock_config.get_provider_specific_database_name = MagicMock(return_value="test_db")

        with patch("integrations.graphiti.migrate_embeddings.GraphitiConfig") as mock_config_class:
            with patch("integrations.graphiti.migrate_embeddings.EmbeddingMigrator") as mock_migrator_class:
                mock_config_class.from_env.return_value = mock_config
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=True)
                mock_migrator.migrate_all = AsyncMock(return_value={"total": 10, "succeeded": 10, "failed": 0})
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

        with patch("integrations.graphiti.migrate_embeddings.GraphitiConfig") as mock_config_class:
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
        mock_config.get_provider_specific_database_name = MagicMock(return_value="test_db")

        with patch("integrations.graphiti.migrate_embeddings.GraphitiConfig") as mock_config_class:
            with patch("integrations.graphiti.migrate_embeddings.EmbeddingMigrator") as mock_migrator_class:
                mock_config_class.from_env.return_value = mock_config
                mock_migrator = MagicMock()
                mock_migrator.initialize = AsyncMock(return_value=False)
                mock_migrator_class.return_value = mock_migrator

                await automatic_migration(args)

                # Should not proceed to migrate_all
                mock_migrator.migrate_all.assert_not_called()


# =============================================================================
# Tests for main()
# =============================================================================


class TestMain:
    """Tests for main function."""

    def test_main_interactive_mode_no_args(self):
        """Test main enters interactive mode when no args provided."""
        from integrations.graphiti.migrate_embeddings import main

        with patch("integrations.graphiti.migrate_embeddings.asyncio.run") as mock_run:
            with patch("integrations.graphiti.migrate_embeddings.argparse.ArgumentParser") as mock_parser_class:
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
            with patch("integrations.graphiti.migrate_embeddings.argparse.ArgumentParser") as mock_parser_class:
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

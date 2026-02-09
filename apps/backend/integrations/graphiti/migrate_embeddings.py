#!/usr/bin/env python3
"""
Embedding Provider Migration Utility
=====================================

Migrates Graphiti memory data from one embedding provider to another by:
1. Reading all episodes from the source database
2. Re-embedding content with the new provider
3. Storing in a provider-specific target database

This handles the dimension mismatch issue when switching between providers
(e.g., OpenAI 1536D → Ollama embeddinggemma 768D).

Usage:
    # Interactive mode (recommended)
    python integrations/graphiti/migrate_embeddings.py

    # Automatic mode
    python integrations/graphiti/migrate_embeddings.py \
        --from-provider openai \
        --to-provider ollama \
        --auto-confirm

    # Dry run to see what would be migrated
    python integrations/graphiti/migrate_embeddings.py --dry-run
"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path

# Add ac-jerry to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from integrations.graphiti.config import GraphitiConfig

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class EmbeddingMigrator:
    """Handles migration of embeddings between providers."""

    def __init__(
        self,
        source_config: GraphitiConfig,
        target_config: GraphitiConfig,
        dry_run: bool = False,
    ):
        """
        Initialize the migrator.

        Args:
            source_config: Config for source database
            target_config: Config for target database
            dry_run: If True, don't actually perform migration
        """
        self.source_config = source_config
        self.target_config = target_config
        self.dry_run = dry_run
        self.source_client = None
        self.target_client = None

    async def initialize(self) -> bool:
        """Initialize source and target clients."""
        from integrations.graphiti.queries_pkg.client import GraphitiClient

        logger.info("Initializing source client...")
        self.source_client = GraphitiClient(self.source_config)
        try:
            if not await self.source_client.initialize():
                logger.error("Failed to initialize source client")
                return False
        except Exception as e:
            logger.error(f"Exception initializing source client: {e}")
            return False

        if not self.dry_run:
            logger.info("Initializing target client...")
            self.target_client = GraphitiClient(self.target_config)
            try:
                if not await self.target_client.initialize():
                    logger.error("Failed to initialize target client")
                    # Clean up source client on partial failure
                    await self.source_client.close()
                    self.source_client = None
                    return False
            except Exception as e:
                logger.error(f"Exception initializing target client: {e}")
                # Clean up source client on partial failure
                await self.source_client.close()
                self.source_client = None
                return False

        return True

    async def get_source_episodes(self) -> list[dict]:
        """
        Retrieve all episodes from source database.

        Returns:
            List of episode data dictionaries
        """
        logger.info("Fetching episodes from source database...")

        try:
            # Query all episodic nodes
            query = """
                MATCH (e:Episodic)
                RETURN
                    e.uuid AS uuid,
                    e.name AS name,
                    e.content AS content,
                    e.created_at AS created_at,
                    e.valid_at AS valid_at,
                    e.group_id AS group_id,
                    e.source AS source,
                    e.source_description AS source_description
                ORDER BY e.created_at
            """

            records, _, _ = await self.source_client._driver.execute_query(query)

            episodes = []
            for record in records:
                episodes.append(
                    {
                        "uuid": record.get("uuid"),
                        "name": record.get("name"),
                        "content": record.get("content"),
                        "created_at": record.get("created_at"),
                        "valid_at": record.get("valid_at"),
                        "group_id": record.get("group_id"),
                        "source": record.get("source"),
                        "source_description": record.get("source_description"),
                    }
                )

            logger.info(f"Found {len(episodes)} episodes to migrate")
            return episodes

        except Exception as e:
            logger.error(f"Failed to fetch episodes: {e}")
            return []

    async def migrate_episode(self, episode: dict) -> bool:
        """
        Migrate a single episode to the target database.

        Args:
            episode: Episode data dictionary

        Returns:
            True if migration succeeded
        """
        if self.dry_run:
            logger.info(f"[DRY RUN] Would migrate: {episode['name']}")
            return True

        try:
            from graphiti_core.nodes import EpisodeType

            # Determine episode type
            source = episode.get("source", "text")
            if source == "message":
                episode_type = EpisodeType.message
            elif source == "json":
                episode_type = EpisodeType.json
            else:
                episode_type = EpisodeType.text

            # Parse timestamps
            valid_at = episode.get("valid_at")
            if isinstance(valid_at, str):
                valid_at = datetime.fromisoformat(valid_at.replace("Z", "+00:00"))

            # Re-embed and save with new provider
            await self.target_client.graphiti.add_episode(
                name=episode["name"],
                episode_body=episode["content"] or "",
                source=episode_type,
                source_description=episode.get(
                    "source_description", "Migrated episode"
                ),
                reference_time=valid_at,
                group_id=episode.get("group_id", "default"),
            )

            logger.info(f"Migrated: {episode['name']}")
            return True

        except Exception as e:
            logger.error(f"Failed to migrate episode {episode['name']}: {e}")
            return False

    async def migrate_all(self) -> dict:
        """
        Migrate all episodes from source to target.

        Returns:
            Migration statistics dictionary
        """
        episodes = await self.get_source_episodes()

        stats = {
            "total": len(episodes),
            "succeeded": 0,
            "failed": 0,
            "dry_run": self.dry_run,
        }

        for i, episode in enumerate(episodes, 1):
            logger.info(f"Processing episode {i}/{len(episodes)}")
            if await self.migrate_episode(episode):
                stats["succeeded"] += 1
            else:
                stats["failed"] += 1

        return stats

    async def close(self):
        """Close client connections."""
        if self.source_client:
            await self.source_client.close()
        if self.target_client:
            await self.target_client.close()


async def interactive_migration():
    """Run interactive migration with user prompts."""
    print("\n" + "=" * 70)
    print("  GRAPHITI EMBEDDING PROVIDER MIGRATION")
    print("=" * 70 + "\n")

    # Load current config
    current_config = GraphitiConfig.from_env()

    print("Current Configuration:")
    print(f"  Embedder Provider: {current_config.embedder_provider}")
    print(f"  Embedding Dimension: {current_config.get_embedding_dimension()}")
    print(f"  Database: {current_config.database}")
    print(f"  Provider Signature: {current_config.get_provider_signature()}\n")

    # Ask for source provider
    print("Which provider are you migrating FROM?")
    print("  1. OpenAI")
    print("  2. Ollama")
    print("  3. Voyage AI")
    print("  4. Google AI")
    print("  5. Azure OpenAI")

    source_choice = input("\nEnter choice (1-5): ").strip()
    source_map = {
        "1": "openai",
        "2": "ollama",
        "3": "voyage",
        "4": "google",
        "5": "azure_openai",
    }

    if source_choice not in source_map:
        print("Invalid choice. Exiting.")
        return

    source_provider = source_map[source_choice]

    # Validate that source and target are different
    if source_provider == current_config.embedder_provider:
        print(f"\nError: Source and target providers are the same ({source_provider}).")
        print("Migration requires different providers. Exiting.")
        return

    # Create source config with correct provider-specific database name
    source_config = GraphitiConfig.from_env()
    source_config.embedder_provider = source_provider
    # Use the source provider's signature for the database name
    source_config.database = source_config.get_provider_specific_database_name(
        "ac_jerry_memory"
    )

    print(f"\nSource: {source_provider}")
    print(f"Target: {current_config.embedder_provider}")
    print(
        f"\nThis will migrate all episodes from {source_provider} "
        f"to {current_config.embedder_provider}"
    )
    print(
        "Re-embedding may take several minutes depending on the number of episodes.\n"
    )

    confirm = input("Continue? (yes/no): ").strip().lower()
    if confirm != "yes":
        print("Migration cancelled.")
        return

    # Perform migration
    migrator = EmbeddingMigrator(
        source_config=source_config,
        target_config=current_config,
        dry_run=False,
    )

    if not await migrator.initialize():
        print("Failed to initialize migration. Check configuration.")
        return

    print("\nMigrating episodes...")
    stats = await migrator.migrate_all()

    await migrator.close()

    print("\n" + "=" * 70)
    print("  MIGRATION COMPLETE")
    print("=" * 70)
    print(f"  Total Episodes: {stats['total']}")
    print(f"  Succeeded: {stats['succeeded']}")
    print(f"  Failed: {stats['failed']}")
    print("=" * 70 + "\n")


async def automatic_migration(args):
    """Run automatic migration based on command-line args."""
    current_config = GraphitiConfig.from_env()

    if args.from_provider:
        source_config = GraphitiConfig.from_env()
        source_config.embedder_provider = args.from_provider
        # Use source provider's signature for database name
        source_config.database = source_config.get_provider_specific_database_name(
            "ac_jerry_memory"
        )
    else:
        source_config = current_config

    if args.to_provider:
        target_config = GraphitiConfig.from_env()
        target_config.embedder_provider = args.to_provider
        # Use target provider's signature for database name
        target_config.database = target_config.get_provider_specific_database_name(
            "ac_jerry_memory"
        )
    else:
        target_config = current_config

    # Validate that source and target are different
    if source_config.embedder_provider == target_config.embedder_provider:
        logger.error(
            f"Source and target providers are the same "
            f"({source_config.embedder_provider}). "
            f"Specify different --from-provider and --to-provider values."
        )
        return

    migrator = EmbeddingMigrator(
        source_config=source_config,
        target_config=target_config,
        dry_run=args.dry_run,
    )

    if not await migrator.initialize():
        logger.error("Failed to initialize migration")
        return

    stats = await migrator.migrate_all()
    await migrator.close()

    logger.info(f"Migration complete: {stats}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Migrate Graphiti embeddings between providers"
    )
    parser.add_argument(
        "--from-provider",
        choices=["openai", "ollama", "voyage", "google", "azure_openai"],
        help="Source embedding provider",
    )
    parser.add_argument(
        "--to-provider",
        choices=["openai", "ollama", "voyage", "google", "azure_openai"],
        help="Target embedding provider",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be migrated without actually migrating",
    )
    parser.add_argument(
        "--auto-confirm", action="store_true", help="Skip confirmation prompts"
    )

    args = parser.parse_args()

    # Use interactive mode if no providers specified
    if not args.from_provider and not args.to_provider:
        asyncio.run(interactive_migration())
    else:
        asyncio.run(automatic_migration(args))


if __name__ == "__main__":
    main()

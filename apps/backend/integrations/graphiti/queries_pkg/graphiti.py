"""
Main GraphitiMemory class - facade for the modular memory system.

Provides a high-level interface that delegates to specialized modules:
- client.py: Database connection and lifecycle
- queries.py: Episode storage operations
- search.py: Semantic search and retrieval
- schema.py: Data structures and constants
"""

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path

from core.sentry import capture_exception
from graphiti_config import GraphitiConfig, GraphitiState

from .client import GraphitiClient
from .queries import GraphitiQueries
from .schema import MAX_CONTEXT_RESULTS, GroupIdMode
from .search import GraphitiSearch

logger = logging.getLogger(__name__)


class GraphitiMemory:
    """
    Manages Graphiti-based persistent memory for auto-claude sessions.

    This class provides a high-level interface for:
    - Storing session insights as episodes
    - Recording codebase discoveries (file purposes, patterns, gotchas)
    - Retrieving relevant context for new sessions
    - Searching across all stored knowledge

    All operations are async and include error handling with fallback behavior.
    The integration is OPTIONAL - if Graphiti is disabled or unavailable,
    operations gracefully no-op or return empty results.

    V2 supports multi-provider configurations via factory pattern.
    """

    def __init__(
        self,
        spec_dir: Path,
        project_dir: Path,
        group_id_mode: str = GroupIdMode.SPEC,
    ):
        """
        Initialize Graphiti memory manager.

        Args:
            spec_dir: Spec directory (used as namespace/group_id in SPEC mode)
            project_dir: Project root directory (used as namespace in PROJECT mode)
            group_id_mode: How to scope the memory namespace:
                - "spec": Each spec gets isolated memory (default)
                - "project": All specs share project-wide context
        """
        self.spec_dir = spec_dir
        self.project_dir = project_dir
        self.group_id_mode = group_id_mode
        self.config = GraphitiConfig.from_env()
        self.state: GraphitiState | None = None

        # Component modules
        self._client: GraphitiClient | None = None
        self._queries: GraphitiQueries | None = None
        self._search: GraphitiSearch | None = None

        self._available = False

        # Load existing state if available
        self.state = GraphitiState.load(spec_dir)

        # Check availability
        self._available = self.config.is_valid()

        # Log provider configuration if enabled
        if self._available:
            logger.info(
                f"Graphiti configured with providers: {self.config.get_provider_summary()}"
            )

    @property
    def is_enabled(self) -> bool:
        """Check if Graphiti integration is enabled and configured."""
        return self._available

    @property
    def is_initialized(self) -> bool:
        """Check if Graphiti has been initialized for this spec."""
        return (
            self._client is not None
            and self._client.is_initialized
            and self.state is not None
            and self.state.initialized
        )

    @property
    def group_id(self) -> str:
        """
        Get the group ID for memory namespace.

        Returns:
            - In SPEC mode: spec folder name (e.g., "001-add-auth")
            - In PROJECT mode: project name with hash for uniqueness
        """
        if self.group_id_mode == GroupIdMode.PROJECT:
            project_name = self.project_dir.name
            path_hash = hashlib.md5(
                str(self.project_dir.resolve()).encode(), usedforsecurity=False
            ).hexdigest()[:8]
            return f"project_{project_name}_{path_hash}"
        else:
            return self.spec_dir.name

    @property
    def spec_context_id(self) -> str:
        """Get a context ID specific to this spec (for filtering in project mode)."""
        return self.spec_dir.name

    async def initialize(self) -> bool:
        """
        Initialize the Graphiti client with configured providers.

        Returns:
            True if initialization succeeded
        """
        if self.is_initialized:
            return True

        if not self._available:
            logger.info("Graphiti not available - skipping initialization")
            return False

        # Check for provider changes
        if self.state and self.state.has_provider_changed(self.config):
            migration_info = self.state.get_migration_info(self.config)
            logger.warning(
                f"⚠️  Embedding provider changed: {migration_info['old_provider']} → {migration_info['new_provider']}"
            )
            logger.warning(
                "   This requires migration to prevent dimension mismatch errors."
            )
            logger.warning(
                f"   Episodes in old database: {migration_info['episode_count']}"
            )
            logger.warning("   Run: python integrations/graphiti/migrate_embeddings.py")
            logger.warning(
                f"   Or start fresh by removing: {self.spec_dir / '.graphiti_state.json'}"
            )
            # Continue with new provider (will use new database)
            # Reset state to use new provider
            self.state = None

        try:
            # Create client
            self._client = GraphitiClient(self.config)

            # Initialize client with state tracking
            if not await self._client.initialize(self.state):
                self._available = False
                return False

            # Update state if needed
            if not self.state:
                self.state = GraphitiState()
                self.state.initialized = True
                self.state.database = self.config.database
                self.state.created_at = datetime.now(timezone.utc).isoformat()
                self.state.llm_provider = self.config.llm_provider
                self.state.embedder_provider = self.config.embedder_provider
                self.state.save(self.spec_dir)

            # Create query and search modules
            self._queries = GraphitiQueries(
                self._client,
                self.group_id,
                self.spec_context_id,
            )

            self._search = GraphitiSearch(
                self._client,
                self.group_id,
                self.spec_context_id,
                self.group_id_mode,
                self.project_dir,
            )

            logger.info(
                f"Graphiti initialized for group: {self.group_id} "
                f"(mode: {self.group_id_mode}, providers: {self.config.get_provider_summary()})"
            )
            return True

        except Exception as e:
            logger.warning(f"Failed to initialize Graphiti: {e}")
            self._record_error(f"Initialization failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="initialize",
                group_id=self.group_id,
                group_id_mode=self.group_id_mode,
            )
            self._available = False
            return False

    async def close(self) -> None:
        """
        Close the Graphiti client and clean up connections.
        """
        if self._client:
            await self._client.close()
            self._client = None
            self._queries = None
            self._search = None

    # Delegate methods to query module

    async def save_session_insights(
        self,
        session_num: int,
        insights: dict,
    ) -> bool:
        """Save session insights as a Graphiti episode."""
        if not await self._ensure_initialized():
            return False

        try:
            result = await self._queries.add_session_insight(session_num, insights)

            if result and self.state:
                self.state.last_session = session_num
                self.state.episode_count += 1
                self.state.save(self.spec_dir)

            return result
        except Exception as e:
            logger.warning(f"Failed to save session insights: {e}")
            self._record_error(f"save_session_insights failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="save_session_insights",
                session_num=session_num,
            )
            return False

    async def save_codebase_discoveries(
        self,
        discoveries: dict[str, str],
    ) -> bool:
        """Save codebase discoveries to the knowledge graph."""
        if not await self._ensure_initialized():
            return False

        try:
            result = await self._queries.add_codebase_discoveries(discoveries)

            if result and self.state:
                self.state.episode_count += 1
                self.state.save(self.spec_dir)

            return result
        except Exception as e:
            logger.warning(f"Failed to save codebase discoveries: {e}")
            self._record_error(f"save_codebase_discoveries failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="save_codebase_discoveries",
            )
            return False

    async def save_pattern(self, pattern: str) -> bool:
        """Save a code pattern to the knowledge graph."""
        if not await self._ensure_initialized():
            return False

        try:
            result = await self._queries.add_pattern(pattern)

            if result and self.state:
                self.state.episode_count += 1
                self.state.save(self.spec_dir)

            return result
        except Exception as e:
            logger.warning(f"Failed to save pattern: {e}")
            self._record_error(f"save_pattern failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="save_pattern",
            )
            return False

    async def save_gotcha(self, gotcha: str) -> bool:
        """Save a gotcha (pitfall) to the knowledge graph."""
        if not await self._ensure_initialized():
            return False

        try:
            result = await self._queries.add_gotcha(gotcha)

            if result and self.state:
                self.state.episode_count += 1
                self.state.save(self.spec_dir)

            return result
        except Exception as e:
            logger.warning(f"Failed to save gotcha: {e}")
            self._record_error(f"save_gotcha failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="save_gotcha",
            )
            return False

    async def save_task_outcome(
        self,
        task_id: str,
        success: bool,
        outcome: str,
        metadata: dict | None = None,
    ) -> bool:
        """Save a task outcome for learning from past successes/failures."""
        if not await self._ensure_initialized():
            return False

        try:
            result = await self._queries.add_task_outcome(
                task_id, success, outcome, metadata
            )

            if result and self.state:
                self.state.episode_count += 1
                self.state.save(self.spec_dir)

            return result
        except Exception as e:
            logger.warning(f"Failed to save task outcome: {e}")
            self._record_error(f"save_task_outcome failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="save_task_outcome",
                task_id=task_id,
            )
            return False

    async def save_structured_insights(self, insights: dict) -> bool:
        """Save extracted insights as multiple focused episodes."""
        if not await self._ensure_initialized():
            return False

        try:
            result = await self._queries.add_structured_insights(insights)

            if result and self.state:
                # Episode count updated in queries module
                pass

            return result
        except Exception as e:
            logger.warning(f"Failed to save structured insights: {e}")
            self._record_error(f"save_structured_insights failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="save_structured_insights",
            )
            return False

    # Delegate methods to search module

    async def get_relevant_context(
        self,
        query: str,
        num_results: int = MAX_CONTEXT_RESULTS,
        include_project_context: bool = True,
    ) -> list[dict]:
        """Search for relevant context based on a query."""
        if not await self._ensure_initialized():
            return []

        try:
            return await self._search.get_relevant_context(
                query, num_results, include_project_context
            )
        except Exception as e:
            logger.warning(f"Failed to get relevant context: {e}")
            self._record_error(f"get_relevant_context failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="get_relevant_context",
            )
            return []

    async def get_session_history(
        self,
        limit: int = 5,
        spec_only: bool = True,
    ) -> list[dict]:
        """Get recent session insights from the knowledge graph."""
        if not await self._ensure_initialized():
            return []

        try:
            return await self._search.get_session_history(limit, spec_only)
        except Exception as e:
            logger.warning(f"Failed to get session history: {e}")
            self._record_error(f"get_session_history failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="get_session_history",
            )
            return []

    async def get_similar_task_outcomes(
        self,
        task_description: str,
        limit: int = 5,
    ) -> list[dict]:
        """Find similar past task outcomes to learn from."""
        if not await self._ensure_initialized():
            return []

        try:
            return await self._search.get_similar_task_outcomes(task_description, limit)
        except Exception as e:
            logger.warning(f"Failed to get similar task outcomes: {e}")
            self._record_error(f"get_similar_task_outcomes failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="get_similar_task_outcomes",
            )
            return []

    async def get_patterns_and_gotchas(
        self,
        query: str,
        num_results: int = 5,
        min_score: float = 0.5,
    ) -> tuple[list[dict], list[dict]]:
        """
        Get patterns and gotchas relevant to the query.

        This method specifically retrieves PATTERN and GOTCHA episode types
        to enable cross-session learning. Unlike get_relevant_context(),
        it filters for these specific types rather than doing generic search.

        Args:
            query: Search query (task description)
            num_results: Max results per type
            min_score: Minimum relevance score (0.0-1.0)

        Returns:
            Tuple of (patterns, gotchas) lists
        """
        if not await self._ensure_initialized():
            return [], []

        try:
            return await self._search.get_patterns_and_gotchas(
                query, num_results, min_score
            )
        except Exception as e:
            logger.warning(f"Failed to get patterns and gotchas: {e}")
            self._record_error(f"get_patterns_and_gotchas failed: {e}")
            capture_exception(
                e,
                component="graphiti",
                operation="get_patterns_and_gotchas",
            )
            return [], []

    # Status and utility methods

    def get_status_summary(self) -> dict:
        """
        Get a summary of Graphiti memory status.

        Returns:
            Dict with status information
        """
        return {
            "enabled": self.is_enabled,
            "initialized": self.is_initialized,
            "database": self.config.database if self.is_enabled else None,
            "db_path": self.config.db_path if self.is_enabled else None,
            "group_id": self.group_id,
            "group_id_mode": self.group_id_mode,
            "llm_provider": self.config.llm_provider if self.is_enabled else None,
            "embedder_provider": self.config.embedder_provider
            if self.is_enabled
            else None,
            "episode_count": self.state.episode_count if self.state else 0,
            "last_session": self.state.last_session if self.state else None,
            "errors": len(self.state.error_log) if self.state else 0,
        }

    async def _ensure_initialized(self) -> bool:
        """
        Ensure Graphiti is initialized, attempting initialization if needed.

        Returns:
            True if initialized and ready
        """
        if self.is_initialized:
            return True

        if not self._available:
            return False

        return await self.initialize()

    def _record_error(self, error_msg: str) -> None:
        """Record an error in the state."""
        if not self.state:
            self.state = GraphitiState()

        self.state.record_error(error_msg)
        self.state.save(self.spec_dir)

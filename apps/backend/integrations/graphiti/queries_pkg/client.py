"""
Graph database client wrapper for Graphiti memory.

Handles database connection, initialization, and lifecycle management.
Uses LadybugDB as the embedded graph database (no Docker required, Python 3.12+).
"""

import asyncio
import logging
import random
import sys
from datetime import datetime, timezone

from core.sentry import capture_exception
from graphiti_config import GraphitiConfig, GraphitiState

logger = logging.getLogger(__name__)

# Retry configuration for LadybugDB lock contention
MAX_LOCK_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 0.5
MAX_BACKOFF_SECONDS = 8.0
JITTER_PERCENT = 0.2


def _is_lock_error(error: Exception) -> bool:
    """Check if an error indicates database lock contention."""
    error_msg = str(error).lower()
    return "could not set lock" in error_msg or (
        "lock" in error_msg and ("file" in error_msg or "database" in error_msg)
    )


def _backoff_with_jitter(attempt: int) -> float:
    """Calculate exponential backoff with jitter for retry delays."""
    backoff = min(INITIAL_BACKOFF_SECONDS * (2**attempt), MAX_BACKOFF_SECONDS)
    jitter = backoff * JITTER_PERCENT * (2 * random.random() - 1)
    return max(0.01, backoff + jitter)


def _apply_ladybug_monkeypatch() -> bool:
    """
    Apply monkeypatch to use LadybugDB as Kuzu replacement, or use native kuzu.

    LadybugDB is a fork of Kuzu that provides an embedded graph database.
    Since graphiti-core has a KuzuDriver, we can use LadybugDB by making
    the 'kuzu' import point to 'real_ladybug'.

    Falls back to native kuzu if LadybugDB is not available.

    Returns:
        True if kuzu (or monkeypatch) is available
    """
    # First try LadybugDB monkeypatch
    try:
        import real_ladybug

        sys.modules["kuzu"] = real_ladybug
        logger.info("Applied LadybugDB monkeypatch (kuzu -> real_ladybug)")
        return True
    except ImportError as e:
        logger.debug(f"LadybugDB import failed: {e}")
        # On Windows with Python 3.12+, provide more specific error details
        # (pywin32 is only required for Python 3.12+ per requirements.txt)
        if sys.platform == "win32" and sys.version_info >= (3, 12):
            # Check if it's the pywin32 error using both name attribute and string match
            # for robustness across Python versions
            is_pywin32_error = (
                (hasattr(e, "name") and e.name in ("pywintypes", "pywin32", "win32api"))
                or "pywintypes" in str(e)
                or "pywin32" in str(e)
            )
            if is_pywin32_error:
                logger.error(
                    "LadybugDB requires pywin32 on Windows. "
                    "Install with: pip install pywin32>=306"
                )
            else:
                logger.debug(f"Windows-specific import issue: {e}")

    # Fall back to native kuzu
    try:
        import kuzu  # noqa: F401

        logger.info("Using native kuzu (LadybugDB not installed)")
        return True
    except ImportError:
        logger.warning(
            "Neither LadybugDB nor kuzu installed. "
            "Install with: pip install real_ladybug (requires Python 3.12+) or pip install kuzu"
        )
        return False


class GraphitiClient:
    """
    Manages the Graphiti client lifecycle and database connection.

    Handles lazy initialization, provider setup, and connection management.
    Uses LadybugDB as the embedded graph database.
    """

    def __init__(self, config: GraphitiConfig):
        """
        Initialize the client manager.

        Args:
            config: Graphiti configuration
        """
        self.config = config
        self._graphiti = None
        self._driver = None
        self._llm_client = None
        self._embedder = None
        self._initialized = False

    @property
    def graphiti(self):
        """Get the Graphiti instance (must be initialized first)."""
        return self._graphiti

    @property
    def is_initialized(self) -> bool:
        """Check if client is initialized."""
        return self._initialized

    async def initialize(self, state: GraphitiState | None = None) -> bool:
        """
        Initialize the Graphiti client with configured providers.

        Args:
            state: Optional GraphitiState for tracking initialization status

        Returns:
            True if initialization succeeded
        """
        if self._initialized:
            return True

        try:
            # Import Graphiti core
            from graphiti_core import Graphiti

            # Import our provider factory
            from graphiti_providers import (
                ProviderError,
                ProviderNotInstalled,
                create_embedder,
                create_llm_client,
            )

            # Create providers using factory pattern
            try:
                self._llm_client = create_llm_client(self.config)
                logger.info(
                    f"Created LLM client for provider: {self.config.llm_provider}"
                )
            except ProviderNotInstalled as e:
                logger.warning(f"LLM provider packages not installed: {e}")
                capture_exception(
                    e,
                    error_type="ProviderNotInstalled",
                    provider_type="llm",
                    llm_provider=self.config.llm_provider,
                    embedder_provider=self.config.embedder_provider,
                )
                return False
            except ProviderError as e:
                logger.warning(f"LLM provider configuration error: {e}")
                capture_exception(
                    e,
                    error_type="ProviderError",
                    provider_type="llm",
                    llm_provider=self.config.llm_provider,
                    embedder_provider=self.config.embedder_provider,
                )
                return False

            try:
                self._embedder = create_embedder(self.config)
                logger.info(
                    f"Created embedder for provider: {self.config.embedder_provider}"
                )
            except ProviderNotInstalled as e:
                logger.warning(f"Embedder provider packages not installed: {e}")
                capture_exception(
                    e,
                    error_type="ProviderNotInstalled",
                    provider_type="embedder",
                    llm_provider=self.config.llm_provider,
                    embedder_provider=self.config.embedder_provider,
                )
                return False
            except ProviderError as e:
                logger.warning(f"Embedder provider configuration error: {e}")
                capture_exception(
                    e,
                    error_type="ProviderError",
                    provider_type="embedder",
                    llm_provider=self.config.llm_provider,
                    embedder_provider=self.config.embedder_provider,
                )
                return False

            # Apply LadybugDB monkeypatch to use it via graphiti's KuzuDriver
            if not _apply_ladybug_monkeypatch():
                logger.error(
                    "LadybugDB is required for Graphiti memory. "
                    "Install with: pip install real_ladybug (requires Python 3.12+)"
                )
                return False

            try:
                # Use our patched KuzuDriver that properly creates FTS indexes
                # The original graphiti-core KuzuDriver has build_indices_and_constraints()
                # as a no-op, which causes FTS search failures
                from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
                    create_patched_kuzu_driver,
                )

                db_path = self.config.get_db_path()

                # Retry with exponential backoff for lock contention
                for attempt in range(MAX_LOCK_RETRIES + 1):
                    try:
                        self._driver = create_patched_kuzu_driver(db=str(db_path))
                        if attempt > 0:
                            logger.info(
                                f"LadybugDB lock acquired after {attempt} retries"
                            )
                        break  # Success
                    except Exception as e:
                        if _is_lock_error(e) and attempt < MAX_LOCK_RETRIES:
                            wait_time = _backoff_with_jitter(attempt)
                            logger.debug(
                                f"LadybugDB lock contention (attempt {attempt + 1}/{MAX_LOCK_RETRIES}), retrying in {wait_time:.2f}s"
                            )
                            await asyncio.sleep(wait_time)
                            continue
                        logger.warning(
                            f"Failed to initialize LadybugDB driver at {db_path}: {e}"
                        )
                        capture_exception(
                            e,
                            error_type=type(e).__name__,
                            db_path=str(db_path),
                            llm_provider=self.config.llm_provider,
                            embedder_provider=self.config.embedder_provider,
                        )
                        return False

                logger.info(f"Initialized LadybugDB driver (patched) at: {db_path}")
            except ImportError as e:
                logger.warning(f"KuzuDriver not available: {e}")
                capture_exception(
                    e,
                    error_type="ImportError",
                    component="kuzu_driver_patched",
                    llm_provider=self.config.llm_provider,
                    embedder_provider=self.config.embedder_provider,
                )
                return False

            # Initialize Graphiti with the custom providers
            self._graphiti = Graphiti(
                graph_driver=self._driver,
                llm_client=self._llm_client,
                embedder=self._embedder,
            )

            # Build indices (first time only)
            if not state or not state.indices_built:
                logger.info("Building Graphiti indices and constraints...")
                await self._graphiti.build_indices_and_constraints()

                if state:
                    state.indices_built = True
                    state.initialized = True
                    state.database = self.config.database
                    state.created_at = datetime.now(timezone.utc).isoformat()
                    state.llm_provider = self.config.llm_provider
                    state.embedder_provider = self.config.embedder_provider

            self._initialized = True
            logger.info(
                f"Graphiti client initialized "
                f"(providers: {self.config.get_provider_summary()})"
            )
            return True

        except ImportError as e:
            logger.warning(
                f"Graphiti packages not installed: {e}. "
                "Install with: pip install real_ladybug graphiti-core"
            )
            capture_exception(
                e,
                error_type="ImportError",
                component="graphiti_core",
                llm_provider=self.config.llm_provider,
                embedder_provider=self.config.embedder_provider,
            )
            return False

        except Exception as e:
            logger.warning(f"Failed to initialize Graphiti client: {e}")
            capture_exception(
                e,
                error_type=type(e).__name__,
                llm_provider=self.config.llm_provider,
                embedder_provider=self.config.embedder_provider,
            )
            return False

    async def close(self) -> None:
        """
        Close the Graphiti client and clean up connections.
        """
        if self._graphiti:
            try:
                await self._graphiti.close()
                logger.info("Graphiti connection closed")
            except Exception as e:
                logger.warning(f"Error closing Graphiti: {e}")
            finally:
                self._graphiti = None
                self._driver = None
                self._llm_client = None
                self._embedder = None
                self._initialized = False

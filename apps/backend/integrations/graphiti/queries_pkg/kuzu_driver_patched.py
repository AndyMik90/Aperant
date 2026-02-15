"""
Patched KuzuDriver that properly creates FTS indexes and fixes parameter handling.

The original graphiti-core KuzuDriver has two bugs:
1. build_indices_and_constraints() is a no-op, so FTS indexes are never created
2. execute_query() filters out None parameters, but queries still reference them

This patched driver fixes both issues for LadybugDB compatibility.
"""

import logging
import re
from typing import Any

# Import kuzu (might be real_ladybug via monkeypatch)
try:
    import kuzu
except ImportError:  # pragma: no cover
    # Fallback to real_ladybug if kuzu is not available.
    # This import-time fallback is hard to test in normal unit tests
    # since the module is imported once before tests can mock anything.
    import real_ladybug as kuzu  # type: ignore

logger = logging.getLogger(__name__)


def create_patched_kuzu_driver(db: str = ":memory:", max_concurrent_queries: int = 1):
    from graphiti_core.driver.driver import GraphProvider
    from graphiti_core.driver.kuzu_driver import KuzuDriver as OriginalKuzuDriver
    from graphiti_core.graph_queries import get_fulltext_indices

    class PatchedKuzuDriver(OriginalKuzuDriver):
        """
        KuzuDriver with proper FTS index creation and parameter handling.

        Fixes two bugs in graphiti-core:
        1. FTS indexes are never created (build_indices_and_constraints is a no-op)
        2. None parameters are filtered out, causing "Parameter not found" errors
        """

        def __init__(
            self,
            db: str = ":memory:",
            max_concurrent_queries: int = 1,
        ):
            # Store database path before calling parent (which creates the Database)
            self._database = db  # Required by Graphiti for group_id checks
            super().__init__(db, max_concurrent_queries)

        async def execute_query(
            self, cypher_query_: str, **kwargs: Any
        ) -> tuple[list[dict[str, Any]] | list[list[dict[str, Any]]], None, None]:
            """
            Execute a Cypher query with proper None parameter handling.

            The original driver filters out None values, but LadybugDB requires
            all referenced parameters to exist. This override keeps None values
            in the parameters dict.
            """
            # Don't filter out None values - LadybugDB needs them
            params = {k: v for k, v in kwargs.items()}
            # Still remove these unsupported parameters
            params.pop("database_", None)
            params.pop("routing_", None)

            try:
                results = await self.client.execute(cypher_query_, parameters=params)
            except Exception as e:
                # Truncate long values for logging
                log_params = {
                    k: (v[:5] if isinstance(v, list) else v) for k, v in params.items()
                }
                logger.error(
                    f"Error executing Kuzu query: {e}\n{cypher_query_}\n{log_params}"
                )
                raise

            if not results:
                return [], None, None

            if isinstance(results, list):
                dict_results = [list(result.rows_as_dict()) for result in results]
            else:
                dict_results = list(results.rows_as_dict())
            return dict_results, None, None  # type: ignore

        async def build_indices_and_constraints(self, delete_existing: bool = False):
            """
            Build FTS indexes required for Graphiti's hybrid search.

            The original KuzuDriver has this as a no-op, but we need to actually
            create the FTS indexes for search to work.

            Args:
                delete_existing: If True, drop and recreate indexes (default: False)
            """
            logger.info("Building FTS indexes for Kuzu/LadybugDB...")

            # Get the FTS index creation queries from Graphiti
            fts_queries = get_fulltext_indices(GraphProvider.KUZU)

            # Create a sync connection for index creation
            conn = kuzu.Connection(self.db)

            try:
                for query in fts_queries:
                    try:
                        # Check if we need to drop existing index first
                        if delete_existing:
                            # Extract index name from query
                            # Format: CALL CREATE_FTS_INDEX('TableName', 'index_name', [...])
                            match = re.search(
                                r"CREATE_FTS_INDEX\('([^']+)',\s*'([^']+)'", query
                            )
                            if match:
                                table_name, index_name = match.groups()
                                drop_query = f"CALL DROP_FTS_INDEX('{table_name}', '{index_name}')"
                                try:
                                    conn.execute(drop_query)
                                    logger.debug(
                                        f"Dropped existing FTS index: {index_name}"
                                    )
                                except Exception:
                                    # Index might not exist, that's fine
                                    pass

                        # Create the FTS index
                        conn.execute(query)
                        logger.debug(f"Created FTS index: {query[:80]}...")

                    except Exception as e:
                        error_msg = str(e).lower()
                        # Handle "index already exists" gracefully
                        if "already exists" in error_msg or "duplicate" in error_msg:
                            logger.debug(
                                f"FTS index already exists (skipping): {query[:60]}..."
                            )
                        else:
                            # Log but don't fail - some indexes might fail in certain Kuzu versions
                            logger.warning(f"Failed to create FTS index: {e}")
                            logger.debug(f"Query was: {query}")

                logger.info("FTS indexes created successfully")
            finally:
                conn.close()

        def setup_schema(self):
            """
            Set up the database schema and install/load the FTS extension.

            Extends the parent setup_schema() to properly set up FTS support.
            """
            conn = kuzu.Connection(self.db)

            try:
                # First, install the FTS extension (required before loading)
                try:
                    conn.execute("INSTALL fts")
                    logger.debug("Installed FTS extension")
                except Exception as e:
                    error_msg = str(e).lower()
                    if "already" not in error_msg:
                        logger.debug(f"FTS extension install note: {e}")

                # Then load the FTS extension
                try:
                    conn.execute("LOAD EXTENSION fts")
                    logger.debug("Loaded FTS extension")
                except Exception as e:
                    error_msg = str(e).lower()
                    if "already loaded" not in error_msg:
                        logger.debug(f"FTS extension load note: {e}")
            finally:
                conn.close()

            # Run the parent schema setup (creates tables)
            super().setup_schema()

    return PatchedKuzuDriver(db=db, max_concurrent_queries=max_concurrent_queries)

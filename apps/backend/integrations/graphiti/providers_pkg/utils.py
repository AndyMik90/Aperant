"""
Graphiti Provider Utilities
============================

Convenience functions for Graphiti integration.
"""

import logging
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)


def is_graphiti_enabled() -> bool:
    """
    Check if Graphiti memory integration is available and configured.

    This is a convenience re-export from graphiti_config.
    Returns True if GRAPHITI_ENABLED=true and provider credentials are valid.
    """
    from graphiti_config import is_graphiti_enabled as _is_graphiti_enabled

    return _is_graphiti_enabled()


async def get_graph_hints(
    query: str,
    project_id: str,
    max_results: int = 10,
    spec_dir: Optional["Path"] = None,
) -> list[dict]:
    """
    Get relevant hints from the Graphiti knowledge graph.

    This is a convenience function for querying historical context
    from the memory system. Used by spec_runner, ideation_runner,
    and roadmap_runner to inject historical insights.

    Args:
        query: Search query (e.g., "authentication patterns", "API design")
        project_id: Project identifier for scoping results
        max_results: Maximum number of hints to return
        spec_dir: Optional spec directory for loading memory instance

    Returns:
        List of hint dictionaries with keys:
            - content: str - The hint content
            - score: float - Relevance score
            - type: str - Type of hint (pattern, gotcha, outcome, etc.)

    Note:
        Returns empty list if Graphiti is not enabled or unavailable.
        This function never raises - it always fails gracefully.
    """
    if not is_graphiti_enabled():
        logger.debug("Graphiti not enabled, returning empty hints")
        return []

    try:
        from pathlib import Path

        from integrations.graphiti.memory import GraphitiMemory, GroupIdMode

        # Determine project directory from project_id or use current dir
        project_dir = Path.cwd()

        # Use spec_dir if provided, otherwise create a temp context
        if spec_dir is None:
            # Create a temporary spec dir for the query
            import tempfile

            spec_dir = Path(tempfile.mkdtemp(prefix="graphiti_query_"))

        # Create memory instance with project-level scope for cross-spec hints
        memory = GraphitiMemory(
            spec_dir=spec_dir,
            project_dir=project_dir,
            group_id_mode=GroupIdMode.PROJECT,
        )

        # Query for relevant context
        hints = await memory.get_relevant_context(
            query=query,
            num_results=max_results,
            include_project_context=True,
        )

        await memory.close()

        logger.info(f"Retrieved {len(hints)} graph hints for query: {query[:50]}...")
        return hints

    except ImportError as e:
        logger.debug(f"Graphiti packages not available: {e}")
        return []
    except Exception as e:
        logger.warning(f"Failed to get graph hints: {e}")
        return []

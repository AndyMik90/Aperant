"""
Graphiti Memory Integration V2 - Backward Compatibility Facade
================================================================

This module maintains backward compatibility by re-exporting the modular
memory system from the auto-claude/graphiti/ package.

The refactored code is now organized as:
- graphiti/graphiti.py - Main GraphitiMemory class
- graphiti/client.py - LadybugDB client wrapper
- graphiti/queries.py - Graph query operations
- graphiti/search.py - Semantic search logic
- graphiti/schema.py - Graph schema definitions

Import from this module:
    from integrations.graphiti.memory import GraphitiMemory, is_graphiti_enabled, GroupIdMode

For detailed documentation on the memory system architecture and usage,
see graphiti/graphiti.py.
"""

from pathlib import Path

# Import config utilities
from graphiti_config import (
    GraphitiConfig,
    is_graphiti_enabled,
)

# Re-export from modular system (queries_pkg)
from .queries_pkg.graphiti import GraphitiMemory
from .queries_pkg.schema import (
    EPISODE_TYPE_CODEBASE_DISCOVERY,
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_HISTORICAL_CONTEXT,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_QA_RESULT,
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_TASK_OUTCOME,
    MAX_CONTEXT_RESULTS,
    GroupIdMode,
)


# Convenience function for getting a memory manager
def get_graphiti_memory(
    spec_dir: Path,
    project_dir: Path,
    group_id_mode: str = GroupIdMode.PROJECT,
) -> GraphitiMemory:
    """
    Get a GraphitiMemory instance for the given spec.

    This is the main entry point for other modules.

    Args:
        spec_dir: Spec directory
        project_dir: Project root directory
        group_id_mode: "spec" for isolated memory, "project" for shared (default)

    Returns:
        GraphitiMemory instance

    Note:
        Default changed from SPEC to PROJECT to enable cross-spec learning across
        the entire project. Use GroupIdMode.SPEC explicitly for isolated per-spec memory.
    """
    return GraphitiMemory(spec_dir, project_dir, group_id_mode)


async def test_graphiti_connection() -> tuple[bool, str]:
    """
    Test if LadybugDB is available and Graphiti can connect.

    Uses the embedded LadybugDB via the patched KuzuDriver (no remote connection).

    Returns:
        Tuple of (success: bool, message: str)
    """
    config = GraphitiConfig.from_env()

    if not config.enabled:
        return False, "Graphiti not enabled (GRAPHITI_ENABLED not set to true)"

    # Validate provider configuration
    errors = config.get_validation_errors()
    if errors:
        return False, f"Configuration errors: {'; '.join(errors)}"

    try:
        from graphiti_core import Graphiti
        from graphiti_providers import ProviderError, create_embedder, create_llm_client

        # Import the patched driver creator (handles LadybugDB monkeypatch internally)
        from integrations.graphiti.queries_pkg.client import _apply_ladybug_monkeypatch
        from integrations.graphiti.queries_pkg.kuzu_driver_patched import (
            create_patched_kuzu_driver,
        )

        # Create providers
        try:
            llm_client = create_llm_client(config)  # pragma: no cover
            embedder = create_embedder(config)  # pragma: no cover
        except ProviderError as e:
            return False, f"Provider error: {e}"

        # Apply LadybugDB monkeypatch for embedded database
        if not _apply_ladybug_monkeypatch():  # pragma: no cover
            return False, "LadybugDB not installed (requires Python 3.12+)"

        # Create embedded database driver
        db_path = config.get_db_path()
        driver = create_patched_kuzu_driver(db=str(db_path))  # pragma: no cover

        graphiti = Graphiti(  # pragma: no cover
            graph_driver=driver,
            llm_client=llm_client,
            embedder=embedder,
        )

        # Try a simple operation
        await graphiti.build_indices_and_constraints()  # pragma: no cover
        await graphiti.close()  # pragma: no cover

        return True, (  # pragma: no cover
            f"Connected to LadybugDB at {db_path} "
            f"(providers: {config.get_provider_summary()})"
        )

    except ImportError as e:
        return False, f"Graphiti packages not installed: {e}"

    except Exception as e:  # pragma: no cover
        return False, f"Connection failed: {e}"


async def test_provider_configuration() -> dict:
    """
    Test the current provider configuration and return detailed status.

    Returns:
        Dict with test results for each component
    """
    from graphiti_providers import (
        test_embedder_connection,
        test_llm_connection,
        test_ollama_connection,
    )

    config = GraphitiConfig.from_env()

    results = {
        "config_valid": config.is_valid(),
        "validation_errors": config.get_validation_errors(),
        "llm_provider": config.llm_provider,
        "embedder_provider": config.embedder_provider,
        "llm_test": None,
        "embedder_test": None,
    }

    # Test LLM
    llm_success, llm_msg = await test_llm_connection(config)
    results["llm_test"] = {"success": llm_success, "message": llm_msg}

    # Test embedder
    emb_success, emb_msg = await test_embedder_connection(config)
    results["embedder_test"] = {"success": emb_success, "message": emb_msg}

    # Extra test for Ollama
    if config.llm_provider == "ollama" or config.embedder_provider == "ollama":
        ollama_success, ollama_msg = await test_ollama_connection(
            config.ollama_base_url
        )
        results["ollama_test"] = {"success": ollama_success, "message": ollama_msg}

    return results


# Re-export all public APIs for backward compatibility
__all__ = [
    "GraphitiMemory",
    "GroupIdMode",
    "get_graphiti_memory",
    "is_graphiti_enabled",
    "test_graphiti_connection",
    "test_provider_configuration",
    "MAX_CONTEXT_RESULTS",
    "EPISODE_TYPE_SESSION_INSIGHT",
    "EPISODE_TYPE_CODEBASE_DISCOVERY",
    "EPISODE_TYPE_PATTERN",
    "EPISODE_TYPE_GOTCHA",
    "EPISODE_TYPE_TASK_OUTCOME",
    "EPISODE_TYPE_QA_RESULT",
    "EPISODE_TYPE_HISTORICAL_CONTEXT",
]

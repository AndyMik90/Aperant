#!/usr/bin/env python3
"""
Graphiti Integration Helpers
============================

Helper functions for Graphiti memory system integration.
Handles checking if Graphiti is available and managing async operations.
"""

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from core.sentry import capture_exception

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from integrations.graphiti.memory import GraphitiMemory


def is_graphiti_memory_enabled() -> bool:
    """
    Check if Graphiti memory integration is available.

    Returns True if:
    - GRAPHITI_ENABLED is set to true/1/yes
    - A valid LLM provider is configured (OpenAI, Anthropic, Azure, or Ollama)
    - A valid embedder provider is configured (OpenAI, Voyage, Azure, or Ollama)

    See graphiti_config.py for detailed provider requirements.
    """
    try:
        from graphiti_config import is_graphiti_enabled

        return is_graphiti_enabled()
    except ImportError:
        return False


async def get_graphiti_memory(
    spec_dir: Path, project_dir: Path | None = None
) -> "GraphitiMemory | None":
    """
    Get an initialized GraphitiMemory instance if available.

    Args:
        spec_dir: Spec directory
        project_dir: Project root directory (defaults to spec_dir.parent.parent)

    Returns:
        Initialized GraphitiMemory instance or None if not available

    Note:
        This function is async and calls initialize() on the memory instance
        before returning, following the GitHub pattern for proper initialization.
    """
    if not is_graphiti_memory_enabled():
        return None

    try:
        from integrations.graphiti.memory import GraphitiMemory, GroupIdMode

        if project_dir is None:
            project_dir = spec_dir.parent.parent
        # Use project-wide shared memory for cross-spec learning
        memory = GraphitiMemory(
            spec_dir, project_dir, group_id_mode=GroupIdMode.PROJECT
        )

        # Initialize the memory instance (following GitHub pattern)
        await memory.initialize()

        return memory
    except ImportError:
        return None
    except Exception as e:
        logger.warning(f"Failed to initialize Graphiti memory: {e}")
        capture_exception(
            e,
            function="get_graphiti_memory",
            spec_dir=str(spec_dir),
            project_dir=str(project_dir) if project_dir else None,
        )
        return None


def run_async(coro):
    """
    Run an async coroutine synchronously.

    NOTE: This should only be called from synchronous code. For async callers,
    use the async function directly with await to ensure proper execution.

    Args:
        coro: Async coroutine to run

    Returns:
        Result of the coroutine, or None if already in an async context
    """
    try:
        asyncio.get_running_loop()
        # Already in an async context - caller should use await directly
        # Log a warning and return None to avoid returning a Future that
        # callers would incorrectly try to use as the actual result
        logger.warning(
            "run_async called from async context. "
            "Use await directly for proper execution."
        )
        # Close the coroutine to avoid "coroutine was never awaited" warning
        coro.close()
        return None
    except RuntimeError:
        # No event loop running - safe to create one
        return asyncio.run(coro)


async def save_to_graphiti_async(
    spec_dir: Path,
    session_num: int,
    insights: dict[str, Any],
    project_dir: Path | None = None,
) -> bool:
    """
    Save session insights to Graphiti (async helper).

    This is called in addition to file-based storage when Graphiti is enabled.

    Args:
        spec_dir: Spec directory
        session_num: Session number
        insights: Session insights dictionary
        project_dir: Optional project directory

    Returns:
        True if save succeeded, False otherwise
    """
    graphiti = await get_graphiti_memory(spec_dir, project_dir)
    if graphiti is None:
        return False

    try:
        result = await graphiti.save_session_insights(session_num, insights)

        # Also save codebase discoveries if present
        discoveries = insights.get("discoveries", {})
        files_understood = discoveries.get("files_understood", {})
        if files_understood:
            await graphiti.save_codebase_discoveries(files_understood)

        # Save patterns
        for pattern in discoveries.get("patterns_found", []):
            await graphiti.save_pattern(pattern)

        # Save gotchas
        for gotcha in discoveries.get("gotchas_encountered", []):
            await graphiti.save_gotcha(gotcha)

        return result

    except Exception as e:
        logger.warning(f"Failed to save to Graphiti: {e}")
        capture_exception(
            e,
            function="save_to_graphiti_async",
            spec_dir=str(spec_dir),
            session_num=session_num,
            project_dir=str(project_dir) if project_dir else None,
        )
        return False
    finally:
        # Always close the graphiti connection (swallow exceptions to avoid overriding)
        if graphiti is not None:
            try:
                await graphiti.close()
            except Exception as close_error:
                logger.debug(
                    "Failed to close Graphiti memory connection", exc_info=True
                )
                capture_exception(
                    close_error,
                    function="save_to_graphiti_async",
                    context="closing_connection",
                    spec_dir=str(spec_dir),
                    session_num=session_num,
                )

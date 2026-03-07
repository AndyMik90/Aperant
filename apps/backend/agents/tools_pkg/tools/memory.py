"""
Session Memory Tools
====================

Tools for recording and retrieving session memory, including discoveries,
gotchas, and patterns.

Dual-storage approach:
- File-based: Always available, works offline, spec-specific
- LadybugDB: When Graphiti is enabled, also saves to graph database for
  cross-session retrieval and Memory UI display
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from claude_agent_sdk import tool

    SDK_TOOLS_AVAILABLE = True
except ImportError:
    SDK_TOOLS_AVAILABLE = False
    tool = None

logger = logging.getLogger(__name__)


async def _save_to_graphiti_async(
    spec_dir: Path,
    project_dir: Path,
    save_type: str,
    data: dict,
) -> bool:
    """
    Save data to Graphiti/LadybugDB (async implementation).

    Args:
        spec_dir: Spec directory for GraphitiMemory initialization
        project_dir: Project root directory
        save_type: Type of save - 'discovery', 'gotcha', or 'pattern'
        data: Data to save

    Returns:
        True if save succeeded, False otherwise
    """
    try:
        # Use centralized helper for GraphitiMemory instantiation
        # The helper handles enablement checks internally
        from memory.graphiti_helpers import get_graphiti_memory

        memory = await get_graphiti_memory(spec_dir, project_dir)
        if memory is None:
            return False

        try:
            if save_type == "discovery":
                # Save as codebase discovery
                # Format: {file_path: description}
                result = await memory.save_codebase_discoveries(
                    {data["file_path"]: data["description"]}
                )
            elif save_type == "gotcha":
                # Save as gotcha
                gotcha_text = data["gotcha"]
                if data.get("context"):
                    gotcha_text += f" (Context: {data['context']})"
                result = await memory.save_gotcha(gotcha_text)
            elif save_type == "pattern":
                # Save as pattern
                result = await memory.save_pattern(data["pattern"])
            else:
                result = False
            return result
        finally:
            # Always close the memory connection (swallow exceptions to avoid overriding)
            try:
                await memory.close()
            except Exception as e:
                logger.debug(
                    "Failed to close Graphiti memory connection", exc_info=True
                )

    except Exception as e:
        logger.warning(f"Failed to save to Graphiti: {e}")
        return False


def _save_to_graphiti_sync(
    spec_dir: Path,
    project_dir: Path,
    save_type: str,
    data: dict,
) -> bool:
    """
    Save data to Graphiti/LadybugDB (synchronous wrapper for sync contexts only).

    NOTE: This should only be called from synchronous code. For async callers,
    use _save_to_graphiti_async() directly to ensure proper resource cleanup.

    Args:
        spec_dir: Spec directory for GraphitiMemory initialization
        project_dir: Project root directory
        save_type: Type of save - 'discovery', 'gotcha', or 'pattern'
        data: Data to save

    Returns:
        True if save succeeded, False otherwise
    """
    try:
        # Check if we're already in an async context
        try:
            asyncio.get_running_loop()
            # We're in an async context - caller should use _save_to_graphiti_async
            # Log a warning and return False to avoid the resource leak bug
            logger.warning(
                "_save_to_graphiti_sync called from async context. "
                "Use _save_to_graphiti_async instead for proper cleanup."
            )
            return False
        except RuntimeError:
            # No running loop - safe to create one
            return asyncio.run(
                _save_to_graphiti_async(spec_dir, project_dir, save_type, data)
            )
    except Exception as e:
        logger.warning(f"Failed to save to Graphiti: {e}")
        return False


def create_memory_tools(spec_dir: Path, project_dir: Path) -> list:
    """
    Create session memory tools.

    Args:
        spec_dir: Path to the spec directory
        project_dir: Path to the project root

    Returns:
        List of memory tool functions
    """
    if not SDK_TOOLS_AVAILABLE:
        return []

    tools = []

    # -------------------------------------------------------------------------
    # Tool: record_discovery
    # -------------------------------------------------------------------------
    @tool(
        "record_discovery",
        "Record a codebase discovery to session memory. Use this when you learn something important about the codebase.",
        {"file_path": str, "description": str, "category": str},
    )
    async def record_discovery(args: dict[str, Any]) -> dict[str, Any]:
        """Record a discovery to the codebase map (file + Graphiti)."""
        file_path = args["file_path"]
        description = args["description"]
        category = args.get("category", "general")

        memory_dir = spec_dir / "memory"
        memory_dir.mkdir(exist_ok=True)

        codebase_map_file = memory_dir / "codebase_map.json"
        saved_to_graphiti = False

        try:
            # PRIMARY: Save to file-based storage (always works)
            # Load existing map or create new
            if codebase_map_file.exists():
                with open(codebase_map_file, encoding="utf-8") as f:
                    codebase_map = json.load(f)
            else:
                codebase_map = {
                    "discovered_files": {},
                    "last_updated": None,
                }

            # Add or update the discovery
            codebase_map["discovered_files"][file_path] = {
                "description": description,
                "category": category,
                "discovered_at": datetime.now(timezone.utc).isoformat(),
            }
            codebase_map["last_updated"] = datetime.now(timezone.utc).isoformat()

            with open(codebase_map_file, "w", encoding="utf-8") as f:
                json.dump(codebase_map, f, indent=2)

            # SECONDARY: Also save to Graphiti/LadybugDB (for Memory UI)
            saved_to_graphiti = await _save_to_graphiti_async(
                spec_dir,
                project_dir,
                "discovery",
                {
                    "file_path": file_path,
                    "description": f"[{category}] {description}",
                },
            )

            storage_note = " (also saved to memory graph)" if saved_to_graphiti else ""
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Recorded discovery for '{file_path}': {description}{storage_note}",
                    }
                ]
            }

        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Error recording discovery: {e}"}]
            }

    tools.append(record_discovery)

    # -------------------------------------------------------------------------
    # Tool: record_gotcha
    # -------------------------------------------------------------------------
    @tool(
        "record_gotcha",
        "Record a gotcha or pitfall to avoid. Use this when you encounter something that future sessions should know.",
        {"gotcha": str, "context": str},
    )
    async def record_gotcha(args: dict[str, Any]) -> dict[str, Any]:
        """Record a gotcha to session memory (file + Graphiti)."""
        gotcha = args["gotcha"]
        context = args.get("context", "")

        memory_dir = spec_dir / "memory"
        memory_dir.mkdir(exist_ok=True)

        gotchas_file = memory_dir / "gotchas.md"
        saved_to_graphiti = False

        try:
            # PRIMARY: Save to file-based storage (always works)
            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

            entry = f"\n## [{timestamp}]\n{gotcha}"
            if context:
                entry += f"\n\n_Context: {context}_"
            entry += "\n"

            with open(gotchas_file, "a", encoding="utf-8") as f:
                if not gotchas_file.exists() or gotchas_file.stat().st_size == 0:
                    f.write(
                        "# Gotchas & Pitfalls\n\nThings to watch out for in this codebase.\n"
                    )
                f.write(entry)

            # SECONDARY: Also save to Graphiti/LadybugDB (for Memory UI)
            saved_to_graphiti = await _save_to_graphiti_async(
                spec_dir,
                project_dir,
                "gotcha",
                {"gotcha": gotcha, "context": context},
            )

            storage_note = " (also saved to memory graph)" if saved_to_graphiti else ""
            return {
                "content": [
                    {"type": "text", "text": f"Recorded gotcha: {gotcha}{storage_note}"}
                ]
            }

        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Error recording gotcha: {e}"}]
            }

    tools.append(record_gotcha)

    # -------------------------------------------------------------------------
    # Tool: get_session_context
    # -------------------------------------------------------------------------
    @tool(
        "get_session_context",
        "Get context from previous sessions including discoveries, gotchas, and patterns.",
        {},
    )
    async def get_session_context(args: dict[str, Any]) -> dict[str, Any]:
        """Get accumulated session context."""
        memory_dir = spec_dir / "memory"

        if not memory_dir.exists():
            return {
                "content": [
                    {
                        "type": "text",
                        "text": "No session memory found. This appears to be the first session.",
                    }
                ]
            }

        result_parts = []

        # Load codebase map
        codebase_map_file = memory_dir / "codebase_map.json"
        if codebase_map_file.exists():
            try:
                with open(codebase_map_file, encoding="utf-8") as f:
                    codebase_map = json.load(f)

                discoveries = codebase_map.get("discovered_files", {})
                if discoveries:
                    result_parts.append("## Codebase Discoveries")
                    for path, info in list(discoveries.items())[:20]:  # Limit to 20
                        desc = info.get("description", "No description")
                        result_parts.append(f"- `{path}`: {desc}")
            except Exception:
                pass

        # Load gotchas
        gotchas_file = memory_dir / "gotchas.md"
        if gotchas_file.exists():
            try:
                content = gotchas_file.read_text(encoding="utf-8")
                if content.strip():
                    result_parts.append("\n## Gotchas")
                    # Take last 1000 chars to avoid too much context
                    result_parts.append(
                        content[-1000:] if len(content) > 1000 else content
                    )
            except Exception:
                pass

        # Load patterns
        patterns_file = memory_dir / "patterns.md"
        if patterns_file.exists():
            try:
                content = patterns_file.read_text(encoding="utf-8")
                if content.strip():
                    result_parts.append("\n## Patterns")
                    result_parts.append(
                        content[-1000:] if len(content) > 1000 else content
                    )
            except Exception:
                pass

        if not result_parts:
            return {
                "content": [
                    {"type": "text", "text": "No session context available yet."}
                ]
            }

        return {"content": [{"type": "text", "text": "\n".join(result_parts)}]}

    tools.append(get_session_context)

    return tools

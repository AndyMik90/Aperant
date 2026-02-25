#!/usr/bin/env python3
"""
Codebase Map Management
=======================

Functions for managing the codebase map that tracks file purposes.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from .graphiti_helpers import get_graphiti_memory, is_graphiti_memory_enabled, run_async
from .paths import get_memory_dir

logger = logging.getLogger(__name__)


def update_codebase_map(spec_dir: Path, discoveries: dict[str, str]) -> None:
    """
    Update the codebase map with newly discovered file purposes.

    This function merges new discoveries with existing ones. If a file path
    already exists, its purpose will be updated.

    Args:
        spec_dir: Path to spec directory
        discoveries: Dictionary mapping file paths to their purposes
            Example: {
                "src/api/auth.py": "Handles JWT authentication",
                "src/models/user.py": "User database model"
            }
    """
    memory_dir = get_memory_dir(spec_dir)
    map_file = memory_dir / "codebase_map.json"

    # Load existing map or create new
    if map_file.exists():
        try:
            with open(map_file, encoding="utf-8") as f:
                codebase_map = json.load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            codebase_map = {}
    else:
        codebase_map = {}

    # Update with new discoveries
    codebase_map.update(discoveries)

    # Add metadata
    if "_metadata" not in codebase_map:
        codebase_map["_metadata"] = {}

    codebase_map["_metadata"]["last_updated"] = datetime.now(timezone.utc).isoformat()
    codebase_map["_metadata"]["total_files"] = len(
        [k for k in codebase_map.keys() if k != "_metadata"]
    )

    # Write back
    with open(map_file, "w", encoding="utf-8") as f:
        json.dump(codebase_map, f, indent=2, sort_keys=True)

    # Also save to Graphiti if enabled
    if is_graphiti_memory_enabled() and discoveries:
        try:
            graphiti = run_async(get_graphiti_memory(spec_dir))
            if graphiti:
                run_async(graphiti.save_codebase_discoveries(discoveries))
                run_async(graphiti.close())
                logger.info("Codebase discoveries also saved to Graphiti")
        except Exception as e:
            logger.warning(f"Graphiti codebase save failed: {e}")


def load_codebase_map(spec_dir: Path) -> dict[str, str]:
    """
    Load the codebase map.

    Args:
        spec_dir: Path to spec directory

    Returns:
        Dictionary mapping file paths to their purposes.
        Returns empty dict if no map exists.
    """
    memory_dir = get_memory_dir(spec_dir)
    map_file = memory_dir / "codebase_map.json"

    if not map_file.exists():
        return {}

    try:
        with open(map_file, encoding="utf-8") as f:
            codebase_map = json.load(f)

        # Remove metadata before returning
        codebase_map.pop("_metadata", None)
        return codebase_map

    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}

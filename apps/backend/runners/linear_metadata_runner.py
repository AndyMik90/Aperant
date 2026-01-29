#!/usr/bin/env python3
"""
Linear Workspace Metadata Runner
================================

CLI wrapper for fetching Linear workspace metadata.
Outputs JSON results to stdout for IPC communication.

Usage:
    python runners/linear_metadata_runner.py \\
        --project-dir /path/to/project

This script fetches and caches workspace metadata from Linear including
labels, users, teams, projects, and workflow states.
"""

import asyncio
import json
import logging
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Validate platform-specific dependencies
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def load_project_env(project_dir: Path) -> None:
    """Load project-specific .env file (for LINEAR_API_KEY).

    Args:
        project_dir: Project directory path
    """
    # Try common auto-build paths
    for auto_build_path in [".auto-claude", ".auto-claude-worktrees"]:
        project_env_file = project_dir / auto_build_path / ".env"
        if project_env_file.exists():
            load_dotenv(project_env_file, override=True)
            logger.info(f"Loaded project .env from {project_env_file}")
            return
    logger.warning(f"No project .env found in {project_dir}")


def output_result(result: dict) -> None:
    """Output result as JSON to stdout.

    Uses direct file descriptor writes to bypass any redirect_stdout() context managers.
    """
    import os

    result_json = json.dumps(result, ensure_ascii=False, indent=2)
    # Get original stdout file descriptor
    stdout_fd = sys.stdout.fileno()
    os.write(stdout_fd, result_json.encode("utf-8"))
    os.write(stdout_fd, b"\n")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Fetch Linear workspace metadata"
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        required=True,
        help="Path to project directory",
    )
    parser.add_argument(
        "--invalidate-cache",
        action="store_true",
        help="Invalidate cache before fetching",
    )

    args = parser.parse_args()

    # Load project environment
    load_project_env(args.project_dir)

    # Get API key
    import os

    api_key = os.getenv("LINEAR_API_KEY")
    if not api_key:
        result = {
            "success": False,
            "error": "LINEAR_API_KEY not found in environment",
        }
        output_result(result)
        sys.exit(1)

    # Invalidate cache if requested
    if args.invalidate_cache:
        from integrations.linear.linear_metadata import invalidate_metadata_cache

        invalidate_metadata_cache()
        logger.info("Cache invalidated")

    # Fetch metadata
    try:
        from integrations.linear.linear_metadata import fetch_linear_workspace_metadata

        metadata = fetch_linear_workspace_metadata(api_key)

        result = {
            "success": True,
            "data": metadata,
        }
        output_result(result)

    except Exception as e:
        logger.exception("Failed to fetch Linear workspace metadata")
        result = {
            "success": False,
            "error": str(e),
        }
        output_result(result)
        sys.exit(1)


if __name__ == "__main__":
    main()

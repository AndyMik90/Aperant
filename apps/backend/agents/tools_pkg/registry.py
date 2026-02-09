"""
Tool Registry
=============

Central registry for creating and managing ac-jerry MCP tools.
"""

from pathlib import Path

try:
    from claude_agent_sdk import create_sdk_mcp_server

    SDK_TOOLS_AVAILABLE = True
except ImportError:
    SDK_TOOLS_AVAILABLE = False
    create_sdk_mcp_server = None

from .tools import (
    create_memory_tools,
    create_progress_tools,
    create_qa_tools,
    create_subtask_tools,
)


def create_all_tools(spec_dir: Path, project_dir: Path) -> list:
    """
    Create all custom tools with the given spec and project directories.

    Args:
        spec_dir: Path to the spec directory
        project_dir: Path to the project root

    Returns:
        List of all tool functions
    """
    if not SDK_TOOLS_AVAILABLE:
        return []

    all_tools = []

    # Create tools by category
    all_tools.extend(create_subtask_tools(spec_dir, project_dir))
    all_tools.extend(create_progress_tools(spec_dir, project_dir))
    all_tools.extend(create_memory_tools(spec_dir, project_dir))
    all_tools.extend(create_qa_tools(spec_dir, project_dir))

    return all_tools


def create_ac_jerry_mcp_server(spec_dir: Path, project_dir: Path):
    """
    Create an MCP server with ac-jerry custom tools.

    Args:
        spec_dir: Path to the spec directory
        project_dir: Path to the project root

    Returns:
        MCP server instance, or None if SDK tools not available
    """
    if not SDK_TOOLS_AVAILABLE:
        return None

    tools = create_all_tools(spec_dir, project_dir)

    return create_sdk_mcp_server(name="ac-jerry", version="1.0.0", tools=tools)


def is_tools_available() -> bool:
    """Check if SDK tools functionality is available."""
    return SDK_TOOLS_AVAILABLE

"""
Custom Agents Integration
=========================

Parses custom agent .md files from ~/.claude/agents/ and provides
their configuration (system prompt, optional tool/MCP overrides)
for use in the Auto-Claude build pipeline.

Custom agent files are markdown files that may include YAML frontmatter
for tool and MCP server configuration:

    ---
    tools: [Read, Write, Edit, Bash, Glob, Grep]
    mcp_servers: [context7, graphiti]
    thinking: high
    ---
    You are a frontend specialist...

If no frontmatter is provided, only the system prompt (markdown body)
is used, and tool/MCP configuration comes from the base AGENT_CONFIGS.
"""

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class CustomAgentConfig:
    """Parsed configuration from a custom agent .md file."""

    agent_id: str
    system_prompt: str
    tools: list[str] | None = None  # Override base tools (None = use defaults)
    mcp_servers: list[str] | None = None  # Override MCP servers (None = use defaults)
    thinking: str | None = None  # Override thinking level (None = use default)
    raw_frontmatter: dict = field(default_factory=dict)


def get_agents_dir() -> Path:
    """Get the custom agents directory (~/.claude/agents/)."""
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(
        os.path.expanduser("~"), ".claude"
    )
    return Path(config_dir) / "agents"


def parse_agent_file(file_path: Path) -> CustomAgentConfig | None:
    """
    Parse a custom agent .md file.

    Extracts optional YAML frontmatter (between --- delimiters) and the
    markdown body as the system prompt.

    Args:
        file_path: Path to the .md agent file

    Returns:
        CustomAgentConfig if file is valid, None if file doesn't exist or is invalid
    """
    if not file_path.exists() or not file_path.is_file():
        logger.warning(f"Custom agent file not found: {file_path}")
        return None

    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to read custom agent file {file_path}: {e}")
        return None

    agent_id = file_path.stem  # filename without .md
    frontmatter = {}
    body = content

    # Extract YAML frontmatter if present
    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", content, re.DOTALL)
    if fm_match:
        fm_text = fm_match.group(1)
        body = fm_match.group(2).strip()

        # Simple YAML-like parsing (avoid heavy yaml dependency)
        frontmatter = _parse_simple_yaml(fm_text)

    system_prompt = body.strip()
    if not system_prompt:
        logger.warning(f"Custom agent file has no content: {file_path}")
        return None

    # Extract optional overrides from frontmatter
    tools = _parse_string_list(frontmatter.get("tools"))
    mcp_servers = _parse_string_list(frontmatter.get("mcp_servers"))
    thinking = frontmatter.get("thinking")

    if thinking and thinking not in ("low", "medium", "high"):
        logger.warning(
            f"Invalid thinking level '{thinking}' in {file_path}, ignoring"
        )
        thinking = None

    return CustomAgentConfig(
        agent_id=agent_id,
        system_prompt=system_prompt,
        tools=tools,
        mcp_servers=mcp_servers,
        thinking=thinking,
        raw_frontmatter=frontmatter,
    )


def load_custom_agent(agent_id: str) -> CustomAgentConfig | None:
    """
    Load a custom agent by ID.

    Searches through category directories in ~/.claude/agents/ for
    a matching agent file.

    Args:
        agent_id: Agent ID (filename without .md extension)

    Returns:
        CustomAgentConfig if found, None otherwise
    """
    agents_dir = get_agents_dir()
    if not agents_dir.exists():
        return None

    # Search in all category directories
    for category_dir in sorted(agents_dir.iterdir()):
        if not category_dir.is_dir():
            continue
        agent_file = category_dir / f"{agent_id}.md"
        if agent_file.exists():
            return parse_agent_file(agent_file)

    # Also check root agents dir (no category)
    root_file = agents_dir / f"{agent_id}.md"
    if root_file.exists():
        return parse_agent_file(root_file)

    logger.debug(f"Custom agent '{agent_id}' not found in {agents_dir}")
    return None


def _parse_simple_yaml(text: str) -> dict:
    """
    Parse simple YAML-like frontmatter (key: value pairs).

    Handles:
    - key: value (strings)
    - key: [item1, item2] (inline lists)
    - key: (empty value)

    Does NOT handle nested structures or multi-line values.
    """
    result = {}
    for line in text.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()

        # Parse inline list: [item1, item2]
        if value.startswith("[") and value.endswith("]"):
            items = value[1:-1].split(",")
            result[key] = [item.strip().strip("\"'") for item in items if item.strip()]
        elif value:
            # Strip quotes
            result[key] = value.strip("\"'")
        else:
            result[key] = ""

    return result


def _parse_string_list(value) -> list[str] | None:
    """Parse a value as a list of strings, or None if empty/invalid."""
    if value is None:
        return None
    if isinstance(value, list):
        cleaned = [str(v).strip() for v in value if v]
        return cleaned if cleaned else None
    if isinstance(value, str) and value:
        return [v.strip() for v in value.split(",") if v.strip()]
    return None

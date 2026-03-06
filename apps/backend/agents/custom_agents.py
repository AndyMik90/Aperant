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

from phase_config import sanitize_thinking_level

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

    # Normalize CRLF to LF so frontmatter regex works on Windows files
    normalized = content.replace("\r\n", "\n")
    body = normalized

    # Extract YAML frontmatter if present
    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", normalized, re.DOTALL)
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

    if thinking:
        sanitized = sanitize_thinking_level(str(thinking))
        if sanitized != str(thinking):
            logger.warning(
                f"Thinking level '{thinking}' in {file_path} was sanitized to '{sanitized}'"
            )
        thinking = sanitized

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
    # Validate agent_id to prevent path traversal
    if not re.fullmatch(r"[A-Za-z0-9._-]+", agent_id):
        return None

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


def load_all_agents() -> list[CustomAgentConfig]:
    """Load all custom agents from all categories and root level in ~/.claude/agents/."""
    agents_dir = get_agents_dir()
    if not agents_dir.exists():
        return []

    agents = []

    # Load agents from category subdirectories
    for category_dir in sorted(agents_dir.iterdir()):
        if not category_dir.is_dir():
            continue
        for agent_file in sorted(category_dir.glob("*.md")):
            if agent_file.name == "README.md":
                continue
            agent = parse_agent_file(agent_file)
            if agent:
                agents.append(agent)

    # Also load root-level agent files (no category)
    for agent_file in sorted(agents_dir.glob("*.md")):
        if agent_file.name == "README.md":
            continue
        agent = parse_agent_file(agent_file)
        if agent:
            agents.append(agent)

    return agents


def _format_category_name(dir_name: str) -> str:
    """Format a directory name into a human-readable category name.

    Strips a leading numeric prefix (e.g. '01-backend' -> 'Backend') and
    replaces hyphens with spaces, then title-cases the result.

    Args:
        dir_name: Raw directory name (e.g. '02-frontend-tools')

    Returns:
        Formatted category name (e.g. 'Frontend Tools')
    """
    if "-" in dir_name:
        return dir_name.split("-", 1)[-1].replace("-", " ").title()
    return dir_name


def build_agents_catalog_prompt() -> str | None:
    """
    Build a concise catalog of all available custom agents for system prompt injection.

    Returns a formatted string listing all agents by category with their descriptions,
    or None if no agents are available.
    """
    agents_dir = get_agents_dir()
    if not agents_dir.exists():
        return None

    categories: list[tuple[str, list[tuple[str, str]]]] = []

    for category_dir in sorted(agents_dir.iterdir()):
        if not category_dir.is_dir():
            continue
        category_name = _format_category_name(category_dir.name)

        agent_entries = []
        for agent_file in sorted(category_dir.glob("*.md")):
            if agent_file.name == "README.md":
                continue
            agent = parse_agent_file(agent_file)
            if agent:
                # Get description from frontmatter, or first line of prompt
                description = agent.raw_frontmatter.get("description", "")
                if not description:
                    # Use first sentence of system prompt as fallback
                    first_line = agent.system_prompt.split("\n")[0].strip()
                    description = first_line[:120]
                elif len(description) > 150:
                    description = description[:147] + "..."
                agent_entries.append((agent.agent_id, description))

        if agent_entries:
            categories.append((category_name, agent_entries))

    # Also include root-level agent files (no category)
    root_entries: list[tuple[str, str]] = []
    for agent_file in sorted(agents_dir.glob("*.md")):
        if agent_file.name == "README.md":
            continue
        agent = parse_agent_file(agent_file)
        if agent:
            description = agent.raw_frontmatter.get("description", "")
            if not description:
                first_line = agent.system_prompt.split("\n")[0].strip()
                description = first_line[:120]
            elif len(description) > 150:
                description = description[:147] + "..."
            root_entries.append((agent.agent_id, description))
    if root_entries:
        categories.append(("General", root_entries))

    if not categories:
        return None

    total = sum(len(entries) for _, entries in categories)
    lines = [
        f"# Available Specialist Agents ({total} agents)",
        "",
        "You have access to the following specialist agents organized by category.",
        "Use them when the task requires specialized expertise — spawn them as subagents",
        "via the Agent tool with the appropriate subagent_type.",
        "",
    ]

    for category_name, entries in categories:
        lines.append(f"## {category_name}")
        for agent_id, desc in entries:
            lines.append(f"- **{agent_id}**: {desc}")
        lines.append("")

    return "\n".join(lines)


def _parse_simple_yaml(text: str) -> dict:
    """
    Parse simple YAML-like frontmatter (key: value pairs).

    Uses ``yaml.safe_load`` when available for full YAML support (including
    block-list syntax).  Falls back to a manual parser that handles:
    - key: value (strings)
    - key: [item1, item2] (inline lists)
    - key: (empty value)
    - key:\\n  - item1\\n  - item2 (YAML block lists)
    """
    # Prefer yaml.safe_load for robust parsing
    try:
        import yaml

        parsed = yaml.safe_load(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    # Fallback: manual parser with block-list support
    result: dict = {}
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        if ":" not in stripped:
            i += 1
            continue
        key, _, value = stripped.partition(":")
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
            # Empty value — check if next lines are block-list items (- item)
            block_items: list[str] = []
            j = i + 1
            while j < len(lines):
                next_line = lines[j]
                next_stripped = next_line.strip()
                if not next_stripped or next_stripped.startswith("#"):
                    j += 1
                    continue
                if next_stripped.startswith("- "):
                    block_items.append(next_stripped[2:].strip().strip("\"'"))
                    j += 1
                else:
                    break
            if block_items:
                result[key] = block_items
                i = j
                continue
            else:
                result[key] = ""

        i += 1

    return result


def _parse_string_list(value: object) -> list[str] | None:
    """Parse a value as a list of strings, or None if empty/invalid."""
    if value is None:
        return None
    if isinstance(value, list):
        cleaned = [str(v).strip() for v in value if v]
        return cleaned if cleaned else None
    if isinstance(value, str) and value:
        return [v.strip() for v in value.split(",") if v.strip()]
    return None

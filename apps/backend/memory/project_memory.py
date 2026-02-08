"""
Project Memory System
=====================

Provides a living document (PROJECT_MEMORY.md) that persists cross-task
learnings at the project level. Unlike spec-level memory (gotchas.md,
patterns.md), project memory survives across specs and provides a
cumulative knowledge base.

Location: {project_dir}/.auto-claude/PROJECT_MEMORY.md

Sections:
    - Architecture Decisions
    - Code Patterns
    - Known Gotchas
    - Testing & QA Notes
    - Agent Learnings
"""

import logging
import os
import re
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


@contextmanager
def _file_lock(lock_path: Path, timeout: float = 5.0):
    """Cross-platform file lock using a .lock file.

    Args:
        lock_path: Path to the file being protected (a .lock sibling is created).
        timeout: Maximum seconds to wait for lock acquisition (default: 5.0).
                 Only effective on non-Windows platforms.

    Raises:
        TimeoutError: If lock cannot be acquired within timeout.
        OSError: If lock file cannot be created.
    """
    lock_file = lock_path.with_suffix(".lock")
    fd = None
    try:
        fd = os.open(str(lock_file), os.O_CREAT | os.O_RDWR)
        if sys.platform == "win32":
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            # Use non-blocking lock with timeout to prevent indefinite hangs
            import time
            deadline = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except (OSError, IOError):
                    if time.monotonic() >= deadline:
                        logger.debug(
                            "File lock acquisition timed out after %.1fs for %s",
                            timeout, lock_file
                        )
                        raise TimeoutError(
                            f"Could not acquire file lock on {lock_file} "
                            f"within {timeout}s"
                        )
                    time.sleep(0.05)
        yield
    finally:
        if fd is not None:
            try:
                if sys.platform == "win32":
                    import msvcrt
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_UN)
            except (OSError, IOError) as e:
                logger.debug("Error releasing file lock on %s: %s", lock_file, e)
            os.close(fd)


# Section name mapping
SECTION_MAP = {
    "architecture": "Architecture Decisions",
    "patterns": "Code Patterns",
    "gotchas": "Known Gotchas",
    "testing": "Testing & QA Notes",
    "learnings": "Agent Learnings",
}

TEMPLATE_HEADER = "# Project Memory\n\nCross-task learnings and insights accumulated by Auto-Claude agents.\n"


def _get_memory_path(project_dir: Path) -> Path:
    """Get the path to PROJECT_MEMORY.md."""
    return Path(project_dir) / ".auto-claude" / "PROJECT_MEMORY.md"


def create_project_memory_template(project_dir: Path) -> Path:
    """
    Create PROJECT_MEMORY.md with section headers and placeholder lines.

    Args:
        project_dir: Project root directory

    Returns:
        Path to the created file
    """
    project_dir = Path(project_dir)
    memory_path = _get_memory_path(project_dir)
    memory_path.parent.mkdir(parents=True, exist_ok=True)

    sections = [TEMPLATE_HEADER]
    for section_title in SECTION_MAP.values():
        sections.append(f"## {section_title}\n")
        sections.append("_No entries yet._\n")

    memory_path.write_text("\n".join(sections), encoding="utf-8")
    logger.info(f"Created PROJECT_MEMORY.md at {memory_path}")
    return memory_path


def load_project_memory(project_dir: Path, max_chars: int = 4000) -> str | None:
    """
    Load PROJECT_MEMORY.md contents, truncated if too long.

    Args:
        project_dir: Project root directory
        max_chars: Maximum characters to return

    Returns:
        File contents as string, or None if file doesn't exist
    """
    if project_dir is None:
        return None

    project_dir = Path(project_dir)
    memory_path = _get_memory_path(project_dir)

    if not memory_path.exists():
        return None

    try:
        content = memory_path.read_text(encoding="utf-8")
        if not content.strip():
            return None

        if len(content) > max_chars:
            content = truncate_project_memory(content, max_chars)

        return content
    except Exception as e:
        logger.debug(f"Failed to load PROJECT_MEMORY.md: {e}")
        return None


def append_to_project_memory(
    project_dir: Path,
    section: str,
    content: str,
    source: str,
) -> bool:
    """
    Append a timestamped entry to a section of PROJECT_MEMORY.md.

    Args:
        project_dir: Project root directory
        section: One of 'architecture', 'patterns', 'gotchas', 'testing', 'learnings'
        content: The learning to record
        source: Attribution string (e.g., 'Task 1.2', 'QA iteration 3')

    Returns:
        True if entry was added, False if skipped (duplicate or error)
    """
    if project_dir is None:
        return False

    project_dir = Path(project_dir)

    if section not in SECTION_MAP:
        logger.warning(f"Invalid section '{section}'. Must be one of: {list(SECTION_MAP.keys())}")
        return False

    content = content.strip()
    if not content:
        return False

    memory_path = _get_memory_path(project_dir)

    # Create template if file doesn't exist
    if not memory_path.exists():
        create_project_memory_template(project_dir)

    try:
        with _file_lock(memory_path):
            existing = memory_path.read_text(encoding="utf-8")

            # Deduplication: check if the content already exists in the file
            if content in existing:
                logger.debug(f"Skipping duplicate project memory entry: {content[:50]}...")
                return False

            section_title = SECTION_MAP[section]
            section_header = f"## {section_title}"

            # Find the section and insert the entry
            if section_header not in existing:
                # Section header missing - append it
                existing += f"\n{section_header}\n\n"

            # Remove placeholder if present
            placeholder = "_No entries yet._"
            existing = existing.replace(f"{section_header}\n\n{placeholder}", f"{section_header}\n")

            # Format entry with timestamp
            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            entry = f"- **{date_str}** [{source}] {content}\n"

            # Insert entry after the section header
            # Find the section header position
            header_pos = existing.index(section_header)
            # Find the end of the header line
            header_end = existing.index("\n", header_pos) + 1

            # Insert the entry right after any existing entries in this section
            # Find the next section header or end of file
            next_section = None
            for other_title in SECTION_MAP.values():
                other_header = f"## {other_title}"
                if other_header != section_header:
                    pos = existing.find(other_header, header_end)
                    if pos != -1 and (next_section is None or pos < next_section):
                        next_section = pos

            if next_section is not None:
                # Insert before the next section
                insert_pos = next_section
                # Make sure there's a newline before the next section
                existing = existing[:insert_pos].rstrip("\n") + "\n" + entry + "\n" + existing[insert_pos:]
            else:
                # Append at end
                existing = existing.rstrip("\n") + "\n" + entry

            memory_path.write_text(existing, encoding="utf-8")
            logger.debug(f"Appended to project memory [{section}]: {content[:50]}...")
            return True

    except Exception as e:
        logger.debug(f"Failed to append to PROJECT_MEMORY.md: {e}")
        return False


def truncate_project_memory(content: str, max_chars: int) -> str:
    """
    Truncate project memory content while preserving structure.

    Keeps the header and most recent entries per section.

    Args:
        content: Full PROJECT_MEMORY.md content
        max_chars: Maximum characters to keep

    Returns:
        Truncated content
    """
    if len(content) <= max_chars:
        return content

    # Parse into sections
    sections = re.split(r'(## .+)', content)

    # sections[0] is the header, then alternating (header, content) pairs
    header = sections[0]
    section_pairs = []
    for i in range(1, len(sections), 2):
        section_header = sections[i]
        section_content = sections[i + 1] if i + 1 < len(sections) else ""
        section_pairs.append((section_header, section_content))

    # Start with header
    result = header
    remaining = max_chars - len(header)

    if not section_pairs:
        return content[:max_chars]

    # Budget per section
    budget_per_section = remaining // len(section_pairs)

    for section_header, section_content in section_pairs:
        result += section_header

        if len(section_content) <= budget_per_section - len(section_header):
            result += section_content
        else:
            # Keep only the most recent entries (entries at the end of the section)
            lines = section_content.strip().split("\n")
            kept_lines = []
            current_len = len(section_header) + 2  # +2 for newlines

            # Take lines from the end (most recent entries)
            for line in reversed(lines):
                if current_len + len(line) + 1 > budget_per_section:
                    break
                kept_lines.insert(0, line)
                current_len += len(line) + 1

            if kept_lines:
                result += "\n" + "\n".join(kept_lines) + "\n"
            else:
                result += "\n"

    return result

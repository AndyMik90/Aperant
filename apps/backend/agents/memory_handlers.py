"""
Memory Handlers for Anthropic Memory Tool
==========================================

Implements file-based handlers for Anthropic's native memory tool (memory_20250818).
Memory files are stored in spec_dir/memories/ and persist across sessions.

The Anthropic Python SDK handles the memory tool protocol natively. These handlers
execute the actual file operations when Claude invokes memory tool commands.

Memory Tool Commands:
- view: Read file/directory contents
- create: Create new file
- str_replace: Replace text in file
- insert: Insert text at line number
- delete: Delete file/directory
- rename: Rename/move file

Usage:
    from agents.memory_handlers import MemoryHandlers

    handlers = MemoryHandlers(spec_dir)
    result = handlers.view("/memories")
    result = handlers.create("/memories/plan.md", "# Plan\n...")
"""

import logging
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class MemoryHandlers:
    """
    Memory tool handlers for task conversation persistence.

    Memory files are stored in spec_dir/memories/ and persist across sessions.
    All paths are relative to the memories directory (e.g., "/memories/plan.md").
    """

    def __init__(self, spec_dir: Path):
        """
        Initialize memory handlers.

        Args:
            spec_dir: Path to the spec directory (contains spec.md, implementation_plan.json)
        """
        self.spec_dir = Path(spec_dir)
        self.memories_dir = self.spec_dir / "memories"
        self.memories_dir.mkdir(exist_ok=True)
        logger.debug(f"MemoryHandlers initialized with memories_dir: {self.memories_dir}")

    def _validate_path(self, path: str) -> Path:
        """
        Ensure path stays within memories directory.

        Args:
            path: Path string (e.g., "/memories/plan.md" or "plan.md")

        Returns:
            Resolved absolute path within memories directory

        Raises:
            ValueError: If path traversal attempt is detected
        """
        # Normalize path - remove /memories prefix if present
        normalized = path.replace("/memories", "").lstrip("/")
        if not normalized:
            # Root memories directory
            return self.memories_dir

        full_path = (self.memories_dir / normalized).resolve()

        # Security check: ensure path is within memories directory
        try:
            full_path.relative_to(self.memories_dir.resolve())
        except ValueError:
            raise ValueError(f"Path traversal attempt blocked: {path}")

        return full_path

    def view(self, path: str, view_range: Optional[tuple[int, int]] = None) -> str:
        """
        Read file or directory contents.

        Args:
            path: Path to view (e.g., "/memories" or "/memories/plan.md")
            view_range: Optional tuple of (start_line, end_line) for partial view

        Returns:
            File contents with line numbers, or directory listing
        """
        full_path = self._validate_path(path)

        if full_path.is_dir():
            # Directory listing
            files = sorted(full_path.iterdir())
            if not files:
                return f"Directory {path} is empty."
            return "\n".join(f.name for f in files)

        elif full_path.exists():
            # File contents with line numbers
            content = full_path.read_text(encoding="utf-8")
            lines = content.split("\n")

            # Apply view range if specified
            if view_range:
                start, end = view_range
                lines = lines[max(0, start - 1) : end]
                start_offset = max(0, start - 1)
            else:
                start_offset = 0

            # Format with line numbers
            numbered_lines = [
                f"{i + 1 + start_offset:4d} | {line}" for i, line in enumerate(lines)
            ]
            return "\n".join(numbered_lines)

        else:
            return f"The path {path} does not exist."

    def create(self, path: str, file_text: str) -> str:
        """
        Create a new file.

        Args:
            path: Path for new file (e.g., "/memories/plan.md")
            file_text: Content to write

        Returns:
            Success or error message
        """
        full_path = self._validate_path(path)

        if full_path.exists():
            return f"Error: File {path} already exists. Use str_replace to modify it."

        # Create parent directories if needed
        full_path.parent.mkdir(parents=True, exist_ok=True)

        full_path.write_text(file_text, encoding="utf-8")
        logger.info(f"Memory file created: {path}")
        return f"File created successfully at: {path}"

    def str_replace(self, path: str, old_str: str, new_str: str) -> str:
        """
        Replace text in file.

        Args:
            path: Path to file
            old_str: Text to find and replace
            new_str: Replacement text

        Returns:
            Success or error message
        """
        full_path = self._validate_path(path)

        if not full_path.exists():
            return f"Error: File {path} does not exist."

        content = full_path.read_text(encoding="utf-8")
        count = content.count(old_str)

        if count == 0:
            return f"No replacement performed, old_str not found in {path}"

        if count > 1:
            return (
                f"No replacement performed. Multiple occurrences ({count}) found. "
                f"Please provide more context to make the match unique."
            )

        new_content = content.replace(old_str, new_str, 1)
        full_path.write_text(new_content, encoding="utf-8")
        logger.debug(f"Memory file updated: {path}")
        return "The memory file has been edited."

    def insert(self, path: str, insert_line: int, insert_text: str) -> str:
        """
        Insert text at a specific line number.

        Args:
            path: Path to file
            insert_line: Line number to insert at (0-based, inserts before this line)
            insert_text: Text to insert

        Returns:
            Success or error message
        """
        full_path = self._validate_path(path)

        if not full_path.exists():
            return f"Error: File {path} does not exist."

        content = full_path.read_text(encoding="utf-8")
        lines = content.split("\n")

        if insert_line < 0 or insert_line > len(lines):
            return f"Error: Invalid insert_line: {insert_line}. File has {len(lines)} lines."

        lines.insert(insert_line, insert_text)
        full_path.write_text("\n".join(lines), encoding="utf-8")
        logger.debug(f"Memory file edited (insert): {path}")
        return f"The file {path} has been edited."

    def delete(self, path: str) -> str:
        """
        Delete file or directory.

        Args:
            path: Path to delete

        Returns:
            Success or error message
        """
        full_path = self._validate_path(path)

        if not full_path.exists():
            return f"Error: {path} does not exist."

        if full_path.is_dir():
            shutil.rmtree(full_path)
            logger.info(f"Memory directory deleted: {path}")
        else:
            full_path.unlink()
            logger.info(f"Memory file deleted: {path}")

        return f"Successfully deleted {path}"

    def rename(self, old_path: str, new_path: str) -> str:
        """
        Rename or move a file.

        Args:
            old_path: Current path
            new_path: New path

        Returns:
            Success or error message
        """
        old_full = self._validate_path(old_path)
        new_full = self._validate_path(new_path)

        if not old_full.exists():
            return f"Error: {old_path} does not exist."

        if new_full.exists():
            return f"Error: {new_path} already exists."

        # Create parent directories if needed
        new_full.parent.mkdir(parents=True, exist_ok=True)

        old_full.rename(new_full)
        logger.info(f"Memory file renamed: {old_path} -> {new_path}")
        return f"Successfully renamed {old_path} to {new_path}"

    def handle_tool_call(self, command: str, **kwargs) -> str:
        """
        Handle a memory tool call from the Anthropic SDK.

        Args:
            command: The memory tool command (view, create, str_replace, insert, delete, rename)
            **kwargs: Command-specific arguments

        Returns:
            Result string
        """
        handlers = {
            "view": lambda: self.view(kwargs.get("path", "/memories"), kwargs.get("view_range")),
            "create": lambda: self.create(kwargs["path"], kwargs["file_text"]),
            "str_replace": lambda: self.str_replace(kwargs["path"], kwargs["old_str"], kwargs["new_str"]),
            "insert": lambda: self.insert(kwargs["path"], kwargs["insert_line"], kwargs["insert_text"]),
            "delete": lambda: self.delete(kwargs["path"]),
            "rename": lambda: self.rename(kwargs["old_path"], kwargs["new_path"]),
        }

        handler = handlers.get(command)
        if not handler:
            return f"Error: Unknown memory command: {command}"

        try:
            return handler()
        except Exception as e:
            logger.error(f"Memory tool error ({command}): {e}")
            return f"Error executing {command}: {e}"

    def save_interrupt_state(
        self,
        status: str,
        current_subtask: str | None = None,
        user_message: str | None = None,
    ) -> str:
        """
        Save the current execution state when the user interrupts.

        This creates/updates a coding_progress.md file that the agent can
        read on resume to know where it left off.

        Args:
            status: Current status (e.g., "PAUSED", "STOPPED")
            current_subtask: ID of the subtask being worked on
            user_message: Optional user message that triggered the interrupt

        Returns:
            Success or error message
        """
        from datetime import datetime

        progress_file = "/memories/coding_progress.md"
        timestamp = datetime.now().isoformat()

        content = f"""# Coding Progress

## Status
{status}

## Last Updated
{timestamp}

## Current Subtask
{current_subtask or "None"}

"""
        if user_message:
            content += f"""## User Interrupt Message
{user_message}

"""

        content += """## Notes
This file is automatically updated when execution is interrupted.
On resume, read this file first to understand where you left off.
"""

        # Check if file exists
        progress_path = self._validate_path(progress_file)
        if progress_path.exists():
            # Update existing file
            return self.str_replace(
                progress_file,
                progress_path.read_text(encoding="utf-8"),
                content,
            ) if progress_path.read_text(encoding="utf-8") != content else "Progress already up to date"
        else:
            # Create new file
            return self.create(progress_file, content)

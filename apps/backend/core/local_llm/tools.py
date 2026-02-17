# Copyright (C) 2024-2026 Jerry Team
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Local Tool Execution Engine
============================

Implements the core coding tools that the Claude Agent SDK normally provides
via the Claude Code CLI. When running with a local LLM, we execute these
tools directly in Python.

Supported tools:
  - Bash: Execute shell commands with security validation
  - Read: Read file contents
  - Write: Write/create files
  - Edit: Find-and-replace in files
  - Glob: Find files by pattern
  - Grep: Search file contents with regex

Security:
  - Bash commands are validated against the same allowlist used by the SDK
  - File operations are restricted to the project directory
  - Path traversal is blocked
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Maximum output size from tool execution (100KB)
MAX_TOOL_OUTPUT = 102400

# Timeout for bash commands (seconds)
BASH_TIMEOUT = 120


# =============================================================================
# OpenAI Function Schemas (for native tool calling)
# =============================================================================

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "Bash",
            "description": "Execute a bash command. Use for running tests, git operations, installing packages, and other terminal commands.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to execute",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in milliseconds (default: 120000)",
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Read",
            "description": "Read the contents of a file. Returns the file content with line numbers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to read (relative to project root or absolute)",
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Line number to start reading from (1-indexed)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of lines to read",
                    },
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Write",
            "description": "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to write",
                    },
                    "content": {
                        "type": "string",
                        "description": "The content to write to the file",
                    },
                },
                "required": ["file_path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Edit",
            "description": "Perform exact string replacement in a file. The old_string must match exactly (including whitespace and indentation).",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to edit",
                    },
                    "old_string": {
                        "type": "string",
                        "description": "The exact text to find and replace",
                    },
                    "new_string": {
                        "type": "string",
                        "description": "The text to replace it with",
                    },
                    "replace_all": {
                        "type": "boolean",
                        "description": "Replace all occurrences (default: false, only first)",
                    },
                },
                "required": ["file_path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Glob",
            "description": "Find files matching a glob pattern (e.g., '**/*.py', 'src/**/*.ts'). Returns matching file paths.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern to match files",
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory to search in (default: project root)",
                    },
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Grep",
            "description": "Search file contents using regex. Returns matching lines with file paths and line numbers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for",
                    },
                    "path": {
                        "type": "string",
                        "description": "File or directory to search in (default: project root)",
                    },
                    "glob": {
                        "type": "string",
                        "description": "Glob pattern to filter files (e.g., '*.py', '*.ts')",
                    },
                    "output_mode": {
                        "type": "string",
                        "enum": ["content", "files_with_matches", "count"],
                        "description": "Output format (default: files_with_matches)",
                    },
                },
                "required": ["pattern"],
            },
        },
    },
]


def get_tool_schemas(allowed_tools: list[str] | None = None) -> list[dict]:
    """
    Get OpenAI-format tool schemas, filtered by allowed tools.

    Args:
        allowed_tools: List of tool names to include. None = all tools.

    Returns:
        List of tool schema dicts for the OpenAI API.
    """
    if allowed_tools is None:
        return TOOL_SCHEMAS

    return [
        schema
        for schema in TOOL_SCHEMAS
        if schema["function"]["name"] in allowed_tools
    ]


# =============================================================================
# Prompt-Based Tool Descriptions (for models without native tool calling)
# =============================================================================

TOOL_PROMPT_SECTION = """
## Available Tools

You have access to the following tools. To use a tool, respond with a <tool_call> XML block:

<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

You may make multiple tool calls in a single response. Each must be in its own <tool_call> block.

### Bash
Execute a shell command.
Parameters:
  - command (required): The bash command to execute
  - timeout (optional): Timeout in milliseconds (default: 120000)

### Read
Read file contents with line numbers.
Parameters:
  - file_path (required): Path to the file
  - offset (optional): Starting line number
  - limit (optional): Max lines to read

### Write
Write content to a file (creates or overwrites).
Parameters:
  - file_path (required): Path to the file
  - content (required): Content to write

### Edit
Find and replace text in a file.
Parameters:
  - file_path (required): Path to the file
  - old_string (required): Exact text to find
  - new_string (required): Replacement text
  - replace_all (optional): Replace all occurrences (default: false)

### Glob
Find files matching a pattern.
Parameters:
  - pattern (required): Glob pattern (e.g., "**/*.py")
  - path (optional): Directory to search in

### Grep
Search file contents with regex.
Parameters:
  - pattern (required): Regex pattern
  - path (optional): Directory to search in
  - glob (optional): File filter pattern (e.g., "*.py")
  - output_mode (optional): "content", "files_with_matches", or "count"
"""


def parse_prompt_tool_calls(response_text: str) -> list[dict[str, Any]]:
    """
    Parse tool calls from model response when using prompt-based tool calling.

    Extracts <tool_call>...</tool_call> blocks and parses the JSON inside.

    Args:
        response_text: The model's response text

    Returns:
        List of {"name": str, "arguments": dict} dicts
    """
    import json

    tool_calls = []
    # Match <tool_call>...</tool_call> blocks
    pattern = r"<tool_call>\s*(.*?)\s*</tool_call>"
    matches = re.findall(pattern, response_text, re.DOTALL)

    for match in matches:
        try:
            parsed = json.loads(match.strip())
            if isinstance(parsed, dict) and "name" in parsed:
                tool_calls.append({
                    "name": parsed["name"],
                    "arguments": parsed.get("arguments", {}),
                })
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse tool call JSON: {match[:200]}")

    return tool_calls


# =============================================================================
# Tool Execution
# =============================================================================


class ToolExecutor:
    """
    Executes tools within a sandboxed project directory.

    Security:
      - All file paths are resolved relative to project_dir
      - Path traversal (../) is blocked
      - Bash commands are validated via the security hook if provided
    """

    def __init__(
        self,
        project_dir: Path,
        bash_security_hook: Any | None = None,
    ) -> None:
        self.project_dir = project_dir.resolve()
        self.bash_security_hook = bash_security_hook

    def _resolve_path(self, file_path: str) -> Path:
        """
        Resolve a file path safely within the project directory.

        Handles:
          - Relative paths (resolved against project_dir)
          - Absolute paths (must be within project_dir)
          - Blocks path traversal (../)

        Raises:
            ValueError: If path escapes the project directory
        """
        path = Path(file_path)

        if path.is_absolute():
            resolved = path.resolve()
        else:
            resolved = (self.project_dir / path).resolve()

        # Security: ensure path is within project directory
        try:
            resolved.relative_to(self.project_dir)
        except ValueError:
            raise ValueError(
                f"Path '{file_path}' resolves to '{resolved}' which is outside "
                f"the project directory '{self.project_dir}'"
            )

        return resolved

    async def execute(self, tool_name: str, arguments: dict[str, Any]) -> tuple[str, bool]:
        """
        Execute a tool and return (result_text, is_error).

        Args:
            tool_name: Name of the tool to execute
            arguments: Tool arguments dict

        Returns:
            Tuple of (result_text, is_error)
        """
        try:
            if tool_name == "Bash":
                return await self._exec_bash(arguments)
            elif tool_name == "Read":
                return self._exec_read(arguments)
            elif tool_name == "Write":
                return self._exec_write(arguments)
            elif tool_name == "Edit":
                return self._exec_edit(arguments)
            elif tool_name == "Glob":
                return self._exec_glob(arguments)
            elif tool_name == "Grep":
                return self._exec_grep(arguments)
            else:
                return f"Unknown tool: {tool_name}", True
        except ValueError as e:
            return f"Security error: {e}", True
        except Exception as e:
            return f"Tool execution error: {type(e).__name__}: {e}", True

    async def _exec_bash(self, args: dict[str, Any]) -> tuple[str, bool]:
        """Execute a bash command with security validation."""
        command = args.get("command", "")
        if not command:
            return "Error: 'command' parameter is required", True

        timeout_ms = args.get("timeout", BASH_TIMEOUT * 1000)
        timeout_s = min(timeout_ms / 1000, 600)  # Cap at 10 minutes

        # Security hook validation
        if self.bash_security_hook:
            try:
                # The security hook expects a tool_input dict with "command" key
                hook_result = self.bash_security_hook({"command": command})
                # If the hook returns a result with "decision" == "block", reject
                if isinstance(hook_result, dict):
                    if hook_result.get("decision") == "block":
                        reason = hook_result.get("reason", "blocked by security policy")
                        return f"Command blocked: {reason}", True
            except Exception as e:
                logger.warning(f"Security hook error (allowing command): {e}")

        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.project_dir),
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_s
            )

            output_parts = []
            if stdout:
                output_parts.append(stdout.decode("utf-8", errors="replace"))
            if stderr:
                output_parts.append(stderr.decode("utf-8", errors="replace"))

            output = "\n".join(output_parts)

            # Truncate large outputs
            if len(output) > MAX_TOOL_OUTPUT:
                output = output[:MAX_TOOL_OUTPUT] + f"\n\n... [truncated - {len(output)} chars total]"

            is_error = proc.returncode != 0
            if is_error and not output:
                output = f"Command exited with code {proc.returncode}"

            return output, is_error

        except asyncio.TimeoutError:
            return f"Command timed out after {timeout_s}s", True

    def _exec_read(self, args: dict[str, Any]) -> tuple[str, bool]:
        """Read file contents with optional offset/limit."""
        file_path = args.get("file_path", "")
        if not file_path:
            return "Error: 'file_path' parameter is required", True

        resolved = self._resolve_path(file_path)

        if not resolved.exists():
            return f"Error: File not found: {file_path}", True
        if not resolved.is_file():
            return f"Error: Not a file: {file_path}", True

        try:
            content = resolved.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return f"Error: Cannot read binary file: {file_path}", True

        lines = content.splitlines(keepends=True)

        offset = args.get("offset", 1) - 1  # Convert to 0-indexed
        limit = args.get("limit", len(lines))

        if offset < 0:
            offset = 0

        selected = lines[offset : offset + limit]

        # Format with line numbers (matching Claude Code's `cat -n` style)
        output_lines = []
        for i, line in enumerate(selected, start=offset + 1):
            # Right-align line numbers, tab-separate from content
            output_lines.append(f"{i:>6}\t{line.rstrip()}")

        return "\n".join(output_lines), False

    def _exec_write(self, args: dict[str, Any]) -> tuple[str, bool]:
        """Write content to a file."""
        file_path = args.get("file_path", "")
        content = args.get("content", "")

        if not file_path:
            return "Error: 'file_path' parameter is required", True

        resolved = self._resolve_path(file_path)

        # Create parent directories
        resolved.parent.mkdir(parents=True, exist_ok=True)

        resolved.write_text(content, encoding="utf-8")
        return f"Successfully wrote {len(content)} bytes to {file_path}", False

    def _exec_edit(self, args: dict[str, Any]) -> tuple[str, bool]:
        """Find and replace text in a file."""
        file_path = args.get("file_path", "")
        old_string = args.get("old_string", "")
        new_string = args.get("new_string", "")
        replace_all = args.get("replace_all", False)

        if not file_path:
            return "Error: 'file_path' parameter is required", True
        if not old_string:
            return "Error: 'old_string' parameter is required", True

        resolved = self._resolve_path(file_path)

        if not resolved.exists():
            return f"Error: File not found: {file_path}", True

        content = resolved.read_text(encoding="utf-8")

        if old_string not in content:
            return f"Error: old_string not found in {file_path}", True

        if not replace_all:
            count = content.count(old_string)
            if count > 1:
                return (
                    f"Error: old_string appears {count} times in {file_path}. "
                    f"Provide more context to make it unique, or use replace_all=true."
                ), True
            new_content = content.replace(old_string, new_string, 1)
        else:
            new_content = content.replace(old_string, new_string)

        resolved.write_text(new_content, encoding="utf-8")

        replacements = "all occurrences" if replace_all else "1 occurrence"
        return f"Successfully replaced {replacements} in {file_path}", False

    def _exec_glob(self, args: dict[str, Any]) -> tuple[str, bool]:
        """Find files matching a glob pattern."""
        pattern = args.get("pattern", "")
        if not pattern:
            return "Error: 'pattern' parameter is required", True

        search_dir = self.project_dir
        if custom_path := args.get("path"):
            search_dir = self._resolve_path(custom_path)

        matches = sorted(search_dir.glob(pattern))

        # Filter to only files within project dir
        safe_matches = []
        for m in matches:
            try:
                m.resolve().relative_to(self.project_dir)
                safe_matches.append(m)
            except ValueError:
                continue

        if not safe_matches:
            return f"No files matching pattern: {pattern}", False

        # Return relative paths
        result_lines = []
        for m in safe_matches[:500]:  # Cap at 500 results
            try:
                rel = m.relative_to(self.project_dir)
                result_lines.append(str(rel))
            except ValueError:
                result_lines.append(str(m))

        if len(safe_matches) > 500:
            result_lines.append(f"\n... and {len(safe_matches) - 500} more files")

        return "\n".join(result_lines), False

    def _exec_grep(self, args: dict[str, Any]) -> tuple[str, bool]:
        """Search file contents with regex."""
        pattern = args.get("pattern", "")
        if not pattern:
            return "Error: 'pattern' parameter is required", True

        search_path = self.project_dir
        if custom_path := args.get("path"):
            search_path = self._resolve_path(custom_path)

        file_glob = args.get("glob", None)
        output_mode = args.get("output_mode", "files_with_matches")

        try:
            regex = re.compile(pattern)
        except re.error as e:
            return f"Invalid regex pattern: {e}", True

        results = []
        files_searched = 0
        max_results = 1000

        # Walk the directory tree
        if search_path.is_file():
            files_to_search = [search_path]
        else:
            files_to_search = []
            for root, _dirs, files in os.walk(search_path):
                # Skip common non-code directories
                root_path = Path(root)
                rel = root_path.relative_to(self.project_dir) if root_path != self.project_dir else Path(".")
                skip_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", ".tox", "dist", "build"}
                if any(part in skip_dirs for part in rel.parts):
                    continue

                for fname in files:
                    fpath = root_path / fname
                    if file_glob and not fnmatch.fnmatch(fname, file_glob):
                        continue
                    files_to_search.append(fpath)

        for fpath in files_to_search:
            if len(results) >= max_results:
                break

            try:
                content = fpath.read_text(encoding="utf-8", errors="ignore")
            except (OSError, UnicodeDecodeError):
                continue

            files_searched += 1
            file_matches = []

            for line_num, line in enumerate(content.splitlines(), 1):
                if regex.search(line):
                    file_matches.append((line_num, line))

            if file_matches:
                try:
                    rel_path = fpath.relative_to(self.project_dir)
                except ValueError:
                    rel_path = fpath

                if output_mode == "files_with_matches":
                    results.append(str(rel_path))
                elif output_mode == "count":
                    results.append(f"{rel_path}: {len(file_matches)}")
                else:  # content
                    for line_num, line in file_matches[:50]:  # Cap per file
                        results.append(f"{rel_path}:{line_num}: {line}")

        if not results:
            return f"No matches found for pattern: {pattern}", False

        output = "\n".join(results[:max_results])
        if len(results) > max_results:
            output += f"\n\n... and more matches (searched {files_searched} files)"

        return output, False

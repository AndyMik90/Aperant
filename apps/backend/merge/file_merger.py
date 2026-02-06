"""
File Merger
===========

File content manipulation and merging utilities.

This module handles the actual merging of file content:
- Applying single task changes
- Combining non-conflicting changes from multiple tasks
- Finding import locations
- Extracting content from specific code locations
"""

from __future__ import annotations

import re
from pathlib import Path

from .types import ChangeType, SemanticChange, TaskSnapshot


def detect_line_ending(content: str) -> str:
    """
    Detect line ending style in content using priority-based detection.

    Uses a priority order (CRLF > CR > LF) to detect the line ending style.
    CRLF is checked first because it contains LF, so presence of any CRLF
    indicates Windows-style endings. This approach is fast and works well
    for files that consistently use one style.

    Note: This returns the first detected style by priority, not the most
    frequent style. For files with mixed line endings, consider normalizing
    to a single style before processing.

    Args:
        content: File content to analyze

    Returns:
        The detected line ending string: "\\r\\n", "\\r", or "\\n"
    """
    # Check for CRLF first (Windows) - must check before LF since CRLF contains LF
    if "\r\n" in content:
        return "\r\n"
    # Check for CR (classic Mac, rare but possible)
    if "\r" in content:
        return "\r"
    # Default to LF (Unix/modern Mac)
    return "\n"


def apply_single_task_changes(
    baseline: str,
    snapshot: TaskSnapshot,
    file_path: str,
) -> str:
    """
    Apply changes from a single task to baseline content.

    Args:
        baseline: The baseline file content
        snapshot: Task snapshot with semantic changes
        file_path: Path to the file (for context on file type)

    Returns:
        Modified content with changes applied
    """
    # Detect line ending style before normalizing
    original_line_ending = detect_line_ending(baseline)

    # Normalize to LF for consistent matching with regex_analyzer output
    # The regex_analyzer normalizes content to LF when extracting content_before/after,
    # so we must also normalize baseline to ensure replace() matches correctly
    content = baseline.replace("\r\n", "\n").replace("\r", "\n")

    # Use LF for internal processing
    line_ending = "\n"

    for change in snapshot.semantic_changes:
        if change.content_before and change.content_after:
            # Modification - replace
            content = content.replace(change.content_before, change.content_after)
        elif change.content_after and not change.content_before:
            # Addition - need to determine where to add
            if change.change_type == ChangeType.ADD_IMPORT:
                # Add import at top
                # Content is already normalized to LF, so only check for \n
                has_trailing_newline = content.endswith("\n")
                lines = content.splitlines()
                import_end = find_import_end(lines, file_path)
                # Strip trailing newline from content_after to prevent double newlines
                # (content_after may include newline from diff generation)
                lines.insert(import_end, change.content_after.rstrip("\n\r"))
                content = line_ending.join(lines)
                if has_trailing_newline:
                    content += line_ending
            elif change.change_type == ChangeType.ADD_FUNCTION:
                # Add function at end (before exports)
                content += f"{line_ending}{line_ending}{change.content_after}"

    # Restore original line ending style if it was CRLF
    if original_line_ending == "\r\n":
        content = content.replace("\n", "\r\n")
    elif original_line_ending == "\r":
        content = content.replace("\n", "\r")

    return content


def combine_non_conflicting_changes(
    baseline: str,
    snapshots: list[TaskSnapshot],
    file_path: str,
) -> str:
    """
    Combine changes from multiple non-conflicting tasks.

    Args:
        baseline: The baseline file content
        snapshots: List of task snapshots with changes
        file_path: Path to the file

    Returns:
        Combined content with all changes applied
    """
    # Detect line ending style before normalizing
    original_line_ending = detect_line_ending(baseline)

    # Normalize to LF for consistent matching with regex_analyzer output
    # The regex_analyzer normalizes content to LF when extracting content_before/after,
    # so we must also normalize baseline to ensure replace() matches correctly
    content = baseline.replace("\r\n", "\n").replace("\r", "\n")

    # Use LF for internal processing
    line_ending = "\n"

    # Group changes by type for proper ordering
    imports: list[SemanticChange] = []
    functions: list[SemanticChange] = []
    modifications: list[SemanticChange] = []
    other: list[SemanticChange] = []

    for snapshot in snapshots:
        for change in snapshot.semantic_changes:
            if change.change_type == ChangeType.ADD_IMPORT:
                imports.append(change)
            elif change.change_type == ChangeType.ADD_FUNCTION:
                functions.append(change)
            elif "MODIFY" in change.change_type.value:
                modifications.append(change)
            else:
                other.append(change)

    # Apply in order: imports, then modifications, then functions, then other
    ext = Path(file_path).suffix.lower()

    # Add imports
    if imports:
        # Content is already normalized to LF, so only check for \n
        has_trailing_newline = content.endswith("\n")
        lines = content.splitlines()
        import_end = find_import_end(lines, file_path)
        for imp in imports:
            # Strip trailing newline from content_after to prevent double newlines
            import_content = (
                imp.content_after.rstrip("\n\r") if imp.content_after else ""
            )
            if import_content and import_content not in content:
                lines.insert(import_end, import_content)
                import_end += 1
        content = line_ending.join(lines)
        if has_trailing_newline:
            content += line_ending

    # Apply modifications
    for mod in modifications:
        if mod.content_before and mod.content_after:
            content = content.replace(mod.content_before, mod.content_after)

    # Add functions
    for func in functions:
        if func.content_after:
            content += f"{line_ending}{line_ending}{func.content_after}"

    # Apply other changes
    for change in other:
        if change.content_after and not change.content_before:
            content += f"{line_ending}{change.content_after}"
        elif change.content_before and change.content_after:
            content = content.replace(change.content_before, change.content_after)

    # Restore original line ending style if it was CRLF
    if original_line_ending == "\r\n":
        content = content.replace("\n", "\r\n")
    elif original_line_ending == "\r":
        content = content.replace("\n", "\r")

    return content


def find_import_end(lines: list[str], file_path: str) -> int:
    """
    Find where imports end in a file.

    Args:
        lines: File content split into lines
        file_path: Path to file (for determining language)

    Returns:
        Index where imports end (insert position for new imports)
    """
    ext = Path(file_path).suffix.lower()
    last_import = 0

    for i, line in enumerate(lines):
        stripped = line.strip()
        if ext == ".py":
            if stripped.startswith(("import ", "from ")):
                last_import = i + 1
        elif ext in {".js", ".jsx", ".ts", ".tsx"}:
            if stripped.startswith("import "):
                last_import = i + 1

    return last_import


def extract_location_content(content: str, location: str) -> str:
    """
    Extract content at a specific location (e.g., function:App).

    Args:
        content: Full file content
        location: Location string (e.g., "function:myFunction", "class:MyClass")

    Returns:
        Extracted content, or full content if location not found
    """
    # Parse location
    if ":" not in location:
        return content

    loc_type, loc_name = location.split(":", 1)

    if loc_type == "function":
        # Find function content using regex
        patterns = [
            rf"(function\s+{loc_name}\s*\([^)]*\)\s*\{{[\s\S]*?\n\}})",
            rf"((?:const|let|var)\s+{loc_name}\s*=[\s\S]*?\n\}};?)",
        ]
        for pattern in patterns:
            match = re.search(pattern, content)
            if match:
                return match.group(1)

    elif loc_type == "class":
        pattern = rf"(class\s+{loc_name}\s*(?:extends\s+\w+)?\s*\{{[\s\S]*?\n\}})"
        match = re.search(pattern, content)
        if match:
            return match.group(1)

    return content


def apply_ai_merge(
    content: str,
    location: str,
    merged_region: str,
) -> str:
    """
    Apply AI-merged content to the full file.

    Args:
        content: Full file content
        location: Location where merge was performed
        merged_region: The merged content from AI

    Returns:
        Updated file content with AI merge applied
    """
    if not merged_region:
        return content

    # Find and replace the location content
    original = extract_location_content(content, location)
    if original and original != content:
        return content.replace(original, merged_region)

    return content

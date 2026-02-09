#!/usr/bin/env python3
"""
Git Utilities
==============

Utility functions for git operations used in workspace management.
"""

import json
import subprocess
from pathlib import Path

from core.git_executable import get_git_executable, run_git

__all__ = [
    # Exported helpers
    "get_git_executable",
    "run_git",
    # Constants
    "MAX_FILE_LINES_FOR_AI",
    "MAX_PARALLEL_AI_MERGES",
    "LOCK_FILES",
    "BINARY_EXTENSIONS",
    "MERGE_LOCK_TIMEOUT",
    "MAX_SYNTAX_FIX_RETRIES",
    # Functions
    "detect_file_renames",
    "apply_path_mapping",
    "get_merge_base",
    "has_uncommitted_changes",
    "get_current_branch",
    "get_existing_build_worktree",
    "get_file_content_from_ref",
    "get_binary_file_content_from_ref",
    "get_changed_files_from_branch",
    "is_process_running",
    "is_binary_file",
    "is_lock_file",
    "validate_merged_syntax",
    "create_conflict_file_with_git",
    # Backward compat aliases
    "_is_process_running",
    "_is_binary_file",
    "_is_lock_file",
    "_validate_merged_syntax",
    "_get_file_content_from_ref",
    "_get_binary_file_content_from_ref",
    "_get_changed_files_from_branch",
    "_create_conflict_file_with_git",
]

# Constants for merge limits
MAX_FILE_LINES_FOR_AI = 5000  # Skip AI for files larger than this
MAX_PARALLEL_AI_MERGES = 5  # Limit concurrent AI merge operations

# Lock files that should NEVER go through AI merge
# These are auto-generated and should just take the worktree version
# then regenerate via package manager install
LOCK_FILES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "bun.lock",
    "Pipfile.lock",
    "poetry.lock",
    "uv.lock",
    "Cargo.lock",
    "Gemfile.lock",
    "composer.lock",
    "go.sum",
}

BINARY_EXTENSIONS = {
    # Images
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".webp",
    ".bmp",
    ".svg",
    ".tiff",
    ".tif",
    ".heic",
    ".heif",
    # Documents
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    # Archives
    ".zip",
    ".tar",
    ".gz",
    ".rar",
    ".7z",
    ".bz2",
    ".xz",
    ".zst",
    # Executables and libraries
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".msi",
    ".app",
    # WebAssembly
    ".wasm",
    # Audio
    ".mp3",
    ".wav",
    ".ogg",
    ".flac",
    ".aac",
    ".m4a",
    # Video
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".webm",
    ".wmv",
    ".flv",
    # Fonts
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    # Compiled code
    ".pyc",
    ".pyo",
    ".class",
    ".o",
    ".obj",
    # Data files
    ".dat",
    ".db",
    ".sqlite",
    ".sqlite3",
    # Other binary formats
    ".cur",
    ".ani",
    ".pbm",
    ".pgm",
    ".ppm",
}

# Merge lock timeout in seconds
MERGE_LOCK_TIMEOUT = 300  # 5 minutes

# Max retries for AI merge when syntax validation fails
# Gives AI a chance to fix its mistakes before falling back
MAX_SYNTAX_FIX_RETRIES = 2


def detect_file_renames(
    project_dir: Path,
    from_ref: str,
    to_ref: str,
) -> dict[str, str]:
    """
    Detect file renames between two git refs using git's rename detection.

    This analyzes the commit history between two refs to find all file
    renames/moves. Critical for merging changes from older branches that
    used a different directory structure.

    Uses git's -M flag for rename detection with high similarity threshold.

    Args:
        project_dir: Project directory
        from_ref: Starting ref (e.g., merge-base commit or old branch)
        to_ref: Target ref (e.g., current branch HEAD)

    Returns:
        Dict mapping old_path -> new_path for all renamed files
    """
    renames: dict[str, str] = {}

    try:
        # Use git log with rename detection to find all renames between refs
        # -M flag enables rename detection
        # --diff-filter=R shows only renames
        # --name-status shows status and file names
        result = run_git(
            [
                "log",
                "--name-status",
                "-M",
                "--diff-filter=R",
                "--format=",  # No commit info, just file changes
                f"{from_ref}..{to_ref}",
            ],
            cwd=project_dir,
        )

        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                if line.startswith("R"):
                    # Format: R100\told_path\tnew_path (tab-separated)
                    parts = line.split("\t")
                    if len(parts) >= 3:
                        old_path = parts[1]
                        new_path = parts[2]
                        renames[old_path] = new_path

    except Exception:
        pass  # Return empty dict on error

    return renames


def apply_path_mapping(file_path: str, mappings: dict[str, str]) -> str:
    """
    Apply file path mappings to get the new path for a file.

    Args:
        file_path: Original file path (from older branch)
        mappings: Dict of old_path -> new_path from detect_file_renames

    Returns:
        Mapped new path if found, otherwise original path
    """
    # Direct match
    if file_path in mappings:
        return mappings[file_path]

    # No mapping found
    return file_path


def get_merge_base(project_dir: Path, ref1: str, ref2: str) -> str | None:
    """
    Get the merge-base commit between two refs.

    Args:
        project_dir: Project directory
        ref1: First ref (branch/commit)
        ref2: Second ref (branch/commit)

    Returns:
        Merge-base commit hash, or None if not found
    """
    result = run_git(["merge-base", ref1, ref2], cwd=project_dir)
    if result.returncode == 0:
        return result.stdout.strip()
    return None


def has_uncommitted_changes(project_dir: Path) -> bool:
    """Check if user has unsaved work."""
    result = run_git(["status", "--porcelain"], cwd=project_dir)
    return bool(result.stdout.strip())


def get_current_branch(project_dir: Path) -> str:
    """Get the current branch name."""
    result = run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=project_dir)
    return result.stdout.strip()


def get_existing_build_worktree(project_dir: Path, spec_name: str) -> Path | None:
    """
    Check if there's an existing worktree for this specific spec.

    Args:
        project_dir: The main project directory
        spec_name: The spec folder name (e.g., "001-feature-name")

    Returns:
        Path to the worktree if it exists for this spec, None otherwise
    """
    # New path first
    new_path = project_dir / ".ac.jerry" / "worktrees" / "tasks" / spec_name
    if new_path.exists():
        return new_path

    # Legacy fallback
    legacy_path = project_dir / ".worktrees" / spec_name
    if legacy_path.exists():
        return legacy_path

    return None


def get_file_content_from_ref(
    project_dir: Path, ref: str, file_path: str
) -> str | None:
    """Get file content from a git ref (branch, commit, etc.)."""
    result = run_git(["show", f"{ref}:{file_path}"], cwd=project_dir)
    if result.returncode == 0:
        return result.stdout
    return None


def get_binary_file_content_from_ref(
    project_dir: Path, ref: str, file_path: str
) -> bytes | None:
    """Get binary file content from a git ref (branch, commit, etc.).

    Unlike get_file_content_from_ref, this returns raw bytes without
    text decoding, suitable for binary files like images, audio, etc.

    Note: Uses subprocess directly with get_git_executable() since
    run_git() always returns text output.
    """
    git = get_git_executable()
    result = subprocess.run(
        [git, "show", f"{ref}:{file_path}"],
        cwd=project_dir,
        capture_output=True,
        text=False,  # Return bytes, not text
    )
    if result.returncode == 0:
        return result.stdout
    return None


def get_changed_files_from_branch(
    project_dir: Path,
    base_branch: str,
    spec_branch: str,
    exclude_ac_jerry: bool = True,
) -> list[tuple[str, str]]:
    """
    Get list of changed files between branches.

    Args:
        project_dir: Project directory
        base_branch: Base branch name
        spec_branch: Spec branch name
        exclude_ac_jerry: If True, exclude .ac.jerry directory files (default True)

    Returns:
        List of (file_path, status) tuples
    """
    result = run_git(
        ["diff", "--name-status", f"{base_branch}...{spec_branch}"],
        cwd=project_dir,
    )

    files = []
    if result.returncode == 0:
        for line in result.stdout.strip().split("\n"):
            if line:
                parts = line.split("\t", 1)
                if len(parts) == 2:
                    file_path = parts[1]
                    # Exclude .ac.jerry directory files from merge
                    if exclude_ac_jerry and _is_ac_jerry_file(file_path):
                        continue
                    files.append((file_path, parts[0]))  # (file_path, status)
    return files


def _normalize_path(path: str) -> str:
    """Normalize path separators to forward slashes for cross-platform comparison."""
    return path.replace("\\", "/")


def _is_ac_jerry_file(file_path: str) -> bool:
    """Check if a file is in the .ac.jerry or ac-jerry/specs directory.

    Handles both forward slashes (Unix/Git output) and backslashes (Windows).
    """
    normalized = _normalize_path(file_path)
    excluded_patterns = [
        ".ac.jerry/",
        "ac-jerry/specs/",
    ]
    for pattern in excluded_patterns:
        if normalized.startswith(pattern):
            return True
    return False


def is_process_running(pid: int) -> bool:
    """Check if a process with the given PID is running."""
    import os

    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def is_binary_file(file_path: str) -> bool:
    """Check if a file is binary based on extension."""
    return Path(file_path).suffix.lower() in BINARY_EXTENSIONS


def is_lock_file(file_path: str) -> bool:
    """
    Check if a file is a package manager lock file.

    Lock files should never go through AI merge - they're auto-generated
    and should just take the worktree version, then regenerate via install.
    """
    return Path(file_path).name in LOCK_FILES


def validate_merged_syntax(
    file_path: str, content: str, project_dir: Path
) -> tuple[bool, str]:
    """
    Validate the syntax of merged code.

    Returns (is_valid, error_message).

    Uses esbuild for TypeScript/JavaScript validation as it:
    - Is much faster than tsc (no npm setup overhead)
    - Has accurate JSX/TSX parsing (matches Vite's behavior)
    - Works in isolation without tsconfig.json
    """
    import tempfile
    from pathlib import Path as P

    ext = P(file_path).suffix.lower()

    # TypeScript/JavaScript validation using esbuild
    if ext in {".ts", ".tsx", ".js", ".jsx"}:
        try:
            # Write to temp file in system temp dir (NOT project dir to avoid HMR triggers)
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=ext,
                delete=False,
                # Don't set dir= to avoid writing to project directory which triggers HMR
            ) as tmp:
                tmp.write(content)
                tmp_path = tmp.name

            try:
                # Find esbuild binary - try multiple locations
                esbuild_cmd = None

                # Try to find esbuild in node_modules (works with pnpm, npm, yarn)
                for search_dir in [project_dir, project_dir.parent]:
                    # pnpm stores it differently
                    pnpm_esbuild = search_dir / "node_modules" / ".pnpm"
                    if pnpm_esbuild.exists():
                        for esbuild_dir in pnpm_esbuild.glob(
                            "esbuild@*/node_modules/esbuild/bin/esbuild"
                        ):
                            if esbuild_dir.exists():
                                esbuild_cmd = str(esbuild_dir)
                                break
                    # Standard npm/yarn location
                    npm_esbuild = search_dir / "node_modules" / ".bin" / "esbuild"
                    if npm_esbuild.exists():
                        esbuild_cmd = str(npm_esbuild)
                        break
                    if esbuild_cmd:
                        break

                # Fall back to npx if not found
                if not esbuild_cmd:
                    esbuild_cmd = "npx"
                    args = ["npx", "esbuild", tmp_path, "--log-level=error"]
                else:
                    args = [esbuild_cmd, tmp_path, "--log-level=error"]

                # Use esbuild for fast, accurate syntax validation
                # esbuild infers loader from extension (.tsx, .ts, etc.)
                # --log-level=error only shows errors
                result = subprocess.run(
                    args,
                    cwd=project_dir,
                    capture_output=True,
                    text=True,
                    timeout=15,  # esbuild is fast, 15s is plenty
                )

                if result.returncode != 0:
                    # Filter out npm warnings and extract actual errors
                    error_output = result.stderr.strip()
                    error_lines = [
                        line
                        for line in error_output.split("\n")
                        if line
                        and not line.startswith("npm warn")
                        and not line.startswith("npm WARN")
                    ]
                    if error_lines:
                        # Extract just the error message, not full path
                        error_msg = "\n".join(error_lines[:3])
                        return False, f"Syntax error: {error_msg}"

                return True, ""

            finally:
                P(tmp_path).unlink(missing_ok=True)

        except subprocess.TimeoutExpired:
            return True, ""  # Timeout = assume ok
        except FileNotFoundError:
            return True, ""  # No esbuild = skip validation
        except Exception as e:
            return True, ""  # Other errors = skip validation

    # Python validation
    elif ext == ".py":
        try:
            compile(content, file_path, "exec")
            return True, ""
        except SyntaxError as e:
            return False, f"Python syntax error: {e.msg} at line {e.lineno}"

    # JSON validation
    elif ext == ".json":
        try:
            json.loads(content)
            return True, ""
        except json.JSONDecodeError as e:
            return False, f"JSON error: {e.msg} at line {e.lineno}"

    # Other file types - skip validation
    return True, ""


def create_conflict_file_with_git(
    main_content: str,
    worktree_content: str,
    base_content: str | None,
    project_dir: Path,
) -> tuple[str | None, bool]:
    """
    Use git merge-file to create a file with conflict markers.

    Returns (merged_content_or_none, had_conflicts).
    If auto-merged, returns (content, False).
    If conflicts, returns (content_with_markers, True).
    """
    import tempfile

    try:
        # Create temp files for three-way merge
        with tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".tmp"
        ) as main_f:
            main_f.write(main_content)
            main_path = main_f.name

        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".tmp") as wt_f:
            wt_f.write(worktree_content)
            wt_path = wt_f.name

        # Use empty base if not available
        if base_content:
            with tempfile.NamedTemporaryFile(
                mode="w", delete=False, suffix=".tmp"
            ) as base_f:
                base_f.write(base_content)
                base_path = base_f.name
        else:
            with tempfile.NamedTemporaryFile(
                mode="w", delete=False, suffix=".tmp"
            ) as base_f:
                base_f.write("")
                base_path = base_f.name

        try:
            # git merge-file <current> <base> <other>
            # Exit codes: 0 = clean merge, 1 = conflicts, >1 = error
            result = run_git(
                ["merge-file", "-p", main_path, base_path, wt_path],
                cwd=project_dir,
            )

            # Read the merged content
            merged_content = result.stdout

            # Check for conflicts
            had_conflicts = result.returncode == 1

            return merged_content, had_conflicts

        finally:
            # Cleanup temp files
            Path(main_path).unlink(missing_ok=True)
            Path(wt_path).unlink(missing_ok=True)
            Path(base_path).unlink(missing_ok=True)

    except Exception as e:
        return None, False


# Export the _is_process_running function for backward compatibility
_is_process_running = is_process_running
_is_binary_file = is_binary_file
_is_lock_file = is_lock_file
_validate_merged_syntax = validate_merged_syntax
_get_file_content_from_ref = get_file_content_from_ref
_get_binary_file_content_from_ref = get_binary_file_content_from_ref
_get_changed_files_from_branch = get_changed_files_from_branch
_create_conflict_file_with_git = create_conflict_file_with_git

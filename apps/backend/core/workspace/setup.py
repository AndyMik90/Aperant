#!/usr/bin/env python3
"""
Workspace Setup
===============

Functions for setting up and initializing workspaces.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from core.git_executable import run_git
from merge import FileTimelineTracker
from security.constants import ALLOWLIST_FILENAME, PROFILE_FILENAME
from ui import (
    Icons,
    MenuOption,
    box,
    icon,
    muted,
    print_status,
    select_menu,
    success,
)
from worktree import WorktreeManager

from .git_utils import has_uncommitted_changes
from .models import WorkspaceMode

# Import debug utilities
try:
    from debug import debug, debug_warning
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_warning(*args, **kwargs):
        pass


# Track if we've already tried to install the git hook this session
_git_hook_check_done = False

MODULE = "workspace.setup"


def choose_workspace(
    project_dir: Path,
    spec_name: str,
    force_isolated: bool = False,
    force_direct: bool = False,
    auto_continue: bool = False,
) -> WorkspaceMode:
    """
    Let user choose where auto-claude should work.

    Uses simple, non-technical language. Safe defaults.

    Args:
        project_dir: The project directory
        spec_name: Name of the spec being built
        force_isolated: Skip prompts and use isolated mode
        force_direct: Skip prompts and use direct mode
        auto_continue: Non-interactive mode (for UI integration) - skip all prompts

    Returns:
        WorkspaceMode indicating where to work
    """
    # Handle forced modes
    if force_isolated:
        return WorkspaceMode.ISOLATED
    if force_direct:
        return WorkspaceMode.DIRECT

    # Non-interactive mode: default to isolated for safety
    if auto_continue:
        print("Auto-continue: Using isolated workspace for safety.")
        return WorkspaceMode.ISOLATED

    # Check for unsaved work
    has_unsaved = has_uncommitted_changes(project_dir)

    if has_unsaved:
        # Unsaved work detected - use isolated mode for safety
        content = [
            success(f"{icon(Icons.SHIELD)} YOUR WORK IS PROTECTED"),
            "",
            "You have unsaved work in your project.",
            "",
            "To keep your work safe, the AI will build in a",
            "separate workspace. Your current files won't be",
            "touched until you're ready.",
        ]
        print()
        print(box(content, width=60, style="heavy"))
        print()

        try:
            input("Press Enter to continue...")
        except KeyboardInterrupt:
            print()
            print_status("Cancelled.", "info")
            sys.exit(0)

        return WorkspaceMode.ISOLATED

    # Clean working directory - give choice with enhanced menu
    options = [
        MenuOption(
            key="isolated",
            label="Separate workspace (Recommended)",
            icon=Icons.SHIELD,
            description="Your current files stay untouched. Easy to review and undo.",
        ),
        MenuOption(
            key="direct",
            label="Right here in your project",
            icon=Icons.LIGHTNING,
            description="Changes happen directly. Best if you're not working on anything else.",
        ),
    ]

    choice = select_menu(
        title="Where should the AI build your feature?",
        options=options,
        allow_quit=True,
    )

    if choice is None:
        print()
        print_status("Cancelled.", "info")
        sys.exit(0)

    if choice == "direct":
        print()
        print_status("Working directly in your project.", "info")
        return WorkspaceMode.DIRECT
    else:
        print()
        print_status("Using a separate workspace for safety.", "success")
        return WorkspaceMode.ISOLATED


def copy_env_files_to_worktree(project_dir: Path, worktree_path: Path) -> list[str]:
    """
    Copy .env files from project root to worktree (without overwriting).

    This ensures the worktree has access to environment variables needed
    to run the project (e.g., API keys, database URLs).

    Args:
        project_dir: The main project directory
        worktree_path: Path to the worktree

    Returns:
        List of copied file names
    """
    copied = []
    # Common .env file patterns - copy if they exist
    env_patterns = [
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
        ".env.test",
        ".env.test.local",
    ]

    for pattern in env_patterns:
        env_file = project_dir / pattern
        if env_file.is_file():
            target = worktree_path / pattern
            if not target.exists():
                shutil.copy2(env_file, target)
                copied.append(pattern)
                debug(MODULE, f"Copied {pattern} to worktree")

    return copied


def symlink_node_modules_to_worktree(
    project_dir: Path, worktree_path: Path
) -> list[str]:
    """
    Symlink node_modules directories from project root to worktree.

    This ensures the worktree has access to dependencies for TypeScript checks
    and other tooling without requiring a separate npm install.

    Works with npm workspace hoisting where dependencies are hoisted to root
    and workspace-specific dependencies remain in nested node_modules.

    Args:
        project_dir: The main project directory
        worktree_path: Path to the worktree

    Returns:
        List of symlinked paths (relative to worktree)
    """
    symlinked = []

    # Node modules locations to symlink for TypeScript and tooling support.
    # These are the standard locations for this monorepo structure.
    #
    # Design rationale:
    # - Hardcoded paths are intentional for simplicity and reliability
    # - Dynamic discovery (reading workspaces from package.json) would add complexity
    #   and potential failure points without significant benefit
    # - This monorepo uses npm workspaces with hoisting, so dependencies are primarily
    #   in root node_modules with workspace-specific deps in apps/frontend/node_modules
    #
    # To add new workspace locations:
    # 1. Add (source_rel, target_rel) tuple below
    # 2. Update the parallel TypeScript implementation in
    #    apps/frontend/src/main/ipc-handlers/terminal/worktree-handlers.ts
    # 3. Update the pre-commit hook check in .husky/pre-commit if needed
    node_modules_locations = [
        ("node_modules", "node_modules"),
        ("apps/frontend/node_modules", "apps/frontend/node_modules"),
    ]

    for source_rel, target_rel in node_modules_locations:
        source_path = project_dir / source_rel
        target_path = worktree_path / target_rel

        # Skip if source doesn't exist
        if not source_path.exists():
            debug(MODULE, f"Skipping {source_rel} - source does not exist")
            continue

        # Skip if target already exists (don't overwrite existing node_modules)
        if target_path.exists():
            debug(MODULE, f"Skipping {target_rel} - target already exists")
            continue

        # Also skip if target is a symlink (even if broken - exists() returns False for broken symlinks)
        if target_path.is_symlink():
            debug(
                MODULE,
                f"Skipping {target_rel} - symlink already exists (possibly broken)",
            )
            continue

        # Ensure parent directory exists
        target_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if sys.platform == "win32":
                # On Windows, use junctions instead of symlinks (no admin rights required)
                # Junctions require absolute paths
                result = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(target_path), str(source_path)],
                    capture_output=True,
                    text=True,
                )
                if result.returncode != 0:
                    raise OSError(result.stderr or "mklink /J failed")
            else:
                # On macOS/Linux, use relative symlinks for portability
                relative_source = os.path.relpath(source_path, target_path.parent)
                os.symlink(relative_source, target_path)
            symlinked.append(target_rel)
            debug(MODULE, f"Symlinked {target_rel} -> {source_path}")
        except OSError as e:
            # Symlink/junction creation can fail on some systems (e.g., FAT32 filesystem)
            # Log warning but don't fail - worktree is still usable, just without
            # TypeScript checking
            debug_warning(
                MODULE,
                f"Could not symlink {target_rel}: {e}. TypeScript checks may fail.",
            )
            # Warn user - pre-commit hooks may fail without dependencies
            print_status(
                f"Warning: Could not link {target_rel} - TypeScript checks may fail",
                "warning",
            )

    return symlinked


def symlink_claude_config_to_worktree(
    project_dir: Path, worktree_path: Path
) -> list[str]:
    """
    Symlink .claude/ directory from project root to worktree.

    This ensures the worktree has access to Claude Code configuration
    (settings, CLAUDE.md, MCP servers, etc.) so that terminals opened
    in the worktree behave identically to the project root.

    Args:
        project_dir: The main project directory
        worktree_path: Path to the worktree

    Returns:
        List of symlinked paths (relative to worktree)
    """
    symlinked = []

    source_path = project_dir / ".claude"
    target_path = worktree_path / ".claude"

    # Skip if source doesn't exist
    if not source_path.exists():
        debug(MODULE, "Skipping .claude/ - source does not exist")
        return symlinked

    # Skip if target already exists
    if target_path.exists():
        debug(MODULE, "Skipping .claude/ - target already exists")
        return symlinked

    # Also skip if target is a symlink (even if broken)
    if target_path.is_symlink():
        debug(MODULE, "Skipping .claude/ - symlink already exists (possibly broken)")
        return symlinked

    # Ensure parent directory exists
    target_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        if sys.platform == "win32":
            # On Windows, use junctions instead of symlinks (no admin rights required)
            result = subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(target_path), str(source_path)],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                raise OSError(result.stderr or "mklink /J failed")
        else:
            # On macOS/Linux, use relative symlinks for portability
            relative_source = os.path.relpath(source_path, target_path.parent)
            os.symlink(relative_source, target_path)
        symlinked.append(".claude")
        debug(MODULE, f"Symlinked .claude/ -> {source_path}")
    except OSError as e:
        debug_warning(
            MODULE,
            f"Could not symlink .claude/: {e}. Claude Code features may not work in worktree terminals.",
        )
        print_status(
            "Warning: Could not link .claude/ - Claude Code features may not work in terminals",
            "warning",
        )

    return symlinked


def copy_spec_to_worktree(
    source_spec_dir: Path,
    worktree_path: Path,
    spec_name: str,
) -> Path:
    """
    Copy spec files into the worktree so the AI can access them.

    The AI's filesystem is restricted to the worktree, so spec files
    must be copied inside for access.

    Args:
        source_spec_dir: Original spec directory (may be outside worktree)
        worktree_path: Path to the worktree
        spec_name: Name of the spec folder

    Returns:
        Path to the spec directory inside the worktree
    """
    # Determine target location inside worktree
    # Use .auto-claude/specs/{spec_name}/ as the standard location
    # Note: auto-claude/ is source code, .auto-claude/ is the installed instance
    target_spec_dir = worktree_path / ".auto-claude" / "specs" / spec_name

    # Create parent directories if needed
    target_spec_dir.parent.mkdir(parents=True, exist_ok=True)

    # Copy spec files (overwrite if exists to get latest)
    if target_spec_dir.exists():
        shutil.rmtree(target_spec_dir)

    shutil.copytree(source_spec_dir, target_spec_dir)

    return target_spec_dir


def setup_workspace(
    project_dir: Path,
    spec_name: str,
    mode: WorkspaceMode,
    source_spec_dir: Path | None = None,
    base_branch: str | None = None,
    use_local_branch: bool = False,
) -> tuple[Path, WorktreeManager | None, Path | None]:
    """
    Set up the workspace based on user's choice.

    Uses per-spec worktrees - each spec gets its own isolated worktree.

    Args:
        project_dir: The project directory
        spec_name: Name of the spec being built (e.g., "001-feature-name")
        mode: The workspace mode to use
        source_spec_dir: Optional source spec directory to copy to worktree
        base_branch: Base branch for worktree creation (default: current branch)
        use_local_branch: If True, use local branch directly instead of preferring origin/branch

    Returns:
        Tuple of (working_directory, worktree_manager or None, localized_spec_dir or None)

        When using isolated mode with source_spec_dir:
        - working_directory: Path to the worktree
        - worktree_manager: Manager for the worktree
        - localized_spec_dir: Path to spec files INSIDE the worktree (accessible to AI)
    """
    if mode == WorkspaceMode.DIRECT:
        # Work directly in project - spec_dir stays as-is
        return project_dir, None, source_spec_dir

    # Create isolated workspace using per-spec worktree
    print()
    print_status("Setting up separate workspace...", "progress")

    # Ensure timeline tracking hook is installed (once per session)
    ensure_timeline_hook_installed(project_dir)

    manager = WorktreeManager(
        project_dir, base_branch=base_branch, use_local_branch=use_local_branch
    )
    manager.setup()

    # Get or create worktree for THIS SPECIFIC SPEC
    worktree_info = manager.get_or_create_worktree(spec_name)

    # Copy .env files to worktree so user can run the project
    copied_env_files = copy_env_files_to_worktree(project_dir, worktree_info.path)
    if copied_env_files:
        print_status(
            f"Environment files copied: {', '.join(copied_env_files)}", "success"
        )

    # Symlink node_modules to worktree for TypeScript and tooling support
    # This allows pre-commit hooks to run typecheck without npm install in worktree
    symlinked_modules = symlink_node_modules_to_worktree(
        project_dir, worktree_info.path
    )
    if symlinked_modules:
        print_status(f"Dependencies linked: {', '.join(symlinked_modules)}", "success")

    # Symlink .claude/ config to worktree for Claude Code features (settings, commands, etc.)
    symlinked_claude = symlink_claude_config_to_worktree(
        project_dir, worktree_info.path
    )
    if symlinked_claude:
        print_status(f"Claude config linked: {', '.join(symlinked_claude)}", "success")

    # Copy security configuration files if they exist
    # Note: Unlike env files, security files always overwrite to ensure
    # the worktree uses the same security rules as the main project.
    # This prevents security bypasses through stale worktree configs.
    security_files = [
        ALLOWLIST_FILENAME,
        PROFILE_FILENAME,
    ]
    security_files_copied = []

    for filename in security_files:
        source_file = project_dir / filename
        if source_file.is_file():
            target_file = worktree_info.path / filename
            try:
                shutil.copy2(source_file, target_file)
                security_files_copied.append(filename)
            except (OSError, PermissionError) as e:
                debug_warning(MODULE, f"Failed to copy {filename}: {e}")
                print_status(
                    f"Warning: Could not copy {filename} to worktree", "warning"
                )

    if security_files_copied:
        print_status(
            f"Security config copied: {', '.join(security_files_copied)}", "success"
        )

        # Mark the security profile as inherited from parent project
        # This prevents hash-based re-analysis which would produce a broken profile
        # (worktrees lack node_modules and other build artifacts needed for detection)
        if PROFILE_FILENAME in security_files_copied:
            profile_path = worktree_info.path / PROFILE_FILENAME
            try:
                with open(profile_path, encoding="utf-8") as f:
                    profile_data = json.load(f)
                profile_data["inherited_from"] = str(project_dir.resolve())
                with open(profile_path, "w", encoding="utf-8") as f:
                    json.dump(profile_data, f, indent=2)
                debug(
                    MODULE, f"Marked security profile as inherited from {project_dir}"
                )
            except (OSError, json.JSONDecodeError) as e:
                debug_warning(MODULE, f"Failed to mark profile as inherited: {e}")

    # Ensure .auto-claude/ is in the worktree's .gitignore
    # This is critical because the worktree inherits .gitignore from the base branch,
    # which may not have .auto-claude/ if that change wasn't committed/pushed.
    # Without this, spec files would be committed to the worktree's branch.
    from init import ensure_gitignore_entry

    if ensure_gitignore_entry(worktree_info.path, ".auto-claude/"):
        debug(MODULE, "Added .auto-claude/ to worktree's .gitignore")

    # Copy spec files to worktree if provided
    localized_spec_dir = None
    if source_spec_dir and source_spec_dir.exists():
        localized_spec_dir = copy_spec_to_worktree(
            source_spec_dir, worktree_info.path, spec_name
        )
        print_status("Spec files copied to workspace", "success")

    print_status(f"Workspace ready: {worktree_info.path.name}", "success")
    print()

    # Initialize FileTimelineTracker for this task
    initialize_timeline_tracking(
        project_dir=project_dir,
        spec_name=spec_name,
        worktree_path=worktree_info.path,
        source_spec_dir=localized_spec_dir or source_spec_dir,
    )

    return worktree_info.path, manager, localized_spec_dir


def ensure_timeline_hook_installed(project_dir: Path) -> None:
    """
    Ensure the FileTimelineTracker git post-commit hook is installed.

    This enables tracking human commits to main branch for drift detection.
    Called once per session during first workspace setup.
    """
    global _git_hook_check_done
    if _git_hook_check_done:
        return

    _git_hook_check_done = True

    try:
        git_dir = project_dir / ".git"
        if not git_dir.exists():
            return  # Not a git repo

        # Handle worktrees (where .git is a file, not directory)
        if git_dir.is_file():
            content = git_dir.read_text(encoding="utf-8").strip()
            if content.startswith("gitdir:"):
                git_dir = Path(content.split(":", 1)[1].strip())
            else:
                return

        hook_path = git_dir / "hooks" / "post-commit"

        # Check if hook already installed
        if hook_path.exists():
            if "FileTimelineTracker" in hook_path.read_text(encoding="utf-8"):
                debug(MODULE, "FileTimelineTracker hook already installed")
                return

        # Auto-install the hook (silent, non-intrusive)
        from merge.install_hook import install_hook

        install_hook(project_dir)
        debug(MODULE, "Auto-installed FileTimelineTracker git hook")

    except Exception as e:
        # Non-fatal - hook installation is optional
        debug_warning(MODULE, f"Could not auto-install timeline hook: {e}")


def initialize_timeline_tracking(
    project_dir: Path,
    spec_name: str,
    worktree_path: Path,
    source_spec_dir: Path | None = None,
) -> None:
    """
    Initialize FileTimelineTracker for a new task.

    This registers the task's branch point and the files it intends to modify,
    enabling intent-aware merge conflict resolution later.
    """
    try:
        tracker = FileTimelineTracker(project_dir)

        # Get task intent from implementation plan
        task_intent = ""
        task_title = spec_name
        files_to_modify = []

        if source_spec_dir:
            plan_path = source_spec_dir / "implementation_plan.json"
            if plan_path.exists():
                with open(plan_path, encoding="utf-8") as f:
                    plan = json.load(f)
                task_title = plan.get("title", spec_name)
                task_intent = plan.get("description", "")

                # Extract files from phases/subtasks
                for phase in plan.get("phases", []):
                    for subtask in phase.get("subtasks", []):
                        files_to_modify.extend(subtask.get("files", []))

        # Get the current branch point commit
        # Note: run_git() already handles capture_output and encoding internally
        result = run_git(
            ["rev-parse", "HEAD"],
            cwd=project_dir,
        )
        branch_point = result.stdout.strip() if result.returncode == 0 else None

        if files_to_modify and branch_point:
            # Register the task with known files
            tracker.on_task_start(
                task_id=spec_name,
                files_to_modify=list(set(files_to_modify)),  # Dedupe
                branch_point_commit=branch_point,
                task_intent=task_intent,
                task_title=task_title,
            )
            debug(
                MODULE,
                f"Timeline tracking initialized for {spec_name}",
                files_tracked=len(files_to_modify),
                branch_point=branch_point[:8] if branch_point else None,
            )
        else:
            # Initialize retroactively from worktree if no plan
            tracker.initialize_from_worktree(
                task_id=spec_name,
                worktree_path=worktree_path,
                task_intent=task_intent,
                task_title=task_title,
            )

    except Exception as e:
        # Non-fatal - timeline tracking is supplementary
        debug_warning(MODULE, f"Could not initialize timeline tracking: {e}")
        print(muted(f"  Note: Timeline tracking could not be initialized: {e}"))


# Export private functions for backward compatibility
_ensure_timeline_hook_installed = ensure_timeline_hook_installed
_initialize_timeline_tracking = initialize_timeline_tracking

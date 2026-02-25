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
from core.platform import is_windows
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

from .dependency_strategy import get_dependency_configs
from .git_utils import has_uncommitted_changes
from .models import DependencyShareConfig, DependencyStrategy, WorkspaceMode

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

# Marker file written inside a recreated venv to indicate setup completed successfully.
# If the marker is absent, the venv is treated as incomplete and will be rebuilt.
VENV_SETUP_COMPLETE_MARKER = ".setup_complete"


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

    .. deprecated::
        Use :func:`setup_worktree_dependencies` instead, which handles all
        dependency types (node_modules, venvs, vendor dirs, etc.) via
        strategy-based dispatch.

    This is a thin backward-compatibility wrapper that delegates to
    ``setup_worktree_dependencies()`` with no project index (fallback mode).

    Args:
        project_dir: The main project directory
        worktree_path: Path to the worktree

    Returns:
        List of symlinked paths (relative to worktree)
    """
    results = setup_worktree_dependencies(
        project_dir, worktree_path, project_index=None
    )
    # Flatten all processed paths for backward-compatible return value
    return [path for paths in results.values() for path in paths]


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

    # Set up dependencies in worktree using strategy-based dispatch
    # Load project index if available for ecosystem-aware dependency handling
    project_index = None
    project_index_path = project_dir / ".auto-claude" / "project_index.json"
    if project_index_path.is_file():
        try:
            with open(project_index_path, encoding="utf-8") as f:
                project_index = json.load(f)
            debug(MODULE, "Loaded project_index.json for dependency setup")
        except (OSError, json.JSONDecodeError) as e:
            debug_warning(MODULE, f"Could not load project_index.json: {e}")

    dep_results = setup_worktree_dependencies(
        project_dir, worktree_info.path, project_index=project_index
    )
    for strategy_name, paths in dep_results.items():
        if paths:
            print_status(
                f"Dependencies ({strategy_name}): {', '.join(paths)}", "success"
            )

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


def setup_worktree_dependencies(
    project_dir: Path,
    worktree_path: Path,
    project_index: dict | None = None,
) -> dict[str, list[str]]:
    """
    Set up dependencies in a worktree using strategy-based dispatch.

    Reads dependency configs from the project index and applies the correct
    strategy for each: symlink, recreate, copy, or skip.

    All operations are non-blocking — failures produce warnings but do not
    prevent worktree creation.

    Args:
        project_dir: The main project directory
        worktree_path: Path to the worktree
        project_index: Parsed project_index.json dict, or None

    Returns:
        Dict mapping strategy names to lists of paths that were processed.
    """
    configs = get_dependency_configs(project_index, project_dir=project_dir)
    results: dict[str, list[str]] = {}

    for config in configs:
        strategy_name = config.strategy.value
        if strategy_name not in results:
            results[strategy_name] = []

        try:
            performed = False
            if config.strategy == DependencyStrategy.SYMLINK:
                performed = _apply_symlink_strategy(project_dir, worktree_path, config)
                # For venvs, verify the symlink is usable — fall back to recreate
                # Run health check whenever a venv symlink exists (not just on creation)
                if config.dep_type in ("venv", ".venv"):
                    venv_path = worktree_path / config.source_rel_path
                    # Check if venv exists (symlinked or otherwise)
                    if venv_path.exists() or venv_path.is_symlink():
                        if is_windows():
                            python_bin = str(venv_path / "Scripts" / "python.exe")
                        else:
                            python_bin = str(venv_path / "bin" / "python")
                        try:
                            subprocess.run(
                                [python_bin, "-c", "import sys; print(sys.prefix)"],
                                capture_output=True,
                                text=True,
                                timeout=10,
                                check=True,
                            )
                            debug(
                                MODULE,
                                f"Symlinked venv health check passed: {config.source_rel_path}",
                            )
                        except (subprocess.SubprocessError, OSError):
                            debug_warning(
                                MODULE,
                                f"Symlinked venv health check failed, falling back to recreate: {config.source_rel_path}",
                            )
                            # Remove the broken symlink and recreate
                            try:
                                if venv_path.is_symlink():
                                    venv_path.unlink()
                                elif venv_path.exists():
                                    shutil.rmtree(venv_path, ignore_errors=True)
                            except OSError:
                                pass  # Best-effort removal; recreate strategy handles existing paths
                            performed = _apply_recreate_strategy(
                                project_dir, worktree_path, config
                            )
                            # Update strategy name to reflect fallback
                            if performed:
                                strategy_name = "recreate"
                                # Ensure the key exists for the fallback strategy
                                results.setdefault(strategy_name, [])
            elif config.strategy == DependencyStrategy.RECREATE:
                performed = _apply_recreate_strategy(project_dir, worktree_path, config)
            elif config.strategy == DependencyStrategy.COPY:
                performed = _apply_copy_strategy(project_dir, worktree_path, config)
            elif config.strategy == DependencyStrategy.SKIP:
                _apply_skip_strategy(config)
                # Don't record skipped entries — only report actual work
                continue
            if performed:
                results[strategy_name].append(config.source_rel_path)
        except Exception as e:
            debug_warning(
                MODULE,
                f"Failed to apply {strategy_name} strategy for "
                f"{config.source_rel_path}: {e}",
            )

    return results


def _apply_symlink_strategy(
    project_dir: Path,
    worktree_path: Path,
    config: DependencyShareConfig,
) -> bool:
    """Create a symlink (or Windows junction) from worktree to project source.

    Returns True if a symlink was created, False if skipped.
    """
    source_path = project_dir / config.source_rel_path
    target_path = worktree_path / config.source_rel_path

    if not source_path.exists():
        debug(MODULE, f"Skipping symlink {config.source_rel_path} - source missing")
        return False

    if target_path.exists() or target_path.is_symlink():
        debug(MODULE, f"Skipping symlink {config.source_rel_path} - target exists")
        return False

    target_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        if is_windows():
            # Windows: use directory junctions (no admin rights required).
            # os.symlink creates a directory symlink that needs admin/DevMode,
            # so we use mklink /J which creates a junction without privileges.
            result = subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(target_path), str(source_path)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise OSError(result.stderr or "mklink /J failed")
        else:
            # macOS/Linux: relative symlinks for portability
            relative_source = os.path.relpath(source_path, target_path.parent)
            os.symlink(relative_source, target_path)
        debug(MODULE, f"Symlinked {config.source_rel_path} -> {source_path}")
        return True
    except subprocess.TimeoutExpired:
        debug_warning(
            MODULE,
            f"Symlink creation timed out for {config.source_rel_path}",
        )
        print_status(
            f"Warning: Symlink creation timed out for {config.source_rel_path}",
            "warning",
        )
        return False
    except OSError as e:
        debug_warning(
            MODULE,
            f"Could not symlink {config.source_rel_path}: {e}",
        )
        print_status(f"Warning: Could not link {config.source_rel_path}", "warning")
        return False


def _popen_with_cleanup(
    cmd: list[str],
    timeout: int,
    label: str,
) -> tuple[int, str, str]:
    """Run a command via Popen with proper process cleanup on timeout.

    On timeout: terminate → wait(10) → kill → wait(5) to ensure file locks
    are released before any cleanup (e.g. shutil.rmtree).

    Returns (returncode, stdout, stderr).
    Raises subprocess.TimeoutExpired if the command exceeds the given timeout (after cleanup is attempted).
    """
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
        return proc.returncode, stdout, stderr
    except subprocess.TimeoutExpired:
        debug_warning(MODULE, f"{label} timed out, terminating process")
        proc.terminate()
        try:
            proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            debug_warning(MODULE, f"{label} did not terminate, killing process")
            proc.kill()
            try:
                proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                # Final cleanup attempt if kill() also hangs
                debug_warning(MODULE, f"{label} could not be stopped even after kill()")
        raise
    finally:
        # Ensure pipes are closed and process is reaped to avoid zombie processes
        if proc.stdout:
            proc.stdout.close()
        if proc.stderr:
            proc.stderr.close()
        try:
            proc.wait(timeout=0.1)
        except subprocess.TimeoutExpired:
            pass  # Process still running, already logged warning above


def _apply_recreate_strategy(
    project_dir: Path,
    worktree_path: Path,
    config: DependencyShareConfig,
) -> bool:
    """Create a fresh virtual environment in the worktree and install deps.

    Returns True if the venv was successfully created, False if skipped or failed.
    """
    venv_path = worktree_path / config.source_rel_path
    marker_path = venv_path / VENV_SETUP_COMPLETE_MARKER

    # Check for broken symlinks that exists() would miss
    if venv_path.is_symlink() and not venv_path.exists():
        debug(MODULE, f"Removing broken symlink at {config.source_rel_path}")
        try:
            venv_path.unlink()
        except OSError:
            pass  # Best-effort removal
    elif venv_path.exists():
        if marker_path.exists():
            debug(
                MODULE,
                f"Skipping recreate {config.source_rel_path} - already complete (marker present)",
            )
            return False
        # Venv exists but marker is missing — incomplete, remove and rebuild
        debug(MODULE, f"Removing incomplete venv {config.source_rel_path} (no marker)")
        shutil.rmtree(venv_path, ignore_errors=True)

    # Detect Python executable from the source venv or fall back to sys.executable
    source_venv = project_dir / config.source_rel_path
    python_exec = sys.executable

    if source_venv.exists():
        # Try to use the same Python version as the source venv
        for candidate in ("bin/python", "Scripts/python.exe"):
            candidate_path = source_venv / candidate
            if candidate_path.exists():
                python_exec = str(candidate_path.resolve())
                break

    # Create the venv
    try:
        debug(MODULE, f"Creating venv at {venv_path}")
        returncode, _, stderr = _popen_with_cleanup(
            [python_exec, "-m", "venv", str(venv_path)],
            timeout=120,
            label=f"venv creation ({config.source_rel_path})",
        )
        if returncode != 0:
            debug_warning(MODULE, f"venv creation failed: {stderr}")
            print_status(
                f"Warning: Could not create venv at {config.source_rel_path}",
                "warning",
            )
            if venv_path.exists():
                shutil.rmtree(venv_path, ignore_errors=True)
            return False
    except subprocess.TimeoutExpired:
        print_status(
            f"Warning: venv creation timed out for {config.source_rel_path}",
            "warning",
        )
        if venv_path.exists():
            shutil.rmtree(venv_path, ignore_errors=True)
        return False
    except OSError as e:
        debug_warning(MODULE, f"venv creation failed: {e}")
        print_status(
            f"Warning: Could not create venv at {config.source_rel_path}",
            "warning",
        )
        if venv_path.exists():
            shutil.rmtree(venv_path, ignore_errors=True)
        return False

    # Install from requirements file if specified
    req_file = config.requirements_file
    if req_file:
        req_path = project_dir / req_file
        if req_path.is_file():
            # Determine pip executable inside the new venv
            if is_windows():
                pip_exec = str(venv_path / "Scripts" / "pip.exe")
            else:
                pip_exec = str(venv_path / "bin" / "pip")

            # Build install command based on file type
            req_basename = Path(req_file).name
            if req_basename == "pyproject.toml":
                # pyproject.toml: snapshot-install from the worktree copy.
                # Non-editable so the venv doesn't symlink back to the source.
                worktree_req = worktree_path / req_file
                install_dir = str(
                    worktree_req.parent if worktree_req.is_file() else req_path.parent
                )
                install_cmd = [pip_exec, "install", install_dir]
            elif req_basename == "Pipfile":
                # Pipfile: not directly installable via pip, skip
                debug(
                    MODULE,
                    f"Skipping Pipfile-based install for {req_file} "
                    "(use pipenv in the worktree)",
                )
                install_cmd = None
            else:
                # requirements.txt or similar: pip install -r
                install_cmd = [pip_exec, "install", "-r", str(req_path)]

            if install_cmd:
                try:
                    debug(MODULE, f"Installing deps from {req_file}")
                    returncode, _, stderr = _popen_with_cleanup(
                        install_cmd,
                        timeout=300,
                        label=f"pip install ({req_file})",
                    )
                    if returncode != 0:
                        debug_warning(
                            MODULE,
                            f"pip install failed (exit {returncode}): {stderr}",
                        )
                        print_status(
                            f"Warning: Dependency install failed for {req_file}",
                            "warning",
                        )
                        if venv_path.exists():
                            shutil.rmtree(venv_path, ignore_errors=True)
                        return False
                except subprocess.TimeoutExpired:
                    print_status(
                        f"Warning: Dependency install timed out for {req_file}",
                        "warning",
                    )
                    if venv_path.exists():
                        shutil.rmtree(venv_path, ignore_errors=True)
                    return False
                except OSError as e:
                    debug_warning(MODULE, f"pip install failed: {e}")
                    if venv_path.exists():
                        shutil.rmtree(venv_path, ignore_errors=True)
                    return False

    # Write completion marker so future runs know this venv is complete
    try:
        marker_path.touch()
    except OSError as e:
        debug_warning(
            MODULE, f"Failed to write completion marker at {marker_path}: {e}"
        )

    debug(MODULE, f"Recreated venv at {config.source_rel_path}")
    return True


def _apply_copy_strategy(
    project_dir: Path,
    worktree_path: Path,
    config: DependencyShareConfig,
) -> bool:
    """Deep-copy a dependency directory from project to worktree.

    Returns True if the copy was performed, False if skipped.
    """
    source_path = project_dir / config.source_rel_path
    target_path = worktree_path / config.source_rel_path

    if not source_path.exists():
        debug(MODULE, f"Skipping copy {config.source_rel_path} - source missing")
        return False

    if target_path.exists():
        debug(MODULE, f"Skipping copy {config.source_rel_path} - target exists")
        return False

    target_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        if source_path.is_file():
            shutil.copy2(source_path, target_path)
        else:
            shutil.copytree(source_path, target_path)
        debug(MODULE, f"Copied {config.source_rel_path} to worktree")
        return True
    except (OSError, shutil.Error) as e:
        debug_warning(MODULE, f"Could not copy {config.source_rel_path}: {e}")
        print_status(f"Warning: Could not copy {config.source_rel_path}", "warning")
        return False


def _apply_skip_strategy(config: DependencyShareConfig) -> None:
    """Skip — nothing to do for this dependency type."""
    debug(
        MODULE, f"Skipping {config.dep_type} ({config.source_rel_path}) - skip strategy"
    )


# Export private functions for backward compatibility
_ensure_timeline_hook_installed = ensure_timeline_hook_installed
_initialize_timeline_tracking = initialize_timeline_tracking

"""
Workspace Commands
==================

CLI commands for workspace management (merge, review, discard, list, cleanup)
"""

import json
import subprocess
import sys
from pathlib import Path

# Ensure parent directory is in path for imports (before other imports)
_PARENT_DIR = Path(__file__).parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from core.workspace.git_utils import (
    _is_auto_claude_file,
    apply_path_mapping,
    detect_file_renames,
    get_file_content_from_ref,
    get_merge_base,
    is_lock_file,
)
from core.worktree import PushAndCreatePRResult as CreatePRResult
from core.worktree import WorktreeManager
from debug import debug_warning
from ui import (
    Icons,
    icon,
)
from workspace import (
    cleanup_all_worktrees,
    discard_existing_build,
    get_existing_build_worktree,
    list_all_worktrees,
    merge_existing_build,
    review_existing_build,
)

from .utils import print_banner


def _detect_default_branch(project_dir: Path) -> str:
    """
    Detect the default branch for the repository.

    This matches the logic in WorktreeManager._detect_base_branch() to ensure
    we compare against the same branch that worktrees are created from.

    Priority order:
    1. DEFAULT_BRANCH environment variable
    2. Auto-detect main/master (if they exist)
    3. Fall back to "main" as final default

    Args:
        project_dir: Project root directory

    Returns:
        The detected default branch name
    """
    import os

    # 1. Check for DEFAULT_BRANCH env var
    env_branch = os.getenv("DEFAULT_BRANCH")
    if env_branch:
        # Verify the branch exists
        result = subprocess.run(
            ["git", "rev-parse", "--verify", env_branch],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return env_branch

    # 2. Auto-detect main/master
    for branch in ["main", "master"]:
        result = subprocess.run(
            ["git", "rev-parse", "--verify", branch],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return branch

    # 3. Fall back to "main" as final default
    return "main"


def _get_changed_files_from_git(
    worktree_path: Path, base_branch: str = "main"
) -> list[str]:
    """
    Get list of files changed by the task (not files changed on base branch).

    Uses merge-base to accurately identify only the files modified in the worktree,
    not files that changed on the base branch since the worktree was created.

    Args:
        worktree_path: Path to the worktree
        base_branch: Base branch to compare against (default: main)

    Returns:
        List of changed file paths (task changes only)
    """
    try:
        # First, get the merge-base (the point where the worktree branched)
        merge_base_result = subprocess.run(
            ["git", "merge-base", base_branch, "HEAD"],
            cwd=worktree_path,
            capture_output=True,
            text=True,
            check=True,
        )
        merge_base = merge_base_result.stdout.strip()

        # Use two-dot diff from merge-base to get only task's changes
        result = subprocess.run(
            ["git", "diff", "--name-only", f"{merge_base}..HEAD"],
            cwd=worktree_path,
            capture_output=True,
            text=True,
            check=True,
        )
        files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
        return files
    except subprocess.CalledProcessError as e:
        # Log the failure before trying fallback
        debug_warning(
            "workspace_commands",
            f"git diff with merge-base failed: returncode={e.returncode}, "
            f"stderr={e.stderr.strip() if e.stderr else 'N/A'}",
        )
        # Fallback: try direct two-arg diff (less accurate but works)
        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", base_branch, "HEAD"],
                cwd=worktree_path,
                capture_output=True,
                text=True,
                check=True,
            )
            files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
            return files
        except subprocess.CalledProcessError as e:
            # Log the failure before returning empty list
            debug_warning(
                "workspace_commands",
                f"git diff (fallback) failed: returncode={e.returncode}, "
                f"stderr={e.stderr.strip() if e.stderr else 'N/A'}",
            )
            return []


def _detect_worktree_base_branch(
    project_dir: Path,
    worktree_path: Path,
    spec_name: str,
) -> str | None:
    """
    Detect which branch a worktree was created from.

    Tries multiple strategies:
    1. Check worktree config file (.auto-claude/worktree-config.json)
    2. Find merge-base with known branches (develop, main, master)
    3. Return None if unable to detect

    Args:
        project_dir: Project root directory
        worktree_path: Path to the worktree
        spec_name: Name of the spec

    Returns:
        The detected base branch name, or None if unable to detect
    """
    # Strategy 1: Check for worktree config file
    config_path = worktree_path / ".auto-claude" / "worktree-config.json"
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            if config.get("base_branch"):
                debug(
                    MODULE,
                    f"Found base branch in worktree config: {config['base_branch']}",
                )
                return config["base_branch"]
        except Exception as e:
            debug_warning(MODULE, f"Failed to read worktree config: {e}")

    # Strategy 2: Find which branch has the closest merge-base
    # Check common branches: develop, main, master
    spec_branch = f"auto-claude/{spec_name}"
    candidate_branches = ["develop", "main", "master"]

    best_branch = None
    best_commits_behind = float("inf")

    for branch in candidate_branches:
        try:
            # Check if branch exists
            check = subprocess.run(
                ["git", "rev-parse", "--verify", branch],
                cwd=project_dir,
                capture_output=True,
                text=True,
            )
            if check.returncode != 0:
                continue

            # Get merge base
            merge_base_result = subprocess.run(
                ["git", "merge-base", branch, spec_branch],
                cwd=project_dir,
                capture_output=True,
                text=True,
            )
            if merge_base_result.returncode != 0:
                continue

            merge_base = merge_base_result.stdout.strip()

            # Count commits between merge-base and branch tip
            # The branch with fewer commits ahead is likely the one we branched from
            ahead_result = subprocess.run(
                ["git", "rev-list", "--count", f"{merge_base}..{branch}"],
                cwd=project_dir,
                capture_output=True,
                text=True,
            )
            if ahead_result.returncode == 0:
                commits_ahead = int(ahead_result.stdout.strip())
                debug(
                    MODULE,
                    f"Branch {branch} is {commits_ahead} commits ahead of merge-base",
                )
                if commits_ahead < best_commits_behind:
                    best_commits_behind = commits_ahead
                    best_branch = branch
        except Exception as e:
            debug_warning(MODULE, f"Error checking branch {branch}: {e}")
            continue

    if best_branch:
        debug(
            MODULE,
            f"Detected base branch from git history: {best_branch} (commits ahead: {best_commits_behind})",
        )
        return best_branch

    return None


def _detect_parallel_task_conflicts(
    project_dir: Path,
    current_task_id: str,
    current_task_files: list[str],
) -> list[dict]:
    """
    Detect potential conflicts between this task and other active tasks.

    Uses existing evolution data to check if any of this task's files
    have been modified by other active tasks. This is a lightweight check
    that doesn't require re-processing all files.

    Args:
        project_dir: Project root directory
        current_task_id: ID of the current task
        current_task_files: Files modified by this task (from git diff)

    Returns:
        List of conflict dictionaries with 'file' and 'tasks' keys
    """
    try:
        from merge import MergeOrchestrator

        # Initialize orchestrator just to access evolution data
        orchestrator = MergeOrchestrator(
            project_dir,
            enable_ai=False,
            dry_run=True,
        )

        # Get all active tasks from evolution data
        active_tasks = orchestrator.evolution_tracker.get_active_tasks()

        # Remove current task from active tasks
        other_active_tasks = active_tasks - {current_task_id}

        if not other_active_tasks:
            return []

        # Convert current task files to a set for fast lookup
        current_files_set = set(current_task_files)

        # Get files modified by other active tasks
        conflicts = []
        other_task_files = orchestrator.evolution_tracker.get_files_modified_by_tasks(
            list(other_active_tasks)
        )

        # Find intersection - files modified by both this task and other tasks
        for file_path, tasks in other_task_files.items():
            if file_path in current_files_set:
                # This file was modified by both current task and other task(s)
                all_tasks = [current_task_id] + tasks
                conflicts.append({"file": file_path, "tasks": all_tasks})

        return conflicts

    except Exception as e:
        # If anything fails, just return empty - parallel task detection is optional
        debug_warning(
            "workspace_commands",
            f"Parallel task conflict detection failed: {e}",
        )
        return []


# Import debug utilities
try:
    from debug import (
        debug,
        debug_detailed,
        debug_error,
        debug_section,
        debug_success,
        debug_verbose,
        is_debug_enabled,
    )
except ImportError:

    def debug(*args, **kwargs):
        """Fallback debug function when debug module is not available."""
        pass

    def debug_detailed(*args, **kwargs):
        """Fallback debug_detailed function when debug module is not available."""
        pass

    def debug_verbose(*args, **kwargs):
        """Fallback debug_verbose function when debug module is not available."""
        pass

    def debug_success(*args, **kwargs):
        """Fallback debug_success function when debug module is not available."""
        pass

    def debug_error(*args, **kwargs):
        """Fallback debug_error function when debug module is not available."""
        pass

    def debug_section(*args, **kwargs):
        """Fallback debug_section function when debug module is not available."""
        pass

    def is_debug_enabled():
        """Fallback is_debug_enabled function when debug module is not available."""
        return False


MODULE = "cli.workspace_commands"


def handle_merge_command(
    project_dir: Path,
    spec_name: str,
    no_commit: bool = False,
    base_branch: str | None = None,
) -> bool:
    """
    Handle the --merge command.

    Args:
        project_dir: Project root directory
        spec_name: Name of the spec
        no_commit: If True, stage changes but don't commit
        base_branch: Branch to compare against (default: auto-detect)

    Returns:
        True if merge succeeded, False otherwise
    """
    success = merge_existing_build(
        project_dir, spec_name, no_commit=no_commit, base_branch=base_branch
    )

    # Generate commit message suggestion if staging succeeded (no_commit mode)
    if success and no_commit:
        _generate_and_save_commit_message(project_dir, spec_name)

    return success


def _generate_and_save_commit_message(project_dir: Path, spec_name: str) -> None:
    """
    Generate a commit message suggestion and save it for the UI.

    Args:
        project_dir: Project root directory
        spec_name: Name of the spec
    """
    try:
        from commit_message import generate_commit_message_sync

        # Get diff summary for context
        diff_summary = ""
        files_changed = []
        try:
            result = subprocess.run(
                ["git", "diff", "--staged", "--stat"],
                cwd=project_dir,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                diff_summary = result.stdout.strip()

            # Get list of changed files
            result = subprocess.run(
                ["git", "diff", "--staged", "--name-only"],
                cwd=project_dir,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                files_changed = [
                    f.strip() for f in result.stdout.strip().split("\n") if f.strip()
                ]
        except Exception as e:
            debug_warning(MODULE, f"Could not get diff summary: {e}")

        # Generate commit message
        debug(MODULE, "Generating commit message suggestion...")
        commit_message = generate_commit_message_sync(
            project_dir=project_dir,
            spec_name=spec_name,
            diff_summary=diff_summary,
            files_changed=files_changed,
        )

        if commit_message:
            # Save to spec directory for UI to read
            spec_dir = project_dir / ".auto-claude" / "specs" / spec_name
            if not spec_dir.exists():
                spec_dir = project_dir / "auto-claude" / "specs" / spec_name

            if spec_dir.exists():
                commit_msg_file = spec_dir / "suggested_commit_message.txt"
                commit_msg_file.write_text(commit_message, encoding="utf-8")
                debug_success(
                    MODULE, f"Saved commit message suggestion to {commit_msg_file}"
                )
            else:
                debug_warning(MODULE, f"Spec directory not found: {spec_dir}")
        else:
            debug_warning(MODULE, "No commit message generated")

    except ImportError:
        debug_warning(MODULE, "commit_message module not available")
    except Exception as e:
        debug_warning(MODULE, f"Failed to generate commit message: {e}")


def handle_review_command(project_dir: Path, spec_name: str) -> None:
    """
    Handle the --review command.

    Args:
        project_dir: Project root directory
        spec_name: Name of the spec
    """
    review_existing_build(project_dir, spec_name)


def handle_discard_command(project_dir: Path, spec_name: str) -> None:
    """
    Handle the --discard command.

    Args:
        project_dir: Project root directory
        spec_name: Name of the spec
    """
    discard_existing_build(project_dir, spec_name)


def handle_list_worktrees_command(project_dir: Path) -> None:
    """
    Handle the --list-worktrees command.

    Args:
        project_dir: Project root directory
    """
    print_banner()
    print("\n" + "=" * 70)
    print("  SPEC WORKTREES")
    print("=" * 70)
    print()

    worktrees = list_all_worktrees(project_dir)
    if not worktrees:
        print("  No worktrees found.")
        print()
        print("  Worktrees are created when you run a build in isolated mode.")
    else:
        for wt in worktrees:
            print(f"  {icon(Icons.FOLDER)} {wt.spec_name}")
            print(f"       Branch: {wt.branch}")
            print(f"       Path: {wt.path}")
            print(f"       Commits: {wt.commit_count}, Files: {wt.files_changed}")
            print()

        print("-" * 70)
        print()
        print("  To merge:   python auto-claude/run.py --spec <name> --merge")
        print("  To review:  python auto-claude/run.py --spec <name> --review")
        print("  To discard: python auto-claude/run.py --spec <name> --discard")
        print()
        print(
            "  To cleanup all worktrees: python auto-claude/run.py --cleanup-worktrees"
        )
    print()


def handle_cleanup_worktrees_command(project_dir: Path) -> None:
    """
    Handle the --cleanup-worktrees command.

    Args:
        project_dir: Project root directory
    """
    print_banner()
    cleanup_all_worktrees(project_dir, confirm=True)


def _detect_conflict_scenario(
    project_dir: Path,
    conflicting_files: list[str],
    spec_branch: str,
    base_branch: str,
) -> dict:
    """
    Analyze conflicting files to determine the conflict scenario.

    This helps distinguish between:
    - 'already_merged': Task changes already identical in target branch
    - 'superseded': Target has newer version of same feature
    - 'diverged': Standard diverged branches (AI can resolve)
    - 'normal_conflict': Actual conflicting changes

    Returns dict with:
    - scenario: 'already_merged' | 'superseded' | 'diverged' | 'normal_conflict'
    - already_merged_files: files identical in task and target
    - details: additional context
    """
    if not conflicting_files:
        return {
            "scenario": "normal_conflict",
            "already_merged_files": [],
            "details": "No conflicting files to analyze",
        }

    already_merged_files = []
    superseded_files = []
    diverged_files = []

    try:
        # Get the merge-base commit
        merge_base_result = subprocess.run(
            ["git", "merge-base", base_branch, spec_branch],
            cwd=project_dir,
            capture_output=True,
            text=True,
        )
        if merge_base_result.returncode != 0:
            debug_warning(
                MODULE, "Could not find merge base for conflict scenario detection"
            )
            return {
                "scenario": "normal_conflict",
                "already_merged_files": [],
                "details": "Could not determine merge base",
            }

        merge_base = merge_base_result.stdout.strip()

        for file_path in conflicting_files:
            try:
                # Get content from spec branch (task's changes)
                spec_content_result = subprocess.run(
                    ["git", "show", f"{spec_branch}:{file_path}"],
                    cwd=project_dir,
                    capture_output=True,
                    text=True,
                )
                # Get content from base branch (target)
                base_content_result = subprocess.run(
                    ["git", "show", f"{base_branch}:{file_path}"],
                    cwd=project_dir,
                    capture_output=True,
                    text=True,
                )
                # Get content from merge-base (original state)
                merge_base_content_result = subprocess.run(
                    ["git", "show", f"{merge_base}:{file_path}"],
                    cwd=project_dir,
                    capture_output=True,
                    text=True,
                )

                # Check file existence in each ref
                spec_exists = spec_content_result.returncode == 0
                base_exists = base_content_result.returncode == 0
                merge_base_exists = merge_base_content_result.returncode == 0

                if spec_exists and base_exists:
                    spec_content = spec_content_result.stdout
                    base_content = base_content_result.stdout

                    # If contents are identical, the changes are already merged
                    if spec_content == base_content:
                        already_merged_files.append(file_path)
                        debug(
                            MODULE,
                            f"File {file_path}: already merged (identical content)",
                        )
                    elif merge_base_exists:
                        merge_base_content = merge_base_content_result.stdout
                        # If base has changed from merge_base but spec matches merge_base,
                        # the task's changes are superseded by newer changes
                        if spec_content == merge_base_content:
                            superseded_files.append(file_path)
                            debug(
                                MODULE,
                                f"File {file_path}: superseded (base has newer changes)",
                            )
                        else:
                            diverged_files.append(file_path)
                            debug(
                                MODULE,
                                f"File {file_path}: diverged (both branches modified)",
                            )
                    else:
                        diverged_files.append(file_path)
                else:
                    diverged_files.append(file_path)

            except Exception as e:
                debug_warning(
                    MODULE, f"Error analyzing file {file_path} for scenario: {e}"
                )
                diverged_files.append(file_path)

        # Determine overall scenario based on dominant pattern
        total_files = len(conflicting_files)

        if len(already_merged_files) == total_files:
            scenario = "already_merged"
            details = "All conflicting files have identical content in both branches"
        elif len(already_merged_files) > total_files / 2:
            scenario = "already_merged"
            details = f"{len(already_merged_files)} of {total_files} files already have the same content"
        elif len(superseded_files) == total_files:
            scenario = "superseded"
            details = "All task changes have been superseded by newer changes in the target branch"
        elif len(superseded_files) > total_files / 2:
            scenario = "superseded"
            details = (
                f"{len(superseded_files)} of {total_files} files have been superseded"
            )
        elif diverged_files:
            scenario = "diverged"
            details = f"{len(diverged_files)} files have diverged and need AI merge"
        else:
            scenario = "normal_conflict"
            details = "Standard merge conflicts detected"

        debug(
            MODULE,
            f"Conflict scenario: {scenario}",
            already_merged=len(already_merged_files),
            superseded=len(superseded_files),
            diverged=len(diverged_files),
        )

        return {
            "scenario": scenario,
            "already_merged_files": already_merged_files,
            "superseded_files": superseded_files,
            "diverged_files": diverged_files,
            "details": details,
        }

    except Exception as e:
        debug_error(MODULE, f"Error detecting conflict scenario: {e}")
        return {
            "scenario": "normal_conflict",
            "already_merged_files": [],
            "superseded_files": [],
            "diverged_files": [],
            "details": f"Error during analysis: {e}",
        }


def _check_git_merge_conflicts(
    project_dir: Path, spec_name: str, base_branch: str | None = None
) -> dict:
    """
    Check for git-level merge conflicts WITHOUT modifying the working directory.

    Uses git merge-tree and git diff to detect conflicts in-memory,
    which avoids triggering Vite HMR or other file watchers.

    Args:
        project_dir: Project root directory
        spec_name: Name of the spec
        base_branch: Branch the task was created from (default: auto-detect)

    Returns:
        Dictionary with git conflict information:
        - has_conflicts: bool
        - conflicting_files: list of file paths
        - needs_rebase: bool (if main has advanced)
        - base_branch: str
        - spec_branch: str
    """
    import subprocess

    debug(MODULE, "Checking for git-level merge conflicts (non-destructive)...")

    spec_branch = f"auto-claude/{spec_name}"
    result = {
        "has_conflicts": False,
        "conflicting_files": [],
        "needs_rebase": False,
        "base_branch": base_branch or "main",
        "spec_branch": spec_branch,
        "commits_behind": 0,
    }

    try:
        # Use provided base_branch, or detect from current HEAD
        if not base_branch:
            base_result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=project_dir,
                capture_output=True,
                text=True,
            )
            if base_result.returncode == 0:
                result["base_branch"] = base_result.stdout.strip()
        else:
            result["base_branch"] = base_branch
            debug(MODULE, f"Using provided base branch: {base_branch}")

        # Get the merge base commit
        merge_base_result = subprocess.run(
            ["git", "merge-base", result["base_branch"], spec_branch],
            cwd=project_dir,
            capture_output=True,
            text=True,
        )
        if merge_base_result.returncode != 0:
            debug_warning(MODULE, "Could not find merge base")
            return result

        merge_base = merge_base_result.stdout.strip()

        # Count commits main is ahead
        ahead_result = subprocess.run(
            ["git", "rev-list", "--count", f"{merge_base}..{result['base_branch']}"],
            cwd=project_dir,
            capture_output=True,
            text=True,
        )
        if ahead_result.returncode == 0:
            commits_behind = int(ahead_result.stdout.strip())
            result["commits_behind"] = commits_behind
            if commits_behind > 0:
                result["needs_rebase"] = True
                debug(
                    MODULE, f"Main is {commits_behind} commits ahead of worktree base"
                )

        # Use git merge-tree to check for conflicts WITHOUT touching working directory
        # This is a plumbing command that does a 3-way merge in memory
        # Note: --write-tree mode only accepts 2 branches (it auto-finds the merge base)
        merge_tree_result = subprocess.run(
            [
                "git",
                "merge-tree",
                "--write-tree",
                "--no-messages",
                result["base_branch"],  # Use branch names, not commit hashes
                spec_branch,
            ],
            cwd=project_dir,
            capture_output=True,
            text=True,
        )

        # merge-tree returns exit code 1 if there are conflicts
        if merge_tree_result.returncode != 0:
            result["has_conflicts"] = True
            debug(MODULE, "Git merge-tree detected conflicts")

            # Parse the output for conflicting files
            # merge-tree --write-tree outputs conflict info to stderr
            output = merge_tree_result.stdout + merge_tree_result.stderr
            for line in output.split("\n"):
                # Look for lines indicating conflicts
                if "CONFLICT" in line:
                    # Extract file path from conflict message
                    import re

                    match = re.search(
                        r"(?:Merge conflict in|CONFLICT.*?:)\s*(.+?)(?:\s*$|\s+\()",
                        line,
                    )
                    if match:
                        file_path = match.group(1).strip()
                        # Skip .auto-claude files - they should never be merged
                        if (
                            file_path
                            and file_path not in result["conflicting_files"]
                            and not _is_auto_claude_file(file_path)
                        ):
                            result["conflicting_files"].append(file_path)

            # Fallback: if we didn't parse conflicts, use diff to find files changed in both branches
            if not result["conflicting_files"]:
                # Files changed in main since merge-base
                main_files_result = subprocess.run(
                    ["git", "diff", "--name-only", merge_base, result["base_branch"]],
                    cwd=project_dir,
                    capture_output=True,
                    text=True,
                )
                main_files = (
                    set(main_files_result.stdout.strip().split("\n"))
                    if main_files_result.stdout.strip()
                    else set()
                )

                # Files changed in spec branch since merge-base
                spec_files_result = subprocess.run(
                    ["git", "diff", "--name-only", merge_base, spec_branch],
                    cwd=project_dir,
                    capture_output=True,
                    text=True,
                )
                spec_files = (
                    set(spec_files_result.stdout.strip().split("\n"))
                    if spec_files_result.stdout.strip()
                    else set()
                )

                # Files modified in both = potential conflicts
                # Filter out .auto-claude files - they should never be merged
                conflicting = main_files & spec_files
                result["conflicting_files"] = [
                    f for f in conflicting if not _is_auto_claude_file(f)
                ]
                debug(
                    MODULE, f"Found {len(conflicting)} files modified in both branches"
                )

            debug(MODULE, f"Conflicting files: {result['conflicting_files']}")
        else:
            debug_success(MODULE, "Git merge-tree: no conflicts detected")

    except Exception as e:
        debug_error(MODULE, f"Error checking git conflicts: {e}")
        import traceback

        debug_verbose(MODULE, "Exception traceback", traceback=traceback.format_exc())

    return result


def handle_merge_preview_command(
    project_dir: Path,
    spec_name: str,
    base_branch: str | None = None,
) -> dict:
    """
    Handle the --merge-preview command.

    Returns a JSON-serializable preview of merge conflicts without
    actually performing the merge. This is used by the UI to show
    potential conflicts before the user clicks "Stage Changes".

    This checks for TWO types of conflicts:
    1. Semantic conflicts: Multiple parallel tasks modifying the same code
    2. Git conflicts: Main branch has diverged from worktree branch

    Args:
        project_dir: Project root directory
        spec_name: Name of the spec
        base_branch: Branch the task was created from (for comparison). If None, auto-detect.

    Returns:
        Dictionary with preview information
    """
    debug_section(MODULE, "Merge Preview Command")
    debug(
        MODULE,
        "handle_merge_preview_command() called",
        project_dir=str(project_dir),
        spec_name=spec_name,
    )

    from workspace import get_existing_build_worktree

    worktree_path = get_existing_build_worktree(project_dir, spec_name)
    debug(
        MODULE,
        "Worktree lookup result",
        worktree_path=str(worktree_path) if worktree_path else None,
    )

    if not worktree_path:
        debug_error(MODULE, f"No existing build found for '{spec_name}'")
        return {
            "success": False,
            "error": f"No existing build found for '{spec_name}'",
            "files": [],
            "conflicts": [],
            "gitConflicts": None,
            "summary": {
                "totalFiles": 0,
                "conflictFiles": 0,
                "totalConflicts": 0,
                "autoMergeable": 0,
            },
        }

    try:
        # Determine the task's source branch (where the task was created from)
        # Priority:
        # 1. Provided base_branch (from task metadata)
        # 2. Detect from worktree's git history (find which branch it diverged from)
        # 3. Fall back to default branch detection (main/master)
        task_source_branch = base_branch
        if not task_source_branch:
            # Try to detect from worktree's git history
            task_source_branch = _detect_worktree_base_branch(
                project_dir, worktree_path, spec_name
            )
        if not task_source_branch:
            # Fall back to auto-detecting main/master
            task_source_branch = _detect_default_branch(project_dir)

        debug(
            MODULE,
            f"Using task source branch: {task_source_branch}",
            provided=base_branch is not None,
        )

        # Check for git-level conflicts (diverged branches) using the task's source branch
        git_conflicts = _check_git_merge_conflicts(
            project_dir, spec_name, base_branch=task_source_branch
        )

        # Get actual changed files from git diff (this is the authoritative count)
        all_changed_files = _get_changed_files_from_git(
            worktree_path, task_source_branch
        )
        debug(
            MODULE,
            f"Git diff against '{task_source_branch}' shows {len(all_changed_files)} changed files",
            changed_files=all_changed_files[:10],  # Log first 10
        )

        # OPTIMIZATION: Skip expensive refresh_from_git() and preview_merge() calls
        # For merge-preview, we only need to detect:
        # 1. Git conflicts (task vs base branch) - already calculated in _check_git_merge_conflicts()
        # 2. Parallel task conflicts (this task vs other active tasks)
        #
        # For parallel task detection, we just check if this task's files overlap
        # with files OTHER tasks have already recorded - no need to re-process all files.

        debug(MODULE, "Checking for parallel task conflicts (lightweight)...")

        # Check for parallel task conflicts by looking at existing evolution data
        parallel_conflicts = _detect_parallel_task_conflicts(
            project_dir, spec_name, all_changed_files
        )
        debug(
            MODULE,
            f"Parallel task conflicts detected: {len(parallel_conflicts)}",
            conflicts=parallel_conflicts[:5] if parallel_conflicts else [],
        )

        # Build conflict list - start with parallel task conflicts
        conflicts = []
        for pc in parallel_conflicts:
            conflicts.append(
                {
                    "file": pc["file"],
                    "location": "file-level",
                    "tasks": pc["tasks"],
                    "severity": "medium",
                    "canAutoMerge": False,
                    "strategy": None,
                    "reason": f"File modified by multiple active tasks: {', '.join(pc['tasks'])}",
                    "type": "parallel",
                }
            )

        # Add git conflicts to the list (excluding lock files which are handled automatically)
        lock_files_excluded = []
        for file_path in git_conflicts.get("conflicting_files", []):
            if is_lock_file(file_path):
                # Lock files are auto-generated and should not go through AI merge
                # They will be handled automatically by taking the worktree version
                lock_files_excluded.append(file_path)
                debug(MODULE, f"Excluding lock file from conflicts: {file_path}")
                continue

            conflicts.append(
                {
                    "file": file_path,
                    "location": "file-level",
                    "tasks": [spec_name, git_conflicts["base_branch"]],
                    "severity": "high",
                    "canAutoMerge": False,
                    "strategy": None,
                    "reason": f"File modified in both {git_conflicts['base_branch']} and worktree since branch point",
                    "type": "git",
                }
            )

        # Count only non-lock-file conflicts
        git_conflict_count = len(git_conflicts.get("conflicting_files", [])) - len(
            lock_files_excluded
        )
        # Calculate totals from our conflict lists (git conflicts + parallel conflicts)
        parallel_conflict_count = len(parallel_conflicts)
        total_conflicts = git_conflict_count + parallel_conflict_count
        conflict_files = git_conflict_count + parallel_conflict_count

        # Filter lock files from the git conflicts list for the response
        non_lock_conflicting_files = [
            f for f in git_conflicts.get("conflicting_files", []) if not is_lock_file(f)
        ]

        # Detect conflict scenario (already_merged, superseded, diverged, normal_conflict)
        # This helps the UI show appropriate messaging and actions
        conflict_scenario = None
        if non_lock_conflicting_files:
            conflict_scenario = _detect_conflict_scenario(
                project_dir,
                non_lock_conflicting_files,
                git_conflicts["spec_branch"],
                git_conflicts["base_branch"],
            )
            debug(
                MODULE,
                f"Conflict scenario detected: {conflict_scenario.get('scenario')}",
                already_merged_files=len(
                    conflict_scenario.get("already_merged_files", [])
                ),
            )

        # Use git diff file count as the authoritative totalFiles count
        # The semantic tracker may not track all files (e.g., test files, config files)
        # but we want to show the user all files that will be merged
        total_files_from_git = len(all_changed_files)

        # Detect files that need AI merge due to path mappings (file renames)
        # This happens when the target branch has renamed/moved files that the
        # worktree modified at their old locations
        path_mapped_ai_merges: list[dict] = []
        path_mappings: dict[str, str] = {}

        if git_conflicts["needs_rebase"] and git_conflicts["commits_behind"] > 0:
            # Get the merge-base between the branches
            spec_branch = git_conflicts["spec_branch"]
            base_branch = git_conflicts["base_branch"]
            merge_base = get_merge_base(project_dir, spec_branch, base_branch)

            if merge_base:
                # Detect file renames between merge-base and current base branch
                path_mappings = detect_file_renames(
                    project_dir, merge_base, base_branch
                )

                if path_mappings:
                    debug(
                        MODULE,
                        f"Detected {len(path_mappings)} file rename(s) between merge-base and target",
                        sample_mappings={
                            k: v for k, v in list(path_mappings.items())[:3]
                        },
                    )

                    # Check which changed files have path mappings and need AI merge
                    for file_path in all_changed_files:
                        mapped_path = apply_path_mapping(file_path, path_mappings)
                        if mapped_path != file_path:
                            # File was renamed - check if both versions exist
                            worktree_content = get_file_content_from_ref(
                                project_dir, spec_branch, file_path
                            )
                            target_content = get_file_content_from_ref(
                                project_dir, base_branch, mapped_path
                            )

                            if worktree_content and target_content:
                                path_mapped_ai_merges.append(
                                    {
                                        "oldPath": file_path,
                                        "newPath": mapped_path,
                                        "reason": "File was renamed/moved and modified in both branches",
                                    }
                                )
                                debug(
                                    MODULE,
                                    f"Path-mapped file needs AI merge: {file_path} -> {mapped_path}",
                                )

        result = {
            "success": True,
            # Use git diff files as the authoritative list of files to merge
            "files": all_changed_files,
            "conflicts": conflicts,
            "gitConflicts": {
                "hasConflicts": git_conflicts["has_conflicts"]
                and len(non_lock_conflicting_files) > 0,
                "conflictingFiles": non_lock_conflicting_files,
                "needsRebase": git_conflicts["needs_rebase"],
                "commitsBehind": git_conflicts["commits_behind"],
                "baseBranch": git_conflicts["base_branch"],
                "specBranch": git_conflicts["spec_branch"],
                # Path-mapped files that need AI merge due to renames
                "pathMappedAIMerges": path_mapped_ai_merges,
                "totalRenames": len(path_mappings),
                # Conflict scenario detection for better UX messaging
                "scenario": conflict_scenario.get("scenario")
                if conflict_scenario
                else None,
                "alreadyMergedFiles": conflict_scenario.get("already_merged_files", [])
                if conflict_scenario
                else [],
                "scenarioMessage": conflict_scenario.get("details")
                if conflict_scenario
                else None,
            },
            "summary": {
                # Use git diff count, not semantic tracker count
                "totalFiles": total_files_from_git,
                "conflictFiles": conflict_files,
                "totalConflicts": total_conflicts,
                "autoMergeable": 0,  # Not tracking auto-merge in lightweight mode
                "hasGitConflicts": git_conflicts["has_conflicts"]
                and len(non_lock_conflicting_files) > 0,
                # Include path-mapped AI merge count for UI display
                "pathMappedAIMergeCount": len(path_mapped_ai_merges),
            },
            # Include lock files info so UI can optionally show them
            "lockFilesExcluded": lock_files_excluded,
        }

        debug_success(
            MODULE,
            "Merge preview complete",
            total_files=result["summary"]["totalFiles"],
            total_files_source="git_diff",
            total_conflicts=result["summary"]["totalConflicts"],
            has_git_conflicts=git_conflicts["has_conflicts"],
            parallel_conflicts=parallel_conflict_count,
            path_mapped_ai_merges=len(path_mapped_ai_merges),
            total_renames=len(path_mappings),
        )

        return result

    except Exception as e:
        debug_error(MODULE, "Merge preview failed", error=str(e))
        import traceback

        debug_verbose(MODULE, "Exception traceback", traceback=traceback.format_exc())
        return {
            "success": False,
            "error": str(e),
            "files": [],
            "conflicts": [],
            "gitConflicts": None,
            "summary": {
                "totalFiles": 0,
                "conflictFiles": 0,
                "totalConflicts": 0,
                "autoMergeable": 0,
                "pathMappedAIMergeCount": 0,
            },
        }


def handle_create_pr_command(
    project_dir: Path,
    spec_name: str,
    target_branch: str | None = None,
    title: str | None = None,
    draft: bool = False,
) -> CreatePRResult:
    """
    Handle the --create-pr command: push branch and create a GitHub PR.

    Args:
        project_dir: Path to the project directory
        spec_name: Name of the spec (e.g., "001-feature-name")
        target_branch: Target branch for PR (defaults to base branch)
        title: Custom PR title (defaults to spec name)
        draft: Whether to create as draft PR

    Returns:
        CreatePRResult with success status, pr_url, and any errors
    """
    from core.worktree import WorktreeManager

    print_banner()
    print("\n" + "=" * 70)
    print("  CREATE PULL REQUEST")
    print("=" * 70)

    # Check if worktree exists
    worktree_path = get_existing_build_worktree(project_dir, spec_name)
    if not worktree_path:
        print(f"\n{icon(Icons.ERROR)} No build found for spec: {spec_name}")
        print("\nA completed build worktree is required to create a PR.")
        print("Run your build first, then use --create-pr.")
        error_result: CreatePRResult = {
            "success": False,
            "error": "No build found for this spec",
        }
        return error_result

    # Create worktree manager
    manager = WorktreeManager(project_dir, base_branch=target_branch)

    print(f"\n{icon(Icons.BRANCH)} Pushing branch and creating PR...")
    print(f"   Spec: {spec_name}")
    print(f"   Target: {target_branch or manager.base_branch}")
    if title:
        print(f"   Title: {title}")
    if draft:
        print("   Mode: Draft PR")

    # Push and create PR with exception handling for clean JSON output
    try:
        raw_result = manager.push_and_create_pr(
            spec_name=spec_name,
            target_branch=target_branch,
            title=title,
            draft=draft,
        )
    except Exception as e:
        debug_error(MODULE, f"Exception during PR creation: {e}")
        error_result: CreatePRResult = {
            "success": False,
            "error": str(e),
            "message": "Failed to create PR",
        }
        print(f"\n{icon(Icons.ERROR)} Failed to create PR: {e}")
        print(json.dumps(error_result))
        return error_result

    # Convert PushAndCreatePRResult to CreatePRResult
    result: CreatePRResult = {
        "success": raw_result.get("success", False),
        "pr_url": raw_result.get("pr_url"),
        "already_exists": raw_result.get("already_exists", False),
        "error": raw_result.get("error"),
        "message": raw_result.get("message"),
        "pushed": raw_result.get("pushed", False),
        "remote": raw_result.get("remote", ""),
        "branch": raw_result.get("branch", ""),
    }

    if result.get("success"):
        pr_url = result.get("pr_url")
        already_exists = result.get("already_exists", False)

        if already_exists:
            print(f"\n{icon(Icons.SUCCESS)} PR already exists!")
        else:
            print(f"\n{icon(Icons.SUCCESS)} PR created successfully!")

        if pr_url:
            print(f"\n{icon(Icons.LINK)} {pr_url}")
        else:
            print(f"\n{icon(Icons.INFO)} Check GitHub for the PR URL")

        print("\nNext steps:")
        print("  1. Review the PR on GitHub")
        print("  2. Request reviews from your team")
        print("  3. Merge when approved")

        # Output JSON for frontend parsing
        print(json.dumps(result))
        return result
    else:
        error = result.get("error", "Unknown error")
        print(f"\n{icon(Icons.ERROR)} Failed to create PR: {error}")
        # Output JSON for frontend parsing
        print(json.dumps(result))
        return result


def cleanup_old_worktrees_command(
    project_dir: Path, days: int = 30, dry_run: bool = False
) -> dict:
    """
    Clean up old worktrees that haven't been modified in the specified number of days.

    Args:
        project_dir: Project root directory
        days: Number of days threshold (default: 30)
        dry_run: If True, only show what would be removed (default: False)

    Returns:
        Dictionary with cleanup results
    """
    try:
        manager = WorktreeManager(project_dir)

        removed, failed = manager.cleanup_old_worktrees(
            days_threshold=days, dry_run=dry_run
        )

        return {
            "success": True,
            "removed": removed,
            "failed": failed,
            "dry_run": dry_run,
            "days_threshold": days,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "removed": [],
            "failed": [],
        }


def worktree_summary_command(project_dir: Path) -> dict:
    """
    Get a summary of all worktrees with age information.

    Args:
        project_dir: Project root directory

    Returns:
        Dictionary with worktree summary data
    """
    try:
        manager = WorktreeManager(project_dir)

        # Print to console for CLI usage
        manager.print_worktree_summary()

        # Also return data for programmatic access
        worktrees = manager.list_all_worktrees()
        warning = manager.get_worktree_count_warning()

        # Categorize by age
        recent = []
        week_old = []
        month_old = []
        very_old = []
        unknown_age = []

        for info in worktrees:
            data = {
                "spec_name": info.spec_name,
                "days_since_last_commit": info.days_since_last_commit,
                "commit_count": info.commit_count,
            }

            if info.days_since_last_commit is None:
                unknown_age.append(data)
            elif info.days_since_last_commit < 7:
                recent.append(data)
            elif info.days_since_last_commit < 30:
                week_old.append(data)
            elif info.days_since_last_commit < 90:
                month_old.append(data)
            else:
                very_old.append(data)

        return {
            "success": True,
            "total_worktrees": len(worktrees),
            "categories": {
                "recent": recent,
                "week_old": week_old,
                "month_old": month_old,
                "very_old": very_old,
                "unknown_age": unknown_age,
            },
            "warning": warning,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "total_worktrees": 0,
            "categories": {},
            "warning": None,
        }

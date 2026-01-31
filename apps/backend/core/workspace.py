#!/usr/bin/env python3
"""
Workspace Management - Per-Spec Architecture
=============================================

Handles workspace isolation through Git worktrees, where each spec
gets its own isolated worktree in .auto-claude/worktrees/tasks/{spec-name}/.

This module has been refactored for better maintainability:
- Models and enums: workspace/models.py
- Git utilities: workspace/git_utils.py
- Setup functions: workspace/setup.py
- Display functions: workspace/display.py
- Finalization: workspace/finalization.py
- Complex merge operations: remain here (workspace.py)

Public API is exported via workspace/__init__.py for backward compatibility.
"""

from pathlib import Path

# Import git command helper for centralized logging and allowlist compliance
from core.git_executable import run_git
from ui import (
    Icons,
    bold,
    box,
    error,
    highlight,
    icon,
    muted,
    print_status,
    success,
    warning,
)
from worktree import WorktreeManager

# Import debug utilities
try:
    from debug import (
        debug,
        debug_detailed,
        debug_error,
        debug_success,
        debug_verbose,
        debug_warning,
        is_debug_enabled,
    )
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_detailed(*args, **kwargs):
        pass

    def debug_verbose(*args, **kwargs):
        pass

    def debug_success(*args, **kwargs):
        pass

    def debug_error(*args, **kwargs):
        pass

    def debug_warning(*args, **kwargs):
        pass

    def is_debug_enabled():
        return False


# Import merge system
from core.workspace.display import (
    print_conflict_info as _print_conflict_info,
)
from core.workspace.display import (
    print_merge_success as _print_merge_success,
)
from core.workspace.display import (
    show_build_summary,
)
from core.workspace.git_utils import (
    MAX_PARALLEL_AI_MERGES,
    _is_auto_claude_file,
    get_existing_build_worktree,
)
from core.workspace.git_utils import (
    apply_path_mapping as _apply_path_mapping,
)
from core.workspace.git_utils import (
    detect_file_renames as _detect_file_renames,
)
from core.workspace.git_utils import (
    get_binary_file_content_from_ref as _get_binary_file_content_from_ref,
)
from core.workspace.git_utils import (
    get_changed_files_from_branch as _get_changed_files_from_branch,
)
from core.workspace.git_utils import (
    get_file_content_from_ref as _get_file_content_from_ref,
)
from core.workspace.git_utils import (
    is_binary_file as _is_binary_file,
)
from core.workspace.git_utils import (
    is_lock_file as _is_lock_file,
)
from core.workspace.git_utils import (
    validate_merged_syntax as _validate_merged_syntax,
)

# Import from refactored modules in core/workspace/
from core.workspace.models import (
    MergeLock,
    MergeLockError,
    ParallelMergeResult,
    ParallelMergeTask,
)
from merge import (
    FileTimelineTracker,
    MergeOrchestrator,
)
from merge.progress import MergeProgressCallback, MergeProgressStage, emit_progress

MODULE = "workspace"

# The following functions are now imported from refactored modules above.
# They are kept here only to avoid breaking the existing code that still needs
# the complex merge operations below.

# Remaining complex merge operations that reference each other:
# - merge_existing_build
# - _try_smart_merge
# - _try_smart_merge_inner
# - _check_git_conflicts
# - _resolve_git_conflicts_with_ai
# - _create_async_claude_client
# - _async_ai_call
# - _merge_file_with_ai_async
# - _run_parallel_merges
# - _record_merge_completion
# - _get_task_intent
# - _get_recent_merges_context
# - _merge_file_with_ai
# - _heuristic_merge


def _create_merge_progress_callback() -> MergeProgressCallback | None:
    """
    Create a progress callback for merge operations when running as a subprocess.

    Returns emit_progress (writing JSON to stdout) only when stdout is piped
    (i.e., running as a subprocess from the Electron frontend). Returns None
    when running interactively in a terminal to avoid polluting CLI output.

    This function must be called at runtime (not at import time) to ensure
    sys.stdout state is accurate.
    """
    import sys

    # Only emit progress JSON when stdout is piped (subprocess mode).
    # In interactive CLI mode (TTY), progress JSON would clutter the output.
    if not sys.stdout.isatty():
        return emit_progress
    return None


def merge_existing_build(
    project_dir: Path,
    spec_name: str,
    no_commit: bool = False,
    use_smart_merge: bool = True,
    base_branch: str | None = None,
) -> bool:
    """
    Merge an existing build into the project using intent-aware merge.

    Called when user runs: python auto-claude/run.py --spec X --merge

    This uses the MergeOrchestrator to:
    1. Analyze semantic changes from the task
    2. Detect potential conflicts with main branch
    3. Auto-merge compatible changes
    4. Use AI for ambiguous conflicts (if enabled)
    5. Fall back to git merge for remaining changes

    Args:
        project_dir: The project directory
        spec_name: Name of the spec
        no_commit: If True, merge changes but don't commit (stage only for review in IDE)
        use_smart_merge: If True, use intent-aware merge (default True)
        base_branch: The branch the task was created from (for comparison). If None, auto-detect.

    Returns:
        True if merge succeeded
    """
    worktree_path = get_existing_build_worktree(project_dir, spec_name)

    if not worktree_path:
        print()
        print_status(f"No existing build found for '{spec_name}'.", "warning")
        print()
        print("To start a new build:")
        print(highlight(f"  python auto-claude/run.py --spec {spec_name}"))
        return False

    # Detect current branch - this is where user wants changes merged
    # Normal workflow: user is on their feature branch (e.g., version/2.5.5)
    # and wants to merge the spec changes into it, then PR to main
    current_branch_result = run_git(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        cwd=project_dir,
    )
    current_branch = (
        current_branch_result.stdout.strip()
        if current_branch_result.returncode == 0
        else None
    )

    spec_branch = f"auto-claude/{spec_name}"

    # Don't merge a branch into itself
    if current_branch == spec_branch:
        print()
        print_status(
            "You're on the spec branch. Switch to your target branch first.", "warning"
        )
        print()
        print("Example:")
        print(highlight("  git checkout main  # or your feature branch"))
        print(highlight(f"  python auto-claude/run.py --spec {spec_name} --merge"))
        return False

    if no_commit:
        content = [
            bold(f"{icon(Icons.SUCCESS)} STAGING BUILD FOR REVIEW"),
            "",
            muted("Changes will be staged but NOT committed."),
            muted("Review in your IDE, then commit when ready."),
        ]
    else:
        content = [
            bold(f"{icon(Icons.SUCCESS)} ADDING BUILD TO YOUR PROJECT"),
        ]
    print()
    print(box(content, width=60, style="heavy"))

    # Use current branch as merge target (not auto-detected main/master)
    manager = WorktreeManager(project_dir, base_branch=current_branch)
    show_build_summary(manager, spec_name)
    print()

    # Try smart merge first if enabled
    if use_smart_merge:
        smart_result = _try_smart_merge(
            project_dir,
            spec_name,
            worktree_path,
            manager,
            no_commit=no_commit,
            task_source_branch=base_branch,
        )

        if smart_result is not None:
            # Smart merge handled it (success or identified conflicts)
            if smart_result.get("success"):
                # Check if smart merge actually DID work (resolved conflicts via AI)
                # NOTE: "files_merged" in stats is misleading - it's "files TO merge" not "files WERE merged"
                # The smart merge preview returns this count but doesn't actually perform the merge
                # in the no-conflict path. We only skip git merge if AI actually did work.
                stats = smart_result.get("stats", {})
                had_conflicts = stats.get("conflicts_resolved", 0) > 0
                ai_assisted = stats.get("ai_assisted", 0) > 0
                direct_copy = stats.get("direct_copy", False)
                git_merge_used = stats.get("git_merge", False)

                if had_conflicts or ai_assisted or direct_copy or git_merge_used:
                    # AI resolved conflicts, assisted with merges, git merge was used, or direct copy was used
                    # Changes are already written and staged - no need for additional git merge
                    _print_merge_success(
                        no_commit, stats, spec_name=spec_name, keep_worktree=True
                    )

                    # Don't auto-delete worktree - let user test and manually cleanup
                    # User can delete with: python auto-claude/run.py --spec <name> --discard
                    # Or via UI "Delete Worktree" button

                    return True
                else:
                    # No conflicts needed AI resolution - do standard git merge
                    # This is the common case: no divergence, just need to merge changes
                    success_result = manager.merge_worktree(
                        spec_name, delete_after=False, no_commit=no_commit
                    )
                    if success_result:
                        _print_merge_success(
                            no_commit, stats, spec_name=spec_name, keep_worktree=True
                        )
                        return True
                    else:
                        # Standard git merge failed - report error and don't continue
                        print()
                        print_status(
                            "Merge failed. Please check the errors above.", "error"
                        )
                        return False
            elif smart_result.get("git_conflicts"):
                # Had git conflicts that AI couldn't fully resolve
                resolved = smart_result.get("resolved", [])
                remaining = smart_result.get("conflicts", [])

                if resolved:
                    print()
                    print_status(f"AI resolved {len(resolved)} file(s)", "success")

                if remaining:
                    print()
                    print_status(
                        f"{len(remaining)} conflict(s) require manual resolution:",
                        "warning",
                    )
                    _print_conflict_info(smart_result)

                    # Changes for resolved files are staged, remaining need manual work
                    print()
                    print("The resolved files are staged. For remaining conflicts:")
                    print(muted("  1. Manually resolve the conflicting files"))
                    print(muted("  2. git add <resolved-files>"))
                    print(muted("  3. git commit"))
                    return False
            elif smart_result.get("conflicts"):
                # Has semantic conflicts that need resolution
                _print_conflict_info(smart_result)
                print()
                print(muted("Attempting git merge anyway..."))
                print()

    # Fall back to standard git merge
    success_result = manager.merge_worktree(
        spec_name, delete_after=False, no_commit=no_commit
    )

    if success_result:
        print()
        if no_commit:
            print_status("Changes are staged in your working directory.", "success")
            print()
            print("Review the changes in your IDE, then commit:")
            print(highlight("  git commit -m 'your commit message'"))
            print()
            print("When satisfied, delete the worktree:")
            print(muted(f"  python auto-claude/run.py --spec {spec_name} --discard"))
        else:
            print_status("Your feature has been added to your project.", "success")
            print()
            print("When satisfied, delete the worktree:")
            print(muted(f"  python auto-claude/run.py --spec {spec_name} --discard"))
        return True
    else:
        print()
        print_status("There was a conflict merging the changes.", "error")
        print(muted("You may need to merge manually."))
        return False


def _try_smart_merge(
    project_dir: Path,
    spec_name: str,
    worktree_path: Path,
    manager: WorktreeManager,
    no_commit: bool = False,
    task_source_branch: str | None = None,
) -> dict | None:
    """
    Try to use the intent-aware merge system.

    This handles both semantic conflicts (parallel tasks) and git conflicts
    (branch divergence) by using AI to intelligently merge files.

    Uses a lock file to prevent concurrent merges for the same spec.

    Args:
        task_source_branch: The branch the task was created from (for comparison).
                           If None, auto-detect.

    Returns:
        Dict with results, or None if smart merge not applicable
    """
    # Quick Win 5: Acquire merge lock to prevent concurrent operations
    try:
        with MergeLock(project_dir, spec_name):
            return _try_smart_merge_inner(
                project_dir,
                spec_name,
                worktree_path,
                manager,
                no_commit,
                task_source_branch=task_source_branch,
            )
    except MergeLockError as e:
        print(warning(f"  {e}"))
        return {
            "success": False,
            "error": str(e),
            "conflicts": [],
        }


def _try_smart_merge_inner(
    project_dir: Path,
    spec_name: str,
    worktree_path: Path,
    manager: WorktreeManager,
    no_commit: bool = False,
    task_source_branch: str | None = None,
) -> dict | None:
    """Inner implementation of smart merge (called with lock held)."""
    debug(
        MODULE,
        "=== SMART MERGE START ===",
        spec_name=spec_name,
        worktree_path=str(worktree_path),
        no_commit=no_commit,
    )

    # Create progress callback for subprocess mode (Electron frontend).
    # Only emits JSON to stdout when piped, not in interactive CLI.
    progress_callback = _create_merge_progress_callback()

    try:
        print(muted("  Analyzing changes with intent-aware merge..."))

        if progress_callback is not None:
            progress_callback(
                MergeProgressStage.ANALYZING,
                0,
                "Starting merge analysis",
            )

        # Capture worktree state in FileTimelineTracker before merge
        try:
            timeline_tracker = FileTimelineTracker(project_dir)
            timeline_tracker.capture_worktree_state(spec_name, worktree_path)
            debug(MODULE, "Captured worktree state for timeline tracking")
        except Exception as e:
            debug_warning(MODULE, f"Could not capture worktree state: {e}")

        # Initialize the orchestrator
        debug(
            MODULE,
            "Initializing MergeOrchestrator",
            project_dir=str(project_dir),
            enable_ai=True,
        )
        orchestrator = MergeOrchestrator(
            project_dir,
            enable_ai=True,  # Enable AI for ambiguous conflicts
            dry_run=False,
        )

        # Refresh evolution data from the worktree
        # Use task_source_branch (where task branched from) for comparing what files changed
        # If not provided, auto-detection will find main/master
        debug(
            MODULE,
            "Refreshing evolution data from git",
            spec_name=spec_name,
            task_source_branch=task_source_branch,
        )
        orchestrator.evolution_tracker.refresh_from_git(
            spec_name, worktree_path, target_branch=task_source_branch
        )

        # Check for git-level conflicts first (branch divergence)
        if progress_callback is not None:
            progress_callback(
                MergeProgressStage.DETECTING_CONFLICTS,
                25,
                "Checking for git-level conflicts",
            )

        debug(MODULE, "Checking for git-level conflicts")
        git_conflicts = _check_git_conflicts(project_dir, spec_name)

        debug_detailed(
            MODULE,
            "Git conflict check result",
            has_conflicts=git_conflicts.get("has_conflicts"),
            conflicting_files=git_conflicts.get("conflicting_files", []),
            base_branch=git_conflicts.get("base_branch"),
            needs_rebase=git_conflicts.get("needs_rebase"),
            commits_behind=git_conflicts.get("commits_behind", 0),
        )

        # Check if spec branch is behind and needs rebase
        # This must happen BEFORE conflict resolution to ensure merge succeeds
        # LOGIC-003: Simplified condition - needs_rebase implies commits_behind > 0
        if git_conflicts.get("needs_rebase"):
            commits_behind = git_conflicts.get("commits_behind", 0)
            base_branch = git_conflicts.get("base_branch", "main")

            print()
            print_status(
                f"Spec branch is {commits_behind} commit(s) behind {base_branch}",
                "warning",
            )
            print(muted("  Automatically rebasing before merge..."))

            # Attempt to rebase the spec branch onto the latest base branch
            rebase_success = _rebase_spec_branch(
                project_dir,
                spec_name,
                base_branch,
            )

            if rebase_success:
                # Refresh git conflicts after rebase
                # The rebase may have changed the conflict state
                git_conflicts = _check_git_conflicts(project_dir, spec_name)

                debug(
                    MODULE,
                    "Refreshed git conflicts after rebase",
                    has_conflicts=git_conflicts.get("has_conflicts"),
                    conflicting_files=git_conflicts.get("conflicting_files", []),
                    diverged_but_no_conflicts=git_conflicts.get(
                        "diverged_but_no_conflicts"
                    ),
                )

                # If rebase succeeded and now there are no conflicts,
                # the diverged_but_no_conflicts path will handle the merge
            else:
                # Rebase failed (likely due to worktree lock) - continue with merge
                # Git merge or AI resolver will handle it depending on conflict state
                debug(
                    MODULE,
                    "Rebase skipped or failed, continuing with merge flow",
                )

        if git_conflicts.get("has_conflicts"):
            print(
                muted(
                    f"  Branch has diverged from {git_conflicts.get('base_branch', 'main')}"
                )
            )
            print(
                muted(
                    f"  Conflicting files: {len(git_conflicts.get('conflicting_files', []))}"
                )
            )

            debug(
                MODULE,
                "Starting AI conflict resolution",
                num_conflicts=len(git_conflicts.get("conflicting_files", [])),
            )

            if progress_callback is not None:
                progress_callback(
                    MergeProgressStage.RESOLVING,
                    50,
                    f"Resolving {len(git_conflicts.get('conflicting_files', []))} conflicting files with AI",
                    {
                        "conflicts_found": len(
                            git_conflicts.get("conflicting_files", [])
                        )
                    },
                )

            # Try to resolve git conflicts with AI
            resolution_result = _resolve_git_conflicts_with_ai(
                project_dir,
                spec_name,
                worktree_path,
                git_conflicts,
                orchestrator,
                no_commit=no_commit,
            )

            if resolution_result.get("success"):
                debug_success(
                    MODULE,
                    "AI conflict resolution succeeded",
                    resolved_files=resolution_result.get("resolved_files", []),
                    stats=resolution_result.get("stats", {}),
                )

                if progress_callback is not None:
                    stats = resolution_result.get("stats", {})
                    original_conflict_count = len(
                        git_conflicts.get("conflicting_files", [])
                    )
                    progress_callback(
                        MergeProgressStage.COMPLETE,
                        100,
                        "Merge complete",
                        {
                            "conflicts_found": original_conflict_count,
                            "conflicts_resolved": stats.get("conflicts_resolved", 0),
                        },
                    )

                return resolution_result
            else:
                # AI couldn't resolve all conflicts
                debug_error(
                    MODULE,
                    "AI conflict resolution failed",
                    remaining_conflicts=resolution_result.get(
                        "remaining_conflicts", []
                    ),
                    resolved_files=resolution_result.get("resolved_files", []),
                    error=resolution_result.get("error"),
                )

                if progress_callback is not None:
                    original_conflict_count = len(
                        git_conflicts.get("conflicting_files", [])
                    )
                    remaining_count = len(
                        resolution_result.get("remaining_conflicts", [])
                    )
                    progress_callback(
                        MergeProgressStage.ERROR,
                        0,
                        "Some conflicts could not be resolved",
                        {
                            "conflicts_found": original_conflict_count,
                            "conflicts_resolved": original_conflict_count
                            - remaining_count,
                            "conflicts_remaining": remaining_count,
                        },
                    )

                return {
                    "success": False,
                    "conflicts": resolution_result.get("remaining_conflicts", []),
                    "resolved": resolution_result.get("resolved_files", []),
                    "git_conflicts": True,
                    "error": resolution_result.get("error"),
                }

        # Check if branches diverged but no actual conflicts (use git merge)
        if git_conflicts.get("diverged_but_no_conflicts"):
            debug(MODULE, "Branches diverged but no conflicts - using git merge")
            print(muted("  Branches diverged but no conflicts detected"))
            print(muted("  Using git merge to combine changes..."))

            spec_branch = f"auto-claude/{spec_name}"

            # Use git merge --no-commit to combine changes from both branches
            # Since merge-tree confirmed no conflicts, this should succeed cleanly
            merge_result = run_git(
                ["merge", "--no-commit", "--no-ff", spec_branch],
                cwd=project_dir,
            )

            if merge_result.returncode == 0:
                # Merge succeeded - get list of files that were merged
                # Use git diff --cached to see what's staged
                diff_result = run_git(
                    ["diff", "--cached", "--name-only"],
                    cwd=project_dir,
                )
                merged_files = [
                    f.strip()
                    for f in diff_result.stdout.splitlines()
                    if f.strip() and not _is_auto_claude_file(f.strip())
                ]

                debug_success(
                    MODULE,
                    "Git merge succeeded",
                    merged_files_count=len(merged_files),
                )

                for file_path in merged_files:
                    print(success(f"    ✓ {file_path}"))

                if progress_callback is not None:
                    progress_callback(
                        MergeProgressStage.COMPLETE,
                        100,
                        f"Git merge complete ({len(merged_files)} files)",
                    )

                return {
                    "success": True,
                    "resolved_files": merged_files,
                    "stats": {
                        "files_merged": len(merged_files),
                        "conflicts_resolved": 0,
                        "ai_assisted": 0,
                        "auto_merged": len(merged_files),
                        "git_merge": True,  # Flag indicating git merge was used
                    },
                }
            else:
                # Merge failed unexpectedly - abort and fall back to semantic analysis
                debug_warning(
                    MODULE,
                    "Git merge failed unexpectedly despite no conflicts detected",
                    stderr=merge_result.stderr[:500] if merge_result.stderr else "",
                )
                # Abort the merge to restore clean state
                abort_result = run_git(["merge", "--abort"], cwd=project_dir)
                if abort_result.returncode != 0:
                    debug_error(
                        MODULE,
                        "Failed to abort merge - repo may be in inconsistent state",
                        stderr=abort_result.stderr,
                    )
                    return None  # Trigger fallback to avoid operating on inconsistent state
                print(
                    warning(
                        "  Git merge failed unexpectedly, falling back to semantic analysis..."
                    )
                )

        # No git conflicts - proceed with semantic analysis
        debug(MODULE, "No git conflicts, proceeding with semantic analysis")
        preview = orchestrator.preview_merge([spec_name])

        files_to_merge = len(preview.get("files_to_merge", []))
        conflicts = preview.get("conflicts", [])
        auto_mergeable = preview.get("summary", {}).get("auto_mergeable", 0)

        print(muted(f"  Found {files_to_merge} files to merge"))

        if conflicts:
            print(muted(f"  Detected {len(conflicts)} potential conflict(s)"))
            print(muted(f"  Auto-mergeable: {auto_mergeable}/{len(conflicts)}"))

            # Check if any conflicts need human review
            needs_human = [c for c in conflicts if not c.get("can_auto_merge")]

            if needs_human:
                return {
                    "success": False,
                    "conflicts": needs_human,
                    "preview": preview,
                }

        # All conflicts can be auto-merged or no conflicts
        print(muted("  All changes compatible, proceeding with merge..."))

        if progress_callback is not None:
            progress_callback(
                MergeProgressStage.COMPLETE,
                100,
                f"Analysis complete ({files_to_merge} files compatible)",
            )

        return {
            "success": True,
            "stats": {
                "files_merged": files_to_merge,
                "auto_resolved": auto_mergeable,
            },
        }

    except Exception as e:
        # If smart merge fails, fall back to git
        import traceback

        if progress_callback is not None:
            progress_callback(
                MergeProgressStage.ERROR,
                0,
                f"Smart merge error: {e}",
            )

        print(muted(f"  Smart merge error: {e}"))
        traceback.print_exc()
        return None


def _rebase_spec_branch(
    project_dir: Path,
    spec_name: str,
    base_branch: str,
) -> bool:
    """
    Attempt to rebase the spec branch onto the latest base branch.

    NOTE: This will fail if the spec branch is checked out in a worktree,
    which is the normal case. The caller should handle failure gracefully
    by falling back to git merge or AI conflict resolution.

    Args:
        project_dir: The project directory
        spec_name: Name of the spec
        base_branch: The branch to rebase onto

    Returns:
        True if rebase succeeded cleanly or branch was already up-to-date,
        False if rebase failed (worktree lock, conflicts, or other errors)
    """
    spec_branch = f"auto-claude/{spec_name}"

    debug(
        MODULE,
        "Attempting to rebase spec branch",
        spec_branch=spec_branch,
        base_branch=base_branch,
    )

    # Check if spec branch is used by a worktree (common case)
    # In this case, we can't checkout/rebase from the main repo
    worktree_list_result = run_git(["worktree", "list", "--porcelain"], cwd=project_dir)
    if worktree_list_result.returncode == 0:
        # Check if spec_branch is in use by a worktree
        output = worktree_list_result.stdout
        if f"branch refs/heads/{spec_branch}" in output:
            debug(
                MODULE,
                "Spec branch is checked out in a worktree - skipping rebase",
                spec_branch=spec_branch,
            )
            # This is expected - return False to let caller use git merge instead
            return False

    # Save original branch to restore after rebase
    original_branch_result = run_git(
        ["rev-parse", "--abbrev-ref", "HEAD"], cwd=project_dir
    )
    if original_branch_result.returncode != 0:
        debug_error(
            MODULE,
            "Could not get current branch name",
            stderr=original_branch_result.stderr,
        )
        return False
    original_branch = original_branch_result.stdout.strip()
    if not original_branch or original_branch == "HEAD":
        debug_error(
            MODULE,
            "Could not determine current branch (detached HEAD state)",
        )
        return False

    # Get the current commit of spec_branch before rebase
    before_commit_result = run_git(["rev-parse", spec_branch], cwd=project_dir)
    if before_commit_result.returncode != 0:
        debug_error(
            MODULE,
            "Could not get spec branch commit before rebase",
            stderr=before_commit_result.stderr,
        )
        return False
    before_commit = before_commit_result.stdout.strip()

    print()
    print(muted(f"  Rebasing {spec_branch} onto {base_branch}..."))

    try:
        # Try to checkout the spec branch
        checkout_result = run_git(["checkout", spec_branch], cwd=project_dir)
        if checkout_result.returncode != 0:
            # Checkout failed - likely due to worktree lock
            debug(
                MODULE,
                "Could not checkout spec branch for rebase (likely worktree lock)",
                stderr=checkout_result.stderr[:200] if checkout_result.stderr else "",
            )
            return False

        # Run standard rebase
        rebase_result = run_git(
            ["rebase", base_branch],
            cwd=project_dir,
        )

        if rebase_result.returncode != 0:
            # Rebase failed - check if it was due to conflicts
            status_result = run_git(["status", "--porcelain"], cwd=project_dir)

            has_unmerged = any(
                line[:2] in ("UU", "AA", "DD", "AU", "UA", "DU", "UD")
                for line in status_result.stdout.splitlines()
                if len(line) >= 2
            )

            # Abort the rebase to return to clean state
            abort_result = run_git(["rebase", "--abort"], cwd=project_dir)
            if abort_result.returncode != 0:
                debug_error(
                    MODULE,
                    "Failed to abort rebase - repo may be in inconsistent state",
                    stderr=abort_result.stderr,
                )
                return False

            if has_unmerged:
                debug_warning(
                    MODULE,
                    "Rebase encountered conflicts - aborted, will use alternative merge",
                    stderr=rebase_result.stderr[:200] if rebase_result.stderr else "",
                )
                return False

            debug_error(
                MODULE,
                "Rebase failed with unexpected error",
                stderr=rebase_result.stderr[:500] if rebase_result.stderr else "",
            )
            return False

        # Rebase succeeded - verify spec_branch moved forward
        after_commit_result = run_git(["rev-parse", spec_branch], cwd=project_dir)

        if after_commit_result.returncode == 0:
            after_commit_hash = after_commit_result.stdout.strip()

            if before_commit == after_commit_hash:
                debug(
                    MODULE,
                    "Branch already up-to-date, no rebase needed",
                    before_commit=before_commit[:12],
                )
                return True

            debug_success(
                MODULE,
                "Rebase succeeded",
                before_commit=before_commit[:12],
                after_commit=after_commit_hash[:12],
            )
            print(success(f"    ✓ Rebased onto {base_branch}"))
            return True

        debug_error(MODULE, "Could not verify spec branch commit after rebase")
        return False
    finally:
        # Always restore original branch
        if original_branch:
            restore_result = run_git(["checkout", original_branch], cwd=project_dir)
            if restore_result.returncode != 0:
                debug_error(
                    MODULE,
                    f"Failed to restore original branch '{original_branch}'",
                    stderr=restore_result.stderr,
                )


def _check_git_conflicts(project_dir: Path, spec_name: str) -> dict:
    """
    Check for git-level conflicts WITHOUT modifying the working directory.

    Uses git merge-tree to check conflicts in-memory, avoiding HMR triggers
    from file system changes.

    Returns:
        Dict with has_conflicts, conflicting_files, etc.
    """
    import re

    spec_branch = f"auto-claude/{spec_name}"
    result = {
        "has_conflicts": False,
        "conflicting_files": [],
        "base_branch": "main",
        "spec_branch": spec_branch,
        "needs_rebase": False,
        "commits_behind": 0,
    }

    try:
        # Get current branch
        base_result = run_git(
            ["rev-parse", "--abbrev-ref", "HEAD"],
            cwd=project_dir,
        )
        if base_result.returncode == 0:
            result["base_branch"] = base_result.stdout.strip()

        # Get merge base
        merge_base_result = run_git(
            ["merge-base", result["base_branch"], spec_branch],
            cwd=project_dir,
        )
        if merge_base_result.returncode != 0:
            debug_warning(MODULE, "Could not find merge base")
            return result

        _merge_base = (
            merge_base_result.stdout.strip()
        )  # Reserved for future conflict detection

        # Get commit hashes
        main_commit_result = run_git(
            ["rev-parse", result["base_branch"]],
            cwd=project_dir,
        )
        spec_commit_result = run_git(
            ["rev-parse", spec_branch],
            cwd=project_dir,
        )

        if main_commit_result.returncode != 0 or spec_commit_result.returncode != 0:
            debug_warning(MODULE, "Could not resolve branch commits")
            return result

        main_commit = main_commit_result.stdout.strip()
        spec_commit = spec_commit_result.stdout.strip()

        # Check if spec branch is behind base branch (needs rebase)
        # Count commits that are in base branch but not in spec branch
        rev_list_result = run_git(
            ["rev-list", "--count", f"{spec_commit}..{main_commit}"],
            cwd=project_dir,
        )
        if rev_list_result.returncode == 0:
            # LOGIC-002: Handle potential non-integer output gracefully
            try:
                commits_behind = int(rev_list_result.stdout.strip())
            except (ValueError, AttributeError):
                commits_behind = 0
                debug_warning(
                    MODULE,
                    "Could not parse commit count from rev-list output",
                    stdout=rev_list_result.stdout[:100]
                    if rev_list_result.stdout
                    else "",
                )
            result["commits_behind"] = commits_behind
            if commits_behind > 0:
                result["needs_rebase"] = True
                debug(
                    MODULE,
                    f"Spec branch is {commits_behind} commit(s) behind base branch",
                    base_branch=result["base_branch"],
                    spec_branch=spec_branch,
                )
        else:
            debug_warning(
                MODULE,
                "Could not count commits behind",
                stderr=rev_list_result.stderr,
            )

        # Use git merge-tree to check for conflicts WITHOUT touching working directory
        # Note: --write-tree mode only accepts 2 branches (it auto-finds the merge base)
        merge_tree_result = run_git(
            [
                "merge-tree",
                "--write-tree",
                "--no-messages",
                result["base_branch"],  # Use branch names, not commit hashes
                spec_branch,
            ],
            cwd=project_dir,
        )

        # merge-tree returns exit code 1 if there are actual text conflicts
        # Exit code 0 means clean merge possible
        if merge_tree_result.returncode != 0:
            # Parse the output for ACTUAL conflicting files (look for CONFLICT markers)
            output = merge_tree_result.stdout + merge_tree_result.stderr
            for line in output.split("\n"):
                if "CONFLICT" in line:
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

            # Only set has_conflicts if we found ACTUAL CONFLICT markers
            # A non-zero exit code without CONFLICT markers just means branches diverged
            # but git can auto-merge them - we handle this with direct file copy
            if result["conflicting_files"]:
                result["has_conflicts"] = True
                debug(
                    MODULE,
                    f"Found {len(result['conflicting_files'])} actual git conflicts",
                    files=result["conflicting_files"],
                )
            else:
                # No CONFLICT markers = no actual conflicts
                # Branches diverged but changes don't overlap - git can auto-merge
                # We'll handle this by copying files directly from spec branch
                debug(
                    MODULE,
                    "No CONFLICT markers - branches diverged but can be auto-merged",
                    merge_tree_returncode=merge_tree_result.returncode,
                )
                result["has_conflicts"] = False
                result["diverged_but_no_conflicts"] = True  # Flag for direct copy

    except Exception as e:
        print(muted(f"  Error checking git conflicts: {e}"))

    return result


def _resolve_git_conflicts_with_ai(
    project_dir: Path,
    spec_name: str,
    worktree_path: Path,
    git_conflicts: dict,
    orchestrator: MergeOrchestrator,
    no_commit: bool = False,
) -> dict:
    """
    Resolve git-level conflicts using AI.

    This handles the case where main has diverged from the worktree branch.
    For each conflicting file, it:
    1. Gets the content from the main branch
    2. Gets the content from the worktree branch
    3. Gets the common ancestor (merge-base) content
    4. Uses AI to intelligently merge them
    5. Writes the merged content to main and stages it

    Returns:
        Dict with success, resolved_files, remaining_conflicts
    """

    debug(
        MODULE,
        "=== AI CONFLICT RESOLUTION START ===",
        spec_name=spec_name,
        num_conflicting_files=len(git_conflicts.get("conflicting_files", [])),
    )

    conflicting_files = git_conflicts.get("conflicting_files", [])
    base_branch = git_conflicts.get("base_branch", "main")
    spec_branch = git_conflicts.get("spec_branch", f"auto-claude/{spec_name}")

    debug_detailed(
        MODULE,
        "Conflict resolution params",
        base_branch=base_branch,
        spec_branch=spec_branch,
        conflicting_files=conflicting_files,
    )

    resolved_files = []
    remaining_conflicts = []
    auto_merged_count = 0
    ai_merged_count = 0

    print()
    print_status(
        f"Resolving {len(conflicting_files)} conflicting file(s) with AI...", "progress"
    )

    # Get merge-base commit
    merge_base_result = run_git(
        ["merge-base", base_branch, spec_branch],
        cwd=project_dir,
    )
    merge_base = (
        merge_base_result.stdout.strip() if merge_base_result.returncode == 0 else None
    )
    debug(
        MODULE,
        "Found merge-base commit",
        merge_base=merge_base[:12] if merge_base else None,
    )

    # Detect file renames between merge-base and target branch
    # This handles cases where files were moved/renamed (e.g., directory restructures)
    path_mappings: dict[str, str] = {}
    if merge_base:
        path_mappings = _detect_file_renames(project_dir, merge_base, base_branch)
        if path_mappings:
            debug(
                MODULE,
                f"Detected {len(path_mappings)} file renames between merge-base and target",
                sample_mappings=dict(list(path_mappings.items())[:5]),
            )
            print(
                muted(
                    f"  Detected {len(path_mappings)} file rename(s) since branch creation"
                )
            )

    # FIX: Copy NEW files FIRST before resolving conflicts
    # This ensures dependencies exist before files that import them are written
    changed_files = _get_changed_files_from_branch(
        project_dir, base_branch, spec_branch
    )
    new_files = [
        (f, s) for f, s in changed_files if s == "A" and f not in conflicting_files
    ]

    if new_files:
        print(muted(f"  Copying {len(new_files)} new file(s) first (dependencies)..."))
        for file_path, status in new_files:
            try:
                # Apply path mapping - write to new location if file was renamed
                target_file_path = _apply_path_mapping(file_path, path_mappings)
                target_path = project_dir / target_file_path
                target_path.parent.mkdir(parents=True, exist_ok=True)

                # Handle binary files differently - use bytes instead of text
                if _is_binary_file(file_path):
                    binary_content = _get_binary_file_content_from_ref(
                        project_dir, spec_branch, file_path
                    )
                    if binary_content is not None:
                        target_path.write_bytes(binary_content)
                        run_git(["add", target_file_path], cwd=project_dir)
                        resolved_files.append(target_file_path)
                        debug(MODULE, f"Copied new binary file: {file_path}")
                else:
                    content = _get_file_content_from_ref(
                        project_dir, spec_branch, file_path
                    )
                    if content is not None:
                        target_path.write_text(content, encoding="utf-8")
                        run_git(["add", target_file_path], cwd=project_dir)
                        resolved_files.append(target_file_path)
                        if target_file_path != file_path:
                            debug(
                                MODULE,
                                f"Copied new file with path mapping: {file_path} -> {target_file_path}",
                            )
                        else:
                            debug(MODULE, f"Copied new file: {file_path}")
            except Exception as e:
                debug_warning(MODULE, f"Could not copy new file {file_path}: {e}")

    # Categorize conflicting files for processing
    files_needing_ai_merge: list[ParallelMergeTask] = []
    simple_merges: list[
        tuple[str, str | None]
    ] = []  # (file_path, merged_content or None for delete)
    lock_files_excluded: list[str] = []  # Lock files excluded from merge
    auto_merged_simple: set[str] = set()  # Files that were auto-merged via simple 3-way

    debug(MODULE, "Categorizing conflicting files for parallel processing")

    for file_path in conflicting_files:
        # Apply path mapping to get the target path in the current branch
        target_file_path = _apply_path_mapping(file_path, path_mappings)
        debug(
            MODULE,
            f"Categorizing conflicting file: {file_path}"
            + (f" -> {target_file_path}" if target_file_path != file_path else ""),
        )

        try:
            # Get content from main branch using MAPPED path (file may have been renamed)
            main_content = _get_file_content_from_ref(
                project_dir, base_branch, target_file_path
            )

            # Get content from worktree branch using ORIGINAL path
            worktree_content = _get_file_content_from_ref(
                project_dir, spec_branch, file_path
            )

            # Get content from merge-base (common ancestor) using ORIGINAL path
            base_content = None
            if merge_base:
                base_content = _get_file_content_from_ref(
                    project_dir, merge_base, file_path
                )

            if main_content is None and worktree_content is None:
                # File doesn't exist in either - skip
                continue

            if main_content is None:
                # File only exists in worktree - it's a new file (no AI needed)
                # Write to target path (mapped if applicable)
                simple_merges.append((target_file_path, worktree_content))
                debug(MODULE, f"  {file_path}: new file (no AI needed)")
            elif worktree_content is None:
                # File only exists in main - was deleted in worktree (no AI needed)
                simple_merges.append((target_file_path, None))  # None = delete
                debug(MODULE, f"  {file_path}: deleted (no AI needed)")
            else:
                # File exists in both - check if it's a lock file
                if _is_lock_file(target_file_path):
                    # Lock files should be excluded from merge entirely
                    # They must be regenerated after merge by running the package manager
                    # (e.g., npm install, pnpm install, uv sync, cargo update)
                    #
                    # Strategy: Take main branch version and let user regenerate
                    lock_files_excluded.append(target_file_path)
                    simple_merges.append((target_file_path, main_content))
                    debug(
                        MODULE,
                        f"  {target_file_path}: lock file (excluded - will use main version)",
                    )
                else:
                    # File exists in both - try simple 3-way merge FIRST (no AI needed)
                    # This handles cases where:
                    # - Only one side changed from base (ours==base or theirs==base)
                    # - Both sides made identical changes (ours==theirs)
                    simple_success, simple_merged = _try_simple_3way_merge(
                        base_content, main_content, worktree_content
                    )

                    if simple_success and simple_merged is not None:
                        # Simple 3-way merge succeeded - no AI needed!
                        simple_merges.append((target_file_path, simple_merged))
                        auto_merged_simple.add(target_file_path)  # Track for stats
                        debug(
                            MODULE,
                            f"  {file_path}: auto-merged (simple 3-way, no AI needed)"
                            + (
                                f" (will write to {target_file_path})"
                                if target_file_path != file_path
                                else ""
                            ),
                        )
                    else:
                        # Simple merge failed - needs AI merge
                        # Store the TARGET path for writing, but track original for content retrieval
                        files_needing_ai_merge.append(
                            ParallelMergeTask(
                                file_path=target_file_path,  # Use target path for writing
                                main_content=main_content,
                                worktree_content=worktree_content,
                                base_content=base_content,
                                spec_name=spec_name,
                                project_dir=project_dir,
                            )
                        )
                        debug(
                            MODULE,
                            f"  {file_path}: needs AI merge (both sides changed differently)"
                            + (
                                f" (will write to {target_file_path})"
                                if target_file_path != file_path
                                else ""
                            ),
                        )

        except Exception as e:
            print(error(f"    ✗ Failed to categorize {file_path}: {e}"))
            remaining_conflicts.append(
                {
                    "file": file_path,
                    "reason": str(e),
                    "severity": "high",
                }
            )

    # Process simple merges first (fast, no AI)
    if simple_merges:
        print(muted(f"  Processing {len(simple_merges)} simple file(s)..."))
        for file_path, merged_content in simple_merges:
            try:
                if merged_content is not None:
                    target_path = project_dir / file_path
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    target_path.write_text(merged_content, encoding="utf-8")
                    run_git(["add", file_path], cwd=project_dir)
                    resolved_files.append(file_path)
                    # Show appropriate message based on merge type
                    if file_path in auto_merged_simple:
                        print(success(f"    ✓ {file_path} (auto-merged)"))
                        auto_merged_count += 1  # Count for stats
                    elif file_path in lock_files_excluded:
                        print(
                            success(
                                f"    ✓ {file_path} (lock file - kept main version)"
                            )
                        )
                    else:
                        print(success(f"    ✓ {file_path} (new file)"))
                else:
                    # Delete the file
                    target_path = project_dir / file_path
                    if target_path.exists():
                        target_path.unlink()
                        run_git(["add", file_path], cwd=project_dir)
                    resolved_files.append(file_path)
                    print(success(f"    ✓ {file_path} (deleted)"))
            except Exception as e:
                print(error(f"    ✗ {file_path}: {e}"))
                remaining_conflicts.append(
                    {
                        "file": file_path,
                        "reason": str(e),
                        "severity": "high",
                    }
                )

    # Process AI merges in parallel
    if files_needing_ai_merge:
        print()
        print_status(
            f"Merging {len(files_needing_ai_merge)} file(s) with AI (parallel)...",
            "progress",
        )

        import time

        start_time = time.time()

        # Run parallel merges
        parallel_results = asyncio.run(
            _run_parallel_merges(
                tasks=files_needing_ai_merge,
                project_dir=project_dir,
                max_concurrent=MAX_PARALLEL_AI_MERGES,
            )
        )

        elapsed = time.time() - start_time

        # Process results
        for result in parallel_results:
            if result.success:
                target_path = project_dir / result.file_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_text(result.merged_content, encoding="utf-8")
                run_git(["add", result.file_path], cwd=project_dir)
                resolved_files.append(result.file_path)

                if result.was_auto_merged:
                    auto_merged_count += 1
                    print(success(f"    ✓ {result.file_path} (git auto-merged)"))
                else:
                    ai_merged_count += 1
                    print(success(f"    ✓ {result.file_path} (AI merged)"))
            else:
                print(error(f"    ✗ {result.file_path}: {result.error}"))
                remaining_conflicts.append(
                    {
                        "file": result.file_path,
                        "reason": result.error or "AI could not resolve the conflict",
                        "severity": "high",
                    }
                )

        # Print summary
        print()
        print(muted(f"  Parallel merge completed in {elapsed:.1f}s"))
        print(muted(f"    Git auto-merged: {auto_merged_count}"))
        print(muted(f"    AI merged: {ai_merged_count}"))
        if remaining_conflicts:
            print(muted(f"    Failed: {len(remaining_conflicts)}"))

    # ALWAYS process non-conflicting files, even if some conflicts failed
    # This ensures we get as much of the build as possible
    # (New files were already copied at the start)
    print(muted("  Merging remaining files..."))

    # Get list of modified/deleted files (new files already copied at start)
    non_conflicting = [
        (f, s)
        for f, s in changed_files
        if f not in conflicting_files and s != "A"  # Skip new files, already copied
    ]

    # Separate files that need AI merge (path-mapped) from simple copies
    path_mapped_files: list[ParallelMergeTask] = []
    simple_copy_files: list[
        tuple[str, str, str]
    ] = []  # (file_path, target_path, status)

    for file_path, status in non_conflicting:
        # Apply path mapping for renamed/moved files
        target_file_path = _apply_path_mapping(file_path, path_mappings)

        if target_file_path != file_path and status != "D":
            # File was renamed/moved - needs AI merge to incorporate changes
            # Get content from worktree (old path) and target branch (new path)
            worktree_content = _get_file_content_from_ref(
                project_dir, spec_branch, file_path
            )
            target_content = _get_file_content_from_ref(
                project_dir, base_branch, target_file_path
            )
            base_content = None
            if merge_base:
                base_content = _get_file_content_from_ref(
                    project_dir, merge_base, file_path
                )

            if worktree_content and target_content:
                # Both exist - need AI merge
                path_mapped_files.append(
                    ParallelMergeTask(
                        file_path=target_file_path,
                        main_content=target_content,
                        worktree_content=worktree_content,
                        base_content=base_content,
                        spec_name=spec_name,
                        project_dir=project_dir,
                    )
                )
                debug(
                    MODULE,
                    f"Path-mapped file needs AI merge: {file_path} -> {target_file_path}",
                )
            elif worktree_content:
                # Only exists in worktree - simple copy to new path
                simple_copy_files.append((file_path, target_file_path, status))
        else:
            # No path mapping or deletion - simple operation
            simple_copy_files.append((file_path, target_file_path, status))

    # Process path-mapped files with AI merge
    if path_mapped_files:
        print()
        print_status(
            f"Merging {len(path_mapped_files)} path-mapped file(s) with AI...",
            "progress",
        )

        import time

        start_time = time.time()

        # Run parallel merges for path-mapped files
        path_mapped_results = asyncio.run(
            _run_parallel_merges(
                tasks=path_mapped_files,
                project_dir=project_dir,
                max_concurrent=MAX_PARALLEL_AI_MERGES,
            )
        )

        elapsed = time.time() - start_time

        for result in path_mapped_results:
            if result.success:
                target_path = project_dir / result.file_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_text(result.merged_content, encoding="utf-8")
                run_git(["add", result.file_path], cwd=project_dir)
                resolved_files.append(result.file_path)

                if result.was_auto_merged:
                    auto_merged_count += 1
                    print(success(f"    ✓ {result.file_path} (auto-merged)"))
                else:
                    ai_merged_count += 1
                    print(success(f"    ✓ {result.file_path} (AI merged)"))
            else:
                print(error(f"    ✗ {result.file_path}: {result.error}"))
                remaining_conflicts.append(
                    {
                        "file": result.file_path,
                        "reason": result.error or "AI could not merge path-mapped file",
                        "severity": "high",
                    }
                )

        print(muted(f"  Path-mapped merge completed in {elapsed:.1f}s"))

    # Process simple copy/delete files
    for file_path, target_file_path, status in simple_copy_files:
        try:
            if status == "D":
                # Deleted in worktree - delete from target path
                target_path = project_dir / target_file_path
                if target_path.exists():
                    target_path.unlink()
                    run_git(["add", target_file_path], cwd=project_dir)
            else:
                # Modified without path change - simple copy
                # Check if binary file to use correct read/write method
                target_path = project_dir / target_file_path
                target_path.parent.mkdir(parents=True, exist_ok=True)

                if _is_binary_file(file_path):
                    binary_content = _get_binary_file_content_from_ref(
                        project_dir, spec_branch, file_path
                    )
                    if binary_content is not None:
                        target_path.write_bytes(binary_content)
                        run_git(["add", target_file_path], cwd=project_dir)
                        resolved_files.append(target_file_path)
                        if target_file_path != file_path:
                            debug(
                                MODULE,
                                f"Merged binary with path mapping: {file_path} -> {target_file_path}",
                            )
                else:
                    content = _get_file_content_from_ref(
                        project_dir, spec_branch, file_path
                    )
                    if content is not None:
                        target_path.write_text(content, encoding="utf-8")
                        run_git(["add", target_file_path], cwd=project_dir)
                        resolved_files.append(target_file_path)
                        if target_file_path != file_path:
                            debug(
                                MODULE,
                                f"Merged with path mapping: {file_path} -> {target_file_path}",
                            )
        except Exception as e:
            print(muted(f"    Warning: Could not process {file_path}: {e}"))

    # V2: Record merge completion in Evolution Tracker for future context
    # TODO: _record_merge_completion not yet implemented - see line 141
    # if resolved_files:
    #     _record_merge_completion(project_dir, spec_name, resolved_files)

    # Build result - partial success if some files failed but we got others
    result = {
        "success": len(remaining_conflicts) == 0,
        "resolved_files": resolved_files,
        "stats": {
            "files_merged": len(resolved_files),
            "conflicts_resolved": len(conflicting_files) - len(remaining_conflicts),
            "ai_assisted": ai_merged_count,
            "auto_merged": auto_merged_count,
            "simple_3way_merged": len(
                auto_merged_simple
            ),  # Files auto-merged without AI
            "parallel_ai_merges": len(files_needing_ai_merge),
            "lock_files_excluded": len(lock_files_excluded),
        },
    }

    # Add remaining conflicts if any (for UI to show what needs manual attention)
    if remaining_conflicts:
        result["remaining_conflicts"] = remaining_conflicts
        result["partial_success"] = len(resolved_files) > 0
        print()
        print(
            warning(f"  ⚠ {len(remaining_conflicts)} file(s) could not be auto-merged:")
        )
        for conflict in remaining_conflicts:
            print(muted(f"    - {conflict['file']}: {conflict['reason']}"))
        print(muted("  These files may need manual review."))

    # Notify about excluded lock files that need regeneration
    if lock_files_excluded:
        result["lock_files_excluded"] = lock_files_excluded
        print()
        print(
            muted(f"  ℹ {len(lock_files_excluded)} lock file(s) excluded from merge:")
        )
        for lock_file in lock_files_excluded:
            print(muted(f"    - {lock_file}"))
        print()
        print(warning("  Run your package manager to regenerate lock files:"))
        print(muted("    npm install / pnpm install / yarn / uv sync / cargo update"))

    return result


# Note: All constants, classes and helper functions are imported from the refactored modules above
# - Constants from git_utils (MAX_FILE_LINES_FOR_AI, BINARY_EXTENSIONS, etc.)
# - Models from workspace/models.py (MergeLock, MergeLockError, etc.)
# - Git utilities from workspace/git_utils.py
# - Display functions from workspace/display.py
# - Finalization functions from workspace/finalization.py


# =============================================================================
# Parallel AI Merge Implementation
# =============================================================================

import asyncio
import logging
import os

_merge_logger = logging.getLogger(__name__)

# System prompt for AI file merging
AI_MERGE_SYSTEM_PROMPT = """You are an expert code merge assistant specializing in intelligent 3-way merges. Your task is to merge code changes from two branches while preserving all meaningful changes.

CONTEXT:
- "OURS" = current main branch (target for merge)
- "THEIRS" = task worktree branch (changes being merged in)
- "BASE" = common ancestor before changes

MERGE STRATEGY:
1. **Preserve all functional changes** - Include all features, bug fixes, and improvements from both versions
2. **Combine independent changes** - If changes are in different functions/sections, include both
3. **Resolve overlapping changes intelligently**:
   - Prefer the more complete/updated implementation
   - Combine logic if both versions add value
   - When in doubt, favor the version that better addresses the task's intent
4. **Maintain syntactic correctness** - Ensure the merged code is valid and compiles/runs
5. **Preserve imports and dependencies** from both versions

HANDLING COMMON PATTERNS:
- New functions/classes: Include all from both versions
- Modified functions: Merge changes logically, prefer more complete version
- Imports: Union of all imports from both versions
- Comments/Documentation: Include relevant documentation from both
- Configuration: Merge settings, with conflict resolution favoring task-specific values

CRITICAL RULES:
- Output ONLY the merged code - no explanations, no prose, no markdown fences
- If you cannot determine the correct merge, make a reasonable decision based on best practices
- Never output error messages like "I need more context" - always provide a best-effort merge
- Ensure the output is complete and syntactically valid code"""

# Model constants for AI merge two-tier strategy (ACS-194)
MERGE_FAST_MODEL = "claude-haiku-4-5-20251001"  # Fast model for simple merges
MERGE_CAPABLE_MODEL = "claude-sonnet-4-5-20250929"  # Capable model for complex merges
MERGE_FAST_THINKING = 1024  # Lower thinking for fast/simple merges
MERGE_COMPLEX_THINKING = 16000  # Higher thinking for complex merges


def _infer_language_from_path(file_path: str) -> str:
    """Infer programming language from file extension."""
    ext_map = {
        ".py": "python",
        ".js": "javascript",
        ".jsx": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".rs": "rust",
        ".go": "go",
        ".java": "java",
        ".cpp": "cpp",
        ".c": "c",
        ".h": "c",
        ".hpp": "cpp",
        ".rb": "ruby",
        ".php": "php",
        ".swift": "swift",
        ".kt": "kotlin",
        ".scala": "scala",
        ".json": "json",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".toml": "toml",
        ".md": "markdown",
        ".html": "html",
        ".css": "css",
        ".scss": "scss",
        ".sql": "sql",
    }
    ext = os.path.splitext(file_path)[1].lower()
    return ext_map.get(ext, "text")


def _try_simple_3way_merge(
    base: str | None,
    ours: str,
    theirs: str,
) -> tuple[bool, str | None]:
    """
    Attempt a simple 3-way merge without AI.

    Returns:
        (success, merged_content) - if success is True, merged_content is the result
    """
    # If base is None, we can't do a proper 3-way merge
    if base is None:
        # If both are identical, no conflict
        if ours == theirs:
            return True, ours
        # Otherwise, we need AI to decide
        return False, None

    # If ours equals base, theirs is the only change - take theirs
    if ours == base:
        return True, theirs

    # If theirs equals base, ours is the only change - take ours
    if theirs == base:
        return True, ours

    # If ours equals theirs, both made same change - take either
    if ours == theirs:
        return True, ours

    # Both changed differently from base - need AI merge
    # We could try a line-by-line merge here, but for safety let's use AI
    return False, None


def _build_merge_prompt(
    file_path: str,
    base_content: str | None,
    main_content: str,
    worktree_content: str,
    spec_name: str,
) -> str:
    """Build the prompt for AI file merge."""
    language = _infer_language_from_path(file_path)

    base_section = ""
    if base_content:
        # Truncate very large files
        if len(base_content) > 10000:
            base_content = base_content[:10000] + "\n... (truncated)"
        base_section = f"""
BASE (common ancestor before changes):
```{language}
{base_content}
```
"""

    # Truncate large content
    if len(main_content) > 15000:
        main_content = main_content[:15000] + "\n... (truncated)"
    if len(worktree_content) > 15000:
        worktree_content = worktree_content[:15000] + "\n... (truncated)"

    prompt = f"""FILE: {file_path}
TASK: {spec_name}

This is a 3-way code merge. You must combine changes from both versions.
{base_section}
OURS (current main branch - target for merge):
```{language}
{main_content}
```

THEIRS (task worktree branch - changes being merged):
```{language}
{worktree_content}
```

OUTPUT THE MERGED CODE ONLY. No explanations, no markdown fences."""

    return prompt


def _strip_code_fences(content: str) -> str:
    """Remove markdown code fences if present."""
    # Check if content starts with code fence
    lines = content.strip().split("\n")
    if lines and lines[0].startswith("```"):
        # Remove first and last line if they're code fences
        if lines[-1].strip() == "```":
            return "\n".join(lines[1:-1])
        else:
            return "\n".join(lines[1:])
    return content


async def _attempt_ai_merge(
    task: "ParallelMergeTask",
    prompt: str,
    model: str = MERGE_FAST_MODEL,
    max_thinking_tokens: int = MERGE_FAST_THINKING,
) -> tuple[bool, str | None, str]:
    """
    Attempt an AI merge with a specific model.

    Args:
        task: The merge task with file contents
        prompt: The merge prompt
        model: Model to use for merge
        max_thinking_tokens: Max thinking tokens for the model

    Returns:
        Tuple of (success, merged_content, error_message)
    """
    try:
        from core.simple_client import create_simple_client
    except ImportError:
        return False, None, "core.simple_client not available"

    client = create_simple_client(
        agent_type="merge_resolver",
        model=model,
        system_prompt=AI_MERGE_SYSTEM_PROMPT,
        max_thinking_tokens=max_thinking_tokens,
    )

    response_text = ""
    async with client:
        await client.query(prompt)

        async for msg in client.receive_response():
            msg_type = type(msg).__name__
            if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__
                    if block_type == "TextBlock" and hasattr(block, "text"):
                        response_text += block.text

    if response_text:
        merged_content = _strip_code_fences(response_text.strip())

        # Check if AI returned natural language instead of code (case-insensitive)
        # More robust detection: (1) Check if patterns are at START of line, (2) Check for
        # absence of code patterns like imports, function definitions, braces, etc.
        natural_language_patterns = [
            "i need to",
            "let me",
            "i cannot",
            "i'm unable",
            "the file appears",
            "i don't have",
            "unfortunately",
            "i apologize",
        ]

        first_line = merged_content.split("\n")[0] if merged_content else ""
        first_line_stripped = first_line.lstrip()
        first_line_lower = first_line_stripped.lower()

        # Check if first line STARTS with natural language pattern (not just contains it)
        starts_with_prose = any(
            first_line_lower.startswith(pattern)
            for pattern in natural_language_patterns
        )

        # Also check for absence of common code patterns to reduce false positives
        has_code_patterns = any(
            pattern in merged_content[:500]  # Check first 500 chars for code patterns
            for pattern in [
                "import ",  # Python/JS/TypeScript imports
                "from ",  # Python imports
                "def ",  # Python functions
                "function ",  # JavaScript functions
                "const ",  # JavaScript/TypeScript const
                "class ",  # Class definitions
                "{",  # Braces indicate code
                "}",  # Braces indicate code
                "#!",  # Shebang
                "<!--",  # HTML comment
            ]
        )

        # Only reject if it starts with prose AND lacks code patterns
        if starts_with_prose and not has_code_patterns:
            return (
                False,
                None,
                f"AI returned explanation instead of code: {first_line[:80]}...",
            )

        # Validate syntax
        is_valid, syntax_error = _validate_merged_syntax(
            task.file_path, merged_content, task.project_dir
        )
        if not is_valid:
            return False, None, f"Invalid syntax: {syntax_error}"

        return True, merged_content, ""
    else:
        return False, None, "AI returned empty response"


async def _merge_file_with_ai_async(
    task: ParallelMergeTask,
    semaphore: asyncio.Semaphore,
) -> ParallelMergeResult:
    """
    Merge a single file using AI.

    Args:
        task: The merge task with file contents
        semaphore: Semaphore for concurrency control

    Returns:
        ParallelMergeResult with merged content or error
    """
    async with semaphore:
        try:
            # First try simple 3-way merge
            success, merged = _try_simple_3way_merge(
                task.base_content,
                task.main_content,
                task.worktree_content,
            )

            if success and merged is not None:
                debug(MODULE, f"Auto-merged {task.file_path} without AI")
                return ParallelMergeResult(
                    file_path=task.file_path,
                    merged_content=merged,
                    success=True,
                    was_auto_merged=True,
                )

            # Need AI merge
            debug(MODULE, f"Using AI to merge {task.file_path}")

            # Import auth utilities
            from core.auth import ensure_claude_code_oauth_token, get_auth_token

            if not get_auth_token():
                return ParallelMergeResult(
                    file_path=task.file_path,
                    merged_content=None,
                    success=False,
                    error="No authentication token available",
                )

            ensure_claude_code_oauth_token()

            # Build prompt
            prompt = _build_merge_prompt(
                task.file_path,
                task.base_content,
                task.main_content,
                task.worktree_content,
                task.spec_name,
            )

            # Call Claude Haiku for fast merge first, then fallback to Sonnet if it fails
            # This two-tier approach matches the chat agent's success rate
            # - Tier 1: Haiku (fast, handles simple merges)
            # - Tier 2: Sonnet (more capable, handles complex merges)
            debug(MODULE, f"Attempting AI merge for {task.file_path} with Haiku (fast)")
            success, merged_content, error = await _attempt_ai_merge(
                task,
                prompt,
                model=MERGE_FAST_MODEL,
                max_thinking_tokens=MERGE_FAST_THINKING,
            )

            if success and merged_content:
                debug(MODULE, f"Haiku merged {task.file_path} successfully")
                return ParallelMergeResult(
                    file_path=task.file_path,
                    merged_content=merged_content,
                    success=True,
                    was_auto_merged=False,
                )

            # Haiku failed, retry with Sonnet (more capable model)
            debug_warning(
                MODULE,
                f"Haiku merge failed for {task.file_path}: {error}, retrying with Sonnet...",
            )
            print(muted(f"    Retrying {task.file_path} with more capable AI model..."))
            success, merged_content, error = await _attempt_ai_merge(
                task,
                prompt,
                model=MERGE_CAPABLE_MODEL,
                max_thinking_tokens=MERGE_COMPLEX_THINKING,
            )

            if success and merged_content:
                debug(MODULE, f"Sonnet merged {task.file_path} successfully")
                return ParallelMergeResult(
                    file_path=task.file_path,
                    merged_content=merged_content,
                    success=True,
                    was_auto_merged=False,
                )
            else:
                # Both models failed
                debug_error(
                    MODULE,
                    f"Both AI models failed to merge {task.file_path}: {error}",
                )
                return ParallelMergeResult(
                    file_path=task.file_path,
                    merged_content=None,
                    success=False,
                    error=f"AI merge failed: {error}",
                )

        except Exception as e:
            _merge_logger.error(f"Failed to merge {task.file_path}: {e}")
            return ParallelMergeResult(
                file_path=task.file_path,
                merged_content=None,
                success=False,
                error=str(e),
            )


async def _run_parallel_merges(
    tasks: list[ParallelMergeTask],
    project_dir: Path,
    max_concurrent: int = MAX_PARALLEL_AI_MERGES,
) -> list[ParallelMergeResult]:
    """
    Run file merges in parallel with concurrency control.

    Args:
        tasks: List of merge tasks to process
        project_dir: Project directory (for context, not currently used)
        max_concurrent: Maximum number of concurrent merge operations

    Returns:
        List of ParallelMergeResult for each task
    """
    if not tasks:
        return []

    debug(
        MODULE,
        f"Starting parallel merge of {len(tasks)} files (max concurrent: {max_concurrent})",
    )

    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(max_concurrent)

    # Create tasks
    merge_coroutines = [_merge_file_with_ai_async(task, semaphore) for task in tasks]

    # Run all merges concurrently
    results = await asyncio.gather(*merge_coroutines, return_exceptions=True)

    # Process results, converting exceptions to error results
    final_results: list[ParallelMergeResult] = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            final_results.append(
                ParallelMergeResult(
                    file_path=tasks[i].file_path,
                    merged_content=None,
                    success=False,
                    error=str(result),
                )
            )
        else:
            final_results.append(result)

    debug(
        MODULE,
        f"Parallel merge complete: {sum(1 for r in final_results if r.success)} succeeded, "
        f"{sum(1 for r in final_results if not r.success)} failed",
    )

    return final_results

#!/usr/bin/env python3
"""
Workspace Management Package
=============================

Handles workspace isolation through Git worktrees, where each spec
gets its own isolated worktree in .auto-claude/worktrees/tasks/{spec-name}/.

This package provides:
- Workspace setup and configuration
- Git operations and utilities
- Display and UI functions
- Finalization and user interaction
- Merge operations (imported from workspace.py via importlib)

Public API exported from sub-modules.
"""

import importlib.util
from pathlib import Path

# Import merge functions from workspace.py (which coexists with this package)
# We use importlib to explicitly load workspace.py since Python prefers the package
_workspace_file = Path(__file__).parent.parent / "workspace.py"
_spec = importlib.util.spec_from_file_location("workspace_module", _workspace_file)
_workspace_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_workspace_module)
merge_existing_build = _workspace_module.merge_existing_build
_run_parallel_merges = _workspace_module._run_parallel_merges
_resolve_git_conflicts_with_ai = _workspace_module._resolve_git_conflicts_with_ai
AI_MERGE_SYSTEM_PROMPT = _workspace_module.AI_MERGE_SYSTEM_PROMPT
_build_merge_prompt = _workspace_module._build_merge_prompt
_check_git_conflicts = _workspace_module._check_git_conflicts
_rebase_spec_branch = _workspace_module._rebase_spec_branch
_create_merge_progress_callback = _workspace_module._create_merge_progress_callback
_infer_language_from_path = _workspace_module._infer_language_from_path
_strip_code_fences = _workspace_module._strip_code_fences
_try_simple_3way_merge = _workspace_module._try_simple_3way_merge
_attempt_ai_merge = _workspace_module._attempt_ai_merge
_merge_file_with_ai_async = _workspace_module._merge_file_with_ai_async

# Models and Enums
# Display Functions
from .display import (
    _print_conflict_info,
    # Export private names for backward compatibility
    _print_merge_success,
    print_conflict_info,
    print_merge_success,
    show_build_summary,
    show_changed_files,
)

# Finalization Functions
from .finalization import (
    check_existing_build,
    cleanup_all_worktrees,
    discard_existing_build,
    finalize_workspace,
    handle_workspace_choice,
    list_all_worktrees,
    review_existing_build,
)

# Git Utilities
from .git_utils import (
    BINARY_EXTENSIONS,
    LOCK_FILES,
    # Constants
    MAX_FILE_LINES_FOR_AI,
    MAX_PARALLEL_AI_MERGES,
    MAX_SYNTAX_FIX_RETRIES,
    MERGE_LOCK_TIMEOUT,
    _create_conflict_file_with_git,
    _get_binary_file_content_from_ref,
    _get_changed_files_from_branch,
    _get_file_content_from_ref,
    _is_binary_file,
    _is_lock_file,
    # Export private names for backward compatibility
    _is_process_running,
    _validate_merged_syntax,
    apply_path_mapping,
    create_conflict_file_with_git,
    detect_file_renames,
    get_binary_file_content_from_ref,
    get_changed_files_from_branch,
    get_current_branch,
    get_existing_build_worktree,
    get_file_content_from_ref,
    has_uncommitted_changes,
    is_binary_file,
    is_lock_file,
    is_process_running,
    validate_merged_syntax,
)
from .models import (
    MergeLock,
    MergeLockError,
    ParallelMergeResult,
    ParallelMergeTask,
    SpecNumberLock,
    SpecNumberLockError,
    WorkspaceChoice,
    WorkspaceMode,
)

# Setup Functions
from .setup import (
    # Export private names for backward compatibility
    _ensure_timeline_hook_installed,
    _initialize_timeline_tracking,
    choose_workspace,
    copy_spec_to_worktree,
    ensure_timeline_hook_installed,
    initialize_timeline_tracking,
    setup_workspace,
)

__all__ = [
    # Merge Operations (from workspace.py)
    "merge_existing_build",
    # Note: Private functions (_run_parallel_merges, _resolve_git_conflicts_with_ai, etc.)
    # are kept as module-level assignments for internal use but not exported in __all__
    # to maintain the underscore convention for private/internal APIs
    # Models
    "WorkspaceMode",
    "WorkspaceChoice",
    "ParallelMergeTask",
    "ParallelMergeResult",
    "MergeLock",
    "MergeLockError",
    "SpecNumberLock",
    "SpecNumberLockError",
    # Git Utils
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
    "detect_file_renames",  # File rename detection
    "apply_path_mapping",  # Path mapping for renamed files
    # Setup
    "choose_workspace",
    "copy_spec_to_worktree",
    "setup_workspace",
    "ensure_timeline_hook_installed",
    "initialize_timeline_tracking",
    # Display
    "show_build_summary",
    "show_changed_files",
    "print_merge_success",
    "print_conflict_info",
    # Finalization
    "finalize_workspace",
    "handle_workspace_choice",
    "review_existing_build",
    "discard_existing_build",
    "check_existing_build",
    "list_all_worktrees",
    "cleanup_all_worktrees",
]

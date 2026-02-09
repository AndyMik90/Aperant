# Workspace Package

This package contains the refactored workspace management code, organized for better maintainability and code quality.

## Structure

The original `workspace.py` file (2,868 lines) has been refactored into a modular package:

```
workspace/
├── __init__.py          (130 lines) - Public API exports
├── models.py            (133 lines) - Data classes and enums
├── git_utils.py         (283 lines) - Git operations and utilities
├── setup.py             (357 lines) - Workspace setup and initialization
├── display.py           (136 lines) - UI display functions
├── finalization.py      (494 lines) - Post-build finalization and user interaction
└── README.md            - This file

workspace.py             (2,295 lines) - Complex merge operations (remaining)
```

**Total refactored code:** 1,533 lines across 6 modules
**Reduction in main file:** 573 lines (20% reduction)
**Original file:** 2,868 lines

## Modules

### models.py
Data structures and type definitions:
- `WorkspaceMode` - How ac-jerry should work (ISOLATED/DIRECT)
- `WorkspaceChoice` - User's choice after build (MERGE/REVIEW/TEST/LATER)
- `ParallelMergeTask` - Task for parallel file merging
- `ParallelMergeResult` - Result of parallel merge
- `MergeLock` - Context manager for merge locking
- `MergeLockError` - Exception for lock failures

### git_utils.py
Git operations and utilities:
- `has_uncommitted_changes()` - Check for unsaved work
- `get_current_branch()` - Get active branch name
- `get_existing_build_worktree()` - Check for existing spec worktree
- `get_file_content_from_ref()` - Get file from git ref
- `get_changed_files_from_branch()` - List changed files
- `is_process_running()` - Check if PID is active
- `is_binary_file()` - Check if file is binary
- `validate_merged_syntax()` - Validate merged code syntax
- `create_conflict_file_with_git()` - Create conflict markers with git

**Constants:**
- `MAX_FILE_LINES_FOR_AI` - Skip AI for large files (5000)
- `MAX_PARALLEL_AI_MERGES` - Concurrent merge limit (5)
- `BINARY_EXTENSIONS` - Set of binary file extensions
- `MERGE_LOCK_TIMEOUT` - Lock timeout in seconds (300)

### setup.py
Workspace setup and initialization:
- `choose_workspace()` - Let user choose workspace mode
- `copy_spec_to_worktree()` - Copy spec files to worktree
- `setup_workspace()` - Set up isolated or direct workspace
- `ensure_timeline_hook_installed()` - Install git post-commit hook
- `initialize_timeline_tracking()` - Register task for timeline tracking

### display.py
UI display functions:
- `show_build_summary()` - Show summary of build changes
- `show_changed_files()` - Show detailed file list
- `print_merge_success()` - Print success message after merge
- `print_conflict_info()` - Print conflict information

### finalization.py
Post-build finalization and user interaction:
- `finalize_workspace()` - Handle post-build workflow
- `handle_workspace_choice()` - Execute user's choice
- `review_existing_build()` - Show existing build contents
- `discard_existing_build()` - Delete build with confirmation
- `check_existing_build()` - Check for existing build and offer options
- `list_all_worktrees()` - List all spec worktrees
- `cleanup_all_worktrees()` - Clean up all worktrees

### workspace.py (parent module)
Complex merge operations that remain in the main file:
- `merge_existing_build()` - Merge existing build with intent-aware logic
- AI-assisted merge functions (async operations)
- Parallel merge orchestration
- Git conflict resolution
- Heuristic merge strategies

These functions are tightly coupled and reference each other extensively, making them
difficult to extract without significant refactoring of the merge system itself.

## Usage

### Import from workspace package
```python
from workspace import (
    WorkspaceMode,
    WorkspaceChoice,
    setup_workspace,
    finalize_workspace,
    # ... other functions
)
```

### Import specific modules
```python
from workspace.models import WorkspaceMode, MergeLock
from workspace.git_utils import has_uncommitted_changes
from workspace.setup import choose_workspace
from workspace.display import show_build_summary
from workspace.finalization import review_existing_build
```

### Import merge operations from parent
```python
# merge_existing_build is in the parent workspace.py module
import workspace
workspace.merge_existing_build(project_dir, spec_name)
```

## Backward Compatibility

All existing imports continue to work:
```python
# Old style - still works
from workspace import WorkspaceMode, setup_workspace, finalize_workspace

# The refactoring maintains full backward compatibility
```

## Benefits

1. **Improved Maintainability**: Each module has a clear, focused responsibility
2. **Better Code Navigation**: Easier to find and understand specific functionality
3. **Reduced Complexity**: Smaller files are easier to review and modify
4. **Clear Separation**: Models, utilities, setup, display, and finalization are distinct
5. **Backward Compatible**: No changes needed to existing code that imports from workspace
6. **Type Safety**: Clear type hints throughout all modules

## Testing

Run the import test:
```bash
cd ac-jerry
python3 -c "from workspace import WorkspaceMode, setup_workspace; print('✓ Imports work')"
```

All functions are tested for import compatibility with existing CLI commands.

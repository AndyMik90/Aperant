"""
Git Hook Installer for FileTimelineTracker
==========================================

Installs the post-commit hook for tracking main branch commits.

Usage:
    python -m auto_claude.merge.install_hook [--project-path /path/to/project]
"""

import argparse
import shutil
import stat
import sys
from pathlib import Path

HOOK_SCRIPT = """#!/bin/bash
#
# Git post-commit hook for FileTimelineTracker
# =============================================
#
# This hook notifies the FileTimelineTracker when human commits
# are made to the main branch, enabling drift tracking.
#

COMMIT_HASH=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Only track commits to main/master branch
# Skip if we're in a worktree (auto-claude branches)
if [[ "$BRANCH" == "main" ]] || [[ "$BRANCH" == "master" ]]; then
    # Check if this is the main working directory (not a worktree)
    # Worktrees have a .git file pointing to the main repo, not a .git directory
    if [[ -d ".git" ]]; then
        # Find python executable
        if command -v python3 &> /dev/null; then
            PYTHON=python3
        elif command -v python &> /dev/null; then
            PYTHON=python
        else
            # Python not found, skip silently
            exit 0
        fi

        # Try to notify the tracker
        # Run in background to avoid slowing down commits
        ($PYTHON -m auto_claude.merge.tracker_cli notify-commit "$COMMIT_HASH" 2>/dev/null &) &

        # Don't let hook failures block commits
        exit 0
    fi
fi

# Not main branch or in worktree, do nothing
exit 0
"""


def find_project_root() -> Path:
    """Find the project root by looking for .git directory."""
    current = Path.cwd()

    while current != current.parent:
        if (current / ".git").exists():
            return current
        current = current.parent

    return Path.cwd()


def install_hook(project_path: Path) -> bool:
    """Install the post-commit hook to a project."""
    git_dir = project_path / ".git"

    # Handle worktrees (where .git is a file, not directory)
    if git_dir.is_file():
        # Read the gitdir from the file
        content = git_dir.read_text(encoding="utf-8").strip()
        if content.startswith("gitdir:"):
            git_dir = Path(content.split(":", 1)[1].strip())
        else:
            print(f"Error: Cannot parse .git file at {git_dir}")
            return False

    if not git_dir.is_dir():
        print(f"Error: No .git directory found at {project_path}")
        return False

    hooks_dir = git_dir / "hooks"
    hooks_dir.mkdir(exist_ok=True)

    hook_path = hooks_dir / "post-commit"

    # Check if hook already exists
    if hook_path.exists():
        existing = hook_path.read_text(encoding="utf-8")
        if "FileTimelineTracker" in existing:
            print(f"Hook already installed at {hook_path}")
            return True

        # Backup existing hook
        backup_path = hooks_dir / "post-commit.backup"
        shutil.copy(hook_path, backup_path)
        print(f"Backed up existing hook to {backup_path}")

        # Append our hook to existing
        with open(hook_path, "a", encoding="utf-8") as f:
            f.write("\n\n# FileTimelineTracker integration\n")
            f.write(HOOK_SCRIPT.split("#!/bin/bash", 1)[1])  # Skip shebang
        print(f"Appended FileTimelineTracker hook to {hook_path}")
    else:
        # Write new hook
        hook_path.write_text(HOOK_SCRIPT, encoding="utf-8")
        print(f"Created new hook at {hook_path}")

    # Make executable
    hook_path.chmod(
        hook_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
    )
    print("Hook is now executable")

    return True


def uninstall_hook(project_path: Path) -> bool:
    """Remove the post-commit hook from a project."""
    git_dir = project_path / ".git"

    if git_dir.is_file():
        content = git_dir.read_text(encoding="utf-8").strip()
        if content.startswith("gitdir:"):
            git_dir = Path(content.split(":", 1)[1].strip())

    hook_path = git_dir / "hooks" / "post-commit"

    if not hook_path.exists():
        print("No hook to uninstall")
        return True

    content = hook_path.read_text(encoding="utf-8")
    if "FileTimelineTracker" not in content:
        print("Hook does not contain FileTimelineTracker integration")
        return True

    # Check if we can restore from backup
    backup_path = git_dir / "hooks" / "post-commit.backup"
    if backup_path.exists():
        shutil.move(backup_path, hook_path)
        print("Restored original hook from backup")
    else:
        # Remove the hook entirely
        hook_path.unlink()
        print(f"Removed hook at {hook_path}")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Install/uninstall FileTimelineTracker git hook"
    )
    parser.add_argument(
        "--project-path",
        type=Path,
        help="Path to project (default: current directory)",
    )
    parser.add_argument(
        "--uninstall",
        action="store_true",
        help="Uninstall the hook",
    )

    args = parser.parse_args()

    project_path = args.project_path or find_project_root()

    if args.uninstall:
        success = uninstall_hook(project_path)
    else:
        success = install_hook(project_path)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

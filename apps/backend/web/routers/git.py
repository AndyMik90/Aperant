"""
Git Router
==========

API endpoints for Git operations.
"""

import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


from ..utils.security import get_secure_logger

router = APIRouter()
logger = get_secure_logger("auto-claude-api")


def run_git_command(
    args: list[str], cwd: str, timeout: int = 30
) -> tuple[bool, str, str]:
    """Run a git command and return success, stdout, stderr."""
    try:
        result = subprocess.run(
            ["git"] + args, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", "Git command timed out"
    except OSError:
        return False, "", "Git is not installed"
    except Exception as e:
        return False, "", str(e)


@router.get("/git/branches")
async def get_git_branches(path: str) -> dict:
    """Get list of branches for a repository."""
    if not path:
        return {"success": False, "error": "Path is required"}

    project_path = Path(path)
    if not project_path.exists():
        return {"success": False, "error": "Path does not exist"}

    # Fetch from remote to get latest branches
    fetch_success, _, fetch_err = run_git_command(
        ["fetch", "--all", "--prune"],
        str(project_path),
        timeout=60,  # Longer timeout for fetch
    )
    if not fetch_success:
        logger.warning(f"Git fetch failed: {fetch_err}")
        # Continue anyway - we'll still show local branches

    # Get all branches including remotes
    success, stdout, stderr = run_git_command(
        ["branch", "--all", "--format=%(refname:short)"], str(project_path)
    )

    if not success:
        return {"success": False, "error": stderr or "Failed to list branches"}

    branches = []
    seen = set()
    for b in stdout.split("\n"):
        b = b.strip()
        if not b:
            continue
        # Remove 'origin/' prefix for remote branches
        if b.startswith("remotes/origin/"):
            b = b.replace("remotes/origin/", "")
        # Skip HEAD pointer
        if "HEAD" in b:
            continue
        # Deduplicate
        if b not in seen:
            seen.add(b)
            branches.append(b)

    return {"success": True, "data": branches}


@router.get("/git/current-branch")
async def get_current_git_branch(path: str) -> dict:
    """Get the current branch name."""
    if not path:
        return {"success": False, "error": "Path is required"}

    project_path = Path(path)
    if not project_path.exists():
        return {"success": False, "error": "Path does not exist"}

    success, stdout, stderr = run_git_command(
        ["rev-parse", "--abbrev-ref", "HEAD"], str(project_path)
    )

    if not success:
        return {"success": False, "error": stderr or "Failed to get current branch"}

    return {"success": True, "data": stdout.strip() or None}


@router.get("/git/detect-main-branch")
async def detect_main_branch(path: str) -> dict:
    """Detect the main branch (main, master, etc.)."""
    if not path:
        return {"success": False, "error": "Path is required"}

    project_path = Path(path)
    if not project_path.exists():
        return {"success": False, "error": "Path does not exist"}

    # Common main branch names to check
    main_candidates = ["main", "master", "develop", "development"]

    # Get all local branches
    success, stdout, stderr = run_git_command(
        ["branch", "--list", "--format=%(refname:short)"], str(project_path)
    )

    if not success:
        return {"success": False, "error": stderr or "Failed to list branches"}

    branches = set(b.strip() for b in stdout.split("\n") if b.strip())

    # Find the first matching candidate
    for candidate in main_candidates:
        if candidate in branches:
            return {"success": True, "data": candidate}

    # Fallback: try to get default branch from remote
    success, stdout, stderr = run_git_command(
        ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], str(project_path)
    )

    if success and stdout:
        # Extract branch name from origin/main format
        branch = stdout.replace("origin/", "").strip()
        return {"success": True, "data": branch}

    # Last resort: return first branch if any
    if branches:
        return {"success": True, "data": list(branches)[0]}

    return {"success": True, "data": None}


@router.get("/git/status")
async def check_git_status(path: str) -> dict:
    """Check git status of a repository."""
    if not path:
        return {"success": False, "error": "Path is required"}

    project_path = Path(path)
    if not project_path.exists():
        return {"success": False, "error": "Path does not exist"}

    # Check if it's a git repo
    git_dir = project_path / ".git"
    is_git_repo = git_dir.exists()

    if not is_git_repo:
        return {
            "success": True,
            "data": {
                "isGitRepo": False,
                "hasCommits": False,
                "branch": None,
                "isDirty": False,
                "untrackedFiles": 0,
                "modifiedFiles": 0,
                "stagedFiles": 0,
                "aheadBy": 0,
                "behindBy": 0,
            },
        }

    # Get current branch
    success, branch, _ = run_git_command(
        ["rev-parse", "--abbrev-ref", "HEAD"], str(project_path)
    )
    current_branch = branch.strip() if success else None

    # Check if there are commits
    success, _, _ = run_git_command(["rev-parse", "HEAD"], str(project_path))
    has_commits = success

    # Get status --porcelain for file counts
    success, status_output, _ = run_git_command(
        ["status", "--porcelain"], str(project_path)
    )

    untracked = 0
    modified = 0
    staged = 0

    if success and status_output:
        for line in status_output.split("\n"):
            if not line:
                continue
            status = line[:2]
            if status.startswith("??"):
                untracked += 1
            elif status[0] in "MADRCU":
                staged += 1
            elif status[1] in "MADRCU":
                modified += 1

    is_dirty = (untracked + modified + staged) > 0

    # Get ahead/behind counts
    ahead_by = 0
    behind_by = 0

    if has_commits and current_branch:
        # Try to get upstream tracking info
        success, ahead_behind, _ = run_git_command(
            ["rev-list", "--left-right", "--count", "HEAD...@{u}"], str(project_path)
        )
        if success and ahead_behind:
            parts = ahead_behind.split()
            if len(parts) == 2:
                ahead_by = int(parts[0])
                behind_by = int(parts[1])

    return {
        "success": True,
        "data": {
            "isGitRepo": True,
            "hasCommits": has_commits,
            "branch": current_branch,
            "isDirty": is_dirty,
            "untrackedFiles": untracked,
            "modifiedFiles": modified,
            "stagedFiles": staged,
            "aheadBy": ahead_by,
            "behindBy": behind_by,
        },
    }


class GitInitRequest(BaseModel):
    """Request model for initializing git."""

    path: str


@router.post("/git/init")
async def initialize_git(request: GitInitRequest) -> dict:
    """Initialize a git repository."""
    if not request.path:
        return {"success": False, "error": "Path is required"}

    project_path = Path(request.path)
    if not project_path.exists():
        return {"success": False, "error": "Path does not exist"}

    # Check if already a git repo
    git_dir = project_path / ".git"
    if git_dir.exists():
        return {
            "success": True,
            "data": {"initialized": True, "message": "Already a git repository"},
        }

    # Initialize git
    success, stdout, stderr = run_git_command(["init"], str(project_path))

    if not success:
        return {"success": False, "error": stderr or "Failed to initialize git"}

    # Create initial commit if no files exist
    gitkeep = project_path / ".gitkeep"
    if not any(project_path.iterdir()):
        gitkeep.touch()

    # Stage all files
    run_git_command(["add", "."], str(project_path))

    # Create initial commit
    success, _, stderr = run_git_command(
        ["commit", "-m", "Initial commit"], str(project_path)
    )

    return {
        "success": True,
        "data": {
            "initialized": True,
            "message": "Git repository initialized successfully",
        },
    }

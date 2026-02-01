"""
Projects Router
===============

API endpoints for managing projects.
"""

import json
import os
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


from ..utils.security import get_secure_logger

router = APIRouter()
logger = get_secure_logger("auto-claude-api")


class ProjectCreate(BaseModel):
    """Request model for creating a project."""

    name: str = Field(..., min_length=1, description="Project name")
    path: str = Field(
        ..., min_length=1, description="Absolute path to project directory"
    )


class ProjectResponse(BaseModel):
    """Response model for a project."""

    id: str
    name: str
    path: str
    created_at: str
    specs_count: int = 0
    last_accessed: str | None = None
    autoBuildPath: str | None = None


class ProjectListResponse(BaseModel):
    """Response model for listing projects."""

    projects: list[ProjectResponse]
    total: int


def get_projects_file() -> Path:
    """Get the path to the projects registry file."""
    config_dir = Path.home() / ".auto-claude"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "projects.json"


def load_projects() -> list[dict]:
    """Load projects from the registry file."""
    projects_file = get_projects_file()
    if not projects_file.exists():
        return []
    try:
        with open(projects_file) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def save_projects(projects: list[dict]) -> None:
    """Save projects to the registry file."""
    projects_file = get_projects_file()
    with open(projects_file, "w") as f:
        json.dump(projects, f, indent=2)


def count_specs(project_path: str) -> int:
    """Count the number of specs in a project."""
    specs_dir = Path(project_path) / ".auto-claude" / "specs"
    if not specs_dir.exists():
        return 0
    return len([d for d in specs_dir.iterdir() if d.is_dir()])


def ensure_git_has_commits(project_path: Path) -> dict:
    """
    Ensure a git repository has at least one commit.

    This is required for worktree operations which need a valid HEAD.

    Returns:
        dict with keys: is_git_repo, had_commits, created_commit, error
    """
    result = {
        "is_git_repo": False,
        "had_commits": False,
        "created_commit": False,
        "error": None,
    }

    # Check if it's a git repo
    git_dir = project_path / ".git"
    if not git_dir.exists():
        result["error"] = "Not a git repository"
        return result

    result["is_git_repo"] = True

    # Check if HEAD exists (has commits)
    try:
        check_head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_path,
            capture_output=True,
            text=True,
            timeout=10,
        )

        if check_head.returncode == 0:
            result["had_commits"] = True
            return result

        # No commits - create initial commit
        logger.info(
            f"Git repo at {project_path} has no commits, creating initial commit..."
        )

        # Create .gitignore if it doesn't exist
        gitignore = project_path / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text(".auto-claude/\n")

        # Add all files
        subprocess.run(
            ["git", "add", "-A"],
            cwd=project_path,
            capture_output=True,
            timeout=30,
        )

        # Create initial commit
        commit_result = subprocess.run(
            ["git", "commit", "--allow-empty", "-m", "Initial commit"],
            cwd=project_path,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if commit_result.returncode == 0:
            result["created_commit"] = True
            logger.info(f"Created initial commit in {project_path}")
        else:
            result["error"] = f"Failed to create commit: {commit_result.stderr}"
            logger.error(f"Failed to create initial commit: {commit_result.stderr}")

    except subprocess.TimeoutExpired:
        result["error"] = "Git command timed out"
    except Exception as e:
        result["error"] = str(e)

    return result


@router.get("")
async def list_projects() -> dict:
    """List all registered projects."""
    projects = load_projects()

    project_responses = []
    for p in projects:
        project_path = p.get("path", "")
        specs_count = count_specs(project_path) if os.path.isdir(project_path) else 0

        # Check if project is initialized (has .auto-claude directory)
        auto_claude_path = Path(project_path) / ".auto-claude" if project_path else None
        auto_build_path = (
            ".auto-claude"
            if (auto_claude_path and auto_claude_path.exists())
            else p.get("autoBuildPath")
        )

        project_responses.append(
            {
                "id": p.get("id", ""),
                "name": p.get("name", ""),
                "path": project_path,
                "created_at": p.get("created_at", ""),
                "specs_count": specs_count,
                "last_accessed": p.get("last_accessed"),
                "autoBuildPath": auto_build_path,
            }
        )

    return {"success": True, "data": project_responses}


@router.post("", response_model=ProjectResponse, status_code=201)
async def add_project(project: ProjectCreate) -> ProjectResponse:
    """Add a new project to the registry."""
    project_path = Path(project.path)

    if not project_path.exists():
        raise HTTPException(
            status_code=400, detail=f"Project path does not exist: {project.path}"
        )

    if not project_path.is_dir():
        raise HTTPException(
            status_code=400, detail=f"Project path is not a directory: {project.path}"
        )

    projects = load_projects()

    for p in projects:
        if p.get("path") == project.path:
            raise HTTPException(status_code=409, detail="Project already registered")

    # Ensure git repository has at least one commit (required for worktrees)
    git_result = ensure_git_has_commits(project_path)
    if git_result["is_git_repo"]:
        if git_result["created_commit"]:
            logger.info(f"Created initial commit for project: {project.path}")
        elif git_result["error"]:
            logger.warning(
                f"Git check warning for {project.path}: {git_result['error']}"
            )
    else:
        logger.info(f"Project {project.path} is not a git repository")

    project_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()

    # Check if project already has .auto-claude initialized
    auto_claude_path = project_path / ".auto-claude"
    auto_build_path = ".auto-claude" if auto_claude_path.exists() else None

    new_project = {
        "id": project_id,
        "name": project.name,
        "path": project.path,
        "created_at": created_at,
        "last_accessed": created_at,
        "autoBuildPath": auto_build_path,
    }

    projects.append(new_project)
    save_projects(projects)

    return ProjectResponse(
        id=project_id,
        name=project.name,
        path=project.path,
        created_at=created_at,
        specs_count=count_specs(project.path),
        last_accessed=created_at,
        autoBuildPath=auto_build_path,
    )


class CreateFolderRequest(BaseModel):
    """Request model for creating a project folder."""

    location: str = Field(..., description="Parent directory path")
    name: str = Field(..., min_length=1, description="Folder name")
    initGit: bool = Field(default=True, description="Initialize git repository")


@router.post("/create-folder")
async def create_project_folder(request: CreateFolderRequest) -> dict:
    """Create a new project folder and optionally initialize git.

    Creates:
    - The project folder at location/name
    - Optionally initializes a git repository
    - Creates an initial commit if git is initialized

    Returns the path to the created folder.
    """
    import subprocess

    location = Path(request.location)

    # Validate location exists
    if not location.exists():
        return {
            "success": False,
            "error": f"Location does not exist: {request.location}",
        }

    if not location.is_dir():
        return {
            "success": False,
            "error": f"Location is not a directory: {request.location}",
        }

    # Create project folder
    project_path = location / request.name

    if project_path.exists():
        return {"success": False, "error": f"Folder already exists: {project_path}"}

    try:
        # Create the folder
        project_path.mkdir(parents=True, exist_ok=False)

        git_initialized = False

        if request.initGit:
            # Initialize git repository
            result = subprocess.run(
                ["git", "init"],
                cwd=project_path,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode == 0:
                # Create a .gitkeep file so we have something to commit
                gitkeep = project_path / ".gitkeep"
                gitkeep.touch()

                # Stage and commit
                subprocess.run(
                    ["git", "add", "."],
                    cwd=project_path,
                    capture_output=True,
                    timeout=30,
                )

                subprocess.run(
                    ["git", "commit", "-m", "Initial commit"],
                    cwd=project_path,
                    capture_output=True,
                    timeout=30,
                )

                git_initialized = True

        return {
            "success": True,
            "data": {
                "path": str(project_path),
                "name": request.name,
                "gitInitialized": git_initialized,
            },
        }

    except OSError:
        return {
            "success": False,
            "error": f"Permission denied: Cannot create folder at {project_path}",
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Git initialization timed out"}
    except Exception as e:
        # Clean up if folder was created but something failed
        if project_path.exists():
            try:
                import shutil

                shutil.rmtree(project_path)
            except Exception:
                pass
        return {"success": False, "error": str(e)}


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str) -> ProjectResponse:
    """Get details of a specific project."""
    projects = load_projects()

    for p in projects:
        if p.get("id") == project_id:
            p["last_accessed"] = datetime.utcnow().isoformat()
            save_projects(projects)

            # Check if project is initialized
            project_path = Path(p.get("path", ""))
            auto_claude_path = project_path / ".auto-claude"
            auto_build_path = (
                ".auto-claude" if auto_claude_path.exists() else p.get("autoBuildPath")
            )

            return ProjectResponse(
                id=p.get("id", ""),
                name=p.get("name", ""),
                path=p.get("path", ""),
                created_at=p.get("created_at", ""),
                specs_count=count_specs(p.get("path", "")),
                last_accessed=p.get("last_accessed"),
                autoBuildPath=auto_build_path,
            )

    raise HTTPException(status_code=404, detail="Project not found")


@router.delete("/{project_id}", status_code=204)
async def remove_project(project_id: str):
    """Remove a project from the registry (does not delete files)."""
    projects = load_projects()
    original_count = len(projects)

    projects = [p for p in projects if p.get("id") != project_id]

    if len(projects) == original_count:
        raise HTTPException(status_code=404, detail="Project not found")

    save_projects(projects)
    return None


# Directories to create inside .auto-claude
DATA_DIRECTORIES = ["specs", "ideation", "insights", "roadmap"]

# Entries to add to .gitignore
GITIGNORE_ENTRIES = [".auto-claude/"]


def ensure_gitignore_entries(project_path: Path, entries: list[str]) -> None:
    """Ensure entries exist in .gitignore file."""
    gitignore_path = project_path / ".gitignore"

    existing_content = ""
    if gitignore_path.exists():
        existing_content = gitignore_path.read_text()

    lines_to_add = []
    for entry in entries:
        if entry not in existing_content:
            lines_to_add.append(entry)

    if lines_to_add:
        with open(gitignore_path, "a") as f:
            if existing_content and not existing_content.endswith("\n"):
                f.write("\n")
            f.write("\n# Auto Claude\n")
            for line in lines_to_add:
                f.write(f"{line}\n")


def check_git_status(project_path: Path) -> dict:
    """Check if project is a git repo with at least one commit."""
    import subprocess

    git_dir = project_path / ".git"
    if not git_dir.exists():
        return {
            "isGitRepo": False,
            "hasCommits": False,
            "error": "Not a git repository. Auto Claude requires git for worktree-based builds.",
        }

    try:
        # Check if there are any commits
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_path,
            capture_output=True,
            text=True,
        )
        has_commits = result.returncode == 0

        return {
            "isGitRepo": True,
            "hasCommits": has_commits,
            "error": None
            if has_commits
            else "No commits found. Please make at least one commit before initializing.",
        }
    except Exception as e:
        return {"isGitRepo": True, "hasCommits": False, "error": str(e)}


@router.post("/{project_id}/initialize")
async def initialize_project(project_id: str) -> dict:
    """Initialize Auto Claude for a project.

    Creates the .auto-claude directory structure and updates .gitignore.
    Requires the project to be a git repository with at least one commit.
    """
    projects = load_projects()

    project = None
    for p in projects:
        if p.get("id") == project_id:
            project = p
            break

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_path = Path(project.get("path", ""))

    if not project_path.exists():
        return {
            "success": False,
            "error": f"Project directory not found: {project_path}",
        }

    # Check git status
    git_status = check_git_status(project_path)
    if not git_status["isGitRepo"] or not git_status["hasCommits"]:
        return {
            "success": False,
            "error": git_status.get(
                "error", "Git repository with at least one commit is required."
            ),
        }

    # Check if already initialized
    auto_claude_path = project_path / ".auto-claude"

    if auto_claude_path.exists():
        # Already initialized - this is fine, just update the project
        project["autoBuildPath"] = ".auto-claude"
        save_projects(projects)
        return {
            "success": True,
            "data": {
                "message": "Project already initialized",
                "autoBuildPath": ".auto-claude",
            },
        }

    try:
        # Create .auto-claude directory
        auto_claude_path.mkdir(parents=True, exist_ok=True)

        # Create data directories
        for data_dir in DATA_DIRECTORIES:
            dir_path = auto_claude_path / data_dir
            dir_path.mkdir(parents=True, exist_ok=True)
            (dir_path / ".gitkeep").touch()

        # Update .gitignore
        ensure_gitignore_entries(project_path, GITIGNORE_ENTRIES)

        # Update project with autoBuildPath
        project["autoBuildPath"] = ".auto-claude"
        save_projects(projects)

        return {
            "success": True,
            "data": {
                "message": "Project initialized successfully",
                "autoBuildPath": ".auto-claude",
            },
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/{project_id}/version")
async def check_project_version(project_id: str) -> dict:
    """Check the Auto Claude version for a project.

    Returns version info for the project's .auto-claude installation.
    """
    projects = load_projects()

    for p in projects:
        if p.get("id") == project_id:
            project_path = Path(p.get("path", ""))
            auto_claude_path = project_path / ".auto-claude"

            if not auto_claude_path.exists():
                return {
                    "success": True,
                    "data": {"initialized": False, "version": None},
                }

            return {
                "success": True,
                "data": {
                    "initialized": True,
                    "version": "1.0.0",  # Current version
                    "autoBuildPath": ".auto-claude",
                },
            }

    raise HTTPException(status_code=404, detail="Project not found")


class ProjectEnvConfig(BaseModel):
    """Project environment configuration."""

    # Claude Authentication
    claudeOAuthToken: str | None = None
    claudeAuthStatus: str = "not_configured"  # authenticated, token_set, not_configured
    claudeTokenIsGlobal: bool = True

    # Model Override
    autoBuildModel: str | None = None

    # Linear Integration
    linearEnabled: bool = False
    linearApiKey: str | None = None
    linearTeamId: str | None = None
    linearProjectId: str | None = None
    linearRealtimeSync: bool = False

    # GitHub Integration
    githubEnabled: bool = False
    githubToken: str | None = None
    githubRepo: str | None = None
    githubAutoSync: bool = False
    githubAuthMethod: str | None = None

    # GitLab Integration
    gitlabEnabled: bool = False
    gitlabInstanceUrl: str = "https://gitlab.com"
    gitlabToken: str | None = None
    gitlabProject: str | None = None
    gitlabAutoSync: bool = False

    # Azure DevOps Integration
    azureDevOpsEnabled: bool = False
    azureDevOpsOrganizationUrl: str | None = None
    azureDevOpsProject: str | None = None
    azureDevOpsTeam: str | None = None
    azureDevOpsPersonalAccessToken: str | None = None

    # Git/Worktree Settings
    defaultBranch: str | None = None

    # Graphiti Memory Integration
    graphitiEnabled: bool = True
    openaiApiKey: str | None = None
    openaiKeyIsGlobal: bool = True


def get_project_env_file(project_path: Path) -> Path:
    """Get the path to the project's env config file."""
    return project_path / ".auto-claude" / "env.json"


def load_project_env(project_path: Path) -> dict:
    """Load project environment config from file."""
    env_file = get_project_env_file(project_path)
    if not env_file.exists():
        return {}
    try:
        with open(env_file) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_project_env(project_path: Path, env_config: dict) -> None:
    """Save project environment config to file."""
    env_file = get_project_env_file(project_path)
    env_file.parent.mkdir(parents=True, exist_ok=True)
    with open(env_file, "w") as f:
        json.dump(env_config, f, indent=2)


@router.get("/{project_id}/env")
async def get_project_env(project_id: str) -> dict:
    """Get project environment configuration.

    Returns integration settings (Claude, Linear, GitHub, Graphiti, etc.)
    """
    projects = load_projects()

    for p in projects:
        if p.get("id") == project_id:
            project_path = Path(p.get("path", ""))

            if not project_path.exists():
                return {"success": False, "error": "Project path not found"}

            # Load saved env config
            saved_config = load_project_env(project_path)

            # Build response with defaults
            config = ProjectEnvConfig(**saved_config)

            # Check Claude auth status from backend .env
            backend_env = _PARENT_DIR / ".env"
            if backend_env.exists():
                try:
                    content = backend_env.read_text()
                    if "CLAUDE_CODE_OAUTH_TOKEN=" in content:
                        config.claudeAuthStatus = "token_set"
                        config.claudeTokenIsGlobal = True
                except Exception:
                    pass

            return {"success": True, "data": config.model_dump()}

    raise HTTPException(status_code=404, detail="Project not found")


@router.patch("/{project_id}/env")
async def update_project_env(project_id: str, updates: dict) -> dict:
    """Update project environment configuration."""
    projects = load_projects()

    for p in projects:
        if p.get("id") == project_id:
            project_path = Path(p.get("path", ""))

            if not project_path.exists():
                return {"success": False, "error": "Project path not found"}

            # Load existing config
            existing = load_project_env(project_path)

            # Merge updates
            existing.update(updates)

            # Save
            save_project_env(project_path, existing)

            return {"success": True, "data": existing}

    raise HTTPException(status_code=404, detail="Project not found")


@router.patch("/{project_id}/settings")
async def update_project_settings(project_id: str, settings_updates: dict) -> dict:
    """Update settings for a specific project."""
    projects = load_projects()

    for p in projects:
        if p.get("id") == project_id:
            # Update settings in project dict
            if "settings" not in p:
                p["settings"] = {}

            p["settings"].update(settings_updates)

            # Save updated projects list
            save_projects(projects)

            return {"success": True, "data": p["settings"]}

    raise HTTPException(status_code=404, detail="Project not found")

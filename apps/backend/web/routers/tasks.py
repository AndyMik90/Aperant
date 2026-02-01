"""
Tasks Router
============

API endpoints for managing tasks (specs) within projects.
"""

import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys
from collections.abc import AsyncGenerator
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from cli.spec_commands import list_specs
from cli.utils import find_spec, get_specs_dir
from core.worktree import WorktreeManager
from progress import count_subtasks
from workspace import get_existing_build_worktree

from ..utils.logging_utils import (
    dump_diagnostic_info,
    log_file_operation,
    log_path_check,
    log_task_lifecycle,
)
from ..utils.plan_helpers import (
    load_plan_from_spec,
    load_task_logs_from_spec,
)
from ..utils.security import get_secure_logger
from .projects import load_projects

router = APIRouter()
logger = get_secure_logger("auto-claude-api")

# Track running task PIDs (not process objects - tasks run detached)
# Maps task_id -> {"pid": int, "started_at": str, "log_file": str}
running_tasks: dict[str, dict[str, Any]] = {}

# File to persist running task state (survives server restart)
RUNNING_TASKS_FILE = (
    Path(__file__).parent.parent.parent / ".auto-claude" / "running_tasks.json"
)


def _load_running_tasks() -> dict[str, dict[str, Any]]:
    """Load persisted running tasks state."""
    if RUNNING_TASKS_FILE.exists():
        try:
            with open(RUNNING_TASKS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_running_tasks():
    """Persist running tasks state."""
    RUNNING_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(RUNNING_TASKS_FILE, "w") as f:
        json.dump(running_tasks, f, indent=2)


def _is_process_running(pid: int) -> bool:
    """Check if a process with given PID is still running."""
    try:
        os.kill(pid, 0)  # Signal 0 just checks if process exists
        return True
    except (OSError, ProcessLookupError):
        return False


def _cleanup_finished_tasks():
    """Remove tasks whose processes have finished."""
    global running_tasks
    finished = []
    for task_id, info in running_tasks.items():
        if not _is_process_running(info["pid"]):
            finished.append(task_id)
    for task_id in finished:
        del running_tasks[task_id]
    if finished:
        _save_running_tasks()


# Load persisted state on module import
running_tasks = _load_running_tasks()
_cleanup_finished_tasks()


class TaskCreate(BaseModel):
    """Request model for creating a task."""

    title: str | None = Field(default=None, description="Task title")
    description: str = Field(..., min_length=1, description="Task description")
    complexity: str | None = Field(
        default=None, description="Complexity: simple, standard, or complex"
    )
    metadata: dict[str, Any] | None = Field(
        default=None, description="Additional metadata"
    )


class TaskResponse(BaseModel):
    """Response model for a task."""

    id: str
    name: str
    folder: str
    status: str
    progress: str
    has_build: bool
    project_id: str
    created_at: str | None = None
    spec_content: str | None = None


class TaskListResponse(BaseModel):
    """Response model for listing tasks."""

    tasks: list[TaskResponse]
    total: int


class TaskStartRequest(BaseModel):
    """Request model for starting a task."""

    auto_continue: bool = Field(
        default=True, description="Auto-continue existing builds"
    )
    skip_qa: bool = Field(default=False, description="Skip QA validation")
    model: str | None = Field(default=None, description="Model to use")


class TaskLogsResponse(BaseModel):
    """Response model for task logs."""

    task_id: str
    logs: list[str]
    is_running: bool


def get_project_path(project_id: str) -> Path:
    """Get project path from project ID."""
    projects = load_projects()
    for p in projects:
        if p.get("id") == project_id:
            return Path(p.get("path", ""))
    raise HTTPException(status_code=404, detail="Project not found")


def get_task_id(project_id: str, folder: str) -> str:
    """Generate a unique task ID from project and folder."""
    return f"{project_id}:{folder}"


def parse_task_id(task_id: str) -> tuple[str, str]:
    """Parse task ID into project_id and folder."""
    parts = task_id.split(":", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid task ID format")
    return parts[0], parts[1]


@router.get("/projects/{project_id}/tasks")
async def list_tasks(project_id: str) -> dict:
    """List all tasks (specs) for a project."""
    func_name = "list_tasks"
    timestamp = datetime.utcnow().isoformat()

    logger.info(f"📋 [{func_name}] START at {timestamp} for project_id={project_id}")

    project_path = get_project_path(project_id)
    log_path_check(func_name, project_path, project_path.exists(), "project_path")

    if not project_path.exists():
        logger.info(
            f"📋 [{func_name}] Project path does not exist, returning empty list"
        )
        return {"success": True, "data": []}

    try:
        specs = list_specs(project_path)
        logger.info(f"📋 [{func_name}] Found {len(specs)} specs")
    except Exception as e:
        logger.error(f"📋 [{func_name}] Error listing specs: {e}", exc_info=True)
        # No specs directory or other error
        return {"success": True, "data": []}

    tasks = []
    for spec in specs:
        task_id = get_task_id(project_id, spec["folder"])
        spec_file = spec["path"] / "spec.md"

        logger.debug(f"📋 [{func_name}] Processing spec: {spec['folder']}")

        # Read description from spec.md
        description = ""
        if spec_file.exists():
            try:
                content = spec_file.read_text()
                # Extract description section
                if "## Description" in content:
                    desc_start = content.find("## Description")
                    desc_content = content[desc_start + len("## Description") :].strip()
                    # Find next section or end
                    next_section = desc_content.find("\n##")
                    if next_section > 0:
                        description = desc_content[:next_section].strip()
                    else:
                        description = desc_content.strip()
            except Exception:
                pass

        created_at = None
        updated_at = None
        if spec_file.exists():
            stat = spec_file.stat()
            created_at = datetime.fromtimestamp(stat.st_mtime).isoformat()
            updated_at = created_at

        # Check if task is currently running
        is_running = False
        if task_id in running_tasks:
            is_running = _is_process_running(running_tasks[task_id]["pid"])
            if not is_running:
                # Clean up stale entry
                logger.info(f"📋 [{func_name}] Cleaning stale task entry: {task_id}")
                del running_tasks[task_id]
                _save_running_tasks()

        # Load subtasks and plan from implementation_plan.json (checks both main and worktree)
        logger.info(f"📋 [{func_name}] Loading plan for spec: {spec['folder']}")
        plan, subtasks = load_plan_from_spec(spec["path"], project_path, spec["folder"])

        logger.info(
            f"📋 [{func_name}] Spec {spec['folder']}: "
            f"plan_found={plan is not None}, subtasks={len(subtasks)}, is_running={is_running}"
        )

        # Calculate status based on subtask states (matching Electron app logic)
        # Frontend uses: 'backlog' | 'in_progress' | 'ai_review' | 'human_review' | 'done'
        frontend_status = "backlog"
        review_reason = None

        if is_running:
            # Task is actively running
            frontend_status = "in_progress"
        elif len(subtasks) > 0:
            completed = sum(1 for s in subtasks if s.get("status") == "completed")
            in_progress = sum(1 for s in subtasks if s.get("status") == "in_progress")
            failed = sum(1 for s in subtasks if s.get("status") == "failed")

            if completed == len(subtasks):
                # All subtasks completed - check QA status
                qa_signoff = plan.get("qa_signoff") if plan else None
                if qa_signoff and qa_signoff.get("status") == "approved":
                    frontend_status = "human_review"
                    review_reason = "completed"
                else:
                    # Default to ai_review when all subtasks complete
                    frontend_status = "ai_review"
            elif failed > 0:
                # Some subtasks failed - needs human attention
                frontend_status = "human_review"
                review_reason = "errors"
            elif in_progress > 0 or completed > 0:
                frontend_status = "in_progress"
        else:
            # No subtasks yet - check raw status from list_specs
            status = spec["status"]
            if "pending" in status or "initialized" in status:
                frontend_status = "backlog"
            elif "in_progress" in status or "planning" in status or "coding" in status:
                frontend_status = "in_progress"
            elif "complete" in status:
                frontend_status = "done"
            elif "review" in status.lower():
                frontend_status = (
                    "human_review" if "human" in status.lower() else "ai_review"
                )

        # Check for explicit status in plan that overrides calculated status
        if plan and plan.get("status"):
            plan_status = plan["status"]
            status_map = {
                "pending": "backlog",
                "planning": "in_progress",
                "in_progress": "in_progress",
                "coding": "in_progress",
                "review": "ai_review",
                "completed": "done",
                "done": "done",
                "human_review": "human_review",
                "ai_review": "ai_review",
                "backlog": "backlog",
            }
            if plan_status in status_map:
                # User explicitly marked as done - respect that
                if status_map[plan_status] == "done":
                    frontend_status = "done"
                # Human review from plan takes precedence
                elif status_map[plan_status] == "human_review":
                    frontend_status = "human_review"

        tasks.append(
            {
                "id": task_id,
                "specId": spec["folder"],
                "projectId": project_id,
                "title": spec["name"],
                "description": description,
                "status": frontend_status,
                "subtasks": subtasks,
                "logs": [],
                "folder": spec["folder"],
                "progress": spec["progress"],
                "has_build": spec["has_build"],
                "createdAt": created_at,
                "updatedAt": updated_at,
                "isRunning": is_running,
                "reviewReason": review_reason,
                "specsPath": str(
                    spec["path"]
                ),  # Full path to specs directory for Files tab
            }
        )

    logger.info(f"📋 Returning {len(tasks)} tasks for project {project_id}")
    return {"success": True, "data": tasks}


@router.post("/projects/{project_id}/tasks", status_code=201)
async def create_task(
    project_id: str,
    task: TaskCreate,
    background_tasks: BackgroundTasks,
) -> dict:
    """Create a new task (spec) for a project.

    This only creates the spec folder with spec.md - it does NOT run the full
    spec creation pipeline. The full pipeline runs when the user starts the task.
    """
    try:
        project_path = get_project_path(project_id)

        if not project_path.exists():
            raise HTTPException(status_code=404, detail="Project path does not exist")

        # Use title + description or just description
        task_text = (
            f"{task.title}: {task.description}" if task.title else task.description
        )
        task_name = task.title or task.description[:50]

        logger.info(f"📝 Creating task for project {project_id}")
        logger.info(f"📂 Project path: {project_path}")
        logger.info(f"📋 Task: {task_text[:100]}...")

        # Get specs directory
        specs_dir = get_specs_dir(project_path)
        specs_dir.mkdir(parents=True, exist_ok=True)

        # Find next spec number
        existing_specs = list(specs_dir.glob("*"))
        existing_numbers = []
        for spec in existing_specs:
            if spec.is_dir():
                try:
                    num = int(spec.name.split("-")[0])
                    existing_numbers.append(num)
                except (ValueError, IndexError):
                    pass
        next_num = max(existing_numbers, default=0) + 1

        # Create spec folder name (e.g., "001-add-login")
        safe_name = "".join(
            c if c.isalnum() or c in "-_" else "-" for c in task_name.lower()
        )
        safe_name = "-".join(filter(None, safe_name.split("-")))[:50]
        folder_name = f"{next_num:03d}-{safe_name}"
        spec_dir = specs_dir / folder_name
        spec_dir.mkdir(parents=True, exist_ok=True)

        # Create minimal spec.md
        spec_content = f"""# {task_name}

## Description

{task.description}

## Status

Pending - run build to start implementation.
"""
        spec_file = spec_dir / "spec.md"
        spec_file.write_text(spec_content)

        task_id = get_task_id(project_id, folder_name)
        now = datetime.utcnow().isoformat()

        logger.info(f"✅ Task created: {task_id} at {spec_dir}")

        return {
            "success": True,
            "data": {
                "id": task_id,
                "specId": folder_name,
                "projectId": project_id,
                "title": task_name,
                "description": task.description,
                "status": "backlog",  # New tasks go to Planning/Backlog column
                "subtasks": [],
                "logs": [],
                "folder": folder_name,
                "progress": "-",
                "has_build": False,
                "createdAt": now,
                "updatedAt": now,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Unexpected error creating task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str) -> TaskResponse:
    """Get details of a specific task."""
    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)

    spec_dir = find_spec(project_path, folder)
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")

    has_build = get_existing_build_worktree(project_path, folder) is not None
    plan_file = spec_dir / "implementation_plan.json"

    status = "pending"
    progress = "-"

    if plan_file.exists():
        completed, total = count_subtasks(spec_dir)
        if total > 0:
            status = "complete" if completed == total else "in_progress"
            progress = f"{completed}/{total}"
        else:
            status = "initialized"
            progress = "0/0"

    if has_build:
        status = f"{status} (has build)"

    spec_content = None
    spec_file = spec_dir / "spec.md"
    if spec_file.exists():
        spec_content = spec_file.read_text()

    parts = folder.split("-", 1)
    name = parts[1] if len(parts) == 2 else folder

    created_at = None
    if spec_file.exists():
        created_at = datetime.fromtimestamp(spec_file.stat().st_mtime).isoformat()

    return TaskResponse(
        id=task_id,
        name=name,
        folder=folder,
        status=status,
        progress=progress,
        has_build=has_build,
        project_id=project_id,
        created_at=created_at,
        spec_content=spec_content,
    )


@router.get("/projects/{project_id}/tasks/{spec_id}/plan")
async def get_task_plan(project_id: str, spec_id: str) -> dict[str, Any]:
    """Get the implementation plan (subtasks) for a task."""
    logger.info(f"📋 [get_task_plan] project_id={project_id}, spec_id={spec_id}")

    project_path = get_project_path(project_id)
    logger.info(f"📋 [get_task_plan] project_path={project_path}")

    spec_dir = find_spec(project_path, spec_id)
    logger.info(f"📋 [get_task_plan] spec_dir={spec_dir}")

    if not spec_dir:
        logger.warning(f"📋 [get_task_plan] Task not found: {spec_id}")
        raise HTTPException(status_code=404, detail="Task not found")

    # Load plan from spec (checks both main and worktree)
    plan, subtasks = load_plan_from_spec(spec_dir, project_path, spec_id)
    logger.info(
        f"📋 [get_task_plan] plan loaded: {plan is not None}, subtasks count: {len(subtasks)}"
    )

    if not plan:
        logger.info(f"📋 [get_task_plan] No plan found for {spec_id}")
        return {"success": True, "data": None}

    logger.info(
        f"📋 [get_task_plan] Returning plan with {len(plan.get('phases', []))} phases"
    )
    return {"success": True, "data": plan}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str) -> dict[str, Any]:
    """Delete a task and its spec directory."""
    func_name = "delete_task"
    timestamp = datetime.utcnow().isoformat()

    logger.info(f"🗑️ [{func_name}] START at {timestamp} for task_id={task_id}")

    _cleanup_finished_tasks()

    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)

    spec_dir = find_spec(project_path, folder)
    if not spec_dir:
        logger.warning(f"🗑️ [{func_name}] Task not found: {folder}")
        raise HTTPException(status_code=404, detail="Task not found")

    if task_id in running_tasks:
        pid = running_tasks[task_id]["pid"]
        if _is_process_running(pid):
            logger.info(f"🗑️ [{func_name}] Task is running with PID {pid}")
            return {
                "success": False,
                "error": "Cannot delete a running task. Stop the task first.",
            }
        del running_tasks[task_id]
        _save_running_tasks()

    try:
        logger.info(f"🗑️ [{func_name}] Deleting spec dir: {spec_dir}")
        shutil.rmtree(spec_dir, ignore_errors=False)
        log_file_operation(func_name, "delete", spec_dir)
        return {"success": True}
    except Exception as exc:
        logger.error(f"🗑️ [{func_name}] Failed to delete spec dir: {exc}", exc_info=True)
        return {"success": False, "error": str(exc)}


@router.post("/tasks/{task_id}/start")
async def start_task(task_id: str, request: TaskStartRequest) -> dict[str, Any]:
    """Start running a task (build) as a detached background process.

    The task runs independently of the web server - it continues even if:
    - The browser is closed
    - The API server restarts

    Logs are written to the spec directory for later retrieval.
    """
    func_name = "start_task"
    timestamp = datetime.utcnow().isoformat()

    logger.info(
        f"🚀 [{func_name}] START at {timestamp}\n"
        f"   task_id: {task_id}\n"
        f"   request: auto_continue={request.auto_continue}, skip_qa={request.skip_qa}, model={request.model}"
    )

    log_task_lifecycle(
        "start",
        task_id,
        {
            "auto_continue": request.auto_continue,
            "skip_qa": request.skip_qa,
            "model": request.model,
        },
    )

    _cleanup_finished_tasks()  # Clean up any finished tasks first

    project_id, folder = parse_task_id(task_id)
    logger.info(
        f"🚀 [{func_name}] Parsed task_id: project_id={project_id}, folder={folder}"
    )

    project_path = get_project_path(project_id)
    logger.info(f"🚀 [{func_name}] project_path={project_path}")
    log_path_check(func_name, project_path, project_path.exists(), "project_path")

    spec_dir = find_spec(project_path, folder)
    logger.info(f"🚀 [{func_name}] spec_dir={spec_dir}")

    if not spec_dir:
        logger.error(f"🚀 [{func_name}] Task not found: {folder}")
        log_task_lifecycle("error", task_id, {"error": "Task not found"})
        raise HTTPException(status_code=404, detail="Task not found")

    log_path_check(func_name, spec_dir, spec_dir.exists(), "spec_dir")

    # List spec_dir contents for debugging
    if spec_dir.exists():
        try:
            contents = list(spec_dir.iterdir())
            logger.info(
                f"🚀 [{func_name}] spec_dir contents: {[f.name for f in contents]}"
            )
        except Exception as e:
            logger.error(f"🚀 [{func_name}] Error listing spec_dir: {e}")

    # Check if already running (by PID check, not just dict presence)
    if task_id in running_tasks:
        pid = running_tasks[task_id]["pid"]
        if _is_process_running(pid):
            logger.info(f"🚀 [{func_name}] Task already running with PID {pid}")
            log_task_lifecycle(
                "status", task_id, {"status": "already_running", "pid": pid}
            )
            return {"status": "already_running", "task_id": task_id, "pid": pid}
        else:
            # Process finished, clean up stale entry
            logger.info(
                f"🚀 [{func_name}] Cleaning up stale task entry (PID {pid} not running)"
            )
            del running_tasks[task_id]

    backend_dir = Path(__file__).parent.parent.parent
    run_script = backend_dir / "run.py"

    logger.info(f"🚀 [{func_name}] backend_dir={backend_dir}")
    log_path_check(func_name, run_script, run_script.exists(), "run_script")

    # Create log file in spec directory
    log_file = spec_dir / "build.log"

    cmd = [
        sys.executable,
        str(run_script),
        "--spec",
        folder,
        "--project-dir",
        str(project_path),
        "--force",  # Bypass approval check - user starting task from UI is approval
    ]

    if request.auto_continue:
        cmd.append("--auto-continue")
    if request.skip_qa:
        cmd.append("--skip-qa")
    if request.model:
        cmd.extend(["--model", request.model])

    logger.info(
        f"🚀 [{func_name}] Starting background task:\n"
        f"   Command: {' '.join(cmd)}\n"
        f"   Log file: {log_file}\n"
        f"   Working directory: {project_path}"
    )

    # Dump diagnostic info before starting
    dump_diagnostic_info(func_name, project_path, folder, spec_dir)

    # Start as detached background process
    # - start_new_session=True: Creates new process group (survives parent death)
    # - stdout/stderr to file: Logs persist for later retrieval
    try:
        with open(log_file, "a") as log_handle:
            log_handle.write(f"\n{'=' * 60}\n")
            log_handle.write(f"Task started at: {datetime.utcnow().isoformat()}\n")
            log_handle.write(f"Command: {' '.join(cmd)}\n")
            log_handle.write(f"Project path: {project_path}\n")
            log_handle.write(f"Spec dir: {spec_dir}\n")
            log_handle.write(f"{'=' * 60}\n\n")
            log_handle.flush()

            process = subprocess.Popen(
                cmd,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,  # Detach from parent process group
                cwd=str(project_path),
                env={**os.environ, "PYTHONUNBUFFERED": "1"},  # Ensure real-time logging
            )

        log_file_operation("write", log_file, True, f"task started, PID={process.pid}")

    except Exception as e:
        logger.error(f"🚀 [{func_name}] Error starting process: {e}", exc_info=True)
        log_task_lifecycle("error", task_id, {"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Failed to start task: {e}")

    # Track the running task
    running_tasks[task_id] = {
        "pid": process.pid,
        "started_at": datetime.utcnow().isoformat(),
        "log_file": str(log_file),
        "project_id": project_id,
        "folder": folder,
    }
    _save_running_tasks()

    logger.info(f"✅ [{func_name}] Task {task_id} started with PID {process.pid}")
    log_task_lifecycle(
        "start",
        task_id,
        {
            "pid": process.pid,
            "log_file": str(log_file),
            "status": "started",
        },
    )

    return {
        "status": "started",
        "task_id": task_id,
        "pid": process.pid,
        "log_file": str(log_file),
        "message": "Task running in background. You can close the browser safely.",
    }


@router.post("/tasks/{task_id}/stop")
async def stop_task(task_id: str) -> dict[str, Any]:
    """Stop a running background task."""
    func_name = "stop_task"
    logger.info(f"🛑 [{func_name}] Stopping task: {task_id}")
    log_task_lifecycle("stop", task_id, {"action": "stop_requested"})

    _cleanup_finished_tasks()

    if task_id not in running_tasks:
        logger.info(f"🛑 [{func_name}] Task not in running_tasks: {task_id}")
        log_task_lifecycle("status", task_id, {"status": "not_running"})
        return {"status": "not_running", "task_id": task_id}

    task_info = running_tasks[task_id]
    pid = task_info["pid"]

    if not _is_process_running(pid):
        logger.info(f"🛑 [{func_name}] Task already finished (PID {pid})")
        del running_tasks[task_id]
        _save_running_tasks()
        log_task_lifecycle("complete", task_id, {"status": "already_finished"})
        return {"status": "already_finished", "task_id": task_id}

    try:
        # Send SIGTERM to the process group (kills all child processes too)
        os.killpg(os.getpgid(pid), signal.SIGTERM)
        logger.info(f"🛑 [{func_name}] Sent SIGTERM to task {task_id} (PID {pid})")
        log_task_lifecycle("stop", task_id, {"signal": "SIGTERM", "pid": pid})

        # Wait a bit for graceful shutdown
        await asyncio.sleep(2)

        # Force kill if still running
        if _is_process_running(pid):
            os.killpg(os.getpgid(pid), signal.SIGKILL)
            logger.info(f"💀 [{func_name}] Force killed task {task_id} (PID {pid})")
            log_task_lifecycle("stop", task_id, {"signal": "SIGKILL", "pid": pid})
    except (OSError, ProcessLookupError) as e:
        logger.warning(f"🛑 [{func_name}] Error stopping task {task_id}: {e}")
        log_task_lifecycle("error", task_id, {"error": str(e)})

    del running_tasks[task_id]
    _save_running_tasks()

    logger.info(f"🛑 [{func_name}] Task stopped: {task_id}")
    log_task_lifecycle("stop", task_id, {"status": "stopped"})
    return {"status": "stopped", "task_id": task_id}


@router.get("/tasks/{task_id}/status")
async def get_task_status(task_id: str) -> dict[str, Any]:
    """Get the running status of a task."""
    func_name = "get_task_status"
    logger.debug(f"📊 [{func_name}] Getting status for: {task_id}")

    _cleanup_finished_tasks()

    if task_id in running_tasks:
        task_info = running_tasks[task_id]
        is_running = _is_process_running(task_info["pid"])

        # Dump diagnostic info for debugging if task is running
        if is_running:
            project_id, folder = parse_task_id(task_id)
            try:
                project_path = get_project_path(project_id)
                spec_dir = find_spec(project_path, folder)
                if spec_dir:
                    # Log current plan state for debugging
                    plan, subtasks = load_plan_from_spec(spec_dir, project_path, folder)
                    logger.info(
                        f"📊 [{func_name}] Task {task_id}: "
                        f"running=True, plan_found={plan is not None}, subtasks={len(subtasks)}"
                    )
            except Exception as e:
                logger.debug(f"📊 [{func_name}] Error getting plan state: {e}")

        log_task_lifecycle(
            "poll",
            task_id,
            {
                "is_running": is_running,
                "pid": task_info["pid"],
            },
        )

        return {
            "task_id": task_id,
            "is_running": is_running,
            "pid": task_info["pid"],
            "started_at": task_info["started_at"],
            "log_file": task_info["log_file"],
        }

    log_task_lifecycle("poll", task_id, {"is_running": False})
    return {
        "task_id": task_id,
        "is_running": False,
        "pid": None,
    }


class TaskStatusUpdate(BaseModel):
    """Request model for updating task status."""

    status: str = Field(
        ...,
        description="New status: backlog, in_progress, ai_review, human_review, done",
    )


@router.patch("/tasks/{task_id}/status")
async def update_task_status(task_id: str, update: TaskStatusUpdate) -> dict[str, Any]:
    """Update the status of a task.

    Note: This updates the frontend display status. The actual task state
    is determined by the implementation_plan.json and running process status.
    """
    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)

    spec_dir = find_spec(project_path, folder)
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")

    # For now, we just acknowledge the status update
    # The real status is computed from implementation_plan.json when listing tasks
    logger.info(f"📝 Status update for {task_id}: {update.status}")

    return {
        "success": True,
        "task_id": task_id,
        "status": update.status,
    }


@router.get("/tasks/{task_id}/logs", response_model=TaskLogsResponse)
async def get_task_logs(task_id: str, lines: int = 100) -> TaskLogsResponse:
    """Get logs for a task from persistent log files."""
    _cleanup_finished_tasks()

    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)

    spec_dir = find_spec(project_path, folder)
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")

    logs = []

    # Check if task is currently running
    is_running = False
    if task_id in running_tasks:
        is_running = _is_process_running(running_tasks[task_id]["pid"])

    # Read from persistent log files
    log_files = [
        spec_dir / "build.log",
        spec_dir / "qa_report.md",
        spec_dir / "QA_FIX_REQUEST.md",
    ]

    for log_file in log_files:
        if log_file.exists():
            try:
                content = log_file.read_text()
                log_lines = content.split("\n")
                # Get last N lines from each file
                logs.extend(
                    [
                        f"[{log_file.name}] {line}"
                        for line in log_lines[-lines:]
                        if line.strip()
                    ]
                )
            except Exception:
                pass

    return TaskLogsResponse(task_id=task_id, logs=logs[-lines:], is_running=is_running)


@router.get("/projects/{project_id}/tasks/{spec_id}/logs")
async def get_task_logs_detailed(
    project_id: str,
    spec_id: str,
    since: str | None = None,
) -> dict[str, Any]:
    """Get detailed phase-based logs for a task (for task detail panel).

    Returns logs structured by phase (planning, coding, validation) for the UI.
    Reads from task_logs.json which has proper phase tracking from the TaskLogger.

    If since is provided and logs have not changed since that timestamp, returns
    success with data: null to allow conditional polling.
    """
    logger.info(
        f"📋 [get_task_logs_detailed] project_id={project_id}, spec_id={spec_id}"
    )

    project_path = get_project_path(project_id)
    spec_dir = find_spec(project_path, spec_id)

    if not spec_dir:
        logger.warning(f"📋 [get_task_logs_detailed] Task not found: {spec_id}")
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.utcnow().isoformat()

    # Default phase structure
    default_phases = {
        "planning": {
            "phase": "planning",
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "entries": [],
        },
        "coding": {
            "phase": "coding",
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "entries": [],
        },
        "validation": {
            "phase": "validation",
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "entries": [],
        },
    }

    # Load task_logs.json from spec (checks both main and worktree)
    phases = default_phases.copy()
    created_at = now
    updated_at = now

    task_logs = load_task_logs_from_spec(spec_dir, project_path, spec_id)
    if task_logs:
        # Use the phases from task_logs.json directly
        if "phases" in task_logs:
            phases = task_logs["phases"]
        created_at = task_logs.get("created_at", now)
        updated_at = task_logs.get("updated_at", now)

    if since and updated_at <= since:
        return {
            "success": True,
            "data": None,
        }

    # Ensure only one phase is marked as "active" at a time
    # Priority: validation > coding > planning
    active_phases = [p for p, data in phases.items() if data.get("status") == "active"]
    if len(active_phases) > 1:
        # Keep only the most advanced phase as active
        priority = ["validation", "coding", "planning"]
        for phase in priority:
            if phase in active_phases:
                # Mark all others as completed if they were active
                for other in active_phases:
                    if other != phase and phases[other]["status"] == "active":
                        # Earlier phases should be completed, not active
                        phases[other]["status"] = "completed"
                        if not phases[other].get("completed_at"):
                            phases[other]["completed_at"] = now
                break

    # Check if task is currently running
    task_id = get_task_id(project_id, spec_id)
    is_running = task_id in running_tasks and _is_process_running(
        running_tasks[task_id]["pid"]
    )

    # If task is running but all phases are pending, mark planning as active
    if is_running:
        all_pending = all(
            phases[p]["status"] == "pending"
            for p in ["planning", "coding", "validation"]
        )
        if all_pending:
            # Task just started, planning phase should be active
            phases["planning"]["status"] = "active"
            phases["planning"]["started_at"] = running_tasks[task_id].get(
                "started_at", now
            )

    # Fallback: Check implementation plan for planning status
    plan_file = spec_dir / "implementation_plan.json"
    if plan_file.exists() and phases["planning"]["status"] == "pending":
        try:
            plan = json.loads(plan_file.read_text())
            if plan.get("phases"):
                # Plan exists, so planning phase is completed
                phases["planning"]["status"] = "completed"
                phases["planning"]["completed_at"] = now
        except Exception:
            pass

    # Fallback: Check QA report for validation status
    qa_report = spec_dir / "qa_report.md"
    if qa_report.exists() and phases["validation"]["status"] != "completed":
        phases["validation"]["status"] = "completed"
        phases["validation"]["completed_at"] = now

    return {
        "success": True,
        "data": {
            "spec_id": spec_id,
            "created_at": created_at,
            "updated_at": updated_at,
            "phases": phases,
        },
    }


@router.get("/tasks/{task_id}/logs/stream")
async def stream_task_logs(task_id: str) -> StreamingResponse:
    """Stream task logs in real-time using Server-Sent Events (SSE).

    This endpoint:
    1. Tails the build.log file in real-time
    2. Also watches task_logs.json for phase changes
    3. Streams updates via SSE until the task completes
    """
    _cleanup_finished_tasks()

    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)
    spec_dir = find_spec(project_path, folder)

    if not spec_dir:

        async def error_stream():
            yield f"data: {json.dumps({'type': 'error', 'error': 'Task not found'})}\n\n"

        return StreamingResponse(error_stream(), media_type="text/event-stream")

    async def stream_logs() -> AsyncGenerator[str, None]:
        """Stream logs via SSE."""
        build_log = spec_dir / "build.log"
        task_logs_file = spec_dir / "task_logs.json"

        # Also check worktree for logs
        worktree_spec_dir = get_existing_build_worktree(project_path, folder)
        worktree_build_log = None
        worktree_task_logs = None
        if worktree_spec_dir:
            worktree_build_log = (
                worktree_spec_dir / ".auto-claude" / "specs" / folder / "build.log"
            )
            worktree_task_logs = (
                worktree_spec_dir / ".auto-claude" / "specs" / folder / "task_logs.json"
            )

        last_build_pos = 0
        last_task_logs_mtime = 0
        last_worktree_build_pos = 0
        last_worktree_task_logs_mtime = 0

        # Send initial connection message
        yield f"data: {json.dumps({'type': 'connected', 'task_id': task_id})}\n\n"

        # Check if task is running
        is_running = task_id in running_tasks and _is_process_running(
            running_tasks[task_id]["pid"]
        )
        yield f"data: {json.dumps({'type': 'status', 'is_running': is_running})}\n\n"

        # Send initial phase status
        if task_logs_file.exists():
            try:
                task_logs = json.loads(task_logs_file.read_text())
                yield f"data: {json.dumps({'type': 'phases', 'phases': task_logs.get('phases', {})})}\n\n"
                last_task_logs_mtime = task_logs_file.stat().st_mtime
            except Exception:
                pass

        # Stream until task completes or client disconnects
        while True:
            try:
                # Check if task is still running
                is_running = task_id in running_tasks and _is_process_running(
                    running_tasks[task_id]["pid"]
                )

                # Read new content from build.log (main spec dir)
                if build_log.exists():
                    try:
                        with open(build_log) as f:
                            f.seek(last_build_pos)
                            new_content = f.read()
                            if new_content:
                                last_build_pos = f.tell()
                                for line in new_content.strip().split("\n"):
                                    if line.strip():
                                        yield f"data: {json.dumps({'type': 'log', 'content': line, 'source': 'main'})}\n\n"
                    except Exception:
                        pass

                # Read new content from worktree build.log
                if worktree_build_log and worktree_build_log.exists():
                    try:
                        with open(worktree_build_log) as f:
                            f.seek(last_worktree_build_pos)
                            new_content = f.read()
                            if new_content:
                                last_worktree_build_pos = f.tell()
                                for line in new_content.strip().split("\n"):
                                    if line.strip():
                                        yield f"data: {json.dumps({'type': 'log', 'content': line, 'source': 'worktree'})}\n\n"
                    except Exception:
                        pass

                # Check for task_logs.json changes (phase updates)
                if task_logs_file.exists():
                    try:
                        current_mtime = task_logs_file.stat().st_mtime
                        if current_mtime > last_task_logs_mtime:
                            last_task_logs_mtime = current_mtime
                            task_logs = json.loads(task_logs_file.read_text())
                            yield f"data: {json.dumps({'type': 'phases', 'phases': task_logs.get('phases', {})})}\n\n"
                    except Exception:
                        pass

                # Check worktree task_logs.json
                if worktree_task_logs and worktree_task_logs.exists():
                    try:
                        current_mtime = worktree_task_logs.stat().st_mtime
                        if current_mtime > last_worktree_task_logs_mtime:
                            last_worktree_task_logs_mtime = current_mtime
                            task_logs = json.loads(worktree_task_logs.read_text())
                            yield f"data: {json.dumps({'type': 'phases', 'phases': task_logs.get('phases', {}), 'source': 'worktree'})}\n\n"
                    except Exception:
                        pass

                # If task finished, send final status and exit
                if not is_running:
                    yield f"data: {json.dumps({'type': 'status', 'is_running': False, 'finished': True})}\n\n"
                    break

                # Small delay between polls
                await asyncio.sleep(0.5)

            except asyncio.CancelledError:
                # Client disconnected
                break
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
                break

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        stream_logs(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "Access-Control-Allow-Origin": "*",  # CORS for SSE
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    )


class FileNode(BaseModel):
    """Response model for a file/directory node."""

    name: str
    path: str
    isDirectory: bool


@router.get("/projects/{project_id}/tasks/{spec_id}/files")
async def list_spec_files(project_id: str, spec_id: str) -> dict:
    """List files in a spec directory.

    Returns a list of files in the spec directory for the Files tab.
    Only includes .md and .json files.
    """
    logger.info(f"📁 [list_spec_files] project_id={project_id}, spec_id={spec_id}")

    project_path = get_project_path(project_id)
    spec_dir = find_spec(project_path, spec_id)

    if not spec_dir:
        logger.warning(f"📁 [list_spec_files] Task not found: {spec_id}")
        raise HTTPException(status_code=404, detail="Task not found")

    if not spec_dir.exists():
        return {"success": True, "data": []}

    allowed_extensions = [".md", ".json"]
    files = []

    try:
        for entry in spec_dir.iterdir():
            if entry.is_file() and any(
                entry.name.endswith(ext) for ext in allowed_extensions
            ):
                files.append(
                    {"name": entry.name, "path": str(entry), "isDirectory": False}
                )

        # Sort: spec.md first, then alphabetically
        files.sort(key=lambda f: (f["name"] != "spec.md", f["name"]))

        logger.info(f"📁 [list_spec_files] Found {len(files)} files in {spec_dir}")
        return {"success": True, "data": files}

    except Exception as e:
        logger.error(f"📁 [list_spec_files] Error listing files: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/tasks/{spec_id}/files/content")
async def read_spec_file(project_id: str, spec_id: str, file_path: str) -> dict:
    """Read content of a file in the spec directory.

    Args:
        project_id: Project ID
        spec_id: Spec/task ID
        file_path: Full path to the file to read

    Returns the file content as a string.
    """
    logger.info(
        f"📁 [read_spec_file] project_id={project_id}, spec_id={spec_id}, file_path={file_path}"
    )

    project_path = get_project_path(project_id)
    spec_dir = find_spec(project_path, spec_id)

    if not spec_dir:
        logger.warning(f"📁 [read_spec_file] Task not found: {spec_id}")
        raise HTTPException(status_code=404, detail="Task not found")

    # Security: Ensure the file_path is within the spec directory
    file = Path(file_path)
    try:
        file.resolve().relative_to(spec_dir.resolve())
    except ValueError:
        logger.warning(
            f"📁 [read_spec_file] Access denied: {file_path} not in {spec_dir}"
        )
        raise HTTPException(
            status_code=403, detail="Access denied: file outside spec directory"
        )

    if not file.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not file.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        content = file.read_text(encoding="utf-8")
        logger.info(f"📁 [read_spec_file] Read {len(content)} characters from {file}")
        return {"success": True, "data": content}

    except Exception as e:
        logger.error(f"📁 [read_spec_file] Error reading file: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/tasks/{spec_id}/git-changes")
async def get_task_git_changes(project_id: str, spec_id: str) -> dict:
    """Get git changes (modified files) for a task.

    Returns a list of files that have been changed in the task's worktree,
    compared to the base branch.
    """
    logger.info(f"📝 [get_task_git_changes] project_id={project_id}, spec_id={spec_id}")

    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": True, "data": {"files": [], "summary": {}}}

    try:
        # Use WorktreeManager to find the worktree correctly
        manager = WorktreeManager(project_path)
        info = manager.get_worktree_info(spec_id)

        if not info:
            logger.info(
                f"📝 [get_task_git_changes] No worktree found for spec: {spec_id}"
            )
            return {
                "success": True,
                "data": {"files": [], "summary": {}, "hasWorktree": False},
            }

        worktree_path = info.path
        base_branch = info.base_branch

        logger.info(
            f"📝 [get_task_git_changes] Found worktree at {worktree_path}, base_branch={base_branch}"
        )

        # Get changed files with stats
        diff_result = subprocess.run(
            ["git", "diff", "--name-status", f"{base_branch}...HEAD"],
            cwd=str(worktree_path),
            capture_output=True,
            text=True,
        )

        files = []
        for line in diff_result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t", 1)
            if len(parts) == 2:
                status_code = parts[0]
                file_path = parts[1]

                # Map git status codes to readable names
                status_map = {
                    "A": "added",
                    "M": "modified",
                    "D": "deleted",
                    "R": "renamed",
                    "C": "copied",
                    "U": "unmerged",
                }
                status = status_map.get(status_code[0], "modified")

                # Get line stats for this file
                stat_result = subprocess.run(
                    [
                        "git",
                        "diff",
                        "--numstat",
                        f"{base_branch}...HEAD",
                        "--",
                        file_path,
                    ],
                    cwd=str(worktree_path),
                    capture_output=True,
                    text=True,
                )

                additions = 0
                deletions = 0
                if stat_result.stdout.strip():
                    stat_parts = stat_result.stdout.strip().split("\t")
                    if len(stat_parts) >= 2:
                        try:
                            additions = (
                                int(stat_parts[0]) if stat_parts[0] != "-" else 0
                            )
                            deletions = (
                                int(stat_parts[1]) if stat_parts[1] != "-" else 0
                            )
                        except ValueError:
                            pass

                files.append(
                    {
                        "path": file_path,
                        "status": status,
                        "additions": additions,
                        "deletions": deletions,
                    }
                )

        # Calculate summary
        summary = {
            "totalFiles": len(files),
            "added": sum(1 for f in files if f["status"] == "added"),
            "modified": sum(1 for f in files if f["status"] == "modified"),
            "deleted": sum(1 for f in files if f["status"] == "deleted"),
            "totalAdditions": sum(f["additions"] for f in files),
            "totalDeletions": sum(f["deletions"] for f in files),
        }

        logger.info(f"📝 [get_task_git_changes] Found {len(files)} changed files")
        return {
            "success": True,
            "data": {
                "files": files,
                "summary": summary,
                "hasWorktree": True,
                "baseBranch": base_branch,
            },
        }

    except Exception as e:
        logger.error(f"📝 [get_task_git_changes] Error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/tasks/{spec_id}/git-diff")
async def get_task_file_diff(
    project_id: str,
    spec_id: str,
    file_path: str,
    base_branch: str | None = None,
) -> dict:
    """Get the git diff content for a specific file in a task's worktree.

    Args:
        project_id: Project ID
        spec_id: Spec/task ID
        file_path: Relative path to the file within the project

    Returns the unified diff content for the file.
    """
    logger.info(
        f"📝 [get_task_file_diff] project_id={project_id}, spec_id={spec_id}, file_path={file_path}"
    )

    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project not found"}

    try:
        # Use WorktreeManager to find the worktree correctly
        manager = WorktreeManager(project_path)
        info = manager.get_worktree_info(spec_id)

        if not info:
            return {"success": False, "error": "No worktree found for this task"}

        worktree_path = info.path
        base_branch = base_branch or info.base_branch

        logger.info(
            f"📝 [get_task_file_diff] Found worktree at {worktree_path}, base_branch={base_branch}"
        )

        # Get the diff for this specific file
        diff_result = subprocess.run(
            ["git", "diff", f"{base_branch}...HEAD", "--", file_path],
            cwd=str(worktree_path),
            capture_output=True,
            text=True,
        )

        diff_content = diff_result.stdout

        # If no diff (new file), get the file content
        if not diff_content.strip():
            # Check if it's a new file
            status_result = subprocess.run(
                [
                    "git",
                    "diff",
                    "--name-status",
                    f"{base_branch}...HEAD",
                    "--",
                    file_path,
                ],
                cwd=str(worktree_path),
                capture_output=True,
                text=True,
            )

            if status_result.stdout.strip().startswith("A"):
                # New file - show full content as additions
                file_full_path = worktree_path / file_path
                if file_full_path.exists():
                    content = file_full_path.read_text(
                        encoding="utf-8", errors="replace"
                    )
                    # Format as a simple diff showing all lines as additions
                    lines = content.split("\n")
                    diff_lines = [
                        f"diff --git a/{file_path} b/{file_path}",
                        "new file mode 100644",
                        "--- /dev/null",
                        f"+++ b/{file_path}",
                        f"@@ -0,0 +1,{len(lines)} @@",
                    ]
                    diff_lines.extend(f"+{line}" for line in lines)
                    diff_content = "\n".join(diff_lines)

        logger.info(
            f"📝 [get_task_file_diff] Got diff of {len(diff_content)} chars for {file_path}"
        )
        return {
            "success": True,
            "data": {
                "diff": diff_content,
                "filePath": file_path,
                "baseBranch": base_branch,
            },
        }

    except Exception as e:
        logger.error(f"📝 [get_task_file_diff] Error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}

"""
Context Router
===============

API endpoints for project context (Project Index and Memory Status).

This enables the Context page in web mode to display:
- Project structure and analysis from project_index.json
- Memory/Graphiti status
- Recent memories from specs
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from ..utils.security import get_secure_logger
from .projects import load_projects

router = APIRouter()
logger = get_secure_logger("auto-claude-api")


def get_project_path(project_id: str) -> Path:
    """Get project path from project ID."""
    projects = load_projects()
    for p in projects:
        if p.get("id") == project_id:
            return Path(p.get("path", ""))
    raise HTTPException(status_code=404, detail="Project not found")


def load_project_index(project_path: Path) -> dict | None:
    """Load project index from .auto-claude/project_index.json."""
    index_path = project_path / ".auto-claude" / "project_index.json"

    if not index_path.exists():
        return None

    try:
        with open(index_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Failed to load project index: {e}")
        return None


def load_graphiti_state(project_path: Path) -> dict | None:
    """Load graphiti state from most recent spec."""
    specs_dir = project_path / ".auto-claude" / "specs"

    if not specs_dir.exists():
        return None

    # Find most recent spec with graphiti state
    spec_dirs = sorted(
        [d for d in specs_dir.iterdir() if d.is_dir()],
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )

    for spec_dir in spec_dirs:
        state_file = spec_dir / "graphiti" / "state.json"
        if state_file.exists():
            try:
                with open(state_file) as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

    return None


def build_memory_status(project_path: Path) -> dict:
    """Build memory status based on project configuration."""
    # Check if Graphiti is enabled
    env_file = project_path / ".auto-claude" / "env.json"
    env_config = {}

    if env_file.exists():
        try:
            with open(env_file) as f:
                env_config = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass

    graphiti_enabled = env_config.get("graphitiEnabled", True)
    openai_key_set = bool(
        env_config.get("openaiApiKey") or os.environ.get("OPENAI_API_KEY")
    )

    # Check for graphiti database
    db_path = None
    database = None

    specs_dir = project_path / ".auto-claude" / "specs"
    if specs_dir.exists():
        spec_dirs = sorted(
            [d for d in specs_dir.iterdir() if d.is_dir()],
            key=lambda d: d.stat().st_mtime,
            reverse=True,
        )

        for spec_dir in spec_dirs:
            kuzu_db = spec_dir / "graphiti" / "kuzu_db"
            if kuzu_db.exists():
                db_path = str(kuzu_db)
                database = spec_dir.name
                break

    return {
        "available": graphiti_enabled and openai_key_set,
        "enabled": graphiti_enabled,
        "provider": "openai" if openai_key_set else None,
        "embeddingProvider": "openai" if openai_key_set else None,
        "embeddingModel": "text-embedding-3-small",
        "llmProvider": "anthropic",
        "dbPath": db_path,
        "database": database,
        "missingConfig": [] if openai_key_set else ["OPENAI_API_KEY"],
    }


def load_file_based_memories(project_path: Path, limit: int = 20) -> list[dict]:
    """Load memories from file-based sources (insights, QA reports, etc.)."""
    memories = []
    specs_dir = project_path / ".auto-claude" / "specs"

    if not specs_dir.exists():
        return memories

    # Collect memory entries from various sources
    for spec_dir in specs_dir.iterdir():
        if not spec_dir.is_dir():
            continue

        # Check for QA reports
        qa_report = spec_dir / "qa_report.md"
        if qa_report.exists():
            try:
                content = qa_report.read_text()[:500]  # First 500 chars
                timestamp = datetime.fromtimestamp(
                    qa_report.stat().st_mtime
                ).isoformat()
                memories.append(
                    {
                        "id": f"qa-{spec_dir.name}",
                        "name": f"QA Report: {spec_dir.name}",
                        "content": content,
                        "type": "task_outcome",  # Maps to MemoryType for QA reports
                        "source": "qa_report",
                        "sourceDescription": f"QA validation for {spec_dir.name}",
                        "timestamp": timestamp,
                        "createdAt": timestamp,
                        "validAt": timestamp,
                    }
                )
            except OSError:
                pass

        # Check for spec.md
        spec_md = spec_dir / "spec.md"
        if spec_md.exists():
            try:
                content = spec_md.read_text()[:500]
                timestamp = datetime.fromtimestamp(spec_md.stat().st_mtime).isoformat()
                memories.append(
                    {
                        "id": f"spec-{spec_dir.name}",
                        "name": f"Spec: {spec_dir.name}",
                        "content": content,
                        "type": "codebase_discovery",  # Maps to MemoryType for specs
                        "source": "spec",
                        "sourceDescription": f"Task specification for {spec_dir.name}",
                        "timestamp": timestamp,
                        "createdAt": timestamp,
                        "validAt": timestamp,
                    }
                )
            except OSError:
                pass

    # Sort by creation time, newest first
    memories.sort(key=lambda m: m.get("createdAt", ""), reverse=True)

    return memories[:limit]


@router.get("/projects/{project_id}/context")
async def get_project_context(project_id: str) -> dict:
    """Get the full project context including index and memory status."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    try:
        # Load project index
        project_index = load_project_index(project_path)

        # Load memory state
        memory_state = load_graphiti_state(project_path)

        # Build memory status
        memory_status = build_memory_status(project_path)

        # Load recent memories
        recent_memories = load_file_based_memories(project_path, 20)

        return {
            "success": True,
            "data": {
                "projectIndex": project_index,
                "memoryStatus": memory_status,
                "memoryState": memory_state,
                "recentMemories": recent_memories,
                "isLoading": False,
            },
        }
    except Exception as e:
        logger.exception("Failed to load project context")
        return {"success": False, "error": str(e)}


@router.post("/projects/{project_id}/context/refresh")
async def refresh_project_index(project_id: str) -> dict:
    """Refresh the project index by running the analyzer.

    Note: In web mode, this runs the project analyzer script.
    """
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    try:
        import subprocess

        # Find Python executable
        python_path = sys.executable

        # Find project analyzer script (analyzer.py creates project_index.json)
        analyzer_path = _PARENT_DIR / "analyzer.py"

        if not analyzer_path.exists():
            # Fallback to analysis module
            analyzer_path = _PARENT_DIR / "analysis" / "analyzer.py"

        if not analyzer_path.exists():
            return {
                "success": False,
                "error": f"Project analyzer not found at {_PARENT_DIR}",
            }

        # Ensure .auto-claude directory exists
        auto_claude_dir = project_path / ".auto-claude"
        auto_claude_dir.mkdir(parents=True, exist_ok=True)

        # Output path for project index
        output_path = auto_claude_dir / "project_index.json"

        # Run analyzer (uses --project-dir, --index, and --output flags)
        result = subprocess.run(
            [
                python_path,
                str(analyzer_path),
                "--project-dir",
                str(project_path),
                "--index",
                "--output",
                str(output_path),
                "--quiet",
            ],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(_PARENT_DIR),  # Run from backend dir for imports
        )

        if result.returncode != 0:
            logger.error(f"Project analyzer failed: {result.stderr}")
            return {"success": False, "error": result.stderr[:500]}

        # Reload and return updated index
        project_index = load_project_index(project_path)

        return {"success": True, "data": project_index}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Project analysis timed out"}
    except Exception as e:
        logger.exception("Failed to refresh project index")
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/context/memories")
async def get_memories(project_id: str, limit: int = 20) -> dict:
    """Get recent memories for a project."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    memories = load_file_based_memories(project_path, limit)

    return {"success": True, "data": memories}


@router.post("/projects/{project_id}/context/memories/search")
async def search_memories(project_id: str, request: dict) -> dict:
    """Search memories (basic text search in web mode)."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": False, "error": "Project path not found"}

    query = request.get("query", "").lower()

    if not query:
        return {"success": True, "data": []}

    # Load all memories and filter
    all_memories = load_file_based_memories(project_path, 100)

    # Simple text search
    results = []
    for memory in all_memories:
        content = memory.get("content", "").lower()
        name = memory.get("name", "").lower()

        if query in content or query in name:
            results.append(
                {
                    **memory,
                    "score": 0.8 if query in name else 0.5,  # Basic relevance score
                }
            )

    # Sort by score
    results.sort(key=lambda r: r.get("score", 0), reverse=True)

    return {"success": True, "data": results[:20]}

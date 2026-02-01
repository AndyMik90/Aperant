"""
Roadmap Router
==============

Web API endpoints for roadmap generation and management.
"""

import asyncio
import json
import os
import signal
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .projects import load_projects

router = APIRouter()

# Track running roadmap processes (pid only; processes are detached)
# Maps project_id -> {"pid": int, "started_at": str, "log_file": str}
running_roadmaps: dict[str, dict[str, Any]] = {}

# File to persist running roadmap state (survives server restart)
RUNNING_ROADMAPS_FILE = (
    Path(__file__).parent.parent.parent / ".auto-claude" / "running_roadmaps.json"
)


class RoadmapStartRequest(BaseModel):
    """Request model for starting roadmap generation."""

    model: str | None = None
    thinking_level: str | None = None
    refresh: bool = False
    enable_competitor_analysis: bool = False
    refresh_competitor_analysis: bool = False


class RoadmapSaveRequest(BaseModel):
    """Request model for saving roadmap state from the frontend."""

    roadmap: dict[str, Any]


def _load_running_roadmaps() -> dict[str, dict[str, Any]]:
    if RUNNING_ROADMAPS_FILE.exists():
        try:
            with open(RUNNING_ROADMAPS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_running_roadmaps() -> None:
    RUNNING_ROADMAPS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(RUNNING_ROADMAPS_FILE, "w") as f:
        json.dump(running_roadmaps, f, indent=2)


def _is_process_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _cleanup_finished_roadmaps() -> None:
    finished = []
    for project_id, info in running_roadmaps.items():
        if not _is_process_running(info["pid"]):
            finished.append(project_id)
    for project_id in finished:
        del running_roadmaps[project_id]
    if finished:
        _save_running_roadmaps()


running_roadmaps = _load_running_roadmaps()
_cleanup_finished_roadmaps()


def get_project_path(project_id: str) -> Path:
    projects = load_projects()
    for p in projects:
        if p.get("id") == project_id:
            return Path(p.get("path", ""))
    raise HTTPException(status_code=404, detail="Project not found")


def get_roadmap_dir(project_path: Path) -> Path:
    return project_path / ".auto-claude" / "roadmap"


def get_roadmap_path(project_path: Path) -> Path:
    return get_roadmap_dir(project_path) / "roadmap.json"


def get_competitor_path(project_path: Path) -> Path:
    return get_roadmap_dir(project_path) / "competitor_analysis.json"


def _transform_competitor_analysis(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "projectContext": {
            "projectName": raw.get("project_context", {}).get("project_name", ""),
            "projectType": raw.get("project_context", {}).get("project_type", ""),
            "targetAudience": raw.get("project_context", {}).get("target_audience", ""),
        },
        "competitors": [
            {
                "id": c.get("id"),
                "name": c.get("name"),
                "url": c.get("url"),
                "description": c.get("description"),
                "relevance": c.get("relevance", "medium"),
                "painPoints": [
                    {
                        "id": p.get("id"),
                        "description": p.get("description"),
                        "source": p.get("source"),
                        "severity": p.get("severity", "medium"),
                        "frequency": p.get("frequency", ""),
                        "opportunity": p.get("opportunity", ""),
                    }
                    for p in c.get("pain_points", [])
                ],
                "strengths": c.get("strengths", []),
                "marketPosition": c.get("market_position", ""),
            }
            for c in raw.get("competitors", [])
        ],
        "marketGaps": [
            {
                "id": g.get("id"),
                "description": g.get("description"),
                "affectedCompetitors": g.get("affected_competitors", []),
                "opportunitySize": g.get("opportunity_size", "medium"),
                "suggestedFeature": g.get("suggested_feature", ""),
            }
            for g in raw.get("market_gaps", [])
        ],
        "insightsSummary": {
            "topPainPoints": raw.get("insights_summary", {}).get("top_pain_points", []),
            "differentiatorOpportunities": raw.get("insights_summary", {}).get(
                "differentiator_opportunities", []
            ),
            "marketTrends": raw.get("insights_summary", {}).get("market_trends", []),
        },
        "researchMetadata": {
            "searchQueriesUsed": raw.get("research_metadata", {}).get(
                "search_queries_used", []
            ),
            "sourcesConsulted": raw.get("research_metadata", {}).get(
                "sources_consulted", []
            ),
            "limitations": raw.get("research_metadata", {}).get("limitations", []),
        },
        "createdAt": raw.get("metadata", {}).get("created_at"),
    }


def _transform_roadmap(
    raw: dict[str, Any], project_id: str, project_name: str
) -> dict[str, Any]:
    def transform_milestone(m: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": m.get("id"),
            "title": m.get("title"),
            "description": m.get("description"),
            "features": m.get("features", []),
            "status": m.get("status", "planned"),
            "targetDate": m.get("target_date"),
        }

    def transform_phase(p: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": p.get("id"),
            "name": p.get("name"),
            "description": p.get("description"),
            "order": p.get("order"),
            "status": p.get("status", "planned"),
            "features": p.get("features", []),
            "milestones": [transform_milestone(m) for m in p.get("milestones", [])],
        }

    def transform_feature(f: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": f.get("id"),
            "title": f.get("title"),
            "description": f.get("description"),
            "rationale": f.get("rationale", ""),
            "priority": f.get("priority", "should"),
            "complexity": f.get("complexity", "medium"),
            "impact": f.get("impact", "medium"),
            "phaseId": f.get("phase_id") or f.get("phaseId") or "",
            "dependencies": f.get("dependencies", []),
            "status": f.get("status", "under_review"),
            "acceptanceCriteria": f.get("acceptance_criteria", []),
            "userStories": f.get("user_stories", []),
            "linkedSpecId": f.get("linked_spec_id"),
            "competitorInsightIds": f.get("competitor_insight_ids"),
        }

    target_audience = raw.get("target_audience", {})
    created_at = raw.get("metadata", {}).get("created_at") or raw.get("created_at")
    updated_at = raw.get("metadata", {}).get("updated_at") or raw.get("updated_at")

    return {
        "id": raw.get("id") or f"roadmap-{int(datetime.utcnow().timestamp())}",
        "projectId": project_id,
        "projectName": raw.get("project_name") or project_name,
        "version": raw.get("version", "1.0"),
        "vision": raw.get("vision", ""),
        "targetAudience": {
            "primary": target_audience.get("primary", ""),
            "secondary": target_audience.get("secondary", []),
        },
        "phases": [transform_phase(p) for p in raw.get("phases", [])],
        "features": [transform_feature(f) for f in raw.get("features", [])],
        "status": raw.get("status", "draft"),
        "createdAt": created_at or datetime.utcnow().isoformat(),
        "updatedAt": updated_at or datetime.utcnow().isoformat(),
    }


def _read_roadmap_log(log_path: Path) -> str:
    if not log_path.exists():
        return ""
    try:
        return log_path.read_text(errors="replace")[-20000:]
    except OSError:
        return ""


def _parse_roadmap_progress(log_text: str) -> dict[str, Any]:
    phase = "analyzing"
    progress = 10
    message = "Analyzing project structure..."

    if "PROJECT ANALYSIS" in log_text:
        phase = "analyzing"
        progress = 20
        message = "Analyzing project structure..."
    if "PROJECT DISCOVERY" in log_text:
        phase = "discovering"
        progress = 40
        message = "Discovering roadmap context..."
    if "FEATURE GENERATION" in log_text:
        phase = "generating"
        progress = 70
        message = "Generating roadmap features..."
    if "ROADMAP GENERATED" in log_text:
        phase = "complete"
        progress = 100
        message = "Roadmap generation complete"

    return {"phase": phase, "progress": progress, "message": message}


@router.get("/projects/{project_id}/roadmap")
async def get_roadmap(project_id: str) -> dict:
    project_path = get_project_path(project_id)
    roadmap_path = get_roadmap_path(project_path)

    if not roadmap_path.exists():
        return {"success": True, "data": None}

    try:
        raw = json.loads(roadmap_path.read_text())
        transformed = _transform_roadmap(raw, project_id, project_path.name)

        competitor_path = get_competitor_path(project_path)
        if competitor_path.exists():
            try:
                competitor_raw = json.loads(competitor_path.read_text())
                transformed["competitorAnalysis"] = _transform_competitor_analysis(
                    competitor_raw
                )
            except json.JSONDecodeError:
                pass

        return {"success": True, "data": transformed}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/roadmap/status")
async def get_roadmap_status(project_id: str) -> dict:
    _cleanup_finished_roadmaps()
    project_path = get_project_path(project_id)
    is_running = False
    log_file = None

    if project_id in running_roadmaps:
        info = running_roadmaps[project_id]
        is_running = _is_process_running(info["pid"])
        log_file = info.get("log_file")
        if not is_running:
            del running_roadmaps[project_id]
            _save_running_roadmaps()

    log_text = _read_roadmap_log(Path(log_file)) if log_file else ""
    progress_data = _parse_roadmap_progress(log_text)

    # If not running and roadmap exists, mark complete
    if not is_running:
        roadmap_path = get_roadmap_path(project_path)
        if roadmap_path.exists():
            progress_data = {
                "phase": "complete",
                "progress": 100,
                "message": "Roadmap generation complete",
            }
        else:
            progress_data = {
                "phase": "idle",
                "progress": 0,
                "message": "",
            }

    return {"success": True, "data": {"isRunning": is_running, **progress_data}}


@router.post("/projects/{project_id}/roadmap/generate")
async def generate_roadmap(project_id: str, request: RoadmapStartRequest) -> dict:
    _cleanup_finished_roadmaps()
    project_path = get_project_path(project_id)
    roadmap_dir = get_roadmap_dir(project_path)
    roadmap_dir.mkdir(parents=True, exist_ok=True)

    if project_id in running_roadmaps:
        pid = running_roadmaps[project_id]["pid"]
        if _is_process_running(pid):
            return {"success": True, "data": {"status": "already_running", "pid": pid}}
        del running_roadmaps[project_id]

    backend_dir = Path(__file__).parent.parent.parent
    run_script = backend_dir / "runners" / "roadmap_runner.py"

    if not run_script.exists():
        return {
            "success": False,
            "error": f"roadmap_runner.py not found at {run_script}",
        }

    log_file = roadmap_dir / "roadmap.log"
    cmd = [
        sys.executable,
        str(run_script),
        "--project",
        str(project_path),
    ]

    if request.model:
        cmd.extend(["--model", request.model])
    if request.thinking_level:
        cmd.extend(["--thinking-level", request.thinking_level])
    if request.refresh:
        cmd.append("--refresh")
    if request.enable_competitor_analysis:
        cmd.append("--competitor-analysis")
    if request.refresh_competitor_analysis:
        cmd.append("--refresh-competitor-analysis")

    try:
        with open(log_file, "a") as log_handle:
            log_handle.write(f"\n{'=' * 60}\n")
            log_handle.write(f"Roadmap started at: {datetime.utcnow().isoformat()}\n")
            log_handle.write(f"Command: {' '.join(cmd)}\n")
            log_handle.write(f"Project path: {project_path}\n")
            log_handle.write(f"{'=' * 60}\n\n")
            log_handle.flush()

            process = subprocess.Popen(
                cmd,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                cwd=str(project_path),
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
    except Exception as e:
        return {"success": False, "error": f"Failed to start roadmap: {e}"}

    running_roadmaps[project_id] = {
        "pid": process.pid,
        "started_at": datetime.utcnow().isoformat(),
        "log_file": str(log_file),
    }
    _save_running_roadmaps()

    return {
        "success": True,
        "data": {
            "status": "started",
            "pid": process.pid,
            "log_file": str(log_file),
            "message": "Roadmap running in background",
        },
    }


@router.post("/projects/{project_id}/roadmap/refresh")
async def refresh_roadmap(project_id: str, request: RoadmapStartRequest) -> dict:
    request.refresh = True
    return await generate_roadmap(project_id, request)


@router.post("/projects/{project_id}/roadmap/stop")
async def stop_roadmap(project_id: str) -> dict:
    _cleanup_finished_roadmaps()

    if project_id not in running_roadmaps:
        return {"success": True, "data": {"status": "not_running"}}

    pid = running_roadmaps[project_id]["pid"]

    try:
        if _is_process_running(pid):
            os.killpg(os.getpgid(pid), signal.SIGTERM)
            await asyncio.sleep(2)
            if _is_process_running(pid):
                os.killpg(os.getpgid(pid), signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass

    del running_roadmaps[project_id]
    _save_running_roadmaps()

    return {"success": True, "data": {"status": "stopped"}}


@router.patch("/projects/{project_id}/roadmap")
async def save_roadmap(project_id: str, request: RoadmapSaveRequest) -> dict:
    project_path = get_project_path(project_id)
    roadmap_path = get_roadmap_path(project_path)

    if not roadmap_path.exists():
        return {"success": False, "error": "Roadmap not found"}

    try:
        raw = json.loads(roadmap_path.read_text())
        roadmap = request.roadmap

        raw["features"] = [
            {
                "id": feature.get("id"),
                "title": feature.get("title"),
                "description": feature.get("description"),
                "rationale": feature.get("rationale", ""),
                "priority": feature.get("priority"),
                "complexity": feature.get("complexity"),
                "impact": feature.get("impact"),
                "phase_id": feature.get("phaseId"),
                "dependencies": feature.get("dependencies", []),
                "status": feature.get("status"),
                "acceptance_criteria": feature.get("acceptanceCriteria", []),
                "user_stories": feature.get("userStories", []),
                "linked_spec_id": feature.get("linkedSpecId"),
                "competitor_insight_ids": feature.get("competitorInsightIds"),
            }
            for feature in roadmap.get("features", [])
        ]

        raw.setdefault("metadata", {})
        raw["metadata"]["updated_at"] = datetime.utcnow().isoformat()

        roadmap_path.write_text(json.dumps(raw, indent=2))
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.patch("/projects/{project_id}/roadmap/features/{feature_id}")
async def update_feature_status(
    project_id: str, feature_id: str, request: dict
) -> dict:
    project_path = get_project_path(project_id)
    roadmap_path = get_roadmap_path(project_path)

    if not roadmap_path.exists():
        return {"success": False, "error": "Roadmap not found"}

    status = request.get("status")
    if not status:
        return {"success": False, "error": "Missing status"}

    try:
        raw = json.loads(roadmap_path.read_text())
        features = raw.get("features", [])
        feature = next((f for f in features if f.get("id") == feature_id), None)
        if not feature:
            return {"success": False, "error": "Feature not found"}

        feature["status"] = status
        raw.setdefault("metadata", {})
        raw["metadata"]["updated_at"] = datetime.utcnow().isoformat()
        roadmap_path.write_text(json.dumps(raw, indent=2))
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/projects/{project_id}/roadmap/convert-to-spec/{feature_id}")
async def convert_feature_to_spec(project_id: str, feature_id: str) -> dict:
    project_path = get_project_path(project_id)
    roadmap_path = get_roadmap_path(project_path)

    if not roadmap_path.exists():
        return {"success": False, "error": "Roadmap not found"}

    try:
        raw = json.loads(roadmap_path.read_text())
        feature = next(
            (f for f in raw.get("features", []) if f.get("id") == feature_id), None
        )
        if not feature:
            return {"success": False, "error": "Feature not found"}

        specs_dir = project_path / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True, exist_ok=True)

        existing_numbers = []
        for entry in specs_dir.iterdir():
            if entry.is_dir():
                try:
                    existing_numbers.append(int(entry.name.split("-")[0]))
                except ValueError:
                    pass

        next_number = max(existing_numbers, default=0) + 1
        spec_id = f"{next_number:03d}-roadmap-{uuid.uuid4().hex[:6]}"
        spec_dir = specs_dir / spec_id
        spec_dir.mkdir(parents=True, exist_ok=True)

        task_description = (
            f"# {feature.get('title', '')}\n\n"
            f"{feature.get('description', '')}\n\n"
            "## Rationale\n"
            f"{feature.get('rationale', 'N/A')}\n\n"
            "## User Stories\n"
            + "\n".join([f"- {s}" for s in feature.get("user_stories", [])])
            + "\n\n"
            "## Acceptance Criteria\n"
            + "\n".join([f"- [ ] {c}" for c in feature.get("acceptance_criteria", [])])
            + "\n"
        )

        (spec_dir / "spec.md").write_text(task_description)

        metadata = {
            "sourceType": "roadmap",
            "featureId": feature.get("id"),
            "category": "feature",
        }
        (spec_dir / "task_metadata.json").write_text(json.dumps(metadata, indent=2))

        feature["status"] = "planned"
        feature["linked_spec_id"] = spec_id
        raw.setdefault("metadata", {})
        raw["metadata"]["updated_at"] = datetime.utcnow().isoformat()
        roadmap_path.write_text(json.dumps(raw, indent=2))

        task = {
            "id": spec_id,
            "specId": spec_id,
            "projectId": project_id,
            "title": feature.get("title", ""),
            "description": task_description,
            "status": "backlog",
            "subtasks": [],
            "logs": [],
            "metadata": metadata,
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat(),
        }

        return {"success": True, "data": task}
    except Exception as e:
        return {"success": False, "error": str(e)}

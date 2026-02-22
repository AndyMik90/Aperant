"""
Spec Writing Module
===================

Spec document creation and validation.
"""

import json
from datetime import datetime
from pathlib import Path


def create_minimal_plan(spec_dir: Path, task_description: str) -> Path:
    """Create a minimal implementation plan for simple tasks."""
    timestamp = datetime.now().isoformat()
    plan = {
        "feature": task_description or spec_dir.name,
        "workflow_type": "simple",
        "phases": [
            {
                "id": "phase-1",
                "phase": 1,
                "name": "Implementation",
                "description": task_description or "Simple implementation",
                "depends_on": [],
                "subtasks": [
                    {
                        "id": "subtask-1-1",
                        "description": task_description or "Implement the change",
                        "service": "main",
                        "status": "pending",
                        "files_to_create": [],
                        "files_to_modify": [],
                        "patterns_from": [],
                        "verification": {
                            "type": "manual",
                            "instructions": "Verify the change works as expected",
                        },
                    }
                ],
            }
        ],
        "summary": {
            "total_phases": 1,
            "total_subtasks": 1,
            "recommended_workers": 1,
        },
        "created_at": timestamp,
        "updated_at": timestamp,
    }

    plan_file = spec_dir / "implementation_plan.json"
    with open(plan_file, "w", encoding="utf-8") as f:
        json.dump(plan, f, indent=2)

    return plan_file


def get_plan_stats(spec_dir: Path) -> dict:
    """Get statistics from implementation plan if available."""
    plan_file = spec_dir / "implementation_plan.json"
    if not plan_file.exists():
        return {}

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan_data = json.load(f)
        total_subtasks = sum(
            len(p.get("subtasks", [])) for p in plan_data.get("phases", [])
        )
        return {
            "total_subtasks": total_subtasks,
            "total_phases": len(plan_data.get("phases", [])),
        }
    except Exception:
        return {}

#!/usr/bin/env python3
"""
Predictive Bug Prevention - CLI Entry Point
============================================

Command-line interface for the bug prediction system.

Usage:
    python prediction.py <spec-dir> [--demo]
    python prediction.py auto-claude/specs/001-feature/
"""

import json
import sys
from pathlib import Path

from prediction import generate_subtask_checklist


def main():
    """Main entry point for CLI."""
    if len(sys.argv) < 2:
        print("Usage: python prediction.py <spec-dir> [--demo]")
        print("       python prediction.py auto-claude/specs/001-feature/")
        sys.exit(1)

    spec_dir = Path(sys.argv[1])

    if "--demo" in sys.argv:
        # Demo with sample subtask
        demo_subtask = {
            "id": "avatar-endpoint",
            "description": "POST /api/users/avatar endpoint for uploading user avatars",
            "service": "backend",
            "files_to_modify": ["app/routes/users.py"],
            "files_to_create": [],
            "patterns_from": ["app/routes/profile.py"],
            "verification": {
                "type": "api",
                "method": "POST",
                "url": "/api/users/avatar",
                "expect_status": 200,
            },
        }

        checklist_md = generate_subtask_checklist(spec_dir, demo_subtask)
        print(checklist_md)
    else:
        # Load from implementation plan
        plan_file = spec_dir / "implementation_plan.json"
        if not plan_file.exists():
            print(f"Error: No implementation_plan.json found in {spec_dir}")
            sys.exit(1)

        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        # Find first pending subtask
        subtask = None
        for phase in plan.get("phases", []):
            for c in phase.get("subtasks", []):
                if c.get("status") == "pending":
                    subtask = c
                    break
            if subtask:
                break

        if not subtask:
            print("No pending subtasks found")
            sys.exit(0)

        # Generate checklist
        checklist_md = generate_subtask_checklist(spec_dir, subtask)
        print(checklist_md)


if __name__ == "__main__":
    main()

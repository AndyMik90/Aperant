"""
Batch Task Management Commands
==============================

Commands for creating and managing multiple tasks from batch files.
"""

import json
import shutil
import subprocess
from pathlib import Path

from qa.criteria import is_fixes_applied, is_qa_approved, is_qa_rejected
from ui import highlight, print_status


def handle_batch_create_command(batch_file: str, project_dir: str) -> bool:
    """
    Create multiple tasks from a batch JSON file.

    Args:
        batch_file: Path to JSON file with task definitions
        project_dir: Project directory

    Returns:
        True if successful
    """
    batch_path = Path(batch_file)

    if not batch_path.exists():
        print_status(f"Batch file not found: {batch_file}", "error")
        return False

    try:
        with open(batch_path, encoding="utf-8") as f:
            batch_data = json.load(f)
    except json.JSONDecodeError as e:
        print_status(f"Invalid JSON in batch file: {e}", "error")
        return False

    tasks = batch_data.get("tasks", [])
    if not tasks:
        print_status("No tasks found in batch file", "warning")
        return False

    print_status(f"Creating {len(tasks)} tasks from batch file", "info")
    print()

    specs_dir = Path(project_dir) / ".auto-claude" / "specs"
    specs_dir.mkdir(parents=True, exist_ok=True)

    # Find next spec ID
    existing_specs = [d.name for d in specs_dir.iterdir() if d.is_dir()]
    next_id = (
        max([int(s.split("-")[0]) for s in existing_specs if s[0].isdigit()] or [0]) + 1
    )

    created_specs = []

    for idx, task in enumerate(tasks, 1):
        spec_id = f"{next_id:03d}"
        task_title = task.get("title", f"Task {idx}")
        task_slug = task_title.lower().replace(" ", "-")[:50]
        spec_name = f"{spec_id}-{task_slug}"
        spec_dir = specs_dir / spec_name
        spec_dir.mkdir(exist_ok=True)

        # Create requirements.json
        requirements = {
            "task_description": task.get("description", task_title),
            "description": task.get("description", task_title),
            "workflow_type": task.get("workflow_type", "feature"),
            "services_involved": task.get("services", ["frontend"]),
            "priority": task.get("priority", 5),
            "complexity_inferred": task.get("complexity", "standard"),
            "inferred_from": {},
            "created_at": Path(spec_dir).stat().st_mtime,
            "estimate": {
                "estimated_hours": task.get("estimated_hours", 4.0),
                "estimated_days": task.get("estimated_days", 0.5),
            },
        }

        req_file = spec_dir / "requirements.json"
        with open(req_file, "w", encoding="utf-8") as f:
            json.dump(requirements, f, indent=2, default=str)

        created_specs.append(
            {
                "id": spec_id,
                "name": spec_name,
                "title": task_title,
                "status": "pending_spec_creation",
            }
        )

        print_status(
            f"[{idx}/{len(tasks)}] Created {spec_id} - {task_title}", "success"
        )
        next_id += 1

    print()
    print_status(f"Created {len(created_specs)} spec(s) successfully", "success")
    print()

    # Show summary
    print(highlight("Next steps:"))
    print("  1. Generate specs: spec_runner.py --continue <spec_id>")
    print("  2. Approve specs and build them")
    print("  3. Run: python run.py --spec <id> to execute")

    return True


def handle_batch_status_command(project_dir: str) -> bool:
    """
    Show status of all specs in project.

    Args:
        project_dir: Project directory

    Returns:
        True if successful
    """
    specs_dir = Path(project_dir) / ".auto-claude" / "specs"

    if not specs_dir.exists():
        print_status("No specs found in project", "warning")
        return True

    specs = sorted([d for d in specs_dir.iterdir() if d.is_dir()])

    if not specs:
        print_status("No specs found", "warning")
        return True

    print_status(f"Found {len(specs)} spec(s)", "info")
    print()

    for spec_dir in specs:
        spec_name = spec_dir.name
        req_file = spec_dir / "requirements.json"

        status = "unknown"
        title = spec_name

        if req_file.exists():
            try:
                with open(req_file, encoding="utf-8") as f:
                    req = json.load(f)
                    title = req.get("task_description", title)
            except json.JSONDecodeError:
                pass

        # Determine status (highest priority first)
        # Use authoritative QA status check, not just file existence
        if is_qa_approved(spec_dir):
            status = "qa_approved"
        elif is_qa_rejected(spec_dir):
            status = "qa_rejected"
        elif is_fixes_applied(spec_dir):
            status = "fixes_applied"
        elif (spec_dir / "implementation_plan.json").exists():
            # Check if there's a qa_report.md but no approval yet (QA in progress)
            if (spec_dir / "qa_report.md").exists():
                status = "qa_in_progress"
            else:
                status = "building"
        elif (spec_dir / "spec.md").exists():
            status = "spec_created"
        else:
            status = "pending_spec"

        status_icon = {
            "pending_spec": "⏳",
            "spec_created": "📋",
            "building": "⚙️",
            "qa_in_progress": "🔍",
            "qa_approved": "✅",
            "qa_rejected": "❌",
            "fixes_applied": "🔧",
            "unknown": "❓",
        }.get(status, "❓")

        print(f"{status_icon} {spec_name:<40} {title}")

    return True


def handle_batch_cleanup_command(project_dir: str, dry_run: bool = True) -> bool:
    """
    Clean up completed specs and worktrees.

    Args:
        project_dir: Project directory
        dry_run: If True, show what would be deleted

    Returns:
        True if successful
    """
    specs_dir = Path(project_dir) / ".auto-claude" / "specs"
    worktrees_dir = Path(project_dir) / ".auto-claude" / "worktrees" / "tasks"

    if not specs_dir.exists():
        print_status("No specs directory found", "info")
        return True

    # Find completed specs (only QA-approved, matching status display logic)
    completed = []
    for spec_dir in specs_dir.iterdir():
        if spec_dir.is_dir() and is_qa_approved(spec_dir):
            completed.append(spec_dir.name)

    if not completed:
        print_status("No completed specs to clean up", "info")
        return True

    print_status(f"Found {len(completed)} completed spec(s)", "info")

    if dry_run:
        print()
        print("Would remove:")
        for spec_name in completed:
            print(f"  - {spec_name}")
            wt_path = worktrees_dir / spec_name
            if wt_path.exists():
                print(f"    └─ .auto-claude/worktrees/tasks/{spec_name}/")
        print()
        print("Run with --no-dry-run to actually delete")
    else:
        # Actually delete specs and worktrees
        deleted_count = 0
        for spec_name in completed:
            spec_path = specs_dir / spec_name
            wt_path = worktrees_dir / spec_name

            # Remove worktree first (if exists)
            if wt_path.exists():
                try:
                    result = subprocess.run(
                        ["git", "worktree", "remove", "--force", str(wt_path)],
                        cwd=project_dir,
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
                    if result.returncode == 0:
                        print_status(f"Removed worktree: {spec_name}", "success")
                    else:
                        # Fallback: remove directory manually if git fails
                        shutil.rmtree(wt_path, ignore_errors=True)
                        print_status(
                            f"Removed worktree directory: {spec_name}", "success"
                        )
                except subprocess.TimeoutExpired:
                    # Timeout: fall back to manual removal
                    shutil.rmtree(wt_path, ignore_errors=True)
                    print_status(
                        f"Worktree removal timed out, removed directory: {spec_name}",
                        "warning",
                    )
                except Exception as e:
                    print_status(
                        f"Failed to remove worktree {spec_name}: {e}", "warning"
                    )

            # Remove spec directory
            if spec_path.exists():
                try:
                    shutil.rmtree(spec_path)
                    print_status(f"Removed spec: {spec_name}", "success")
                    deleted_count += 1
                except Exception as e:
                    print_status(f"Failed to remove spec {spec_name}: {e}", "error")

        print()
        print_status(f"Cleaned up {deleted_count} spec(s)", "info")

    return True

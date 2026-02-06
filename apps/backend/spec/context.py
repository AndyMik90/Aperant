"""
Context Discovery Module
=========================

Discovers relevant files and context for the task.
"""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def run_context_discovery(
    project_dir: Path,
    spec_dir: Path,
    task_description: str,
    services: list[str],
) -> tuple[bool, str]:
    """Run context.py script to discover relevant files.

    Args:
        project_dir: Project root directory
        spec_dir: Spec directory
        task_description: Task description string
        services: List of service names involved

    Returns:
        (success, output_message)
    """
    context_file = spec_dir / "context.json"

    if context_file.exists():
        return True, "context.json already exists"

    script_path = project_dir / ".auto-claude" / "context.py"
    if not script_path.exists():
        return False, f"Script not found: {script_path}"

    args = [
        sys.executable,
        str(script_path),
        "--task",
        task_description or "unknown task",
        "--output",
        str(context_file),
    ]

    if services:
        args.extend(["--services", ",".join(services)])

    try:
        result = subprocess.run(
            args,
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode == 0 and context_file.exists():
            # Validate and fix common schema issues
            try:
                with open(context_file, encoding="utf-8") as f:
                    ctx = json.load(f)

                # Check for required field and fix common issues
                if "task_description" not in ctx:
                    # Common issue: field named "task" instead of "task_description"
                    if "task" in ctx:
                        ctx["task_description"] = ctx.pop("task")
                    else:
                        ctx["task_description"] = task_description or "unknown task"

                    with open(context_file, "w", encoding="utf-8") as f:
                        json.dump(ctx, f, indent=2)
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                context_file.unlink(missing_ok=True)
                return False, "Invalid context.json created"

            return True, "Created context.json"
        else:
            return False, result.stderr or result.stdout

    except subprocess.TimeoutExpired:
        return False, "Script timed out"
    except Exception as e:
        return False, str(e)


def create_minimal_context(
    spec_dir: Path,
    task_description: str,
    services: list[str],
) -> Path:
    """Create minimal context.json when script fails."""
    context_file = spec_dir / "context.json"

    minimal_context = {
        "task_description": task_description or "unknown task",
        "scoped_services": services,
        "files_to_modify": [],
        "files_to_reference": [],
        "created_at": datetime.now().isoformat(),
    }

    with open(context_file, "w", encoding="utf-8") as f:
        json.dump(minimal_context, f, indent=2)

    return context_file


def get_context_stats(spec_dir: Path) -> dict:
    """Get statistics from context file if available."""
    context_file = spec_dir / "context.json"
    if not context_file.exists():
        return {}

    try:
        with open(context_file, encoding="utf-8") as f:
            ctx = json.load(f)
        return {
            "files_to_modify": len(ctx.get("files_to_modify", [])),
            "files_to_reference": len(ctx.get("files_to_reference", [])),
        }
    except Exception:
        return {}

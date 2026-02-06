"""
Requirements Gathering Module
==============================

Interactive and automated requirements collection from users.
"""

import json
import os
import shlex
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path


def open_editor_for_input(field_name: str) -> str:
    """Open the user's editor for long-form text input."""
    editor = os.environ.get("EDITOR", os.environ.get("VISUAL", "nano"))

    # Create temp file with helpful instructions
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".md", delete=False, encoding="utf-8"
    ) as f:
        f.write(f"# Enter your {field_name.replace('_', ' ')} below\n")
        f.write("# Lines starting with # will be ignored\n")
        f.write("# Save and close the editor when done\n\n")
        temp_path = f.name

    try:
        # Parse editor command (handles "code --wait" etc.)
        editor_cmd = shlex.split(editor)
        editor_cmd.append(temp_path)

        # Open editor
        result = subprocess.run(editor_cmd)

        if result.returncode != 0:
            return ""

        # Read the content
        with open(temp_path, encoding="utf-8") as f:
            lines = f.readlines()

        # Filter out comment lines and join
        content_lines = [
            line.rstrip() for line in lines if not line.strip().startswith("#")
        ]
        return "\n".join(content_lines).strip()

    finally:
        # Clean up temp file
        try:
            os.unlink(temp_path)
        except OSError:
            pass


def gather_requirements_interactively(ui_module) -> dict:
    """Gather requirements interactively from the user via CLI prompts.

    Args:
        ui_module: UI module with formatting functions (bold, muted, etc.)
    """
    print()
    print(f"  {ui_module.muted('Answer the following questions to define your task:')}")
    print()

    # Task description - multi-line support with editor option
    print(f"  {ui_module.bold('1. What do you want to build or fix?')}")
    print(f"     {ui_module.muted('(Describe the feature, bug fix, or change)')}")
    edit_hint = 'Type "edit" to open in your editor, or enter text below'
    print(f"     {ui_module.muted(edit_hint)}")
    print(
        f"     {ui_module.muted('(Press Enter often for new lines, blank line = done)')}"
    )

    task = ""
    task_lines = []
    while True:
        try:
            line = input("     > " if not task_lines else "       ")

            # Check for editor command on first line
            if not task_lines and line.strip().lower() == "edit":
                task = open_editor_for_input("task_description")
                if task:
                    print(
                        f"     {ui_module.muted(f'Got {len(task)} chars from editor')}"
                    )
                break

            if not line and task_lines:  # Blank line and we have content = done
                break
            if line:
                task_lines.append(line)
        except EOFError:
            break

    # If we collected lines (not from editor)
    if task_lines:
        task = " ".join(task_lines).strip()

    if not task:
        task = "No task description provided"
    print()

    # Workflow type
    print(f"  {ui_module.bold('2. What type of work is this?')}")
    print(f"     {ui_module.muted('[1] feature  - New functionality')}")
    print(f"     {ui_module.muted('[2] bugfix   - Fix existing issue')}")
    print(f"     {ui_module.muted('[3] refactor - Improve code structure')}")
    print(f"     {ui_module.muted('[4] docs     - Documentation changes')}")
    print(f"     {ui_module.muted('[5] test     - Add or improve tests')}")
    workflow_choice = input("     > ").strip()
    workflow_map = {
        "1": "feature",
        "feature": "feature",
        "2": "bugfix",
        "bugfix": "bugfix",
        "3": "refactor",
        "refactor": "refactor",
        "4": "docs",
        "docs": "docs",
        "5": "test",
        "test": "test",
    }
    workflow_type = workflow_map.get(workflow_choice.lower(), "feature")
    print()

    # Additional context (optional) - multi-line support
    print(f"  {ui_module.bold('3. Any additional context or constraints?')}")
    print(
        f"     {ui_module.muted('(Press Enter to skip, or enter a blank line when done)')}"
    )

    context_lines = []
    while True:
        try:
            line = input("     > " if not context_lines else "       ")
            if not line:  # Blank line = done (allows skip on first empty)
                break
            context_lines.append(line)
        except EOFError:
            break

    additional_context = " ".join(context_lines).strip()
    print()

    return {
        "task_description": task,
        "workflow_type": workflow_type,
        "services_involved": [],  # AI will discover this during planning and context fetching
        "additional_context": additional_context if additional_context else None,
        "created_at": datetime.now().isoformat(),
    }


def create_requirements_from_task(task_description: str) -> dict:
    """Create minimal requirements dictionary from task description."""
    return {
        "task_description": task_description,
        "workflow_type": "feature",  # Default, agent will refine
        "services_involved": [],  # AI will discover during planning and context fetching
        "created_at": datetime.now().isoformat(),
    }


def save_requirements(spec_dir: Path, requirements: dict) -> Path:
    """Save requirements to file."""
    requirements_file = spec_dir / "requirements.json"
    with open(requirements_file, "w", encoding="utf-8") as f:
        json.dump(requirements, f, indent=2)
    return requirements_file


def load_requirements(spec_dir: Path) -> dict | None:
    """Load requirements from file if it exists."""
    requirements_file = spec_dir / "requirements.json"
    if not requirements_file.exists():
        return None

    with open(requirements_file, encoding="utf-8") as f:
        return json.load(f)

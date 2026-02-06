"""
Followup Commands
=================

CLI commands for adding follow-up tasks to completed specs.
"""

import asyncio
import json
import sys
from pathlib import Path

# Ensure parent directory is in path for imports (before other imports)
_PARENT_DIR = Path(__file__).parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from progress import count_subtasks, is_build_complete
from ui import (
    Icons,
    MenuOption,
    bold,
    box,
    error,
    highlight,
    icon,
    muted,
    print_status,
    select_menu,
    success,
    warning,
)


def collect_followup_task(spec_dir: Path, max_retries: int = 3) -> str | None:
    """
    Collect a follow-up task description from the user.

    Provides multiple input methods (type, paste, file) similar to the
    HUMAN_INPUT.md pattern used during build interrupts. Includes retry
    logic for empty input.

    Args:
        spec_dir: The spec directory where FOLLOWUP_REQUEST.md will be saved
        max_retries: Maximum number of times to prompt on empty input (default: 3)

    Returns:
        The collected task description, or None if cancelled
    """
    retry_count = 0

    while retry_count < max_retries:
        # Present options menu
        options = [
            MenuOption(
                key="type",
                label="Type follow-up task",
                icon=Icons.EDIT,
                description="Enter a description of additional work needed",
            ),
            MenuOption(
                key="paste",
                label="Paste from clipboard",
                icon=Icons.CLIPBOARD,
                description="Paste text you've copied (Cmd+V / Ctrl+Shift+V)",
            ),
            MenuOption(
                key="file",
                label="Read from file",
                icon=Icons.DOCUMENT,
                description="Load task description from a text file",
            ),
            MenuOption(
                key="quit",
                label="Cancel",
                icon=Icons.DOOR,
                description="Exit without adding follow-up",
            ),
        ]

        # Show retry message if this is a retry
        subtitle = "Describe the additional work you want to add to this spec."
        if retry_count > 0:
            subtitle = warning(
                f"Empty input received. Please try again. ({max_retries - retry_count} attempts remaining)"
            )

        choice = select_menu(
            title="How would you like to provide your follow-up task?",
            options=options,
            subtitle=subtitle,
            allow_quit=False,  # We have explicit quit option
        )

        if choice == "quit" or choice is None:
            return None

        followup_task = ""

        if choice == "file":
            # Read from file
            print()
            print(
                f"{icon(Icons.DOCUMENT)} Enter the path to your task description file:"
            )
            try:
                file_path_str = input(f"  {icon(Icons.POINTER)} ").strip()
            except (KeyboardInterrupt, EOFError):
                print()
                print_status("Cancelled.", "warning")
                return None

            # Handle empty file path
            if not file_path_str:
                print()
                print_status("No file path provided.", "warning")
                retry_count += 1
                continue

            try:
                # Expand ~ and resolve path
                file_path = Path(file_path_str).expanduser().resolve()
                if file_path.exists():
                    followup_task = file_path.read_text(encoding="utf-8").strip()
                    if followup_task:
                        print_status(
                            f"Loaded {len(followup_task)} characters from file",
                            "success",
                        )
                    else:
                        print()
                        print_status(
                            "File is empty. Please provide a file with task description.",
                            "error",
                        )
                        retry_count += 1
                        continue
                else:
                    print_status(f"File not found: {file_path}", "error")
                    print(
                        muted("  Check that the path is correct and the file exists.")
                    )
                    retry_count += 1
                    continue
            except PermissionError:
                print_status(f"Permission denied: cannot read {file_path_str}", "error")
                print(muted("  Check file permissions and try again."))
                retry_count += 1
                continue
            except Exception as e:
                print_status(f"Error reading file: {e}", "error")
                retry_count += 1
                continue

        elif choice in ["type", "paste"]:
            print()
            content = [
                "Enter/paste your follow-up task description below.",
                "",
                muted("Describe what additional work you want to add."),
                muted("The planner will create new subtasks based on this."),
                "",
                muted("Press Enter on an empty line when done."),
            ]
            print(box(content, width=60, style="light"))
            print()

            lines = []
            empty_count = 0
            while True:
                try:
                    line = input()
                    if line == "":
                        empty_count += 1
                        if empty_count >= 1:  # Stop on first empty line
                            break
                    else:
                        empty_count = 0
                        lines.append(line)
                except KeyboardInterrupt:
                    print()
                    print_status("Cancelled.", "warning")
                    return None
                except EOFError:
                    break

            followup_task = "\n".join(lines).strip()

        # Validate that we have content
        if not followup_task:
            print()
            print_status("No task description provided.", "warning")
            retry_count += 1
            continue

        # Save to FOLLOWUP_REQUEST.md
        request_file = spec_dir / "FOLLOWUP_REQUEST.md"
        request_file.write_text(followup_task, encoding="utf-8")

        # Show confirmation
        content = [
            success(f"{icon(Icons.SUCCESS)} FOLLOW-UP TASK SAVED"),
            "",
            f"Saved to: {highlight(str(request_file.name))}",
            "",
            muted("The planner will create new subtasks based on this task."),
        ]
        print()
        print(box(content, width=70, style="heavy"))

        return followup_task

    # Max retries exceeded
    print()
    print_status("Maximum retry attempts reached. Follow-up cancelled.", "error")
    return None


def handle_followup_command(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    verbose: bool = False,
) -> None:
    """
    Handle the --followup command.

    Args:
        project_dir: Project root directory
        spec_dir: Spec directory path
        model: Model to use
        verbose: Enable verbose output
    """
    # Lazy imports to avoid loading heavy modules
    from agent import run_followup_planner

    from .utils import print_banner, validate_environment

    print_banner()
    print(f"\nFollow-up request for: {spec_dir.name}")

    # Check if implementation_plan.json exists
    plan_file = spec_dir / "implementation_plan.json"
    if not plan_file.exists():
        print()
        print(error(f"{icon(Icons.ERROR)} No implementation plan found."))
        print()
        content = [
            "This spec has not been built yet.",
            "",
            "Follow-up tasks can only be added to specs that have been",
            "built at least once. Run a regular build first:",
            "",
            highlight(f"  python auto-claude/run.py --spec {spec_dir.name}"),
            "",
            muted("After the build completes, you can add follow-up tasks."),
        ]
        print(box(content, width=70, style="light"))
        sys.exit(1)

    # Check if build is complete
    if not is_build_complete(spec_dir):
        completed, total = count_subtasks(spec_dir)
        pending = total - completed
        print()
        print(
            error(
                f"{icon(Icons.ERROR)} Build not complete ({completed}/{total} subtasks)."
            )
        )
        print()
        content = [
            f"There are still {pending} pending subtask(s) to complete.",
            "",
            "Follow-up tasks can only be added after all current subtasks",
            "are finished. Complete the current build first:",
            "",
            highlight(f"  python auto-claude/run.py --spec {spec_dir.name}"),
            "",
            muted("The build will continue from where it left off."),
        ]
        print(box(content, width=70, style="light"))
        sys.exit(1)

    # Check for prior follow-ups (for sequential follow-up context)
    prior_followup_count = 0
    try:
        with open(plan_file, encoding="utf-8") as f:
            plan_data = json.load(f)
        phases = plan_data.get("phases", [])
        # Count phases that look like follow-up phases (name contains "Follow" or high phase number)
        for phase in phases:
            phase_name = phase.get("name", "")
            if "follow" in phase_name.lower() or "followup" in phase_name.lower():
                prior_followup_count += 1
    except (json.JSONDecodeError, KeyError):
        pass  # If plan parsing fails, just continue without prior count

    # Build is complete - proceed to follow-up workflow
    print()
    if prior_followup_count > 0:
        print(
            success(
                f"{icon(Icons.SUCCESS)} Build is complete ({prior_followup_count} prior follow-up(s)). Ready for more follow-up tasks."
            )
        )
    else:
        print(
            success(
                f"{icon(Icons.SUCCESS)} Build is complete. Ready for follow-up tasks."
            )
        )

    # Collect follow-up task from user
    followup_task = collect_followup_task(spec_dir)

    if followup_task is None:
        # User cancelled
        print()
        print_status("Follow-up cancelled.", "info")
        return

    # Successfully collected follow-up task
    # The collect_followup_task() function already saved to FOLLOWUP_REQUEST.md
    # Now run the follow-up planner to add new subtasks
    print()

    if not validate_environment(spec_dir):
        sys.exit(1)

    try:
        success_result = asyncio.run(
            run_followup_planner(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model=model,
                verbose=verbose,
            )
        )

        if success_result:
            # Show next steps after successful planning
            content = [
                bold(f"{icon(Icons.SUCCESS)} FOLLOW-UP PLANNING COMPLETE"),
                "",
                "New subtasks have been added to your implementation plan.",
                "",
                highlight("To continue building:"),
                f"  python auto-claude/run.py --spec {spec_dir.name}",
            ]
            print(box(content, width=70, style="heavy"))
        else:
            # Planning didn't fully succeed
            content = [
                bold(f"{icon(Icons.WARNING)} FOLLOW-UP PLANNING INCOMPLETE"),
                "",
                "Check the implementation plan manually.",
                "",
                muted("You may need to run the follow-up again."),
            ]
            print(box(content, width=70, style="light"))
            sys.exit(1)

    except KeyboardInterrupt:
        print("\n\nFollow-up planning paused.")
        print(f"To retry: python auto-claude/run.py --spec {spec_dir.name} --followup")
        sys.exit(0)
    except Exception as e:
        print()
        print(error(f"{icon(Icons.ERROR)} Follow-up planning error: {e}"))
        if verbose:
            import traceback

            traceback.print_exc()
        sys.exit(1)

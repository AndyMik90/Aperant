"""
QA Commands
===========

CLI commands for QA validation (run QA, check status)
"""

import asyncio
import sys
from pathlib import Path

# Ensure parent directory is in path for imports (before other imports)
_PARENT_DIR = Path(__file__).parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from progress import count_subtasks
from qa_loop import (
    is_qa_approved,
    print_qa_status,
    run_qa_validation_loop,
    should_run_qa,
)
from review import ReviewState, display_review_status
from ui import (
    Icons,
    icon,
    info,
    success,
    warning,
)

from .utils import print_banner, validate_environment


def handle_qa_status_command(spec_dir: Path) -> None:
    """
    Handle the --qa-status command.

    Args:
        spec_dir: Spec directory path
    """
    print_banner()
    print(f"\nSpec: {spec_dir.name}\n")
    print_qa_status(spec_dir)


def handle_review_status_command(spec_dir: Path) -> None:
    """
    Handle the --review-status command.

    Args:
        spec_dir: Spec directory path
    """
    print_banner()
    print(f"\nSpec: {spec_dir.name}\n")
    display_review_status(spec_dir)
    # Also show if approval is valid for build
    review_state = ReviewState.load(spec_dir)
    print()
    if review_state.is_approval_valid(spec_dir):
        print(success(f"{icon(Icons.SUCCESS)} Ready to build - approval is valid."))
    elif review_state.approved:
        print(
            warning(
                f"{icon(Icons.WARNING)} Spec changed since approval - re-review required."
            )
        )
    else:
        print(info(f"{icon(Icons.INFO)} Review required before building."))
    print()


def handle_qa_command(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    verbose: bool = False,
) -> None:
    """
    Handle the --qa command (run QA validation loop).

    Args:
        project_dir: Project root directory
        spec_dir: Spec directory path
        model: Model to use for QA
        verbose: Enable verbose output
    """
    print_banner()
    print(f"\nRunning QA validation for: {spec_dir.name}")
    if not validate_environment(spec_dir):
        sys.exit(1)

    # Check if there's pending human feedback that needs to be processed
    # Human feedback takes priority over "already approved" status
    fix_request_file = spec_dir / "QA_FIX_REQUEST.md"
    has_human_feedback = fix_request_file.exists()

    if not should_run_qa(spec_dir) and not has_human_feedback:
        if is_qa_approved(spec_dir):
            print("\n✅ Build already approved by QA.")
        else:
            completed, total = count_subtasks(spec_dir)
            print(
                f"\n❌ Build not ready for QA ({completed}/{total} subtasks completed)."
            )
            print(
                "All subtasks must reach a terminal state (completed, failed, or stuck) before running QA."
            )
        return

    if has_human_feedback:
        print("\n📝 Human feedback detected - processing fix request...")

    try:
        approved = asyncio.run(
            run_qa_validation_loop(
                project_dir=project_dir,
                spec_dir=spec_dir,
                model=model,
                verbose=verbose,
            )
        )
        if approved:
            print("\n✅ QA validation passed. Ready for merge.")
        else:
            print("\n❌ QA validation incomplete. See reports for details.")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n\nQA validation paused.")
        print(f"Resume with: python auto-claude/run.py --spec {spec_dir.name} --qa")

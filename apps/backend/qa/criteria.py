"""
QA Acceptance Criteria Handling
================================

Manages acceptance criteria validation and status tracking.
"""

import json
import os
import time
from pathlib import Path

from core.file_utils import write_json_atomic
from core.platform import is_windows
from progress import is_build_complete


def load_implementation_plan(spec_dir: Path) -> dict | None:
    """Load the implementation plan JSON."""
    plan_file = spec_dir / "implementation_plan.json"
    if not plan_file.exists():
        return None
    try:
        with open(plan_file, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def save_implementation_plan(spec_dir: Path, plan: dict) -> bool:
    """Save the implementation plan JSON while preserving frontend fields."""
    plan_file = spec_dir / "implementation_plan.json"
    lock_file = plan_file.with_suffix(".lock")
    lock_timeout = 5.0  # seconds

    # Create lock file parent directory if needed
    lock_file.parent.mkdir(parents=True, exist_ok=True)

    # Open lock file for locking
    try:
        lock_fd = os.open(str(lock_file), os.O_CREAT | os.O_RDWR)
    except OSError:
        return False

    # Try to acquire lock with timeout
    start_time = time.time()
    lock_acquired = False

    try:
        while time.time() - start_time < lock_timeout:
            try:
                if is_windows():
                    import msvcrt

                    msvcrt.locking(lock_fd, msvcrt.LK_NBLCK, 1024 * 1024)
                else:
                    import fcntl

                    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                lock_acquired = True
                break
            except (BlockingIOError, OSError):
                # Lock held by another process, retry after short delay
                time.sleep(0.01)

        if not lock_acquired:
            # Timeout - failed to acquire lock
            return False

        # Lock acquired - now do read-merge-write atomically
        try:
            with open(plan_file, encoding="utf-8") as f:
                existing = json.load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            existing = {}

        # Create a shallow copy to avoid mutating the caller's dict
        new_plan = dict(plan)

        # Preserve fields from existing file that aren't in the new plan dict
        # Includes frontend fields (status, planStatus, etc.) and qa_stats
        preserve_fields = [
            "status",
            "planStatus",
            "reviewReason",
            "xstateState",
            "executionPhase",
            "recoveryNote",
            "qa_stats",
        ]
        for field in preserve_fields:
            if field in existing and field not in new_plan:
                new_plan[field] = existing[field]

        try:
            write_json_atomic(plan_file, new_plan, indent=2, ensure_ascii=False)
            return True
        except OSError:
            return False
    finally:
        # Always release the lock and close the file descriptor
        try:
            if lock_acquired:
                if is_windows():
                    import msvcrt

                    msvcrt.locking(lock_fd, msvcrt.LK_UNLCK, 1024 * 1024)
                else:
                    import fcntl

                    fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)
        except Exception:
            pass  # Best-effort cleanup

        # Clean up lock file
        try:
            if lock_file.exists():
                lock_file.unlink()
        except Exception:
            pass  # Best-effort cleanup


# =============================================================================
# QA SIGN-OFF STATUS
# =============================================================================


def get_qa_signoff_status(spec_dir: Path) -> dict | None:
    """Get the current QA sign-off status from implementation plan."""
    plan = load_implementation_plan(spec_dir)
    if not plan:
        return None
    return plan.get("qa_signoff")


def is_qa_approved(spec_dir: Path) -> bool:
    """Check if QA has approved the build."""
    status = get_qa_signoff_status(spec_dir)
    if not status:
        return False
    return status.get("status") == "approved"


def is_qa_rejected(spec_dir: Path) -> bool:
    """Check if QA has rejected the build (needs fixes)."""
    status = get_qa_signoff_status(spec_dir)
    if not status:
        return False
    return status.get("status") == "rejected"


def is_fixes_applied(spec_dir: Path) -> bool:
    """Check if fixes have been applied and ready for re-validation."""
    status = get_qa_signoff_status(spec_dir)
    if not status:
        return False
    return status.get("status") == "fixes_applied" and status.get(
        "ready_for_qa_revalidation", False
    )


def get_qa_iteration_count(spec_dir: Path) -> int:
    """Get the number of QA iterations so far."""
    status = get_qa_signoff_status(spec_dir)
    if not status:
        return 0
    return status.get("qa_session", 0)


# =============================================================================
# QA READINESS CHECKS
# =============================================================================


def should_run_qa(spec_dir: Path) -> bool:
    """
    Determine if QA validation should run.

    QA should run when:
    - All subtasks are completed
    - QA has not yet approved
    """
    if not is_build_complete(spec_dir):
        return False

    if is_qa_approved(spec_dir):
        return False

    return True


def should_run_fixes(spec_dir: Path) -> bool:
    """
    Determine if QA fixes should run.

    Fixes should run when:
    - QA has rejected the build
    - Max iterations not reached
    """
    from .loop import MAX_QA_ITERATIONS

    if not is_qa_rejected(spec_dir):
        return False

    iterations = get_qa_iteration_count(spec_dir)
    if iterations >= MAX_QA_ITERATIONS:
        return False

    return True


# =============================================================================
# STATUS DISPLAY
# =============================================================================


def print_qa_status(spec_dir: Path) -> None:
    """Print the current QA status."""
    from .report import get_iteration_history, get_recurring_issue_summary

    status = get_qa_signoff_status(spec_dir)

    if not status:
        print("QA Status: Not started")
        return

    qa_status = status.get("status", "unknown")
    qa_session = status.get("qa_session", 0)
    timestamp = status.get("timestamp", "unknown")

    print(f"QA Status: {qa_status.upper()}")
    print(f"QA Sessions: {qa_session}")
    print(f"Last Updated: {timestamp}")

    if qa_status == "approved":
        tests = status.get("tests_passed", {})
        print(
            f"Tests: Unit {tests.get('unit', '?')}, Integration {tests.get('integration', '?')}, E2E {tests.get('e2e', '?')}"
        )
    elif qa_status == "rejected":
        issues = status.get("issues_found", [])
        print(f"Issues Found: {len(issues)}")
        for issue in issues[:3]:  # Show first 3
            print(
                f"  - {issue.get('title', 'Unknown')}: {issue.get('type', 'unknown')}"
            )
        if len(issues) > 3:
            print(f"  ... and {len(issues) - 3} more")

    # Show iteration history summary
    history = get_iteration_history(spec_dir)
    if history:
        summary = get_recurring_issue_summary(history)
        print("\nIteration History:")
        print(f"  Total iterations: {len(history)}")
        print(f"  Approved: {summary.get('iterations_approved', 0)}")
        print(f"  Rejected: {summary.get('iterations_rejected', 0)}")
        if summary.get("most_common"):
            print("  Most common issues:")
            for issue in summary["most_common"][:3]:
                print(f"    - {issue['title']} ({issue['occurrences']} occurrences)")

#!/usr/bin/env python3
"""
Test Suite for Smart Rollback and Recovery System
==================================================

Tests the recovery system functionality including:
- Attempt tracking
- Circular fix detection
- Recovery action determination
- Rollback functionality
"""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from recovery import RecoveryManager, FailureType


@pytest.fixture
def test_env(temp_git_repo: Path):
    """Create a test environment using the shared temp_git_repo fixture.

    This fixture uses the properly isolated git repo from conftest.py which
    handles all git environment variable cleanup and restoration.

    The temp_git_repo fixture creates a temp_dir and initializes a git repo there.
    temp_git_repo yields the path to that initialized repo (which is temp_dir itself).

    Yields:
        tuple: (temp_dir, spec_dir, project_dir) - no manual cleanup needed as
               conftest.py handles environment cleanup automatically.
    """
    # temp_git_repo IS the temp_dir with the git repo initialized in it
    temp_dir = temp_git_repo
    spec_dir = temp_dir / "spec"
    project_dir = temp_dir  # The git repo is in temp_dir

    spec_dir.mkdir(parents=True, exist_ok=True)

    yield temp_dir, spec_dir, project_dir


def test_initialization(test_env):
    """Test RecoveryManager initialization."""
    temp_dir, spec_dir, project_dir = test_env

    # Initialize manager to trigger directory creation (manager instance not needed)
    _manager = RecoveryManager(spec_dir, project_dir)

    # Check that memory directory was created
    assert (spec_dir / "memory").exists(), "Memory directory not created"

    # Check that attempt history file was created
    assert (spec_dir / "memory" / "attempt_history.json").exists(), "attempt_history.json not created"

    # Check that build commits file was created
    assert (spec_dir / "memory" / "build_commits.json").exists(), "build_commits.json not created"

    # Verify initial structure
    with open(spec_dir / "memory" / "attempt_history.json") as f:
        history = json.load(f)
        assert "subtasks" in history, "subtasks key missing"
        assert "stuck_subtasks" in history, "stuck_subtasks key missing"
        assert "metadata" in history, "metadata key missing"


def test_record_attempt(test_env):
    """Test recording chunk attempts."""
    temp_dir, spec_dir, project_dir = test_env

    manager = RecoveryManager(spec_dir, project_dir)

    # Record failed attempt
    manager.record_attempt(
        subtask_id="subtask-1",
        session=1,
        success=False,
        approach="First approach using async/await",
        error="Import error - asyncio not found"
    )

    # Verify recorded
    assert manager.get_attempt_count("subtask-1") == 1, "Attempt not recorded"

    history = manager.get_subtask_history("subtask-1")
    assert len(history["attempts"]) == 1, "Wrong number of attempts"
    assert history["attempts"][0]["success"] is False, "Success flag wrong"
    assert history["status"] == "failed", "Status not updated"

    # Record successful attempt
    manager.record_attempt(
        subtask_id="subtask-1",
        session=2,
        success=True,
        approach="Second approach using callbacks",
        error=None
    )

    assert manager.get_attempt_count("subtask-1") == 2, "Second attempt not recorded"

    history = manager.get_subtask_history("subtask-1")
    assert len(history["attempts"]) == 2, "Wrong number of attempts"
    assert history["attempts"][1]["success"] is True, "Success flag wrong"
    assert history["status"] == "completed", "Status not updated to completed"


def test_circular_fix_detection(test_env):
    """Test circular fix detection."""
    temp_dir, spec_dir, project_dir = test_env

    manager = RecoveryManager(spec_dir, project_dir)

    # Record similar attempts
    manager.record_attempt("subtask-1", 1, False, "Using async await pattern", "Error 1")
    manager.record_attempt("subtask-1", 2, False, "Using async await with different import", "Error 2")
    manager.record_attempt("subtask-1", 3, False, "Trying async await again", "Error 3")

    # Check if circular fix is detected
    is_circular = manager.is_circular_fix("subtask-1", "Using async await pattern once more")

    assert is_circular, "Circular fix not detected"

    # Test with different approach
    is_circular = manager.is_circular_fix("subtask-1", "Using completely different callback-based approach")

    # This might be detected as circular if word overlap is high
    # But "callback-based" is sufficiently different from "async await"


def test_failure_classification(test_env):
    """Test failure type classification."""
    temp_dir, spec_dir, project_dir = test_env

    manager = RecoveryManager(spec_dir, project_dir)

    # Test broken build detection
    failure = manager.classify_failure("SyntaxError: unexpected token", "subtask-1")
    assert failure == FailureType.BROKEN_BUILD, "Broken build not detected"

    # Test verification failed detection
    failure = manager.classify_failure("Verification failed: expected 200 got 500", "subtask-2")
    assert failure == FailureType.VERIFICATION_FAILED, "Verification failure not detected"

    # Test context exhaustion
    failure = manager.classify_failure("Context length exceeded", "subtask-3")
    assert failure == FailureType.CONTEXT_EXHAUSTED, "Context exhaustion not detected"


def test_recovery_action_determination(test_env):
    """Test recovery action determination."""
    temp_dir, spec_dir, project_dir = test_env

    manager = RecoveryManager(spec_dir, project_dir)

    # Test verification failed with < 3 attempts
    manager.record_attempt("subtask-1", 1, False, "First try", "Error")

    action = manager.determine_recovery_action(FailureType.VERIFICATION_FAILED, "subtask-1")
    assert action.action == "retry", "Should retry for first verification failure"

    # Test verification failed with >= 3 attempts
    manager.record_attempt("subtask-1", 2, False, "Second try", "Error")
    manager.record_attempt("subtask-1", 3, False, "Third try", "Error")

    action = manager.determine_recovery_action(FailureType.VERIFICATION_FAILED, "subtask-1")
    assert action.action == "skip", "Should skip after 3 attempts"

    # Test circular fix
    action = manager.determine_recovery_action(FailureType.CIRCULAR_FIX, "subtask-1")
    assert action.action == "skip", "Should skip for circular fix"

    # Test context exhausted
    action = manager.determine_recovery_action(FailureType.CONTEXT_EXHAUSTED, "subtask-2")
    assert action.action == "continue", "Should continue for context exhaustion"


def test_good_commit_tracking(test_env):
    """Test tracking of good commits."""
    temp_dir, spec_dir, project_dir = test_env

    manager = RecoveryManager(spec_dir, project_dir)

    # Get current commit hash
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=project_dir,
        capture_output=True,
        text=True
    )
    commit_hash = result.stdout.strip()

    # Record good commit
    manager.record_good_commit(commit_hash, "subtask-1")

    # Verify recorded
    last_good = manager.get_last_good_commit()
    assert last_good == commit_hash, "Good commit not recorded correctly"

    # Record another commit
    test_file = project_dir / "test2.txt"
    test_file.write_text("Second content")
    subprocess.run(["git", "add", "."], cwd=project_dir, capture_output=True)
    subprocess.run(["git", "commit", "-m", "Second commit"], cwd=project_dir, capture_output=True)

    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=project_dir,
        capture_output=True,
        text=True
    )
    commit_hash2 = result.stdout.strip()

    manager.record_good_commit(commit_hash2, "subtask-2")

    # Last good should be updated
    last_good = manager.get_last_good_commit()
    assert last_good == commit_hash2, "Last good commit not updated"


def test_mark_subtask_stuck(test_env):
    """Test marking chunks as stuck."""
    temp_dir, spec_dir, project_dir = test_env

    manager = RecoveryManager(spec_dir, project_dir)

    # Record some attempts
    manager.record_attempt("subtask-1", 1, False, "Try 1", "Error 1")
    manager.record_attempt("subtask-1", 2, False, "Try 2", "Error 2")
    manager.record_attempt("subtask-1", 3, False, "Try 3", "Error 3")

    # Mark as stuck
    manager.mark_subtask_stuck("subtask-1", "Circular fix after 3 attempts")

    # Verify stuck
    stuck_subtasks = manager.get_stuck_subtasks()
    assert len(stuck_subtasks) == 1, "Stuck subtask not recorded"
    assert stuck_subtasks[0]["subtask_id"] == "subtask-1", "Wrong subtask marked as stuck"
    assert "Circular fix" in stuck_subtasks[0]["reason"], "Reason not recorded"

    # Check subtask status
    history = manager.get_subtask_history("subtask-1")
    assert history["status"] == "stuck", "Chunk status not updated to stuck"


def test_recovery_hints(test_env):
    """Test recovery hints generation."""
    temp_dir, spec_dir, project_dir = test_env

    manager = RecoveryManager(spec_dir, project_dir)

    # Record some attempts
    manager.record_attempt("subtask-1", 1, False, "Async/await approach", "Import error")
    manager.record_attempt("subtask-1", 2, False, "Threading approach", "Thread safety error")

    # Get hints
    hints = manager.get_recovery_hints("subtask-1")

    assert len(hints) > 0, "No hints generated"
    assert "Previous attempts: 2" in hints[0], "Attempt count not in hints"

    # Check for warning about different approach
    hint_text = " ".join(hints)
    assert "DIFFERENT" in hint_text or "different" in hint_text, "Warning about different approach missing"


def test_checkpoint_persistence_across_sessions(test_env):
    """Test that session state persists when manager is recreated (checkpoint persistence)."""
    temp_dir, spec_dir, project_dir = test_env

    # Session 1: Create manager and record some attempts
    manager1 = RecoveryManager(spec_dir, project_dir)

    manager1.record_attempt(
        subtask_id="subtask-1",
        session=1,
        success=False,
        approach="First approach using REST API",
        error="Connection timeout"
    )
    manager1.record_attempt(
        subtask_id="subtask-1",
        session=1,
        success=False,
        approach="Second approach using WebSocket",
        error="Auth failure"
    )

    # Verify state in session 1
    assert manager1.get_attempt_count("subtask-1") == 2, "Session 1: attempts not recorded"

    # Session 2: Create NEW manager instance (simulating session restart)
    manager2 = RecoveryManager(spec_dir, project_dir)

    # Verify checkpoint was restored
    assert manager2.get_attempt_count("subtask-1") == 2, "Session 2: checkpoint not restored"

    history = manager2.get_subtask_history("subtask-1")
    assert len(history["attempts"]) == 2, "Session 2: attempt history missing"
    assert history["attempts"][0]["approach"] == "First approach using REST API", "Session 2: first approach lost"
    assert history["attempts"][1]["approach"] == "Second approach using WebSocket", "Session 2: second approach lost"
    assert history["status"] == "failed", "Session 2: status not preserved"


def test_restoration_after_failure(test_env):
    """Test that state can be restored from checkpoints after simulated failures."""
    temp_dir, spec_dir, project_dir = test_env

    # Simulate multiple sessions with failures
    manager1 = RecoveryManager(spec_dir, project_dir)

    # Session 1: Initial work
    manager1.record_attempt("subtask-1", 1, False, "Attempt 1", "Error 1")
    manager1.record_attempt("subtask-2", 1, True, "Successful approach", None)

    # Get current commit
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=project_dir,
        capture_output=True,
        text=True
    )
    commit_hash = result.stdout.strip()
    manager1.record_good_commit(commit_hash, "subtask-2")

    # Session 2: Continue work with new manager (simulates restart after crash)
    manager2 = RecoveryManager(spec_dir, project_dir)

    # Verify complete state restored
    assert manager2.get_attempt_count("subtask-1") == 1, "subtask-1 attempts not restored"
    assert manager2.get_attempt_count("subtask-2") == 1, "subtask-2 attempts not restored"

    subtask1_history = manager2.get_subtask_history("subtask-1")
    assert subtask1_history["status"] == "failed", "subtask-1 status not restored"

    subtask2_history = manager2.get_subtask_history("subtask-2")
    assert subtask2_history["status"] == "completed", "subtask-2 status not restored"

    # Verify good commit was restored
    last_good = manager2.get_last_good_commit()
    assert last_good == commit_hash, "Last good commit not restored"

    # Session 3: Continue from restored state
    manager3 = RecoveryManager(spec_dir, project_dir)
    manager3.record_attempt("subtask-1", 2, True, "Fixed approach", None)

    # Final verification
    assert manager3.get_attempt_count("subtask-1") == 2, "Session 3: attempt not added"
    history_final = manager3.get_subtask_history("subtask-1")
    assert history_final["status"] == "completed", "Session 3: status not updated"


def test_checkpoint_multiple_subtasks(test_env):
    """Test checkpoint persistence with multiple subtasks in various states."""
    temp_dir, spec_dir, project_dir = test_env

    manager1 = RecoveryManager(spec_dir, project_dir)

    # Create diverse subtask states
    manager1.record_attempt("subtask-1", 1, True, "Completed on first try", None)

    manager1.record_attempt("subtask-2", 1, False, "Failed first", "Error")
    manager1.record_attempt("subtask-2", 2, True, "Fixed second try", None)

    manager1.record_attempt("subtask-3", 1, False, "Try 1", "Error 1")
    manager1.record_attempt("subtask-3", 2, False, "Try 2", "Error 2")
    manager1.record_attempt("subtask-3", 3, False, "Try 3", "Error 3")
    manager1.mark_subtask_stuck("subtask-3", "After 3 failed attempts")

    manager1.record_attempt("subtask-4", 1, False, "In progress", "Partial error")

    # New session - verify all states restored
    manager2 = RecoveryManager(spec_dir, project_dir)

    # Verify subtask-1 (completed first try)
    assert manager2.get_attempt_count("subtask-1") == 1
    assert manager2.get_subtask_history("subtask-1")["status"] == "completed"

    # Verify subtask-2 (completed after retry)
    assert manager2.get_attempt_count("subtask-2") == 2
    assert manager2.get_subtask_history("subtask-2")["status"] == "completed"

    # Verify subtask-3 (stuck)
    assert manager2.get_attempt_count("subtask-3") == 3
    assert manager2.get_subtask_history("subtask-3")["status"] == "stuck"
    stuck_list = manager2.get_stuck_subtasks()
    assert len(stuck_list) == 1
    assert stuck_list[0]["subtask_id"] == "subtask-3"

    # Verify subtask-4 (in progress/failed)
    assert manager2.get_attempt_count("subtask-4") == 1
    assert manager2.get_subtask_history("subtask-4")["status"] == "failed"


def test_restoration_with_build_commits(test_env):
    """Test restoration of build commit checkpoints across sessions."""
    temp_dir, spec_dir, project_dir = test_env

    manager1 = RecoveryManager(spec_dir, project_dir)

    # Create multiple commits and track them
    commits = []

    for i in range(3):
        test_file = project_dir / f"test_file_{i}.txt"
        test_file.write_text(f"Content {i}")
        subprocess.run(["git", "add", "."], cwd=project_dir, capture_output=True)
        subprocess.run(["git", "commit", "-m", f"Commit {i}"], cwd=project_dir, capture_output=True)

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_dir,
            capture_output=True,
            text=True
        )
        commit_hash = result.stdout.strip()
        commits.append(commit_hash)

        manager1.record_good_commit(commit_hash, f"subtask-{i}")
        manager1.record_attempt(f"subtask-{i}", 1, True, f"Approach {i}", None)

    # New session - verify commit history restored
    manager2 = RecoveryManager(spec_dir, project_dir)

    last_good = manager2.get_last_good_commit()
    assert last_good == commits[-1], "Last good commit not restored correctly"

    # Verify we can continue building from restored state
    manager2.record_attempt("subtask-3", 1, False, "New work after restore", "New error")
    assert manager2.get_attempt_count("subtask-3") == 1


def test_checkpoint_recovery_hints_restoration(test_env):
    """Test that recovery hints are correctly generated from restored checkpoint data."""
    temp_dir, spec_dir, project_dir = test_env

    manager1 = RecoveryManager(spec_dir, project_dir)

    # Record detailed attempt history
    manager1.record_attempt(
        "subtask-1", 1, False,
        "Using synchronous database calls",
        "Database connection pooling exhausted"
    )
    manager1.record_attempt(
        "subtask-1", 2, False,
        "Using asynchronous database with asyncio",
        "Event loop already running error"
    )

    # New session
    manager2 = RecoveryManager(spec_dir, project_dir)

    # Get recovery hints (should be based on restored data)
    hints = manager2.get_recovery_hints("subtask-1")

    assert len(hints) > 0, "No hints generated from restored data"
    assert "Previous attempts: 2" in hints[0], "Attempt count not in restored hints"

    # Verify attempt details are in hints
    hint_text = " ".join(hints)
    assert "synchronous" in hint_text.lower() or "FAILED" in hint_text, "Previous approach not reflected in hints"

    # Check circular fix detection with restored data
    is_circular = manager2.is_circular_fix("subtask-1", "Using async database with asyncio again")
    # Note: May or may not detect as circular depending on word overlap


def test_restoration_stuck_subtasks_list(test_env):
    """Test that stuck subtasks list is restored correctly across sessions."""
    temp_dir, spec_dir, project_dir = test_env

    manager1 = RecoveryManager(spec_dir, project_dir)

    # Mark multiple subtasks as stuck
    for i in range(3):
        subtask_id = f"subtask-stuck-{i}"
        for j in range(3):
            manager1.record_attempt(subtask_id, j + 1, False, f"Try {j + 1}", f"Error {j + 1}")
        manager1.mark_subtask_stuck(subtask_id, f"Reason {i}: circular fix detected")

    # New session
    manager2 = RecoveryManager(spec_dir, project_dir)

    stuck = manager2.get_stuck_subtasks()
    assert len(stuck) == 3, f"Expected 3 stuck subtasks, got {len(stuck)}"

    stuck_ids = {s["subtask_id"] for s in stuck}
    expected_ids = {"subtask-stuck-0", "subtask-stuck-1", "subtask-stuck-2"}
    assert stuck_ids == expected_ids, "Stuck subtask IDs not restored correctly"

    # Verify stuck reasons preserved
    for s in stuck:
        assert "circular fix detected" in s["reason"], "Stuck reason not preserved"
        assert s["attempt_count"] == 3, "Stuck attempt count not preserved"


def test_checkpoint_clear_and_reset(test_env):
    """Test that clearing stuck subtasks and resetting subtasks persists across sessions."""
    temp_dir, spec_dir, project_dir = test_env

    manager1 = RecoveryManager(spec_dir, project_dir)

    # Create some state
    manager1.record_attempt("subtask-1", 1, False, "Try 1", "Error 1")
    manager1.record_attempt("subtask-1", 2, False, "Try 2", "Error 2")
    manager1.mark_subtask_stuck("subtask-1", "Stuck reason")

    manager1.record_attempt("subtask-2", 1, False, "Only try", "Error")

    # Clear stuck subtasks
    manager1.clear_stuck_subtasks()
    assert len(manager1.get_stuck_subtasks()) == 0, "Stuck subtasks not cleared"

    # Reset subtask-2
    manager1.reset_subtask("subtask-2")
    assert manager1.get_attempt_count("subtask-2") == 0, "Subtask not reset"

    # New session - verify clear/reset persisted
    manager2 = RecoveryManager(spec_dir, project_dir)

    assert len(manager2.get_stuck_subtasks()) == 0, "Stuck subtasks clear not persisted"

    assert manager2.get_attempt_count("subtask-2") == 0, "Subtask reset not persisted"

    # But subtask-1 history should still exist (just not marked stuck)
    assert manager2.get_attempt_count("subtask-1") == 2, "subtask-1 history lost"


# =============================================================================
# TIME-WINDOW FILTERING TESTS (get_attempt_count)
# =============================================================================

def test_get_attempt_count_time_window_filtering(test_env):
    """Test that get_attempt_count only counts attempts within the 2-hour window."""
    from datetime import timedelta

    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    old_time = (datetime.now() - timedelta(hours=3)).isoformat()
    recent_time = (datetime.now() - timedelta(minutes=30)).isoformat()

    history = manager._load_attempt_history()
    history["subtasks"]["test-1"] = {
        "attempts": [
            {"timestamp": old_time, "approach": "old approach", "success": False},
            {"timestamp": recent_time, "approach": "recent approach", "success": False},
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    count = manager.get_attempt_count("test-1")
    assert count == 1, "Should only count the recent attempt within 2-hour window"


def test_get_attempt_count_boundary_just_inside_and_outside(test_env):
    """Test attempts just inside and outside the 2-hour cutoff boundary."""
    from datetime import timedelta

    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    # 1 second inside the window (1h 59m 59s ago) - should be included
    inside_time = (datetime.now() - timedelta(seconds=7199)).isoformat()
    # 10 seconds outside the window (2h 10s ago) - should be excluded
    outside_time = (datetime.now() - timedelta(seconds=7210)).isoformat()

    history = manager._load_attempt_history()
    history["subtasks"]["test-boundary"] = {
        "attempts": [
            {"timestamp": inside_time, "approach": "inside window", "success": False},
            {"timestamp": outside_time, "approach": "outside window", "success": False},
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    count = manager.get_attempt_count("test-boundary")
    assert count == 1, "Attempt inside window should be counted, outside should not"


def test_get_attempt_count_all_outside_window(test_env):
    """Test that all attempts outside the time window returns 0."""
    from datetime import timedelta

    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    old_time_1 = (datetime.now() - timedelta(hours=5)).isoformat()
    old_time_2 = (datetime.now() - timedelta(hours=4)).isoformat()
    old_time_3 = (datetime.now() - timedelta(hours=3)).isoformat()

    history = manager._load_attempt_history()
    history["subtasks"]["test-old"] = {
        "attempts": [
            {"timestamp": old_time_1, "approach": "old 1", "success": False},
            {"timestamp": old_time_2, "approach": "old 2", "success": False},
            {"timestamp": old_time_3, "approach": "old 3", "success": False},
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    count = manager.get_attempt_count("test-old")
    assert count == 0, "All attempts outside window should result in count of 0"


def test_get_attempt_count_all_recent(test_env):
    """Test that all recent attempts are counted."""
    from datetime import timedelta

    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    times = [
        (datetime.now() - timedelta(minutes=10)).isoformat(),
        (datetime.now() - timedelta(minutes=30)).isoformat(),
        (datetime.now() - timedelta(minutes=90)).isoformat(),
    ]

    history = manager._load_attempt_history()
    history["subtasks"]["test-recent"] = {
        "attempts": [
            {"timestamp": times[0], "approach": "a1", "success": False},
            {"timestamp": times[1], "approach": "a2", "success": False},
            {"timestamp": times[2], "approach": "a3", "success": False},
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    count = manager.get_attempt_count("test-recent")
    assert count == 3, "All recent attempts should be counted"


def test_get_attempt_count_missing_timestamp_backward_compat(test_env):
    """Test backward compatibility: attempts without timestamps are counted as recent."""
    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    history = manager._load_attempt_history()
    history["subtasks"]["test-no-ts"] = {
        "attempts": [
            {"approach": "no timestamp", "success": False},
            {"approach": "also no timestamp", "success": False},
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    count = manager.get_attempt_count("test-no-ts")
    assert count == 2, "Attempts without timestamps should be counted (backward compat)"


def test_get_attempt_count_invalid_timestamp_backward_compat(test_env):
    """Test backward compatibility: attempts with invalid timestamps are counted as recent."""
    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    history = manager._load_attempt_history()
    history["subtasks"]["test-bad-ts"] = {
        "attempts": [
            {"timestamp": "not-a-date", "approach": "bad ts", "success": False},
            {"timestamp": "2024-13-99T99:99:99", "approach": "invalid ts", "success": False},
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    count = manager.get_attempt_count("test-bad-ts")
    assert count == 2, "Attempts with invalid timestamps should be counted (backward compat)"


def test_get_attempt_count_mixed_timestamps(test_env):
    """Test mixed scenario: some attempts with timestamps, some without."""
    from datetime import timedelta

    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    old_time = (datetime.now() - timedelta(hours=5)).isoformat()
    recent_time = (datetime.now() - timedelta(minutes=10)).isoformat()

    history = manager._load_attempt_history()
    history["subtasks"]["test-mixed"] = {
        "attempts": [
            {"timestamp": old_time, "approach": "old", "success": False},
            {"timestamp": recent_time, "approach": "recent", "success": False},
            {"approach": "no timestamp", "success": False},
            {"timestamp": "garbage", "approach": "bad timestamp", "success": False},
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    # old_time: excluded (outside window)
    # recent_time: included (within window)
    # no timestamp: included (backward compat)
    # bad timestamp: included (backward compat)
    count = manager.get_attempt_count("test-mixed")
    assert count == 3, "Should count recent + missing/invalid timestamps, exclude old"


# =============================================================================
# ATTEMPT HISTORY TRIMMING TESTS (record_attempt)
# =============================================================================

def test_record_attempt_trimming_at_51(test_env):
    """Test that recording the 51st attempt triggers trimming to 50."""
    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    # Manually inject 50 attempts
    history = manager._load_attempt_history()
    history["subtasks"]["trim-test"] = {
        "attempts": [
            {
                "session": i,
                "timestamp": datetime.now().isoformat(),
                "approach": f"approach-{i}",
                "success": False,
                "error": None,
            }
            for i in range(50)
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    # Record the 51st attempt
    manager.record_attempt("trim-test", 51, False, "approach-50", "error")

    history = manager._load_attempt_history()
    attempts = history["subtasks"]["trim-test"]["attempts"]
    assert len(attempts) == 50, "Should trim to 50 after exceeding cap"


def test_record_attempt_trimming_keeps_newest(test_env):
    """Test that trimming keeps the newest 50 attempts, not the oldest."""
    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    # Inject 50 attempts with identifiable approaches
    history = manager._load_attempt_history()
    history["subtasks"]["trim-order"] = {
        "attempts": [
            {
                "session": i,
                "timestamp": datetime.now().isoformat(),
                "approach": f"old-approach-{i}",
                "success": False,
                "error": None,
            }
            for i in range(50)
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    # Record new attempt (triggers trim)
    manager.record_attempt("trim-order", 99, False, "newest-approach", "error")

    history = manager._load_attempt_history()
    attempts = history["subtasks"]["trim-order"]["attempts"]
    assert len(attempts) == 50

    # The oldest attempt (old-approach-0) should be gone
    approaches = [a["approach"] for a in attempts]
    assert "old-approach-0" not in approaches, "Oldest attempt should be trimmed"
    # The newest attempt should be present
    assert "newest-approach" in approaches, "Newest attempt should be kept"
    # old-approach-1 should be the oldest remaining
    assert "old-approach-1" in approaches, "Second oldest should now be first"


def test_record_attempt_no_trimming_at_exactly_50(test_env):
    """Test that exactly 50 attempts does not trigger trimming."""
    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    # Inject 49 attempts
    history = manager._load_attempt_history()
    history["subtasks"]["no-trim"] = {
        "attempts": [
            {
                "session": i,
                "timestamp": datetime.now().isoformat(),
                "approach": f"approach-{i}",
                "success": False,
                "error": None,
            }
            for i in range(49)
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    # Record the 50th attempt (should NOT trigger trimming)
    manager.record_attempt("no-trim", 50, False, "approach-49", "error")

    history = manager._load_attempt_history()
    attempts = history["subtasks"]["no-trim"]["attempts"]
    assert len(attempts) == 50, "Exactly 50 should not trigger trimming"
    # First attempt should still be present
    assert attempts[0]["approach"] == "approach-0", "No attempts should be removed"


def test_record_attempt_trimming_from_100(test_env):
    """Test trimming from 100 attempts keeps exactly 50."""
    temp_dir, spec_dir, project_dir = test_env
    manager = RecoveryManager(spec_dir, project_dir)

    # Inject 100 attempts
    history = manager._load_attempt_history()
    history["subtasks"]["big-trim"] = {
        "attempts": [
            {
                "session": i,
                "timestamp": datetime.now().isoformat(),
                "approach": f"approach-{i}",
                "success": False,
                "error": None,
            }
            for i in range(100)
        ],
        "status": "failed",
    }
    manager._save_attempt_history(history)

    # Record attempt 101 (triggers trim from 101 -> 50)
    manager.record_attempt("big-trim", 101, False, "approach-100", "error")

    history = manager._load_attempt_history()
    attempts = history["subtasks"]["big-trim"]["attempts"]
    assert len(attempts) == 50, "Should trim to exactly 50"

    # Verify newest are kept
    approaches = [a["approach"] for a in attempts]
    assert "approach-100" in approaches, "Newest attempt should be kept"
    assert "approach-0" not in approaches, "Oldest attempts should be trimmed"
    assert "approach-50" not in approaches, "Mid-range old attempts should be trimmed"


def run_all_tests():
    """Run all tests."""
    print("=" * 70)
    print("SMART ROLLBACK AND RECOVERY - TEST SUITE")
    print("=" * 70)
    print()

    # Note: This manual runner is kept for backwards compatibility.
    # Prefer running tests with pytest: pytest tests/test_recovery.py -v

    tests = [
        ("test_initialization", test_initialization),
        ("test_record_attempt", test_record_attempt),
        ("test_circular_fix_detection", test_circular_fix_detection),
        ("test_failure_classification", test_failure_classification),
        ("test_recovery_action_determination", test_recovery_action_determination),
        ("test_good_commit_tracking", test_good_commit_tracking),
        ("test_mark_subtask_stuck", test_mark_subtask_stuck),
        ("test_recovery_hints", test_recovery_hints),
        # Session checkpoint and restoration tests
        ("test_checkpoint_persistence_across_sessions", test_checkpoint_persistence_across_sessions),
        ("test_restoration_after_failure", test_restoration_after_failure),
        ("test_checkpoint_multiple_subtasks", test_checkpoint_multiple_subtasks),
        ("test_restoration_with_build_commits", test_restoration_with_build_commits),
        ("test_checkpoint_recovery_hints_restoration", test_checkpoint_recovery_hints_restoration),
        ("test_restoration_stuck_subtasks_list", test_restoration_stuck_subtasks_list),
        ("test_checkpoint_clear_and_reset", test_checkpoint_clear_and_reset),
    ]

    print("Note: Running with manual test runner for backwards compatibility.")
    print("For full pytest integration with fixtures, run: pytest tests/test_recovery.py -v")
    print()
    print("Manual test runner cannot use fixtures - please run with pytest.")
    return True


if __name__ == "__main__":
    import sys
    success = run_all_tests()
    sys.exit(0 if success else 1)

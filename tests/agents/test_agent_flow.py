#!/usr/bin/env python3
"""
Test Suite for Agent Flow Integration
======================================

Tests for planner→coder→QA state transitions including:
- Planner to coder transition logic
- Handoff data preservation
- Post-session processing for different subtask states
- State transition detection and handling

Note: Uses temp_git_repo fixture from conftest.py for proper git isolation.
"""

import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "apps" / "backend"))


# =============================================================================
# TEST FIXTURES
# =============================================================================

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


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def create_implementation_plan(spec_dir: Path, subtasks: list[dict]) -> Path:
    """Create an implementation_plan.json with the given subtasks."""
    plan = {
        "feature": "Test Feature",
        "workflow_type": "feature",
        "status": "in_progress",
        "phases": [
            {
                "id": "phase-1",
                "name": "Test Phase",
                "type": "implementation",
                "subtasks": subtasks
            }
        ]
    }
    plan_file = spec_dir / "implementation_plan.json"
    plan_file.write_text(json.dumps(plan, indent=2))
    return plan_file


def get_latest_commit(project_dir: Path) -> str:
    """Get the hash of the latest git commit."""
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=project_dir,
        capture_output=True,
        text=True
    )
    return result.stdout.strip() if result.returncode == 0 else ""


# =============================================================================
# PLANNER TO CODER TRANSITION TESTS
# =============================================================================

class TestPlannerToCoderTransition:
    """Tests for the planner→coder state transition logic."""

    def test_first_run_flag_indicates_planner_mode(self, test_env):
        """Test that first_run=True indicates planner mode."""
        from prompts import is_first_run

        temp_dir, spec_dir, project_dir = test_env

        # Empty spec directory - should be first run (planner mode)
        assert is_first_run(spec_dir) is True, "Empty spec should be first run"

        # Create implementation plan - should no longer be first run
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Test task", "status": "pending"}
        ])

        assert is_first_run(spec_dir) is False, "Spec with plan should not be first run"

    def test_transition_from_planning_to_coding_phase(self, test_env):
        """Test that planning phase transitions to coding phase correctly."""
        from progress import get_next_subtask

        temp_dir, spec_dir, project_dir = test_env

        # Create implementation plan with pending subtask
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Implement feature", "status": "pending"}
        ])

        # After planner creates plan, get_next_subtask should return the first pending subtask
        next_subtask = get_next_subtask(spec_dir)

        assert next_subtask is not None, "Should find next subtask after planning"
        assert next_subtask.get("id") == "subtask-1", "Should return first pending subtask"
        assert next_subtask.get("status") == "pending", "Subtask should be pending"

    def test_planner_completion_enables_coder_session(self, test_env):
        """Test that planner completion (plan created) enables coder session."""
        from progress import is_build_complete, count_subtasks

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with pending subtasks
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "pending"},
            {"id": "subtask-2", "description": "Task 2", "status": "pending"}
        ])

        # Build should not be complete - coder needs to work
        assert is_build_complete(spec_dir) is False, "Build should not be complete with pending subtasks"

        # Should have subtasks to work on
        completed, total = count_subtasks(spec_dir)
        assert total == 2, "Should have 2 total subtasks"
        assert completed == 0, "Should have 0 completed subtasks"

    def test_planning_to_coding_subtask_info_preserved(self, test_env):
        """Test that subtask information is preserved during phase transition."""
        from agents.utils import load_implementation_plan, find_subtask_in_plan

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with detailed subtask info
        subtask_data = {
            "id": "subtask-1",
            "description": "Implement user authentication",
            "status": "pending",
            "files_to_modify": ["app/auth.py", "app/routes.py"],
            "files_to_create": ["app/services/oauth.py"],
            "patterns_from": ["tests/test_auth.py"],
            "verification": {
                "type": "command",
                "command": "pytest tests/test_auth.py -v"
            }
        }
        create_implementation_plan(spec_dir, [subtask_data])

        # Load plan and find subtask
        plan = load_implementation_plan(spec_dir)
        subtask = find_subtask_in_plan(plan, "subtask-1")

        # Verify all data preserved
        assert subtask is not None, "Should find subtask in plan"
        assert subtask["id"] == "subtask-1", "ID should be preserved"
        assert subtask["description"] == "Implement user authentication", "Description preserved"
        assert subtask["files_to_modify"] == ["app/auth.py", "app/routes.py"], "Files to modify preserved"
        assert subtask["files_to_create"] == ["app/services/oauth.py"], "Files to create preserved"
        assert subtask["verification"]["command"] == "pytest tests/test_auth.py -v", "Verification preserved"


# =============================================================================
# POST-SESSION PROCESSING TESTS
# =============================================================================

class TestPostSessionProcessing:
    """Tests for post_session_processing function."""

    async def test_completed_subtask_records_success(self, test_env):
        """Test that completed subtask is recorded as successful."""
        from recovery import RecoveryManager
        from agents.session import post_session_processing

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with completed subtask
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Test task", "status": "completed"}
        ])

        recovery_manager = RecoveryManager(spec_dir, project_dir)
        commit_before = get_latest_commit(project_dir)

        # Mock memory-related functions to avoid side effects
        with patch("agents.session.extract_session_insights", new_callable=AsyncMock) as mock_insights, \
             patch("agents.session.save_session_memory", new_callable=AsyncMock) as mock_memory:

            mock_insights.return_value = {"file_insights": [], "patterns_discovered": []}
            mock_memory.return_value = (True, "file")

            result = await post_session_processing(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id="subtask-1",
                session_num=1,
                commit_before=commit_before,
                commit_count_before=1,
                recovery_manager=recovery_manager,
                linear_enabled=False,
            )

        assert result is True, "Completed subtask should return True"

        # Verify attempt was recorded
        history = recovery_manager.get_subtask_history("subtask-1")
        assert len(history["attempts"]) == 1, "Should have 1 attempt"
        assert history["attempts"][0]["success"] is True, "Attempt should be successful"
        assert history["status"] == "completed", "Status should be completed"

    async def test_in_progress_subtask_records_failure(self, test_env):
        """Test that in_progress subtask is recorded as incomplete."""
        from recovery import RecoveryManager
        from agents.session import post_session_processing

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with in_progress subtask
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Test task", "status": "in_progress"}
        ])

        recovery_manager = RecoveryManager(spec_dir, project_dir)
        commit_before = get_latest_commit(project_dir)

        # Mock check_and_recover to prevent the recovery flow from resetting attempt history
        with patch("agents.session.extract_session_insights", new_callable=AsyncMock) as mock_insights, \
             patch("agents.session.save_session_memory", new_callable=AsyncMock) as mock_memory, \
             patch("agents.session.check_and_recover", return_value=None):

            mock_insights.return_value = {"file_insights": [], "patterns_discovered": []}
            mock_memory.return_value = (True, "file")

            result = await post_session_processing(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id="subtask-1",
                session_num=1,
                commit_before=commit_before,
                commit_count_before=1,
                recovery_manager=recovery_manager,
                linear_enabled=False,
            )

        assert result is False, "In-progress subtask should return False"

        # Verify attempt was recorded as failed
        history = recovery_manager.get_subtask_history("subtask-1")
        assert len(history["attempts"]) == 1, "Should have 1 attempt"
        assert history["attempts"][0]["success"] is False, "Attempt should be unsuccessful"

    async def test_pending_subtask_records_failure(self, test_env):
        """Test that pending (no progress) subtask is recorded as failure."""
        from recovery import RecoveryManager
        from agents.session import post_session_processing

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with pending subtask (no progress made)
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Test task", "status": "pending"}
        ])

        recovery_manager = RecoveryManager(spec_dir, project_dir)
        commit_before = get_latest_commit(project_dir)

        with patch("agents.session.extract_session_insights", new_callable=AsyncMock) as mock_insights, \
             patch("agents.session.save_session_memory", new_callable=AsyncMock) as mock_memory:

            mock_insights.return_value = {"file_insights": [], "patterns_discovered": []}
            mock_memory.return_value = (True, "file")

            result = await post_session_processing(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id="subtask-1",
                session_num=1,
                commit_before=commit_before,
                commit_count_before=1,
                recovery_manager=recovery_manager,
                linear_enabled=False,
            )

        assert result is False, "Pending subtask should return False"


# =============================================================================
# SUBTASK STATE TRANSITION TESTS
# =============================================================================

class TestSubtaskStateTransitions:
    """Tests for subtask state transition handling."""

    def test_find_subtask_in_plan(self, test_env):
        """Test finding a subtask by ID in the plan."""
        from agents.utils import load_implementation_plan, find_subtask_in_plan

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "First task", "status": "completed"},
            {"id": "subtask-2", "description": "Second task", "status": "pending"},
            {"id": "subtask-3", "description": "Third task", "status": "pending"}
        ])

        plan = load_implementation_plan(spec_dir)

        # Test finding existing subtasks
        subtask1 = find_subtask_in_plan(plan, "subtask-1")
        assert subtask1 is not None, "Should find subtask-1"
        assert subtask1["description"] == "First task"

        subtask2 = find_subtask_in_plan(plan, "subtask-2")
        assert subtask2 is not None, "Should find subtask-2"
        assert subtask2["status"] == "pending"

        # Test finding non-existent subtask
        missing = find_subtask_in_plan(plan, "subtask-999")
        assert missing is None, "Should return None for missing subtask"

    def test_find_phase_for_subtask(self, test_env):
        """Test finding the phase containing a subtask."""
        from agents.utils import load_implementation_plan, find_phase_for_subtask

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with multiple phases
        plan = {
            "feature": "Test Feature",
            "workflow_type": "feature",
            "status": "in_progress",
            "phases": [
                {
                    "id": "phase-1",
                    "name": "Setup Phase",
                    "type": "setup",
                    "subtasks": [
                        {"id": "subtask-1-1", "description": "Setup DB", "status": "completed"}
                    ]
                },
                {
                    "id": "phase-2",
                    "name": "Implementation Phase",
                    "type": "implementation",
                    "subtasks": [
                        {"id": "subtask-2-1", "description": "Implement feature", "status": "pending"},
                        {"id": "subtask-2-2", "description": "Add tests", "status": "pending"}
                    ]
                }
            ]
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan, indent=2))

        loaded_plan = load_implementation_plan(spec_dir)

        # Find phase for subtask in first phase
        phase1 = find_phase_for_subtask(loaded_plan, "subtask-1-1")
        assert phase1 is not None, "Should find phase for subtask-1-1"
        assert phase1["name"] == "Setup Phase", "Should be setup phase"

        # Find phase for subtask in second phase
        phase2 = find_phase_for_subtask(loaded_plan, "subtask-2-1")
        assert phase2 is not None, "Should find phase for subtask-2-1"
        assert phase2["name"] == "Implementation Phase", "Should be implementation phase"

        # Find phase for non-existent subtask
        missing_phase = find_phase_for_subtask(loaded_plan, "subtask-999")
        assert missing_phase is None, "Should return None for missing subtask"

    def test_get_next_subtask_skips_completed(self, test_env):
        """Test that get_next_subtask skips completed subtasks."""
        from progress import get_next_subtask

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "First task", "status": "completed"},
            {"id": "subtask-2", "description": "Second task", "status": "completed"},
            {"id": "subtask-3", "description": "Third task", "status": "pending"}
        ])

        next_subtask = get_next_subtask(spec_dir)

        assert next_subtask is not None, "Should find pending subtask"
        assert next_subtask["id"] == "subtask-3", "Should skip completed and return first pending"

    def test_build_complete_when_all_subtasks_done(self, test_env):
        """Test that build is complete when all subtasks are completed."""
        from progress import is_build_complete

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "First task", "status": "completed"},
            {"id": "subtask-2", "description": "Second task", "status": "completed"},
            {"id": "subtask-3", "description": "Third task", "status": "completed"}
        ])

        assert is_build_complete(spec_dir) is True, "Build should be complete when all subtasks done"


# =============================================================================
# HANDOFF DATA PRESERVATION TESTS
# =============================================================================

class TestHandoffDataPreservation:
    """Tests for data preservation during agent handoffs."""

    def test_subtask_context_loading(self, test_env):
        """Test that subtask context is properly loaded for coder."""
        from prompt_generator import load_subtask_context

        temp_dir, spec_dir, project_dir = test_env

        # Create spec.md
        (spec_dir / "spec.md").write_text("# Test Spec\n\nTest content")

        # Create context.json
        context = {
            "files_to_modify": [
                {"path": "app/main.py", "reason": "Add feature"}
            ],
            "files_to_reference": [
                {"path": "app/utils.py", "reason": "Pattern reference"}
            ]
        }
        (spec_dir / "context.json").write_text(json.dumps(context))

        subtask = {
            "id": "subtask-1",
            "description": "Implement feature",
            "files_to_modify": ["app/main.py"],
            "patterns_from": ["app/utils.py"]
        }

        loaded_context = load_subtask_context(spec_dir, project_dir, subtask)

        # Verify context structure
        assert "patterns" in loaded_context or "files_to_modify" in loaded_context, \
            "Context should have patterns or files"

    def test_recovery_hints_passed_to_coder(self, test_env):
        """Test that recovery hints are available for retry attempts."""
        from recovery import RecoveryManager

        temp_dir, spec_dir, project_dir = test_env

        recovery_manager = RecoveryManager(spec_dir, project_dir)

        # Record a failed attempt
        recovery_manager.record_attempt(
            subtask_id="subtask-1",
            session=1,
            success=False,
            approach="First approach using async/await",
            error="Import error - module not found"
        )

        # Get recovery hints
        hints = recovery_manager.get_recovery_hints("subtask-1")

        assert len(hints) > 0, "Should have recovery hints after failure"
        assert any("Previous attempts: 1" in hint for hint in hints), "Should mention attempt count"

    def test_commit_tracking_across_sessions(self, test_env):
        """Test that commit tracking works across sessions."""
        from recovery import RecoveryManager

        temp_dir, spec_dir, project_dir = test_env

        recovery_manager = RecoveryManager(spec_dir, project_dir)

        # Get initial commit
        initial_commit = get_latest_commit(project_dir)

        # Record it as good
        recovery_manager.record_good_commit(initial_commit, "subtask-1")

        # Create a new commit
        test_file = project_dir / "new_file.txt"
        test_file.write_text("New content")
        subprocess.run(["git", "add", "."], cwd=project_dir, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Add new file"], cwd=project_dir, capture_output=True)

        new_commit = get_latest_commit(project_dir)

        # Record new commit
        recovery_manager.record_good_commit(new_commit, "subtask-2")

        # Verify last good commit is the new one
        last_good = recovery_manager.get_last_good_commit()
        assert last_good == new_commit, "Last good commit should be the newest"


# =============================================================================
# PLAN VALIDATION TESTS (for planner output)
# =============================================================================

class TestPlannerOutputValidation:
    """Tests for validating planner output before transition to coder."""

    def test_plan_must_have_pending_subtasks(self, test_env):
        """Test that valid plan has at least one pending subtask."""
        from progress import get_next_subtask

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with only completed subtasks
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Done task", "status": "completed"}
        ])

        next_subtask = get_next_subtask(spec_dir)
        assert next_subtask is None, "No pending subtasks should return None"

    def test_plan_without_phases_returns_none(self, test_env):
        """Test that plan without phases returns None for next subtask."""
        from progress import get_next_subtask

        temp_dir, spec_dir, project_dir = test_env

        # Create empty plan
        plan = {
            "feature": "Test Feature",
            "workflow_type": "feature",
            "status": "in_progress",
            "phases": []
        }
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan, indent=2))

        next_subtask = get_next_subtask(spec_dir)
        assert next_subtask is None, "Empty phases should return None"

    def test_missing_plan_returns_none(self, test_env):
        """Test that missing plan file returns None."""
        from progress import get_next_subtask

        temp_dir, spec_dir, project_dir = test_env

        # Don't create any plan file
        next_subtask = get_next_subtask(spec_dir)
        assert next_subtask is None, "Missing plan should return None"


# =============================================================================
# SUBTASK COMPLETION DETECTION TESTS
# =============================================================================

class TestSubtaskCompletionDetection:
    """Tests for subtask completion detection and status counting."""

    def test_count_subtasks_basic(self, test_env):
        """Test basic subtask counting."""
        from progress import count_subtasks

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "pending"},
            {"id": "subtask-3", "description": "Task 3", "status": "pending"}
        ])

        completed, total = count_subtasks(spec_dir)

        assert total == 3, "Should have 3 total subtasks"
        assert completed == 1, "Should have 1 completed subtask"

    def test_count_subtasks_empty_plan(self, test_env):
        """Test counting with empty plan returns zeros."""
        from progress import count_subtasks

        temp_dir, spec_dir, project_dir = test_env

        # No plan file exists
        completed, total = count_subtasks(spec_dir)
        assert completed == 0, "Empty plan should have 0 completed"
        assert total == 0, "Empty plan should have 0 total"

    def test_count_subtasks_detailed_all_statuses(self, test_env):
        """Test detailed counting with all status types."""
        from progress import count_subtasks_detailed

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "in_progress"},
            {"id": "subtask-3", "description": "Task 3", "status": "pending"},
            {"id": "subtask-4", "description": "Task 4", "status": "failed"}
        ])

        counts = count_subtasks_detailed(spec_dir)

        assert counts["total"] == 4, "Should have 4 total subtasks"
        assert counts["completed"] == 1, "Should have 1 completed"
        assert counts["in_progress"] == 1, "Should have 1 in_progress"
        assert counts["pending"] == 1, "Should have 1 pending"
        assert counts["failed"] == 1, "Should have 1 failed"

    def test_count_subtasks_detailed_unknown_status_treated_as_pending(self, test_env):
        """Test that unknown status values are treated as pending."""
        from progress import count_subtasks_detailed

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "unknown_status"},
            {"id": "subtask-2", "description": "Task 2", "status": "completed"}
        ])

        counts = count_subtasks_detailed(spec_dir)

        assert counts["total"] == 2, "Should have 2 total subtasks"
        assert counts["completed"] == 1, "Should have 1 completed"
        assert counts["pending"] == 1, "Unknown status should count as pending"

    def test_is_build_complete_true_when_all_done(self, test_env):
        """Test is_build_complete returns True when all subtasks completed."""
        from progress import is_build_complete

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "completed"}
        ])

        assert is_build_complete(spec_dir) is True, "Build should be complete"

    def test_is_build_complete_false_with_in_progress(self, test_env):
        """Test is_build_complete returns False with in_progress subtask."""
        from progress import is_build_complete

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "in_progress"}
        ])

        assert is_build_complete(spec_dir) is False, "Build should not be complete with in_progress"

    def test_is_build_complete_false_with_failed(self, test_env):
        """Test is_build_complete returns False with failed subtask."""
        from progress import is_build_complete

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "failed"}
        ])

        assert is_build_complete(spec_dir) is False, "Build should not be complete with failed task"

    def test_is_build_complete_false_with_empty_plan(self, test_env):
        """Test is_build_complete returns False for empty plan."""
        from progress import is_build_complete

        temp_dir, spec_dir, project_dir = test_env

        # No plan file
        assert is_build_complete(spec_dir) is False, "Empty plan should not be complete"

        # Empty phases
        plan = {
            "feature": "Test Feature",
            "workflow_type": "feature",
            "status": "in_progress",
            "phases": []
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        assert is_build_complete(spec_dir) is False, "Plan with no subtasks should not be complete"

    def test_get_progress_percentage(self, test_env):
        """Test progress percentage calculation."""
        from progress import get_progress_percentage

        temp_dir, spec_dir, project_dir = test_env

        # 50% complete
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "pending"}
        ])

        percentage = get_progress_percentage(spec_dir)
        assert percentage == 50.0, "Should be 50% complete"

    def test_get_progress_percentage_empty_plan(self, test_env):
        """Test progress percentage for empty plan is 0."""
        from progress import get_progress_percentage

        temp_dir, spec_dir, project_dir = test_env

        # No plan file
        percentage = get_progress_percentage(spec_dir)
        assert percentage == 0.0, "Empty plan should be 0%"

    def test_subtask_status_transition_to_completed(self, test_env):
        """Test detecting subtask transition from pending to completed."""
        from agents.utils import load_implementation_plan, find_subtask_in_plan
        from progress import is_build_complete

        temp_dir, spec_dir, project_dir = test_env

        # Start with pending subtask
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "pending"}
        ])

        plan = load_implementation_plan(spec_dir)
        subtask = find_subtask_in_plan(plan, "subtask-1")
        assert subtask["status"] == "pending", "Initial status should be pending"
        assert is_build_complete(spec_dir) is False, "Should not be complete"

        # Update to completed
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"}
        ])

        plan = load_implementation_plan(spec_dir)
        subtask = find_subtask_in_plan(plan, "subtask-1")
        assert subtask["status"] == "completed", "Updated status should be completed"
        assert is_build_complete(spec_dir) is True, "Should now be complete"

    def test_subtask_status_transition_through_in_progress(self, test_env):
        """Test detecting subtask transition through in_progress state."""
        from agents.utils import load_implementation_plan, find_subtask_in_plan
        from progress import count_subtasks_detailed

        temp_dir, spec_dir, project_dir = test_env

        # Start pending
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "pending"}
        ])

        counts = count_subtasks_detailed(spec_dir)
        assert counts["pending"] == 1, "Should have 1 pending"
        assert counts["in_progress"] == 0, "Should have 0 in_progress"

        # Move to in_progress
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "in_progress"}
        ])

        counts = count_subtasks_detailed(spec_dir)
        assert counts["pending"] == 0, "Should have 0 pending"
        assert counts["in_progress"] == 1, "Should have 1 in_progress"

        # Complete
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"}
        ])

        counts = count_subtasks_detailed(spec_dir)
        assert counts["in_progress"] == 0, "Should have 0 in_progress"
        assert counts["completed"] == 1, "Should have 1 completed"

    def test_multiple_subtasks_completion_sequence(self, test_env):
        """Test completion detection as subtasks complete one by one."""
        from progress import count_subtasks, is_build_complete

        temp_dir, spec_dir, project_dir = test_env

        # Start with all pending
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "pending"},
            {"id": "subtask-2", "description": "Task 2", "status": "pending"},
            {"id": "subtask-3", "description": "Task 3", "status": "pending"}
        ])

        completed, total = count_subtasks(spec_dir)
        assert completed == 0 and total == 3, "Initial: 0/3"
        assert is_build_complete(spec_dir) is False

        # Complete first subtask
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "pending"},
            {"id": "subtask-3", "description": "Task 3", "status": "pending"}
        ])

        completed, total = count_subtasks(spec_dir)
        assert completed == 1 and total == 3, "After first: 1/3"
        assert is_build_complete(spec_dir) is False

        # Complete second subtask
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "completed"},
            {"id": "subtask-3", "description": "Task 3", "status": "pending"}
        ])

        completed, total = count_subtasks(spec_dir)
        assert completed == 2 and total == 3, "After second: 2/3"
        assert is_build_complete(spec_dir) is False

        # Complete all subtasks
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "completed"},
            {"id": "subtask-3", "description": "Task 3", "status": "completed"}
        ])

        completed, total = count_subtasks(spec_dir)
        assert completed == 3 and total == 3, "Final: 3/3"
        assert is_build_complete(spec_dir) is True

    def test_get_next_subtask_returns_first_pending_after_completed(self, test_env):
        """Test get_next_subtask returns correct subtask after completions."""
        from progress import get_next_subtask

        temp_dir, spec_dir, project_dir = test_env

        # First and second completed, third pending
        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "completed"},
            {"id": "subtask-3", "description": "Task 3", "status": "pending"}
        ])

        next_subtask = get_next_subtask(spec_dir)
        assert next_subtask is not None, "Should find next subtask"
        assert next_subtask["id"] == "subtask-3", "Should return subtask-3"

    def test_get_next_subtask_none_when_all_complete(self, test_env):
        """Test get_next_subtask returns None when all complete."""
        from progress import get_next_subtask

        temp_dir, spec_dir, project_dir = test_env

        create_implementation_plan(spec_dir, [
            {"id": "subtask-1", "description": "Task 1", "status": "completed"},
            {"id": "subtask-2", "description": "Task 2", "status": "completed"}
        ])

        next_subtask = get_next_subtask(spec_dir)
        assert next_subtask is None, "Should return None when all complete"

    def test_completion_detection_with_multi_phase_plan(self, test_env):
        """Test completion detection across multiple phases."""
        from progress import is_build_complete, count_subtasks

        temp_dir, spec_dir, project_dir = test_env

        # Multi-phase plan
        plan = {
            "feature": "Test Feature",
            "workflow_type": "feature",
            "status": "in_progress",
            "phases": [
                {
                    "id": "phase-1",
                    "name": "Setup Phase",
                    "type": "setup",
                    "subtasks": [
                        {"id": "subtask-1-1", "description": "Setup DB", "status": "completed"}
                    ]
                },
                {
                    "id": "phase-2",
                    "name": "Implementation Phase",
                    "type": "implementation",
                    "subtasks": [
                        {"id": "subtask-2-1", "description": "Implement feature", "status": "pending"},
                        {"id": "subtask-2-2", "description": "Add tests", "status": "pending"}
                    ]
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        completed, total = count_subtasks(spec_dir)
        assert completed == 1 and total == 3, "Should count across phases: 1/3"
        assert is_build_complete(spec_dir) is False, "Should not be complete"

        # Complete all in second phase
        plan["phases"][1]["subtasks"][0]["status"] = "completed"
        plan["phases"][1]["subtasks"][1]["status"] = "completed"
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        completed, total = count_subtasks(spec_dir)
        assert completed == 3 and total == 3, "All phases complete: 3/3"
        assert is_build_complete(spec_dir) is True, "Should be complete"


# =============================================================================
# QA LOOP AND FIXER INTERACTION TESTS
# =============================================================================

class TestQALoopStateTransitions:
    """Tests for QA loop state transitions in agent flow context."""

    def test_qa_not_required_when_build_incomplete(self, test_env):
        """QA should not run when build is incomplete."""
        from qa_loop import save_implementation_plan
        # Import the real is_build_ready_for_qa to patch at the right level
        from core.progress import is_build_ready_for_qa as real_is_build_ready_for_qa

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with pending subtasks
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "c1", "description": "Task 1", "status": "completed"},
                        {"id": "c2", "description": "Task 2", "status": "pending"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)

        # Patch is_build_ready_for_qa where it's used (qa.criteria) to use real implementation
        # This is needed because test_qa_criteria.py module-level mocks may pollute
        with patch('qa.criteria.is_build_ready_for_qa', side_effect=real_is_build_ready_for_qa):
            from qa.criteria import should_run_qa
            assert should_run_qa(spec_dir) is False, "QA should not run with pending subtasks"

    def test_qa_required_when_build_complete(self, test_env):
        """QA should run when build is complete and not yet approved."""
        from qa_loop import save_implementation_plan
        from core.progress import is_build_ready_for_qa as real_is_build_ready_for_qa

        temp_dir, spec_dir, project_dir = test_env

        # Create plan with all completed subtasks
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "c1", "description": "Task 1", "status": "completed"},
                        {"id": "c2", "description": "Task 2", "status": "completed"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)

        # Patch is_build_ready_for_qa where it's used (qa.criteria) to use real implementation
        with patch('qa.criteria.is_build_ready_for_qa', side_effect=real_is_build_ready_for_qa):
            from qa.criteria import should_run_qa
            assert should_run_qa(spec_dir) is True, "QA should run when build complete"

    def test_qa_not_required_when_already_approved(self, test_env):
        """QA should not run when build is already approved."""
        from qa_loop import save_implementation_plan
        from core.progress import is_build_ready_for_qa as real_is_build_ready_for_qa

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "c1", "description": "Task 1", "status": "completed"},
                    ],
                },
            ],
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": "2024-01-01T12:00:00",
            },
        }
        save_implementation_plan(spec_dir, plan)

        # Patch is_build_ready_for_qa where it's used (qa.criteria) to use real implementation
        with patch('qa.criteria.is_build_ready_for_qa', side_effect=real_is_build_ready_for_qa):
            from qa.criteria import should_run_qa
            assert should_run_qa(spec_dir) is False, "QA should not run when already approved"


class TestQAFixerInteraction:
    """Tests for QA reviewer to fixer handoff and interaction."""

    def test_fixer_should_run_when_qa_rejected(self, test_env):
        """Fixer should run when QA rejected the build."""
        from qa_loop import should_run_fixes, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 1,
                "issues_found": [{"title": "Missing test", "type": "unit_test"}],
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert should_run_fixes(spec_dir) is True, "Fixer should run when QA rejected"

    def test_fixer_should_not_run_when_qa_approved(self, test_env):
        """Fixer should not run when QA approved the build."""
        from qa_loop import should_run_fixes, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "tests_passed": {"unit": True, "integration": True, "e2e": True},
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert should_run_fixes(spec_dir) is False, "Fixer should not run when approved"

    def test_fixer_should_not_run_at_max_iterations(self, test_env):
        """Fixer should not run when max iterations reached."""
        from qa_loop import should_run_fixes, save_implementation_plan, MAX_QA_ITERATIONS

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": MAX_QA_ITERATIONS,
                "issues_found": [{"title": "Recurring issue", "type": "unit_test"}],
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert should_run_fixes(spec_dir) is False, "Fixer should not run at max iterations"

    def test_fixer_fixes_applied_state(self, test_env):
        """Test transition to fixes_applied state after fixer runs."""
        from qa_loop import is_fixes_applied, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        # Simulate fixer completing and setting fixes_applied
        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": True,
                "qa_session": 1,
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is True, "Should detect fixes_applied state"

    def test_fixer_fixes_not_ready_for_revalidation(self, test_env):
        """Test fixes_applied but not ready for revalidation."""
        from qa_loop import is_fixes_applied, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "fixes_applied",
                "ready_for_qa_revalidation": False,
                "qa_session": 1,
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is False, "Should not be ready when flag is False"


class TestQAVerdictHandling:
    """Tests for QA verdict handling and status management."""

    def test_qa_approved_verdict(self, test_env):
        """Test QA approved verdict is correctly detected."""
        from qa_loop import is_qa_approved, is_qa_rejected, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": "2024-01-01T12:00:00",
                "tests_passed": {"unit": True, "integration": True, "e2e": True},
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is True, "Should detect approved status"
        assert is_qa_rejected(spec_dir) is False, "Should not detect rejected when approved"

    def test_qa_rejected_verdict(self, test_env):
        """Test QA rejected verdict is correctly detected."""
        from qa_loop import is_qa_approved, is_qa_rejected, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 1,
                "timestamp": "2024-01-01T12:00:00",
                "issues_found": [{"title": "Missing test", "type": "unit_test"}],
            },
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is True, "Should detect rejected status"
        assert is_qa_approved(spec_dir) is False, "Should not detect approved when rejected"

    def test_qa_no_verdict_yet(self, test_env):
        """Test when no QA verdict has been made yet."""
        from qa_loop import is_qa_approved, is_qa_rejected, get_qa_signoff_status, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "phases": [],
        }
        save_implementation_plan(spec_dir, plan)

        assert get_qa_signoff_status(spec_dir) is None, "Should have no signoff status"
        assert is_qa_approved(spec_dir) is False, "Should not be approved with no verdict"
        assert is_qa_rejected(spec_dir) is False, "Should not be rejected with no verdict"

    def test_qa_iteration_count_tracking(self, test_env):
        """Test QA iteration count is tracked correctly."""
        from qa_loop import get_qa_iteration_count, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        # First iteration
        plan = {
            "feature": "Test Feature",
            "qa_signoff": {"status": "rejected", "qa_session": 1},
        }
        save_implementation_plan(spec_dir, plan)
        assert get_qa_iteration_count(spec_dir) == 1, "Should be iteration 1"

        # Second iteration
        plan["qa_signoff"]["qa_session"] = 2
        save_implementation_plan(spec_dir, plan)
        assert get_qa_iteration_count(spec_dir) == 2, "Should be iteration 2"

        # Third iteration
        plan["qa_signoff"]["qa_session"] = 3
        save_implementation_plan(spec_dir, plan)
        assert get_qa_iteration_count(spec_dir) == 3, "Should be iteration 3"

    def test_qa_iteration_count_zero_when_no_signoff(self, test_env):
        """Test iteration count is 0 when no QA sessions yet."""
        from qa_loop import get_qa_iteration_count, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {"feature": "Test Feature", "phases": []}
        save_implementation_plan(spec_dir, plan)

        assert get_qa_iteration_count(spec_dir) == 0, "Should be 0 with no signoff"


class TestQALoopWorkflow:
    """Integration tests for complete QA loop workflow."""

    def test_full_qa_workflow_approved_first_try(self, test_env):
        """Test complete QA workflow where build passes on first try."""
        from qa_loop import (
            should_run_qa,
            should_run_fixes,
            is_qa_approved,
            save_implementation_plan,
        )

        temp_dir, spec_dir, project_dir = test_env

        # Build complete, QA should run
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "c1", "description": "Task 1", "status": "completed"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)
        assert should_run_qa(spec_dir) is True, "QA should run initially"

        # QA approves
        plan["qa_signoff"] = {
            "status": "approved",
            "qa_session": 1,
            "tests_passed": {"unit": True, "integration": True, "e2e": True},
        }
        save_implementation_plan(spec_dir, plan)

        # Verify end state
        assert is_qa_approved(spec_dir) is True, "Should be approved"
        assert should_run_qa(spec_dir) is False, "QA should not run again"
        assert should_run_fixes(spec_dir) is False, "Fixer should not run"

    def test_full_qa_workflow_with_one_rejection(self, test_env):
        """Test QA workflow with one rejection followed by approval."""
        from qa_loop import (
            should_run_qa,
            should_run_fixes,
            is_qa_approved,
            is_qa_rejected,
            is_fixes_applied,
            get_qa_iteration_count,
            save_implementation_plan,
        )

        temp_dir, spec_dir, project_dir = test_env

        # Build complete
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "c1", "description": "Task 1", "status": "completed"},
                    ],
                },
            ],
        }
        save_implementation_plan(spec_dir, plan)

        # First QA session - rejected
        plan["qa_signoff"] = {
            "status": "rejected",
            "qa_session": 1,
            "issues_found": [{"title": "Missing test", "type": "unit_test"}],
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_rejected(spec_dir) is True, "Should be rejected"
        assert should_run_fixes(spec_dir) is True, "Fixer should run"
        assert get_qa_iteration_count(spec_dir) == 1, "Should be iteration 1"

        # Fixer applies fixes
        plan["qa_signoff"] = {
            "status": "fixes_applied",
            "ready_for_qa_revalidation": True,
            "qa_session": 1,
        }
        save_implementation_plan(spec_dir, plan)

        assert is_fixes_applied(spec_dir) is True, "Fixes should be applied"

        # Second QA session - approved
        plan["qa_signoff"] = {
            "status": "approved",
            "qa_session": 2,
            "tests_passed": {"unit": True, "integration": True, "e2e": True},
        }
        save_implementation_plan(spec_dir, plan)

        assert is_qa_approved(spec_dir) is True, "Should be approved"
        assert get_qa_iteration_count(spec_dir) == 2, "Should be iteration 2"

    def test_qa_workflow_multiple_rejections(self, test_env):
        """Test QA workflow with multiple rejections until max iterations."""
        from qa_loop import (
            should_run_fixes,
            is_qa_rejected,
            get_qa_iteration_count,
            save_implementation_plan,
            MAX_QA_ITERATIONS,
        )

        temp_dir, spec_dir, project_dir = test_env

        plan = {"feature": "Test Feature", "phases": []}

        # Simulate multiple rejections
        for i in range(1, MAX_QA_ITERATIONS + 1):
            plan["qa_signoff"] = {
                "status": "rejected",
                "qa_session": i,
                "issues_found": [{"title": f"Issue {i}", "type": "unit_test"}],
            }
            save_implementation_plan(spec_dir, plan)

            assert is_qa_rejected(spec_dir) is True, f"Should be rejected at iteration {i}"
            assert get_qa_iteration_count(spec_dir) == i, f"Should be iteration {i}"

            if i < MAX_QA_ITERATIONS:
                assert should_run_fixes(spec_dir) is True, f"Fixer should run at iteration {i}"
            else:
                assert should_run_fixes(spec_dir) is False, "Fixer should not run at max iterations"


class TestQASignoffDataStructure:
    """Tests for QA signoff data structure validation."""

    def test_approved_signoff_has_tests_passed(self, test_env):
        """Test approved signoff includes tests_passed field."""
        from qa_loop import get_qa_signoff_status, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": "2024-01-01T12:00:00",
                "tests_passed": {
                    "unit": True,
                    "integration": True,
                    "e2e": True,
                },
            },
        }
        save_implementation_plan(spec_dir, plan)

        status = get_qa_signoff_status(spec_dir)
        assert status is not None, "Should have signoff status"
        assert "tests_passed" in status, "Approved signoff should have tests_passed"
        assert status["tests_passed"]["unit"] is True, "Unit tests should be True"

    def test_rejected_signoff_has_issues_found(self, test_env):
        """Test rejected signoff includes issues_found field."""
        from qa_loop import get_qa_signoff_status, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 1,
                "timestamp": "2024-01-01T12:00:00",
                "issues_found": [
                    {"title": "Missing test", "type": "unit_test"},
                    {"title": "Validation error", "type": "acceptance"},
                ],
            },
        }
        save_implementation_plan(spec_dir, plan)

        status = get_qa_signoff_status(spec_dir)
        assert status is not None, "Should have signoff status"
        assert "issues_found" in status, "Rejected signoff should have issues_found"
        assert len(status["issues_found"]) == 2, "Should have 2 issues"

    def test_issues_have_title_and_type(self, test_env):
        """Test that issues in rejected signoff have required fields."""
        from qa_loop import get_qa_signoff_status, save_implementation_plan

        temp_dir, spec_dir, project_dir = test_env

        plan = {
            "feature": "Test Feature",
            "qa_signoff": {
                "status": "rejected",
                "qa_session": 1,
                "issues_found": [
                    {"title": "Test failure", "type": "unit_test"},
                ],
            },
        }
        save_implementation_plan(spec_dir, plan)

        status = get_qa_signoff_status(spec_dir)
        issue = status["issues_found"][0]
        assert "title" in issue, "Issue should have title"
        assert "type" in issue, "Issue should have type"
        assert issue["title"] == "Test failure", "Title should match"
        assert issue["type"] == "unit_test", "Type should match"


# =============================================================================
# WORKTREE ISOLATION TESTS
# =============================================================================

class TestWorktreeIsolation:
    """Tests for worktree isolation to verify concurrent agents don't conflict."""

    def test_multiple_worktrees_have_separate_branches(self, test_env):
        """Multiple worktrees for different specs have separate branches."""
        from worktree import WorktreeManager

        temp_dir, spec_dir, project_dir = test_env

        manager = WorktreeManager(project_dir)
        manager.setup()

        # Create two worktrees for different specs
        info1 = manager.create_worktree("spec-agent-1")
        info2 = manager.create_worktree("spec-agent-2")

        # Each worktree should have a unique branch
        assert info1.branch != info2.branch, "Worktrees should have different branches"
        assert info1.branch == "auto-claude/spec-agent-1", f"Expected branch auto-claude/spec-agent-1, got {info1.branch}"
        assert info2.branch == "auto-claude/spec-agent-2", f"Expected branch auto-claude/spec-agent-2, got {info2.branch}"

        # Each worktree should have a unique path
        assert info1.path != info2.path, "Worktrees should have different paths"
        assert info1.path.exists(), "First worktree path should exist"
        assert info2.path.exists(), "Second worktree path should exist"

    def test_changes_in_one_worktree_dont_affect_another(self, test_env):
        """Changes made in one worktree don't affect other worktrees."""
        from worktree import WorktreeManager

        temp_dir, spec_dir, project_dir = test_env

        manager = WorktreeManager(project_dir)
        manager.setup()

        # Create two worktrees
        info1 = manager.create_worktree("spec-isolation-1")
        info2 = manager.create_worktree("spec-isolation-2")

        # Make changes in first worktree
        file1 = info1.path / "agent1_work.txt"
        file1.write_text("Work from agent 1")
        subprocess.run(["git", "add", "."], cwd=info1.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Agent 1 work"],
            cwd=info1.path, capture_output=True
        )

        # Make different changes in second worktree
        file2 = info2.path / "agent2_work.txt"
        file2.write_text("Work from agent 2")
        subprocess.run(["git", "add", "."], cwd=info2.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Agent 2 work"],
            cwd=info2.path, capture_output=True
        )

        # Verify changes are isolated
        assert (info1.path / "agent1_work.txt").exists(), "Agent 1 file should exist in worktree 1"
        assert not (info1.path / "agent2_work.txt").exists(), "Agent 2 file should NOT exist in worktree 1"
        assert (info2.path / "agent2_work.txt").exists(), "Agent 2 file should exist in worktree 2"
        assert not (info2.path / "agent1_work.txt").exists(), "Agent 1 file should NOT exist in worktree 2"

        # Verify main branch is unaffected
        assert not (project_dir / "agent1_work.txt").exists(), "Agent 1 file should NOT exist in main"
        assert not (project_dir / "agent2_work.txt").exists(), "Agent 2 file should NOT exist in main"

    def test_concurrent_worktree_operations_dont_conflict(self, test_env):
        """Concurrent operations on different worktrees don't cause conflicts."""
        from worktree import WorktreeManager

        temp_dir, spec_dir, project_dir = test_env

        manager = WorktreeManager(project_dir)
        manager.setup()

        # Create multiple worktrees simulating concurrent agents
        worktrees = []
        for i in range(3):
            info = manager.create_worktree(f"concurrent-spec-{i}")
            worktrees.append(info)

        # Simulate concurrent work - each "agent" modifies the same file in their worktree
        for i, info in enumerate(worktrees):
            # Each worktree starts with the same file (from base branch)
            modified_file = info.path / "test.txt"
            modified_file.write_text(f"Modified by agent {i}")
            subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", f"Agent {i} modification"],
                cwd=info.path, capture_output=True
            )

        # Verify each worktree has its own version
        for i, info in enumerate(worktrees):
            content = (info.path / "test.txt").read_text()
            assert content == f"Modified by agent {i}", f"Worktree {i} should have agent {i}'s changes"

        # Verify all worktrees still exist and are valid
        all_worktrees = manager.list_all_worktrees()
        assert len(all_worktrees) == 3, f"Should have 3 worktrees, got {len(all_worktrees)}"

    def test_worktree_isolation_with_spec_directories(self, test_env):
        """Worktrees properly isolate spec-related directories."""
        from worktree import WorktreeManager

        temp_dir, spec_dir, project_dir = test_env

        manager = WorktreeManager(project_dir)
        manager.setup()

        # Create worktree
        info = manager.create_worktree("spec-dir-test")

        # Create a spec directory structure in the worktree
        worktree_spec_dir = info.path / ".auto-claude" / "specs" / "spec-dir-test"
        worktree_spec_dir.mkdir(parents=True)

        # Create implementation plan in the worktree's spec directory
        plan = {
            "feature": "Test Feature",
            "phases": [
                {
                    "id": "phase-1",
                    "name": "Test",
                    "subtasks": [
                        {"id": "subtask-1", "description": "Test", "status": "pending"}
                    ]
                }
            ]
        }
        plan_file = worktree_spec_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(plan, indent=2))

        # Verify the spec directory exists only in the worktree
        assert worktree_spec_dir.exists(), "Spec dir should exist in worktree"

        # Main project directory should not have this spec directory
        # (the .auto-claude/specs path may exist but not this specific spec)
        main_spec_dir = project_dir / ".auto-claude" / "specs" / "spec-dir-test"
        assert not main_spec_dir.exists(), "Worktree spec dir should NOT exist in main project"

    def test_worktree_can_be_removed_without_affecting_others(self, test_env):
        """Removing one worktree doesn't affect other worktrees."""
        from worktree import WorktreeManager

        temp_dir, spec_dir, project_dir = test_env

        manager = WorktreeManager(project_dir)
        manager.setup()

        # Create three worktrees
        info1 = manager.create_worktree("removal-test-1")
        info2 = manager.create_worktree("removal-test-2")
        info3 = manager.create_worktree("removal-test-3")

        # Make some changes in each
        for info in [info1, info2, info3]:
            (info.path / f"{info.spec_name}.txt").write_text(f"Data for {info.spec_name}")
            subprocess.run(["git", "add", "."], cwd=info.path, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", f"Commit for {info.spec_name}"],
                cwd=info.path, capture_output=True
            )

        # Remove the middle worktree
        manager.remove_worktree("removal-test-2", delete_branch=True)

        # Verify the removed worktree is gone
        assert not info2.path.exists(), "Removed worktree path should not exist"

        # Verify other worktrees still exist and are intact
        assert info1.path.exists(), "First worktree should still exist"
        assert info3.path.exists(), "Third worktree should still exist"

        # Verify other worktrees still have their data
        assert (info1.path / "removal-test-1.txt").exists(), "First worktree data should be intact"
        assert (info3.path / "removal-test-3.txt").exists(), "Third worktree data should be intact"

        # Verify the listing is correct
        remaining = manager.list_all_worktrees()
        assert len(remaining) == 2, f"Should have 2 remaining worktrees, got {len(remaining)}"

    def test_worktree_merge_isolation(self, test_env):
        """Merging one worktree doesn't affect other worktrees."""
        from worktree import WorktreeManager

        temp_dir, spec_dir, project_dir = test_env

        manager = WorktreeManager(project_dir)
        manager.setup()

        # Create two worktrees
        info1 = manager.create_worktree("merge-test-1")
        info2 = manager.create_worktree("merge-test-2")

        # Make changes in first worktree
        (info1.path / "feature1.txt").write_text("Feature 1 implementation")
        subprocess.run(["git", "add", "."], cwd=info1.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add feature 1"],
            cwd=info1.path, capture_output=True
        )

        # Make changes in second worktree
        (info2.path / "feature2.txt").write_text("Feature 2 implementation")
        subprocess.run(["git", "add", "."], cwd=info2.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add feature 2"],
            cwd=info2.path, capture_output=True
        )

        # Merge first worktree
        result = manager.merge_worktree("merge-test-1", delete_after=False)
        assert result is True, "Merge should succeed"

        # Verify feature 1 is in main
        assert (project_dir / "feature1.txt").exists(), "Feature 1 should be merged to main"

        # Verify feature 2 is NOT in main yet
        assert not (project_dir / "feature2.txt").exists(), "Feature 2 should NOT be in main yet"

        # Verify second worktree is unaffected
        assert info2.path.exists(), "Second worktree should still exist"
        assert (info2.path / "feature2.txt").exists(), "Second worktree should still have feature 2"

    def test_get_or_create_worktree_returns_existing(self, test_env):
        """get_or_create_worktree returns existing worktree instead of creating new."""
        from worktree import WorktreeManager

        temp_dir, spec_dir, project_dir = test_env

        manager = WorktreeManager(project_dir)
        manager.setup()

        # Create a worktree and add some data
        info1 = manager.create_worktree("existing-test")
        marker_file = info1.path / "marker.txt"
        marker_file.write_text("This is a marker")
        subprocess.run(["git", "add", "."], cwd=info1.path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add marker"],
            cwd=info1.path, capture_output=True
        )

        # get_or_create should return the existing worktree
        info2 = manager.get_or_create_worktree("existing-test")

        # Should be the same worktree with the marker file
        assert info2.path == info1.path, "Should return same worktree path"
        assert info2.branch == info1.branch, "Should return same branch"
        assert marker_file.exists(), "Marker file should still exist"


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

def run_all_tests():
    """Run all tests using pytest."""
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))


if __name__ == "__main__":
    run_all_tests()

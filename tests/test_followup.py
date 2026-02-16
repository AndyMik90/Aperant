#!/usr/bin/env python3
"""
Tests for Follow-Up Task Capability
====================================

Tests the ImplementationPlan extension methods that enable follow-up tasks:
- add_followup_phase(): Adds new phases to completed plans
- reset_for_followup(): Transitions plan status back to in_progress
"""

import json
import pytest
from datetime import datetime
from pathlib import Path

from implementation_plan import (
    ImplementationPlan,
    Phase,
    Subtask,
    SubtaskStatus,
    PhaseType,
    WorkflowType,
)


class TestAddFollowupPhase:
    """Tests for add_followup_phase() method."""

    def test_adds_new_phase_to_empty_plan(self):
        """Adds phase with correct number when plan has no phases."""
        plan = ImplementationPlan(feature="Test Feature")

        new_chunks = [
            Subtask(id="followup-1", description="First follow-up task"),
            Subtask(id="followup-2", description="Second follow-up task"),
        ]

        phase = plan.add_followup_phase("Follow-Up: New Work", new_chunks)

        assert phase.phase == 1
        assert phase.name == "Follow-Up: New Work"
        assert phase.depends_on == []
        assert len(phase.chunks) == 2
        assert len(plan.phases) == 1

    def test_adds_phase_after_existing_phases(self):
        """Adds phase with correct number after existing phases."""
        plan = ImplementationPlan(
            feature="Test Feature",
            phases=[
                Phase(phase=1, name="Phase 1", subtasks=[]),
                Phase(phase=2, name="Phase 2", subtasks=[]),
            ],
        )

        new_chunks = [Subtask(id="followup-1", description="Follow-up task")]
        phase = plan.add_followup_phase("Follow-Up Phase", new_chunks)

        assert phase.phase == 3
        assert len(plan.phases) == 3

    def test_depends_on_all_existing_phases(self):
        """New phase depends on all existing phases."""
        plan = ImplementationPlan(
            feature="Test Feature",
            phases=[
                Phase(phase=1, name="Phase 1", subtasks=[]),
                Phase(phase=2, name="Phase 2", subtasks=[]),
                Phase(phase=3, name="Phase 3", subtasks=[]),
            ],
        )

        new_chunks = [Subtask(id="followup-1", description="Follow-up task")]
        phase = plan.add_followup_phase("Follow-Up Phase", new_chunks)

        assert phase.depends_on == [1, 2, 3]

    def test_sets_phase_type(self):
        """Respects phase_type parameter."""
        plan = ImplementationPlan(feature="Test Feature")

        new_chunks = [Subtask(id="followup-1", description="Integration task")]
        phase = plan.add_followup_phase(
            "Integration Work",
            new_chunks,
            phase_type=PhaseType.INTEGRATION,
        )

        assert phase.type == PhaseType.INTEGRATION

    def test_sets_parallel_safe(self):
        """Respects parallel_safe parameter."""
        plan = ImplementationPlan(feature="Test Feature")

        new_chunks = [Subtask(id="followup-1", description="Parallel task")]
        phase = plan.add_followup_phase(
            "Parallel Work",
            new_chunks,
            parallel_safe=True,
        )

        assert phase.parallel_safe is True

    def test_updates_status_to_in_progress(self):
        """Sets plan status to in_progress after adding followup."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="done",
            planStatus="completed",
        )

        new_chunks = [Subtask(id="followup-1", description="New task")]
        plan.add_followup_phase("Follow-Up", new_chunks)

        assert plan.status == "in_progress"
        assert plan.planStatus == "in_progress"

    def test_clears_qa_signoff(self):
        """Clears QA signoff when adding follow-up phase."""
        plan = ImplementationPlan(
            feature="Test Feature",
            qa_signoff={"status": "approved", "timestamp": "2024-01-01"},
        )

        new_chunks = [Subtask(id="followup-1", description="New task")]
        plan.add_followup_phase("Follow-Up", new_chunks)

        assert plan.qa_signoff is None

    def test_returns_created_phase(self):
        """Returns the newly created Phase object."""
        plan = ImplementationPlan(feature="Test Feature")

        new_chunks = [Subtask(id="followup-1", description="New task")]
        phase = plan.add_followup_phase("Follow-Up", new_chunks)

        assert isinstance(phase, Phase)
        assert phase.name == "Follow-Up"
        assert phase is plan.phases[-1]

    def test_multiple_followups_increment_phase_numbers(self):
        """Multiple follow-ups create sequential phase numbers."""
        plan = ImplementationPlan(
            feature="Test Feature",
            phases=[Phase(phase=1, name="Initial", subtasks=[])],
        )

        # First follow-up
        plan.add_followup_phase("Follow-Up 1", [Subtask(id="f1", description="Task 1")])
        # Second follow-up
        plan.add_followup_phase("Follow-Up 2", [Subtask(id="f2", description="Task 2")])
        # Third follow-up
        plan.add_followup_phase("Follow-Up 3", [Subtask(id="f3", description="Task 3")])

        assert len(plan.phases) == 4
        assert plan.phases[0].phase == 1
        assert plan.phases[1].phase == 2
        assert plan.phases[2].phase == 3
        assert plan.phases[3].phase == 4

    def test_followup_chunks_have_pending_status(self):
        """Chunks added via follow-up start with pending status."""
        plan = ImplementationPlan(feature="Test Feature")

        new_chunks = [
            Subtask(id="followup-1", description="Task 1"),
            Subtask(id="followup-2", description="Task 2"),
        ]
        phase = plan.add_followup_phase("Follow-Up", new_chunks)

        for chunk in phase.chunks:
            assert chunk.status == SubtaskStatus.PENDING


class TestResetForFollowup:
    """Tests for reset_for_followup() method."""

    def test_resets_done_status(self):
        """Resets plan from done status to in_progress."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="done",
            planStatus="completed",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        result = plan.reset_for_followup()

        assert result is True
        assert plan.status == "in_progress"
        assert plan.planStatus == "in_progress"

    def test_resets_ai_review_status(self):
        """Resets plan from ai_review status to in_progress."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="ai_review",
            planStatus="review",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        result = plan.reset_for_followup()

        assert result is True
        assert plan.status == "in_progress"
        assert plan.planStatus == "in_progress"

    def test_resets_human_review_status(self):
        """Resets plan from human_review status to in_progress."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="human_review",
            planStatus="review",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        result = plan.reset_for_followup()

        assert result is True
        assert plan.status == "in_progress"
        assert plan.planStatus == "in_progress"

    def test_resets_when_all_chunks_completed(self):
        """Resets plan when all chunks are completed, regardless of status field."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="in_progress",  # Status field not updated yet
            planStatus="in_progress",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[
                        Subtask(id="c1", description="Task 1", status=SubtaskStatus.COMPLETED),
                        Subtask(id="c2", description="Task 2", status=SubtaskStatus.COMPLETED),
                    ],
                ),
            ],
        )

        result = plan.reset_for_followup()

        assert result is True
        assert plan.status == "in_progress"

    def test_returns_false_for_incomplete_plan(self):
        """Returns False when plan is not in a completed state."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="in_progress",
            planStatus="in_progress",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[
                        Subtask(id="c1", description="Task 1", status=SubtaskStatus.COMPLETED),
                        Subtask(id="c2", description="Task 2", status=SubtaskStatus.PENDING),
                    ],
                ),
            ],
        )

        result = plan.reset_for_followup()

        assert result is False

    def test_returns_false_for_backlog_plan(self):
        """Returns False when plan is in backlog state."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="backlog",
            planStatus="pending",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.PENDING)],
                ),
            ],
        )

        result = plan.reset_for_followup()

        assert result is False

    def test_clears_qa_signoff(self):
        """Clears QA signoff when resetting for follow-up."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="done",
            planStatus="completed",
            qa_signoff={"status": "approved", "timestamp": "2024-01-01"},
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        plan.reset_for_followup()

        assert plan.qa_signoff is None

    def test_clears_recovery_note(self):
        """Clears recovery note when resetting for follow-up."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="done",
            planStatus="completed",
            recoveryNote="Previous session note",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        plan.reset_for_followup()

        assert plan.recoveryNote is None


class TestExistingChunksPreserved:
    """Tests that existing completed chunks remain untouched."""

    def test_completed_chunks_stay_completed(self):
        """Existing completed chunks maintain their status after follow-up."""
        plan = ImplementationPlan(
            feature="Test Feature",
            status="done",
            planStatus="completed",
            phases=[
                Phase(
                    phase=1,
                    name="Original Phase",
                    subtasks=[
                        Subtask(
                            id="original-1",
                            description="Original task",
                            status=SubtaskStatus.COMPLETED,
                            completed_at="2024-01-01T12:00:00",
                        ),
                    ],
                ),
            ],
        )

        # Add follow-up
        new_chunks = [Subtask(id="followup-1", description="New task")]
        plan.add_followup_phase("Follow-Up", new_chunks)

        # Original chunk should still be completed
        original_chunk = plan.phases[0].chunks[0]
        assert original_chunk.status == SubtaskStatus.COMPLETED
        assert original_chunk.completed_at == "2024-01-01T12:00:00"

    def test_original_phase_structure_preserved(self):
        """Original phases maintain their structure after follow-up."""
        original_phases = [
            Phase(
                phase=1,
                name="Phase 1",
                depends_on=[],
                subtasks=[Subtask(id="c1", description="Task 1", status=SubtaskStatus.COMPLETED)],
            ),
            Phase(
                phase=2,
                name="Phase 2",
                depends_on=[1],
                subtasks=[Subtask(id="c2", description="Task 2", status=SubtaskStatus.COMPLETED)],
            ),
        ]

        plan = ImplementationPlan(
            feature="Test Feature",
            phases=original_phases,
        )

        plan.add_followup_phase("Follow-Up", [Subtask(id="f1", description="Follow-up")])

        # Original phases should be unchanged
        assert plan.phases[0].name == "Phase 1"
        assert plan.phases[0].depends_on == []
        assert plan.phases[1].name == "Phase 2"
        assert plan.phases[1].depends_on == [1]


class TestFollowupPlanSaveLoad:
    """Tests for saving and loading plans with follow-up phases."""

    def test_save_and_load_with_followup(self, temp_dir: Path):
        """Plan with follow-up phase can be saved and loaded."""
        plan = ImplementationPlan(
            feature="Test Feature",
            workflow_type=WorkflowType.FEATURE,
            phases=[
                Phase(
                    phase=1,
                    name="Original",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        # Add follow-up
        plan.add_followup_phase(
            "Follow-Up Work",
            [Subtask(id="followup-1", description="Follow-up task")],
        )

        # Save
        plan_path = temp_dir / "implementation_plan.json"
        plan.save(plan_path)

        # Load
        loaded_plan = ImplementationPlan.load(plan_path)

        assert len(loaded_plan.phases) == 2
        assert loaded_plan.phases[1].name == "Follow-Up Work"
        assert loaded_plan.phases[1].depends_on == [1]
        assert loaded_plan.status == "in_progress"

    def test_multiple_followups_persist(self, temp_dir: Path):
        """Multiple follow-up phases persist through save/load cycles."""
        plan = ImplementationPlan(
            feature="Test Feature",
            phases=[
                Phase(
                    phase=1,
                    name="Original",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        plan_path = temp_dir / "implementation_plan.json"

        # Add first follow-up and save
        plan.add_followup_phase("Follow-Up 1", [Subtask(id="f1", description="Task 1")])
        plan.save(plan_path)

        # Load, add second follow-up, save
        plan = ImplementationPlan.load(plan_path)
        plan.add_followup_phase("Follow-Up 2", [Subtask(id="f2", description="Task 2")])
        plan.save(plan_path)

        # Load and verify
        final_plan = ImplementationPlan.load(plan_path)

        assert len(final_plan.phases) == 3
        assert final_plan.phases[1].name == "Follow-Up 1"
        assert final_plan.phases[2].name == "Follow-Up 2"
        assert final_plan.phases[2].depends_on == [1, 2]


class TestFollowupProgressCalculation:
    """Tests for progress calculation with follow-up phases."""

    def test_progress_includes_followup_chunks(self):
        """Progress calculation includes follow-up chunks."""
        plan = ImplementationPlan(
            feature="Test Feature",
            phases=[
                Phase(
                    phase=1,
                    name="Original",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        # Initially 100% complete
        progress = plan.get_progress()
        assert progress["completed_subtasks"] == 1
        assert progress["total_subtasks"] == 1
        assert progress["is_complete"] is True

        # Add follow-up
        plan.add_followup_phase("Follow-Up", [Subtask(id="f1", description="New task")])

        # Now 50% complete
        progress = plan.get_progress()
        assert progress["completed_subtasks"] == 1
        assert progress["total_subtasks"] == 2
        assert progress["percent_complete"] == 50.0
        assert progress["is_complete"] is False

    def test_next_chunk_returns_followup_chunk(self):
        """get_next_subtask returns follow-up subtask when original work is done."""
        plan = ImplementationPlan(
            feature="Test Feature",
            phases=[
                Phase(
                    phase=1,
                    name="Original",
                    subtasks=[Subtask(id="c1", description="Task", status=SubtaskStatus.COMPLETED)],
                ),
            ],
        )

        # No next chunk when complete
        assert plan.get_next_subtask() is None

        # Add follow-up
        plan.add_followup_phase("Follow-Up", [Subtask(id="f1", description="New task")])

        # Now follow-up chunk is next
        next_work = plan.get_next_subtask()
        assert next_work is not None
        phase, chunk = next_work
        assert phase.name == "Follow-Up"
        assert chunk.id == "f1"

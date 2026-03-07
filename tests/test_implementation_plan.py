#!/usr/bin/env python3
"""
Tests for Implementation Plan Management
========================================

Tests the implementation_plan.py module functionality including:
- Data structures (Subtask, Phase, ImplementationPlan)
- Status transitions
- Progress tracking
- Dependency resolution
- Plan serialization
"""

import json
import pytest
from datetime import datetime
from pathlib import Path

from implementation_plan import (
    ImplementationPlan,
    Phase,
    Subtask,
    Verification,
    WorkflowType,
    PhaseType,
    SubtaskStatus,
    VerificationType,
    create_feature_plan,
    create_investigation_plan,
    create_refactor_plan,
)


class TestSubtask:
    """Tests for Subtask data structure."""

    def test_create_simple_chunk(self):
        """Creates a simple chunk with defaults."""
        chunk = Subtask(
            id="chunk-1",
            description="Implement user model",
        )

        assert chunk.id == "chunk-1"
        assert chunk.description == "Implement user model"
        assert chunk.status == SubtaskStatus.PENDING
        assert chunk.service is None
        assert chunk.files_to_modify == []
        assert chunk.files_to_create == []

    def test_create_full_chunk(self):
        """Creates a chunk with all fields."""
        chunk = Subtask(
            id="chunk-2",
            description="Add API endpoint",
            status=SubtaskStatus.IN_PROGRESS,
            service="backend",
            files_to_modify=["app/routes.py"],
            files_to_create=["app/models/user.py"],
            patterns_from=["app/models/profile.py"],
        )

        assert chunk.service == "backend"
        assert "app/routes.py" in chunk.files_to_modify
        assert "app/models/user.py" in chunk.files_to_create

    def test_chunk_start(self):
        """Subtask can be started."""
        chunk = Subtask(id="test", description="Test")

        chunk.start(session_id=1)

        assert chunk.status == SubtaskStatus.IN_PROGRESS
        assert chunk.started_at is not None
        assert chunk.session_id == 1

    def test_chunk_complete(self):
        """Subtask can be completed."""
        chunk = Subtask(id="test", description="Test")
        chunk.start(session_id=1)

        chunk.complete(output="Done successfully")

        assert chunk.status == SubtaskStatus.COMPLETED
        assert chunk.completed_at is not None
        assert chunk.actual_output == "Done successfully"

    def test_chunk_fail(self):
        """Subtask can be marked as failed."""
        chunk = Subtask(id="test", description="Test")
        chunk.start(session_id=1)

        chunk.fail(reason="Test error")

        assert chunk.status == SubtaskStatus.FAILED
        assert "FAILED: Test error" in chunk.actual_output

    def test_chunk_to_dict(self):
        """Subtask serializes to dict correctly."""
        chunk = Subtask(
            id="chunk-1",
            description="Test chunk",
            service="backend",
            files_to_modify=["file.py"],
        )

        data = chunk.to_dict()

        assert data["id"] == "chunk-1"
        assert data["description"] == "Test chunk"
        assert data["status"] == "pending"
        assert data["service"] == "backend"
        assert "file.py" in data["files_to_modify"]

    def test_chunk_from_dict(self):
        """Subtask deserializes from dict correctly."""
        data = {
            "id": "chunk-1",
            "description": "Test chunk",
            "status": "completed",
            "service": "frontend",
        }

        chunk = Subtask.from_dict(data)

        assert chunk.id == "chunk-1"
        assert chunk.status == SubtaskStatus.COMPLETED
        assert chunk.service == "frontend"


class TestVerification:
    """Tests for Verification data structure."""

    def test_command_verification(self):
        """Creates command-type verification."""
        verification = Verification(
            type=VerificationType.COMMAND,
            run="pytest tests/",
        )

        assert verification.type == VerificationType.COMMAND
        assert verification.run == "pytest tests/"

    def test_api_verification(self):
        """Creates API-type verification."""
        verification = Verification(
            type=VerificationType.API,
            url="/api/users",
            method="POST",
            expect_status=201,
        )

        assert verification.type == VerificationType.API
        assert verification.method == "POST"
        assert verification.expect_status == 201

    def test_verification_to_dict(self):
        """Verification serializes to dict."""
        verification = Verification(
            type=VerificationType.BROWSER,
            scenario="User can upload avatar",
        )

        data = verification.to_dict()

        assert data["type"] == "browser"
        assert data["scenario"] == "User can upload avatar"

    def test_verification_from_dict(self):
        """Verification deserializes from dict."""
        data = {
            "type": "command",
            "run": "npm test",
        }

        verification = Verification.from_dict(data)

        assert verification.type == VerificationType.COMMAND
        assert verification.run == "npm test"


class TestPhase:
    """Tests for Phase data structure."""

    def test_create_phase(self):
        """Creates a phase with chunks."""
        chunk1 = Subtask(id="c1", description="Chunk 1")
        chunk2 = Subtask(id="c2", description="Chunk 2")

        phase = Phase(
            phase=1,
            name="Setup",
            type=PhaseType.SETUP,
            subtasks=[chunk1, chunk2],
        )

        assert phase.phase == 1
        assert phase.name == "Setup"
        assert len(phase.subtasks) == 2

    def test_phase_is_complete(self):
        """Phase completion checks all chunks."""
        chunk1 = Subtask(id="c1", description="Chunk 1", status=SubtaskStatus.COMPLETED)
        chunk2 = Subtask(id="c2", description="Chunk 2", status=SubtaskStatus.COMPLETED)
        phase = Phase(phase=1, name="Test", subtasks=[chunk1, chunk2])

        assert phase.is_complete() is True

    def test_phase_not_complete_with_pending(self):
        """Phase not complete with pending chunks."""
        chunk1 = Subtask(id="c1", description="Chunk 1", status=SubtaskStatus.COMPLETED)
        chunk2 = Subtask(id="c2", description="Chunk 2", status=SubtaskStatus.PENDING)
        phase = Phase(phase=1, name="Test", subtasks=[chunk1, chunk2])

        assert phase.is_complete() is False

    def test_phase_get_pending_chunks(self):
        """Gets pending chunks from phase."""
        chunk1 = Subtask(id="c1", description="Chunk 1", status=SubtaskStatus.COMPLETED)
        chunk2 = Subtask(id="c2", description="Chunk 2", status=SubtaskStatus.PENDING)
        chunk3 = Subtask(id="c3", description="Chunk 3", status=SubtaskStatus.PENDING)
        phase = Phase(phase=1, name="Test", subtasks=[chunk1, chunk2, chunk3])

        pending = phase.get_pending_chunks()

        assert len(pending) == 2
        assert all(c.status == SubtaskStatus.PENDING for c in pending)

    def test_phase_get_progress(self):
        """Gets progress counts from phase."""
        chunk1 = Subtask(id="c1", description="Chunk 1", status=SubtaskStatus.COMPLETED)
        chunk2 = Subtask(id="c2", description="Chunk 2", status=SubtaskStatus.COMPLETED)
        chunk3 = Subtask(id="c3", description="Chunk 3", status=SubtaskStatus.PENDING)
        phase = Phase(phase=1, name="Test", subtasks=[chunk1, chunk2, chunk3])

        completed, total = phase.get_progress()

        assert completed == 2
        assert total == 3

    def test_phase_to_dict(self):
        """Phase serializes to dict."""
        chunk = Subtask(id="c1", description="Test")
        phase = Phase(
            phase=1,
            name="Setup",
            type=PhaseType.SETUP,
            subtasks=[chunk],
            depends_on=[],
        )

        data = phase.to_dict()

        assert data["phase"] == 1
        assert data["name"] == "Setup"
        assert data["type"] == "setup"
        assert len(data["chunks"]) == 1

    def test_phase_from_dict(self):
        """Phase deserializes from dict."""
        data = {
            "phase": 2,
            "name": "Implementation",
            "type": "implementation",
            "chunks": [{"id": "c1", "description": "Test"}],
            "depends_on": [1],
        }

        phase = Phase.from_dict(data)

        assert phase.phase == 2
        assert phase.type == PhaseType.IMPLEMENTATION
        assert len(phase.subtasks) == 1
        assert 1 in phase.depends_on


class TestImplementationPlan:
    """Tests for ImplementationPlan data structure."""

    def test_create_plan(self):
        """Creates an implementation plan."""
        plan = ImplementationPlan(
            feature="User Authentication",
            workflow_type=WorkflowType.FEATURE,
            services_involved=["backend", "frontend"],
        )

        assert plan.feature == "User Authentication"
        assert plan.workflow_type == WorkflowType.FEATURE
        assert "backend" in plan.services_involved

    def test_plan_get_available_phases(self, sample_implementation_plan: dict):
        """Gets phases with satisfied dependencies."""
        plan = ImplementationPlan.from_dict(sample_implementation_plan)

        # Mark phase 1 as complete
        for chunk in plan.phases[0].subtasks:
            chunk.status = SubtaskStatus.COMPLETED

        available = plan.get_available_phases()

        # Phase 2 and 3 depend on phase 1, so they should be available
        phase_nums = [p.phase for p in available]
        assert 2 in phase_nums
        assert 3 in phase_nums

    def test_plan_get_next_subtask(self, sample_implementation_plan: dict):
        """Gets next subtask to work on."""
        plan = ImplementationPlan.from_dict(sample_implementation_plan)

        result = plan.get_next_subtask()

        assert result is not None
        phase, subtask = result
        # Should be first pending subtask in phase 1
        assert phase.phase == 1
        assert subtask.status == SubtaskStatus.PENDING

    def test_plan_get_progress(self, sample_implementation_plan: dict):
        """Gets overall progress."""
        plan = ImplementationPlan.from_dict(sample_implementation_plan)

        # Complete some subtasks
        plan.phases[0].subtasks[0].status = SubtaskStatus.COMPLETED

        progress = plan.get_progress()

        assert progress["total_phases"] == 3
        assert progress["total_subtasks"] == 4  # Based on fixture
        assert progress["completed_subtasks"] == 1
        assert progress["percent_complete"] == 25.0  # 1/4 = 25%
        assert progress["is_complete"] is False

    def test_plan_save_and_load(self, temp_dir: Path, sample_implementation_plan: dict):
        """Plan saves and loads correctly."""
        plan = ImplementationPlan.from_dict(sample_implementation_plan)
        plan_path = temp_dir / "plan.json"

        plan.save(plan_path)
        loaded = ImplementationPlan.load(plan_path)

        assert loaded.feature == plan.feature
        assert len(loaded.phases) == len(plan.phases)
        assert loaded.updated_at is not None

    def test_plan_to_dict(self, sample_implementation_plan: dict):
        """Plan serializes to dict."""
        plan = ImplementationPlan.from_dict(sample_implementation_plan)

        data = plan.to_dict()

        assert data["feature"] == "User Avatar Upload"
        assert data["workflow_type"] == "feature"
        assert len(data["phases"]) == 3

    def test_plan_from_dict(self, sample_implementation_plan: dict):
        """Plan deserializes from dict."""
        plan = ImplementationPlan.from_dict(sample_implementation_plan)

        assert plan.feature == "User Avatar Upload"
        assert plan.workflow_type == WorkflowType.FEATURE
        assert len(plan.services_involved) == 3

    def test_plan_status_summary(self, sample_implementation_plan: dict):
        """Plan generates status summary."""
        plan = ImplementationPlan.from_dict(sample_implementation_plan)

        summary = plan.get_status_summary()

        assert "User Avatar Upload" in summary
        assert "feature" in summary
        assert "0%" in summary or "chunks" in summary


class TestCreateFeaturePlan:
    """Tests for create_feature_plan helper."""

    def test_creates_basic_plan(self):
        """Creates a feature plan with phases."""
        phases_config = [
            {
                "name": "Backend",
                "chunks": [
                    {"id": "api", "description": "Add API endpoint"},
                ],
            },
            {
                "name": "Frontend",
                "depends_on": [1],
                "chunks": [
                    {"id": "ui", "description": "Add UI component"},
                ],
            },
        ]

        plan = create_feature_plan(
            feature="User Profile",
            services=["backend", "frontend"],
            phases_config=phases_config,
        )

        assert plan.feature == "User Profile"
        assert plan.workflow_type == WorkflowType.FEATURE
        assert len(plan.phases) == 2
        assert plan.phases[1].depends_on == [1]

    def test_sets_parallel_safe(self):
        """Respects parallel_safe flag."""
        phases_config = [
            {
                "name": "Parallel Phase",
                "parallel_safe": True,
                "chunks": [
                    {"id": "c1", "description": "Chunk 1"},
                    {"id": "c2", "description": "Chunk 2"},
                ],
            },
        ]

        plan = create_feature_plan(
            feature="Test",
            services=["backend"],
            phases_config=phases_config,
        )

        assert plan.phases[0].parallel_safe is True


class TestCreateInvestigationPlan:
    """Tests for create_investigation_plan helper."""

    def test_creates_investigation_plan(self):
        """Creates an investigation plan for debugging."""
        plan = create_investigation_plan(
            bug_description="Login fails for users with special characters",
            services=["backend", "frontend"],
        )

        assert "Fix:" in plan.feature
        assert plan.workflow_type == WorkflowType.INVESTIGATION
        assert len(plan.phases) == 3  # Reproduce, Investigate, Fix

    def test_has_blocked_fix_chunks(self):
        """Fix phase starts blocked."""
        plan = create_investigation_plan(
            bug_description="Test bug",
            services=["backend"],
        )

        # Fix phase should have blocked chunks
        fix_phase = plan.phases[2]  # Phase 3 - Fix
        assert any(c.status == SubtaskStatus.BLOCKED for c in fix_phase.subtasks)


class TestCreateRefactorPlan:
    """Tests for create_refactor_plan helper."""

    def test_creates_refactor_plan(self):
        """Creates a refactor plan with stages."""
        stages = [
            {
                "name": "Add New System",
                "chunks": [
                    {"id": "new-api", "description": "Add new API"},
                ],
            },
            {
                "name": "Migrate Consumers",
                "chunks": [
                    {"id": "migrate", "description": "Update consumers"},
                ],
            },
            {
                "name": "Remove Old System",
                "chunks": [
                    {"id": "remove", "description": "Remove old code"},
                ],
            },
        ]

        plan = create_refactor_plan(
            refactor_description="Replace auth system",
            services=["backend"],
            stages=stages,
        )

        assert plan.workflow_type == WorkflowType.REFACTOR
        assert len(plan.phases) == 3
        # Each phase should depend on the previous
        assert plan.phases[1].depends_on == [1]
        assert plan.phases[2].depends_on == [2]


class TestDependencyResolution:
    """Tests for phase dependency resolution."""

    def test_no_available_phases_when_deps_not_met(self):
        """No phases available when dependencies aren't met."""
        plan = ImplementationPlan(
            feature="Test",
            phases=[
                Phase(phase=1, name="Setup", subtasks=[
                    Subtask(id="c1", description="Setup", status=SubtaskStatus.PENDING)
                ]),
                Phase(phase=2, name="Build", depends_on=[1], subtasks=[
                    Subtask(id="c2", description="Build")
                ]),
            ],
        )

        available = plan.get_available_phases()

        # Only phase 1 should be available (no dependencies)
        assert len(available) == 1
        assert available[0].phase == 1

    def test_multiple_phases_available_parallel(self):
        """Multiple phases can be available in parallel."""
        plan = ImplementationPlan(
            feature="Test",
            phases=[
                Phase(phase=1, name="Setup", subtasks=[
                    Subtask(id="c1", description="Setup", status=SubtaskStatus.COMPLETED)
                ]),
                Phase(phase=2, name="Backend", depends_on=[1], subtasks=[
                    Subtask(id="c2", description="Backend")
                ]),
                Phase(phase=3, name="Frontend", depends_on=[1], subtasks=[
                    Subtask(id="c3", description="Frontend")
                ]),
            ],
        )

        available = plan.get_available_phases()

        # Phases 2 and 3 should both be available (both depend only on phase 1)
        assert len(available) == 2
        phase_nums = [p.phase for p in available]
        assert 2 in phase_nums
        assert 3 in phase_nums

    def test_phase_blocked_by_multiple_deps(self):
        """Phase blocked when any dependency not met."""
        plan = ImplementationPlan(
            feature="Test",
            phases=[
                Phase(phase=1, name="Phase1", subtasks=[
                    Subtask(id="c1", description="C1", status=SubtaskStatus.COMPLETED)
                ]),
                Phase(phase=2, name="Phase2", subtasks=[
                    Subtask(id="c2", description="C2", status=SubtaskStatus.PENDING)
                ]),
                Phase(phase=3, name="Phase3", depends_on=[1, 2], subtasks=[
                    Subtask(id="c3", description="C3")
                ]),
            ],
        )

        available = plan.get_available_phases()

        # Phase 3 requires both 1 and 2, but 2 isn't complete
        phase_nums = [p.phase for p in available]
        assert 3 not in phase_nums


class TestSubtaskCritique:
    """Tests for self-critique functionality on subtasks."""

    def test_chunk_stores_critique_result(self):
        """Subtask can store critique results."""
        chunk = Subtask(id="test", description="Test")

        chunk.critique_result = {
            "passed": True,
            "issues": [],
            "suggestions": ["Consider adding error handling"],
        }

        assert chunk.critique_result["passed"] is True

    def test_critique_serializes(self):
        """Critique result serializes correctly."""
        chunk = Subtask(id="test", description="Test")
        chunk.critique_result = {"passed": False, "issues": ["Missing tests"]}

        data = chunk.to_dict()

        assert "critique_result" in data
        assert data["critique_result"]["passed"] is False

    def test_critique_deserializes(self):
        """Critique result deserializes correctly."""
        data = {
            "id": "test",
            "description": "Test",
            "critique_result": {"passed": True, "score": 8},
        }

        chunk = Subtask.from_dict(data)

        assert chunk.critique_result is not None
        assert chunk.critique_result["score"] == 8


class TestSchemaValidation:
    """Tests for JSON schema validation of implementation plans."""

    # =========================================================================
    # Valid Schema Tests
    # =========================================================================

    def test_valid_minimal_plan_schema(self):
        """Minimal valid plan with required fields passes validation."""
        valid_plan = {
            "feature": "Test Feature",
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Setup",
                    "subtasks": [
                        {"id": "task-1", "description": "Do something", "status": "pending"}
                    ],
                }
            ],
        }

        plan = ImplementationPlan.from_dict(valid_plan)

        assert plan.feature == "Test Feature"
        assert plan.workflow_type == WorkflowType.FEATURE
        assert len(plan.phases) == 1
        assert len(plan.phases[0].subtasks) == 1

    def test_valid_full_plan_schema(self):
        """Full plan with all optional fields validates correctly."""
        valid_plan = {
            "feature": "User Authentication",
            "workflow_type": "feature",
            "services_involved": ["backend", "frontend", "worker"],
            "phases": [
                {
                    "phase": 1,
                    "name": "Backend Foundation",
                    "type": "setup",
                    "depends_on": [],
                    "parallel_safe": True,
                    "subtasks": [
                        {
                            "id": "subtask-1-1",
                            "description": "Add user model",
                            "status": "completed",
                            "service": "backend",
                            "files_to_modify": ["app/models.py"],
                            "files_to_create": ["app/auth.py"],
                            "patterns_from": ["app/base_model.py"],
                            "verification": {
                                "type": "command",
                                "run": "pytest tests/",
                            },
                            "expected_output": "Tests pass",
                            "actual_output": "All 5 tests passed",
                            "started_at": "2024-01-01T10:00:00",
                            "completed_at": "2024-01-01T10:30:00",
                            "session_id": 1,
                        }
                    ],
                },
                {
                    "phase": 2,
                    "name": "Frontend Integration",
                    "type": "implementation",
                    "depends_on": [1],
                    "subtasks": [
                        {
                            "id": "subtask-2-1",
                            "description": "Add login form",
                            "status": "pending",
                            "service": "frontend",
                        }
                    ],
                },
            ],
            "final_acceptance": [
                "User can log in",
                "Sessions persist across refreshes",
            ],
            "created_at": "2024-01-01T09:00:00",
            "updated_at": "2024-01-01T10:30:00",
            "spec_file": "spec.md",
        }

        plan = ImplementationPlan.from_dict(valid_plan)

        assert plan.feature == "User Authentication"
        assert len(plan.services_involved) == 3
        assert len(plan.phases) == 2
        assert plan.phases[0].parallel_safe is True
        assert plan.phases[1].depends_on == [1]
        assert len(plan.final_acceptance) == 2

    def test_all_workflow_types_valid(self):
        """All defined workflow types are accepted."""
        workflow_types = ["feature", "refactor", "investigation", "migration", "simple"]

        for wf_type in workflow_types:
            plan_data = {
                "feature": f"Test {wf_type}",
                "workflow_type": wf_type,
                "phases": [
                    {
                        "phase": 1,
                        "name": "Test Phase",
                        "subtasks": [
                            {"id": "t1", "description": "Test", "status": "pending"}
                        ],
                    }
                ],
            }

            plan = ImplementationPlan.from_dict(plan_data)
            assert plan.workflow_type.value == wf_type

    def test_all_phase_types_valid(self):
        """All defined phase types are accepted."""
        phase_types = ["setup", "implementation", "investigation", "integration", "cleanup"]

        for phase_type in phase_types:
            plan_data = {
                "feature": "Test",
                "workflow_type": "feature",
                "phases": [
                    {
                        "phase": 1,
                        "name": "Test Phase",
                        "type": phase_type,
                        "subtasks": [
                            {"id": "t1", "description": "Test", "status": "pending"}
                        ],
                    }
                ],
            }

            plan = ImplementationPlan.from_dict(plan_data)
            assert plan.phases[0].type.value == phase_type

    def test_all_subtask_statuses_valid(self):
        """All defined subtask statuses are accepted."""
        statuses = ["pending", "in_progress", "completed", "blocked", "failed"]

        for status in statuses:
            subtask_data = {
                "id": "test",
                "description": "Test subtask",
                "status": status,
            }

            subtask = Subtask.from_dict(subtask_data)
            assert subtask.status.value == status

    def test_all_verification_types_valid(self):
        """All defined verification types are accepted."""
        ver_types = ["command", "api", "browser", "component", "manual", "none"]

        for ver_type in ver_types:
            ver_data = {"type": ver_type}

            verification = Verification.from_dict(ver_data)
            assert verification.type.value == ver_type

    # =========================================================================
    # Invalid Schema Tests - Missing Required Fields
    # =========================================================================

    def test_invalid_plan_missing_feature_uses_default(self):
        """Plan without feature field uses default name."""
        invalid_plan = {
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "t1", "description": "Test", "status": "pending"}
                    ],
                }
            ],
        }

        plan = ImplementationPlan.from_dict(invalid_plan)
        assert plan.feature == "Unnamed Feature"

    def test_invalid_plan_missing_workflow_type_uses_default(self):
        """Plan without workflow_type uses default."""
        invalid_plan = {
            "feature": "Test",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "subtasks": [
                        {"id": "t1", "description": "Test", "status": "pending"}
                    ],
                }
            ],
        }

        plan = ImplementationPlan.from_dict(invalid_plan)
        assert plan.workflow_type == WorkflowType.FEATURE

    def test_invalid_plan_missing_phases_creates_empty_list(self):
        """Plan without phases creates empty phases list."""
        invalid_plan = {
            "feature": "Test",
            "workflow_type": "feature",
        }

        plan = ImplementationPlan.from_dict(invalid_plan)
        assert plan.phases == []

    def test_invalid_phase_missing_name_uses_fallback(self):
        """Phase without name uses fallback name."""
        plan_data = {
            "feature": "Test",
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "subtasks": [
                        {"id": "t1", "description": "Test", "status": "pending"}
                    ],
                }
            ],
        }

        plan = ImplementationPlan.from_dict(plan_data)
        assert plan.phases[0].name == "Phase 1"

    def test_invalid_phase_missing_subtasks_creates_empty_list(self):
        """Phase without subtasks creates empty subtasks list."""
        plan_data = {
            "feature": "Test",
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Empty Phase",
                }
            ],
        }

        plan = ImplementationPlan.from_dict(plan_data)
        assert plan.phases[0].subtasks == []

    def test_invalid_subtask_missing_status_uses_default(self):
        """Subtask without status defaults to pending."""
        subtask_data = {
            "id": "test",
            "description": "Test subtask",
        }

        subtask = Subtask.from_dict(subtask_data)
        assert subtask.status == SubtaskStatus.PENDING

    # =========================================================================
    # Invalid Schema Tests - Wrong Types
    # =========================================================================

    def test_invalid_workflow_type_falls_back_to_feature(self):
        """Unknown workflow_type falls back to feature with warning."""
        invalid_plan = {
            "feature": "Test",
            "workflow_type": "invalid_type",
            "phases": [],
        }

        plan = ImplementationPlan.from_dict(invalid_plan)
        assert plan.workflow_type == WorkflowType.FEATURE

    def test_invalid_subtask_status_raises_error(self):
        """Invalid subtask status raises ValueError."""
        subtask_data = {
            "id": "test",
            "description": "Test",
            "status": "invalid_status",
        }

        with pytest.raises(ValueError):
            Subtask.from_dict(subtask_data)

    def test_invalid_phase_type_raises_error(self):
        """Invalid phase type raises ValueError."""
        plan_data = {
            "feature": "Test",
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test",
                    "type": "invalid_type",
                    "subtasks": [],
                }
            ],
        }

        with pytest.raises(ValueError):
            ImplementationPlan.from_dict(plan_data)

    def test_invalid_verification_type_raises_error(self):
        """Invalid verification type raises ValueError."""
        ver_data = {"type": "invalid_type"}

        with pytest.raises(ValueError):
            Verification.from_dict(ver_data)

    # =========================================================================
    # Edge Cases
    # =========================================================================

    def test_empty_plan_schema(self):
        """Completely empty dict creates plan with defaults."""
        plan = ImplementationPlan.from_dict({})

        assert plan.feature == "Unnamed Feature"
        assert plan.workflow_type == WorkflowType.FEATURE
        assert plan.phases == []
        assert plan.services_involved == []

    def test_plan_with_title_field_instead_of_feature(self):
        """Plan with 'title' field instead of 'feature' works."""
        plan_data = {
            "title": "My Feature Title",
            "workflow_type": "feature",
            "phases": [],
        }

        plan = ImplementationPlan.from_dict(plan_data)
        assert plan.feature == "My Feature Title"

    def test_phase_with_chunks_field_instead_of_subtasks(self):
        """Phase with 'chunks' field (legacy) works."""
        plan_data = {
            "feature": "Test",
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Test Phase",
                    "chunks": [
                        {"id": "t1", "description": "Test", "status": "pending"}
                    ],
                }
            ],
        }

        plan = ImplementationPlan.from_dict(plan_data)
        assert len(plan.phases[0].subtasks) == 1
        assert plan.phases[0].subtasks[0].id == "t1"

    def test_plan_preserves_qa_signoff_structure(self):
        """Plan preserves qa_signoff dict structure."""
        plan_data = {
            "feature": "Test",
            "workflow_type": "feature",
            "phases": [],
            "qa_signoff": {
                "status": "approved",
                "qa_session": 1,
                "timestamp": "2024-01-01T12:00:00",
                "tests_passed": {"unit": True, "integration": True},
            },
        }

        plan = ImplementationPlan.from_dict(plan_data)

        assert plan.qa_signoff is not None
        assert plan.qa_signoff["status"] == "approved"
        assert plan.qa_signoff["qa_session"] == 1
        assert plan.qa_signoff["tests_passed"]["unit"] is True

    def test_subtask_with_all_optional_fields(self):
        """Subtask with all optional fields deserializes correctly."""
        subtask_data = {
            "id": "complex-task",
            "description": "Complex task with all fields",
            "status": "completed",
            "service": "backend",
            "all_services": True,
            "files_to_modify": ["file1.py", "file2.py"],
            "files_to_create": ["new_file.py"],
            "patterns_from": ["pattern.py"],
            "verification": {"type": "command", "run": "pytest"},
            "expected_output": "Tests pass",
            "actual_output": "All tests passed",
            "started_at": "2024-01-01T10:00:00",
            "completed_at": "2024-01-01T10:30:00",
            "session_id": 42,
            "critique_result": {"passed": True, "score": 9},
        }

        subtask = Subtask.from_dict(subtask_data)

        assert subtask.id == "complex-task"
        assert subtask.service == "backend"
        assert subtask.all_services is True
        assert len(subtask.files_to_modify) == 2
        assert subtask.verification.type == VerificationType.COMMAND
        assert subtask.session_id == 42
        assert subtask.critique_result["score"] == 9

    def test_verification_with_api_fields(self):
        """API verification with all fields deserializes correctly."""
        ver_data = {
            "type": "api",
            "url": "/api/users",
            "method": "POST",
            "expect_status": 201,
            "expect_contains": "user_id",
        }

        verification = Verification.from_dict(ver_data)

        assert verification.type == VerificationType.API
        assert verification.url == "/api/users"
        assert verification.method == "POST"
        assert verification.expect_status == 201
        assert verification.expect_contains == "user_id"

    def test_verification_with_browser_scenario(self):
        """Browser verification with scenario deserializes correctly."""
        ver_data = {
            "type": "browser",
            "scenario": "User can click login button and see dashboard",
        }

        verification = Verification.from_dict(ver_data)

        assert verification.type == VerificationType.BROWSER
        assert verification.scenario == "User can click login button and see dashboard"

    def test_plan_round_trip_preserves_data(self):
        """Plan survives to_dict/from_dict round trip."""
        original_plan = ImplementationPlan(
            feature="Round Trip Test",
            workflow_type=WorkflowType.REFACTOR,
            services_involved=["backend", "frontend"],
            phases=[
                Phase(
                    phase=1,
                    name="Phase One",
                    type=PhaseType.SETUP,
                    subtasks=[
                        Subtask(
                            id="task-1",
                            description="First task",
                            status=SubtaskStatus.COMPLETED,
                            service="backend",
                            files_to_modify=["file.py"],
                            verification=Verification(
                                type=VerificationType.COMMAND,
                                run="pytest",
                            ),
                        )
                    ],
                    depends_on=[],
                    parallel_safe=True,
                )
            ],
            final_acceptance=["Feature works"],
        )

        # Round trip
        data = original_plan.to_dict()
        restored_plan = ImplementationPlan.from_dict(data)

        # Verify
        assert restored_plan.feature == original_plan.feature
        assert restored_plan.workflow_type == original_plan.workflow_type
        assert restored_plan.services_involved == original_plan.services_involved
        assert len(restored_plan.phases) == len(original_plan.phases)
        assert restored_plan.phases[0].name == original_plan.phases[0].name
        assert restored_plan.phases[0].parallel_safe == original_plan.phases[0].parallel_safe
        assert len(restored_plan.phases[0].subtasks) == len(original_plan.phases[0].subtasks)
        assert restored_plan.phases[0].subtasks[0].id == original_plan.phases[0].subtasks[0].id
        assert restored_plan.phases[0].subtasks[0].verification.run == "pytest"

    def test_deeply_nested_phases_with_dependencies(self):
        """Plan with complex phase dependencies deserializes correctly."""
        plan_data = {
            "feature": "Complex Feature",
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Foundation",
                    "depends_on": [],
                    "subtasks": [{"id": "t1", "description": "Task 1", "status": "completed"}],
                },
                {
                    "phase": 2,
                    "name": "Build A",
                    "depends_on": [1],
                    "subtasks": [{"id": "t2", "description": "Task 2", "status": "completed"}],
                },
                {
                    "phase": 3,
                    "name": "Build B",
                    "depends_on": [1],
                    "subtasks": [{"id": "t3", "description": "Task 3", "status": "pending"}],
                },
                {
                    "phase": 4,
                    "name": "Integration",
                    "depends_on": [2, 3],
                    "subtasks": [{"id": "t4", "description": "Task 4", "status": "pending"}],
                },
            ],
        }

        plan = ImplementationPlan.from_dict(plan_data)

        assert len(plan.phases) == 4
        assert plan.phases[0].depends_on == []
        assert plan.phases[1].depends_on == [1]
        assert plan.phases[2].depends_on == [1]
        assert plan.phases[3].depends_on == [2, 3]

        # Test dependency resolution
        available = plan.get_available_phases()
        # Phase 1 complete, so phases 2 and 3 should be available (but 3 is pending, 2 is complete)
        # Actually phase 2 is also complete, so phase 4 should check if 2 AND 3 are done
        # Phase 3 has pending subtask, so phase 4 is not available
        phase_nums = [p.phase for p in available]
        assert 3 in phase_nums  # Phase 3 depends on 1 (complete), has pending work
        assert 4 not in phase_nums  # Phase 4 depends on 2 AND 3, but 3 not complete

    def test_plan_status_fields_preserved(self):
        """Plan status and planStatus fields are preserved."""
        plan_data = {
            "feature": "Test",
            "workflow_type": "feature",
            "phases": [],
            "status": "in_progress",
            "planStatus": "in_progress",
            "recoveryNote": "Resumed after crash",
        }

        plan = ImplementationPlan.from_dict(plan_data)

        assert plan.status == "in_progress"
        assert plan.planStatus == "in_progress"
        assert plan.recoveryNote == "Resumed after crash"

        # Verify they serialize back
        data = plan.to_dict()
        assert data["status"] == "in_progress"
        assert data["planStatus"] == "in_progress"
        assert data["recoveryNote"] == "Resumed after crash"


class TestEdgeCaseStateTransitions:
    """Tests for edge cases in plan state transitions (stuck, skipped, blocked)."""

    # =========================================================================
    # BLOCKED Status Tests
    # =========================================================================

    def test_chunk_blocked_status_initialization(self):
        """Chunk can be initialized with blocked status."""
        chunk = Subtask(
            id="blocked-task",
            description="Task waiting for investigation results",
            status=SubtaskStatus.BLOCKED,
        )

        assert chunk.status == SubtaskStatus.BLOCKED
        assert chunk.started_at is None
        assert chunk.completed_at is None

    def test_chunk_blocked_to_pending_transition(self):
        """Blocked chunk can transition to pending (unblocking)."""
        chunk = Subtask(id="test", description="Test", status=SubtaskStatus.BLOCKED)

        # Manually unblock by setting to pending
        chunk.status = SubtaskStatus.PENDING

        assert chunk.status == SubtaskStatus.PENDING

    def test_chunk_blocked_to_in_progress_transition(self):
        """Blocked chunk can be started directly (auto-unblock)."""
        chunk = Subtask(id="test", description="Test", status=SubtaskStatus.BLOCKED)

        chunk.start(session_id=1)

        assert chunk.status == SubtaskStatus.IN_PROGRESS
        assert chunk.started_at is not None
        assert chunk.session_id == 1

    def test_blocked_chunk_serialization_roundtrip(self):
        """Blocked status survives serialization/deserialization."""
        chunk = Subtask(
            id="blocked-task",
            description="Blocked task",
            status=SubtaskStatus.BLOCKED,
        )

        data = chunk.to_dict()
        restored = Subtask.from_dict(data)

        assert restored.status == SubtaskStatus.BLOCKED
        assert data["status"] == "blocked"

    def test_phase_with_all_blocked_chunks(self):
        """Phase with all blocked chunks is not complete."""
        phase = Phase(
            phase=1,
            name="Blocked Phase",
            subtasks=[
                Subtask(id="c1", description="Task 1", status=SubtaskStatus.BLOCKED),
                Subtask(id="c2", description="Task 2", status=SubtaskStatus.BLOCKED),
            ],
        )

        assert phase.is_complete() is False
        assert phase.get_pending_subtasks() == []  # Blocked != pending
        completed, total = phase.get_progress()
        assert completed == 0
        assert total == 2

    def test_phase_completion_ignores_blocked_chunks(self):
        """Phase is not complete if any chunks are blocked."""
        phase = Phase(
            phase=1,
            name="Mixed Phase",
            subtasks=[
                Subtask(id="c1", description="Task 1", status=SubtaskStatus.COMPLETED),
                Subtask(id="c2", description="Task 2", status=SubtaskStatus.BLOCKED),
            ],
        )

        assert phase.is_complete() is False
        completed, total = phase.get_progress()
        assert completed == 1
        assert total == 2

    def test_investigation_plan_blocked_fix_chunks(self):
        """Investigation plan has blocked chunks in fix phase."""
        plan = create_investigation_plan(
            bug_description="User login fails intermittently",
            services=["backend"],
        )

        fix_phase = plan.phases[2]  # Phase 3 - Fix
        blocked_chunks = [c for c in fix_phase.subtasks if c.status == SubtaskStatus.BLOCKED]

        assert len(blocked_chunks) == 2
        assert any("fix" in c.id.lower() for c in blocked_chunks)
        assert any("regression" in c.id.lower() for c in blocked_chunks)

    # =========================================================================
    # STUCK Plan Tests
    # =========================================================================

    def test_plan_stuck_all_phases_blocked(self):
        """Plan is stuck when all available phases have only blocked subtasks."""
        plan = ImplementationPlan(
            feature="Stuck Plan",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[
                        Subtask(id="c1", description="Blocked", status=SubtaskStatus.BLOCKED),
                    ],
                ),
            ],
        )

        # No pending subtasks available
        result = plan.get_next_subtask()

        assert result is None

    def test_plan_stuck_due_to_unmet_dependencies(self):
        """Plan is stuck when all phases have unmet dependencies."""
        plan = ImplementationPlan(
            feature="Dependency Deadlock",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[
                        Subtask(id="c1", description="Task 1", status=SubtaskStatus.PENDING),
                    ],
                    depends_on=[2],  # Circular dependency
                ),
                Phase(
                    phase=2,
                    name="Phase 2",
                    subtasks=[
                        Subtask(id="c2", description="Task 2", status=SubtaskStatus.PENDING),
                    ],
                    depends_on=[1],  # Circular dependency
                ),
            ],
        )

        # Both phases depend on each other - neither can proceed
        available = plan.get_available_phases()
        assert len(available) == 0

        result = plan.get_next_subtask()
        assert result is None

    def test_plan_stuck_message_in_status_summary(self):
        """Status summary shows BLOCKED when no work available."""
        plan = ImplementationPlan(
            feature="Stuck Feature",
            phases=[
                Phase(
                    phase=1,
                    name="Waiting Phase",
                    subtasks=[
                        Subtask(id="c1", description="Blocked task", status=SubtaskStatus.BLOCKED),
                    ],
                ),
            ],
        )

        summary = plan.get_status_summary()

        assert "BLOCKED" in summary
        assert "No available subtasks" in summary

    def test_plan_stuck_with_failed_subtasks(self):
        """Plan with only failed subtasks shows stuck state."""
        plan = ImplementationPlan(
            feature="Failed Plan",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[
                        Subtask(id="c1", description="Failed task", status=SubtaskStatus.FAILED),
                    ],
                ),
            ],
        )

        # Failed subtasks are not pending, so no work available
        result = plan.get_next_subtask()
        assert result is None

        progress = plan.get_progress()
        assert progress["failed_subtasks"] == 1
        assert progress["is_complete"] is False

    def test_plan_progress_includes_failed_count(self):
        """Progress tracking includes failed subtask count."""
        plan = ImplementationPlan(
            feature="Mixed Status",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[
                        Subtask(id="c1", description="Done", status=SubtaskStatus.COMPLETED),
                        Subtask(id="c2", description="Failed", status=SubtaskStatus.FAILED),
                        Subtask(id="c3", description="Blocked", status=SubtaskStatus.BLOCKED),
                        Subtask(id="c4", description="Pending", status=SubtaskStatus.PENDING),
                    ],
                ),
            ],
        )

        progress = plan.get_progress()

        assert progress["completed_subtasks"] == 1
        assert progress["failed_subtasks"] == 1
        assert progress["total_subtasks"] == 4
        assert progress["percent_complete"] == 25.0
        assert progress["is_complete"] is False

    # =========================================================================
    # SKIPPED Scenarios Tests (no explicit status, but behavior tests)
    # =========================================================================

    def test_phase_skipped_when_no_subtasks(self):
        """Empty phase is considered complete (skipped)."""
        phase = Phase(
            phase=1,
            name="Empty Phase",
            subtasks=[],
        )

        # Empty phase counts as complete
        assert phase.is_complete() is True
        completed, total = phase.get_progress()
        assert completed == 0
        assert total == 0

    def test_plan_skips_empty_phase_to_next(self):
        """Plan skips empty phases when finding next subtask."""
        plan = ImplementationPlan(
            feature="Skip Empty Phase",
            phases=[
                Phase(
                    phase=1,
                    name="Empty Setup",
                    subtasks=[],
                ),
                Phase(
                    phase=2,
                    name="Real Work",
                    depends_on=[1],
                    subtasks=[
                        Subtask(id="c1", description="Actual task", status=SubtaskStatus.PENDING),
                    ],
                ),
            ],
        )

        result = plan.get_next_subtask()

        assert result is not None
        phase, subtask = result
        assert phase.phase == 2
        assert subtask.id == "c1"

    def test_multiple_skipped_phases_chain(self):
        """Chain of empty phases are all skipped correctly."""
        plan = ImplementationPlan(
            feature="Multi-Skip",
            phases=[
                Phase(phase=1, name="Empty 1", subtasks=[]),
                Phase(phase=2, name="Empty 2", depends_on=[1], subtasks=[]),
                Phase(phase=3, name="Empty 3", depends_on=[2], subtasks=[]),
                Phase(
                    phase=4,
                    name="Work Phase",
                    depends_on=[3],
                    subtasks=[
                        Subtask(id="c1", description="Task", status=SubtaskStatus.PENDING),
                    ],
                ),
            ],
        )

        # All empty phases count as complete, so phase 4 is available
        available = plan.get_available_phases()
        assert len(available) == 1
        assert available[0].phase == 4

    def test_completed_phase_skipped_for_next_work(self):
        """Already completed phases are skipped when finding next work."""
        plan = ImplementationPlan(
            feature="Skip Completed",
            phases=[
                Phase(
                    phase=1,
                    name="Done Phase",
                    subtasks=[
                        Subtask(id="c1", description="Done", status=SubtaskStatus.COMPLETED),
                    ],
                ),
                Phase(
                    phase=2,
                    name="Work Phase",
                    depends_on=[1],
                    subtasks=[
                        Subtask(id="c2", description="Pending", status=SubtaskStatus.PENDING),
                    ],
                ),
            ],
        )

        result = plan.get_next_subtask()

        assert result is not None
        phase, subtask = result
        assert phase.phase == 2
        assert subtask.id == "c2"

    # =========================================================================
    # Complex State Transition Scenarios
    # =========================================================================

    def test_blocked_unblocked_complete_transition(self):
        """Full transition from blocked -> pending -> in_progress -> completed."""
        chunk = Subtask(id="test", description="Test", status=SubtaskStatus.BLOCKED)

        # Unblock
        chunk.status = SubtaskStatus.PENDING
        assert chunk.status == SubtaskStatus.PENDING

        # Start
        chunk.start(session_id=1)
        assert chunk.status == SubtaskStatus.IN_PROGRESS
        assert chunk.started_at is not None

        # Complete
        chunk.complete(output="Done successfully")
        assert chunk.status == SubtaskStatus.COMPLETED
        assert chunk.completed_at is not None
        assert chunk.actual_output == "Done successfully"

    def test_blocked_to_failed_transition(self):
        """Blocked chunk can transition to failed without being started."""
        chunk = Subtask(id="test", description="Test", status=SubtaskStatus.BLOCKED)

        # Mark as failed directly (e.g., investigation revealed it's not feasible)
        chunk.fail(reason="Investigation revealed task is not feasible")

        assert chunk.status == SubtaskStatus.FAILED
        assert "FAILED: Investigation revealed task is not feasible" in chunk.actual_output

    def test_in_progress_subtask_blocks_phase_completion(self):
        """Phase with in_progress subtask is not complete."""
        phase = Phase(
            phase=1,
            name="Active Phase",
            subtasks=[
                Subtask(id="c1", description="Done", status=SubtaskStatus.COMPLETED),
                Subtask(id="c2", description="Working", status=SubtaskStatus.IN_PROGRESS),
            ],
        )

        assert phase.is_complete() is False

    def test_mixed_blocked_and_failed_prevents_completion(self):
        """Phase with blocked and failed subtasks is not complete."""
        phase = Phase(
            phase=1,
            name="Problematic Phase",
            subtasks=[
                Subtask(id="c1", description="Blocked", status=SubtaskStatus.BLOCKED),
                Subtask(id="c2", description="Failed", status=SubtaskStatus.FAILED),
            ],
        )

        assert phase.is_complete() is False
        assert phase.get_pending_subtasks() == []

    def test_plan_becomes_available_after_unblocking(self):
        """Plan becomes unstuck when blocked subtask is unblocked."""
        plan = ImplementationPlan(
            feature="Unblock Test",
            phases=[
                Phase(
                    phase=1,
                    name="Blocked Phase",
                    subtasks=[
                        Subtask(id="c1", description="Blocked", status=SubtaskStatus.BLOCKED),
                    ],
                ),
            ],
        )

        # Initially stuck
        assert plan.get_next_subtask() is None

        # Unblock the subtask
        plan.phases[0].subtasks[0].status = SubtaskStatus.PENDING

        # Now work is available
        result = plan.get_next_subtask()
        assert result is not None
        phase, subtask = result
        assert subtask.id == "c1"

    def test_failed_subtask_retry_transition(self):
        """Failed subtask can be reset to pending for retry."""
        chunk = Subtask(id="test", description="Test", status=SubtaskStatus.FAILED)
        chunk.actual_output = "FAILED: Previous error"

        # Reset for retry
        chunk.status = SubtaskStatus.PENDING
        chunk.actual_output = None
        chunk.started_at = None
        chunk.completed_at = None

        assert chunk.status == SubtaskStatus.PENDING
        assert chunk.actual_output is None

        # Can be started again
        chunk.start(session_id=2)
        assert chunk.status == SubtaskStatus.IN_PROGRESS
        assert chunk.session_id == 2

    def test_plan_status_update_with_blocked_subtasks(self):
        """Plan status updates correctly with blocked subtasks."""
        plan = ImplementationPlan(
            feature="Status Test",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[
                        Subtask(id="c1", description="Done", status=SubtaskStatus.COMPLETED),
                        Subtask(id="c2", description="Blocked", status=SubtaskStatus.BLOCKED),
                    ],
                ),
            ],
        )

        plan.update_status_from_subtasks()

        # With blocked subtask, plan is still in progress
        assert plan.status == "in_progress"
        assert plan.planStatus == "in_progress"

    def test_all_blocked_subtasks_keeps_plan_in_backlog(self):
        """Plan with all blocked (no completed) subtasks stays in backlog."""
        plan = ImplementationPlan(
            feature="All Blocked",
            phases=[
                Phase(
                    phase=1,
                    name="Phase 1",
                    subtasks=[
                        Subtask(id="c1", description="Blocked 1", status=SubtaskStatus.BLOCKED),
                        Subtask(id="c2", description="Blocked 2", status=SubtaskStatus.BLOCKED),
                    ],
                ),
            ],
        )

        plan.update_status_from_subtasks()

        # All subtasks blocked = effectively pending state = backlog
        assert plan.status == "backlog"
        assert plan.planStatus == "pending"


# =============================================================================
# STUCK SUBTASK SKIPPING TESTS (progress.py get_next_subtask)
# =============================================================================

class TestStuckSubtaskSkipping:
    """Tests for stuck subtask skipping in progress.get_next_subtask()."""

    def _make_plan(self, subtasks):
        """Helper to create a minimal implementation_plan.json dict."""
        return {
            "feature": "Test",
            "workflow_type": "feature",
            "phases": [
                {
                    "phase": 1,
                    "name": "Phase 1",
                    "depends_on": [],
                    "subtasks": subtasks,
                }
            ],
        }

    def _make_attempt_history(self, stuck_ids):
        """Helper to create attempt_history.json with stuck subtasks."""
        return {
            "subtasks": {},
            "stuck_subtasks": [
                {"subtask_id": sid, "reason": "stuck", "escalated_at": "2024-01-01T00:00:00"}
                for sid in stuck_ids
            ],
            "metadata": {"created_at": "2024-01-01T00:00:00", "last_updated": "2024-01-01T00:00:00"},
        }

    def test_stuck_subtask_is_skipped(self, temp_dir):
        """Stuck subtasks are skipped when selecting the next subtask."""
        from progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        # Create plan with two pending subtasks
        plan = self._make_plan([
            {"id": "stuck-1", "description": "Stuck task", "status": "pending"},
            {"id": "good-1", "description": "Normal task", "status": "pending"},
        ])
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        # Mark stuck-1 as stuck
        memory_dir = spec_dir / "memory"
        memory_dir.mkdir(parents=True)
        history = self._make_attempt_history(["stuck-1"])
        (memory_dir / "attempt_history.json").write_text(json.dumps(history))

        result = get_next_subtask(spec_dir)
        assert result is not None
        assert result["id"] == "good-1", "Should skip stuck-1 and select good-1"

    def test_normal_subtask_selected_when_stuck_exist(self, temp_dir):
        """Normal pending subtasks are selected even when stuck ones exist."""
        from progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        plan = self._make_plan([
            {"id": "stuck-a", "description": "Stuck A", "status": "pending"},
            {"id": "stuck-b", "description": "Stuck B", "status": "pending"},
            {"id": "normal-c", "description": "Normal C", "status": "pending"},
        ])
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        memory_dir = spec_dir / "memory"
        memory_dir.mkdir(parents=True)
        history = self._make_attempt_history(["stuck-a", "stuck-b"])
        (memory_dir / "attempt_history.json").write_text(json.dumps(history))

        result = get_next_subtask(spec_dir)
        assert result is not None
        assert result["id"] == "normal-c"

    def test_no_attempt_history_file(self, temp_dir):
        """When attempt_history.json doesn't exist, normal selection proceeds."""
        from progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        plan = self._make_plan([
            {"id": "task-1", "description": "Task 1", "status": "pending"},
        ])
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        # No memory directory or attempt_history.json

        result = get_next_subtask(spec_dir)
        assert result is not None
        assert result["id"] == "task-1"

    def test_corrupted_attempt_history_json(self, temp_dir):
        """When attempt_history.json is corrupted, normal selection proceeds."""
        from progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        plan = self._make_plan([
            {"id": "task-1", "description": "Task 1", "status": "pending"},
        ])
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        memory_dir = spec_dir / "memory"
        memory_dir.mkdir(parents=True)
        (memory_dir / "attempt_history.json").write_text("{invalid json!!!")

        result = get_next_subtask(spec_dir)
        assert result is not None
        assert result["id"] == "task-1", "Should still select task when JSON is corrupted"

    def test_all_pending_subtasks_stuck_returns_none(self, temp_dir):
        """When ALL pending subtasks are stuck, returns None."""
        from progress import get_next_subtask

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir(parents=True)

        plan = self._make_plan([
            {"id": "stuck-1", "description": "Stuck 1", "status": "pending"},
            {"id": "stuck-2", "description": "Stuck 2", "status": "pending"},
            {"id": "done-1", "description": "Done 1", "status": "completed"},
        ])
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        memory_dir = spec_dir / "memory"
        memory_dir.mkdir(parents=True)
        history = self._make_attempt_history(["stuck-1", "stuck-2"])
        (memory_dir / "attempt_history.json").write_text(json.dumps(history))

        result = get_next_subtask(spec_dir)
        assert result is None, "Should return None when all pending subtasks are stuck"

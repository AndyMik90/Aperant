#!/usr/bin/env python3
"""
Regression tests for issue #884.

The planner may generate a non-standard implementation_plan.json schema
(`not_started`, `phase_id`, `subtask_id`, `title`, etc.) which can cause
execution to get stuck because no "pending" subtasks are detected.
"""

import importlib
import json
from pathlib import Path

import pytest
from core.progress import get_next_subtask
from prompt_generator import generate_planner_prompt
from spec.validate_pkg import SpecValidator, auto_fix_plan


def _write_plan(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def test_generate_planner_prompt_loads_repo_planner_md(spec_dir: Path):
    prompt = generate_planner_prompt(spec_dir, project_dir=spec_dir.parent)
    prompt_generator = importlib.import_module(generate_planner_prompt.__module__)
    assert prompt_generator.__file__ is not None

    candidate_dirs = [
        Path(prompt_generator.__file__).parent.parent / "prompts",  # current layout
        Path(prompt_generator.__file__).parent / "prompts",  # legacy fallback (if any)
    ]
    planner_file = next(
        (
            (candidate_dir / "planner.md")
            for candidate_dir in candidate_dirs
            if (candidate_dir / "planner.md").exists()
        ),
        None,
    )
    assert planner_file is not None
    planner_md = planner_file.read_text(encoding="utf-8").strip()
    assert planner_md in prompt


def test_get_next_subtask_accepts_not_started_and_alias_fields(spec_dir: Path):
    plan = {
        "spec_id": "002-add-upstream-connection-test",
        "phases": [
            {
                "phase_id": "1",
                "title": "Research & Design",
                "status": "not_started",
                "subtasks": [
                    {
                        "subtask_id": "1.1",
                        "title": "Research provider-specific test endpoints",
                        "status": "not_started",
                    }
                ],
            }
        ],
    }
    _write_plan(spec_dir / "implementation_plan.json", plan)

    next_task = get_next_subtask(spec_dir)
    assert next_task is not None
    assert next_task.get("id") == "1.1"
    assert next_task.get("description") == "Research provider-specific test endpoints"
    assert next_task.get("status") == "pending"


def test_get_next_subtask_populates_description_from_title_when_empty(spec_dir: Path):
    plan = {
        "spec_id": "002-add-upstream-connection-test",
        "phases": [
            {
                "phase_id": "1",
                "title": "Research & Design",
                "status": "not_started",
                "subtasks": [
                    {
                        "subtask_id": "1.1",
                        "title": "Research provider-specific test endpoints",
                        "description": "",
                        "status": "not_started",
                    }
                ],
            }
        ],
    }
    _write_plan(spec_dir / "implementation_plan.json", plan)

    next_task = get_next_subtask(spec_dir)
    assert next_task is not None
    assert next_task.get("id") == "1.1"
    assert next_task.get("description") == "Research provider-specific test endpoints"
    assert next_task.get("status") == "pending"


def test_get_next_subtask_handles_depends_on_with_mixed_id_types(spec_dir: Path):
    plan = {
        "feature": "Test feature",
        "workflow_type": "feature",
        "phases": [
            {
                "phase": 1,
                "name": "Phase 1",
                "subtasks": [
                    {"id": "1.1", "description": "Done", "status": "completed"},
                ],
            },
            {
                "phase": 2,
                "name": "Phase 2",
                "depends_on": ["1"],
                "subtasks": [
                    {"id": "2.1", "description": "Next", "status": "pending"},
                ],
            },
        ],
    }
    _write_plan(spec_dir / "implementation_plan.json", plan)

    next_task = get_next_subtask(spec_dir)
    assert next_task is not None
    assert next_task.get("id") == "2.1"


def test_get_next_subtask_phase_fields_override_malformed_subtask_phase_fields(
    spec_dir: Path,
):
    plan = {
        "feature": "Test feature",
        "workflow_type": "feature",
        "phases": [
            {
                "id": "phase-1",
                "name": "Phase 1",
                "phase": 1,
                "subtasks": [
                    {
                        "id": "1.1",
                        "description": "Do thing",
                        "status": "pending",
                        "phase_id": "bad-phase",
                        "phase_name": "Bad Phase",
                        "phase_num": 999,
                    }
                ],
            }
        ],
    }
    _write_plan(spec_dir / "implementation_plan.json", plan)

    next_task = get_next_subtask(spec_dir)
    assert next_task is not None
    assert next_task.get("id") == "1.1"
    assert next_task.get("phase_id") == "phase-1"
    assert next_task.get("phase_name") == "Phase 1"
    assert next_task.get("phase_num") == 1


def test_auto_fix_plan_normalizes_nonstandard_schema_and_validates(spec_dir: Path):
    plan = {
        "spec_id": "002-add-upstream-connection-test",
        "phases": [
            {
                "phase_id": "1",
                "title": "Research & Design",
                "status": "not_started",
                "subtasks": [
                    {
                        "subtask_id": "1.1",
                        "title": "Research provider-specific test endpoints",
                        "description": "Research lightweight API endpoints for each provider",
                        "status": "not_started",
                        "files_to_modify": [],
                        "notes": "",
                    }
                ],
            }
        ],
    }
    plan_path = spec_dir / "implementation_plan.json"
    _write_plan(plan_path, plan)

    fixed = auto_fix_plan(spec_dir)
    assert fixed is True

    loaded = json.loads(plan_path.read_text(encoding="utf-8"))
    assert loaded.get("feature")
    assert loaded.get("workflow_type")
    assert loaded.get("phases")
    assert loaded["phases"][0].get("name") == "Research & Design"

    subtask = loaded["phases"][0]["subtasks"][0]
    assert subtask.get("id") == "1.1"
    assert subtask.get("description")
    assert subtask.get("status") == "pending"

    result = SpecValidator(spec_dir).validate_implementation_plan()
    assert result.valid is True


def test_auto_fix_plan_normalizes_numeric_phase_ids_for_depends_on_validation(
    spec_dir: Path,
):
    plan = {
        "feature": "Test feature",
        "workflow_type": "feature",
        "phases": [
            {
                "phase_id": "1",
                "title": "Phase 1",
                "subtasks": [
                    {"id": "1.1", "description": "Done", "status": "completed"}
                ],
            },
            {
                "phase_id": "2",
                "title": "Phase 2",
                "depends_on": ["1"],
                "subtasks": [{"id": "2.1", "description": "Next", "status": "pending"}],
            },
        ],
    }
    plan_path = spec_dir / "implementation_plan.json"
    _write_plan(plan_path, plan)

    fixed = auto_fix_plan(spec_dir)
    assert fixed is True

    loaded = json.loads(plan_path.read_text(encoding="utf-8"))
    assert loaded["phases"][0]["id"] == "1"
    assert loaded["phases"][0]["phase"] == 1
    assert SpecValidator(spec_dir).validate_implementation_plan().valid is True


def test_auto_fix_plan_sets_phase_from_numeric_phase_id_even_with_existing_id(
    spec_dir: Path,
):
    plan = {
        "feature": "Test feature",
        "workflow_type": "feature",
        "phases": [
            {
                "id": "phase-foo",
                "phase_id": 2,
                "name": "Phase Foo",
                "subtasks": [
                    {"id": "2.1", "description": "Do thing", "status": "pending"},
                ],
            }
        ],
    }
    plan_path = spec_dir / "implementation_plan.json"
    _write_plan(plan_path, plan)

    fixed = auto_fix_plan(spec_dir)
    assert fixed is True

    loaded = json.loads(plan_path.read_text(encoding="utf-8"))
    assert loaded["phases"][0]["id"] == "phase-foo"
    assert loaded["phases"][0]["phase"] == 2
    assert SpecValidator(spec_dir).validate_implementation_plan().valid is True


@pytest.mark.asyncio
async def test_planner_session_does_not_trigger_post_session_processing_on_retry(
    temp_git_repo: Path, monkeypatch: pytest.MonkeyPatch
):
    """
    Regression: planner retries shouldn't trigger coder-only post-session processing.

    Even if a (malformed) implementation plan already contains something that would
    normally be detected as a pending subtask, planner sessions must not execute the
    coding post-processing pipeline.
    """
    from agents.coder import run_autonomous_agent
    from task_logger import LogPhase

    spec_dir = temp_git_repo / ".auto-claude" / "specs" / "001-test"
    spec_dir.mkdir(parents=True, exist_ok=True)
    (spec_dir / "spec.md").write_text("# Test spec\n", encoding="utf-8")

    class DummyClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def fake_create_client(*_args, **_kwargs):
        return DummyClient()

    async def fake_get_graphiti_context(*_args, **_kwargs):
        return None

    def fake_get_next_subtask(_spec_dir: Path):
        # This would have caused post-session processing to run during planning
        # prior to the regression fix.
        return {"id": "1.1", "description": "Should not be processed in planning"}

    async def fake_post_session_processing(*_args, **_kwargs):
        raise AssertionError("post_session_processing must not run during planning")

    async def fake_run_agent_session(
        _client,
        _message: str,
        _spec_dir: Path,
        _verbose: bool = False,
        phase: LogPhase = LogPhase.CODING,
    ) -> tuple[str, str, dict]:
        assert phase == LogPhase.PLANNING
        return "error", "planner failed", {}

    monkeypatch.setattr("agents.coder.create_client", fake_create_client)
    monkeypatch.setattr("agents.coder.get_graphiti_context", fake_get_graphiti_context)
    monkeypatch.setattr("agents.coder.get_next_subtask", fake_get_next_subtask)
    monkeypatch.setattr(
        "agents.coder.post_session_processing", fake_post_session_processing
    )
    monkeypatch.setattr("agents.coder.run_agent_session", fake_run_agent_session)
    monkeypatch.setattr("agents.coder.AUTO_CONTINUE_DELAY_SECONDS", 0)
    monkeypatch.setattr("agents.coder.load_subtask_context", lambda *_a, **_k: {})

    await run_autonomous_agent(
        project_dir=temp_git_repo,
        spec_dir=spec_dir,
        model="test-model",
        max_iterations=1,
        verbose=False,
    )


@pytest.mark.asyncio
async def test_worktree_planning_to_coding_sync_updates_source_phase_status(
    temp_git_repo: Path, monkeypatch: pytest.MonkeyPatch
):
    """
    In worktree mode, planning logs are preferred from the main spec dir.
    Ensure planning is marked completed in the source spec BEFORE the first coding session starts.
    """
    from agents.coder import run_autonomous_agent
    from task_logger import LogPhase

    worktree_spec_dir = temp_git_repo / ".worktrees" / "001-test" / "specs" / "001-test"
    source_spec_dir = temp_git_repo / ".auto-claude" / "specs" / "001-test"
    worktree_spec_dir.mkdir(parents=True, exist_ok=True)
    source_spec_dir.mkdir(parents=True, exist_ok=True)
    for d in (worktree_spec_dir, source_spec_dir):
        (d / "spec.md").write_text("# Test spec\n", encoding="utf-8")

    class DummyClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def fake_create_client(*_args, **_kwargs):
        return DummyClient()

    async def fake_get_graphiti_context(*_args, **_kwargs):
        return None

    async def fake_post_session_processing(*_args, **_kwargs):
        return True

    async def fake_run_agent_session(
        _client,
        _message: str,
        spec_dir: Path,
        _verbose: bool = False,
        phase: LogPhase = LogPhase.CODING,
    ) -> tuple[str, str, dict]:
        if phase == LogPhase.PLANNING:
            plan = {
                "feature": "Test feature",
                "workflow_type": "feature",
                "phases": [
                    {
                        "id": "1",
                        "name": "Phase 1",
                        "subtasks": [
                            {
                                "id": "1.1",
                                "description": "Do thing",
                                "status": "pending",
                            }
                        ],
                    }
                ],
            }
            (spec_dir / "implementation_plan.json").write_text(
                json.dumps(plan, indent=2),
                encoding="utf-8",
            )
            return "continue", "planned", {}

        # First coding session should see planning already completed in source spec logs
        # Note: task_logs.json is created/synced by run_autonomous_agent; absence indicates a bug.
        logs = json.loads(
            (source_spec_dir / "task_logs.json").read_text(encoding="utf-8")
        )
        assert logs["phases"]["planning"]["status"] == "completed"
        assert logs["phases"]["coding"]["status"] == "active"
        return "complete", "done", {}

    monkeypatch.setattr("agents.coder.create_client", fake_create_client)
    monkeypatch.setattr("agents.coder.get_graphiti_context", fake_get_graphiti_context)
    monkeypatch.setattr(
        "agents.coder.post_session_processing", fake_post_session_processing
    )
    monkeypatch.setattr("agents.coder.run_agent_session", fake_run_agent_session)
    monkeypatch.setattr("agents.coder.AUTO_CONTINUE_DELAY_SECONDS", 0)
    monkeypatch.setattr("agents.coder.load_subtask_context", lambda *_a, **_k: {})

    await run_autonomous_agent(
        project_dir=temp_git_repo,
        spec_dir=worktree_spec_dir,
        model="test-model",
        max_iterations=2,
        verbose=False,
        source_spec_dir=source_spec_dir,
    )

#!/usr/bin/env python3
"""
Tests for Spec Pipeline Phase Execution
========================================

Tests the PhaseExecutor class in auto-claude/spec/phases.py covering:
- PhaseResult dataclass
- All phase methods (discovery, requirements, context, etc.)
- Retry logic and error handling
- File existence checks and caching
"""

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Store original modules before mocking (for cleanup)
_original_modules = {}
_mocked_module_names = [
    'claude_code_sdk',
    'claude_code_sdk.types',
    'claude_agent_sdk',
    'graphiti_providers',
    'validate_spec',
    'client',
]

for name in _mocked_module_names:
    if name in sys.modules:
        _original_modules[name] = sys.modules[name]

# Mock ALL external dependencies before ANY imports from the spec module
# The import chain is: spec.phases -> spec.__init__ -> spec.pipeline -> client -> claude_agent_sdk
mock_sdk = MagicMock()
mock_sdk.ClaudeSDKClient = MagicMock()
mock_sdk.ClaudeCodeOptions = MagicMock()
mock_sdk.HookMatcher = MagicMock()
sys.modules['claude_code_sdk'] = mock_sdk
sys.modules['claude_code_sdk.types'] = mock_sdk

# Mock claude_agent_sdk
mock_agent_sdk = MagicMock()
mock_agent_sdk.ClaudeSDKClient = MagicMock()
mock_agent_sdk.ClaudeAgentOptions = MagicMock()
sys.modules['claude_agent_sdk'] = mock_agent_sdk

# Mock graphiti_providers module
mock_graphiti = MagicMock()
mock_graphiti.is_graphiti_enabled = MagicMock(return_value=False)
mock_graphiti.get_graph_hints = AsyncMock(return_value=[])
sys.modules['graphiti_providers'] = mock_graphiti

# Mock validate_spec module
mock_validate_spec = MagicMock()
mock_validate_spec.auto_fix_plan = MagicMock(return_value=False)
sys.modules['validate_spec'] = mock_validate_spec

# Mock client module to avoid circular imports
mock_client = MagicMock()
mock_client.create_client = MagicMock()
sys.modules['client'] = mock_client

# Now import the phases module directly (bypasses __init__.py issues)
from spec.phases import MAX_RETRIES, PhaseExecutor, PhaseResult


# Cleanup fixture to restore original modules after all tests in this module
@pytest.fixture(scope="module", autouse=True)
def cleanup_mocked_modules():
    """Restore original modules after all tests in this module complete."""
    yield  # Run all tests first
    # Cleanup: restore original modules or remove mocks
    for name in _mocked_module_names:
        if name in _original_modules:
            sys.modules[name] = _original_modules[name]
        elif name in sys.modules:
            del sys.modules[name]


class TestPhaseResult:
    """Tests for PhaseResult dataclass."""

    def test_phase_result_creation(self):
        """PhaseResult can be created with all fields."""
        result = PhaseResult(
            phase="discovery",
            success=True,
            output_files=["project_index.json"],
            errors=[],
            retries=0,
        )

        assert result.phase == "discovery"
        assert result.success is True
        assert result.output_files == ["project_index.json"]
        assert result.errors == []
        assert result.retries == 0

    def test_phase_result_with_errors(self):
        """PhaseResult can store error messages."""
        result = PhaseResult(
            phase="context",
            success=False,
            output_files=[],
            errors=["Attempt 1: Script failed", "Attempt 2: Timeout"],
            retries=2,
        )

        assert result.success is False
        assert len(result.errors) == 2
        assert result.retries == 2

    def test_phase_result_multiple_output_files(self):
        """PhaseResult can track multiple output files."""
        result = PhaseResult(
            phase="spec_writing",
            success=True,
            output_files=["spec.md", "implementation_plan.json"],
            errors=[],
            retries=0,
        )

        assert len(result.output_files) == 2


class TestPhaseExecutorInit:
    """Tests for PhaseExecutor initialization."""

    def test_executor_initialization(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """PhaseExecutor initializes with all required parameters."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        assert executor.project_dir == temp_dir
        assert executor.spec_dir == spec_dir
        assert executor.task_description == "Test task"

    def test_executor_stores_dependencies(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """PhaseExecutor stores all dependency objects."""
        validator = mock_spec_validator()
        agent_fn = mock_run_agent_fn()

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=validator,
            run_agent_fn=agent_fn,
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        assert executor.spec_validator == validator
        assert executor.run_agent_fn == agent_fn
        assert executor.task_logger == mock_task_logger
        assert executor.ui == mock_ui_module


class TestPhaseDiscovery:
    """Tests for phase_discovery method."""

    @pytest.mark.asyncio
    async def test_discovery_success(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Discovery phase succeeds when script creates project_index.json."""
        # Create the project_index.json file
        index_file = spec_dir / "project_index.json"
        index_file.write_text(json.dumps({"files": [1, 2, 3], "project_type": "python"}))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        with patch('spec.discovery.run_discovery_script', return_value=(True, "Created")):
            with patch('spec.discovery.get_project_index_stats', return_value={"file_count": 3}):
                result = await executor.phase_discovery()

        assert result.success is True
        assert result.phase == "discovery"
        assert any("project_index.json" in f for f in result.output_files)

    @pytest.mark.asyncio
    async def test_discovery_retries_on_failure(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Discovery phase retries on failure."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        # Always fail
        with patch('spec.discovery.run_discovery_script', return_value=(False, "Script failed")):
            result = await executor.phase_discovery()

        assert result.success is False
        assert result.retries == MAX_RETRIES - 1
        assert len(result.errors) == MAX_RETRIES


class TestPhaseHistoricalContext:
    """Tests for phase_historical_context method."""

    @pytest.mark.asyncio
    async def test_historical_context_file_exists(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Historical context phase returns early if hints file exists."""
        hints_file = spec_dir / "graph_hints.json"
        hints_file.write_text(json.dumps({"hints": [], "enabled": True}))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_historical_context()

        assert result.success is True
        assert result.phase == "historical_context"
        assert result.retries == 0

    @pytest.mark.asyncio
    async def test_historical_context_graphiti_disabled(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Historical context phase handles disabled Graphiti."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        with patch('graphiti_providers.is_graphiti_enabled', return_value=False):
            result = await executor.phase_historical_context()

        assert result.success is True
        assert (spec_dir / "graph_hints.json").exists()


class TestPhaseRequirements:
    """Tests for phase_requirements method."""

    @pytest.mark.asyncio
    async def test_requirements_file_exists(
        self,
        spec_dir: Path,
        temp_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Requirements phase returns early if file exists."""
        requirements_file = spec_dir / "requirements.json"
        requirements_file.write_text(json.dumps({"task_description": "Test"}))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_requirements(interactive=False)

        assert result.success is True
        assert result.phase == "requirements"
        assert result.retries == 0

    @pytest.mark.asyncio
    async def test_requirements_non_interactive_with_task(
        self,
        spec_dir: Path,
        temp_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Requirements phase creates file from task description in non-interactive mode."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Add user authentication",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_requirements(interactive=False)

        assert result.success is True
        assert (spec_dir / "requirements.json").exists()

        # Verify content
        with open(spec_dir / "requirements.json") as f:
            req = json.load(f)
        assert req["task_description"] == "Add user authentication"


class TestPhaseContext:
    """Tests for phase_context method."""

    @pytest.mark.asyncio
    async def test_context_file_exists(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Context phase returns early if file exists."""
        context_file = spec_dir / "context.json"
        context_file.write_text(json.dumps({"task_description": "Test"}))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_context()

        assert result.success is True
        assert result.phase == "context"
        assert result.retries == 0

    @pytest.mark.asyncio
    async def test_context_discovery_success(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Context phase calls discovery script and succeeds."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        with patch('spec.context.run_context_discovery', return_value=(True, "Success")):
            with patch('spec.context.get_context_stats', return_value={"files_to_modify": 5}):
                result = await executor.phase_context()

        assert result.success is True

    @pytest.mark.asyncio
    async def test_context_creates_minimal_on_failure(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Context phase creates minimal context when script fails."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        with patch('spec.context.run_context_discovery', return_value=(False, "Failed")):
            with patch('spec.context.create_minimal_context') as mock_minimal:
                result = await executor.phase_context()

        mock_minimal.assert_called_once()
        assert result.success is True  # Creates minimal context as fallback


class TestPhaseQuickSpec:
    """Tests for phase_quick_spec method."""

    @pytest.mark.asyncio
    async def test_quick_spec_files_exist(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Quick spec phase returns early if files exist."""
        (spec_dir / "spec.md").write_text("# Test Spec")
        (spec_dir / "implementation_plan.json").write_text(json.dumps({"phases": []}))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_quick_spec()

        assert result.success is True
        assert result.phase == "quick_spec"
        assert result.retries == 0

    @pytest.mark.asyncio
    async def test_quick_spec_runs_agent(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Quick spec phase runs agent to create spec."""
        # Agent creates spec.md on success
        async def agent_side_effect(*args, **kwargs):
            (spec_dir / "spec.md").write_text("# Generated Spec")
            return (True, "Done")

        agent_fn = AsyncMock(side_effect=agent_side_effect)

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=agent_fn,
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_quick_spec()

        assert result.success is True
        assert agent_fn.called


class TestPhaseResearch:
    """Tests for phase_research method."""

    @pytest.mark.asyncio
    async def test_research_file_exists(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Research phase returns early if file exists."""
        (spec_dir / "research.json").write_text(json.dumps({"findings": []}))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_research()

        assert result.success is True
        assert result.phase == "research"
        assert result.retries == 0

    @pytest.mark.asyncio
    async def test_research_skipped_no_requirements(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Research phase skipped when no requirements.json."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_research()

        assert result.success is True
        assert (spec_dir / "research.json").exists()


class TestPhaseSpecWriting:
    """Tests for phase_spec_writing method."""

    @pytest.mark.asyncio
    async def test_spec_writing_file_exists_valid(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Spec writing phase returns early if valid spec exists."""
        (spec_dir / "spec.md").write_text("# Test Spec\n\n## Overview\n")

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(spec_valid=True),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_spec_writing()

        assert result.success is True
        assert result.phase == "spec_writing"
        assert result.retries == 0

    @pytest.mark.asyncio
    async def test_spec_writing_regenerates_invalid(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Spec writing phase regenerates invalid spec."""
        (spec_dir / "spec.md").write_text("Invalid spec")

        async def agent_side_effect(*args, **kwargs):
            (spec_dir / "spec.md").write_text("# Valid Spec\n\n## Overview\n")
            return (True, "Done")

        agent_fn = AsyncMock(side_effect=agent_side_effect)

        # First call returns invalid, subsequent calls return valid
        validator = mock_spec_validator(spec_valid=False)

        from dataclasses import dataclass
        from unittest.mock import MagicMock as Mock

        @dataclass
        class MockResult:
            valid: bool
            checkpoint: str = "spec_document"
            errors: list = None
            fixes: list = None

            def __post_init__(self):
                self.errors = self.errors or []
                self.fixes = self.fixes or []

        call_count = [0]
        def validate_spec_side_effect():
            call_count[0] += 1
            if call_count[0] == 1:
                return MockResult(valid=False, errors=["Invalid"])
            return MockResult(valid=True)

        validator.validate_spec_document = Mock(side_effect=validate_spec_side_effect)

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=validator,
            run_agent_fn=agent_fn,
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_spec_writing()

        assert result.success is True
        assert agent_fn.called


class TestPhaseSelfCritique:
    """Tests for phase_self_critique method."""

    @pytest.mark.asyncio
    async def test_self_critique_no_spec(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Self-critique fails if spec.md doesn't exist."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_self_critique()

        assert result.success is False
        assert "spec.md does not exist" in result.errors[0]

    @pytest.mark.asyncio
    async def test_self_critique_already_completed(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Self-critique returns early if already completed."""
        (spec_dir / "spec.md").write_text("# Test Spec")
        (spec_dir / "critique_report.json").write_text(json.dumps({
            "issues_fixed": True,
            "no_issues_found": False,
        }))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_self_critique()

        assert result.success is True
        assert result.retries == 0


class TestPhasePlanning:
    """Tests for phase_planning method."""

    @pytest.mark.asyncio
    async def test_planning_file_exists_valid(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Planning phase returns early if valid plan exists."""
        (spec_dir / "implementation_plan.json").write_text(json.dumps({
            "phases": [{"phase": 1, "subtasks": []}]
        }))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(plan_valid=True),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_planning()

        assert result.success is True
        assert result.phase == "planning"
        assert result.retries == 0


class TestPhaseValidation:
    """Tests for phase_validation method."""

    @pytest.mark.asyncio
    async def test_validation_all_pass(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Validation phase passes when all validations pass."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(
                spec_valid=True,
                plan_valid=True,
                context_valid=True,
                all_valid=True,
            ),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_validation()

        assert result.success is True
        assert result.phase == "validation"

    @pytest.mark.asyncio
    async def test_validation_retries_on_failure(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Validation phase retries with auto-fix agent on failure."""
        # Create agent mock that simulates failure
        agent_fn = mock_run_agent_fn(success=False, output="Fix failed")

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(all_valid=False),
            run_agent_fn=agent_fn,
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        result = await executor.phase_validation()

        assert result.success is False
        assert result.retries == MAX_RETRIES


class TestRunScript:
    """Tests for _run_script helper method."""

    def test_run_script_not_found(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """_run_script returns False when script not found."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        success, output = executor._run_script("nonexistent.py", [])

        assert success is False
        assert "not found" in output.lower()


class TestMaxRetriesConstant:
    """Tests for MAX_RETRIES configuration."""

    def test_max_retries_is_positive(self):
        """MAX_RETRIES is a positive integer."""
        assert MAX_RETRIES > 0
        assert isinstance(MAX_RETRIES, int)

    def test_max_retries_reasonable(self):
        """MAX_RETRIES is a reasonable value."""
        assert 1 <= MAX_RETRIES <= 10


class TestPhaseWorkflow:
    """Integration tests for phase workflow patterns."""

    @pytest.mark.asyncio
    async def test_phases_are_idempotent(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Running a phase twice with existing output is idempotent."""
        # Pre-create files
        (spec_dir / "requirements.json").write_text(json.dumps({"task_description": "Test"}))
        (spec_dir / "context.json").write_text(json.dumps({"task_description": "Test"}))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        # Run phases twice
        result1 = await executor.phase_requirements(interactive=False)
        result2 = await executor.phase_requirements(interactive=False)

        assert result1.success is True
        assert result2.success is True
        assert result1.retries == 0
        assert result2.retries == 0

    @pytest.mark.asyncio
    async def test_phases_log_to_task_logger(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Phases log messages to task logger."""
        (spec_dir / "project_index.json").write_text(json.dumps({"files": []}))

        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        with patch('spec.discovery.run_discovery_script', return_value=(True, "Success")):
            with patch('spec.discovery.get_project_index_stats', return_value={"file_count": 10}):
                await executor.phase_discovery()

        # Verify logger was called
        assert mock_task_logger.log.called

    @pytest.mark.asyncio
    async def test_phases_print_status(
        self,
        temp_dir: Path,
        spec_dir: Path,
        mock_run_agent_fn,
        mock_task_logger,
        mock_ui_module,
        mock_spec_validator,
    ):
        """Phases print status messages via UI module."""
        executor = PhaseExecutor(
            project_dir=temp_dir,
            spec_dir=spec_dir,
            task_description="Test task",
            spec_validator=mock_spec_validator(),
            run_agent_fn=mock_run_agent_fn(),
            task_logger=mock_task_logger,
            ui_module=mock_ui_module,
        )

        await executor.phase_requirements(interactive=False)

        # Verify UI print_status was called
        assert mock_ui_module.print_status.called

"""
Tests for GitHub Issue Investigation System
=============================================

Tests the investigation models, persistence layer, orchestrator report
building, and report builder output formatting.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add the backend, github runner, and services directories to path.
# The services dir is added so that the fallback (non-relative) imports in
# investigation_persistence.py and investigation_report_builder.py resolve.
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
_github_dir = _backend_dir / "runners" / "github"
_services_dir = _github_dir / "services"
for _p in (_backend_dir, _github_dir, _services_dir):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from investigation_models import (
    AffectedComponent,
    CodePath,
    FixAdvice,
    FixApproach,
    ImpactAssessment,
    InvestigationReport,
    InvestigationState,
    LinkedPR,
    PatternReference,
    ReproductionAnalysis,
    RootCauseAnalysis,
    SuggestedLabel,
    TestCoverage,
)
from investigation_persistence import (
    get_issue_dir,
    get_issues_dir,
    has_investigation,
    list_investigated_issues,
    load_github_comment_id,
    load_investigation_report,
    load_investigation_state,
    load_suggested_labels,
    save_agent_log,
    save_github_comment_id,
    save_investigation_report,
    save_investigation_state,
    save_suggested_labels,
)
from investigation_report_builder import (
    build_github_comment,
    build_summary,
)


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def sample_root_cause():
    """Create a sample RootCauseAnalysis."""
    return RootCauseAnalysis(
        identified_root_cause="Race condition in session initialization",
        code_paths=[
            CodePath(
                file="src/session.py",
                start_line=42,
                end_line=58,
                description="Session init without lock",
            ),
            CodePath(
                file="src/handler.py",
                start_line=100,
                end_line=None,
                description="Concurrent access point",
            ),
        ],
        confidence="high",
        evidence="Two threads can enter init() simultaneously due to missing lock",
        related_issues=["race condition", "concurrency"],
        likely_already_fixed=False,
    )


@pytest.fixture
def sample_impact():
    """Create a sample ImpactAssessment."""
    return ImpactAssessment(
        severity="high",
        affected_components=[
            AffectedComponent(
                file="src/session.py",
                component="SessionManager",
                impact_type="direct",
                description="Core session state corruption",
            ),
        ],
        blast_radius="All authenticated users can be affected during high traffic",
        user_impact="Users may see other users' data or get logged out unexpectedly",
        regression_risk="Low if fix uses proper locking primitives",
    )


@pytest.fixture
def sample_fix_advice():
    """Create a sample FixAdvice."""
    return FixAdvice(
        approaches=[
            FixApproach(
                description="Add threading.Lock around session initialization",
                complexity="simple",
                files_affected=["src/session.py"],
                pros=["Minimal change", "Well-understood pattern"],
                cons=["Slight performance overhead"],
            ),
            FixApproach(
                description="Refactor to use asyncio locks and async session init",
                complexity="moderate",
                files_affected=["src/session.py", "src/handler.py"],
                pros=["Better performance", "Modern pattern"],
                cons=["Larger change surface"],
            ),
        ],
        recommended_approach=0,
        files_to_modify=["src/session.py", "src/handler.py"],
        patterns_to_follow=[
            PatternReference(
                file="src/cache.py",
                description="Uses threading.Lock for concurrent access protection",
            ),
        ],
        gotchas=["Ensure lock is released in finally block"],
    )


@pytest.fixture
def sample_reproduction():
    """Create a sample ReproductionAnalysis."""
    return ReproductionAnalysis(
        reproducible="likely",
        reproduction_steps=[
            "Start two concurrent sessions",
            "Both attempt to initialize at the same time",
            "Observe corrupted session state",
        ],
        test_coverage=TestCoverage(
            has_existing_tests=True,
            test_files=["tests/test_session.py"],
            coverage_assessment="Unit tests exist but no concurrency tests",
        ),
        related_test_files=["tests/test_session.py"],
        suggested_test_approach="Add concurrent test using threading to trigger race condition",
    )


@pytest.fixture
def sample_report(sample_root_cause, sample_impact, sample_fix_advice, sample_reproduction):
    """Create a full InvestigationReport."""
    return InvestigationReport(
        issue_number=42,
        issue_title="Session corruption under high load",
        investigation_id="inv-abc123def456",
        timestamp=datetime.now(timezone.utc).isoformat(),
        root_cause=sample_root_cause,
        impact=sample_impact,
        fix_advice=sample_fix_advice,
        reproduction=sample_reproduction,
        ai_summary="Race condition in session init causes data corruption under concurrent access.",
        severity="high",
        likely_resolved=False,
        suggested_labels=[
            SuggestedLabel(name="bug", reason="Data corruption issue", accepted=None),
            SuggestedLabel(name="concurrency", reason="Race condition", accepted=None),
        ],
        linked_prs=[
            LinkedPR(number=99, title="Fix session locking", status="open"),
        ],
    )


@pytest.fixture
def sample_state():
    """Create a sample InvestigationState."""
    return InvestigationState(
        issue_number=42,
        status="investigating",
        started_at=datetime.now(timezone.utc).isoformat(),
    )


# ============================================================================
# Model Validation Tests
# ============================================================================


class TestInvestigationModels:
    """Tests for Pydantic model validation and serialization."""

    def test_root_cause_analysis_required_fields(self):
        """RootCauseAnalysis requires identified_root_cause, confidence, evidence."""
        rca = RootCauseAnalysis(
            identified_root_cause="Null reference in login handler",
            confidence="medium",
            evidence="Line 42 dereferences user without null check",
        )
        assert rca.identified_root_cause == "Null reference in login handler"
        assert rca.confidence == "medium"
        assert rca.code_paths == []
        assert rca.related_issues == []
        assert rca.likely_already_fixed is False

    def test_root_cause_analysis_invalid_confidence(self):
        """Confidence must be high/medium/low."""
        with pytest.raises(Exception):
            RootCauseAnalysis(
                identified_root_cause="test",
                confidence="extreme",
                evidence="test",
            )

    def test_impact_assessment_severity_values(self):
        """Severity must be critical/high/medium/low."""
        for severity in ("critical", "high", "medium", "low"):
            ia = ImpactAssessment(
                severity=severity,
                blast_radius="test",
                user_impact="test",
                regression_risk="test",
            )
            assert ia.severity == severity

    def test_impact_assessment_invalid_severity(self):
        """Invalid severity value should fail."""
        with pytest.raises(Exception):
            ImpactAssessment(
                severity="catastrophic",
                blast_radius="test",
                user_impact="test",
                regression_risk="test",
            )

    def test_fix_approach_complexity_values(self):
        """Complexity must be simple/moderate/complex."""
        for complexity in ("simple", "moderate", "complex"):
            fa = FixApproach(
                description="test",
                complexity=complexity,
            )
            assert fa.complexity == complexity

    def test_fix_advice_defaults(self):
        """FixAdvice has sensible defaults."""
        fa = FixAdvice()
        assert fa.approaches == []
        assert fa.recommended_approach == 0
        assert fa.files_to_modify == []
        assert fa.patterns_to_follow == []
        assert fa.gotchas == []

    def test_reproduction_analysis_reproducible_values(self):
        """Reproducible must be yes/likely/unlikely/no."""
        for value in ("yes", "likely", "unlikely", "no"):
            ra = ReproductionAnalysis(
                reproducible=value,
                test_coverage=TestCoverage(
                    has_existing_tests=False,
                    coverage_assessment="none",
                ),
                suggested_test_approach="test",
            )
            assert ra.reproducible == value

    def test_investigation_state_status_values(self):
        """State status must be one of the valid values."""
        for status in ("investigating", "findings_ready", "resolved", "failed", "cancelled", "task_created"):
            state = InvestigationState(
                issue_number=1,
                status=status,
                started_at=datetime.now(timezone.utc).isoformat(),
            )
            assert state.status == status

    def test_investigation_state_invalid_status(self):
        """Invalid state status should fail."""
        with pytest.raises(Exception):
            InvestigationState(
                issue_number=1,
                status="in_progress",
                started_at=datetime.now(timezone.utc).isoformat(),
            )

    def test_investigation_state_optional_fields(self):
        """Optional fields default to None."""
        state = InvestigationState(
            issue_number=1,
            status="investigating",
            started_at="2024-01-01T00:00:00Z",
        )
        assert state.spec_id is None
        assert state.completed_at is None
        assert state.error is None
        assert state.linked_spec_id is None
        assert state.github_comment_id is None
        assert state.model_used is None

    def test_report_round_trip_json(self, sample_report):
        """Report can be serialized to JSON and back."""
        data = sample_report.model_dump(mode="json")
        restored = InvestigationReport.model_validate(data)
        assert restored.issue_number == sample_report.issue_number
        assert restored.issue_title == sample_report.issue_title
        assert restored.severity == sample_report.severity
        assert restored.root_cause.confidence == sample_report.root_cause.confidence
        assert len(restored.root_cause.code_paths) == len(sample_report.root_cause.code_paths)
        assert len(restored.fix_advice.approaches) == len(sample_report.fix_advice.approaches)
        assert restored.reproduction.reproducible == sample_report.reproduction.reproducible
        assert len(restored.suggested_labels) == 2
        assert len(restored.linked_prs) == 1

    def test_state_round_trip_json(self, sample_state):
        """State can be serialized to JSON and back."""
        data = sample_state.model_dump(mode="json")
        restored = InvestigationState.model_validate(data)
        assert restored.issue_number == sample_state.issue_number
        assert restored.status == sample_state.status

    def test_code_path_single_line(self):
        """CodePath with end_line=None represents a single line."""
        cp = CodePath(
            file="src/foo.py",
            start_line=10,
            end_line=None,
            description="single line",
        )
        assert cp.end_line is None

    def test_suggested_label_accepted_states(self):
        """SuggestedLabel accepted can be True, False, or None."""
        for accepted in (True, False, None):
            label = SuggestedLabel(
                name="bug",
                reason="test",
                accepted=accepted,
            )
            assert label.accepted == accepted

    def test_linked_pr_status_values(self):
        """LinkedPR status must be open/merged/closed."""
        for status in ("open", "merged", "closed"):
            pr = LinkedPR(number=1, title="test", status=status)
            assert pr.status == status

    def test_affected_component_impact_types(self):
        """AffectedComponent impact_type must be direct/indirect/dependency."""
        for impact_type in ("direct", "indirect", "dependency"):
            ac = AffectedComponent(
                file="test.py",
                component="TestComponent",
                impact_type=impact_type,
                description="test",
            )
            assert ac.impact_type == impact_type


# ============================================================================
# Persistence Layer Tests
# ============================================================================


class TestInvestigationPersistence:
    """Tests for investigation_persistence.py CRUD operations."""

    def test_get_issues_dir_creates_directory(self, tmp_path):
        """get_issues_dir creates .auto-claude/issues/ if it doesn't exist."""
        issues_dir = get_issues_dir(tmp_path)
        assert issues_dir.exists()
        assert issues_dir == tmp_path / ".auto-claude" / "issues"

    def test_get_issue_dir_creates_directory(self, tmp_path):
        """get_issue_dir creates issue-specific directory."""
        issue_dir = get_issue_dir(tmp_path, 42)
        assert issue_dir.exists()
        assert issue_dir == tmp_path / ".auto-claude" / "issues" / "42"

    def test_save_and_load_investigation_state_pydantic(self, tmp_path, sample_state):
        """Save and load state using Pydantic model."""
        save_investigation_state(tmp_path, 42, sample_state)
        loaded = load_investigation_state(tmp_path, 42)
        assert loaded is not None
        assert loaded.issue_number == 42
        assert loaded.status == "investigating"

    def test_save_investigation_state_dict(self, tmp_path):
        """Save state using raw dict."""
        state_dict = {
            "issue_number": 99,
            "status": "findings_ready",
            "started_at": "2024-01-01T00:00:00Z",
        }
        path = save_investigation_state(tmp_path, 99, state_dict)
        assert path.exists()

        # Load it back
        loaded = load_investigation_state(tmp_path, 99)
        assert loaded is not None
        assert loaded.issue_number == 99
        assert loaded.status == "findings_ready"

    def test_load_investigation_state_missing(self, tmp_path):
        """Loading nonexistent state returns None."""
        loaded = load_investigation_state(tmp_path, 999)
        assert loaded is None

    def test_load_investigation_state_corrupt(self, tmp_path):
        """Loading corrupt state returns None."""
        issue_dir = get_issue_dir(tmp_path, 42)
        state_file = issue_dir / "investigation_state.json"
        state_file.write_text("not json", encoding="utf-8")
        loaded = load_investigation_state(tmp_path, 42)
        assert loaded is None

    def test_save_and_load_investigation_report(self, tmp_path, sample_report):
        """Save and load full investigation report."""
        save_investigation_report(tmp_path, 42, sample_report)
        loaded = load_investigation_report(tmp_path, 42)
        assert loaded is not None
        assert loaded.issue_number == 42
        assert loaded.severity == "high"
        assert loaded.root_cause.confidence == "high"
        assert len(loaded.fix_advice.approaches) == 2
        assert loaded.reproduction.reproducible == "likely"

    def test_load_investigation_report_missing(self, tmp_path):
        """Loading nonexistent report returns None."""
        loaded = load_investigation_report(tmp_path, 999)
        assert loaded is None

    def test_load_investigation_report_corrupt(self, tmp_path):
        """Loading corrupt report returns None."""
        issue_dir = get_issue_dir(tmp_path, 42)
        report_file = issue_dir / "investigation_report.json"
        report_file.write_text("{invalid", encoding="utf-8")
        loaded = load_investigation_report(tmp_path, 42)
        assert loaded is None

    def test_save_agent_log(self, tmp_path):
        """Save agent log creates agent_logs directory and file."""
        log_path = save_agent_log(tmp_path, 42, "root_cause", "Analysis log content here")
        assert log_path.exists()
        assert log_path.name == "root_cause.log"
        assert log_path.read_text(encoding="utf-8") == "Analysis log content here"

    def test_save_multiple_agent_logs(self, tmp_path):
        """Multiple agent logs are saved independently."""
        for name in ("root_cause", "impact", "fix_advisor", "reproducer"):
            save_agent_log(tmp_path, 42, name, f"{name} log")

        logs_dir = get_issue_dir(tmp_path, 42) / "agent_logs"
        assert len(list(logs_dir.iterdir())) == 4

    def test_save_and_load_github_comment_id(self, tmp_path, sample_state):
        """Save and load GitHub comment ID."""
        # Need a state to exist first
        save_investigation_state(tmp_path, 42, sample_state)
        save_github_comment_id(tmp_path, 42, 12345)

        comment_id = load_github_comment_id(tmp_path, 42)
        assert comment_id == 12345

        # Also updates state
        state = load_investigation_state(tmp_path, 42)
        assert state.github_comment_id == 12345

    def test_load_github_comment_id_missing(self, tmp_path):
        """Loading nonexistent comment ID returns None."""
        comment_id = load_github_comment_id(tmp_path, 999)
        assert comment_id is None

    def test_save_and_load_suggested_labels(self, tmp_path):
        """Save and load suggested labels."""
        labels = [
            {"name": "bug", "reason": "Data corruption", "accepted": None},
            {"name": "high-priority", "reason": "Affects all users", "accepted": True},
        ]
        save_suggested_labels(tmp_path, 42, labels)
        loaded = load_suggested_labels(tmp_path, 42)
        assert len(loaded) == 2
        assert loaded[0]["name"] == "bug"
        assert loaded[1]["accepted"] is True

    def test_load_suggested_labels_missing(self, tmp_path):
        """Loading nonexistent labels returns empty list."""
        loaded = load_suggested_labels(tmp_path, 999)
        assert loaded == []

    def test_list_investigated_issues_empty(self, tmp_path):
        """Listing issues with no data returns empty list."""
        result = list_investigated_issues(tmp_path)
        assert result == []

    def test_list_investigated_issues_multiple(self, tmp_path):
        """Listing issues returns sorted issue numbers."""
        for num in (42, 10, 99, 1):
            get_issue_dir(tmp_path, num)  # Creates the directory

        result = list_investigated_issues(tmp_path)
        assert result == [1, 10, 42, 99]

    def test_list_investigated_issues_ignores_non_numeric(self, tmp_path):
        """Non-numeric directories are ignored."""
        issues_dir = get_issues_dir(tmp_path)
        (issues_dir / "not-a-number").mkdir()
        (issues_dir / "42").mkdir()

        result = list_investigated_issues(tmp_path)
        assert result == [42]

    def test_has_investigation_true(self, tmp_path):
        """has_investigation returns True when data exists."""
        get_issue_dir(tmp_path, 42)
        assert has_investigation(tmp_path, 42) is True

    def test_has_investigation_false(self, tmp_path):
        """has_investigation returns False when no data exists."""
        assert has_investigation(tmp_path, 999) is False

    def test_has_investigation_no_side_effects(self, tmp_path):
        """has_investigation does not create directories."""
        has_investigation(tmp_path, 999)
        assert not (tmp_path / ".auto-claude" / "issues" / "999").exists()

    def test_list_investigated_issues_no_side_effects(self, tmp_path):
        """list_investigated_issues does not create directories."""
        list_investigated_issues(tmp_path)
        assert not (tmp_path / ".auto-claude" / "issues").exists()

    def test_state_overwrite(self, tmp_path):
        """Saving state overwrites previous state."""
        state1 = InvestigationState(
            issue_number=42,
            status="investigating",
            started_at="2024-01-01T00:00:00Z",
        )
        save_investigation_state(tmp_path, 42, state1)

        state2 = InvestigationState(
            issue_number=42,
            status="findings_ready",
            started_at="2024-01-01T00:00:00Z",
            completed_at="2024-01-01T01:00:00Z",
        )
        save_investigation_state(tmp_path, 42, state2)

        loaded = load_investigation_state(tmp_path, 42)
        assert loaded.status == "findings_ready"
        assert loaded.completed_at == "2024-01-01T01:00:00Z"


# ============================================================================
# Orchestrator Report Building Tests
# ============================================================================


def _import_orchestrator():
    """Import the orchestrator, mocking SDK-dependent modules."""
    # Mock modules that parallel_agent_base depends on (SDK, etc.)
    # These are not needed for testing _build_report, _parse_specialist_result,
    # _generate_summary, and _build_issue_context.
    mock_modules = {}
    for mod_name in (
        "io_utils",
        "sdk_utils",
        "parallel_agent_base",
    ):
        if mod_name not in sys.modules:
            mock_modules[mod_name] = True
            sys.modules[mod_name] = MagicMock()

    # Ensure parallel_agent_base has the real SpecialistConfig dataclass
    # and a usable ParallelAgentOrchestrator base class
    from dataclasses import dataclass

    @dataclass
    class SpecialistConfig:
        name: str
        prompt_file: str
        tools: list
        description: str
        max_turns: int = 30

    class ParallelAgentOrchestrator:
        def __init__(self, project_dir, github_dir, config, progress_callback=None):
            self.project_dir = Path(project_dir)
            self.github_dir = Path(github_dir)
            self.config = config
            self.progress_callback = progress_callback

        def _report_progress(self, phase, progress, message, **kwargs):
            pass

        def _load_prompt(self, filename):
            return ""

    pab = sys.modules["parallel_agent_base"]
    pab.ParallelAgentOrchestrator = ParallelAgentOrchestrator
    pab.SpecialistConfig = SpecialistConfig

    # Also mock phase_config
    if "phase_config" not in sys.modules:
        mock_modules["phase_config"] = True
        pc = MagicMock()
        pc.get_thinking_budget = MagicMock(return_value=10000)
        pc.resolve_model_id = MagicMock(return_value="claude-sonnet-4-5-20250929")
        sys.modules["phase_config"] = pc

    from issue_investigation_orchestrator import IssueInvestigationOrchestrator

    return IssueInvestigationOrchestrator


# Import once at module level (lazy)
_IssueInvestigationOrchestrator = None


def _get_orchestrator_class():
    global _IssueInvestigationOrchestrator
    if _IssueInvestigationOrchestrator is None:
        _IssueInvestigationOrchestrator = _import_orchestrator()
    return _IssueInvestigationOrchestrator


class TestOrchestratorReportBuilding:
    """Tests for IssueInvestigationOrchestrator._build_report and helpers."""

    @pytest.fixture
    def orchestrator(self, tmp_path):
        """Create a minimal orchestrator instance for testing."""
        cls = _get_orchestrator_class()
        config = MagicMock()
        config.model = "sonnet"
        config.thinking_level = "medium"
        return cls(
            project_dir=tmp_path,
            github_dir=tmp_path / ".auto-claude" / "github",
            config=config,
        )

    @pytest.mark.asyncio
    async def test_build_report_full_results(self, orchestrator, sample_root_cause, sample_impact, sample_fix_advice, sample_reproduction):
        """Report building with all specialist results succeeding."""
        specialist_results = {
            "root_cause": {
                "result_text": "analysis done",
                "structured_output": sample_root_cause.model_dump(),
            },
            "impact": {
                "result_text": "assessment done",
                "structured_output": sample_impact.model_dump(),
            },
            "fix_advisor": {
                "result_text": "advice done",
                "structured_output": sample_fix_advice.model_dump(),
            },
            "reproducer": {
                "result_text": "reproduction done",
                "structured_output": sample_reproduction.model_dump(),
            },
        }

        report = await orchestrator._build_report(
            issue_number=42,
            issue_title="Test issue",
            investigation_id="inv-test123",
            specialist_results=specialist_results,
        )

        assert report.issue_number == 42
        assert report.issue_title == "Test issue"
        assert report.investigation_id == "inv-test123"
        assert report.severity == "high"  # From impact assessment
        assert report.likely_resolved is False
        assert report.root_cause.confidence == "high"
        assert len(report.fix_advice.approaches) == 2
        assert report.reproduction.reproducible == "likely"
        assert report.ai_summary  # Non-empty

    @pytest.mark.asyncio
    async def test_build_report_all_failures(self, orchestrator):
        """Report building with all specialists failing uses defaults."""
        specialist_results = {
            "root_cause": {"result_text": "", "structured_output": None},
            "impact": {"result_text": "", "structured_output": None},
            "fix_advisor": {"result_text": "", "structured_output": None},
            "reproducer": {"result_text": "", "structured_output": None},
        }

        report = await orchestrator._build_report(
            issue_number=1,
            issue_title="Failed investigation",
            investigation_id="inv-fail",
            specialist_results=specialist_results,
        )

        assert report.issue_number == 1
        assert report.severity == "medium"  # Default severity
        assert report.likely_resolved is False
        assert report.root_cause.confidence == "low"
        assert "specialist failed" in report.root_cause.identified_root_cause.lower()

    @pytest.mark.asyncio
    async def test_build_report_partial_results(self, orchestrator, sample_root_cause, sample_impact):
        """Report building with some specialists failing."""
        specialist_results = {
            "root_cause": {
                "result_text": "done",
                "structured_output": sample_root_cause.model_dump(),
            },
            "impact": {
                "result_text": "done",
                "structured_output": sample_impact.model_dump(),
            },
            "fix_advisor": {"result_text": "", "structured_output": None},
            "reproducer": {"result_text": "", "structured_output": None},
        }

        report = await orchestrator._build_report(
            issue_number=5,
            issue_title="Partial",
            investigation_id="inv-partial",
            specialist_results=specialist_results,
        )

        assert report.severity == "high"  # From impact
        assert report.root_cause.confidence == "high"
        assert report.fix_advice.approaches == []  # Default empty
        assert report.reproduction.reproducible == "unlikely"  # Default

    @pytest.mark.asyncio
    async def test_build_report_likely_resolved(self, orchestrator):
        """Report correctly flags likely_resolved from root cause."""
        resolved_root = RootCauseAnalysis(
            identified_root_cause="Fixed in commit abc123",
            confidence="high",
            evidence="Commit abc123 addresses the exact issue",
            likely_already_fixed=True,
        )
        specialist_results = {
            "root_cause": {
                "result_text": "done",
                "structured_output": resolved_root.model_dump(),
            },
            "impact": {"result_text": "", "structured_output": None},
            "fix_advisor": {"result_text": "", "structured_output": None},
            "reproducer": {"result_text": "", "structured_output": None},
        }

        report = await orchestrator._build_report(
            issue_number=10,
            issue_title="Already Fixed",
            investigation_id="inv-resolved",
            specialist_results=specialist_results,
        )

        assert report.likely_resolved is True

    @pytest.mark.asyncio
    async def test_parse_specialist_result_valid(self, orchestrator, sample_root_cause):
        """Parsing valid structured output returns model instance."""
        results = {
            "root_cause": {
                "structured_output": sample_root_cause.model_dump(),
            },
        }
        parsed = await orchestrator._parse_specialist_result(
            "root_cause", results, RootCauseAnalysis
        )
        assert parsed is not None
        assert parsed.confidence == "high"

    @pytest.mark.asyncio
    async def test_parse_specialist_result_missing(self, orchestrator):
        """Parsing missing specialist returns None."""
        parsed = await orchestrator._parse_specialist_result(
            "root_cause", {}, RootCauseAnalysis
        )
        assert parsed is None

    @pytest.mark.asyncio
    async def test_parse_specialist_result_no_structured_output(self, orchestrator):
        """Parsing result without structured_output returns None."""
        results = {"root_cause": {"result_text": "some text", "structured_output": None}}
        parsed = await orchestrator._parse_specialist_result(
            "root_cause", results, RootCauseAnalysis
        )
        assert parsed is None

    @pytest.mark.asyncio
    async def test_parse_specialist_result_invalid_data(self, orchestrator):
        """Parsing invalid structured output returns None."""
        results = {
            "root_cause": {
                "structured_output": {"invalid": "data"},
            },
        }
        parsed = await orchestrator._parse_specialist_result(
            "root_cause", results, RootCauseAnalysis
        )
        assert parsed is None

    @pytest.mark.asyncio
    async def test_parse_reproducer_partial_structured_output_recovery(self, orchestrator):
        """Reproducer parsing recovers when structured output has invalid nested types."""
        results = {
            "reproducer": {
                "structured_output": {
                    "reproducible": "likely",
                    # Invalid type should trigger validation failure and recovery.
                    "test_coverage": "unknown",
                    "related_test_files": ["tests/test_sample.py"],
                },
            },
        }

        parsed = await orchestrator._parse_specialist_result(
            "reproducer", results, ReproductionAnalysis
        )
        assert parsed is not None
        assert parsed.reproducible == "likely"
        assert parsed.test_coverage.has_existing_tests is True
        assert "Unable to assess" in parsed.test_coverage.coverage_assessment

    @pytest.mark.asyncio
    async def test_parse_reproducer_unvalidated_candidate_recovery(self, orchestrator):
        """Reproducer parsing can recover from unvalidated structured output candidates."""
        results = {
            "reproducer": {
                "structured_output": None,
                "structured_output_candidate": {
                    "reproducible": "likely",
                    "reproduction_steps": ["Open issue view", "Re-enter issue"],
                    # Invalid nested type should be normalized by recovery coercion.
                    "test_coverage": "unknown",
                    "related_test_files": ["apps/frontend/src/renderer/components/context/MemoryCard.tsx"],
                },
                "error": "structured_output_validation_failed",
                "tool_activity": [
                    "Reading apps/frontend/src/renderer/components/context/MemoryCard.tsx",
                    "Searching for 'MemoryCard'",
                ],
            },
        }

        parsed = await orchestrator._parse_specialist_result(
            "reproducer", results, ReproductionAnalysis
        )
        assert parsed is not None
        assert parsed.reproducible == "likely"
        assert parsed.test_coverage.has_existing_tests is True
        assert parsed.related_test_files == [
            "apps/frontend/src/renderer/components/context/MemoryCard.tsx"
        ]

    @pytest.mark.asyncio
    async def test_parse_reproducer_json_text_recovery(self, orchestrator):
        """Reproducer parsing can recover from JSON embedded in plain text output."""
        results = {
            "reproducer": {
                "structured_output": None,
                "result_text": (
                    "Analysis complete. Returning data:\n"
                    "{\n"
                    '  "reproducible": "yes",\n'
                    '  "reproduction_steps": ["Open app", "Click save"],\n'
                    '  "test_coverage": {\n'
                    '    "has_existing_tests": true,\n'
                    '    "test_files": ["tests/test_save.py"],\n'
                    '    "coverage_assessment": "Basic coverage exists"\n'
                    "  },\n"
                    '  "related_test_files": ["tests/test_save.py"],\n'
                    '  "suggested_test_approach": "Add regression test for save flow"\n'
                    "}\n"
                ),
            },
        }

        parsed = await orchestrator._parse_specialist_result(
            "reproducer", results, ReproductionAnalysis
        )
        assert parsed is not None
        assert parsed.reproducible == "yes"
        assert parsed.test_coverage.has_existing_tests is True
        assert parsed.related_test_files == ["tests/test_save.py"]

    def test_generate_summary_all_agents(self, orchestrator, sample_root_cause, sample_impact, sample_fix_advice, sample_reproduction):
        """Summary includes all agent results."""
        summary = orchestrator._generate_summary(
            root_cause=sample_root_cause,
            impact=sample_impact,
            fix_advice=sample_fix_advice,
            reproduction=sample_reproduction,
        )
        assert "Root cause" in summary
        assert "high" in summary.lower()
        assert "Severity" in summary
        assert "Reproducible" in summary

    def test_generate_summary_no_agents(self, orchestrator):
        """Summary with no results produces fallback text."""
        summary = orchestrator._generate_summary(
            root_cause=None,
            impact=None,
            fix_advice=None,
            reproduction=None,
        )
        assert "no specialist produced results" in summary.lower()

    def test_build_issue_context(self, orchestrator):
        """Issue context string includes all relevant information."""
        context = orchestrator._build_issue_context(
            issue_number=42,
            issue_title="Test Bug",
            issue_body="Steps to reproduce: 1. Open app 2. Click button",
            issue_labels=["bug", "urgent"],
            issue_comments=["I can reproduce this", "Same here"],
            project_root=orchestrator.project_dir,
        )
        assert "42" in context
        assert "Test Bug" in context
        assert "Steps to reproduce" in context
        assert "bug" in context
        assert "urgent" in context
        assert "I can reproduce this" in context

    def test_build_issue_context_no_labels(self, orchestrator):
        """Issue context handles empty labels."""
        context = orchestrator._build_issue_context(
            issue_number=1,
            issue_title="Title",
            issue_body="Body",
            issue_labels=[],
            issue_comments=[],
            project_root=orchestrator.project_dir,
        )
        assert "(none)" in context

    def test_build_issue_context_truncates_comments(self, orchestrator):
        """Long comments are truncated to 500 chars."""
        long_comment = "x" * 600
        context = orchestrator._build_issue_context(
            issue_number=1,
            issue_title="Title",
            issue_body="Body",
            issue_labels=[],
            issue_comments=[long_comment],
            project_root=orchestrator.project_dir,
        )
        assert "..." in context
        # The truncated comment should be at most 503 chars (500 + "...")
        # Exact check: the full 600-char string should not appear
        assert "x" * 600 not in context

    def test_specialist_configs(self):
        """Verify 4 specialist configs are defined correctly."""
        # Force import of orchestrator module to access config constants
        _get_orchestrator_class()
        from issue_investigation_orchestrator import INVESTIGATION_SPECIALISTS

        assert len(INVESTIGATION_SPECIALISTS) == 4
        names = [s.name for s in INVESTIGATION_SPECIALISTS]
        assert "root_cause" in names
        assert "impact" in names
        assert "fix_advisor" in names
        assert "reproducer" in names

        # All should have Read, Grep, Glob tools
        for spec in INVESTIGATION_SPECIALISTS:
            assert "Read" in spec.tools
            assert "Grep" in spec.tools
            assert "Glob" in spec.tools
            assert spec.prompt_file.startswith("investigation_")

    def test_specialist_schema_mapping(self):
        """Verify specialist name → schema mapping is complete."""
        _get_orchestrator_class()
        from issue_investigation_orchestrator import (
            INVESTIGATION_SPECIALISTS,
            _SPECIALIST_SCHEMAS,
        )

        for spec in INVESTIGATION_SPECIALISTS:
            assert spec.name in _SPECIALIST_SCHEMAS, (
                f"Missing schema mapping for specialist: {spec.name}"
            )

    @pytest.mark.asyncio
    async def test_run_specialists_phase1_sequential_injects_root_context(
        self,
        orchestrator,
        sample_root_cause,
        sample_impact,
        sample_fix_advice,
        sample_reproduction,
    ):
        """Sequential phase 1 should run root_cause first and inject context into reproducer."""
        prompt_contexts = {}
        run_order = []

        def _fake_build_prompt(
            cfg,
            issue_context,
            project_root,
            root_cause_context="",
        ):
            prompt_contexts[cfg.name] = root_cause_context
            return f"prompt-{cfg.name}"

        async def _fake_run_specialist_session(config, **kwargs):
            run_order.append(config.name)
            payloads = {
                "root_cause": sample_root_cause.model_dump(),
                "reproducer": sample_reproduction.model_dump(),
                "impact": sample_impact.model_dump(),
                "fix_advisor": sample_fix_advice.model_dump(),
            }
            return {
                "result_text": f"done-{config.name}",
                "structured_output": payloads.get(config.name),
                "error": None,
                "msg_count": 1,
                "session_id": f"session-{config.name}",
            }

        async def _fake_run_parallel_specialists(tasks, **kwargs):
            return [await task for task in tasks]

        orchestrator._build_specialist_prompt = _fake_build_prompt
        orchestrator._run_specialist_session = AsyncMock(
            side_effect=_fake_run_specialist_session
        )
        orchestrator._run_parallel_specialists = AsyncMock(
            side_effect=_fake_run_parallel_specialists
        )

        results = await orchestrator._run_investigation_specialists(
            issue_context="issue context",
            project_root=orchestrator.project_dir,
            specialist_config={},
            fallback_model="claude-sonnet-4-5-20250929",
            fallback_thinking_level="medium",
            phase_1_mode="sequential",
            issue_number=42,
            resume_sessions=None,
        )

        assert run_order[:2] == ["root_cause", "reproducer"]
        assert "Root Cause Analysis (from prior investigation phase)" in prompt_contexts[
            "reproducer"
        ]
        assert set(results.keys()) == {
            "root_cause",
            "reproducer",
            "impact",
            "fix_advisor",
        }

    @pytest.mark.asyncio
    async def test_run_specialists_invalid_phase1_mode_falls_back_to_sequential(
        self,
        orchestrator,
        sample_root_cause,
    ):
        """Unknown phase1 mode should fall back to sequential execution mode."""
        orchestrator_names = []

        def _fake_build_prompt(
            cfg,
            issue_context,
            project_root,
            root_cause_context="",
        ):
            return f"prompt-{cfg.name}"

        async def _fake_run_specialist_session(config, **kwargs):
            payload = (
                sample_root_cause.model_dump() if config.name == "root_cause" else None
            )
            return {
                "result_text": f"done-{config.name}",
                "structured_output": payload,
                "error": None,
                "msg_count": 1,
                "session_id": f"session-{config.name}",
            }

        async def _fake_run_parallel_specialists(tasks, orchestrator_name, **kwargs):
            orchestrator_names.append(orchestrator_name)
            return [await task for task in tasks]

        orchestrator._build_specialist_prompt = _fake_build_prompt
        orchestrator._run_specialist_session = AsyncMock(
            side_effect=_fake_run_specialist_session
        )
        orchestrator._run_parallel_specialists = AsyncMock(
            side_effect=_fake_run_parallel_specialists
        )

        await orchestrator._run_investigation_specialists(
            issue_context="issue context",
            project_root=orchestrator.project_dir,
            specialist_config={},
            fallback_model="claude-sonnet-4-5-20250929",
            fallback_thinking_level="medium",
            phase_1_mode="bad-value",
            issue_number=7,
            resume_sessions=None,
        )

        assert orchestrator_names
        assert orchestrator_names[0] == "IssueInvestigation:Phase1:root_cause"

    @pytest.mark.asyncio
    async def test_recoverable_retry_does_not_reemit_agent_started_or_failed(
        self,
        orchestrator,
        sample_root_cause,
        sample_impact,
        sample_fix_advice,
        sample_reproduction,
    ):
        """Recoverable specialist retry should not flap lifecycle state in UI."""
        run_counts: dict[str, int] = {}
        lifecycle_events: list[tuple[str, str, dict[str, object]]] = []

        def _fake_build_prompt(
            cfg,
            issue_context,
            project_root,
            root_cause_context="",
        ):
            return f"prompt-{cfg.name}"

        async def _fake_run_specialist_session(config, **kwargs):
            run_counts[config.name] = run_counts.get(config.name, 0) + 1

            # First root-cause run fails with a recoverable stream error.
            if config.name == "root_cause" and run_counts[config.name] == 1:
                return {
                    "result_text": "",
                    "structured_output": None,
                    "error": "tool_use_concurrency_error",
                    "error_recoverable": True,
                    "msg_count": 1,
                }

            payloads = {
                "root_cause": sample_root_cause.model_dump(),
                "reproducer": sample_reproduction.model_dump(),
                "impact": sample_impact.model_dump(),
                "fix_advisor": sample_fix_advice.model_dump(),
            }
            return {
                "result_text": f"done-{config.name}",
                "structured_output": payloads.get(config.name),
                "error": None,
                "msg_count": 1,
                "session_id": f"session-{config.name}-{run_counts[config.name]}",
            }

        async def _fake_run_parallel_specialists(
            tasks,
            retry_tasks=None,
            retry_configs=None,
            **kwargs,
        ):
            initial_results = [await task for task in tasks]
            final_results = list(initial_results)

            for i, result in enumerate(initial_results):
                should_retry = (
                    isinstance(result, dict)
                    and bool(
                        result.get("error")
                        and result.get("error_recoverable")
                        and not result.get("structured_output")
                    )
                )
                if not should_retry or not retry_tasks or i >= len(retry_tasks):
                    continue

                retry_coro = retry_tasks[i]()
                if retry_configs and i < len(retry_configs):
                    wrapper = retry_configs[i].get("lifecycle_wrapper")
                    if wrapper:
                        retry_coro = wrapper(
                            retry_configs[i].get("name", f"specialist_{i}"),
                            retry_coro,
                        )
                final_results[i] = await retry_coro

            return final_results

        orchestrator._build_specialist_prompt = _fake_build_prompt
        orchestrator._run_specialist_session = AsyncMock(
            side_effect=_fake_run_specialist_session
        )
        orchestrator._run_parallel_specialists = AsyncMock(
            side_effect=_fake_run_parallel_specialists
        )

        with patch(
            "issue_investigation_orchestrator.emit_json_event",
            side_effect=lambda event, agent, **kwargs: lifecycle_events.append(
                (event, agent, kwargs)
            ),
        ):
            await orchestrator._run_investigation_specialists(
                issue_context="issue context",
                project_root=orchestrator.project_dir,
                specialist_config={},
                fallback_model="claude-sonnet-4-5-20250929",
                fallback_thinking_level="medium",
                phase_1_mode="sequential",
                issue_number=99,
                resume_sessions=None,
            )

        root_started = [
            e for e in lifecycle_events if e[0] == "agent_started" and e[1] == "root_cause"
        ]
        root_failed = [
            e
            for e in lifecycle_events
            if e[0] == "agent_done"
            and e[1] == "root_cause"
            and e[2].get("success") is False
        ]
        root_done = [
            e
            for e in lifecycle_events
            if e[0] == "agent_done"
            and e[1] == "root_cause"
            and e[2].get("success") is True
        ]

        # Root cause should start once, retry in-place, and complete once.
        assert len(root_started) == 1
        assert len(root_failed) == 0
        assert len(root_done) == 1


# ============================================================================
# Report Builder Tests
# ============================================================================


class TestReportBuilder:
    """Tests for investigation_report_builder.py output formatting."""

    def test_build_github_comment_structure(self, sample_report):
        """GitHub comment has expected markdown structure."""
        comment = build_github_comment(sample_report)

        assert "## Auto-Claude Investigation" in comment
        assert "### Summary" in comment
        assert "<details>" in comment
        assert "Root Cause Analysis" in comment
        assert "Impact Assessment" in comment
        assert "Fix Recommendations" in comment
        assert "Reproduction & Testing" in comment
        assert "Auto-Claude" in comment

    def test_build_github_comment_severity(self, sample_report):
        """Comment shows severity and confidence."""
        comment = build_github_comment(sample_report)
        assert "**Severity:** high" in comment
        assert "**Confidence:** high" in comment

    def test_build_github_comment_code_paths(self, sample_report):
        """Comment includes code path table."""
        comment = build_github_comment(sample_report)
        assert "`src/session.py`" in comment
        assert "42-58" in comment

    def test_build_github_comment_affected_components(self, sample_report):
        """Comment includes affected components table."""
        comment = build_github_comment(sample_report)
        assert "SessionManager" in comment
        assert "direct" in comment

    def test_build_github_comment_fix_approaches(self, sample_report):
        """Comment lists fix approaches with recommended marker."""
        comment = build_github_comment(sample_report)
        assert "Approach 1:" in comment
        assert "**(recommended)**" in comment
        assert "Approach 2:" in comment
        assert "simple" in comment
        assert "moderate" in comment

    def test_build_github_comment_reproduction(self, sample_report):
        """Comment includes reproduction steps."""
        comment = build_github_comment(sample_report)
        assert "**Reproducible:** likely" in comment
        assert "1. Start two concurrent sessions" in comment

    def test_build_github_comment_suggested_labels(self, sample_report):
        """Comment includes suggested labels."""
        comment = build_github_comment(sample_report)
        assert "### Suggested Labels" in comment
        assert "`bug`" in comment
        assert "`concurrency`" in comment

    def test_build_github_comment_likely_resolved(self, sample_report):
        """Comment shows resolved note when applicable."""
        sample_report.likely_resolved = True
        comment = build_github_comment(sample_report)
        assert "may have already been resolved" in comment

    def test_build_github_comment_no_labels(self, sample_report):
        """Comment omits labels section when empty."""
        sample_report.suggested_labels = []
        comment = build_github_comment(sample_report)
        assert "### Suggested Labels" not in comment

    def test_build_github_comment_files_to_modify(self, sample_report):
        """Comment lists files to modify."""
        comment = build_github_comment(sample_report)
        assert "`src/session.py`" in comment
        assert "`src/handler.py`" in comment

    def test_build_github_comment_gotchas(self, sample_report):
        """Comment includes gotchas."""
        comment = build_github_comment(sample_report)
        assert "finally block" in comment

    def test_build_summary_basic(self, sample_report):
        """Summary includes severity and root cause."""
        summary = build_summary(sample_report)
        assert "[HIGH]" in summary
        assert "Race condition" in summary
        assert "[high confidence]" in summary

    def test_build_summary_likely_resolved(self, sample_report):
        """Summary includes resolved note."""
        sample_report.likely_resolved = True
        summary = build_summary(sample_report)
        assert "(likely resolved)" in summary

    def test_build_summary_truncation(self, sample_report):
        """Summary is truncated to ~200 chars."""
        sample_report.root_cause.identified_root_cause = "x" * 300
        summary = build_summary(sample_report)
        assert len(summary) <= 200
        assert summary.endswith("...")

    def test_build_summary_no_resolved(self, sample_report):
        """Summary without resolved flag."""
        sample_report.likely_resolved = False
        summary = build_summary(sample_report)
        assert "(likely resolved)" not in summary


# ============================================================================
# Agent Config Tests
# ============================================================================


class TestInvestigationAgentConfig:
    """Tests for investigation_specialist entry in AGENT_CONFIGS."""

    def test_investigation_specialist_in_configs(self):
        """investigation_specialist is registered in AGENT_CONFIGS."""
        from agents.tools_pkg.models import AGENT_CONFIGS

        assert "investigation_specialist" in AGENT_CONFIGS

    def test_investigation_specialist_read_only(self):
        """investigation_specialist only has read-only tools."""
        from agents.tools_pkg.models import AGENT_CONFIGS, BASE_READ_TOOLS

        config = AGENT_CONFIGS["investigation_specialist"]
        assert config["tools"] == BASE_READ_TOOLS
        assert config["mcp_servers"] == []
        assert config["auto_claude_tools"] == []

    def test_investigation_specialist_thinking_medium(self):
        """investigation_specialist uses medium thinking."""
        from agents.tools_pkg.models import AGENT_CONFIGS

        config = AGENT_CONFIGS["investigation_specialist"]
        assert config["thinking_default"] == "medium"

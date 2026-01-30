#!/usr/bin/env python3
"""
Tests for Complexity Assessment Module
======================================

Tests the auto-claude/spec/complexity.py module functionality including:
- Complexity enum values
- ComplexityAssessment dataclass
- ComplexityAnalyzer class methods
- Heuristic-based complexity detection
- Phase selection based on complexity
"""

import json
import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

# Store original modules for cleanup
_original_modules = {}
_mocked_module_names = [
    'claude_code_sdk',
    'claude_code_sdk.types',
    'claude_agent_sdk',
    'claude_agent_sdk.types',
]

for name in _mocked_module_names:
    if name in sys.modules:
        _original_modules[name] = sys.modules[name]

# Mock claude_agent_sdk and related modules before importing spec modules
# The SDK isn't available in the test environment
mock_code_sdk = MagicMock()
mock_code_sdk.ClaudeSDKClient = MagicMock()
mock_code_sdk.ClaudeCodeOptions = MagicMock()
mock_code_types = MagicMock()
mock_code_types.HookMatcher = MagicMock()

mock_agent_sdk = MagicMock()
mock_agent_sdk.ClaudeAgentOptions = MagicMock()
mock_agent_sdk.ClaudeSDKClient = MagicMock()
mock_agent_types = MagicMock()
mock_agent_types.HookMatcher = MagicMock()

sys.modules['claude_code_sdk'] = mock_code_sdk
sys.modules['claude_code_sdk.types'] = mock_code_types
sys.modules['claude_agent_sdk'] = mock_agent_sdk
sys.modules['claude_agent_sdk.types'] = mock_agent_types

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from spec.complexity import (
    Complexity,
    ComplexityAssessment,
    ComplexityAnalyzer,
    save_assessment,
    run_ai_complexity_assessment,
)


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


class TestComplexityEnum:
    """Tests for Complexity enum values."""

    def test_complexity_simple_value(self):
        """SIMPLE enum has correct value."""
        assert Complexity.SIMPLE.value == "simple"

    def test_complexity_standard_value(self):
        """STANDARD enum has correct value."""
        assert Complexity.STANDARD.value == "standard"

    def test_complexity_complex_value(self):
        """COMPLEX enum has correct value."""
        assert Complexity.COMPLEX.value == "complex"

    def test_complexity_from_string(self):
        """Can create Complexity from string value."""
        assert Complexity("simple") == Complexity.SIMPLE
        assert Complexity("standard") == Complexity.STANDARD
        assert Complexity("complex") == Complexity.COMPLEX

    def test_complexity_invalid_value_raises(self):
        """Invalid string raises ValueError."""
        with pytest.raises(ValueError):
            Complexity("invalid")


class TestComplexityAssessmentDataclass:
    """Tests for ComplexityAssessment dataclass."""

    def test_default_values(self):
        """Dataclass has sensible defaults."""
        assessment = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
        )
        assert assessment.signals == {}
        assert assessment.reasoning == ""
        assert assessment.estimated_files == 1
        assert assessment.estimated_services == 1
        assert assessment.external_integrations == []
        assert assessment.infrastructure_changes is False
        assert assessment.recommended_phases == []
        assert assessment.needs_research is False
        assert assessment.needs_self_critique is False

    def test_custom_values(self):
        """Can set custom values."""
        assessment = ComplexityAssessment(
            complexity=Complexity.COMPLEX,
            confidence=0.95,
            signals={"complex_keywords": 5},
            reasoning="High complexity due to integrations",
            estimated_files=15,
            estimated_services=3,
            external_integrations=["redis", "postgres"],
            infrastructure_changes=True,
            needs_research=True,
            needs_self_critique=True,
        )
        assert assessment.complexity == Complexity.COMPLEX
        assert assessment.confidence == 0.95
        assert assessment.signals == {"complex_keywords": 5}
        assert assessment.estimated_files == 15
        assert assessment.infrastructure_changes is True


class TestPhasesToRun:
    """Tests for ComplexityAssessment.phases_to_run()."""

    def test_simple_phases(self):
        """SIMPLE complexity returns minimal phases."""
        assessment = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
        )
        phases = assessment.phases_to_run()
        assert phases == ["discovery", "historical_context", "quick_spec", "validation"]

    def test_standard_phases_without_research(self):
        """STANDARD complexity without research flag."""
        assessment = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            needs_research=False,
        )
        phases = assessment.phases_to_run()
        assert phases == [
            "discovery", "historical_context", "requirements",
            "context", "spec_writing", "planning", "validation"
        ]

    def test_standard_phases_with_research(self):
        """STANDARD complexity with research flag includes research phase."""
        assessment = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            needs_research=True,
        )
        phases = assessment.phases_to_run()
        assert "research" in phases
        assert phases == [
            "discovery", "historical_context", "requirements", "research",
            "context", "spec_writing", "planning", "validation"
        ]

    def test_complex_phases(self):
        """COMPLEX complexity returns full phase list."""
        assessment = ComplexityAssessment(
            complexity=Complexity.COMPLEX,
            confidence=0.85,
        )
        phases = assessment.phases_to_run()
        assert phases == [
            "discovery", "historical_context", "requirements", "research",
            "context", "spec_writing", "self_critique", "planning", "validation"
        ]

    def test_recommended_phases_override(self):
        """AI-recommended phases override default phase sets."""
        custom_phases = ["discovery", "custom_phase", "validation"]
        assessment = ComplexityAssessment(
            complexity=Complexity.COMPLEX,
            confidence=0.9,
            recommended_phases=custom_phases,
        )
        phases = assessment.phases_to_run()
        assert phases == custom_phases


class TestComplexityAnalyzerInit:
    """Tests for ComplexityAnalyzer initialization."""

    def test_default_init(self):
        """Initializes with empty project_index."""
        analyzer = ComplexityAnalyzer()
        assert analyzer.project_index == {}

    def test_init_with_project_index(self):
        """Initializes with provided project_index."""
        project_index = {"project_type": "monorepo", "services": {"backend": {}}}
        analyzer = ComplexityAnalyzer(project_index=project_index)
        assert analyzer.project_index == project_index


class TestDetectIntegrations:
    """Tests for ComplexityAnalyzer._detect_integrations()."""

    def test_detects_graphiti(self):
        """Detects Graphiti integration."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._detect_integrations("integrate with graphiti for memory")
        assert "graphiti" in result

    def test_detects_database_integrations(self):
        """Detects database integrations."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._detect_integrations("migrate postgres database with redis cache")
        assert "postgres" in result
        assert "redis" in result

    def test_detects_cloud_providers(self):
        """Detects cloud provider integrations."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._detect_integrations("deploy to aws s3 and lambda")
        assert "aws" in result or "s3" in result or "lambda" in result

    def test_detects_auth_integrations(self):
        """Detects authentication integrations."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._detect_integrations("add oauth authentication with jwt tokens")
        assert "oauth" in result or "jwt" in result

    def test_detects_queue_integrations(self):
        """Detects message queue integrations."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._detect_integrations("process messages with kafka and rabbitmq")
        assert "kafka" in result
        assert "rabbitmq" in result

    def test_returns_empty_for_no_integrations(self):
        """Returns empty list when no integrations detected."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._detect_integrations("fix typo in button label")
        assert result == []

    def test_returns_unique_integrations(self):
        """Returns deduplicated list of integrations."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._detect_integrations("redis cache with redis queue")
        # Should only have redis once
        assert result.count("redis") == 1 or "redis" in result


class TestDetectInfrastructureChanges:
    """Tests for ComplexityAnalyzer._detect_infrastructure_changes()."""

    def test_detects_docker(self):
        """Detects Docker infrastructure."""
        analyzer = ComplexityAnalyzer()
        assert analyzer._detect_infrastructure_changes("add docker container") is True

    def test_detects_kubernetes(self):
        """Detects Kubernetes infrastructure."""
        analyzer = ComplexityAnalyzer()
        assert analyzer._detect_infrastructure_changes("deploy to kubernetes cluster") is True
        assert analyzer._detect_infrastructure_changes("configure k8s deployment") is True

    def test_detects_deployment(self):
        """Detects deployment changes."""
        analyzer = ComplexityAnalyzer()
        assert analyzer._detect_infrastructure_changes("deploy to production") is True

    def test_detects_ci_cd(self):
        """Detects CI/CD changes."""
        analyzer = ComplexityAnalyzer()
        assert analyzer._detect_infrastructure_changes("update ci/cd pipeline") is True

    def test_detects_environment_config(self):
        """Detects environment configuration."""
        analyzer = ComplexityAnalyzer()
        assert analyzer._detect_infrastructure_changes("add environment variable") is True
        assert analyzer._detect_infrastructure_changes("update config file") is True

    def test_detects_schema_changes(self):
        """Detects database schema changes."""
        analyzer = ComplexityAnalyzer()
        assert analyzer._detect_infrastructure_changes("modify database schema") is True

    def test_returns_false_for_no_infra(self):
        """Returns False when no infrastructure changes detected."""
        analyzer = ComplexityAnalyzer()
        assert analyzer._detect_infrastructure_changes("fix typo in button") is False


class TestEstimateFiles:
    """Tests for ComplexityAnalyzer._estimate_files()."""

    def test_single_file_keywords(self):
        """Detects single file scope."""
        analyzer = ComplexityAnalyzer()
        assert analyzer._estimate_files("fix this file only", None) == 1
        assert analyzer._estimate_files("update one component", None) == 1

    def test_explicit_file_extensions(self):
        """Counts explicit file mentions."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._estimate_files("modify app.tsx and utils.py", None)
        assert result >= 2

    def test_simple_keywords_low_estimate(self):
        """Simple keywords result in low file estimate."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._estimate_files("fix typo", None)
        assert result <= 3

    def test_feature_keywords_medium_estimate(self):
        """Feature keywords result in medium file estimate."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._estimate_files("add new feature for users", None)
        assert result >= 3

    def test_complex_keywords_high_estimate(self):
        """Complex keywords result in high file estimate."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._estimate_files("integrate with kafka microservice", None)
        assert result >= 10

    def test_default_estimate(self):
        """Returns default estimate for generic tasks."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._estimate_files("do something", None)
        assert result == 5


class TestEstimateServices:
    """Tests for ComplexityAnalyzer._estimate_services()."""

    def test_multi_service_keywords(self):
        """Detects multiple services from keywords."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._estimate_services("backend api and frontend client", None)
        assert result >= 2

    def test_monorepo_service_detection(self):
        """Detects mentioned services from monorepo project_index."""
        project_index = {
            "project_type": "monorepo",
            "services": {"backend": {}, "frontend": {}, "worker": {}},
        }
        analyzer = ComplexityAnalyzer(project_index=project_index)
        result = analyzer._estimate_services("update backend and frontend", None)
        assert result >= 2

    def test_minimum_one_service(self):
        """Returns at least 1 service."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._estimate_services("fix typo", None)
        assert result >= 1

    def test_maximum_five_services(self):
        """Caps at 5 services."""
        analyzer = ComplexityAnalyzer()
        result = analyzer._estimate_services(
            "backend frontend worker service api client server database queue cache proxy",
            None
        )
        assert result <= 5


class TestCalculateComplexity:
    """Tests for ComplexityAnalyzer._calculate_complexity()."""

    def test_simple_complexity(self):
        """Calculates SIMPLE complexity correctly."""
        analyzer = ComplexityAnalyzer()
        signals = {
            "simple_keywords": 2,
            "complex_keywords": 0,
            "multi_service_keywords": 0,
        }
        complexity, confidence, reasoning = analyzer._calculate_complexity(
            signals=signals,
            integrations=[],
            infra_changes=False,
            estimated_files=1,
            estimated_services=1,
        )
        assert complexity == Complexity.SIMPLE
        assert confidence >= 0.8

    def test_complex_many_integrations(self):
        """Many integrations results in COMPLEX."""
        analyzer = ComplexityAnalyzer()
        signals = {
            "simple_keywords": 0,
            "complex_keywords": 2,
            "multi_service_keywords": 1,
        }
        complexity, confidence, reasoning = analyzer._calculate_complexity(
            signals=signals,
            integrations=["redis", "postgres"],
            infra_changes=False,
            estimated_files=5,
            estimated_services=2,
        )
        assert complexity == Complexity.COMPLEX

    def test_complex_infrastructure_changes(self):
        """Infrastructure changes results in COMPLEX."""
        analyzer = ComplexityAnalyzer()
        signals = {
            "simple_keywords": 0,
            "complex_keywords": 1,
            "multi_service_keywords": 0,
        }
        complexity, confidence, reasoning = analyzer._calculate_complexity(
            signals=signals,
            integrations=[],
            infra_changes=True,
            estimated_files=3,
            estimated_services=1,
        )
        assert complexity == Complexity.COMPLEX
        assert "infrastructure" in reasoning.lower()

    def test_complex_many_services(self):
        """Many services results in COMPLEX."""
        analyzer = ComplexityAnalyzer()
        signals = {
            "simple_keywords": 0,
            "complex_keywords": 1,
            "multi_service_keywords": 3,
        }
        complexity, confidence, reasoning = analyzer._calculate_complexity(
            signals=signals,
            integrations=[],
            infra_changes=False,
            estimated_files=5,
            estimated_services=3,
        )
        assert complexity == Complexity.COMPLEX

    def test_complex_many_files(self):
        """Many files results in COMPLEX."""
        analyzer = ComplexityAnalyzer()
        signals = {
            "simple_keywords": 0,
            "complex_keywords": 2,
            "multi_service_keywords": 0,
        }
        complexity, confidence, reasoning = analyzer._calculate_complexity(
            signals=signals,
            integrations=[],
            infra_changes=False,
            estimated_files=15,
            estimated_services=1,
        )
        assert complexity == Complexity.COMPLEX

    def test_standard_default(self):
        """Falls back to STANDARD for moderate complexity."""
        analyzer = ComplexityAnalyzer()
        signals = {
            "simple_keywords": 1,
            "complex_keywords": 1,
            "multi_service_keywords": 1,
        }
        complexity, confidence, reasoning = analyzer._calculate_complexity(
            signals=signals,
            integrations=["redis"],
            infra_changes=False,
            estimated_files=5,
            estimated_services=2,
        )
        assert complexity == Complexity.STANDARD


class TestAnalyze:
    """Tests for ComplexityAnalyzer.analyze() method."""

    def test_simple_task_analysis(self):
        """Analyzes a simple task correctly."""
        analyzer = ComplexityAnalyzer()
        result = analyzer.analyze("fix typo in button label")

        assert isinstance(result, ComplexityAssessment)
        assert result.complexity == Complexity.SIMPLE
        assert result.confidence > 0
        assert "simple_keywords" in result.signals
        assert result.estimated_files <= 3

    def test_complex_task_analysis(self):
        """Analyzes a complex task correctly."""
        analyzer = ComplexityAnalyzer()
        result = analyzer.analyze(
            "integrate kafka and redis with kubernetes deployment for microservice architecture"
        )

        assert result.complexity == Complexity.COMPLEX
        assert len(result.external_integrations) > 0
        assert result.infrastructure_changes is True

    def test_standard_task_analysis(self):
        """Analyzes a standard task correctly."""
        analyzer = ComplexityAnalyzer()
        result = analyzer.analyze("add new user profile feature with database storage")

        assert result.complexity in [Complexity.STANDARD, Complexity.COMPLEX]
        assert result.estimated_files > 1

    def test_analysis_with_requirements(self):
        """Uses requirements data when provided."""
        analyzer = ComplexityAnalyzer()
        requirements = {
            "services_involved": ["backend", "frontend", "worker"],
        }
        result = analyzer.analyze("add feature", requirements=requirements)

        assert result.signals.get("explicit_services") == 3
        assert result.estimated_services >= 3

    def test_analysis_returns_assessment_object(self):
        """Returns ComplexityAssessment with all fields."""
        analyzer = ComplexityAnalyzer()
        result = analyzer.analyze("test task")

        assert hasattr(result, "complexity")
        assert hasattr(result, "confidence")
        assert hasattr(result, "signals")
        assert hasattr(result, "reasoning")
        assert hasattr(result, "estimated_files")
        assert hasattr(result, "estimated_services")
        assert hasattr(result, "external_integrations")
        assert hasattr(result, "infrastructure_changes")


class TestSaveAssessment:
    """Tests for save_assessment() function."""

    def test_saves_assessment_json(self, spec_dir: Path):
        """Saves assessment to complexity_assessment.json."""
        assessment = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.85,
            reasoning="Test reasoning",
            estimated_files=5,
            estimated_services=2,
        )

        result_path = save_assessment(spec_dir, assessment)

        assert result_path.exists()
        assert result_path.name == "complexity_assessment.json"

        data = json.loads(result_path.read_text())
        assert data["complexity"] == "standard"
        assert data["confidence"] == 0.85
        assert data["reasoning"] == "Test reasoning"

    def test_saves_phases_to_run(self, spec_dir: Path):
        """Saves phases_to_run in output."""
        assessment = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
        )

        result_path = save_assessment(spec_dir, assessment)
        data = json.loads(result_path.read_text())

        assert "phases_to_run" in data
        assert "discovery" in data["phases_to_run"]

    def test_saves_timestamp(self, spec_dir: Path):
        """Saves created_at timestamp."""
        assessment = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
        )

        save_assessment(spec_dir, assessment)
        data = json.loads((spec_dir / "complexity_assessment.json").read_text())

        assert "created_at" in data
        assert "T" in data["created_at"]  # ISO format


class TestRunAIComplexityAssessment:
    """Tests for run_ai_complexity_assessment() async function."""

    @pytest.mark.asyncio
    async def test_returns_none_on_agent_failure(self, spec_dir: Path):
        """Returns None when agent fails."""
        async def mock_agent(prompt_file, additional_context=None):
            return (False, "Agent failed")

        result = await run_ai_complexity_assessment(
            spec_dir=spec_dir,
            task_description="test task",
            run_agent_fn=mock_agent,
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_missing_file(self, spec_dir: Path):
        """Returns None when assessment file not created."""
        async def mock_agent(prompt_file, additional_context=None):
            return (True, "Success but no file")

        result = await run_ai_complexity_assessment(
            spec_dir=spec_dir,
            task_description="test task",
            run_agent_fn=mock_agent,
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_parses_ai_assessment(self, spec_dir: Path):
        """Parses AI assessment file correctly."""
        # Pre-create the assessment file that the agent would create
        assessment_data = {
            "complexity": "standard",
            "confidence": 0.9,
            "reasoning": "AI determined standard",
            "analysis": {
                "scope": {
                    "estimated_files": 8,
                    "estimated_services": 2,
                },
                "integrations": {
                    "external_services": ["redis"],
                },
                "infrastructure": {
                    "docker_changes": True,
                },
            },
            "recommended_phases": ["discovery", "requirements", "validation"],
            "flags": {
                "needs_research": True,
                "needs_self_critique": False,
            },
        }
        (spec_dir / "complexity_assessment.json").write_text(json.dumps(assessment_data))

        async def mock_agent(prompt_file, additional_context=None):
            return (True, "Assessment created")

        result = await run_ai_complexity_assessment(
            spec_dir=spec_dir,
            task_description="test task",
            run_agent_fn=mock_agent,
        )

        assert result is not None
        assert result.complexity == Complexity.STANDARD
        assert result.confidence == 0.9
        assert result.recommended_phases == ["discovery", "requirements", "validation"]
        assert result.needs_research is True
        assert result.needs_self_critique is False

    @pytest.mark.asyncio
    async def test_includes_requirements_in_context(self, spec_dir: Path):
        """Includes requirements.json content in agent context."""
        # Create requirements file
        requirements = {
            "task_description": "Test task from requirements",
            "workflow_type": "feature",
            "services_involved": ["backend", "frontend"],
            "user_requirements": ["req1"],
            "acceptance_criteria": ["crit1"],
            "constraints": ["const1"],
        }
        (spec_dir / "requirements.json").write_text(json.dumps(requirements))

        context_received = []

        async def mock_agent(prompt_file, additional_context=None):
            context_received.append(additional_context)
            return (False, "Fail to inspect context")

        await run_ai_complexity_assessment(
            spec_dir=spec_dir,
            task_description="test task",
            run_agent_fn=mock_agent,
        )

        assert len(context_received) == 1
        assert "Test task from requirements" in context_received[0]
        assert "backend" in context_received[0]

    @pytest.mark.asyncio
    async def test_handles_exception_gracefully(self, spec_dir: Path):
        """Returns None on exception."""
        async def mock_agent(prompt_file, additional_context=None):
            raise Exception("Unexpected error")

        result = await run_ai_complexity_assessment(
            spec_dir=spec_dir,
            task_description="test task",
            run_agent_fn=mock_agent,
        )

        assert result is None


class TestKeywordLists:
    """Tests for keyword classification lists."""

    def test_simple_keywords_are_lowercase(self):
        """All SIMPLE_KEYWORDS are lowercase."""
        for kw in ComplexityAnalyzer.SIMPLE_KEYWORDS:
            assert kw == kw.lower()

    def test_complex_keywords_are_lowercase(self):
        """All COMPLEX_KEYWORDS are lowercase."""
        for kw in ComplexityAnalyzer.COMPLEX_KEYWORDS:
            assert kw == kw.lower()

    def test_multi_service_keywords_are_lowercase(self):
        """All MULTI_SERVICE_KEYWORDS are lowercase."""
        for kw in ComplexityAnalyzer.MULTI_SERVICE_KEYWORDS:
            assert kw == kw.lower()

    def test_keyword_lists_non_empty(self):
        """All keyword lists have entries."""
        assert len(ComplexityAnalyzer.SIMPLE_KEYWORDS) > 0
        assert len(ComplexityAnalyzer.COMPLEX_KEYWORDS) > 0
        assert len(ComplexityAnalyzer.MULTI_SERVICE_KEYWORDS) > 0

    def test_simple_complex_no_overlap(self):
        """SIMPLE and COMPLEX keywords don't overlap."""
        simple_set = set(ComplexityAnalyzer.SIMPLE_KEYWORDS)
        complex_set = set(ComplexityAnalyzer.COMPLEX_KEYWORDS)
        overlap = simple_set.intersection(complex_set)
        assert len(overlap) == 0, f"Overlapping keywords: {overlap}"


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_empty_task_description(self):
        """Handles empty task description."""
        analyzer = ComplexityAnalyzer()
        result = analyzer.analyze("")
        # Should return valid assessment
        assert isinstance(result, ComplexityAssessment)

    def test_very_long_task_description(self):
        """Handles very long task description."""
        analyzer = ComplexityAnalyzer()
        long_task = "implement feature " * 1000
        result = analyzer.analyze(long_task)
        assert isinstance(result, ComplexityAssessment)

    def test_special_characters_in_task(self):
        """Handles special characters in task."""
        analyzer = ComplexityAnalyzer()
        result = analyzer.analyze("fix bug in <Component /> with @decorator & regex /pattern/")
        assert isinstance(result, ComplexityAssessment)

    def test_unicode_in_task(self):
        """Handles unicode characters in task."""
        analyzer = ComplexityAnalyzer()
        result = analyzer.analyze("add emoji support for 🚀 and 日本語")
        assert isinstance(result, ComplexityAssessment)

    def test_case_insensitive_keyword_detection(self):
        """Keyword detection is case-insensitive."""
        analyzer = ComplexityAnalyzer()
        result1 = analyzer.analyze("FIX TYPO IN BUTTON")
        result2 = analyzer.analyze("fix typo in button")
        assert result1.signals["simple_keywords"] == result2.signals["simple_keywords"]

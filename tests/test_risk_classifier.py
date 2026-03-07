#!/usr/bin/env python3
"""
Tests for Risk Classifier Module
================================

Tests the risk_classifier.py module functionality including:
- Loading and parsing complexity_assessment.json
- Validation recommendations parsing
- Risk level determination
- Backward compatibility with older assessments
"""

import json
import pytest
import tempfile
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from risk_classifier import (
    RiskClassifier,
    RiskAssessment,
    ValidationRecommendations,
    ComplexityAnalysis,
    ScopeAnalysis,
    IntegrationAnalysis,
    InfrastructureAnalysis,
    KnowledgeAnalysis,
    RiskAnalysis,
    AssessmentFlags,
    load_risk_assessment,
    get_validation_requirements,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def temp_spec_dir():
    """Create a temporary spec directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def classifier():
    """Create a fresh RiskClassifier instance."""
    return RiskClassifier()


def create_assessment_file(
    spec_dir: Path, assessment_data: dict
) -> Path:
    """Helper to create a complexity_assessment.json file."""
    assessment_file = spec_dir / "complexity_assessment.json"
    with open(assessment_file, "w", encoding="utf-8") as f:
        json.dump(assessment_data, f, indent=2)
    return assessment_file


# =============================================================================
# SAMPLE DATA
# =============================================================================


SIMPLE_ASSESSMENT = {
    "complexity": "simple",
    "workflow_type": "simple",
    "confidence": 0.95,
    "reasoning": "Single file UI change with no dependencies.",
    "analysis": {
        "scope": {
            "estimated_files": 1,
            "estimated_services": 1,
            "is_cross_cutting": False,
            "notes": "CSS-only change",
        },
        "integrations": {
            "external_services": [],
            "new_dependencies": [],
            "research_needed": False,
        },
        "infrastructure": {
            "docker_changes": False,
            "database_changes": False,
            "config_changes": False,
        },
        "knowledge": {
            "patterns_exist": True,
            "research_required": False,
            "unfamiliar_tech": [],
        },
        "risk": {
            "level": "low",
            "concerns": [],
        },
    },
    "recommended_phases": ["discovery", "quick_spec", "validation"],
    "flags": {
        "needs_research": False,
        "needs_self_critique": False,
        "needs_infrastructure_setup": False,
    },
    "validation_recommendations": {
        "risk_level": "low",
        "skip_validation": False,
        "minimal_mode": True,
        "test_types_required": ["unit"],
        "security_scan_required": False,
        "staging_deployment_required": False,
        "reasoning": "Simple CSS change with minimal testing needs.",
    },
}


COMPLEX_ASSESSMENT = {
    "complexity": "complex",
    "workflow_type": "feature",
    "confidence": 0.90,
    "reasoning": "Multiple integrations with infrastructure changes.",
    "analysis": {
        "scope": {
            "estimated_files": 12,
            "estimated_services": 3,
            "is_cross_cutting": True,
            "notes": "Touches multiple services",
        },
        "integrations": {
            "external_services": ["Stripe", "Auth0"],
            "new_dependencies": ["stripe", "@auth0/auth0-spa-js"],
            "research_needed": True,
            "notes": "Payment and auth integration",
        },
        "infrastructure": {
            "docker_changes": True,
            "database_changes": True,
            "config_changes": True,
            "notes": "New container and DB migrations",
        },
        "knowledge": {
            "patterns_exist": False,
            "research_required": True,
            "unfamiliar_tech": ["Stripe webhooks", "Auth0 rules"],
        },
        "risk": {
            "level": "high",
            "concerns": ["Payment security", "Auth vulnerabilities", "Data integrity"],
        },
    },
    "recommended_phases": [
        "discovery",
        "requirements",
        "research",
        "context",
        "spec_writing",
        "self_critique",
        "planning",
        "validation",
    ],
    "flags": {
        "needs_research": True,
        "needs_self_critique": True,
        "needs_infrastructure_setup": True,
    },
    "validation_recommendations": {
        "risk_level": "critical",
        "skip_validation": False,
        "minimal_mode": False,
        "test_types_required": ["unit", "integration", "e2e", "security"],
        "security_scan_required": True,
        "staging_deployment_required": True,
        "reasoning": "Payment and auth integration requires comprehensive testing.",
    },
}


TRIVIAL_ASSESSMENT = {
    "complexity": "simple",
    "workflow_type": "simple",
    "confidence": 0.98,
    "reasoning": "Documentation-only change.",
    "analysis": {
        "scope": {
            "estimated_files": 1,
            "estimated_services": 0,
            "is_cross_cutting": False,
        },
        "integrations": {
            "external_services": [],
            "new_dependencies": [],
            "research_needed": False,
        },
        "infrastructure": {
            "docker_changes": False,
            "database_changes": False,
            "config_changes": False,
        },
        "risk": {
            "level": "low",
            "concerns": [],
        },
    },
    "recommended_phases": ["discovery", "quick_spec", "validation"],
    "flags": {
        "needs_research": False,
        "needs_self_critique": False,
    },
    "validation_recommendations": {
        "risk_level": "trivial",
        "skip_validation": True,
        "minimal_mode": True,
        "test_types_required": [],
        "security_scan_required": False,
        "staging_deployment_required": False,
        "reasoning": "README update only - no functional code changes.",
    },
}


# Assessment without validation_recommendations (backward compatibility)
LEGACY_ASSESSMENT = {
    "complexity": "standard",
    "workflow_type": "feature",
    "confidence": 0.85,
    "reasoning": "New API endpoint.",
    "analysis": {
        "scope": {
            "estimated_files": 5,
            "estimated_services": 1,
            "is_cross_cutting": False,
        },
        "integrations": {
            "external_services": [],
            "new_dependencies": [],
            "research_needed": False,
        },
        "infrastructure": {
            "docker_changes": False,
            "database_changes": False,
            "config_changes": False,
        },
        "knowledge": {
            "patterns_exist": True,
            "research_required": False,
            "unfamiliar_tech": [],
        },
        "risk": {
            "level": "medium",
            "concerns": [],
        },
    },
    "recommended_phases": [
        "discovery",
        "requirements",
        "context",
        "spec_writing",
        "planning",
        "validation",
    ],
    "flags": {
        "needs_research": False,
        "needs_self_critique": False,
    },
    # No validation_recommendations - should be inferred
}


# =============================================================================
# TESTS: LOADING
# =============================================================================


class TestLoadAssessment:
    """Tests for loading complexity_assessment.json."""

    def test_load_valid_assessment(self, temp_spec_dir, classifier):
        """Loads a valid complexity_assessment.json file."""
        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert assessment is not None
        assert assessment.complexity == "simple"
        assert assessment.workflow_type == "simple"
        assert assessment.confidence == 0.95

    def test_load_nonexistent_file(self, temp_spec_dir, classifier):
        """Returns None when file doesn't exist."""
        assessment = classifier.load_assessment(temp_spec_dir)
        assert assessment is None

    def test_load_invalid_json(self, temp_spec_dir, classifier):
        """Returns None for invalid JSON."""
        assessment_file = temp_spec_dir / "complexity_assessment.json"
        assessment_file.write_text("invalid json {{{")

        assessment = classifier.load_assessment(temp_spec_dir)
        assert assessment is None

    def test_caches_loaded_assessment(self, temp_spec_dir, classifier):
        """Caches loaded assessments."""
        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)

        # Load twice
        assessment1 = classifier.load_assessment(temp_spec_dir)
        assessment2 = classifier.load_assessment(temp_spec_dir)

        # Should be same object from cache
        assert assessment1 is assessment2

    def test_clear_cache(self, temp_spec_dir, classifier):
        """Cache can be cleared."""
        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)

        assessment1 = classifier.load_assessment(temp_spec_dir)
        classifier.clear_cache()
        assessment2 = classifier.load_assessment(temp_spec_dir)

        # After cache clear, should be different objects
        assert assessment1 is not assessment2


# =============================================================================
# TESTS: PARSING
# =============================================================================


class TestParseAssessment:
    """Tests for parsing assessment data into objects."""

    def test_parses_scope(self, temp_spec_dir, classifier):
        """Parses scope analysis correctly."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert assessment.analysis.scope.estimated_files == 12
        assert assessment.analysis.scope.estimated_services == 3
        assert assessment.analysis.scope.is_cross_cutting is True

    def test_parses_integrations(self, temp_spec_dir, classifier):
        """Parses integrations analysis correctly."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert "Stripe" in assessment.analysis.integrations.external_services
        assert "stripe" in assessment.analysis.integrations.new_dependencies
        assert assessment.analysis.integrations.research_needed is True

    def test_parses_infrastructure(self, temp_spec_dir, classifier):
        """Parses infrastructure analysis correctly."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert assessment.analysis.infrastructure.docker_changes is True
        assert assessment.analysis.infrastructure.database_changes is True
        assert assessment.analysis.infrastructure.config_changes is True

    def test_parses_flags(self, temp_spec_dir, classifier):
        """Parses flags correctly."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert assessment.flags.needs_research is True
        assert assessment.flags.needs_self_critique is True
        assert assessment.flags.needs_infrastructure_setup is True

    def test_parses_validation_recommendations(self, temp_spec_dir, classifier):
        """Parses validation recommendations correctly."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert assessment.validation.risk_level == "critical"
        assert assessment.validation.skip_validation is False
        assert assessment.validation.security_scan_required is True
        assert "e2e" in assessment.validation.test_types_required


# =============================================================================
# TESTS: BACKWARD COMPATIBILITY
# =============================================================================


class TestBackwardCompatibility:
    """Tests for backward compatibility with older assessments."""

    def test_infers_validation_from_analysis(self, temp_spec_dir, classifier):
        """Infers validation recommendations when not present."""
        create_assessment_file(temp_spec_dir, LEGACY_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        # Should have inferred validation recommendations
        assert assessment.validation is not None
        assert assessment.validation.risk_level == "medium"
        assert "unit" in assessment.validation.test_types_required

    def test_infers_medium_risk_test_types(self, temp_spec_dir, classifier):
        """Infers unit + integration for medium risk."""
        create_assessment_file(temp_spec_dir, LEGACY_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert "unit" in assessment.validation.test_types_required
        assert "integration" in assessment.validation.test_types_required

    def test_handles_missing_sections(self, temp_spec_dir, classifier):
        """Handles assessments with missing optional sections."""
        minimal_assessment = {
            "complexity": "simple",
            "workflow_type": "simple",
            "confidence": 0.9,
        }
        create_assessment_file(temp_spec_dir, minimal_assessment)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert assessment is not None
        assert assessment.complexity == "simple"
        # Should have defaults for missing sections
        assert assessment.analysis.scope.estimated_files == 0


# =============================================================================
# TESTS: CONVENIENCE METHODS
# =============================================================================


class TestConvenienceMethods:
    """Tests for convenience query methods."""

    def test_should_skip_validation_true(self, temp_spec_dir, classifier):
        """Returns True for trivial tasks."""
        create_assessment_file(temp_spec_dir, TRIVIAL_ASSESSMENT)

        assert classifier.should_skip_validation(temp_spec_dir) is True

    def test_should_skip_validation_false(self, temp_spec_dir, classifier):
        """Returns False for non-trivial tasks."""
        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)

        assert classifier.should_skip_validation(temp_spec_dir) is False

    def test_should_skip_validation_no_file(self, temp_spec_dir, classifier):
        """Returns False when file doesn't exist."""
        assert classifier.should_skip_validation(temp_spec_dir) is False

    def test_should_use_minimal_mode(self, temp_spec_dir, classifier):
        """Returns True for minimal mode tasks."""
        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)

        assert classifier.should_use_minimal_mode(temp_spec_dir) is True

    def test_get_required_test_types(self, temp_spec_dir, classifier):
        """Returns correct test types."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        test_types = classifier.get_required_test_types(temp_spec_dir)

        assert "unit" in test_types
        assert "integration" in test_types
        assert "e2e" in test_types
        assert "security" in test_types

    def test_get_required_test_types_default(self, temp_spec_dir, classifier):
        """Returns unit tests as default when file doesn't exist."""
        test_types = classifier.get_required_test_types(temp_spec_dir)

        assert test_types == ["unit"]

    def test_requires_security_scan(self, temp_spec_dir, classifier):
        """Correctly identifies security scan requirement."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        assert classifier.requires_security_scan(temp_spec_dir) is True

        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)
        classifier.clear_cache()

        assert classifier.requires_security_scan(temp_spec_dir) is False

    def test_requires_staging_deployment(self, temp_spec_dir, classifier):
        """Correctly identifies staging deployment requirement."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        assert classifier.requires_staging_deployment(temp_spec_dir) is True

    def test_get_risk_level(self, temp_spec_dir, classifier):
        """Returns correct risk level."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)
        assert classifier.get_risk_level(temp_spec_dir) == "critical"

        classifier.clear_cache()
        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)
        assert classifier.get_risk_level(temp_spec_dir) == "low"

    def test_get_complexity(self, temp_spec_dir, classifier):
        """Returns correct complexity level."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)
        assert classifier.get_complexity(temp_spec_dir) == "complex"

        classifier.clear_cache()
        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)
        assert classifier.get_complexity(temp_spec_dir) == "simple"


# =============================================================================
# TESTS: VALIDATION SUMMARY
# =============================================================================


class TestValidationSummary:
    """Tests for get_validation_summary method."""

    def test_returns_full_summary(self, temp_spec_dir, classifier):
        """Returns complete validation summary."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        summary = classifier.get_validation_summary(temp_spec_dir)

        assert summary["risk_level"] == "critical"
        assert summary["complexity"] == "complex"
        assert summary["skip_validation"] is False
        assert summary["security_scan"] is True
        assert summary["staging_deployment"] is True
        assert "unit" in summary["test_types"]

    def test_returns_unknown_for_missing_file(self, temp_spec_dir, classifier):
        """Returns unknown values when file doesn't exist."""
        summary = classifier.get_validation_summary(temp_spec_dir)

        assert summary["risk_level"] == "unknown"
        assert summary["complexity"] == "unknown"
        assert summary["confidence"] == 0.0


# =============================================================================
# TESTS: CONVENIENCE FUNCTIONS
# =============================================================================


class TestConvenienceFunctions:
    """Tests for module-level convenience functions."""

    def test_load_risk_assessment(self, temp_spec_dir):
        """load_risk_assessment function works."""
        create_assessment_file(temp_spec_dir, SIMPLE_ASSESSMENT)

        assessment = load_risk_assessment(temp_spec_dir)

        assert assessment is not None
        assert assessment.complexity == "simple"

    def test_get_validation_requirements(self, temp_spec_dir):
        """get_validation_requirements function works."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        requirements = get_validation_requirements(temp_spec_dir)

        assert requirements["risk_level"] == "critical"
        assert "unit" in requirements["test_types"]


# =============================================================================
# TESTS: DATACLASS PROPERTIES
# =============================================================================


class TestDataclassProperties:
    """Tests for dataclass properties."""

    def test_risk_assessment_risk_level_property(self, temp_spec_dir, classifier):
        """RiskAssessment.risk_level property works."""
        create_assessment_file(temp_spec_dir, COMPLEX_ASSESSMENT)

        assessment = classifier.load_assessment(temp_spec_dir)

        assert assessment.risk_level == "critical"
        assert assessment.risk_level == assessment.validation.risk_level

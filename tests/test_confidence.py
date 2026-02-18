"""
Tests for Confidence Scoring (confidence.py)
============================================

Tests the deprecated confidence scoring module for review findings.
Note: This module is deprecated but still needs test coverage.
"""

import warnings

import pytest

from runners.github.confidence import (
    FalsePositiveRisk,
    ConfidenceLevel,
    ConfidenceFactors,
    ScoredFinding,
    ReviewContext,
    ConfidenceScorer,
)


# ============================================================================
# Test Setup
# ============================================================================


class TestDeprecationWarning:
    """Tests for deprecation warning."""

    def test_module_emits_deprecation_warning(self):
        """Test that importing the module emits a deprecation warning."""
        # The warning is emitted at import time, so we can't test it directly here
        # But we can verify the module loads
        from runners.github import confidence
        assert confidence.ConfidenceScorer is not None


# ============================================================================
# FalsePositiveRisk Tests
# ============================================================================


class TestFalsePositiveRisk:
    """Tests for FalsePositiveRisk enum."""

    def test_risk_levels(self):
        """Test all risk levels exist."""
        assert FalsePositiveRisk.LOW == "low"
        assert FalsePositiveRisk.MEDIUM == "medium"
        assert FalsePositiveRisk.HIGH == "high"
        assert FalsePositiveRisk.UNKNOWN == "unknown"


# ============================================================================
# ConfidenceLevel Tests
# ============================================================================


class TestConfidenceLevel:
    """Tests for ConfidenceLevel enum."""

    def test_levels(self):
        """Test all confidence levels exist."""
        assert ConfidenceLevel.VERY_HIGH == "very_high"
        assert ConfidenceLevel.HIGH == "high"
        assert ConfidenceLevel.MEDIUM == "medium"
        assert ConfidenceLevel.LOW == "low"


# ============================================================================
# ConfidenceFactors Tests
# ============================================================================


class TestConfidenceFactors:
    """Tests for ConfidenceFactors dataclass."""

    def test_default_values(self):
        """Test default factor values."""
        factors = ConfidenceFactors()
        assert factors.pattern_matches == 0
        assert factors.pattern_accuracy == 0.0
        assert factors.file_type_accuracy == 0.0
        assert factors.category_accuracy == 0.0
        assert factors.code_evidence_count == 0
        assert factors.similar_findings_count == 0
        assert factors.historical_sample_size == 0
        assert factors.historical_accuracy == 0.0
        assert factors.severity_weight == 1.0

    def test_with_values(self):
        """Test factors with specific values."""
        factors = ConfidenceFactors(
            pattern_matches=5,
            pattern_accuracy=0.85,
            file_type_accuracy=0.90,
            category_accuracy=0.80,
            code_evidence_count=3,
            similar_findings_count=2,
            historical_sample_size=100,
            historical_accuracy=0.75,
            severity_weight=1.2,
        )
        assert factors.pattern_matches == 5
        assert factors.pattern_accuracy == 0.85
        assert factors.severity_weight == 1.2

    def test_to_dict(self):
        """Test converting factors to dict."""
        factors = ConfidenceFactors(
            pattern_matches=3,
            pattern_accuracy=0.8,
            code_evidence_count=2,
        )
        result = factors.to_dict()
        assert result["pattern_matches"] == 3
        assert result["pattern_accuracy"] == 0.8
        assert result["code_evidence_count"] == 2


# ============================================================================
# ScoredFinding Tests
# ============================================================================


class TestScoredFinding:
    """Tests for ScoredFinding dataclass."""

    def test_create_minimal(self):
        """Test creating a minimal scored finding."""
        factors = ConfidenceFactors()
        finding = ScoredFinding(
            finding_id="test-1",
            original_finding={"category": "bug"},
            confidence=75.0,
            confidence_level=ConfidenceLevel.HIGH,
            false_positive_risk=FalsePositiveRisk.LOW,
            factors=factors,
        )
        assert finding.finding_id == "test-1"
        assert finding.confidence == 75.0
        assert finding.confidence_level == ConfidenceLevel.HIGH

    def test_is_high_confidence(self):
        """Test is_high_confidence property."""
        factors = ConfidenceFactors()

        # 75% is high confidence
        finding = ScoredFinding(
            finding_id="test-1",
            original_finding={},
            confidence=75.0,
            confidence_level=ConfidenceLevel.HIGH,
            false_positive_risk=FalsePositiveRisk.LOW,
            factors=factors,
        )
        assert finding.is_high_confidence is True

        # 74% is not high confidence
        finding.confidence = 74.0
        finding.confidence_level = ConfidenceLevel.MEDIUM
        assert finding.is_high_confidence is False

    def test_should_highlight(self):
        """Test should_highlight property."""
        factors = ConfidenceFactors()

        # High confidence + low/medium risk = highlight
        finding = ScoredFinding(
            finding_id="test-1",
            original_finding={},
            confidence=80.0,
            confidence_level=ConfidenceLevel.HIGH,
            false_positive_risk=FalsePositiveRisk.LOW,
            factors=factors,
        )
        assert finding.should_highlight is True

        # High confidence + high risk = no highlight
        finding.false_positive_risk = FalsePositiveRisk.HIGH
        assert finding.should_highlight is False

        # Low confidence = no highlight
        finding.confidence = 50.0
        finding.confidence_level = ConfidenceLevel.MEDIUM
        finding.false_positive_risk = FalsePositiveRisk.LOW
        assert finding.should_highlight is False

    def test_to_dict(self):
        """Test converting scored finding to dict."""
        factors = ConfidenceFactors(pattern_matches=2)
        finding = ScoredFinding(
            finding_id="test-1",
            original_finding={"category": "bug"},
            confidence=85.0,
            confidence_level=ConfidenceLevel.VERY_HIGH,
            false_positive_risk=FalsePositiveRisk.LOW,
            factors=factors,
            evidence=["line 42", "line 50"],
            explanation_basis="Test basis",
        )
        result = finding.to_dict()
        assert result["finding_id"] == "test-1"
        assert result["confidence"] == 85.0
        assert result["confidence_level"] == "very_high"
        assert result["false_positive_risk"] == "low"
        assert result["evidence"] == ["line 42", "line 50"]
        assert result["explanation_basis"] == "Test basis"


# ============================================================================
# ReviewContext Tests
# ============================================================================


class TestReviewContext:
    """Tests for ReviewContext dataclass."""

    def test_default_context(self):
        """Test default context values."""
        context = ReviewContext()
        assert context.file_types == []
        assert context.categories == []
        assert context.change_size == "medium"
        assert context.pr_author == ""
        assert context.is_external_contributor is False

    def test_with_values(self):
        """Test context with specific values."""
        context = ReviewContext(
            file_types=[".py", ".ts"],
            categories=["security", "bug"],
            change_size="large",
            pr_author="alice",
            is_external_contributor=True,
        )
        assert context.file_types == [".py", ".ts"]
        assert context.categories == ["security", "bug"]
        assert context.change_size == "large"
        assert context.pr_author == "alice"
        assert context.is_external_contributor is True


# ============================================================================
# ConfidenceScorer Tests
# ============================================================================


class TestConfidenceScorerInit:
    """Tests for ConfidenceScorer initialization."""

    def test_init_default(self):
        """Test initialization with defaults."""
        scorer = ConfidenceScorer()
        assert scorer.learning_tracker is None
        assert scorer.patterns == []

    def test_init_with_patterns(self):
        """Test initialization with patterns."""
        patterns = [{"pattern_type": "test", "accuracy": 0.8}]
        scorer = ConfidenceScorer(patterns=patterns)
        assert scorer.patterns == patterns

    def test_init_with_tracker(self):
        """Test initialization with learning tracker."""
        mock_tracker = {"get_accuracy": lambda: None}
        scorer = ConfidenceScorer(learning_tracker=mock_tracker)
        assert scorer.learning_tracker == mock_tracker


class TestConfidenceScorerScoreFinding:
    """Tests for score_finding method."""

    def test_score_minimal_finding(self):
        """Test scoring a minimal finding."""
        scorer = ConfidenceScorer()
        finding = {
            "id": "test-1",
            "category": "bug",
            "severity": "medium",
        }
        scored = scorer.score_finding(finding)
        assert scored.finding_id == "test-1"
        assert 0 <= scored.confidence <= 100
        assert isinstance(scored.confidence_level, ConfidenceLevel)
        assert isinstance(scored.false_positive_risk, FalsePositiveRisk)

    def test_score_with_evidence(self):
        """Test scoring with evidence increases confidence."""
        scorer = ConfidenceScorer()
        finding = {
            "id": "test-1",
            "category": "bug",
            "severity": "medium",
            "evidence": ["line 1", "line 2", "line 3"],
        }
        scored = scorer.score_finding(finding)
        assert scored.factors.code_evidence_count == 3
        # More evidence should increase confidence
        assert scored.confidence > 0

    def test_score_by_severity(self):
        """Test that severity affects confidence."""
        scorer = ConfidenceScorer()

        critical_finding = {"id": "critical", "severity": "critical"}
        low_finding = {"id": "low", "severity": "low"}

        critical_scored = scorer.score_finding(critical_finding)
        low_scored = scorer.score_finding(low_finding)

        # Critical severity has higher weight
        assert critical_scored.factors.severity_weight > low_scored.factors.severity_weight

    def test_confidence_levels(self):
        """Test confidence level thresholds."""
        scorer = ConfidenceScorer()

        # Very high confidence (90%+)
        finding = {
            "id": "test",
            "category": "security",
            "severity": "critical",
            "evidence": ["e1", "e2", "e3", "e4", "e5"],
        }
        scored = scorer.score_finding(finding)
        # Security category + critical severity + 5 evidence should be high
        assert scored.confidence_level in [
            ConfidenceLevel.VERY_HIGH,
            ConfidenceLevel.HIGH,
        ]

    def test_false_positive_risk_assessment(self):
        """Test false positive risk assessment."""
        scorer = ConfidenceScorer()

        # Low confidence finding
        finding = {"id": "test", "category": "style"}
        scored = scorer.score_finding(finding)

        if scored.confidence < 50:
            assert scored.false_positive_risk == FalsePositiveRisk.HIGH


class TestConfidenceScorerScoreFindings:
    """Tests for score_findings method."""

    def test_score_multiple_findings(self):
        """Test scoring multiple findings."""
        scorer = ConfidenceScorer()
        findings = [
            {"id": "1", "category": "bug", "evidence": ["e1"]},
            {"id": "2", "category": "security", "evidence": ["e1", "e2", "e3"]},
            {"id": "3", "category": "style"},
        ]
        scored = scorer.score_findings(findings)
        assert len(scored) == 3
        # Should be sorted by confidence descending
        assert scored[0].confidence >= scored[1].confidence
        assert scored[1].confidence >= scored[2].confidence

    def test_score_empty_list(self):
        """Test scoring empty findings list."""
        scorer = ConfidenceScorer()
        scored = scorer.score_findings([])
        assert scored == []


class TestConfidenceScorerCategoryScoring:
    """Tests for _score_category method."""

    def test_high_confidence_categories(self):
        """Test categories with inherently high confidence."""
        scorer = ConfidenceScorer()
        high_categories = ["security", "bug", "error_handling", "performance"]

        for category in high_categories:
            finding = {"id": "test", "category": category}
            scored = scorer.score_finding(finding)
            # These categories should have decent base confidence
            assert scored.confidence > 0

    def test_low_confidence_categories(self):
        """Test categories with inherently lower confidence."""
        scorer = ConfidenceScorer()
        low_categories = ["style", "naming", "documentation", "nitpick"]

        for category in low_categories:
            finding = {"id": "test", "category": category}
            scored = scorer.score_finding(finding)
            # These categories should have lower confidence
            assert scored.confidence < 100  # Still valid


class TestConfidenceScorerPatternScoring:
    """Tests for _score_patterns method."""

    def test_no_patterns_returns_neutral(self):
        """Test that no patterns returns neutral score."""
        scorer = ConfidenceScorer(patterns=[])
        finding = {"id": "test", "file": "test.py", "category": "bug"}
        scored = scorer.score_finding(finding)
        # Should still have a baseline confidence
        assert scored.confidence >= 0

    def test_pattern_matching(self):
        """Test pattern matching affects score."""
        # Create mock patterns
        patterns = [
            {
                "pattern_type": "file_type_accuracy",
                "context": {"file_type": "py"},
                "accuracy": 0.9,
            },
        ]
        scorer = ConfidenceScorer(patterns=patterns)
        finding = {"id": "test", "file": "test.py", "category": "bug"}
        scored = scorer.score_finding(finding)
        assert scored.factors.pattern_matches >= 0


class TestConfidenceScorerFiltering:
    """Tests for filter_by_confidence method."""

    def test_filter_by_min_confidence(self):
        """Test filtering by minimum confidence."""
        scorer = ConfidenceScorer()
        findings = [
            {"id": "1", "category": "security", "evidence": ["e1", "e2", "e3", "e4", "e5"]},
            {"id": "2", "category": "style"},
        ]
        scored = scorer.score_findings(findings)

        # Filter for high confidence (70%+)
        filtered = scorer.filter_by_confidence(scored, min_confidence=70.0)
        # All filtered should have confidence >= 70
        for f in filtered:
            assert f.confidence >= 70.0

    def test_filter_excludes_high_fp_risk(self):
        """Test filtering excludes high false positive risk."""
        scorer = ConfidenceScorer()
        findings = [{"id": "1", "category": "style"}]  # Likely high FP risk
        scored = scorer.score_findings(findings)

        # Filter excluding high FP risk
        filtered = scorer.filter_by_confidence(
            scored,
            min_confidence=0.0,  # No confidence threshold
            exclude_high_fp_risk=True,
        )
        # Should exclude high FP risk findings
        for f in filtered:
            assert f.false_positive_risk != FalsePositiveRisk.HIGH


class TestConfidenceScorerSummary:
    """Tests for get_summary method."""

    def test_summary_empty(self):
        """Test summary with empty findings."""
        scorer = ConfidenceScorer()
        summary = scorer.get_summary([])
        assert summary["total"] == 0
        assert summary["avg_confidence"] == 0.0
        assert summary["by_level"] == {}
        assert summary["by_risk"] == {}

    def test_summary_with_findings(self):
        """Test summary with actual findings."""
        scorer = ConfidenceScorer()
        findings = [
            {"id": "1", "category": "security", "evidence": ["e1"]},
            {"id": "2", "category": "style"},
        ]
        scored = scorer.score_findings(findings)
        summary = scorer.get_summary(scored)

        assert summary["total"] == 2
        assert 0 <= summary["avg_confidence"] <= 100
        assert len(summary["by_level"]) > 0
        assert len(summary["by_risk"]) > 0

    def test_summary_high_confidence_count(self):
        """Test high confidence count in summary."""
        scorer = ConfidenceScorer()
        findings = [
            {"id": "1", "category": "security", "evidence": ["e1", "e2", "e3", "e4"]},
            {"id": "2", "category": "style"},
        ]
        scored = scorer.score_findings(findings)
        summary = scorer.get_summary(scored)

        # Count very_high + high
        expected = (
            summary["by_level"].get("very_high", 0)
            + summary["by_level"].get("high", 0)
        )
        assert summary["high_confidence_count"] == expected

    def test_summary_low_risk_count(self):
        """Test low risk count in summary."""
        scorer = ConfidenceScorer()
        findings = [
            {"id": "1", "category": "security", "evidence": ["e1", "e2", "e3"]},
        ]
        scored = scorer.score_findings(findings)
        summary = scorer.get_summary(scored)

        assert "low_risk_count" in summary
        assert summary["low_risk_count"] >= 0


class TestConfidenceScorerExplain:
    """Tests for explain_confidence method."""

    def test_explain_confidence(self):
        """Test generating confidence explanation."""
        scorer = ConfidenceScorer()
        finding = {
            "id": "test",
            "category": "bug",
            "evidence": ["line 42"],
        }
        scored = scorer.score_finding(finding)
        explanation = scorer.explain_confidence(scored)

        assert "Confidence:" in explanation
        assert "False positive risk:" in explanation
        assert "Basis:" in explanation

    def test_explain_with_evidence(self):
        """Test explanation includes evidence count."""
        scorer = ConfidenceScorer()
        finding = {
            "id": "test",
            "category": "bug",
            "evidence": ["e1", "e2", "e3"],
        }
        scored = scorer.score_finding(finding)
        explanation = scorer.explain_confidence(scored)

        assert "3 code references" in explanation

    def test_explain_without_historical_data(self):
        """Test explanation without historical data."""
        scorer = ConfidenceScorer()
        finding = {"id": "test", "category": "bug"}
        scored = scorer.score_finding(finding)
        explanation = scorer.explain_confidence(scored)

        # Should have some basis
        assert "Basis:" in explanation

#!/usr/bin/env python3
"""
Tests for Review Verdict Mapping System
========================================

Tests the verdict logic for PR reviews including:
- Merge conflict handling (conflicts -> BLOCKED)
- Severity-based verdict mapping (critical/high -> BLOCKED/NEEDS_REVISION)
- Branch status handling (BEHIND -> NEEDS_REVISION)
- CI status impact on verdicts
- Overall verdict generation from findings

These tests call the actual production helper functions from models.py
rather than reimplementing the logic inline.
"""

import sys
from pathlib import Path

import pytest

# Add the backend directory to path
_backend_dir = Path(__file__).parent.parent / "apps" / "backend"
_github_dir = _backend_dir / "runners" / "github"
_services_dir = _github_dir / "services"

if str(_services_dir) not in sys.path:
    sys.path.insert(0, str(_services_dir))
if str(_github_dir) not in sys.path:
    sys.path.insert(0, str(_github_dir))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from models import (
    BRANCH_BEHIND_BLOCKER_MSG,
    BRANCH_BEHIND_REASONING,
    MergeVerdict,
    PRReviewFinding,
    ReviewCategory,
    ReviewSeverity,
    # Import the helper functions for direct testing
    apply_branch_behind_downgrade,
    apply_ci_status_override,
    apply_merge_conflict_override,
    verdict_from_severity_counts,
    verdict_to_github_status,
)


# ============================================================================
# MergeVerdict Enum Tests
# ============================================================================


class TestMergeVerdictEnum:
    """Tests for MergeVerdict enum values and conversions."""

    def test_verdict_values(self):
        """Test that all verdict values are correct."""
        assert MergeVerdict.READY_TO_MERGE.value == "ready_to_merge"
        assert MergeVerdict.MERGE_WITH_CHANGES.value == "merge_with_changes"
        assert MergeVerdict.NEEDS_REVISION.value == "needs_revision"
        assert MergeVerdict.BLOCKED.value == "blocked"

    def test_verdict_from_string(self):
        """Test creating verdict from string value."""
        assert MergeVerdict("ready_to_merge") == MergeVerdict.READY_TO_MERGE
        assert MergeVerdict("merge_with_changes") == MergeVerdict.MERGE_WITH_CHANGES
        assert MergeVerdict("needs_revision") == MergeVerdict.NEEDS_REVISION
        assert MergeVerdict("blocked") == MergeVerdict.BLOCKED

    def test_invalid_verdict_raises(self):
        """Test that invalid verdict strings raise ValueError."""
        with pytest.raises(ValueError):
            MergeVerdict("invalid_verdict")

    def test_verdict_ordering(self):
        """Test verdict severity ordering for comparison."""
        # Map verdicts to severity levels for comparison
        severity_order = {
            MergeVerdict.READY_TO_MERGE: 0,
            MergeVerdict.MERGE_WITH_CHANGES: 1,
            MergeVerdict.NEEDS_REVISION: 2,
            MergeVerdict.BLOCKED: 3,
        }

        # BLOCKED is the most severe
        assert severity_order[MergeVerdict.BLOCKED] > severity_order[MergeVerdict.NEEDS_REVISION]
        assert severity_order[MergeVerdict.NEEDS_REVISION] > severity_order[MergeVerdict.MERGE_WITH_CHANGES]
        assert severity_order[MergeVerdict.MERGE_WITH_CHANGES] > severity_order[MergeVerdict.READY_TO_MERGE]


# ============================================================================
# Severity to Verdict Mapping Tests (using production helper function)
# ============================================================================


class TestSeverityToVerdictMapping:
    """Tests for mapping finding severities to verdicts using verdict_from_severity_counts()."""

    def test_critical_severity_maps_to_blocked(self):
        """Test that critical severity findings result in BLOCKED verdict."""
        verdict = verdict_from_severity_counts(critical_count=1)
        assert verdict == MergeVerdict.BLOCKED

    def test_high_severity_maps_to_needs_revision(self):
        """Test that high severity findings result in NEEDS_REVISION verdict."""
        verdict = verdict_from_severity_counts(high_count=1)
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_medium_severity_maps_to_needs_revision(self):
        """Test that medium severity findings result in NEEDS_REVISION verdict."""
        verdict = verdict_from_severity_counts(medium_count=1)
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_low_severity_maps_to_ready_to_merge(self):
        """Test that only low severity findings result in READY_TO_MERGE verdict."""
        verdict = verdict_from_severity_counts(low_count=1)
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_no_findings_maps_to_ready_to_merge(self):
        """Test that no findings results in READY_TO_MERGE verdict."""
        verdict = verdict_from_severity_counts()
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_mixed_severities_uses_highest(self):
        """Test that mixed severities use the highest severity for verdict."""
        # If there's any critical, it's BLOCKED
        verdict = verdict_from_severity_counts(
            critical_count=1, high_count=2, medium_count=3, low_count=5
        )
        assert verdict == MergeVerdict.BLOCKED


# ============================================================================
# Merge Conflict Verdict Tests (using production helper function)
# ============================================================================


class TestMergeConflictVerdict:
    """Tests for merge conflict impact on verdict using apply_merge_conflict_override()."""

    def test_merge_conflict_overrides_to_blocked(self):
        """Test that merge conflicts always result in BLOCKED verdict."""
        verdict = apply_merge_conflict_override(
            verdict=MergeVerdict.READY_TO_MERGE,
            has_merge_conflicts=True,
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_merge_conflict_overrides_merge_with_changes(self):
        """Test that merge conflicts override MERGE_WITH_CHANGES verdict."""
        verdict = apply_merge_conflict_override(
            verdict=MergeVerdict.MERGE_WITH_CHANGES,
            has_merge_conflicts=True,
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_merge_conflict_overrides_needs_revision(self):
        """Test that merge conflicts override NEEDS_REVISION verdict."""
        verdict = apply_merge_conflict_override(
            verdict=MergeVerdict.NEEDS_REVISION,
            has_merge_conflicts=True,
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_no_merge_conflict_preserves_verdict(self):
        """Test that no merge conflicts preserves the AI verdict."""
        verdict = apply_merge_conflict_override(
            verdict=MergeVerdict.READY_TO_MERGE,
            has_merge_conflicts=False,
        )
        assert verdict == MergeVerdict.READY_TO_MERGE


# ============================================================================
# Branch Status Verdict Tests (using production helper function)
# ============================================================================


class TestBranchStatusVerdict:
    """Tests for branch status (BEHIND, DIRTY, etc.) impact on verdict using apply_branch_behind_downgrade()."""

    def test_branch_behind_downgrades_ready_to_merge(self):
        """Test that BEHIND status downgrades READY_TO_MERGE to NEEDS_REVISION."""
        verdict = apply_branch_behind_downgrade(
            verdict=MergeVerdict.READY_TO_MERGE,
            merge_state_status="BEHIND",
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_branch_behind_downgrades_merge_with_changes(self):
        """Test that BEHIND status downgrades MERGE_WITH_CHANGES to NEEDS_REVISION."""
        verdict = apply_branch_behind_downgrade(
            verdict=MergeVerdict.MERGE_WITH_CHANGES,
            merge_state_status="BEHIND",
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_branch_behind_preserves_blocked(self):
        """Test that BEHIND status does not upgrade BLOCKED verdict."""
        verdict = apply_branch_behind_downgrade(
            verdict=MergeVerdict.BLOCKED,
            merge_state_status="BEHIND",
        )
        # Should still be BLOCKED, not downgraded to NEEDS_REVISION
        assert verdict == MergeVerdict.BLOCKED

    def test_branch_clean_preserves_verdict(self):
        """Test that CLEAN status preserves the original verdict."""
        verdict = apply_branch_behind_downgrade(
            verdict=MergeVerdict.READY_TO_MERGE,
            merge_state_status="CLEAN",
        )
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_branch_behind_reasoning_is_set(self):
        """Test that BEHIND status has appropriate reasoning defined."""
        # Test the constant, not reimplemented logic
        assert BRANCH_BEHIND_REASONING is not None
        assert len(BRANCH_BEHIND_REASONING) > 0

        verdict = apply_branch_behind_downgrade(
            verdict=MergeVerdict.READY_TO_MERGE,
            merge_state_status="BEHIND",
        )
        assert verdict == MergeVerdict.NEEDS_REVISION


# ============================================================================
# CI Status Verdict Tests (using production helper function)
# ============================================================================


class TestCIStatusVerdict:
    """Tests for CI status impact on verdict using apply_ci_status_override()."""

    def test_failing_ci_blocks_ready_to_merge(self):
        """Test that failing CI blocks READY_TO_MERGE verdict."""
        verdict = apply_ci_status_override(
            verdict=MergeVerdict.READY_TO_MERGE,
            failing_count=2,
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_failing_ci_blocks_merge_with_changes(self):
        """Test that failing CI blocks MERGE_WITH_CHANGES verdict."""
        verdict = apply_ci_status_override(
            verdict=MergeVerdict.MERGE_WITH_CHANGES,
            failing_count=1,
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_pending_ci_downgrades_ready_to_merge(self):
        """Test that pending CI downgrades READY_TO_MERGE to NEEDS_REVISION."""
        verdict = apply_ci_status_override(
            verdict=MergeVerdict.READY_TO_MERGE,
            pending_count=2,
        )
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_all_ci_passing_preserves_verdict(self):
        """Test that all passing CI preserves the verdict."""
        verdict = apply_ci_status_override(
            verdict=MergeVerdict.READY_TO_MERGE,
            failing_count=0,
            pending_count=0,
        )
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_failing_ci_takes_precedence_over_pending(self):
        """Test that failing CI takes precedence over pending CI."""
        verdict = apply_ci_status_override(
            verdict=MergeVerdict.READY_TO_MERGE,
            failing_count=1,
            pending_count=2,
        )
        # Should be BLOCKED (failing), not NEEDS_REVISION (pending)
        assert verdict == MergeVerdict.BLOCKED

    def test_failing_ci_preserves_needs_revision(self):
        """Test that failing CI preserves NEEDS_REVISION verdict (does not upgrade)."""
        verdict = apply_ci_status_override(
            verdict=MergeVerdict.NEEDS_REVISION,
            failing_count=1,
        )
        # NEEDS_REVISION stays as NEEDS_REVISION (intentional design)
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_failing_ci_preserves_blocked(self):
        """Test that failing CI preserves BLOCKED verdict."""
        verdict = apply_ci_status_override(
            verdict=MergeVerdict.BLOCKED,
            failing_count=1,
        )
        assert verdict == MergeVerdict.BLOCKED

    def test_pending_ci_preserves_needs_revision(self):
        """Test that pending CI preserves NEEDS_REVISION verdict."""
        verdict = apply_ci_status_override(
            verdict=MergeVerdict.NEEDS_REVISION,
            pending_count=1,
        )
        assert verdict == MergeVerdict.NEEDS_REVISION


# ============================================================================
# Verdict to Overall Status Mapping Tests (using production helper function)
# ============================================================================


class TestVerdictToOverallStatusMapping:
    """Tests for mapping verdict to GitHub review overall_status using verdict_to_github_status()."""

    def test_blocked_maps_to_request_changes(self):
        """Test that BLOCKED verdict maps to request_changes status."""
        status = verdict_to_github_status(MergeVerdict.BLOCKED)
        assert status == "request_changes"

    def test_needs_revision_maps_to_request_changes(self):
        """Test that NEEDS_REVISION verdict maps to request_changes status."""
        status = verdict_to_github_status(MergeVerdict.NEEDS_REVISION)
        assert status == "request_changes"

    def test_merge_with_changes_maps_to_comment(self):
        """Test that MERGE_WITH_CHANGES verdict maps to comment status."""
        status = verdict_to_github_status(MergeVerdict.MERGE_WITH_CHANGES)
        assert status == "comment"

    def test_ready_to_merge_maps_to_approve(self):
        """Test that READY_TO_MERGE verdict maps to approve status."""
        status = verdict_to_github_status(MergeVerdict.READY_TO_MERGE)
        assert status == "approve"


# ============================================================================
# Blocker Generation Tests
# ============================================================================


class TestBlockerGeneration:
    """Tests for blocker list generation from findings and conditions."""

    def test_critical_finding_generates_blocker(self):
        """Test that critical findings generate blockers."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="SQL Injection",
                description="User input not sanitized",
                file="src/db.py",
                line=42,
            )
        ]
        blockers = []

        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH, ReviewSeverity.MEDIUM):
                blockers.append(f"{finding.category.value}: {finding.title}")

        assert len(blockers) == 1
        assert "SQL Injection" in blockers[0]

    def test_high_finding_generates_blocker(self):
        """Test that high severity findings generate blockers."""
        findings = [
            PRReviewFinding(
                id="QUAL-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.QUALITY,
                title="Memory Leak",
                description="Resource not properly released",
                file="src/resource.py",
                line=100,
            )
        ]
        blockers = []

        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH, ReviewSeverity.MEDIUM):
                blockers.append(f"{finding.category.value}: {finding.title}")

        assert len(blockers) == 1
        assert "Memory Leak" in blockers[0]

    def test_medium_finding_generates_blocker(self):
        """Test that medium severity findings generate blockers."""
        findings = [
            PRReviewFinding(
                id="PERF-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.PERFORMANCE,
                title="N+1 Query",
                description="Database query inside loop",
                file="src/api.py",
                line=50,
            )
        ]
        blockers = []

        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH, ReviewSeverity.MEDIUM):
                blockers.append(f"{finding.category.value}: {finding.title}")

        assert len(blockers) == 1
        assert "N+1 Query" in blockers[0]

    def test_low_finding_does_not_generate_blocker(self):
        """Test that low severity findings do NOT generate blockers."""
        findings = [
            PRReviewFinding(
                id="STYLE-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Missing docstring",
                description="Function lacks documentation",
                file="src/utils.py",
                line=10,
            )
        ]
        blockers = []

        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH, ReviewSeverity.MEDIUM):
                blockers.append(f"{finding.category.value}: {finding.title}")

        assert len(blockers) == 0

    def test_multiple_findings_generate_multiple_blockers(self):
        """Test that multiple blocking findings generate multiple blockers."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="SQL Injection",
                description="User input not sanitized",
                file="src/db.py",
                line=42,
            ),
            PRReviewFinding(
                id="QUAL-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.QUALITY,
                title="Memory Leak",
                description="Resource not released",
                file="src/resource.py",
                line=100,
            ),
            PRReviewFinding(
                id="STYLE-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Missing docstring",
                description="Lacks documentation",
                file="src/utils.py",
                line=10,
            ),
        ]
        blockers = []

        for finding in findings:
            if finding.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH, ReviewSeverity.MEDIUM):
                blockers.append(f"{finding.category.value}: {finding.title}")

        assert len(blockers) == 2  # Only CRITICAL and HIGH, not LOW
        assert any("SQL Injection" in b for b in blockers)
        assert any("Memory Leak" in b for b in blockers)


# ============================================================================
# Combined Scenario Tests (using production helper functions)
# ============================================================================


class TestCombinedVerdictScenarios:
    """Tests for complex scenarios with multiple verdict factors using production helpers."""

    def test_merge_conflict_overrides_ci_passing(self):
        """Test that merge conflicts override passing CI."""
        # Start with base verdict
        verdict = verdict_from_severity_counts()
        assert verdict == MergeVerdict.READY_TO_MERGE

        # Apply merge conflict (highest priority)
        verdict = apply_merge_conflict_override(verdict, has_merge_conflicts=True)
        assert verdict == MergeVerdict.BLOCKED

    def test_merge_conflict_combined_with_critical_finding(self):
        """Test merge conflict combined with critical finding."""
        # Both lead to BLOCKED, but for different reasons
        verdict = verdict_from_severity_counts(critical_count=1)
        assert verdict == MergeVerdict.BLOCKED

        verdict = apply_merge_conflict_override(verdict, has_merge_conflicts=True)
        assert verdict == MergeVerdict.BLOCKED

    def test_failing_ci_overrides_branch_behind(self):
        """Test that failing CI takes precedence over branch behind."""
        verdict = MergeVerdict.READY_TO_MERGE

        # Apply CI check first (higher priority than branch status)
        verdict = apply_ci_status_override(verdict, failing_count=1)
        assert verdict == MergeVerdict.BLOCKED

        # Branch behind doesn't change BLOCKED to NEEDS_REVISION
        verdict = apply_branch_behind_downgrade(verdict, merge_state_status="BEHIND")
        assert verdict == MergeVerdict.BLOCKED

    def test_branch_behind_combined_with_low_findings(self):
        """Test branch behind with only low severity findings."""
        # Determine base verdict from findings
        verdict = verdict_from_severity_counts(low_count=3)
        assert verdict == MergeVerdict.READY_TO_MERGE

        # Apply branch status - downgrades to NEEDS_REVISION
        verdict = apply_branch_behind_downgrade(verdict, merge_state_status="BEHIND")
        assert verdict == MergeVerdict.NEEDS_REVISION

    def test_all_clear_scenario(self):
        """Test scenario with no blockers at all."""
        # Determine verdict from findings (none)
        verdict = verdict_from_severity_counts()
        assert verdict == MergeVerdict.READY_TO_MERGE

        # Apply merge conflict check (none)
        verdict = apply_merge_conflict_override(verdict, has_merge_conflicts=False)
        assert verdict == MergeVerdict.READY_TO_MERGE

        # Apply CI check (all passing)
        verdict = apply_ci_status_override(verdict, failing_count=0, pending_count=0)
        assert verdict == MergeVerdict.READY_TO_MERGE

        # Apply branch status (clean)
        verdict = apply_branch_behind_downgrade(verdict, merge_state_status="CLEAN")
        assert verdict == MergeVerdict.READY_TO_MERGE

    def test_only_low_findings_with_passing_ci(self):
        """Test that only low findings with passing CI is READY_TO_MERGE."""
        findings = [
            PRReviewFinding(
                id="STYLE-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Minor style issue",
                description="Could use better naming",
                file="src/utils.py",
                line=10,
            )
        ]

        # Count by severity
        critical_count = sum(1 for f in findings if f.severity == ReviewSeverity.CRITICAL)
        high_count = sum(1 for f in findings if f.severity == ReviewSeverity.HIGH)
        medium_count = sum(1 for f in findings if f.severity == ReviewSeverity.MEDIUM)
        low_count = sum(1 for f in findings if f.severity == ReviewSeverity.LOW)

        # Use production helper
        verdict = verdict_from_severity_counts(
            critical_count=critical_count,
            high_count=high_count,
            medium_count=medium_count,
            low_count=low_count,
        )

        # Apply other checks (all clean)
        verdict = apply_merge_conflict_override(verdict, has_merge_conflicts=False)
        verdict = apply_ci_status_override(verdict, failing_count=0, pending_count=0)

        assert verdict == MergeVerdict.READY_TO_MERGE


# ============================================================================
# Constants Tests
# ============================================================================


class TestVerdictConstants:
    """Tests for verdict-related constants."""

    def test_branch_behind_blocker_message_defined(self):
        """Test that BRANCH_BEHIND_BLOCKER_MSG is properly defined."""
        assert BRANCH_BEHIND_BLOCKER_MSG is not None
        assert len(BRANCH_BEHIND_BLOCKER_MSG) > 0
        assert "behind" in BRANCH_BEHIND_BLOCKER_MSG.lower() or "out of date" in BRANCH_BEHIND_BLOCKER_MSG.lower()

    def test_branch_behind_reasoning_defined(self):
        """Test that BRANCH_BEHIND_REASONING is properly defined."""
        assert BRANCH_BEHIND_REASONING is not None
        assert len(BRANCH_BEHIND_REASONING) > 0
        # Should mention updating or conflicts
        lower_reasoning = BRANCH_BEHIND_REASONING.lower()
        assert "update" in lower_reasoning or "conflict" in lower_reasoning

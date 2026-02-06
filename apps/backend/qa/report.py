"""
QA Report Generation & Issue Tracking
======================================

Handles iteration history tracking, recurring issue detection,
and report generation.
"""

import json
from collections import Counter
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from .criteria import load_implementation_plan, save_implementation_plan

# Configuration
RECURRING_ISSUE_THRESHOLD = 3  # Escalate if same issue appears this many times
ISSUE_SIMILARITY_THRESHOLD = 0.8  # Consider issues "same" if similarity >= this


# =============================================================================
# ITERATION TRACKING
# =============================================================================


def get_iteration_history(spec_dir: Path) -> list[dict[str, Any]]:
    """
    Get the full iteration history from implementation_plan.json.

    Returns:
        List of iteration records with issues, timestamps, and outcomes.
    """
    plan = load_implementation_plan(spec_dir)
    if not plan:
        return []
    return plan.get("qa_iteration_history", [])


def record_iteration(
    spec_dir: Path,
    iteration: int,
    status: str,
    issues: list[dict[str, Any]],
    duration_seconds: float | None = None,
) -> bool:
    """
    Record a QA iteration to the history.

    Args:
        spec_dir: Spec directory
        iteration: Iteration number
        status: "approved", "rejected", or "error"
        issues: List of issues found (empty if approved)
        duration_seconds: Optional duration of the iteration

    Returns:
        True if recorded successfully
    """
    plan = load_implementation_plan(spec_dir)
    if not plan:
        plan = {}

    if "qa_iteration_history" not in plan:
        plan["qa_iteration_history"] = []

    record = {
        "iteration": iteration,
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "issues": issues,
    }
    if duration_seconds is not None:
        record["duration_seconds"] = round(duration_seconds, 2)

    plan["qa_iteration_history"].append(record)

    # Update summary stats
    if "qa_stats" not in plan:
        plan["qa_stats"] = {}

    plan["qa_stats"]["total_iterations"] = len(plan["qa_iteration_history"])
    plan["qa_stats"]["last_iteration"] = iteration
    plan["qa_stats"]["last_status"] = status

    # Count issues by type
    issue_types = Counter()
    for rec in plan["qa_iteration_history"]:
        for issue in rec.get("issues", []):
            issue_type = issue.get("type", "unknown")
            issue_types[issue_type] += 1
    plan["qa_stats"]["issues_by_type"] = dict(issue_types)

    return save_implementation_plan(spec_dir, plan)


# =============================================================================
# RECURRING ISSUE DETECTION
# =============================================================================


def _normalize_issue_key(issue: dict[str, Any]) -> str:
    """
    Create a normalized key for issue comparison.

    Combines title and file location for identifying "same" issues.
    """
    title = (issue.get("title") or "").lower().strip()
    file = (issue.get("file") or "").lower().strip()
    line = issue.get("line") or ""

    # Remove common prefixes/suffixes that might differ between iterations
    for prefix in ["error:", "issue:", "bug:", "fix:"]:
        if title.startswith(prefix):
            title = title[len(prefix) :].strip()

    return f"{title}|{file}|{line}"


def _issue_similarity(issue1: dict[str, Any], issue2: dict[str, Any]) -> float:
    """
    Calculate similarity between two issues.

    Uses title similarity and location matching.

    Returns:
        Similarity score between 0.0 and 1.0
    """
    key1 = _normalize_issue_key(issue1)
    key2 = _normalize_issue_key(issue2)

    return SequenceMatcher(None, key1, key2).ratio()


def has_recurring_issues(
    current_issues: list[dict[str, Any]],
    history: list[dict[str, Any]],
    threshold: int = RECURRING_ISSUE_THRESHOLD,
) -> tuple[bool, list[dict[str, Any]]]:
    """
    Check if any current issues have appeared repeatedly in history.

    Args:
        current_issues: Issues from current iteration
        history: Previous iteration records
        threshold: Number of occurrences to consider "recurring"

    Returns:
        (has_recurring, recurring_issues) tuple
    """
    # Flatten all historical issues
    historical_issues = []
    for record in history:
        historical_issues.extend(record.get("issues", []))

    if not historical_issues:
        return False, []

    recurring = []

    for current in current_issues:
        occurrence_count = 1  # Count current occurrence

        for historical in historical_issues:
            similarity = _issue_similarity(current, historical)
            if similarity >= ISSUE_SIMILARITY_THRESHOLD:
                occurrence_count += 1

        if occurrence_count >= threshold:
            recurring.append(
                {
                    **current,
                    "occurrence_count": occurrence_count,
                }
            )

    return len(recurring) > 0, recurring


def get_recurring_issue_summary(
    history: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Analyze iteration history for issue patterns.

    Returns:
        Summary with most common issues, fix success rate, etc.
    """
    all_issues = []
    for record in history:
        all_issues.extend(record.get("issues", []))

    if not all_issues:
        return {"total_issues": 0, "unique_issues": 0, "most_common": []}

    # Group similar issues
    issue_groups: dict[str, list[dict[str, Any]]] = {}

    for issue in all_issues:
        key = _normalize_issue_key(issue)
        matched = False

        for existing_key in issue_groups:
            if (
                SequenceMatcher(None, key, existing_key).ratio()
                >= ISSUE_SIMILARITY_THRESHOLD
            ):
                issue_groups[existing_key].append(issue)
                matched = True
                break

        if not matched:
            issue_groups[key] = [issue]

    # Find most common issues
    sorted_groups = sorted(issue_groups.items(), key=lambda x: len(x[1]), reverse=True)

    most_common = []
    for key, issues in sorted_groups[:5]:  # Top 5
        most_common.append(
            {
                "title": issues[0].get("title", key),
                "file": issues[0].get("file"),
                "occurrences": len(issues),
            }
        )

    # Calculate statistics
    approved_count = sum(1 for r in history if r.get("status") == "approved")
    rejected_count = sum(1 for r in history if r.get("status") == "rejected")

    return {
        "total_issues": len(all_issues),
        "unique_issues": len(issue_groups),
        "most_common": most_common,
        "iterations_approved": approved_count,
        "iterations_rejected": rejected_count,
        "fix_success_rate": approved_count / len(history) if history else 0,
    }


# =============================================================================
# ESCALATION & MANUAL TEST PLANS
# =============================================================================


async def escalate_to_human(
    spec_dir: Path,
    recurring_issues: list[dict[str, Any]],
    iteration: int,
) -> None:
    """
    Create human escalation file for recurring issues.

    Args:
        spec_dir: Spec directory
        recurring_issues: Issues that have recurred
        iteration: Current iteration number
    """
    from .loop import MAX_QA_ITERATIONS

    history = get_iteration_history(spec_dir)
    summary = get_recurring_issue_summary(history)

    escalation_file = spec_dir / "QA_ESCALATION.md"

    content = f"""# QA Escalation - Human Intervention Required

**Generated**: {datetime.now(timezone.utc).isoformat()}
**Iteration**: {iteration}/{MAX_QA_ITERATIONS}
**Reason**: Recurring issues detected ({RECURRING_ISSUE_THRESHOLD}+ occurrences)

## Summary

- **Total QA Iterations**: {len(history)}
- **Total Issues Found**: {summary["total_issues"]}
- **Unique Issues**: {summary["unique_issues"]}
- **Fix Success Rate**: {summary["fix_success_rate"]:.1%}

## Recurring Issues

These issues have appeared {RECURRING_ISSUE_THRESHOLD}+ times without being resolved:

"""

    for i, issue in enumerate(recurring_issues, 1):
        content += f"""### {i}. {issue.get("title", "Unknown Issue")}

- **File**: {issue.get("file", "N/A")}
- **Line**: {issue.get("line", "N/A")}
- **Type**: {issue.get("type", "N/A")}
- **Occurrences**: {issue.get("occurrence_count", "N/A")}
- **Description**: {issue.get("description", "No description")}

"""

    content += """## Most Common Issues (All Time)

"""
    for issue in summary.get("most_common", []):
        content += f"- **{issue['title']}** ({issue['occurrences']} occurrences)"
        if issue.get("file"):
            content += f" in `{issue['file']}`"
        content += "\n"

    content += """

## Recommended Actions

1. Review the recurring issues manually
2. Check if the issue stems from:
   - Unclear specification
   - Complex edge case
   - Infrastructure/environment problem
   - Test framework limitations
3. Update the spec or acceptance criteria if needed
4. Run QA manually after making changes: `python run.py --spec {spec} --qa`

## Related Files

- `QA_FIX_REQUEST.md` - Latest fix request
- `qa_report.md` - Latest QA report
- `implementation_plan.json` - Full iteration history
"""

    escalation_file.write_text(content, encoding="utf-8")
    print(f"\n📝 Escalation file created: {escalation_file}")


def create_manual_test_plan(spec_dir: Path, spec_name: str) -> Path:
    """
    Create a manual test plan when automated testing isn't possible.

    Args:
        spec_dir: Spec directory
        spec_name: Name of the spec

    Returns:
        Path to created manual test plan
    """
    manual_plan_file = spec_dir / "MANUAL_TEST_PLAN.md"

    # Read spec if available for context
    spec_file = spec_dir / "spec.md"
    spec_content = ""
    if spec_file.exists():
        spec_content = spec_file.read_text(encoding="utf-8")

    # Extract acceptance criteria from spec if present
    acceptance_criteria = []
    if "## Acceptance Criteria" in spec_content:
        in_criteria = False
        for line in spec_content.split("\n"):
            if "## Acceptance Criteria" in line:
                in_criteria = True
                continue
            if in_criteria and line.startswith("## "):
                break
            if in_criteria and line.strip().startswith("- "):
                acceptance_criteria.append(line.strip()[2:])

    content = f"""# Manual Test Plan - {spec_name}

**Generated**: {datetime.now(timezone.utc).isoformat()}
**Reason**: No automated test framework detected

## Overview

This project does not have automated testing infrastructure. Please perform
manual verification of the implementation using the checklist below.

## Pre-Test Setup

1. [ ] Ensure all dependencies are installed
2. [ ] Start any required services
3. [ ] Set up test environment variables

## Acceptance Criteria Verification

"""

    if acceptance_criteria:
        for i, criterion in enumerate(acceptance_criteria, 1):
            content += f"{i}. [ ] {criterion}\n"
    else:
        content += """1. [ ] Core functionality works as expected
2. [ ] Edge cases are handled
3. [ ] Error states are handled gracefully
4. [ ] UI/UX meets requirements (if applicable)
"""

    content += """

## Functional Tests

### Happy Path
- [ ] Primary use case works correctly
- [ ] Expected outputs are generated
- [ ] No console errors

### Edge Cases
- [ ] Empty input handling
- [ ] Invalid input handling
- [ ] Boundary conditions

### Error Handling
- [ ] Errors display appropriate messages
- [ ] System recovers gracefully from errors
- [ ] No data loss on failure

## Non-Functional Tests

### Performance
- [ ] Response time is acceptable
- [ ] No memory leaks observed
- [ ] No excessive resource usage

### Security
- [ ] Input is properly sanitized
- [ ] No sensitive data exposed
- [ ] Authentication works correctly (if applicable)

## Browser/Environment Testing (if applicable)

- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Mobile viewport

## Sign-off

**Tester**: _______________
**Date**: _______________
**Result**: [ ] PASS  [ ] FAIL

### Notes
_Add any observations or issues found during testing_

"""

    manual_plan_file.write_text(content, encoding="utf-8")
    return manual_plan_file


# =============================================================================
# NO-TEST PROJECT DETECTION
# =============================================================================


def check_test_discovery(spec_dir: Path) -> dict[str, Any] | None:
    """
    Check if test discovery has been run and what frameworks were found.

    Returns:
        Test discovery result or None if not run
    """
    discovery_file = spec_dir / "test_discovery.json"
    if not discovery_file.exists():
        return None

    try:
        with open(discovery_file, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def is_no_test_project(spec_dir: Path, project_dir: Path) -> bool:
    """
    Determine if this is a project with no test infrastructure.

    Checks test_discovery.json if available, otherwise scans project.

    Returns:
        True if no test frameworks detected
    """
    # Check cached discovery first
    discovery = check_test_discovery(spec_dir)
    if discovery:
        frameworks = discovery.get("frameworks", [])
        return len(frameworks) == 0

    # If no discovery file, check common test indicators
    test_indicators = [
        "pytest.ini",
        "pyproject.toml",
        "setup.cfg",
        "jest.config.js",
        "jest.config.ts",
        "vitest.config.js",
        "vitest.config.ts",
        "karma.conf.js",
        "cypress.config.js",
        "playwright.config.ts",
        ".rspec",
        "spec/spec_helper.rb",
    ]

    test_dirs = ["tests", "test", "__tests__", "spec"]

    # Check for test config files
    for indicator in test_indicators:
        if (project_dir / indicator).exists():
            return False

    # Check for test directories
    for test_dir in test_dirs:
        test_path = project_dir / test_dir
        if test_path.exists() and test_path.is_dir():
            # Check if directory has test files
            for f in test_path.iterdir():
                if f.is_file() and (
                    f.name.startswith("test_")
                    or f.name.endswith("_test.py")
                    or f.name.endswith(".spec.js")
                    or f.name.endswith(".spec.ts")
                    or f.name.endswith(".test.js")
                    or f.name.endswith(".test.ts")
                ):
                    return False

    return True

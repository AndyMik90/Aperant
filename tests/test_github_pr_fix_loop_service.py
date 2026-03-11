#!/usr/bin/env python3
"""
Tests for PR fix loop service helpers and idempotency guards.
"""

import subprocess
from pathlib import Path

import pytest

from runners.github.models import (
    GitHubRunnerConfig,
    PRReviewFinding,
    PRReviewResult,
    ReviewCategory,
    ReviewSeverity,
)
from runners.github.services.pr_fix_loop_service import (
    PRFixLoopService,
    build_attempt_signature,
    find_protected_files,
    select_fix_candidates,
)


def create_finding(
    finding_id: str,
    *,
    severity: ReviewSeverity = ReviewSeverity.MEDIUM,
    category: ReviewCategory = ReviewCategory.QUALITY,
    fixable: bool = True,
) -> PRReviewFinding:
    return PRReviewFinding(
        id=finding_id,
        severity=severity,
        category=category,
        title=f"Finding {finding_id}",
        description="Test finding",
        file="src/example.ts",
        line=10,
        fixable=fixable,
    )


def create_review(head_sha: str, findings: list[PRReviewFinding]) -> PRReviewResult:
    return PRReviewResult(
        pr_number=123,
        repo="owner/repo",
        success=True,
        findings=findings,
        summary="Test review",
        overall_status="request_changes",
        reviewed_commit_sha=head_sha,
    )


def test_select_fix_candidates_filters_to_low_risk_fixable_items():
    review = create_review(
        "abc123",
        [
            create_finding("quality-medium"),
            create_finding(
                "security-high",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
            ),
            create_finding(
                "style-low",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
            ),
            create_finding("test-unfixable", category=ReviewCategory.TEST, fixable=False),
        ],
    )

    candidates, skipped = select_fix_candidates(review, "medium")

    assert [finding.id for finding in candidates] == ["quality-medium"]
    assert skipped == ["security-high", "style-low", "test-unfixable"]


def test_attempt_signature_changes_with_comment_fingerprints():
    candidates = [create_finding("a"), create_finding("b")]

    base_signature = build_attempt_signature("abc123", candidates, ["review:1"])
    changed_signature = build_attempt_signature("abc123", candidates, ["review:1", "review:2"])

    assert base_signature != changed_signature
    assert base_signature == build_attempt_signature("abc123", candidates, ["review:1"])


def test_find_protected_files_detects_sensitive_paths():
    protected = find_protected_files(
        [
            ".env",
            ".github/workflows/ci.yml",
            "package-lock.json",
            "src/app.ts",
        ]
    )

    assert protected == [".env", ".github/workflows/ci.yml", "package-lock.json"]


@pytest.mark.asyncio
async def test_fix_pr_returns_noop_for_repeated_attempt_signature(temp_git_repo: Path):
    repo = temp_git_repo
    (repo / ".gitignore").write_text(".auto-claude/\n", encoding="utf-8")
    subprocess.run(["git", "add", ".gitignore"], cwd=repo, capture_output=True, check=True)
    subprocess.run(
        ["git", "commit", "-m", "Ignore Auto-Claude runtime state"],
        cwd=repo,
        capture_output=True,
        check=True,
    )

    github_dir = repo / ".auto-claude" / "github"
    github_dir.mkdir(parents=True, exist_ok=True)

    head_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    review = create_review(head_sha, [create_finding("quality-medium")])
    await review.save(github_dir)

    service = PRFixLoopService(
        project_dir=repo,
        github_dir=github_dir,
        config=GitHubRunnerConfig(token="token", repo="owner/repo"),
    )

    async def fake_collect_comment_context(_pr_number: int, _since_timestamp: str):
        return "No new comments.", {"review_comments": 0, "issue_comments": 0, "reviews": 0}, []

    service._collect_comment_context = fake_collect_comment_context  # type: ignore[method-assign]

    signature = build_attempt_signature(head_sha, [create_finding("quality-medium")], [])
    result = await service.fix_pr(123, severity_threshold="medium", last_attempt_signature=signature)

    assert result.status == "noop"
    assert result.attempt_signature == signature
    assert result.reason.startswith("This fix attempt matches the previous signature")

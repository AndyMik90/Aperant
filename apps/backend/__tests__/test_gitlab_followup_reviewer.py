"""
Unit Tests for GitLab Follow-up MR Reviewer
============================================

Tests for FollowupReviewer class.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from runners.gitlab.models import (
    AutoFixState,
    AutoFixStatus,
    MergeVerdict,
    MRReviewFinding,
    MRReviewResult,
    ReviewCategory,
    ReviewSeverity,
)
from runners.gitlab.services.followup_reviewer import FollowupReviewer


@pytest.fixture
def mock_client():
    """Create a mock GitLab client."""
    client = MagicMock()
    client.get_mr_async = AsyncMock()
    client.get_mr_notes_async = AsyncMock()
    return client


@pytest.fixture
def sample_previous_review():
    """Create a sample previous review result."""
    return MRReviewResult(
        mr_iid=123,
        project="namespace/project",
        success=True,
        findings=[
            MRReviewFinding(
                id="finding-1",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection vulnerability",
                description="User input not sanitized",
                file="src/api/users.py",
                line=42,
                suggested_fix="Use parameterized queries",
                fixable=True,
            ),
            MRReviewFinding(
                id="finding-2",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Missing error handling",
                description="No try-except around file I/O",
                file="src/utils/file.py",
                line=15,
                suggested_fix="Add error handling",
                fixable=True,
            ),
        ],
        summary="Found 2 issues",
        overall_status="request_changes",
        verdict=MergeVerdict.NEEDS_REVISION,
        verdict_reasoning="High severity issues must be resolved",
        reviewed_commit_sha="abc123def456",
        reviewed_file_blobs={"src/api/users.py": "blob1", "src/utils/file.py": "blob2"},
    )


@pytest.fixture
def reviewer(sample_previous_review):
    """Create a FollowupReviewer instance."""
    return FollowupReviewer(
        project_dir="/tmp/project",
        gitlab_dir="/tmp/project/.auto-claude/gitlab",
        config=MagicMock(project="namespace/project"),
        progress_callback=None,
        use_ai=False,
    )


@pytest.mark.asyncio
async def test_review_followup_finding_resolved(
    reviewer, mock_client, sample_previous_review
):
    """Test that resolved findings are detected."""
    from runners.gitlab.models import FollowupMRContext

    # Create context where one finding was resolved
    context = FollowupMRContext(
        mr_iid=123,
        previous_review=sample_previous_review,
        previous_commit_sha="abc123def456",
        current_commit_sha="def456abc123",
        commits_since_review=[
            {"id": "commit1", "message": "Fix SQL injection"},
        ],
        files_changed_since_review=["src/api/users.py"],
        diff_since_review="diff --git a/src/api/users.py b/src/api/users.py\n"
        "@@ -40,7 +40,7 @@\n"
        "-        query = f\"SELECT * FROM users WHERE name='{name}'\"\n"
        '+        query = "SELECT * FROM users WHERE name=%s"\n'
        "         cursor.execute(query, (name,))",
    )

    mock_client.get_mr_notes_async.return_value = []

    result = await reviewer.review_followup(context, mock_client)

    assert result.mr_iid == 123
    assert len(result.resolved_findings) > 0
    assert len(result.unresolved_findings) < 2  # At least one resolved


@pytest.mark.asyncio
async def test_review_followup_finding_unresolved(
    reviewer, mock_client, sample_previous_review
):
    """Test that unresolved findings are tracked."""
    from runners.gitlab.models import FollowupMRContext

    # Create context where findings were not addressed
    context = FollowupMRContext(
        mr_iid=123,
        previous_review=sample_previous_review,
        previous_commit_sha="abc123def456",
        current_commit_sha="def456abc123",
        commits_since_review=[
            {"id": "commit1", "message": "Update docs"},
        ],
        files_changed_since_review=["README.md"],
        diff_since_review="diff --git a/README.md b/README.md\n+ # Updated docs",
    )

    mock_client.get_mr_notes_async.return_value = []

    result = await reviewer.review_followup(context, mock_client)

    assert result.mr_iid == 123
    assert len(result.unresolved_findings) == 2  # Both still unresolved


@pytest.mark.asyncio
async def test_review_followup_new_findings(
    reviewer, mock_client, sample_previous_review
):
    """Test that new issues are detected."""
    from runners.gitlab.models import FollowupMRContext

    # Create context with TODO comment in diff
    context = FollowupMRContext(
        mr_iid=123,
        previous_review=sample_previous_review,
        previous_commit_sha="abc123def456",
        current_commit_sha="def456abc123",
        commits_since_review=[
            {"id": "commit1", "message": "Add feature"},
        ],
        files_changed_since_review=["src/feature.py"],
        diff_since_review="diff --git a/src/feature.py b/src/feature.py\n"
        "--- a/src/feature.py\n"
        "+++ b/src/feature.py\n"
        "@@ -0,0 +1,3 @@\n"
        "+ # TODO: implement error handling\n"
        "+ def feature():\n"
        "+     pass",
    )

    mock_client.get_mr_notes_async.return_value = []

    result = await reviewer.review_followup(context, mock_client)

    # Should detect TODO as new finding
    assert any(
        f.id.startswith("followup-todo-") and "todo" in f.title.lower()
        for f in result.findings
    )


@pytest.mark.asyncio
async def test_determine_verdict_critical_blocks(reviewer, sample_previous_review):
    """Test that critical issues block merge."""
    new_findings = [
        MRReviewFinding(
            id="new-1",
            severity=ReviewSeverity.CRITICAL,
            category=ReviewCategory.SECURITY,
            title="Critical security issue",
            description="Must fix",
            file="src/file.py",
            line=1,
        )
    ]

    verdict = reviewer._determine_verdict(
        unresolved=[],
        new_findings=new_findings,
        mr_iid=123,
    )

    assert verdict == MergeVerdict.BLOCKED


@pytest.mark.asyncio
async def test_determine_verdict_high_needs_revision(reviewer, sample_previous_review):
    """Test that high issues require revision."""
    new_findings = [
        MRReviewFinding(
            id="new-1",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="High severity issue",
            description="Should fix",
            file="src/file.py",
            line=1,
        )
    ]

    verdict = reviewer._determine_verdict(
        unresolved=[],
        new_findings=new_findings,
        mr_iid=123,
    )

    assert verdict == MergeVerdict.NEEDS_REVISION


@pytest.mark.asyncio
async def test_determine_verdict_medium_merge_with_changes(
    reviewer, sample_previous_review
):
    """Test that medium issues suggest merge with changes."""
    new_findings = [
        MRReviewFinding(
            id="new-1",
            severity=ReviewSeverity.MEDIUM,
            category=ReviewCategory.QUALITY,
            title="Medium issue",
            description="Nice to fix",
            file="src/file.py",
            line=1,
        )
    ]

    verdict = reviewer._determine_verdict(
        unresolved=[],
        new_findings=new_findings,
        mr_iid=123,
    )

    assert verdict == MergeVerdict.MERGE_WITH_CHANGES


@pytest.mark.asyncio
async def test_determine_verdict_ready_to_merge(reviewer, sample_previous_review):
    """Test that low or no issues allow merge."""
    new_findings = [
        MRReviewFinding(
            id="new-1",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.STYLE,
            title="Style issue",
            description="Optional fix",
            file="src/file.py",
            line=1,
        )
    ]

    verdict = reviewer._determine_verdict(
        unresolved=[],
        new_findings=new_findings,
        mr_iid=123,
    )

    assert verdict == MergeVerdict.READY_TO_MERGE


@pytest.mark.asyncio
async def test_determine_verdict_all_clear(reviewer, sample_previous_review):
    """Test that no issues allows merge."""
    verdict = reviewer._determine_verdict(
        unresolved=[],
        new_findings=[],
        mr_iid=123,
    )

    assert verdict == MergeVerdict.READY_TO_MERGE


def test_is_finding_addressed_file_changed(reviewer, sample_previous_review):
    """Test finding detection when file is changed in the diff region."""
    diff = (
        "diff --git a/src/api/users.py b/src/api/users.py\n"
        "@@ -40,7 +40,7 @@\n"
        "-        query = f\"SELECT * FROM users WHERE name='{name}'\"\n"
        '+        query = "SELECT * FROM users WHERE name=%s"\n'
        "         cursor.execute(query, (name,))"
    )

    finding = sample_previous_review.findings[0]  # Line 42 in users.py

    result = reviewer._is_finding_addressed(diff, finding)

    assert result is True  # Line 42 is in the changed range (40-47)


def test_is_finding_addressed_file_not_changed(reviewer, sample_previous_review):
    """Test finding detection when file is not in diff."""
    diff = "diff --git a/README.md b/README.md\n+ # Updated docs"

    finding = sample_previous_review.findings[0]  # users.py

    result = reviewer._is_finding_addressed(diff, finding)

    assert result is False


def test_is_finding_addressed_line_not_in_range(reviewer, sample_previous_review):
    """Test finding detection when line is outside changed range."""
    diff = (
        "diff --git a/src/api/users.py b/src/api/users.py\n"
        "@@ -1,7 +1,7 @@\n"
        " def hello():\n"
        "-    print('hello')\n"
        "+    print('HELLO')\n"
    )

    finding = sample_previous_review.findings[0]  # Line 42, not in range 1-8

    result = reviewer._is_finding_addressed(diff, finding)

    assert result is False


def test_is_finding_addressed_test_pattern_added(reviewer, sample_previous_review):
    """Test finding detection for test category when tests are added."""
    diff = (
        "diff --git a/tests/test_users.py b/tests/test_users.py\n"
        "+ def test_sql_injection():\n"
        "+     assert True"
    )

    test_finding = MRReviewFinding(
        id="test-1",
        severity=ReviewSeverity.MEDIUM,
        category=ReviewCategory.TEST,
        title="Missing tests",
        description="Add tests for users module",
        file="tests/test_users.py",
        line=1,
    )

    result = reviewer._is_finding_addressed(diff, test_finding)

    assert result is True  # Pattern matches "+ def test_"


def test_is_finding_addressed_doc_pattern_added(reviewer, sample_previous_review):
    """Test finding detection for documentation category when docs are added."""
    diff = (
        "diff --git a/src/api/users.py b/src/api/users.py\n"
        '+ """\n'
        "+ User API module.\n"
        '+ """'
    )

    doc_finding = MRReviewFinding(
        id="doc-1",
        severity=ReviewSeverity.LOW,
        category=ReviewCategory.DOCS,
        title="Missing docstring",
        description="Add module docstring",
        file="src/api/users.py",
        line=1,
    )

    result = reviewer._is_finding_addressed(diff, doc_finding)

    assert result is True  # Pattern matches '+"""'


@pytest.mark.asyncio
async def test_review_comment_question_detection(
    reviewer, mock_client, sample_previous_review
):
    """Test that questions in comments are detected."""
    from runners.gitlab.models import FollowupMRContext

    context = FollowupMRContext(
        mr_iid=123,
        previous_review=sample_previous_review,
        previous_commit_sha="abc123def456",
        current_commit_sha="def456abc123",
        commits_since_review=[{"id": "commit1"}],
        files_changed_since_review=[],
        diff_since_review="",
    )

    mock_client.get_mr_notes_async.return_value = [
        {
            "id": 1,
            "commit_id": "commit1",
            "author": {"username": "contributor"},
            "body": "Should we add error handling here?",
            "created_at": "2024-01-01T00:00:00Z",
        },
    ]

    result = await reviewer.review_followup(context, mock_client)

    # Should detect the question
    assert any("question" in f.title.lower() for f in result.findings)


@pytest.mark.asyncio
async def test_review_comment_filters_by_commit(
    reviewer, mock_client, sample_previous_review
):
    """Test that only comments from new commits are reviewed."""
    from runners.gitlab.models import FollowupMRContext

    context = FollowupMRContext(
        mr_iid=123,
        previous_review=sample_previous_review,
        previous_commit_sha="abc123def456",
        current_commit_sha="def456abc123",
        commits_since_review=[{"id": "commit1"}],
        files_changed_since_review=[],
        diff_since_review="",
    )

    mock_client.get_mr_notes_async.return_value = [
        {
            "id": 1,
            "commit_id": "commit1",  # New commit
            "author": {"username": "contributor"},
            "body": "Should we add error handling?",
            "created_at": "2024-01-01T00:00:00Z",
        },
        {
            "id": 2,
            "commit_id": "old-commit",  # Old commit, should be ignored
            "author": {"username": "contributor"},
            "body": "Another question?",
            "created_at": "2024-01-01T00:00:00Z",
        },
    ]

    result = await reviewer.review_followup(context, mock_client)

    # Should only have one finding from the new commit
    question_findings = [f for f in result.findings if "question" in f.title.lower()]
    assert len(question_findings) == 1

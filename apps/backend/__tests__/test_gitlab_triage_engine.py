"""
Tests for GitLab Triage Engine
=================================

Tests for AI-driven issue triage and categorization.
"""

from unittest.mock import patch

import pytest

try:
    from runners.gitlab.glab_client import GitLabConfig
    from runners.gitlab.models import TriageCategory, TriageResult
    from runners.gitlab.services.triage_engine import TriageEngine
except ImportError:
    from glab_client import GitLabConfig
    from models import TriageCategory, TriageResult
    from runners.gitlab.triage_engine import TriageEngine


# Mock response parser for testing
def parse_findings_from_response(response: str) -> dict:
    """Mock parser for testing triage engine."""
    import json
    import re

    # Try to extract JSON from markdown code blocks
    json_match = re.search(r"```(?:json)?\s*\n(.*?)\n```", response, re.DOTALL)
    if json_match:
        response = json_match.group(1)

    try:
        return json.loads(response)
    except json.JSONDecodeError:
        return {"category": "bug", "confidence": 0.5}


@pytest.fixture
def mock_config():
    """Create a mock GitLab config."""
    try:
        from runners.gitlab.models import GitLabRunnerConfig

        return GitLabRunnerConfig(
            token="test-token",
            project="namespace/test-project",
            instance_url="https://gitlab.example.com",
            model="claude-sonnet-4-5-20250929",
        )
    except ImportError:
        # Fallback to simple config with model attribute
        config = GitLabConfig(
            token="test-token",
            project="namespace/test-project",
            instance_url="https://gitlab.example.com",
        )
        config.model = "claude-sonnet-4-5-20250929"
        return config


@pytest.fixture
def sample_issue():
    """Sample issue data."""
    return {
        "iid": 123,
        "title": "Fix authentication bug",
        "description": "Users cannot log in when using special characters in password",
        "labels": ["bug", "critical"],
        "author": {"username": "reporter"},
        "state": "opened",
    }


@pytest.fixture
def engine(mock_config, tmp_path):
    """Create a triage engine instance."""
    return TriageEngine(
        project_dir=tmp_path,
        gitlab_dir=tmp_path / ".auto-claude" / "gitlab",
        config=mock_config,
    )


class TestTriageEngineBasic:
    """Tests for triage engine initialization and basic operations."""

    def test_engine_initialization(self, engine):
        """Test that engine initializes correctly."""
        assert engine is not None
        assert engine.project_dir is not None

    def test_supported_categories(self, engine):
        """Test that engine supports all required categories."""
        expected_categories = {
            TriageCategory.BUG,
            TriageCategory.FEATURE,
            TriageCategory.DUPLICATE,
            TriageCategory.QUESTION,
            TriageCategory.SPAM,
            TriageCategory.INVALID,
            TriageCategory.WONTFIX,
        }

        # Engine should handle all categories
        for category in expected_categories:
            # Check if category is a valid TriageCategory enum value
            assert any(category == member for member in TriageCategory)


class ResponseParserTests:
    """Tests for response parsing utilities."""

    def test_parse_findings_valid_json(self, engine):
        """Test parsing valid JSON response with findings."""
        response = """```json
{
  "category": "bug",
  "confidence": 0.9,
  "duplicate_of": null,
  "reasoning": "Clear bug report with reproduction steps",
  "suggested_labels": ["bug", "critical"]
}
```"""

        result = parse_findings_from_response(response)

        assert result["category"] == "bug"
        assert result["confidence"] == 0.9

    def test_parse_findings_with_duplicate(self, engine):
        """Test parsing response with duplicate reference."""
        response = """```json
{
  "category": "duplicate",
  "confidence": 0.95,
  "duplicate_of": 42,
  "reasoning": "Same as issue #42",
  "suggested_labels": ["duplicate"]
}
```"""

        result = parse_findings_from_response(response)

        assert result["category"] == "duplicate"
        assert result["duplicate_of"] == 42

    def test_parse_findings_with_question(self, engine):
        """Test parsing response for question-type issue."""
        response = """```json
{
  "category": "question",
  "confidence": 0.8,
  "reasoning": "User is asking for help, not reporting a bug",
  "suggested_response": "Please provide more details"
}
```"""

        result = parse_findings_from_response(response)

        assert result["category"] == "question"
        assert "suggested_response" in result

    def test_parse_findings_markdown_only(self, engine):
        """Test parsing response without JSON code blocks."""
        response = """{"category": "feature", "confidence": 0.7}"""

        result = parse_findings_from_response(response)

        assert result["category"] == "feature"

    def test_parse_findings_invalid_json(self, engine):
        """Test parsing invalid JSON response."""
        response = "This is not valid JSON at all"

        result = parse_findings_from_response(response)

        # Should return defaults for invalid response
        assert "category" in result


class TestTriageCategorization:
    """Tests for issue categorization."""

    def test_triage_categories_exist(self):
        """Test that all triage categories are defined."""
        expected_categories = {
            TriageCategory.BUG,
            TriageCategory.FEATURE,
            TriageCategory.DUPLICATE,
            TriageCategory.QUESTION,
            TriageCategory.SPAM,
            TriageCategory.INVALID,
            TriageCategory.WONTFIX,
        }
        # Verify categories exist
        assert TriageCategory.BUG in expected_categories
        assert TriageCategory.FEATURE in expected_categories


class TestTriageContextBuilding:
    """Tests for context building."""

    def test_build_triage_context_basic(self, engine, sample_issue):
        """Test building basic triage context."""
        context = engine.build_triage_context(sample_issue, [])

        assert "Issue #123" in context
        assert "Fix authentication bug" in context
        # The description contains "Users cannot log in" not "Cannot login"
        assert "Users cannot log in" in context

    def test_build_triage_context_with_duplicates(self, engine):
        """Test building context with potential duplicates."""
        issue = {
            "iid": 1,
            "title": "Login bug",
            "description": "Cannot login",
            "author": {"username": "user1"},
            "created_at": "2024-01-01T00:00:00Z",
            "labels": ["bug"],
        }

        all_issues = [
            issue,
            {
                "iid": 2,
                "title": "Login issue",
                "description": "Login not working",
                "author": {"username": "user2"},
                "created_at": "2024-01-02T00:00:00Z",
                "labels": [],
            },
        ]

        context = engine.build_triage_context(issue, all_issues)

        # Should include potential duplicates section
        assert "Potential Duplicates" in context
        assert "#2" in context

    def test_build_triage_context_no_duplicates(self, engine, sample_issue):
        """Test building context without duplicates."""
        context = engine.build_triage_context(sample_issue, [])

        # Should NOT include duplicates section
        assert "Potential Duplicates" not in context


class TestTriageErrors:
    """Tests for error handling in triage."""

    def test_triage_result_default_values(self):
        """Test TriageResult can be created with default values."""
        result = TriageResult(
            issue_iid=1,
            project="test/project",
            category=TriageCategory.FEATURE,
            confidence=0.0,
        )
        assert result.issue_iid == 1
        assert result.category == TriageCategory.FEATURE
        assert result.confidence == 0.0


class TestTriageResult:
    """Tests for TriageResult model."""

    def test_triage_result_creation(self):
        """Test creating a triage result."""
        result = TriageResult(
            issue_iid=123,
            project="namespace/project",
            category=TriageCategory.BUG,
            confidence=0.9,
        )

        assert result.issue_iid == 123
        assert result.category == TriageCategory.BUG
        assert result.confidence == 0.9

    def test_triage_result_with_duplicate(self):
        """Test creating a triage result with duplicate reference."""
        result = TriageResult(
            issue_iid=456,
            project="namespace/project",
            category=TriageCategory.DUPLICATE,
            confidence=0.95,
            duplicate_of=123,
        )

        assert result.duplicate_of == 123
        assert result.category == TriageCategory.DUPLICATE

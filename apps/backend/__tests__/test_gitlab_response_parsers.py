"""
Unit tests for GitLab response_parsers.py

Tests the ResponseParser class which handles:
- Parsing AI responses into structured data
- Extracting findings from JSON code blocks
- Validating evidence requirements
- Error handling for malformed responses
"""

import json

import pytest
from runners.gitlab.models import (
    ReviewCategory,
    ReviewSeverity,
    TriageCategory,
)
from runners.gitlab.services.response_parsers import (
    MIN_EVIDENCE_LENGTH,
    ResponseParser,
    safe_print,
)


class TestResponseParser:
    """Tests for ResponseParser class."""

    # ============================================
    # parse_review_findings tests
    # ============================================

    def test_parse_review_findings_basic(self):
        """Test basic parsing of review findings."""
        response = """Here are the findings:
```json
[
  {
    "id": "finding-1",
    "severity": "high",
    "category": "security",
    "title": "SQL Injection",
    "description": "Potential SQL injection vulnerability",
    "file": "db.py",
    "line": 42,
    "evidence": "cursor.execute(f'SELECT * FROM users WHERE id = {user_id}')",
    "fixable": true
  }
]
```
"""
        findings = ResponseParser.parse_review_findings(response, require_evidence=True)

        assert len(findings) == 1
        assert findings[0].id == "finding-1"
        assert findings[0].severity == ReviewSeverity.HIGH
        assert findings[0].category == ReviewCategory.SECURITY
        assert findings[0].title == "SQL Injection"
        assert findings[0].file == "db.py"
        assert findings[0].line == 42

    def test_parse_review_findings_multiple(self):
        """Test parsing multiple findings."""
        response = """```json
[
  {"id": "f1", "severity": "high", "category": "security", "title": "Bug 1", "description": "Desc 1", "file": "a.py", "line": 1, "evidence": "code snippet here with enough length"},
  {"id": "f2", "severity": "medium", "category": "quality", "title": "Bug 2", "description": "Desc 2", "file": "b.py", "line": 2, "evidence": "another code snippet with enough chars"}
]
```"""
        findings = ResponseParser.parse_review_findings(response, require_evidence=True)

        assert len(findings) == 2
        assert findings[0].id == "f1"
        assert findings[1].id == "f2"

    def test_parse_review_findings_no_json(self):
        """Test handling of response without JSON block."""
        response = "This is just plain text without any JSON."
        findings = ResponseParser.parse_review_findings(response)

        assert findings == []

    def test_parse_review_findings_invalid_json(self):
        """Test handling of invalid JSON."""
        response = """```json
[{"id": "broken", invalid json}]
```"""
        findings = ResponseParser.parse_review_findings(response)

        assert findings == []

    def test_parse_review_findings_evidence_validation(self):
        """Test that findings without sufficient evidence are dropped."""
        response = """```json
[
  {"id": "f1", "severity": "high", "category": "security", "title": "Bug", "description": "Desc", "file": "a.py", "line": 1, "evidence": "short"}
]
```"""
        findings = ResponseParser.parse_review_findings(response, require_evidence=True)

        # Evidence too short (less than MIN_EVIDENCE_LENGTH)
        assert len(findings) == 0

    def test_parse_review_findings_skip_evidence_validation(self):
        """Test that evidence validation can be skipped."""
        response = """```json
[
  {"id": "f1", "severity": "high", "category": "security", "title": "Bug", "description": "Desc", "file": "a.py", "line": 1, "evidence": "short"}
]
```"""
        findings = ResponseParser.parse_review_findings(
            response, require_evidence=False
        )

        # Should include finding even with short evidence
        assert len(findings) == 1

    def test_parse_review_findings_code_snippet_alias(self):
        """Test that code_snippet is treated as evidence alias."""
        response = """```json
[
  {"id": "f1", "severity": "high", "category": "security", "title": "Bug", "description": "Desc", "file": "a.py", "line": 1, "code_snippet": "this is a code snippet that is long enough for validation"}
]
```"""
        findings = ResponseParser.parse_review_findings(response, require_evidence=True)

        assert len(findings) == 1

    def test_parse_review_findings_defaults(self):
        """Test default values for missing fields."""
        response = """```json
[{}]
```"""
        findings = ResponseParser.parse_review_findings(
            response, require_evidence=False
        )

        assert len(findings) == 1
        assert findings[0].id == "finding-1"
        assert findings[0].severity == ReviewSeverity.MEDIUM
        assert findings[0].category == ReviewCategory.QUALITY
        assert findings[0].title == "Finding"
        assert findings[0].file == "unknown"
        assert findings[0].line == 1

    def test_parse_review_findings_with_end_line(self):
        """Test parsing with end_line field."""
        response = """```json
[{"id": "f1", "severity": "low", "category": "style", "title": "T", "description": "D", "file": "f.py", "line": 1, "end_line": 10, "evidence": "sufficient evidence text here"}]
```"""
        findings = ResponseParser.parse_review_findings(response, require_evidence=True)

        assert findings[0].end_line == 10

    def test_parse_review_findings_with_suggested_fix(self):
        """Test parsing with suggested_fix field."""
        response = """```json
[{"id": "f1", "severity": "low", "category": "style", "title": "T", "description": "D", "file": "f.py", "line": 1, "suggested_fix": "Use proper naming", "evidence": "sufficient evidence here"}]
```"""
        findings = ResponseParser.parse_review_findings(response, require_evidence=True)

        assert findings[0].suggested_fix == "Use proper naming"

    # ============================================
    # parse_structural_issues tests
    # ============================================

    def test_parse_structural_issues_basic(self):
        """Test basic parsing of structural issues."""
        response = """```json
[
  {
    "id": "struct-1",
    "issue_type": "scope_creep",
    "severity": "high",
    "title": "Scope Creep Detected",
    "description": "Issue contains multiple unrelated features",
    "files_affected": ["a.py", "b.py"]
  }
]
```"""
        issues = ResponseParser.parse_structural_issues(response)

        assert len(issues) == 1
        assert issues[0].id == "struct-1"
        assert issues[0].type == "scope_creep"
        assert issues[0].severity == ReviewSeverity.HIGH
        assert issues[0].title == "Scope Creep Detected"
        assert "a.py" in issues[0].files_affected

    def test_parse_structural_issues_no_json(self):
        """Test handling of response without JSON."""
        response = "No structural issues found."
        issues = ResponseParser.parse_structural_issues(response)

        assert issues == []

    def test_parse_structural_issues_defaults(self):
        """Test default values for structural issues."""
        response = """```json
[{}]
```"""
        issues = ResponseParser.parse_structural_issues(response)

        assert len(issues) == 1
        assert issues[0].id == "struct-1"
        assert issues[0].type == "scope_creep"
        assert issues[0].severity == ReviewSeverity.MEDIUM
        assert issues[0].title == "Structural issue"
        assert issues[0].files_affected == []

    # ============================================
    # parse_ai_comment_triages tests
    # ============================================

    def test_parse_ai_comment_triages_basic(self):
        """Test basic parsing of AI comment triages."""
        response = """```json
[
  {
    "comment_id": "12345",
    "tool_name": "claude-code",
    "original_summary": "AI suggested using different approach",
    "verdict": "actionable",
    "reasoning": "The suggestion provides concrete improvement",
    "file": "main.py",
    "line": 42
  }
]
```"""
        triages = ResponseParser.parse_ai_comment_triages(response)

        assert len(triages) == 1
        assert triages[0].comment_id == "12345"
        assert triages[0].tool_name == "claude-code"
        assert triages[0].original_comment == "AI suggested using different approach"
        assert triages[0].triage_result == "actionable"
        assert triages[0].file == "main.py"
        assert triages[0].line == 42

    def test_parse_ai_comment_triages_no_json(self):
        """Test handling of response without JSON."""
        response = "No AI comments to triage."
        triages = ResponseParser.parse_ai_comment_triages(response)

        assert triages == []

    def test_parse_ai_comment_triages_defaults(self):
        """Test default values for AI comment triages."""
        response = """```json
[{}]
```"""
        triages = ResponseParser.parse_ai_comment_triages(response)

        assert len(triages) == 1
        assert triages[0].comment_id == ""
        assert triages[0].tool_name == "Unknown"
        assert triages[0].triage_result == "trivial"

    # ============================================
    # parse_triage_result tests
    # ============================================

    def test_parse_triage_result_basic(self):
        """Test basic parsing of triage result."""
        issue = {"iid": 42, "title": "Bug report", "description": "Something is broken"}
        response = """```json
{
  "category": "bug",
  "confidence": 0.9,
  "labels_to_add": ["type:bug", "priority:high"],
  "duplicate_of": null,
  "comment": "Thanks for the report!",
  "reasoning": "Clear bug report with reproduction steps"
}
```"""
        result = ResponseParser.parse_triage_result(issue, response, "test/project")

        assert result.issue_iid == 42
        assert result.project == "test/project"
        assert result.category == TriageCategory.BUG
        assert result.confidence == 0.9
        assert "type:bug" in result.suggested_labels
        assert result.duplicate_of is None
        assert result.suggested_response == "Thanks for the report!"

    def test_parse_triage_result_feature(self):
        """Test parsing feature category."""
        issue = {"iid": 1}
        response = """```json
{"category": "feature", "confidence": 0.8}
```"""
        result = ResponseParser.parse_triage_result(issue, response, "test/project")

        assert result.category == TriageCategory.FEATURE

    def test_parse_triage_result_documentation_maps_to_feature(self):
        """Test that documentation category maps to feature."""
        issue = {"iid": 1}
        response = """```json
{"category": "documentation", "confidence": 0.7}
```"""
        result = ResponseParser.parse_triage_result(issue, response, "test/project")

        # Documentation maps to feature
        assert result.category == TriageCategory.FEATURE

    def test_parse_triage_result_duplicate(self):
        """Test parsing duplicate detection."""
        issue = {"iid": 100}
        response = """```json
{
  "category": "duplicate",
  "confidence": 0.95,
  "duplicate_of": 50
}
```"""
        result = ResponseParser.parse_triage_result(issue, response, "test/project")

        assert result.category == TriageCategory.DUPLICATE
        assert result.duplicate_of == 50

    def test_parse_triage_result_spam(self):
        """Test parsing spam detection."""
        issue = {"iid": 1}
        response = """```json
{"category": "spam", "confidence": 0.99}
```"""
        result = ResponseParser.parse_triage_result(issue, response, "test/project")

        assert result.category == TriageCategory.SPAM

    def test_parse_triage_result_no_json(self):
        """Test handling of response without JSON."""
        issue = {"iid": 1}
        response = "Could not determine category"
        result = ResponseParser.parse_triage_result(issue, response, "test/project")

        # Should return defaults
        assert result.issue_iid == 1
        assert result.category == TriageCategory.FEATURE
        assert result.confidence == 0.5

    def test_parse_triage_result_defaults(self):
        """Test default values for triage result."""
        issue = {"iid": 1}
        response = """```json
{}
```"""
        result = ResponseParser.parse_triage_result(issue, response, "test/project")

        assert result.category == TriageCategory.FEATURE
        assert result.confidence == 0.5
        assert result.suggested_labels == []
        assert result.duplicate_of is None
        assert result.suggested_response == ""


class TestSafePrint:
    """Tests for safe_print utility function."""

    def test_safe_print_basic(self, capsys):
        """Test basic print functionality."""
        safe_print("Test message")
        captured = capsys.readouterr()
        assert "Test message" in captured.out

    def test_safe_print_with_flush(self, capsys):
        """Test print with flush."""
        safe_print("Test message", flush=True)
        captured = capsys.readouterr()
        assert "Test message" in captured.out


class TestConstants:
    """Tests for module constants."""

    def test_min_evidence_length(self):
        """Test that MIN_EVIDENCE_LENGTH is reasonable."""
        assert MIN_EVIDENCE_LENGTH == 20
        assert isinstance(MIN_EVIDENCE_LENGTH, int)


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_parse_with_whitespace_in_json(self):
        """Test parsing JSON with extra whitespace."""
        response = """
```json
  [
    {
      "id": "f1",
      "severity": "high",
      "category": "security",
      "title": "Bug",
      "description": "Desc",
      "file": "a.py",
      "line": 1,
      "evidence": "this evidence is long enough for validation"
    }
  ]
```
"""
        findings = ResponseParser.parse_review_findings(response, require_evidence=True)

        assert len(findings) == 1

    def test_parse_with_multiline_json(self):
        """Test parsing multiline JSON."""
        response = """Some text before
```json
[
  {
    "id": "f1",
    "severity": "medium",
    "category": "quality",
    "title": "Multi",
    "description": "Line",
    "file": "test.py",
    "line": 1,
    "evidence": "evidence with enough characters to pass validation"
  }
]
```
Some text after"""
        findings = ResponseParser.parse_review_findings(response, require_evidence=True)

        assert len(findings) == 1

    def test_parse_empty_json_array(self):
        """Test parsing empty JSON array."""
        response = """```json
[]
```"""
        findings = ResponseParser.parse_review_findings(response)

        assert findings == []

    def test_parse_with_nested_json(self):
        """Test that nested JSON in text doesn't confuse parser."""
        response = """Here's some text with {"nested": "json"} and then:
```json
[{"id": "f1", "severity": "low", "category": "style", "title": "T", "description": "D", "file": "f.py", "line": 1}]
```"""
        findings = ResponseParser.parse_review_findings(
            response, require_evidence=False
        )

        assert len(findings) == 1

    def test_parse_severity_case_insensitive(self):
        """Test that severity parsing handles different cases."""
        response = """```json
[
  {"id": "f1", "severity": "HIGH", "category": "security", "title": "T", "description": "D", "file": "f.py", "line": 1}
]
```"""
        findings = ResponseParser.parse_review_findings(
            response, require_evidence=False
        )

        assert findings[0].severity == ReviewSeverity.HIGH

    def test_parse_category_case_insensitive(self):
        """Test that category parsing handles different cases."""
        response = """```json
[
  {"id": "f1", "severity": "medium", "category": "SECURITY", "title": "T", "description": "D", "file": "f.py", "line": 1}
]
```"""
        findings = ResponseParser.parse_review_findings(
            response, require_evidence=False
        )

        assert findings[0].category == ReviewCategory.SECURITY

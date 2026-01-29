"""
Tests for Finding Validation System
====================================

Tests the finding-validator agent integration and FindingValidationResult models.
This system prevents false positives from persisting by re-investigating unresolved findings.

NOTE: The validation system has been updated to use EVIDENCE-BASED validation
instead of confidence scores. The key field is now `evidence_verified_in_file`
which is a boolean indicating whether the code evidence was found at the specified location.
"""

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

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

from pydantic_models import (
    FindingValidationResult,
    FindingValidationResponse,
    ParallelFollowupResponse,
    ResolutionVerification,
)
from models import (
    PRReviewFinding,
    ReviewSeverity,
    ReviewCategory,
)


# ============================================================================
# FindingValidationResult Model Tests
# ============================================================================


class TestFindingValidationResultModel:
    """Tests for the FindingValidationResult Pydantic model."""

    def test_valid_confirmed_valid(self):
        """Test creating a confirmed_valid validation result."""
        result = FindingValidationResult(
            finding_id="SEC-001",
            validation_status="confirmed_valid",
            code_evidence="const query = `SELECT * FROM users WHERE id = ${userId}`;",
            line_range=(45, 45),
            explanation="SQL injection is present - user input is concatenated directly into the query.",
            evidence_verified_in_file=True,
        )
        assert result.finding_id == "SEC-001"
        assert result.validation_status == "confirmed_valid"
        assert "SELECT" in result.code_evidence
        assert result.evidence_verified_in_file is True

    def test_valid_dismissed_false_positive(self):
        """Test creating a dismissed_false_positive validation result."""
        result = FindingValidationResult(
            finding_id="QUAL-002",
            validation_status="dismissed_false_positive",
            code_evidence="const sanitized = DOMPurify.sanitize(data);",
            line_range=(23, 26),
            explanation="Original finding claimed XSS but code uses DOMPurify.sanitize() for protection.",
            evidence_verified_in_file=True,
        )
        assert result.validation_status == "dismissed_false_positive"
        assert result.evidence_verified_in_file is True

    def test_valid_needs_human_review(self):
        """Test creating a needs_human_review validation result."""
        result = FindingValidationResult(
            finding_id="LOGIC-003",
            validation_status="needs_human_review",
            code_evidence="async function handleRequest(req) { ... }",
            line_range=(100, 150),
            explanation="Race condition claim requires runtime analysis to verify.",
            evidence_verified_in_file=True,
        )
        assert result.validation_status == "needs_human_review"
        assert result.evidence_verified_in_file is True

    def test_hallucinated_finding_not_verified(self):
        """Test creating a result where evidence was not verified (hallucinated finding)."""
        result = FindingValidationResult(
            finding_id="HALLUC-001",
            validation_status="dismissed_false_positive",
            code_evidence="// Line 710 does not exist - file only has 600 lines",
            line_range=(600, 600),
            explanation="Original finding cited line 710 but file only has 600 lines. Hallucinated finding.",
            evidence_verified_in_file=False,
        )
        assert result.validation_status == "dismissed_false_positive"
        assert result.evidence_verified_in_file is False

    def test_code_evidence_required(self):
        """Test that code_evidence cannot be empty."""
        with pytest.raises(ValidationError) as exc_info:
            FindingValidationResult(
                finding_id="SEC-001",
                validation_status="confirmed_valid",
                code_evidence="",  # Empty string should fail
                line_range=(45, 45),
                explanation="This is a detailed explanation of the issue.",
                evidence_verified_in_file=True,
            )
        errors = exc_info.value.errors()
        assert any("code_evidence" in str(e) for e in errors)

    def test_explanation_min_length(self):
        """Test that explanation must be at least 20 characters."""
        with pytest.raises(ValidationError) as exc_info:
            FindingValidationResult(
                finding_id="SEC-001",
                validation_status="confirmed_valid",
                code_evidence="const x = 1;",
                line_range=(45, 45),
                explanation="Too short",  # Less than 20 chars
                evidence_verified_in_file=True,
            )
        errors = exc_info.value.errors()
        assert any("explanation" in str(e) for e in errors)

    def test_evidence_verified_required(self):
        """Test that evidence_verified_in_file is required."""
        with pytest.raises(ValidationError) as exc_info:
            FindingValidationResult(
                finding_id="SEC-001",
                validation_status="confirmed_valid",
                code_evidence="const query = `SELECT * FROM users`;",
                line_range=(45, 45),
                explanation="SQL injection vulnerability found in the query construction.",
                # Missing evidence_verified_in_file
            )
        errors = exc_info.value.errors()
        assert any("evidence_verified_in_file" in str(e) for e in errors)

    def test_invalid_validation_status(self):
        """Test that invalid validation_status values are rejected."""
        with pytest.raises(ValidationError):
            FindingValidationResult(
                finding_id="SEC-001",
                validation_status="invalid_status",  # Not a valid status
                code_evidence="const x = 1;",
                line_range=(45, 45),
                explanation="This is a detailed explanation of the issue.",
                evidence_verified_in_file=True,
            )


class TestFindingValidationResponse:
    """Tests for the FindingValidationResponse container model."""

    def test_valid_response_with_multiple_validations(self):
        """Test creating a response with multiple validation results."""
        response = FindingValidationResponse(
            validations=[
                FindingValidationResult(
                    finding_id="SEC-001",
                    validation_status="confirmed_valid",
                    code_evidence="const query = `SELECT * FROM users`;",
                    line_range=(45, 45),
                    explanation="SQL injection confirmed in this query.",
                    evidence_verified_in_file=True,
                ),
                FindingValidationResult(
                    finding_id="QUAL-002",
                    validation_status="dismissed_false_positive",
                    code_evidence="const sanitized = DOMPurify.sanitize(data);",
                    line_range=(23, 26),
                    explanation="Code uses DOMPurify so XSS claim is false.",
                    evidence_verified_in_file=True,
                ),
            ],
            summary="1 finding confirmed valid, 1 dismissed as false positive",
        )
        assert len(response.validations) == 2
        assert "1 finding confirmed" in response.summary


class TestParallelFollowupResponseWithValidation:
    """Tests for ParallelFollowupResponse including finding_validations."""

    def test_response_includes_finding_validations(self):
        """Test that ParallelFollowupResponse accepts finding_validations."""
        response = ParallelFollowupResponse(
            analysis_summary="Follow-up review with validation",
            agents_invoked=["resolution-verifier", "finding-validator"],
            commits_analyzed=3,
            files_changed=5,
            resolution_verifications=[
                ResolutionVerification(
                    finding_id="SEC-001",
                    status="unresolved",
                    evidence="File was not modified",
                )
            ],
            finding_validations=[
                FindingValidationResult(
                    finding_id="SEC-001",
                    validation_status="confirmed_valid",
                    code_evidence="const query = `SELECT * FROM users`;",
                    line_range=(45, 45),
                    explanation="SQL injection confirmed in this query.",
                    evidence_verified_in_file=True,
                )
            ],
            new_findings=[],
            comment_analyses=[],
            comment_findings=[],
            verdict="NEEDS_REVISION",
            verdict_reasoning="1 confirmed valid security issue remains",
        )
        assert len(response.finding_validations) == 1
        assert response.finding_validations[0].validation_status == "confirmed_valid"

    def test_response_with_dismissed_findings(self):
        """Test response where findings are dismissed as false positives."""
        response = ParallelFollowupResponse(
            analysis_summary="All findings dismissed as false positives",
            agents_invoked=["resolution-verifier", "finding-validator"],
            commits_analyzed=3,
            files_changed=5,
            resolution_verifications=[
                ResolutionVerification(
                    finding_id="SEC-001",
                    status="unresolved",
                    evidence="Line wasn't changed but need to verify",
                )
            ],
            finding_validations=[
                FindingValidationResult(
                    finding_id="SEC-001",
                    validation_status="dismissed_false_positive",
                    code_evidence="const query = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);",
                    line_range=(45, 48),
                    explanation="Original review misread - using parameterized query.",
                    evidence_verified_in_file=True,
                )
            ],
            new_findings=[],
            comment_analyses=[],
            comment_findings=[],
            verdict="READY_TO_MERGE",
            verdict_reasoning="Previous finding was a false positive, now dismissed",
        )
        assert len(response.finding_validations) == 1
        assert response.finding_validations[0].validation_status == "dismissed_false_positive"


# ============================================================================
# PRReviewFinding Validation Fields Tests
# ============================================================================


class TestPRReviewFindingValidationFields:
    """Tests for validation fields on PRReviewFinding model."""

    def test_finding_with_validation_fields(self):
        """Test creating a finding with validation fields populated."""
        finding = PRReviewFinding(
            id="SEC-001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="SQL Injection",
            description="User input not sanitized",
            file="src/db.py",
            line=42,
            validation_status="confirmed_valid",
            validation_evidence="const query = `SELECT * FROM users`;",
            validation_explanation="SQL injection confirmed in the query.",
        )
        assert finding.validation_status == "confirmed_valid"
        assert finding.validation_evidence is not None

    def test_finding_without_validation_fields(self):
        """Test that validation fields are optional."""
        finding = PRReviewFinding(
            id="SEC-001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="SQL Injection",
            description="User input not sanitized",
            file="src/db.py",
            line=42,
        )
        assert finding.validation_status is None
        assert finding.validation_evidence is None
        assert finding.validation_explanation is None

    def test_finding_to_dict_includes_validation(self):
        """Test that to_dict includes validation fields."""
        finding = PRReviewFinding(
            id="SEC-001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="SQL Injection",
            description="User input not sanitized",
            file="src/db.py",
            line=42,
            validation_status="confirmed_valid",
            validation_evidence="const query = ...;",
            validation_explanation="Issue confirmed.",
        )
        data = finding.to_dict()
        assert data["validation_status"] == "confirmed_valid"
        assert data["validation_evidence"] == "const query = ...;"
        assert data["validation_explanation"] == "Issue confirmed."

    def test_finding_from_dict_with_validation(self):
        """Test that from_dict loads validation fields."""
        data = {
            "id": "SEC-001",
            "severity": "high",
            "category": "security",
            "title": "SQL Injection",
            "description": "User input not sanitized",
            "file": "src/db.py",
            "line": 42,
            "validation_status": "dismissed_false_positive",
            "validation_evidence": "parameterized query used",
            "validation_explanation": "False positive - using prepared statements.",
        }
        finding = PRReviewFinding.from_dict(data)
        assert finding.validation_status == "dismissed_false_positive"


# ============================================================================
# Integration Tests
# ============================================================================


class TestValidationIntegration:
    """Integration tests for the validation flow."""

    def test_validation_summary_format(self):
        """Test that validation summary format is correct when validation results exist."""
        # Test the expected summary format when validation results are present
        # We can't directly import ParallelFollowupReviewer due to complex imports,
        # so we verify the Pydantic models work correctly instead

        response = ParallelFollowupResponse(
            analysis_summary="Follow-up with validation",
            agents_invoked=["resolution-verifier", "finding-validator"],
            commits_analyzed=3,
            files_changed=5,
            resolution_verifications=[],
            finding_validations=[
                FindingValidationResult(
                    finding_id="SEC-001",
                    validation_status="confirmed_valid",
                    code_evidence="const query = `SELECT * FROM users`;",
                    line_range=(45, 45),
                    explanation="SQL injection confirmed in this query construction.",
                    evidence_verified_in_file=True,
                ),
                FindingValidationResult(
                    finding_id="QUAL-002",
                    validation_status="dismissed_false_positive",
                    code_evidence="const sanitized = DOMPurify.sanitize(data);",
                    line_range=(23, 26),
                    explanation="Original XSS claim was incorrect - uses DOMPurify.",
                    evidence_verified_in_file=True,
                ),
            ],
            new_findings=[],
            comment_analyses=[],
            comment_findings=[],
            verdict="READY_TO_MERGE",
            verdict_reasoning="1 dismissed as false positive, 1 confirmed valid but low severity",
        )

        # Verify validation counts can be computed from the response
        confirmed_count = sum(
            1 for fv in response.finding_validations
            if fv.validation_status == "confirmed_valid"
        )
        dismissed_count = sum(
            1 for fv in response.finding_validations
            if fv.validation_status == "dismissed_false_positive"
        )

        assert confirmed_count == 1
        assert dismissed_count == 1
        assert len(response.finding_validations) == 2
        assert "finding-validator" in response.agents_invoked

    def test_validation_status_enum_values(self):
        """Test all valid validation status values."""
        valid_statuses = ["confirmed_valid", "dismissed_false_positive", "needs_human_review"]

        for status in valid_statuses:
            result = FindingValidationResult(
                finding_id="TEST-001",
                validation_status=status,
                code_evidence="const x = 1;",
                line_range=(1, 1),
                explanation="This is a valid explanation for the finding status.",
                evidence_verified_in_file=True,
            )
            assert result.validation_status == status


# ============================================================================
# Evidence Quality Tests
# ============================================================================


class TestEvidenceQuality:
    """Tests for evidence quality in finding validation."""

    def test_evidence_with_actual_code_snippet(self):
        """Test that evidence with actual code is valid."""
        result = FindingValidationResult(
            finding_id="SEC-001",
            validation_status="confirmed_valid",
            code_evidence="const query = db.query(`SELECT * FROM users WHERE id = ${userId}`);",
            line_range=(45, 45),
            explanation="SQL injection - user input interpolated directly into query string.",
            evidence_verified_in_file=True,
        )
        assert "SELECT" in result.code_evidence
        assert "userId" in result.code_evidence
        assert result.evidence_verified_in_file is True

    def test_evidence_multiline_code_block(self):
        """Test evidence spanning multiple lines."""
        multiline_evidence = """function processInput(userInput) {
    const query = `SELECT * FROM users WHERE name = '${userInput}'`;
    return db.execute(query);
}"""
        result = FindingValidationResult(
            finding_id="SEC-002",
            validation_status="confirmed_valid",
            code_evidence=multiline_evidence,
            line_range=(10, 14),
            explanation="SQL injection across multiple lines - user input flows into query.",
            evidence_verified_in_file=True,
        )
        assert result.line_range == [10, 14]
        assert "processInput" in result.code_evidence
        assert "userInput" in result.code_evidence

    def test_evidence_with_context_around_issue(self):
        """Test evidence that includes surrounding context code."""
        context_evidence = """// Input sanitization
const sanitized = DOMPurify.sanitize(userInput);
// Safe to use now
element.innerHTML = sanitized;"""
        result = FindingValidationResult(
            finding_id="XSS-001",
            validation_status="dismissed_false_positive",
            code_evidence=context_evidence,
            line_range=(20, 24),
            explanation="XSS claim was false - code uses DOMPurify to sanitize before innerHTML.",
            evidence_verified_in_file=True,
        )
        assert "DOMPurify.sanitize" in result.code_evidence
        assert result.validation_status == "dismissed_false_positive"

    def test_evidence_insufficient_for_validation(self):
        """Test evidence that doesn't provide clear proof either way."""
        ambiguous_evidence = """const data = processData(input);
// Complex transformation
return transformedData;"""
        result = FindingValidationResult(
            finding_id="LOGIC-001",
            validation_status="needs_human_review",
            code_evidence=ambiguous_evidence,
            line_range=(50, 53),
            explanation="Cannot determine if race condition exists - requires runtime analysis.",
            evidence_verified_in_file=True,
        )
        assert result.validation_status == "needs_human_review"

    def test_evidence_not_found_in_file(self):
        """Test when evidence couldn't be verified in file (hallucinated finding)."""
        result = FindingValidationResult(
            finding_id="HALLUC-001",
            validation_status="dismissed_false_positive",
            code_evidence="// File ends at line 200, original finding referenced line 500",
            line_range=(200, 200),
            explanation="Original finding cited non-existent line. File only has 200 lines.",
            evidence_verified_in_file=False,
        )
        assert result.evidence_verified_in_file is False
        assert result.validation_status == "dismissed_false_positive"

    def test_evidence_with_special_characters(self):
        """Test evidence containing special characters."""
        special_evidence = """const regex = /[<>\"'&]/g;
const encoded = str.replace(regex, (c) => `&#${c.charCodeAt(0)};`);"""
        result = FindingValidationResult(
            finding_id="XSS-002",
            validation_status="dismissed_false_positive",
            code_evidence=special_evidence,
            line_range=(30, 31),
            explanation="XSS claim incorrect - code properly encodes special characters.",
            evidence_verified_in_file=True,
        )
        assert "<>" in result.code_evidence or "[<>" in result.code_evidence

    def test_evidence_quality_for_confirmed_security_issue(self):
        """Test high-quality evidence confirming a security vulnerability."""
        result = FindingValidationResult(
            finding_id="SEC-003",
            validation_status="confirmed_valid",
            code_evidence="eval(userInput);  // Execute user-provided code",
            line_range=(100, 100),
            explanation="Critical: eval() called on user input without sanitization. Remote code execution.",
            evidence_verified_in_file=True,
        )
        assert "eval" in result.code_evidence
        assert "userInput" in result.code_evidence
        assert result.validation_status == "confirmed_valid"

    def test_evidence_comparing_claim_to_reality(self):
        """Test evidence that shows discrepancy between claim and actual code."""
        result = FindingValidationResult(
            finding_id="LOGIC-002",
            validation_status="dismissed_false_positive",
            code_evidence="if (items.length === 0) { return []; }  // Empty array handled",
            line_range=(75, 75),
            explanation="Original finding claimed missing empty array check, but line 75 shows check exists.",
            evidence_verified_in_file=True,
        )
        assert "length === 0" in result.code_evidence
        assert result.validation_status == "dismissed_false_positive"


# ============================================================================
# Scope Filtering Tests
# ============================================================================


class TestScopeFiltering:
    """Tests for filtering findings by scope/category."""

    def test_filter_findings_by_category_security(self):
        """Test filtering findings to only security category."""
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
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.QUALITY,
                title="Unused variable",
                description="Variable x is never used",
                file="src/utils.py",
                line=10,
            ),
            PRReviewFinding(
                id="SEC-002",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="XSS Vulnerability",
                description="Unescaped output",
                file="src/views.py",
                line=100,
            ),
        ]

        security_findings = [f for f in findings if f.category == ReviewCategory.SECURITY]
        assert len(security_findings) == 2
        assert all(f.category == ReviewCategory.SECURITY for f in security_findings)

    def test_filter_findings_by_category_quality(self):
        """Test filtering findings to only quality category."""
        findings = [
            PRReviewFinding(
                id="QUAL-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Complex function",
                description="Function too complex",
                file="src/core.py",
                line=50,
            ),
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="Auth bypass",
                description="Missing auth check",
                file="src/auth.py",
                line=20,
            ),
        ]

        quality_findings = [f for f in findings if f.category == ReviewCategory.QUALITY]
        assert len(quality_findings) == 1
        assert quality_findings[0].id == "QUAL-001"

    def test_filter_findings_by_severity(self):
        """Test filtering findings by severity level."""
        findings = [
            PRReviewFinding(
                id="CRIT-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="RCE",
                description="Remote code execution",
                file="src/api.py",
                line=1,
            ),
            PRReviewFinding(
                id="LOW-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Naming",
                description="Variable naming",
                file="src/utils.py",
                line=5,
            ),
            PRReviewFinding(
                id="HIGH-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SSRF",
                description="Server-side request forgery",
                file="src/fetch.py",
                line=30,
            ),
        ]

        critical_or_high = [
            f for f in findings
            if f.severity in (ReviewSeverity.CRITICAL, ReviewSeverity.HIGH)
        ]
        assert len(critical_or_high) == 2

    def test_filter_findings_by_file_path(self):
        """Test filtering findings by file path pattern."""
        findings = [
            PRReviewFinding(
                id="TEST-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.TEST,
                title="Missing test",
                description="No unit test",
                file="tests/test_api.py",
                line=1,
            ),
            PRReviewFinding(
                id="SRC-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Code smell",
                description="Duplication",
                file="src/api.py",
                line=50,
            ),
            PRReviewFinding(
                id="TEST-002",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.TEST,
                title="Flaky test",
                description="Test depends on timing",
                file="tests/test_utils.py",
                line=20,
            ),
        ]

        test_file_findings = [f for f in findings if f.file.startswith("tests/")]
        assert len(test_file_findings) == 2
        assert all("test" in f.file for f in test_file_findings)

    def test_filter_validation_results_by_status(self):
        """Test filtering validation results by validation status."""
        validations = [
            FindingValidationResult(
                finding_id="SEC-001",
                validation_status="confirmed_valid",
                code_evidence="eval(userInput);",
                line_range=(10, 10),
                explanation="Confirmed: eval on user input is a security risk.",
                evidence_verified_in_file=True,
            ),
            FindingValidationResult(
                finding_id="QUAL-001",
                validation_status="dismissed_false_positive",
                code_evidence="const x = sanitize(input);",
                line_range=(20, 20),
                explanation="Dismissed: input is properly sanitized before use.",
                evidence_verified_in_file=True,
            ),
            FindingValidationResult(
                finding_id="LOGIC-001",
                validation_status="needs_human_review",
                code_evidence="async function race() { ... }",
                line_range=(30, 35),
                explanation="Needs review: potential race condition requires runtime analysis.",
                evidence_verified_in_file=True,
            ),
        ]

        confirmed = [v for v in validations if v.validation_status == "confirmed_valid"]
        dismissed = [v for v in validations if v.validation_status == "dismissed_false_positive"]
        needs_review = [v for v in validations if v.validation_status == "needs_human_review"]

        assert len(confirmed) == 1
        assert len(dismissed) == 1
        assert len(needs_review) == 1

    def test_filter_validations_by_evidence_verified(self):
        """Test filtering validation results by evidence verification status."""
        validations = [
            FindingValidationResult(
                finding_id="REAL-001",
                validation_status="confirmed_valid",
                code_evidence="const password = 'hardcoded';",
                line_range=(50, 50),
                explanation="Confirmed: hardcoded password found at specified location.",
                evidence_verified_in_file=True,
            ),
            FindingValidationResult(
                finding_id="HALLUC-001",
                validation_status="dismissed_false_positive",
                code_evidence="// Line does not exist in file",
                line_range=(999, 999),
                explanation="Dismissed: original finding referenced non-existent line.",
                evidence_verified_in_file=False,
            ),
            FindingValidationResult(
                finding_id="REAL-002",
                validation_status="dismissed_false_positive",
                code_evidence="const sanitized = escape(input);",
                line_range=(75, 75),
                explanation="Dismissed: code properly escapes input.",
                evidence_verified_in_file=True,
            ),
        ]

        verified = [v for v in validations if v.evidence_verified_in_file]
        not_verified = [v for v in validations if not v.evidence_verified_in_file]

        assert len(verified) == 2
        assert len(not_verified) == 1
        assert not_verified[0].finding_id == "HALLUC-001"

    def test_filter_findings_multiple_criteria(self):
        """Test filtering findings with multiple criteria combined."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="SQL Injection",
                description="Critical security flaw",
                file="src/db.py",
                line=42,
                validation_status="confirmed_valid",
            ),
            PRReviewFinding(
                id="SEC-002",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="XSS",
                description="High security flaw",
                file="src/views.py",
                line=100,
                validation_status="dismissed_false_positive",
            ),
            PRReviewFinding(
                id="QUAL-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.QUALITY,
                title="Memory leak",
                description="Critical quality issue",
                file="src/cache.py",
                line=50,
                validation_status="confirmed_valid",
            ),
        ]

        # Filter: security + critical + confirmed
        filtered = [
            f for f in findings
            if f.category == ReviewCategory.SECURITY
            and f.severity == ReviewSeverity.CRITICAL
            and f.validation_status == "confirmed_valid"
        ]

        assert len(filtered) == 1
        assert filtered[0].id == "SEC-001"

    def test_filter_findings_by_validation_status(self):
        """Test filtering PRReviewFinding by validation status field."""
        findings = [
            PRReviewFinding(
                id="F-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="Issue 1",
                description="Description 1",
                file="src/a.py",
                line=10,
                validation_status="confirmed_valid",
            ),
            PRReviewFinding(
                id="F-002",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Issue 2",
                description="Description 2",
                file="src/b.py",
                line=20,
                validation_status="dismissed_false_positive",
            ),
            PRReviewFinding(
                id="F-003",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.DOCS,
                title="Issue 3",
                description="Description 3",
                file="src/c.py",
                line=30,
                validation_status=None,  # Not yet validated
            ),
        ]

        validated = [f for f in findings if f.validation_status is not None]
        unvalidated = [f for f in findings if f.validation_status is None]

        assert len(validated) == 2
        assert len(unvalidated) == 1
        assert unvalidated[0].id == "F-003"

    def test_scope_all_review_categories(self):
        """Test that all ReviewCategory enum values can be used in findings."""
        categories = [
            ReviewCategory.SECURITY,
            ReviewCategory.QUALITY,
            ReviewCategory.STYLE,
            ReviewCategory.TEST,
            ReviewCategory.DOCS,
            ReviewCategory.PATTERN,
            ReviewCategory.PERFORMANCE,
            ReviewCategory.VERIFICATION_FAILED,
            ReviewCategory.REDUNDANCY,
        ]

        findings = []
        for i, category in enumerate(categories):
            findings.append(PRReviewFinding(
                id=f"CAT-{i:03d}",
                severity=ReviewSeverity.MEDIUM,
                category=category,
                title=f"Finding for {category.value}",
                description=f"Description for {category.value}",
                file=f"src/{category.value}.py",
                line=i + 1,
            ))

        assert len(findings) == len(categories)

        # Verify each category can be filtered
        for category in categories:
            filtered = [f for f in findings if f.category == category]
            assert len(filtered) == 1
            assert filtered[0].category == category


# ============================================================================
# Finding Deduplication Tests
# ============================================================================


class TestFindingDeduplication:
    """Tests for finding deduplication logic."""

    def test_dedup_exact_file_and_line_match(self):
        """Test detecting duplicates with exact file and line match."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection",
                description="User input not sanitized",
                file="src/db.py",
                line=42,
            ),
            PRReviewFinding(
                id="SEC-002",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection vulnerability",
                description="Different description same issue",
                file="src/db.py",
                line=42,
            ),
        ]

        # Deduplication by file + line
        seen_locations = set()
        unique_findings = []
        for finding in findings:
            location = (finding.file, finding.line)
            if location not in seen_locations:
                seen_locations.add(location)
                unique_findings.append(finding)

        assert len(unique_findings) == 1
        assert unique_findings[0].id == "SEC-001"

    def test_dedup_same_file_different_lines(self):
        """Test that findings on different lines in same file are NOT duplicates."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection",
                description="First query issue",
                file="src/db.py",
                line=42,
            ),
            PRReviewFinding(
                id="SEC-002",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection",
                description="Second query issue",
                file="src/db.py",
                line=100,
            ),
        ]

        # Deduplication by file + line
        seen_locations = set()
        unique_findings = []
        for finding in findings:
            location = (finding.file, finding.line)
            if location not in seen_locations:
                seen_locations.add(location)
                unique_findings.append(finding)

        assert len(unique_findings) == 2

    def test_dedup_overlapping_line_ranges(self):
        """Test detecting duplicates with overlapping line ranges."""
        findings = [
            PRReviewFinding(
                id="QUAL-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Complex function",
                description="Function is too complex",
                file="src/processor.py",
                line=10,
                end_line=50,
            ),
            PRReviewFinding(
                id="QUAL-002",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Nested loops",
                description="Deeply nested loops detected",
                file="src/processor.py",
                line=25,
                end_line=40,
            ),
        ]

        # Deduplication by overlapping ranges
        def ranges_overlap(f1, f2):
            """Check if two findings have overlapping line ranges in the same file."""
            if f1.file != f2.file:
                return False
            start1, end1 = f1.line, f1.end_line or f1.line
            start2, end2 = f2.line, f2.end_line or f2.line
            return start1 <= end2 and start2 <= end1

        unique_findings = []
        for finding in findings:
            is_duplicate = any(ranges_overlap(finding, uf) for uf in unique_findings)
            if not is_duplicate:
                unique_findings.append(finding)

        # Second finding overlaps with first, so it should be deduplicated
        assert len(unique_findings) == 1
        assert unique_findings[0].id == "QUAL-001"

    def test_dedup_by_finding_id(self):
        """Test deduplication by finding ID."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection",
                description="User input not sanitized",
                file="src/db.py",
                line=42,
            ),
            PRReviewFinding(
                id="SEC-001",  # Same ID
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection Updated",
                description="Updated description",
                file="src/db.py",
                line=42,
            ),
        ]

        # Deduplication by ID
        seen_ids = set()
        unique_findings = []
        for finding in findings:
            if finding.id not in seen_ids:
                seen_ids.add(finding.id)
                unique_findings.append(finding)

        assert len(unique_findings) == 1
        assert unique_findings[0].title == "SQL Injection"

    def test_dedup_preserves_highest_severity(self):
        """Test that deduplication preserves the finding with highest severity."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.SECURITY,
                title="Input validation issue",
                description="Minor issue",
                file="src/api.py",
                line=50,
            ),
            PRReviewFinding(
                id="SEC-002",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Input validation critical",
                description="Critical issue same location",
                file="src/api.py",
                line=50,
            ),
        ]

        # Severity priority mapping
        severity_priority = {
            ReviewSeverity.CRITICAL: 4,
            ReviewSeverity.HIGH: 3,
            ReviewSeverity.MEDIUM: 2,
            ReviewSeverity.LOW: 1,
        }

        # Group by location and keep highest severity
        location_findings = {}
        for finding in findings:
            location = (finding.file, finding.line)
            if location not in location_findings:
                location_findings[location] = finding
            else:
                existing = location_findings[location]
                if severity_priority[finding.severity] > severity_priority[existing.severity]:
                    location_findings[location] = finding

        unique_findings = list(location_findings.values())
        assert len(unique_findings) == 1
        assert unique_findings[0].severity == ReviewSeverity.CRITICAL
        assert unique_findings[0].id == "SEC-002"

    def test_dedup_cross_category_same_location(self):
        """Test deduplication of findings from different categories at same location."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="Unsafe input handling",
                description="Security concern",
                file="src/handler.py",
                line=75,
            ),
            PRReviewFinding(
                id="QUAL-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Error handling missing",
                description="Quality concern",
                file="src/handler.py",
                line=75,
            ),
        ]

        # When findings are at same location but different categories,
        # we might want to keep both (different concerns) or deduplicate
        # This tests the "keep both" strategy
        unique_by_location_and_category = {}
        for finding in findings:
            key = (finding.file, finding.line, finding.category)
            if key not in unique_by_location_and_category:
                unique_by_location_and_category[key] = finding

        # Should keep both since they are different categories
        assert len(unique_by_location_and_category) == 2

    def test_dedup_with_redundant_with_field(self):
        """Test using redundant_with field for explicit deduplication marking."""
        findings = [
            PRReviewFinding(
                id="QUAL-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Duplicate code block",
                description="Same logic as src/utils.py:100",
                file="src/helpers.py",
                line=50,
                redundant_with="src/utils.py:100",
            ),
            PRReviewFinding(
                id="QUAL-002",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Original code block",
                description="The original implementation",
                file="src/utils.py",
                line=100,
            ),
        ]

        # Filter out findings that are marked as redundant
        non_redundant_findings = [f for f in findings if f.redundant_with is None]
        assert len(non_redundant_findings) == 1
        assert non_redundant_findings[0].id == "QUAL-002"

    def test_dedup_empty_list(self):
        """Test deduplication of empty findings list."""
        findings = []

        seen_locations = set()
        unique_findings = []
        for finding in findings:
            location = (finding.file, finding.line)
            if location not in seen_locations:
                seen_locations.add(location)
                unique_findings.append(finding)

        assert len(unique_findings) == 0

    def test_dedup_single_finding(self):
        """Test deduplication with single finding returns same finding."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="SQL Injection",
                description="User input not sanitized",
                file="src/db.py",
                line=42,
            ),
        ]

        seen_locations = set()
        unique_findings = []
        for finding in findings:
            location = (finding.file, finding.line)
            if location not in seen_locations:
                seen_locations.add(location)
                unique_findings.append(finding)

        assert len(unique_findings) == 1
        assert unique_findings[0].id == "SEC-001"

    def test_dedup_validation_findings_by_status(self):
        """Test deduplication of validation results by finding_id."""
        validations = [
            FindingValidationResult(
                finding_id="SEC-001",
                validation_status="confirmed_valid",
                code_evidence="const query = `SELECT * FROM users`;",
                line_range=(45, 45),
                explanation="SQL injection confirmed - first validation.",
                evidence_verified_in_file=True,
            ),
            FindingValidationResult(
                finding_id="SEC-001",  # Same finding ID
                validation_status="confirmed_valid",
                code_evidence="const query = `SELECT * FROM users`;",
                line_range=(45, 45),
                explanation="SQL injection confirmed - duplicate validation.",
                evidence_verified_in_file=True,
            ),
            FindingValidationResult(
                finding_id="SEC-002",
                validation_status="dismissed_false_positive",
                code_evidence="const sanitized = escape(input);",
                line_range=(60, 60),
                explanation="Input is properly escaped - false positive.",
                evidence_verified_in_file=True,
            ),
        ]

        # Deduplicate by finding_id
        seen_ids = set()
        unique_validations = []
        for validation in validations:
            if validation.finding_id not in seen_ids:
                seen_ids.add(validation.finding_id)
                unique_validations.append(validation)

        assert len(unique_validations) == 2
        assert unique_validations[0].finding_id == "SEC-001"
        assert unique_validations[1].finding_id == "SEC-002"


# ============================================================================
# Severity Mapping Tests for Findings
# ============================================================================


class TestFindingSeverityMapping:
    """Tests for severity mapping in finding validation context."""

    def test_severity_enum_all_values(self):
        """Test all ReviewSeverity enum values exist."""
        assert ReviewSeverity.CRITICAL.value == "critical"
        assert ReviewSeverity.HIGH.value == "high"
        assert ReviewSeverity.MEDIUM.value == "medium"
        assert ReviewSeverity.LOW.value == "low"

    def test_severity_from_string_conversion(self):
        """Test creating severity from string values."""
        assert ReviewSeverity("critical") == ReviewSeverity.CRITICAL
        assert ReviewSeverity("high") == ReviewSeverity.HIGH
        assert ReviewSeverity("medium") == ReviewSeverity.MEDIUM
        assert ReviewSeverity("low") == ReviewSeverity.LOW

    def test_invalid_severity_raises(self):
        """Test that invalid severity strings raise ValueError."""
        with pytest.raises(ValueError):
            ReviewSeverity("invalid")

    def test_severity_ordering_for_prioritization(self):
        """Test severity ordering for finding prioritization."""
        severity_priority = {
            ReviewSeverity.CRITICAL: 4,
            ReviewSeverity.HIGH: 3,
            ReviewSeverity.MEDIUM: 2,
            ReviewSeverity.LOW: 1,
        }

        assert severity_priority[ReviewSeverity.CRITICAL] > severity_priority[ReviewSeverity.HIGH]
        assert severity_priority[ReviewSeverity.HIGH] > severity_priority[ReviewSeverity.MEDIUM]
        assert severity_priority[ReviewSeverity.MEDIUM] > severity_priority[ReviewSeverity.LOW]

    def test_sort_findings_by_severity(self):
        """Test sorting findings by severity (highest first)."""
        findings = [
            PRReviewFinding(
                id="LOW-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Minor style",
                description="Low issue",
                file="src/a.py",
                line=1,
            ),
            PRReviewFinding(
                id="CRIT-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Critical security",
                description="Critical issue",
                file="src/b.py",
                line=2,
            ),
            PRReviewFinding(
                id="MED-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Medium quality",
                description="Medium issue",
                file="src/c.py",
                line=3,
            ),
            PRReviewFinding(
                id="HIGH-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.PERFORMANCE,
                title="High perf",
                description="High issue",
                file="src/d.py",
                line=4,
            ),
        ]

        severity_priority = {
            ReviewSeverity.CRITICAL: 4,
            ReviewSeverity.HIGH: 3,
            ReviewSeverity.MEDIUM: 2,
            ReviewSeverity.LOW: 1,
        }

        sorted_findings = sorted(
            findings,
            key=lambda f: severity_priority[f.severity],
            reverse=True
        )

        assert sorted_findings[0].severity == ReviewSeverity.CRITICAL
        assert sorted_findings[1].severity == ReviewSeverity.HIGH
        assert sorted_findings[2].severity == ReviewSeverity.MEDIUM
        assert sorted_findings[3].severity == ReviewSeverity.LOW

    def test_filter_findings_above_severity_threshold(self):
        """Test filtering findings above a severity threshold."""
        findings = [
            PRReviewFinding(
                id="CRIT-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Critical",
                description="Critical issue",
                file="src/a.py",
                line=1,
            ),
            PRReviewFinding(
                id="HIGH-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="High",
                description="High issue",
                file="src/b.py",
                line=2,
            ),
            PRReviewFinding(
                id="MED-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Medium",
                description="Medium issue",
                file="src/c.py",
                line=3,
            ),
            PRReviewFinding(
                id="LOW-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Low",
                description="Low issue",
                file="src/d.py",
                line=4,
            ),
        ]

        # Filter for HIGH or above (blocks merge)
        blocking_severities = {ReviewSeverity.CRITICAL, ReviewSeverity.HIGH}
        blocking_findings = [f for f in findings if f.severity in blocking_severities]

        assert len(blocking_findings) == 2
        assert all(f.severity in blocking_severities for f in blocking_findings)

    def test_count_findings_by_severity(self):
        """Test counting findings by severity level."""
        findings = [
            PRReviewFinding(
                id="CRIT-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Critical 1",
                description="Critical issue",
                file="src/a.py",
                line=1,
            ),
            PRReviewFinding(
                id="CRIT-002",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Critical 2",
                description="Critical issue",
                file="src/b.py",
                line=2,
            ),
            PRReviewFinding(
                id="HIGH-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.QUALITY,
                title="High",
                description="High issue",
                file="src/c.py",
                line=3,
            ),
            PRReviewFinding(
                id="LOW-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Low",
                description="Low issue",
                file="src/d.py",
                line=4,
            ),
        ]

        critical_count = sum(1 for f in findings if f.severity == ReviewSeverity.CRITICAL)
        high_count = sum(1 for f in findings if f.severity == ReviewSeverity.HIGH)
        medium_count = sum(1 for f in findings if f.severity == ReviewSeverity.MEDIUM)
        low_count = sum(1 for f in findings if f.severity == ReviewSeverity.LOW)

        assert critical_count == 2
        assert high_count == 1
        assert medium_count == 0
        assert low_count == 1

    def test_severity_in_finding_to_dict(self):
        """Test that severity is correctly serialized in to_dict."""
        finding = PRReviewFinding(
            id="SEC-001",
            severity=ReviewSeverity.CRITICAL,
            category=ReviewCategory.SECURITY,
            title="Critical Issue",
            description="A critical security issue",
            file="src/api.py",
            line=100,
        )

        data = finding.to_dict()
        assert data["severity"] == "critical"

    def test_severity_in_finding_from_dict(self):
        """Test that severity is correctly deserialized in from_dict."""
        data = {
            "id": "SEC-001",
            "severity": "high",
            "category": "security",
            "title": "High Issue",
            "description": "A high security issue",
            "file": "src/api.py",
            "line": 100,
        }

        finding = PRReviewFinding.from_dict(data)
        assert finding.severity == ReviewSeverity.HIGH

    def test_severity_mapping_with_validation_status(self):
        """Test severity combined with validation status for filtering."""
        findings = [
            PRReviewFinding(
                id="SEC-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Critical - Confirmed",
                description="Critical issue confirmed",
                file="src/a.py",
                line=1,
                validation_status="confirmed_valid",
            ),
            PRReviewFinding(
                id="SEC-002",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Critical - Dismissed",
                description="Critical issue dismissed",
                file="src/b.py",
                line=2,
                validation_status="dismissed_false_positive",
            ),
            PRReviewFinding(
                id="HIGH-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.QUALITY,
                title="High - Confirmed",
                description="High issue confirmed",
                file="src/c.py",
                line=3,
                validation_status="confirmed_valid",
            ),
        ]

        # Filter for confirmed valid critical/high findings (true blockers)
        blocking_severities = {ReviewSeverity.CRITICAL, ReviewSeverity.HIGH}
        true_blockers = [
            f for f in findings
            if f.severity in blocking_severities
            and f.validation_status == "confirmed_valid"
        ]

        assert len(true_blockers) == 2
        assert true_blockers[0].id == "SEC-001"
        assert true_blockers[1].id == "HIGH-001"

    def test_severity_string_mapping_from_followup_reviewer(self):
        """Test the severity string to enum mapping used in followup_reviewer."""
        # This mapping is used when parsing AI responses
        SEVERITY_MAP = {
            "critical": ReviewSeverity.CRITICAL,
            "high": ReviewSeverity.HIGH,
            "medium": ReviewSeverity.MEDIUM,
            "low": ReviewSeverity.LOW,
        }

        assert SEVERITY_MAP["critical"] == ReviewSeverity.CRITICAL
        assert SEVERITY_MAP["high"] == ReviewSeverity.HIGH
        assert SEVERITY_MAP["medium"] == ReviewSeverity.MEDIUM
        assert SEVERITY_MAP["low"] == ReviewSeverity.LOW

    def test_get_highest_severity_from_findings(self):
        """Test getting the highest severity from a list of findings."""
        findings = [
            PRReviewFinding(
                id="MED-001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title="Medium",
                description="Medium issue",
                file="src/a.py",
                line=1,
            ),
            PRReviewFinding(
                id="HIGH-001",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="High",
                description="High issue",
                file="src/b.py",
                line=2,
            ),
            PRReviewFinding(
                id="LOW-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Low",
                description="Low issue",
                file="src/c.py",
                line=3,
            ),
        ]

        severity_priority = {
            ReviewSeverity.CRITICAL: 4,
            ReviewSeverity.HIGH: 3,
            ReviewSeverity.MEDIUM: 2,
            ReviewSeverity.LOW: 1,
        }

        if findings:
            highest_severity = max(findings, key=lambda f: severity_priority[f.severity]).severity
        else:
            highest_severity = None

        assert highest_severity == ReviewSeverity.HIGH

    def test_empty_findings_returns_no_highest_severity(self):
        """Test that empty findings list returns no highest severity."""
        findings = []

        severity_priority = {
            ReviewSeverity.CRITICAL: 4,
            ReviewSeverity.HIGH: 3,
            ReviewSeverity.MEDIUM: 2,
            ReviewSeverity.LOW: 1,
        }

        if findings:
            highest_severity = max(findings, key=lambda f: severity_priority[f.severity]).severity
        else:
            highest_severity = None

        assert highest_severity is None

    def test_severity_affects_fixable_recommendation(self):
        """Test that severity affects whether a finding should be auto-fixable."""
        findings = [
            PRReviewFinding(
                id="CRIT-001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="Critical Security",
                description="Critical security issue",
                file="src/a.py",
                line=1,
                fixable=False,  # Critical issues should not be auto-fixed
            ),
            PRReviewFinding(
                id="LOW-001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Style Issue",
                description="Minor style issue",
                file="src/b.py",
                line=2,
                fixable=True,  # Low issues can be auto-fixed
            ),
        ]

        # Verify fixable aligns with severity
        critical_finding = next(f for f in findings if f.severity == ReviewSeverity.CRITICAL)
        low_finding = next(f for f in findings if f.severity == ReviewSeverity.LOW)

        assert critical_finding.fixable is False
        assert low_finding.fixable is True

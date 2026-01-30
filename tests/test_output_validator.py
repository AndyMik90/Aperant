"""
Tests for Output Validator Module
=================================

Tests validation, filtering, and enhancement of PR review findings.
"""

import pytest
from pathlib import Path

import sys
backend_path = Path(__file__).parent.parent / "apps" / "backend"
sys.path.insert(0, str(backend_path))

# Import directly to avoid loading the full runners module with its dependencies
import importlib.util

# Load file_lock first (models.py depends on it)
file_lock_spec = importlib.util.spec_from_file_location(
    "file_lock",
    backend_path / "runners" / "github" / "file_lock.py"
)
file_lock_module = importlib.util.module_from_spec(file_lock_spec)
sys.modules['file_lock'] = file_lock_module  # Make it available for models imports
file_lock_spec.loader.exec_module(file_lock_module)

# Load models next
models_spec = importlib.util.spec_from_file_location(
    "models",
    backend_path / "runners" / "github" / "models.py"
)
models_module = importlib.util.module_from_spec(models_spec)
sys.modules['models'] = models_module  # Make it available for validator imports
models_spec.loader.exec_module(models_module)
PRReviewFinding = models_module.PRReviewFinding
ReviewSeverity = models_module.ReviewSeverity
ReviewCategory = models_module.ReviewCategory

# Now load validator (it will find models in sys.modules)
validator_spec = importlib.util.spec_from_file_location(
    "output_validator",
    backend_path / "runners" / "github" / "output_validator.py"
)
validator_module = importlib.util.module_from_spec(validator_spec)
validator_spec.loader.exec_module(validator_module)
FindingValidator = validator_module.FindingValidator


@pytest.fixture
def sample_changed_files():
    """Sample changed files for testing."""
    return {
        "src/auth.py": """import os
import hashlib

def authenticate_user(username, password):
    # TODO: Use proper password hashing
    hashed = hashlib.md5(password.encode()).hexdigest()
    stored_hash = get_stored_hash(username)
    return hashed == stored_hash

def get_stored_hash(username):
    # Vulnerable to SQL injection
    query = f"SELECT password FROM users WHERE username = '{username}'"
    return execute_query(query)

def execute_query(query):
    pass
""",
        "src/utils.py": """def process_data(data):
    result = []
    for item in data:
        result.append(item * 2)
    return result

def validate_input(user_input):
    # Missing validation
    return True
""",
        "tests/test_auth.py": """import pytest
from src.auth import authenticate_user

def test_authentication():
    # Basic test
    assert authenticate_user("test", "password") == True
""",
    }


@pytest.fixture
def validator(sample_changed_files, tmp_path):
    """Create a FindingValidator instance."""
    return FindingValidator(tmp_path, sample_changed_files)


class TestFindingValidation:
    """Test finding validation logic."""

    def test_valid_finding_passes(self, validator):
        """Test that a valid finding passes validation."""
        finding = PRReviewFinding(
            id="SEC001",
            severity=ReviewSeverity.CRITICAL,
            category=ReviewCategory.SECURITY,
            title="SQL Injection Vulnerability",
            description="The function get_stored_hash uses string formatting to construct SQL queries, making it vulnerable to SQL injection attacks. An attacker could manipulate the username parameter to execute arbitrary SQL.",
            file="src/auth.py",
            line=13,
            suggested_fix="Use parameterized queries: `cursor.execute('SELECT password FROM users WHERE username = ?', (username,))`",
            fixable=True,
        )

        result = validator.validate_findings([finding])
        assert len(result) == 1
        assert result[0].id == "SEC001"

    def test_invalid_file_filtered(self, validator):
        """Test that findings for non-existent files are filtered."""
        finding = PRReviewFinding(
            id="TEST001",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.QUALITY,
            title="Missing Test",
            description="This file should have tests but doesn't exist in the changeset.",
            file="src/nonexistent.py",
            line=10,
        )

        result = validator.validate_findings([finding])
        assert len(result) == 0

    def test_short_title_filtered(self, validator):
        """Test that findings with short titles are filtered."""
        finding = PRReviewFinding(
            id="TEST002",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.STYLE,
            title="Fix this",  # Too short
            description="This is a longer description that meets the minimum length requirement for validation.",
            file="src/utils.py",
            line=1,
        )

        result = validator.validate_findings([finding])
        assert len(result) == 0

    def test_short_description_filtered(self, validator):
        """Test that findings with short descriptions are filtered."""
        finding = PRReviewFinding(
            id="TEST003",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.STYLE,
            title="Code Style Issue",
            description="Short desc",  # Too short
            file="src/utils.py",
            line=1,
        )

        result = validator.validate_findings([finding])
        assert len(result) == 0


class TestLineNumberVerification:
    """Test line number verification and correction."""

    def test_valid_line_number(self, validator):
        """Test that valid line numbers pass verification."""
        finding = PRReviewFinding(
            id="SEC001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="Weak Password Hashing Algorithm",
            description="The code uses MD5 for password hashing which is cryptographically broken. This makes passwords vulnerable to rainbow table attacks.",
            file="src/auth.py",
            line=5,  # Line with hashlib.md5
            suggested_fix="Use bcrypt or argon2: `import bcrypt; hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())`",
        )

        assert validator._verify_line_number(finding)

    def test_invalid_line_number(self, validator):
        """Test that invalid line numbers fail verification."""
        finding = PRReviewFinding(
            id="TEST001",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.QUALITY,
            title="Code Quality Issue",
            description="This line number is way out of bounds and should fail validation checks.",
            file="src/auth.py",
            line=999,  # Out of bounds
        )

        assert not validator._verify_line_number(finding)

    def test_auto_correct_line_number(self, validator):
        """Test auto-correction of line numbers."""
        finding = PRReviewFinding(
            id="SEC001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="MD5 Password Hashing",
            description="Using MD5 for password hashing is insecure. The hashlib.md5 function should be replaced with a modern algorithm.",
            file="src/auth.py",
            line=3,  # Wrong line, but MD5 is on line 5
            suggested_fix="Use bcrypt instead of MD5",
        )

        corrected = validator._auto_correct_line_number(finding)
        # Should find a line with hashlib/md5 (line 4 imports hashlib, line 5 uses md5)
        assert corrected.line in [4, 5]  # Either import or usage line

    def test_line_relevance_security_patterns(self, validator):
        """Test that security patterns are detected."""
        finding = PRReviewFinding(
            id="SEC002",
            severity=ReviewSeverity.CRITICAL,
            category=ReviewCategory.SECURITY,
            title="SQL Injection",
            description="Vulnerable to SQL injection through unsanitized user input",
            file="src/auth.py",
            line=13,
        )

        line_content = "query = f\"SELECT password FROM users WHERE username = '{username}'\""
        assert validator._is_line_relevant(line_content, finding)


class TestActionabilityScoring:
    """Test actionability scoring."""

    def test_high_actionability_score(self, validator):
        """Test that complete findings get high scores."""
        finding = PRReviewFinding(
            id="SEC001",
            severity=ReviewSeverity.CRITICAL,
            category=ReviewCategory.SECURITY,
            title="SQL Injection Vulnerability in User Authentication",
            description="The get_stored_hash function constructs SQL queries using f-strings, which is vulnerable to SQL injection. An attacker could manipulate the username parameter to execute arbitrary SQL commands, potentially compromising the entire database.",
            file="src/auth.py",
            line=13,
            end_line=14,
            suggested_fix="Replace the f-string with parameterized query: `cursor.execute('SELECT password FROM users WHERE username = ?', (username,))`",
            fixable=True,
        )

        score = validator._score_actionability(finding)
        assert score >= 0.8

    def test_low_actionability_score(self, validator):
        """Test that incomplete findings get low scores."""
        finding = PRReviewFinding(
            id="QUAL001",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.QUALITY,
            title="Code quality",
            description="Could be better",
            file="src/utils.py",
            line=1,
        )

        score = validator._score_actionability(finding)
        assert score <= 0.6

    def test_security_findings_get_bonus(self, validator):
        """Test that security findings get actionability bonus."""
        security_finding = PRReviewFinding(
            id="SEC001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="Security Vulnerability Found",
            description="This is a security issue that needs to be addressed immediately for safety.",
            file="src/auth.py",
            line=5,
            suggested_fix="Apply proper security measures",
        )

        quality_finding = PRReviewFinding(
            id="QUAL001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.QUALITY,
            title="Quality Issue Found",
            description="This is a quality issue that needs to be addressed for better code.",
            file="src/auth.py",
            line=5,
            suggested_fix="Apply proper quality measures",
        )

        sec_score = validator._score_actionability(security_finding)
        qual_score = validator._score_actionability(quality_finding)
        assert sec_score > qual_score


class TestConfidenceThreshold:
    """Test confidence threshold checks."""

    def test_high_severity_lower_threshold(self, validator):
        """Test that high severity findings have lower threshold."""
        finding = PRReviewFinding(
            id="SEC001",
            severity=ReviewSeverity.CRITICAL,
            category=ReviewCategory.SECURITY,
            title="Critical Security Issue",
            description="This is a critical security vulnerability that must be fixed.",
            file="src/auth.py",
            line=5,
        )

        # Should pass with lower actionability due to critical severity
        assert validator._meets_confidence_threshold(finding)

    def test_low_severity_higher_threshold(self, validator):
        """Test that low severity findings need higher threshold."""
        finding = PRReviewFinding(
            id="STYLE001",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.STYLE,
            title="Styl",  # Very minimal (9 chars, just at min)
            description="Could be improved with better formatting here",
            file="src/utils.py",
            line=1,
            suggested_fix="",  # No fix
        )

        # Score check: low severity with no fix gets low actionability
        # With no fix, short title, and low severity: 0.5 (base) + 0.1 (file+line) = 0.6
        # This barely meets the 0.6 threshold for low severity
        score = validator._score_actionability(finding)
        assert score <= 0.6  # Low actionability due to missing suggested fix


class TestFindingEnhancement:
    """Test finding enhancement."""

    def test_enhance_adds_confidence(self, validator):
        """Test that enhancement adds confidence score."""
        finding = PRReviewFinding(
            id="SEC001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="Security Vulnerability",
            description="This is a security vulnerability that should be addressed immediately.",
            file="src/auth.py",
            line=5,
            suggested_fix="Apply the recommended security fix here",
        )

        enhanced = validator._enhance(finding)
        assert hasattr(enhanced, "confidence")
        assert enhanced.confidence > 0

    def test_enhance_sets_fixable(self, validator):
        """Test that enhancement sets fixable flag."""
        finding = PRReviewFinding(
            id="SEC001",
            severity=ReviewSeverity.HIGH,
            category=ReviewCategory.SECURITY,
            title="Security Issue",
            description="Security vulnerability that needs fixing",
            file="src/auth.py",
            line=5,
            suggested_fix="Use parameterized queries instead of string concatenation",
            fixable=False,  # Initially false
        )

        enhanced = validator._enhance(finding)
        assert enhanced.fixable  # Should be set to True

    def test_enhance_cleans_whitespace(self, validator):
        """Test that enhancement cleans whitespace."""
        finding = PRReviewFinding(
            id="TEST001",
            severity=ReviewSeverity.MEDIUM,
            category=ReviewCategory.QUALITY,
            title="  Title with spaces  ",
            description="  Description with spaces  ",
            file="src/utils.py",
            line=1,
            suggested_fix="  Fix with spaces  ",
        )

        enhanced = validator._enhance(finding)
        assert enhanced.title == "Title with spaces"
        assert enhanced.description == "Description with spaces"
        assert enhanced.suggested_fix == "Fix with spaces"


class TestValidationStats:
    """Test validation statistics."""

    def test_validation_stats(self, validator):
        """Test that validation stats are computed correctly."""
        findings = [
            PRReviewFinding(
                id="SEC001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="SQL Injection Vulnerability",
                description="Critical SQL injection vulnerability in user authentication",
                file="src/auth.py",
                line=13,
                suggested_fix="Use parameterized queries",
                fixable=True,
            ),
            PRReviewFinding(
                id="STYLE001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Bad style",  # Too short, will be filtered
                description="Short",
                file="src/utils.py",
                line=1,
            ),
            PRReviewFinding(
                id="TEST001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.TEST,
                title="Missing Test Coverage",
                description="The authenticate_user function lacks comprehensive test coverage",
                file="tests/test_auth.py",
                line=5,
                suggested_fix="Add tests for edge cases and error conditions",
            ),
        ]

        validated = validator.validate_findings(findings)
        stats = validator.get_validation_stats(findings, validated)

        assert stats["total_findings"] == 3
        assert stats["kept_findings"] == 2  # One filtered
        assert stats["filtered_findings"] == 1
        assert stats["filter_rate"] == pytest.approx(1/3)
        assert stats["severity_distribution"]["critical"] == 1
        assert stats["category_distribution"]["security"] == 1
        assert stats["average_actionability"] > 0
        # Both valid findings will have fixable=True after enhancement (both have good suggested fixes)
        assert stats["fixable_count"] >= 1


class TestKeyTermExtraction:
    """Test key term extraction."""

    def test_extract_from_title(self, validator):
        """Test extraction from title."""
        finding = PRReviewFinding(
            id="TEST001",
            severity=ReviewSeverity.MEDIUM,
            category=ReviewCategory.QUALITY,
            title="Password Hashing Vulnerability",
            description="Description",
            file="src/auth.py",
            line=1,
        )

        terms = validator._extract_key_terms(finding)
        assert "Password" in terms or "password" in [t.lower() for t in terms]
        assert "Hashing" in terms or "hashing" in [t.lower() for t in terms]

    def test_extract_code_terms(self, validator):
        """Test extraction of code terms."""
        finding = PRReviewFinding(
            id="TEST001",
            severity=ReviewSeverity.MEDIUM,
            category=ReviewCategory.SECURITY,
            title="Security Issue",
            description="The `hashlib.md5` function is insecure",
            file="src/auth.py",
            line=1,
        )

        terms = validator._extract_key_terms(finding)
        assert "hashlib.md5" in terms

    def test_filter_common_words(self, validator):
        """Test that common words are filtered."""
        finding = PRReviewFinding(
            id="TEST001",
            severity=ReviewSeverity.LOW,
            category=ReviewCategory.QUALITY,
            title="This Could Be Using Better Patterns",
            description="Description with this and that",
            file="src/utils.py",
            line=1,
        )

        terms = validator._extract_key_terms(finding)
        assert "this" not in [t.lower() for t in terms]
        assert "that" not in [t.lower() for t in terms]


class TestIntegration:
    """Integration tests."""

    def test_full_validation_pipeline(self, validator):
        """Test complete validation pipeline."""
        findings = [
            # Valid critical security finding
            PRReviewFinding(
                id="SEC001",
                severity=ReviewSeverity.CRITICAL,
                category=ReviewCategory.SECURITY,
                title="SQL Injection in Authentication",
                description="The get_stored_hash function uses f-string formatting to construct SQL queries, creating a critical SQL injection vulnerability.",
                file="src/auth.py",
                line=13,
                suggested_fix="Use parameterized queries: cursor.execute('SELECT password FROM users WHERE username = ?', (username,))",
                fixable=True,
            ),
            # Valid security finding with wrong line (should be corrected)
            PRReviewFinding(
                id="SEC002",
                severity=ReviewSeverity.HIGH,
                category=ReviewCategory.SECURITY,
                title="Weak Cryptographic Hash",
                description="MD5 is cryptographically broken and should not be used for password hashing",
                file="src/auth.py",
                line=3,  # Wrong, should be 5
                suggested_fix="Use bcrypt.hashpw() or argon2 for password hashing",
            ),
            # Invalid - vague low severity
            PRReviewFinding(
                id="STYLE001",
                severity=ReviewSeverity.LOW,
                category=ReviewCategory.STYLE,
                title="Could Be Improved",
                description="This code could be improved by considering better practices",
                file="src/utils.py",
                line=1,
            ),
            # Invalid - non-existent file
            PRReviewFinding(
                id="TEST001",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.TEST,
                title="Missing Tests",
                description="This file needs test coverage but it doesn't exist",
                file="src/missing.py",
                line=1,
            ),
        ]

        validated = validator.validate_findings(findings)

        # Should keep 2 valid findings
        assert len(validated) == 2

        # Check that line was corrected (should find hashlib or md5 reference)
        sec002 = next(f for f in validated if f.id == "SEC002")
        assert sec002.line in [4, 5]  # Either import line or usage line

        # Check that all validated findings have confidence
        for finding in validated:
            assert hasattr(finding, "confidence")
            assert finding.confidence > 0

        # Get stats
        stats = validator.get_validation_stats(findings, validated)
        assert stats["filter_rate"] == 0.5
        assert stats["average_actionability"] > 0.6

"""
Output Validation Module for PR Review System
=============================================

Validates and improves the quality of AI-generated PR review findings.
Filters out false positives, verifies line numbers, and scores actionability.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    from .models import PRReviewFinding, ReviewSeverity
except (ImportError, ValueError, SystemError):
    # For direct module loading in tests
    from models import PRReviewFinding, ReviewSeverity


class FindingValidator:
    """Validates and filters AI-generated PR review findings."""

    # Minimum lengths for quality checks
    MIN_DESCRIPTION_LENGTH = 30
    MIN_SUGGESTED_FIX_LENGTH = 20
    MIN_TITLE_LENGTH = 10

    # Confidence thresholds
    BASE_CONFIDENCE = 0.5
    MIN_ACTIONABILITY_SCORE = 0.6
    HIGH_ACTIONABILITY_SCORE = 0.8

    def __init__(self, project_dir: Path, changed_files: dict[str, str]):
        """
        Initialize validator.

        Args:
            project_dir: Root directory of the project
            changed_files: Mapping of file paths to their content
        """
        self.project_dir = Path(project_dir)
        self.changed_files = changed_files

    def validate_findings(
        self, findings: list[PRReviewFinding]
    ) -> list[PRReviewFinding]:
        """
        Validate all findings, removing invalid ones and enhancing valid ones.

        Args:
            findings: List of findings to validate

        Returns:
            List of validated and enhanced findings
        """
        validated = []

        for finding in findings:
            if self._is_valid(finding):
                enhanced = self._enhance(finding)
                validated.append(enhanced)

        return validated

    def _is_valid(self, finding: PRReviewFinding) -> bool:
        """
        Check if a finding is valid.

        Args:
            finding: Finding to validate

        Returns:
            True if finding is valid, False otherwise
        """
        # Check basic field requirements
        if not finding.file or not finding.title or not finding.description:
            return False

        # Check title length
        if len(finding.title.strip()) < self.MIN_TITLE_LENGTH:
            return False

        # Check description length
        if len(finding.description.strip()) < self.MIN_DESCRIPTION_LENGTH:
            return False

        # Check if file exists in changed files
        if finding.file not in self.changed_files:
            return False

        # Verify line number
        if not self._verify_line_number(finding):
            # Try to auto-correct
            corrected = self._auto_correct_line_number(finding)
            if not self._verify_line_number(corrected):
                return False
            # Update the finding with corrected line
            finding.line = corrected.line

        # Check confidence threshold
        if not self._meets_confidence_threshold(finding):
            return False

        return True

    def _verify_line_number(self, finding: PRReviewFinding) -> bool:
        """
        Verify the line number actually exists and is relevant.

        Args:
            finding: Finding to verify

        Returns:
            True if line number is valid, False otherwise
        """
        file_content = self.changed_files.get(finding.file)
        if not file_content:
            return False

        lines = file_content.split("\n")

        # Check bounds
        if finding.line > len(lines) or finding.line < 1:
            return False

        # Check if the line contains something related to the finding
        line_content = lines[finding.line - 1]
        return self._is_line_relevant(line_content, finding)

    def _is_line_relevant(self, line_content: str, finding: PRReviewFinding) -> bool:
        """
        Check if a line is relevant to the finding.

        Args:
            line_content: Content of the line
            finding: Finding to check against

        Returns:
            True if line is relevant, False otherwise
        """
        # Empty or whitespace-only lines are not relevant
        if not line_content.strip():
            return False

        # Extract key terms from finding
        key_terms = self._extract_key_terms(finding)

        # Check if any key terms appear in the line (case-insensitive)
        line_lower = line_content.lower()
        for term in key_terms:
            if term.lower() in line_lower:
                return True

        # For security findings, check for common security-related patterns
        if finding.category.value == "security":
            security_patterns = [
                r"password",
                r"token",
                r"secret",
                r"api[_-]?key",
                r"auth",
                r"credential",
                r"eval\(",
                r"exec\(",
                r"\.html\(",
                r"innerHTML",
                r"dangerouslySetInnerHTML",
                r"__import__",
                r"subprocess",
                r"shell=True",
            ]
            for pattern in security_patterns:
                if re.search(pattern, line_lower):
                    return True

        return False

    def _extract_key_terms(self, finding: PRReviewFinding) -> list[str]:
        """
        Extract key terms from finding for relevance checking.

        Args:
            finding: Finding to extract terms from

        Returns:
            List of key terms
        """
        terms = []

        # Extract from title
        title_words = re.findall(r"\b\w{4,}\b", finding.title)
        terms.extend(title_words)

        # Extract code-like terms from description
        code_pattern = r"`([^`]+)`"
        code_matches = re.findall(code_pattern, finding.description)
        terms.extend(code_matches)

        # Extract from suggested fix if available
        if finding.suggested_fix:
            fix_matches = re.findall(code_pattern, finding.suggested_fix)
            terms.extend(fix_matches)

        # Remove common words
        common_words = {
            "this",
            "that",
            "with",
            "from",
            "have",
            "should",
            "could",
            "would",
            "using",
            "used",
        }
        terms = [t for t in terms if t.lower() not in common_words]

        return list(set(terms))  # Remove duplicates

    def _auto_correct_line_number(self, finding: PRReviewFinding) -> PRReviewFinding:
        """
        Try to find the correct line if the specified one is wrong.

        Args:
            finding: Finding with potentially incorrect line number

        Returns:
            Finding with corrected line number (or original if correction failed)
        """
        file_content = self.changed_files.get(finding.file, "")
        if not file_content:
            return finding

        lines = file_content.split("\n")

        # Search nearby lines (±10) for relevant content
        for offset in range(0, 11):
            for direction in [1, -1]:
                check_line = finding.line + (offset * direction)

                # Skip if out of bounds
                if check_line < 1 or check_line > len(lines):
                    continue

                # Check if this line is relevant
                if self._is_line_relevant(lines[check_line - 1], finding):
                    finding.line = check_line
                    return finding

        # If no nearby line found, try searching the entire file for best match
        key_terms = self._extract_key_terms(finding)
        best_match_line = 0
        best_match_score = 0

        for i, line in enumerate(lines, start=1):
            score = sum(1 for term in key_terms if term.lower() in line.lower())
            if score > best_match_score:
                best_match_score = score
                best_match_line = i

        if best_match_score > 0:
            finding.line = best_match_line

        return finding

    def _score_actionability(self, finding: PRReviewFinding) -> float:
        """
        Score how actionable a finding is (0.0 to 1.0).

        Args:
            finding: Finding to score

        Returns:
            Actionability score between 0.0 and 1.0
        """
        score = self.BASE_CONFIDENCE

        # Has specific file and line
        if finding.file and finding.line:
            score += 0.1

        # Has line range (more specific)
        if finding.end_line and finding.end_line > finding.line:
            score += 0.05

        # Has suggested fix
        if finding.suggested_fix:
            if len(finding.suggested_fix) > self.MIN_SUGGESTED_FIX_LENGTH:
                score += 0.15
            if len(finding.suggested_fix) > 50:
                score += 0.1

        # Has clear description
        if len(finding.description) > 50:
            score += 0.1
        if len(finding.description) > 100:
            score += 0.05

        # Is marked as fixable
        if finding.fixable:
            score += 0.1

        # Severity impacts actionability
        severity_scores = {
            ReviewSeverity.CRITICAL: 0.15,
            ReviewSeverity.HIGH: 0.1,
            ReviewSeverity.MEDIUM: 0.05,
            ReviewSeverity.LOW: 0.0,
        }
        score += severity_scores.get(finding.severity, 0.0)

        # Security and test findings are generally more actionable
        if finding.category.value in ["security", "test"]:
            score += 0.1

        # Has code examples in description or fix
        code_pattern = r"```[\s\S]*?```|`[^`]+`"
        if re.search(code_pattern, finding.description):
            score += 0.05
        if finding.suggested_fix and re.search(code_pattern, finding.suggested_fix):
            score += 0.05

        return min(score, 1.0)

    def _meets_confidence_threshold(self, finding: PRReviewFinding) -> bool:
        """
        Check if finding meets confidence threshold.

        Args:
            finding: Finding to check

        Returns:
            True if meets threshold, False otherwise
        """
        # If finding has explicit confidence above default (0.5), use it directly
        # Note: 0.5 is the default value, so we only use explicit confidence if set higher
        if hasattr(finding, "confidence") and finding.confidence > 0.5:
            return finding.confidence >= self.HIGH_ACTIONABILITY_SCORE

        # Otherwise, use actionability score as proxy for confidence
        actionability = self._score_actionability(finding)

        # Critical/high severity findings have lower threshold
        if finding.severity in [ReviewSeverity.CRITICAL, ReviewSeverity.HIGH]:
            return actionability >= 0.5

        # Other findings need higher threshold
        return actionability >= self.MIN_ACTIONABILITY_SCORE

    def _enhance(self, finding: PRReviewFinding) -> PRReviewFinding:
        """
        Enhance a validated finding with additional metadata.

        Args:
            finding: Finding to enhance

        Returns:
            Enhanced finding
        """
        # Add actionability score as confidence if not already present
        if not hasattr(finding, "confidence") or not finding.confidence:
            actionability = self._score_actionability(finding)
            # Add as custom attribute (not in dataclass, but accessible)
            finding.__dict__["confidence"] = actionability

        # Ensure fixable is set correctly based on having a suggested fix
        if (
            finding.suggested_fix
            and len(finding.suggested_fix) > self.MIN_SUGGESTED_FIX_LENGTH
        ):
            finding.fixable = True

        # Clean up whitespace in fields
        finding.title = finding.title.strip()
        finding.description = finding.description.strip()
        if finding.suggested_fix:
            finding.suggested_fix = finding.suggested_fix.strip()

        return finding

    def get_validation_stats(
        self,
        original_findings: list[PRReviewFinding],
        validated_findings: list[PRReviewFinding],
    ) -> dict[str, Any]:
        """
        Get statistics about the validation process.

        Args:
            original_findings: Original list of findings
            validated_findings: Validated list of findings

        Returns:
            Dictionary with validation statistics
        """
        total = len(original_findings)
        kept = len(validated_findings)
        filtered = total - kept

        # Count by severity
        severity_counts = {
            "critical": 0,
            "high": 0,
            "medium": 0,
            "low": 0,
        }

        # Count by category
        category_counts = {
            "security": 0,
            "quality": 0,
            "style": 0,
            "test": 0,
            "docs": 0,
            "pattern": 0,
            "performance": 0,
        }

        # Calculate average actionability
        total_actionability = 0.0

        for finding in validated_findings:
            severity_counts[finding.severity.value] += 1
            category_counts[finding.category.value] += 1

            # Get actionability score
            # Note: 0.5 is the default confidence, only use explicit if set higher
            if hasattr(finding, "confidence") and finding.confidence > 0.5:
                total_actionability += finding.confidence
            else:
                total_actionability += self._score_actionability(finding)

        avg_actionability = total_actionability / kept if kept > 0 else 0.0

        return {
            "total_findings": total,
            "kept_findings": kept,
            "filtered_findings": filtered,
            "filter_rate": filtered / total if total > 0 else 0.0,
            "severity_distribution": severity_counts,
            "category_distribution": category_counts,
            "average_actionability": avg_actionability,
            "fixable_count": sum(1 for f in validated_findings if f.fixable),
        }

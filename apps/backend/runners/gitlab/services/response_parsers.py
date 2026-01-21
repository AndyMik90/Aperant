"""
Response Parsers
================

JSON parsing utilities for AI responses. Ported from GitHub to GitLab.
"""

from __future__ import annotations

import json
import re

try:
    from ..models import (
        AICommentTriage,
        MRReviewFinding,
        ReviewCategory,
        ReviewSeverity,
        StructuralIssue,
        TriageCategory,
        TriageResult,
    )
except (ImportError, ValueError, SystemError):
    from models import (
        AICommentTriage,
        MRReviewFinding,
        ReviewCategory,
        ReviewSeverity,
        StructuralIssue,
        TriageCategory,
        TriageResult,
    )


# Evidence-based validation replaces confidence scoring
MIN_EVIDENCE_LENGTH = 20  # Minimum chars for evidence to be considered valid


def safe_print(msg: str, **kwargs) -> None:
    """Thread-safe print helper."""
    print(msg, **kwargs)


class ResponseParser:
    """Parses AI responses into structured data."""

    @staticmethod
    def parse_review_findings(
        response_text: str, require_evidence: bool = True
    ) -> list[MRReviewFinding]:
        """Parse findings from AI response with optional evidence validation.

        Evidence-based validation: Instead of confidence scores, findings
        require actual code evidence proving the issue exists.
        """
        findings = []

        try:
            json_match = re.search(
                r"```json\s*(\[.*?\])\s*```", response_text, re.DOTALL
            )
            if json_match:
                findings_data = json.loads(json_match.group(1))
                for i, f in enumerate(findings_data):
                    # Get evidence (code snippet proving the issue)
                    evidence = f.get("evidence") or f.get("code_snippet") or ""

                    # Apply evidence-based validation
                    if require_evidence and len(evidence.strip()) < MIN_EVIDENCE_LENGTH:
                        safe_print(
                            f"[AI] Dropped finding '{f.get('title', 'unknown')}': "
                            f"insufficient evidence ({len(evidence.strip())} chars < {MIN_EVIDENCE_LENGTH})",
                            flush=True,
                        )
                        continue

                    findings.append(
                        MRReviewFinding(
                            id=f.get("id", f"finding-{i + 1}"),
                            severity=ReviewSeverity(
                                f.get("severity", "medium").lower()
                            ),
                            category=ReviewCategory(
                                f.get("category", "quality").lower()
                            ),
                            title=f.get("title", "Finding"),
                            description=f.get("description", ""),
                            file=f.get("file", "unknown"),
                            line=f.get("line", 1),
                            end_line=f.get("end_line"),
                            suggested_fix=f.get("suggested_fix"),
                            fixable=f.get("fixable", False),
                            evidence_code=evidence if evidence.strip() else None,
                        )
                    )
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            safe_print(f"Failed to parse findings: {e}")

        return findings

    @staticmethod
    def parse_structural_issues(response_text: str) -> list[StructuralIssue]:
        """Parse structural issues from AI response."""
        issues = []

        try:
            json_match = re.search(
                r"```json\s*(\[.*?\])\s*```", response_text, re.DOTALL
            )
            if json_match:
                issues_data = json.loads(json_match.group(1))
                for i, issue in enumerate(issues_data):
                    issues.append(
                        StructuralIssue(
                            id=issue.get("id", f"struct-{i + 1}"),
                            type=issue.get("issue_type", "scope_creep"),
                            severity=ReviewSeverity(
                                issue.get("severity", "medium").lower()
                            ),
                            title=issue.get("title", "Structural issue"),
                            description=issue.get("description", ""),
                            files_affected=issue.get("files_affected", []),
                        )
                    )
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            safe_print(f"Failed to parse structural issues: {e}")

        return issues

    @staticmethod
    def parse_ai_comment_triages(response_text: str) -> list[AICommentTriage]:
        """Parse AI comment triages from AI response."""
        triages = []

        try:
            json_match = re.search(
                r"```json\s*(\[.*?\])\s*```", response_text, re.DOTALL
            )
            if json_match:
                triages_data = json.loads(json_match.group(1))
                for triage in triages_data:
                    triages.append(
                        AICommentTriage(
                            comment_id=str(triage.get("comment_id", "")),
                            tool_name=triage.get("tool_name", "Unknown"),
                            original_comment=triage.get("original_summary", ""),
                            triage_result=triage.get("verdict", "trivial"),
                            reasoning=triage.get("reasoning", ""),
                            file=triage.get("file"),
                            line=triage.get("line"),
                        )
                    )
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            safe_print(f"Failed to parse AI comment triages: {e}")

        return triages

    @staticmethod
    def parse_triage_result(
        issue: dict, response_text: str, project: str
    ) -> TriageResult:
        """Parse triage result from AI response.

        Args:
            issue: GitLab issue dict from API
            response_text: AI response text containing JSON
            project: GitLab project path (namespace/project)
        """
        # Default result
        result = TriageResult(
            issue_iid=issue.get("iid", 0),
            project=project,
            category=TriageCategory.FEATURE,
            confidence=0.5,
        )

        try:
            json_match = re.search(
                r"```json\s*(\{.*?\})\s*```", response_text, re.DOTALL
            )
            if json_match:
                data = json.loads(json_match.group(1))

                category_str = data.get("category", "feature").lower()
                # Map GitHub categories to GitLab categories
                if category_str == "documentation":
                    category_str = "feature"
                if category_str in [c.value for c in TriageCategory]:
                    result.category = TriageCategory(category_str)

                result.confidence = float(data.get("confidence", 0.5))
                result.suggested_labels = data.get("labels_to_add", [])
                result.duplicate_of = data.get("duplicate_of")
                result.suggested_response = data.get("comment", "")
                result.reasoning = data.get("reasoning", "")

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            safe_print(f"Failed to parse triage result: {e}")

        return result

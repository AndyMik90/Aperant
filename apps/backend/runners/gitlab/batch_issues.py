"""
Issue Batching Service for GitLab
==================================

Groups similar issues together for combined auto-fix:
- Uses Claude AI to analyze issues and suggest optimal batching
- Creates issue clusters for efficient batch processing
- Generates combined specs for issue batches
- Tracks batch state and progress

Ported from GitHub with GitLab API adaptations.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class GitlabBatchStatus(str, Enum):
    """Status of an issue batch."""

    PENDING = "pending"
    ANALYZING = "analyzing"
    CREATING_SPEC = "creating_spec"
    BUILDING = "building"
    QA_REVIEW = "qa_review"
    MR_CREATED = "mr_created"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class GitlabIssueBatchItem:
    """An issue within a batch."""

    issue_iid: int  # GitLab uses iid instead of number
    title: str
    body: str
    labels: list[str] = field(default_factory=list)
    similarity_to_primary: float = 1.0  # Primary issue has 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "issue_iid": self.issue_iid,
            "title": self.title,
            "body": self.body,
            "labels": self.labels,
            "similarity_to_primary": self.similarity_to_primary,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GitlabIssueBatchItem:
        return cls(
            issue_iid=data["issue_iid"],
            title=data["title"],
            body=data.get("body", ""),
            labels=data.get("labels", []),
            similarity_to_primary=data.get("similarity_to_primary", 1.0),
        )


@dataclass
class GitlabIssueBatch:
    """A batch of related GitLab issues to be fixed together."""

    batch_id: str
    project: str  # namespace/project format
    primary_issue: int  # The "anchor" issue iid for the batch
    issues: list[GitlabIssueBatchItem]
    common_themes: list[str] = field(default_factory=list)
    status: GitlabBatchStatus = GitlabBatchStatus.PENDING
    spec_id: str | None = None
    mr_iid: int | None = None  # GitLab MR IID (not database ID)
    mr_url: str | None = None
    error: str | None = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    # AI validation results
    validated: bool = False
    validation_confidence: float = 0.0
    validation_reasoning: str = ""
    theme: str = ""  # Refined theme from validation

    def to_dict(self) -> dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "project": self.project,
            "primary_issue": self.primary_issue,
            "issues": [i.to_dict() for i in self.issues],
            "common_themes": self.common_themes,
            "status": self.status.value,
            "spec_id": self.spec_id,
            "mr_iid": self.mr_iid,
            "mr_url": self.mr_url,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "validated": self.validated,
            "validation_confidence": self.validation_confidence,
            "validation_reasoning": self.validation_reasoning,
            "theme": self.theme,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GitlabIssueBatch:
        return cls(
            batch_id=data["batch_id"],
            project=data["project"],
            primary_issue=data["primary_issue"],
            issues=[GitlabIssueBatchItem.from_dict(i) for i in data.get("issues", [])],
            common_themes=data.get("common_themes", []),
            status=GitlabBatchStatus(data.get("status", "pending")),
            spec_id=data.get("spec_id"),
            mr_iid=data.get("mr_iid"),
            mr_url=data.get("mr_url"),
            error=data.get("error"),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            updated_at=data.get("updated_at", datetime.now(timezone.utc).isoformat()),
            validated=data.get("validated", False),
            validation_confidence=data.get("validation_confidence", 0.0),
            validation_reasoning=data.get("validation_reasoning", ""),
            theme=data.get("theme", ""),
        )


class ClaudeGitlabBatchAnalyzer:
    """
    Claude-based batch analyzer for GitLab issues.

    Uses a single Claude call to analyze a group of issues and suggest
    optimal batching, avoiding O(n²) pairwise comparisons.
    """

    def __init__(self, project_dir: Path | None = None):
        """Initialize Claude batch analyzer."""
        self.project_dir = project_dir or Path.cwd()
        logger.info(
            f"[BATCH_ANALYZER] Initialized with project_dir: {self.project_dir}"
        )

    async def analyze_and_batch_issues(
        self,
        issues: list[dict[str, Any]],
        max_batch_size: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Analyze a group of issues and suggest optimal batches.

        Uses a SINGLE Claude call to analyze all issues and group them intelligently.

        Args:
            issues: List of issues to analyze (GitLab format with iid)
            max_batch_size: Maximum issues per batch

        Returns:
            List of batch suggestions, each containing:
            - issue_iids: list of issue IIDs in this batch
            - theme: common theme/description
            - reasoning: why these should be batched
            - confidence: 0.0-1.0
        """
        if not issues:
            return []

        if len(issues) == 1:
            # Single issue = single batch
            return [
                {
                    "issue_iids": [issues[0]["iid"]],
                    "theme": issues[0].get("title", "Single issue"),
                    "reasoning": "Single issue in group",
                    "confidence": 1.0,
                }
            ]

        try:
            import sys

            import claude_agent_sdk  # noqa: F401 - check availability

            backend_path = Path(__file__).parent.parent.parent.parent
            sys.path.insert(0, str(backend_path))
            from core.auth import ensure_claude_code_oauth_token
        except ImportError as e:
            logger.error(f"claude-agent-sdk not available: {e}")
            # Fallback: each issue is its own batch
            return self._fallback_batches(issues)

        # Build issue list for the prompt
        issue_list = "\n".join(
            [
                f"- !{issue['iid']}: {issue.get('title', 'No title')}"
                f"\n  Labels: {', '.join(issue.get('labels', [])) or 'none'}"
                f"\n  Body: {(issue.get('description', '') or '')[:200]}..."
                for issue in issues
            ]
        )

        prompt = f"""Analyze these GitLab issues and group them into batches that should be fixed together.

ISSUES TO ANALYZE:
{issue_list}

RULES:
1. Group issues that share a common root cause or affect the same component
2. Maximum {max_batch_size} issues per batch
3. Issues that are unrelated should be in separate batches (even single-issue batches)
4. Be conservative - only batch issues that clearly belong together
5. Use issue IIDs (e.g., !123) when referring to issues

Respond with JSON only:
{{
  "batches": [
    {{
      "issue_iids": [1, 2, 3],
      "theme": "Authentication issues",
      "reasoning": "All related to login flow",
      "confidence": 0.85
    }},
    {{
      "issue_iids": [4],
      "theme": "UI bug",
      "reasoning": "Unrelated to other issues",
      "confidence": 0.95
    }}
  ]
}}"""

        try:
            ensure_claude_code_oauth_token()

            logger.info(
                f"[BATCH_ANALYZER] Analyzing {len(issues)} issues in single call"
            )

            # Using Sonnet for better analysis (still just 1 call)
            from core.simple_client import create_simple_client

            client = create_simple_client(
                agent_type="batch_analysis",
                model="claude-sonnet-4-5-20250929",
                system_prompt="You are an expert at analyzing GitLab issues and grouping related ones. Respond ONLY with valid JSON. Do NOT use any tools.",
                cwd=self.project_dir,
            )

            async with client:
                await client.query(prompt)
                response_text = await self._collect_response(client)

            logger.info(
                f"[BATCH_ANALYZER] Received response: {len(response_text)} chars"
            )

            # Parse JSON response
            result = self._parse_json_response(response_text)

            if "batches" in result:
                return result["batches"]
            else:
                logger.warning(
                    "[BATCH_ANALYZER] No batches in response, using fallback"
                )
                return self._fallback_batches(issues)

        except Exception as e:
            logger.error(f"[BATCH_ANALYZER] Error: {e}")
            import traceback

            traceback.print_exc()
            return self._fallback_batches(issues)

    def _parse_json_response(self, response_text: str) -> dict[str, Any]:
        """Parse JSON from Claude response, handling various formats."""
        content = response_text.strip()

        if not content:
            raise ValueError("Empty response")

        # Extract JSON from markdown code blocks if present
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        else:
            # Look for JSON object
            if "{" in content:
                start = content.find("{")
                brace_count = 0
                for i, char in enumerate(content[start:], start):
                    if char == "{":
                        brace_count += 1
                    elif char == "}":
                        brace_count -= 1
                        if brace_count == 0:
                            content = content[start : i + 1]
                            break

        return json.loads(content)

    def _fallback_batches(self, issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Fallback: each issue is its own batch."""
        return [
            {
                "issue_iids": [issue["iid"]],
                "theme": issue.get("title", ""),
                "reasoning": "Fallback: individual batch",
                "confidence": 0.5,
            }
            for issue in issues
        ]

    async def _collect_response(self, client: Any) -> str:
        """Collect text response from Claude client."""
        response_text = ""

        async for msg in client.receive_response():
            msg_type = type(msg).__name__
            if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    if type(block).__name__ == "TextBlock" and hasattr(block, "text"):
                        response_text += block.text

        return response_text


class GitlabIssueBatcher:
    """
    Batches similar GitLab issues for combined auto-fix.

    Uses Claude AI to intelligently group related issues,
    then creates batch specs for efficient processing.
    """

    def __init__(
        self,
        gitlab_dir: Path,
        project: str,
        project_dir: Path,
        similarity_threshold: float = 0.70,
        min_batch_size: int = 1,
        max_batch_size: int = 5,
        validate_batches: bool = True,
    ):
        """
        Initialize the issue batcher.

        Args:
            gitlab_dir: Directory for GitLab state (.auto-claude/gitlab/)
            project: Project in namespace/project format
            project_dir: Root directory of the project
            similarity_threshold: Minimum similarity for batching (0.0-1.0)
            min_batch_size: Minimum issues per batch
            max_batch_size: Maximum issues per batch
            validate_batches: Whether to validate batches with AI
        """
        self.gitlab_dir = Path(gitlab_dir)
        self.project = project
        self.project_dir = Path(project_dir)
        self.similarity_threshold = similarity_threshold
        self.min_batch_size = min_batch_size
        self.max_batch_size = max_batch_size
        self.validate_batches = validate_batches

        self.analyzer = ClaudeGitlabBatchAnalyzer(project_dir)

    async def create_batches(
        self,
        issues: list[dict[str, Any]],
    ) -> list[GitlabIssueBatch]:
        """
        Create batches from a list of issues.

        Args:
            issues: List of GitLab issues (with iid, title, description, labels)

        Returns:
            List of GitlabIssueBatch objects
        """
        logger.info(f"[BATCHER] Creating batches from {len(issues)} issues")

        # Step 1: Get batch suggestions from Claude
        batch_suggestions = await self.analyzer.analyze_and_batch_issues(
            issues,
            max_batch_size=self.max_batch_size,
        )

        # Step 2: Convert suggestions to IssueBatch objects
        batches = []
        for suggestion in batch_suggestions:
            issue_iids = suggestion["issue_iids"]
            batch_issues = [
                GitlabIssueBatchItem(
                    issue_iid=iid,
                    title=next(
                        (i.get("title", "") for i in issues if i["iid"] == iid), ""
                    ),
                    body=next(
                        (i.get("description", "") for i in issues if i["iid"] == iid),
                        "",
                    ),
                    labels=next(
                        (i.get("labels", []) for i in issues if i["iid"] == iid), []
                    ),
                )
                for iid in issue_iids
            ]

            batch = GitlabIssueBatch(
                batch_id=self._generate_batch_id(issue_iids),
                project=self.project,
                primary_issue=issue_iids[0] if issue_iids else 0,
                issues=batch_issues,
                theme=suggestion.get("theme", ""),
                validation_reasoning=suggestion.get("reasoning", ""),
                validation_confidence=suggestion.get("confidence", 0.5),
                validated=True,
            )
            batches.append(batch)

        logger.info(f"[BATCHER] Created {len(batches)} batches")
        return batches

    def _generate_batch_id(self, issue_iids: list[int]) -> str:
        """Generate a unique batch ID from issue IIDs."""
        sorted_iids = sorted(issue_iids)
        return f"batch-{'-'.join(str(iid) for iid in sorted_iids)}"

    def save_batch(self, batch: GitlabIssueBatch) -> None:
        """Save batch state to disk."""
        batches_dir = self.gitlab_dir / "batches"
        batches_dir.mkdir(parents=True, exist_ok=True)

        batch_file = batches_dir / f"{batch.batch_id}.json"
        with open(batch_file, "w", encoding="utf-8") as f:
            json.dump(batch.to_dict(), f, indent=2)

        logger.info(f"[BATCHER] Saved batch {batch.batch_id}")

    @classmethod
    def load_batch(cls, gitlab_dir: Path, batch_id: str) -> GitlabIssueBatch | None:
        """Load a batch from disk."""
        batch_file = gitlab_dir / "batches" / f"{batch_id}.json"
        if not batch_file.exists():
            return None

        with open(batch_file, encoding="utf-8") as f:
            return GitlabIssueBatch.from_dict(json.load(f))

    def list_batches(self) -> list[GitlabIssueBatch]:
        """List all batches."""
        batches_dir = self.gitlab_dir / "batches"
        if not batches_dir.exists():
            return []

        batches = []
        for batch_file in batches_dir.glob("batch-*.json"):
            try:
                with open(batch_file, encoding="utf-8") as f:
                    batch = GitlabIssueBatch.from_dict(json.load(f))
                    batches.append(batch)
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"[BATCHER] Failed to load {batch_file}: {e}")

        return sorted(batches, key=lambda b: b.created_at, reverse=True)


def format_batch_summary(batch: GitlabIssueBatch) -> str:
    """
    Format a batch for display.

    Args:
        batch: The batch to format

    Returns:
        Formatted string representation
    """
    lines = [
        f"Batch: {batch.batch_id}",
        f"Status: {batch.status.value}",
        f"Primary Issue: !{batch.primary_issue}",
        f"Theme: {batch.theme or batch.common_themes[0] if batch.common_themes else 'N/A'}",
        f"Issues ({len(batch.issues)}):",
    ]

    for item in batch.issues:
        lines.append(f"  - !{item.issue_iid}: {item.title}")

    if batch.mr_iid:
        lines.append(f"MR: !{batch.mr_iid}")

    if batch.error:
        lines.append(f"Error: {batch.error}")

    return "\n".join(lines)

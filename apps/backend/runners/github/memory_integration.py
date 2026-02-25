"""
Memory Integration for GitHub Automation
=========================================

Connects the GitHub automation system to the existing Graphiti memory layer for:
- Cross-session context retrieval
- Historical pattern recognition
- Codebase gotchas and quirks
- Similar past reviews and their outcomes

Leverages the existing Graphiti infrastructure from:
- integrations/graphiti/memory.py
- integrations/graphiti/queries_pkg/graphiti.py
- memory/graphiti_helpers.py

Usage:
    memory = GitHubMemoryIntegration(repo="owner/repo", state_dir=Path("..."))

    # Before reviewing, get relevant context
    context = await memory.get_review_context(
        file_paths=["auth.py", "utils.py"],
        change_description="Adding OAuth support",
    )

    # After review, store insights
    await memory.store_review_insight(
        pr_number=123,
        file_paths=["auth.py"],
        insight="Auth module requires careful session handling",
        category="gotcha",
    )
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Add parent paths to sys.path for imports
_backend_dir = Path(__file__).parent.parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

# Import Graphiti components
try:
    from integrations.graphiti.memory import (
        GraphitiMemory,
        GroupIdMode,
        get_graphiti_memory,
        is_graphiti_enabled,
    )
    from memory.graphiti_helpers import is_graphiti_memory_enabled

    GRAPHITI_AVAILABLE = True
except (ImportError, ValueError, SystemError):
    GRAPHITI_AVAILABLE = False

    def is_graphiti_enabled() -> bool:
        return False

    def is_graphiti_memory_enabled() -> bool:
        return False

    GroupIdMode = None


@dataclass
class MemoryHint:
    """
    A hint from memory to aid decision making.
    """

    hint_type: str  # gotcha, pattern, warning, context
    content: str
    relevance_score: float = 0.0
    source: str = "memory"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReviewContext:
    """
    Context gathered from memory for a code review.
    """

    # Past insights about affected files
    file_insights: list[MemoryHint] = field(default_factory=list)

    # Similar past changes and their outcomes
    similar_changes: list[dict[str, Any]] = field(default_factory=list)

    # Known gotchas for this area
    gotchas: list[MemoryHint] = field(default_factory=list)

    # Codebase patterns relevant to this review
    patterns: list[MemoryHint] = field(default_factory=list)

    # Historical context from past reviews
    past_reviews: list[dict[str, Any]] = field(default_factory=list)

    @property
    def has_context(self) -> bool:
        return bool(
            self.file_insights
            or self.similar_changes
            or self.gotchas
            or self.patterns
            or self.past_reviews
        )

    def to_prompt_section(self) -> str:
        """Format memory context for inclusion in prompts."""
        if not self.has_context:
            return ""

        sections = []

        if self.gotchas:
            sections.append("### Known Gotchas")
            for gotcha in self.gotchas:
                sections.append(f"- {gotcha.content}")

        if self.file_insights:
            sections.append("\n### File Insights")
            for insight in self.file_insights:
                sections.append(f"- {insight.content}")

        if self.patterns:
            sections.append("\n### Codebase Patterns")
            for pattern in self.patterns:
                sections.append(f"- {pattern.content}")

        if self.similar_changes:
            sections.append("\n### Similar Past Changes")
            for change in self.similar_changes[:3]:
                outcome = change.get("outcome", "unknown")
                desc = change.get("description", "")
                sections.append(f"- {desc} (outcome: {outcome})")

        if self.past_reviews:
            sections.append("\n### Past Review Notes")
            for review in self.past_reviews[:3]:
                note = review.get("note", "")
                pr = review.get("pr_number", "")
                sections.append(f"- PR #{pr}: {note}")

        return "\n".join(sections)


class GitHubMemoryIntegration:
    """
    Integrates GitHub automation with the existing Graphiti memory layer.

    Uses the project's Graphiti infrastructure for:
    - Storing review outcomes and insights
    - Retrieving relevant context from past sessions
    - Recording patterns and gotchas discovered during reviews
    """

    def __init__(
        self,
        repo: str,
        state_dir: Path | None = None,
        project_dir: Path | None = None,
    ):
        """
        Initialize memory integration.

        Args:
            repo: Repository identifier (owner/repo)
            state_dir: Local state directory for the GitHub runner
            project_dir: Project root directory (for Graphiti namespacing)
        """
        self.repo = repo
        self.state_dir = state_dir or Path(".auto-claude/github")
        self.project_dir = project_dir or Path.cwd()
        self.memory_dir = self.state_dir / "memory"
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        # Graphiti memory instance (lazy-loaded)
        self._graphiti: GraphitiMemory | None = None

        # Local cache for insights (fallback when Graphiti not available)
        self._local_insights: list[dict[str, Any]] = []
        self._load_local_insights()

    def _load_local_insights(self) -> None:
        """Load locally stored insights."""
        insights_file = self.memory_dir / f"{self.repo.replace('/', '_')}_insights.json"
        if insights_file.exists():
            try:
                with open(insights_file, encoding="utf-8") as f:
                    self._local_insights = json.load(f).get("insights", [])
            except (json.JSONDecodeError, KeyError):
                self._local_insights = []

    def _save_local_insights(self) -> None:
        """Save insights locally."""
        insights_file = self.memory_dir / f"{self.repo.replace('/', '_')}_insights.json"
        with open(insights_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "repo": self.repo,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "insights": self._local_insights[-1000:],  # Keep last 1000
                },
                f,
                indent=2,
            )

    @property
    def is_enabled(self) -> bool:
        """Check if Graphiti memory integration is available."""
        return GRAPHITI_AVAILABLE and is_graphiti_memory_enabled()

    async def _get_graphiti(self) -> GraphitiMemory | None:
        """Get or create Graphiti memory instance."""
        if not self.is_enabled:
            return None

        if self._graphiti is None:
            try:
                # Create spec dir for GitHub automation
                spec_dir = self.state_dir / "graphiti" / self.repo.replace("/", "_")
                spec_dir.mkdir(parents=True, exist_ok=True)

                self._graphiti = get_graphiti_memory(
                    spec_dir=spec_dir,
                    project_dir=self.project_dir,
                    group_id_mode=GroupIdMode.PROJECT,  # Share context across all GitHub reviews
                )

                # Initialize
                await self._graphiti.initialize()

            except Exception as e:
                self._graphiti = None
                return None

        return self._graphiti

    async def get_review_context(
        self,
        file_paths: list[str],
        change_description: str,
        pr_number: int | None = None,
    ) -> ReviewContext:
        """
        Get context from memory for a code review.

        Args:
            file_paths: Files being changed
            change_description: Description of the changes
            pr_number: PR number if available

        Returns:
            ReviewContext with relevant memory hints
        """
        context = ReviewContext()

        # Query Graphiti if available
        graphiti = await self._get_graphiti()
        if graphiti:
            try:
                # Query for file-specific insights
                for file_path in file_paths[:5]:  # Limit to 5 files
                    results = await graphiti.get_relevant_context(
                        query=f"What should I know about {file_path}?",
                        num_results=3,
                        include_project_context=True,
                    )
                    for result in results:
                        content = result.get("content") or result.get("summary", "")
                        if content:
                            context.file_insights.append(
                                MemoryHint(
                                    hint_type="file_insight",
                                    content=content,
                                    relevance_score=result.get("score", 0.5),
                                    source="graphiti",
                                    metadata=result,
                                )
                            )

                # Query for similar changes
                similar = await graphiti.get_similar_task_outcomes(
                    task_description=f"PR review: {change_description}",
                    limit=5,
                )
                for item in similar:
                    context.similar_changes.append(
                        {
                            "description": item.get("description", ""),
                            "outcome": "success" if item.get("success") else "failed",
                            "task_id": item.get("task_id"),
                        }
                    )

                # Get session history for recent gotchas
                history = await graphiti.get_session_history(limit=10, spec_only=False)
                for session in history:
                    discoveries = session.get("discoveries", {})
                    for gotcha in discoveries.get("gotchas_encountered", []):
                        context.gotchas.append(
                            MemoryHint(
                                hint_type="gotcha",
                                content=gotcha,
                                relevance_score=0.7,
                                source="graphiti",
                            )
                        )
                    for pattern in discoveries.get("patterns_found", []):
                        context.patterns.append(
                            MemoryHint(
                                hint_type="pattern",
                                content=pattern,
                                relevance_score=0.6,
                                source="graphiti",
                            )
                        )

            except Exception:
                # Graphiti failed, fall through to local
                pass

        # Add local insights
        for insight in self._local_insights:
            # Match by file path
            if any(f in insight.get("file_paths", []) for f in file_paths):
                if insight.get("category") == "gotcha":
                    context.gotchas.append(
                        MemoryHint(
                            hint_type="gotcha",
                            content=insight.get("content", ""),
                            relevance_score=0.7,
                            source="local",
                        )
                    )
                elif insight.get("category") == "pattern":
                    context.patterns.append(
                        MemoryHint(
                            hint_type="pattern",
                            content=insight.get("content", ""),
                            relevance_score=0.6,
                            source="local",
                        )
                    )

        return context

    async def store_review_insight(
        self,
        pr_number: int,
        file_paths: list[str],
        insight: str,
        category: str = "insight",
        severity: str = "info",
    ) -> None:
        """
        Store an insight from a review for future reference.

        Args:
            pr_number: PR number
            file_paths: Files involved
            insight: The insight to store
            category: Category (gotcha, pattern, warning, insight)
            severity: Severity level
        """
        now = datetime.now(timezone.utc)

        # Store locally
        self._local_insights.append(
            {
                "pr_number": pr_number,
                "file_paths": file_paths,
                "content": insight,
                "category": category,
                "severity": severity,
                "created_at": now.isoformat(),
            }
        )
        self._save_local_insights()

        # Store in Graphiti if available
        graphiti = await self._get_graphiti()
        if graphiti:
            try:
                if category == "gotcha":
                    await graphiti.save_gotcha(
                        f"[{self.repo}] PR #{pr_number}: {insight}"
                    )
                elif category == "pattern":
                    await graphiti.save_pattern(
                        f"[{self.repo}] PR #{pr_number}: {insight}"
                    )
                else:
                    # Save as session insight
                    await graphiti.save_session_insights(
                        session_num=pr_number,
                        insights={
                            "type": "github_review_insight",
                            "repo": self.repo,
                            "pr_number": pr_number,
                            "file_paths": file_paths,
                            "content": insight,
                            "category": category,
                            "severity": severity,
                        },
                    )
            except Exception:
                # Graphiti failed, local storage is backup
                pass

    async def store_review_outcome(
        self,
        pr_number: int,
        prediction: str,
        outcome: str,
        was_correct: bool,
        notes: str | None = None,
    ) -> None:
        """
        Store the outcome of a review for learning.

        Args:
            pr_number: PR number
            prediction: What the system predicted
            outcome: What actually happened
            was_correct: Whether prediction was correct
            notes: Additional notes
        """
        now = datetime.now(timezone.utc)

        # Store locally
        self._local_insights.append(
            {
                "pr_number": pr_number,
                "content": f"PR #{pr_number}: Predicted {prediction}, got {outcome}. {'Correct' if was_correct else 'Incorrect'}. {notes or ''}",
                "category": "outcome",
                "prediction": prediction,
                "outcome": outcome,
                "was_correct": was_correct,
                "created_at": now.isoformat(),
            }
        )
        self._save_local_insights()

        # Store in Graphiti
        graphiti = await self._get_graphiti()
        if graphiti:
            try:
                await graphiti.save_task_outcome(
                    task_id=f"github_review_{self.repo}_{pr_number}",
                    success=was_correct,
                    outcome=f"Predicted {prediction}, actual {outcome}",
                    metadata={
                        "type": "github_review",
                        "repo": self.repo,
                        "pr_number": pr_number,
                        "prediction": prediction,
                        "actual_outcome": outcome,
                        "notes": notes,
                    },
                )
            except Exception:
                pass

    async def get_codebase_patterns(
        self,
        area: str | None = None,
    ) -> list[MemoryHint]:
        """
        Get known codebase patterns.

        Args:
            area: Specific area (e.g., "auth", "api", "database")

        Returns:
            List of pattern hints
        """
        patterns = []

        graphiti = await self._get_graphiti()
        if graphiti:
            try:
                query = (
                    f"Codebase patterns for {area}"
                    if area
                    else "Codebase patterns and conventions"
                )
                results = await graphiti.get_relevant_context(
                    query=query,
                    num_results=10,
                    include_project_context=True,
                )
                for result in results:
                    content = result.get("content") or result.get("summary", "")
                    if content:
                        patterns.append(
                            MemoryHint(
                                hint_type="pattern",
                                content=content,
                                relevance_score=result.get("score", 0.5),
                                source="graphiti",
                            )
                        )
            except Exception:
                pass

        # Add local patterns
        for insight in self._local_insights:
            if insight.get("category") == "pattern":
                if not area or area.lower() in insight.get("content", "").lower():
                    patterns.append(
                        MemoryHint(
                            hint_type="pattern",
                            content=insight.get("content", ""),
                            relevance_score=0.6,
                            source="local",
                        )
                    )

        return patterns

    async def explain_finding(
        self,
        finding_id: str,
        finding_description: str,
        file_path: str,
    ) -> str | None:
        """
        Get memory-backed explanation for a finding.

        Answers "Why did you flag this?" with historical context.

        Args:
            finding_id: Finding identifier
            finding_description: What was found
            file_path: File where it was found

        Returns:
            Explanation with historical context, or None
        """
        graphiti = await self._get_graphiti()
        if not graphiti:
            return None

        try:
            results = await graphiti.get_relevant_context(
                query=f"Why flag: {finding_description} in {file_path}",
                num_results=3,
                include_project_context=True,
            )

            if results:
                explanations = []
                for result in results:
                    content = result.get("content") or result.get("summary", "")
                    if content:
                        explanations.append(f"- {content}")

                if explanations:
                    return "Historical context:\n" + "\n".join(explanations)

        except Exception:
            pass

        return None

    async def close(self) -> None:
        """Close Graphiti connection."""
        if self._graphiti:
            try:
                await self._graphiti.close()
            except Exception:
                pass
            self._graphiti = None

    def get_summary(self) -> dict[str, Any]:
        """Get summary of stored memory."""
        categories = {}
        for insight in self._local_insights:
            cat = insight.get("category", "unknown")
            categories[cat] = categories.get(cat, 0) + 1

        graphiti_status = None
        if self._graphiti:
            graphiti_status = self._graphiti.get_status_summary()

        return {
            "repo": self.repo,
            "total_local_insights": len(self._local_insights),
            "by_category": categories,
            "graphiti_available": GRAPHITI_AVAILABLE,
            "graphiti_enabled": self.is_enabled,
            "graphiti_status": graphiti_status,
        }

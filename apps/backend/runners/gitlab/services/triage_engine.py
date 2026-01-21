"""
Triage Engine
=============

Issue triage logic for detecting duplicates, spam, and feature creep.
Ported from GitHub with GitLab API adaptations.
"""

from __future__ import annotations

from pathlib import Path

try:
    from ...phase_config import resolve_model_id
    from ..models import GitLabRunnerConfig, TriageCategory, TriageResult
    from .prompt_manager import PromptManager
    from .response_parsers import ResponseParser
except (ImportError, ValueError, SystemError):
    from models import GitLabRunnerConfig, TriageCategory, TriageResult
    from phase_config import resolve_model_id
    from services.prompt_manager import PromptManager
    from services.response_parsers import ResponseParser


class TriageEngine:
    """Handles issue triage workflow for GitLab."""

    def __init__(
        self,
        project_dir: Path,
        gitlab_dir: Path,
        config: GitLabRunnerConfig,
        progress_callback=None,
    ):
        self.project_dir = Path(project_dir)
        self.gitlab_dir = Path(gitlab_dir)
        self.config = config
        self.progress_callback = progress_callback
        self.prompt_manager = PromptManager()
        self.parser = ResponseParser()

    def _report_progress(self, phase: str, progress: int, message: str, **kwargs):
        """Report progress if callback is set."""
        if self.progress_callback:
            import sys

            if "orchestrator" in sys.modules:
                ProgressCallback = sys.modules["orchestrator"].ProgressCallback
            else:
                # Fallback: try relative import
                try:
                    from ..orchestrator import ProgressCallback
                except ImportError:
                    from orchestrator import ProgressCallback

            self.progress_callback(
                ProgressCallback(
                    phase=phase, progress=progress, message=message, **kwargs
                )
            )

    async def triage_single_issue(
        self, issue: dict, all_issues: list[dict]
    ) -> TriageResult:
        """
        Triage a single issue using AI.

        Args:
            issue: GitLab issue dict from API
            all_issues: List of all issues for duplicate detection

        Returns:
            TriageResult with category and confidence
        """
        from core.client import create_client

        # Build context with issue and potential duplicates
        context = self.build_triage_context(issue, all_issues)

        # Load prompt
        prompt = self.prompt_manager.get_triage_prompt()
        full_prompt = prompt + "\n\n---\n\n" + context

        # Run AI
        # Resolve model shorthand (e.g., "sonnet") to full model ID for API compatibility
        model = resolve_model_id(self.config.model or "sonnet")
        client = create_client(
            project_dir=self.project_dir,
            spec_dir=self.gitlab_dir,
            model=model,
            agent_type="qa_reviewer",
        )

        try:
            async with client:
                await client.query(full_prompt)

                response_text = ""
                async for msg in client.receive_response():
                    msg_type = type(msg).__name__
                    if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            # Must check block type - only TextBlock has .text attribute
                            block_type = type(block).__name__
                            if block_type == "TextBlock" and hasattr(block, "text"):
                                response_text += block.text

                return self.parser.parse_triage_result(
                    issue, response_text, self.config.project
                )

        except Exception as e:
            print(f"Triage error for #{issue['iid']}: {e}")
            return TriageResult(
                issue_iid=issue["iid"],
                project=self.config.project,
                category=TriageCategory.FEATURE,
                confidence=0.0,
            )

    def build_triage_context(self, issue: dict, all_issues: list[dict]) -> str:
        """
        Build context for triage including potential duplicates.

        Args:
            issue: GitLab issue dict
            all_issues: List of all issues for duplicate detection

        Returns:
            Formatted context string for AI
        """
        # Find potential duplicates by title similarity
        potential_dupes = []
        for other in all_issues:
            if other["iid"] == issue["iid"]:
                continue
            # Simple word overlap check
            title_words = set(issue["title"].lower().split())
            other_words = set(other["title"].lower().split())
            overlap = len(title_words & other_words) / max(len(title_words), 1)
            if overlap > 0.3:
                potential_dupes.append(other)

        # Extract author username from GitLab API response
        author = issue.get("author", {})
        author_name = (
            author.get("username", "unknown") if isinstance(author, dict) else "unknown"
        )

        # Extract labels from GitLab API response (simple list of strings)
        labels = issue.get("labels", [])
        if isinstance(labels, list):
            label_names = labels
        else:
            label_names = []

        lines = [
            f"## Issue #{issue['iid']}",
            f"**Title:** {issue['title']}",
            f"**Author:** {author_name}",
            f"**Created:** {issue.get('created_at', 'unknown')}",
            f"**Labels:** {', '.join(label_names)}",
            "",
            "### Description",
            issue.get("description", "No description"),
            "",
        ]

        if potential_dupes:
            lines.append("### Potential Duplicates (similar titles)")
            for d in potential_dupes[:5]:
                lines.append(f"- #{d['iid']}: {d['title']}")
            lines.append("")

        return "\n".join(lines)

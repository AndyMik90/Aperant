"""
MR Context Gatherer for GitLab
==============================

Gathers all necessary context for MR review BEFORE the AI starts.

Responsibilities:
- Fetch MR metadata (title, author, branches, description)
- Get all changed files with full content
- Detect monorepo structure and project layout
- Find related files (imports, tests, configs)
- Build complete diff with context
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

try:
    from ..glab_client import GitLabClient, GitLabConfig
    from ..models import MRContext
    from .io_utils import safe_print
except ImportError:
    from core.io_utils import safe_print
    from glab_client import GitLabClient, GitLabConfig
    from models import MRContext


# Validation patterns for git refs and paths
SAFE_REF_PATTERN = re.compile(r"^[a-zA-Z0-9._/\-]+$")
SAFE_PATH_PATTERN = re.compile(r"^[a-zA-Z0-9._/\-@]+$")


def _validate_git_ref(ref: str) -> bool:
    """Validate git ref (branch name or commit SHA) for safe use in commands."""
    if not ref or len(ref) > 256:
        return False
    return bool(SAFE_REF_PATTERN.match(ref))


def _validate_file_path(path: str) -> bool:
    """Validate file path for safe use in git commands."""
    if not path or len(path) > 1024:
        return False
    if ".." in path or path.startswith("/"):
        return False
    return bool(SAFE_PATH_PATTERN.match(path))


# Known GitLab AI bot patterns
GITLAB_AI_BOT_PATTERNS = {
    # GitLab official bots
    "gitlab-bot": "GitLab Bot",
    "gitlab": "GitLab",
    # AI code review tools
    "coderabbit": "CodeRabbit",
    "greptile": "Greptile",
    "cursor": "Cursor",
    "sweep": "Sweep AI",
    "codium": "Qodo",
    "dependabot": "Dependabot",
    "renovate": "Renovate",
}


@dataclass
class ChangedFile:
    """A file that was changed in the MR."""

    path: str
    status: str  # added, modified, deleted, renamed
    additions: int
    deletions: int
    content: str  # Current file content
    base_content: str  # Content before changes
    patch: str  # The diff patch for this file


@dataclass
class AIBotComment:
    """A comment from an AI review tool."""

    comment_id: int
    author: str
    tool_name: str
    body: str
    file: str | None
    line: int | None
    created_at: str


class MRContextGatherer:
    """Gathers all context needed for MR review BEFORE the AI starts."""

    def __init__(
        self,
        project_dir: Path,
        mr_iid: int,
        config: GitLabConfig | None = None,
    ):
        self.project_dir = Path(project_dir)
        self.mr_iid = mr_iid

        if config:
            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )
        else:
            # Try to load config from project
            from ..glab_client import load_gitlab_config

            config = load_gitlab_config(self.project_dir)
            if not config:
                raise ValueError("GitLab configuration not found")

            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )

    async def gather(self) -> MRContext:
        """
        Gather all context for review.

        Returns:
            MRContext with all necessary information for review
        """
        safe_print(f"[Context] Gathering context for MR !{self.mr_iid}...")

        # Fetch basic MR metadata
        mr_data = await self.client.get_mr_async(self.mr_iid)
        safe_print(
            f"[Context] MR metadata: {mr_data.get('title', 'Unknown')} "
            f"by {mr_data.get('author', {}).get('username', 'unknown')}",
        )

        # Fetch changed files with diff
        changes_data = await self.client.get_mr_changes_async(self.mr_iid)
        safe_print(
            f"[Context] Fetched {len(changes_data.get('changes', []))} changed files"
        )

        # Build diff
        diff_parts = []
        for change in changes_data.get("changes", []):
            diff = change.get("diff", "")
            if diff:
                diff_parts.append(diff)

        diff = "\n".join(diff_parts)
        safe_print(f"[Context] Gathered diff: {len(diff)} chars")

        # Fetch commits
        commits = await self.client.get_mr_commits_async(self.mr_iid)
        safe_print(f"[Context] Fetched {len(commits)} commits")

        # Get head commit SHA
        head_sha = ""
        if commits:
            head_sha = commits[-1].get("id") or commits[-1].get("sha", "")

        # Build changed files list
        changed_files = []
        total_additions = changes_data.get("additions", 0)
        total_deletions = changes_data.get("deletions", 0)

        for change in changes_data.get("changes", []):
            new_path = change.get("new_path")
            old_path = change.get("old_path")

            # Determine status
            if change.get("new_file"):
                status = "added"
            elif change.get("deleted_file"):
                status = "deleted"
            elif change.get("renamed_file"):
                status = "renamed"
            else:
                status = "modified"

            changed_files.append(
                {
                    "new_path": new_path or old_path,
                    "old_path": old_path or new_path,
                    "status": status,
                }
            )

        # Fetch AI bot comments for triage
        ai_bot_comments = await self._fetch_ai_bot_comments()
        safe_print(f"[Context] Fetched {len(ai_bot_comments)} AI bot comments")

        return MRContext(
            mr_iid=self.mr_iid,
            title=mr_data.get("title", ""),
            description=mr_data.get("description", "") or "",
            author=mr_data.get("author", {}).get("username", "unknown"),
            source_branch=mr_data.get("source_branch", ""),
            target_branch=mr_data.get("target_branch", ""),
            state=mr_data.get("state", "opened"),
            changed_files=changed_files,
            diff=diff,
            total_additions=total_additions,
            total_deletions=total_deletions,
            commits=commits,
            head_sha=head_sha,
        )

    async def _fetch_ai_bot_comments(self) -> list[AIBotComment]:
        """
        Fetch comments from AI code review tools on this MR.

        Returns comments from known AI tools.
        """
        ai_comments: list[AIBotComment] = []

        try:
            # Fetch MR notes (comments)
            notes = await self.client.get_mr_notes_async(self.mr_iid)

            for note in notes:
                comment = self._parse_ai_comment(note)
                if comment:
                    ai_comments.append(comment)

        except Exception as e:
            safe_print(f"[Context] Error fetching AI bot comments: {e}")

        return ai_comments

    def _parse_ai_comment(self, note: dict) -> AIBotComment | None:
        """
        Parse a note and return AIBotComment if it's from a known AI tool.

        Args:
            note: Raw note data from GitLab API

        Returns:
            AIBotComment if author is a known AI bot, None otherwise
        """
        author_data = note.get("author")
        author = (author_data.get("username") if author_data else "") or ""
        if not author:
            return None

        # Check if author matches any known AI bot pattern
        tool_name = None
        author_lower = author.lower()
        for pattern, name in GITLAB_AI_BOT_PATTERNS.items():
            if pattern in author_lower:
                tool_name = name
                break

        if not tool_name:
            return None

        return AIBotComment(
            comment_id=note.get("id", 0),
            author=author,
            tool_name=tool_name,
            body=note.get("body", ""),
            file=None,  # GitLab notes don't have file/line in the same way
            line=None,
            created_at=note.get("created_at", ""),
        )


class FollowupMRContextGatherer:
    """
    Gathers context specifically for follow-up reviews.

    Unlike the full MRContextGatherer, this only fetches:
    - New commits since last review
    - Changed files since last review
    - New comments since last review
    """

    def __init__(
        self,
        project_dir: Path,
        mr_iid: int,
        previous_review,  # MRReviewResult
        config: GitLabConfig | None = None,
    ):
        self.project_dir = Path(project_dir)
        self.mr_iid = mr_iid
        self.previous_review = previous_review

        if config:
            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )
        else:
            # Try to load config from project
            from ..glab_client import load_gitlab_config

            config = load_gitlab_config(self.project_dir)
            if not config:
                raise ValueError("GitLab configuration not found")

            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )

    async def gather(self):
        """
        Gather context for a follow-up review.

        Returns:
            FollowupMRContext with changes since last review
        """
        from ..models import FollowupMRContext

        previous_sha = self.previous_review.reviewed_commit_sha

        if not previous_sha:
            safe_print(
                "[Followup] No reviewed_commit_sha in previous review, "
                "cannot gather incremental context"
            )
            return FollowupMRContext(
                mr_iid=self.mr_iid,
                previous_review=self.previous_review,
                previous_commit_sha="",
                current_commit_sha="",
            )

        safe_print(f"[Followup] Gathering context since commit {previous_sha[:8]}...")

        # Get current MR data
        mr_data = await self.client.get_mr_async(self.mr_iid)

        # Get current commits
        commits = await self.client.get_mr_commits_async(self.mr_iid)

        # Find new commits since previous review
        new_commits = []
        found_previous = False
        for commit in commits:
            commit_sha = commit.get("id") or commit.get("sha", "")
            if commit_sha == previous_sha:
                found_previous = True
                break
            new_commits.append(commit)

        if not found_previous:
            safe_print("[Followup] Previous commit SHA not found in MR history")

        # Get current head SHA
        current_sha = ""
        if commits:
            current_sha = commits[-1].get("id") or commits[-1].get("sha", "")

        if previous_sha == current_sha:
            safe_print("[Followup] No new commits since last review")
            return FollowupMRContext(
                mr_iid=self.mr_iid,
                previous_review=self.previous_review,
                previous_commit_sha=previous_sha,
                current_commit_sha=current_sha,
            )

        safe_print(
            f"[Followup] Comparing {previous_sha[:8]}...{current_sha[:8]}, "
            f"{len(new_commits)} new commits"
        )

        # Build diff from changes
        changes_data = await self.client.get_mr_changes_async(self.mr_iid)

        files_changed = []
        diff_parts = []
        for change in changes_data.get("changes", []):
            new_path = change.get("new_path") or change.get("old_path", "")
            if new_path:
                files_changed.append(new_path)

            diff = change.get("diff", "")
            if diff:
                diff_parts.append(diff)

        diff_since_review = "\n".join(diff_parts)

        safe_print(
            f"[Followup] Found {len(new_commits)} new commits, "
            f"{len(files_changed)} changed files"
        )

        return FollowupMRContext(
            mr_iid=self.mr_iid,
            previous_review=self.previous_review,
            previous_commit_sha=previous_sha,
            current_commit_sha=current_sha,
            commits_since_review=new_commits,
            files_changed_since_review=files_changed,
            diff_since_review=diff_since_review,
        )

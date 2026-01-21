"""
Bot Detection for GitLab Automation
====================================

Prevents infinite loops by detecting when the bot is reviewing its own work.

Key Features:
- Identifies bot user from configured token
- Skips MRs authored by the bot
- Skips re-reviewing bot commits
- Implements "cooling off" period to prevent rapid re-reviews
- Tracks reviewed commits to avoid duplicate reviews

Usage:
    detector = BotDetector(
        state_dir=Path("/path/to/state"),
        bot_username="auto-claude-bot",
        review_own_mrs=False
    )

    # Check if MR should be skipped
    should_skip, reason = detector.should_skip_mr_review(mr_iid=123, mr_data={}, commits=[])
    if should_skip:
        print(f"Skipping MR: {reason}")
        return

    # After successful review, mark as reviewed
    detector.mark_reviewed(mr_iid=123, commit_sha="abc123")
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

try:
    from .utils.file_lock import FileLock, atomic_write
except (ImportError, ValueError, SystemError):
    from utils.file_lock import FileLock, atomic_write


@dataclass
class BotDetectionState:
    """State for tracking reviewed MRs and commits."""

    # MR IID -> set of reviewed commit SHAs
    reviewed_commits: dict[int, list[str]] = field(default_factory=dict)

    # MR IID -> last review timestamp (ISO format)
    last_review_times: dict[int, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "reviewed_commits": self.reviewed_commits,
            "last_review_times": self.last_review_times,
        }

    @classmethod
    def from_dict(cls, data: dict) -> BotDetectionState:
        """Load from dictionary."""
        return cls(
            reviewed_commits=data.get("reviewed_commits", {}),
            last_review_times=data.get("last_review_times", {}),
        )

    def save(self, state_dir: Path) -> None:
        """Save state to disk with file locking for concurrent safety."""
        state_dir.mkdir(parents=True, exist_ok=True)
        state_file = state_dir / "bot_detection_state.json"

        # Use file locking to prevent concurrent write corruption
        with FileLock(state_file, timeout=5.0, exclusive=True):
            with atomic_write(state_file) as f:
                json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, state_dir: Path) -> BotDetectionState:
        """Load state from disk."""
        state_file = state_dir / "bot_detection_state.json"

        if not state_file.exists():
            return cls()

        with open(state_file, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


# Known GitLab bot account patterns
GITLAB_BOT_PATTERNS = [
    # GitLab official bots
    "gitlab-bot",
    "gitlab",
    # Bot suffixes
    "[bot]",
    "-bot",
    "_bot",
    ".bot",
    # AI coding assistants
    "coderabbit",
    "greptile",
    "cursor",
    "sweep",
    "codium",
    "dependabot",
    "renovate",
    # Auto-generated patterns
    "project_",
    "bot_",
]


class BotDetector:
    """
    Detects bot-authored MRs and commits to prevent infinite review loops.

    Configuration:
        - bot_username: GitLab username of the bot account
        - review_own_mrs: Whether bot can review its own MRs

    Automatic safeguards:
        - 1-minute cooling off period between reviews of same MR
        - Tracks reviewed commit SHAs to avoid duplicate reviews
        - Identifies bot user by username to skip bot-authored content
    """

    # Cooling off period in minutes
    COOLING_OFF_MINUTES = 1

    def __init__(
        self,
        state_dir: Path,
        bot_username: str | None = None,
        review_own_mrs: bool = False,
    ):
        """
        Initialize bot detector.

        Args:
            state_dir: Directory for storing detection state
            bot_username: GitLab username of the bot (to identify bot user)
            review_own_mrs: Whether to allow reviewing bot's own MRs
        """
        self.state_dir = state_dir
        self.bot_username = bot_username
        self.review_own_mrs = review_own_mrs

        # Load or initialize state
        self.state = BotDetectionState.load(state_dir)

        logger.info(
            f"Initialized BotDetector: bot_user={bot_username}, review_own_mrs={review_own_mrs}"
        )

    def _is_bot_username(self, username: str | None) -> bool:
        """
        Check if a username matches known bot patterns.

        Args:
            username: Username to check

        Returns:
            True if username matches bot patterns
        """
        if not username:
            return False

        username_lower = username.lower()

        # Check against known patterns
        for pattern in GITLAB_BOT_PATTERNS:
            if pattern.lower() in username_lower:
                return True

        return False

    def is_bot_mr(self, mr_data: dict) -> bool:
        """
        Check if MR was created by the bot.

        Args:
            mr_data: MR data from GitLab API (must have 'author' field)

        Returns:
            True if MR author matches bot username or bot patterns
        """
        author_data = mr_data.get("author", {})
        if not author_data:
            return False

        author = author_data.get("username")

        # Check if matches configured bot username
        if not self.review_own_mrs and author == self.bot_username:
            logger.info(f"MR is bot-authored: {author}")
            return True

        # Check if matches bot patterns
        if not self.review_own_mrs and self._is_bot_username(author):
            logger.info(f"MR matches bot pattern: {author}")
            return True

        return False

    def is_bot_commit(self, commit_data: dict) -> bool:
        """
        Check if commit was authored by the bot.

        Args:
            commit_data: Commit data from GitLab API (must have 'author' field)

        Returns:
            True if commit author matches bot username or bot patterns
        """
        author_data = commit_data.get("author") or commit_data.get("author_email")
        if not author_data:
            return False

        if isinstance(author_data, dict):
            author = author_data.get("username") or author_data.get("email")
        else:
            author = author_data

        # Extract username from email if needed
        if "@" in str(author):
            author = str(author).split("@")[0]

        # Check if matches configured bot username
        if not self.review_own_mrs and author == self.bot_username:
            logger.info(f"Commit is bot-authored: {author}")
            return True

        # Check if matches bot patterns
        if not self.review_own_mrs and self._is_bot_username(author):
            logger.info(f"Commit matches bot pattern: {author}")
            return True

        # Check for AI commit patterns
        commit_message = commit_data.get("message", "")
        if not self.review_own_mrs and self._is_ai_commit(commit_message):
            logger.info("Commit has AI pattern in message")
            return True

        return False

    def _is_ai_commit(self, commit_message: str) -> bool:
        """
        Check if commit message indicates AI-generated commit.

        Args:
            commit_message: Commit message text

        Returns:
            True if commit appears to be AI-generated
        """
        if not commit_message:
            return False

        message_lower = commit_message.lower()

        # Check for AI co-authorship patterns
        ai_patterns = [
            "co-authored-by: claude",
            "co-authored-by: gpt",
            "co-authored-by: gemini",
            "co-authored-by: ai assistant",
            "generated by ai",
            "auto-generated",
        ]

        for pattern in ai_patterns:
            if pattern in message_lower:
                return True

        return False

    def get_last_commit_sha(self, commits: list[dict]) -> str | None:
        """
        Get the SHA of the most recent commit.

        Args:
            commits: List of commit data from GitLab API

        Returns:
            SHA of latest commit or None if no commits
        """
        if not commits:
            return None

        # GitLab API returns commits in chronological order (oldest first, newest last)
        latest = commits[-1]
        return latest.get("id") or latest.get("sha")

    def is_within_cooling_off(self, mr_iid: int) -> tuple[bool, str]:
        """
        Check if MR is within cooling off period.

        Args:
            mr_iid: The MR IID

        Returns:
            Tuple of (is_cooling_off, reason_message)
        """
        last_review_str = self.state.last_review_times.get(str(mr_iid))

        if not last_review_str:
            return False, ""

        try:
            last_review = datetime.fromisoformat(last_review_str)
            time_since = datetime.now() - last_review

            if time_since < timedelta(minutes=self.COOLING_OFF_MINUTES):
                minutes_left = self.COOLING_OFF_MINUTES - (
                    time_since.total_seconds() / 60
                )
                reason = (
                    f"Cooling off period active (reviewed {int(time_since.total_seconds() / 60)}m ago, "
                    f"{int(minutes_left)}m remaining)"
                )
                logger.info(f"MR !{mr_iid}: {reason}")
                return True, reason

        except (ValueError, TypeError) as e:
            logger.error(f"Error parsing last review time: {e}")

        return False, ""

    def has_reviewed_commit(self, mr_iid: int, commit_sha: str) -> bool:
        """
        Check if we've already reviewed this specific commit.

        Args:
            mr_iid: The MR IID
            commit_sha: The commit SHA to check

        Returns:
            True if this commit was already reviewed
        """
        reviewed = self.state.reviewed_commits.get(str(mr_iid), [])
        return commit_sha in reviewed

    def should_skip_mr_review(
        self,
        mr_iid: int,
        mr_data: dict,
        commits: list[dict] | None = None,
    ) -> tuple[bool, str]:
        """
        Determine if we should skip reviewing this MR.

        This is the main entry point for bot detection logic.

        Args:
            mr_iid: The MR IID
            mr_data: MR data from GitLab API
            commits: Optional list of commits in the MR

        Returns:
            Tuple of (should_skip, reason)
        """
        # Check 1: Is this a bot-authored MR?
        if not self.review_own_mrs and self.is_bot_mr(mr_data):
            reason = f"MR authored by bot user ({self.bot_username or 'bot pattern'})"
            logger.info(f"SKIP MR !{mr_iid}: {reason}")
            return True, reason

        # Check 2: Is the latest commit by the bot?
        # Note: GitLab API returns commits oldest-first, so commits[-1] is the latest
        if commits and not self.review_own_mrs:
            latest_commit = commits[-1] if commits else None
            if latest_commit and self.is_bot_commit(latest_commit):
                reason = "Latest commit authored by bot (likely an auto-fix)"
                logger.info(f"SKIP MR !{mr_iid}: {reason}")
                return True, reason

        # Check 3: Are we in the cooling off period?
        is_cooling, reason = self.is_within_cooling_off(mr_iid)
        if is_cooling:
            logger.info(f"SKIP MR !{mr_iid}: {reason}")
            return True, reason

        # Check 4: Have we already reviewed this exact commit?
        head_sha = self.get_last_commit_sha(commits) if commits else None
        if head_sha and self.has_reviewed_commit(mr_iid, head_sha):
            reason = f"Already reviewed commit {head_sha[:8]}"
            logger.info(f"SKIP MR !{mr_iid}: {reason}")
            return True, reason

        # All checks passed - safe to review
        logger.info(f"MR !{mr_iid} is safe to review")
        return False, ""

    def mark_reviewed(self, mr_iid: int, commit_sha: str) -> None:
        """
        Mark an MR as reviewed at a specific commit.

        This should be called after successfully posting a review.

        Args:
            mr_iid: The MR IID
            commit_sha: The commit SHA that was reviewed
        """
        mr_key = str(mr_iid)

        # Add to reviewed commits
        if mr_key not in self.state.reviewed_commits:
            self.state.reviewed_commits[mr_key] = []

        if commit_sha not in self.state.reviewed_commits[mr_key]:
            self.state.reviewed_commits[mr_key].append(commit_sha)

        # Update last review time
        self.state.last_review_times[mr_key] = datetime.now().isoformat()

        # Save state
        self.state.save(self.state_dir)

        logger.info(
            f"Marked MR !{mr_iid} as reviewed at {commit_sha[:8]} "
            f"({len(self.state.reviewed_commits[mr_key])} total commits reviewed)"
        )

    def clear_mr_state(self, mr_iid: int) -> None:
        """
        Clear tracking state for an MR (e.g., when MR is closed/merged).

        Args:
            mr_iid: The MR IID
        """
        mr_key = str(mr_iid)

        if mr_key in self.state.reviewed_commits:
            del self.state.reviewed_commits[mr_key]

        if mr_key in self.state.last_review_times:
            del self.state.last_review_times[mr_key]

        self.state.save(self.state_dir)

        logger.info(f"Cleared state for MR !{mr_iid}")

    def get_stats(self) -> dict:
        """
        Get statistics about bot detection activity.

        Returns:
            Dictionary with stats
        """
        total_mrs = len(self.state.reviewed_commits)
        total_reviews = sum(
            len(commits) for commits in self.state.reviewed_commits.values()
        )

        return {
            "bot_username": self.bot_username,
            "review_own_mrs": self.review_own_mrs,
            "total_mrs_tracked": total_mrs,
            "total_reviews_performed": total_reviews,
            "cooling_off_minutes": self.COOLING_OFF_MINUTES,
        }

    def cleanup_stale_mrs(self, max_age_days: int = 30) -> int:
        """
        Remove tracking state for MRs that haven't been reviewed recently.

        This prevents unbounded growth of the state file by cleaning up
        entries for MRs that are likely closed/merged.

        Args:
            max_age_days: Remove MRs not reviewed in this many days (default: 30)

        Returns:
            Number of MRs cleaned up
        """
        cutoff = datetime.now() - timedelta(days=max_age_days)
        mrs_to_remove: list[str] = []

        for mr_key, last_review_str in self.state.last_review_times.items():
            try:
                last_review = datetime.fromisoformat(last_review_str)
                if last_review < cutoff:
                    mrs_to_remove.append(mr_key)
            except (ValueError, TypeError):
                # Invalid timestamp - mark for removal
                mrs_to_remove.append(mr_key)

        # Remove stale MRs
        for mr_key in mrs_to_remove:
            if mr_key in self.state.reviewed_commits:
                del self.state.reviewed_commits[mr_key]
            if mr_key in self.state.last_review_times:
                del self.state.last_review_times[mr_key]

        if mrs_to_remove:
            self.state.save(self.state_dir)
            logger.info(
                f"Cleaned up {len(mrs_to_remove)} stale MRs "
                f"(older than {max_age_days} days)"
            )

        return len(mrs_to_remove)

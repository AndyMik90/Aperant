"""
Bot Detection for GitHub Automation
====================================

Prevents infinite loops by detecting when the bot is reviewing its own work.

Key Features:
- Identifies bot user from configured token
- Skips PRs authored by the bot
- Skips re-reviewing bot commits
- Implements "cooling off" period to prevent rapid re-reviews
- Tracks reviewed commits to avoid duplicate reviews
- In-progress tracking to prevent concurrent reviews
- Stale review detection with automatic cleanup

Usage:
    detector = BotDetector(bot_token="ghp_...")

    # Check if PR should be skipped
    should_skip, reason = detector.should_skip_pr_review(pr_data, commits)
    if should_skip:
        print(f"Skipping PR: {reason}")
        return

    # Mark review as started (prevents concurrent reviews)
    detector.mark_review_started(pr_number)

    # Perform review...

    # After successful review, mark as reviewed
    detector.mark_reviewed(pr_number, head_sha)

    # Or if review failed:
    detector.mark_review_finished(pr_number, success=False)
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from core.gh_executable import get_gh_executable

logger = logging.getLogger(__name__)

try:
    from .file_lock import FileLock, atomic_write
except (ImportError, ValueError, SystemError):
    from file_lock import FileLock, atomic_write


@dataclass
class BotDetectionState:
    """State for tracking reviewed PRs and commits."""

    # PR number -> set of reviewed commit SHAs
    reviewed_commits: dict[int, list[str]] = field(default_factory=dict)

    # PR number -> last review timestamp (ISO format)
    last_review_times: dict[int, str] = field(default_factory=dict)

    # PR number -> in-progress review start time (ISO format)
    in_progress_reviews: dict[int, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "reviewed_commits": self.reviewed_commits,
            "last_review_times": self.last_review_times,
            "in_progress_reviews": self.in_progress_reviews,
        }

    @classmethod
    def from_dict(cls, data: dict) -> BotDetectionState:
        """Load from dictionary."""
        return cls(
            reviewed_commits=data.get("reviewed_commits", {}),
            last_review_times=data.get("last_review_times", {}),
            in_progress_reviews=data.get("in_progress_reviews", {}),
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


class BotDetector:
    """
    Detects bot-authored PRs and commits to prevent infinite review loops.

    Configuration via GitHubRunnerConfig:
        - review_own_prs: bool = False (whether bot can review its own PRs)
        - bot_token: str | None (separate bot account token)

    Automatic safeguards:
        - 1-minute cooling off period between reviews of same PR (for testing)
        - Tracks reviewed commit SHAs to avoid duplicate reviews
        - Identifies bot user from token to skip bot-authored content
        - In-progress tracking to prevent concurrent reviews
        - Stale review detection (30-minute timeout)
    """

    # Cooling off period in minutes (reduced to 1 for testing large PRs)
    COOLING_OFF_MINUTES = 1

    # Timeout for in-progress reviews in minutes (after this, review is considered stale/crashed)
    IN_PROGRESS_TIMEOUT_MINUTES = 30

    def __init__(
        self,
        state_dir: Path,
        bot_token: str | None = None,
        review_own_prs: bool = False,
    ):
        """
        Initialize bot detector.

        Args:
            state_dir: Directory for storing detection state
            bot_token: GitHub token for bot (to identify bot user)
            review_own_prs: Whether to allow reviewing bot's own PRs
        """
        self.state_dir = state_dir
        self.bot_token = bot_token
        self.review_own_prs = review_own_prs

        # Load or initialize state
        self.state = BotDetectionState.load(state_dir)

        # Identify bot username from token
        self.bot_username = self._get_bot_username()

        print(
            f"[BotDetector] Initialized: bot_user={self.bot_username}, review_own_prs={review_own_prs}",
            file=sys.stderr,
        )

    def _get_bot_username(self) -> str | None:
        """
        Get the bot's GitHub username from the token.

        Returns:
            Bot username or None if token not provided or invalid
        """
        if not self.bot_token:
            print(
                "[BotDetector] No bot token provided, cannot identify bot user",
                file=sys.stderr,
            )
            return None

        try:
            gh_exec = get_gh_executable()
            if not gh_exec:
                print(
                    "[BotDetector] gh CLI not found, cannot identify bot user",
                    file=sys.stderr,
                )
                return None

            # Use gh api to get authenticated user
            # Pass token via environment variable to avoid exposing it in process listings
            env = os.environ.copy()
            env["GH_TOKEN"] = self.bot_token
            result = subprocess.run(
                [gh_exec, "api", "user"],
                capture_output=True,
                text=True,
                timeout=5,
                env=env,
            )

            if result.returncode == 0:
                user_data = json.loads(result.stdout)
                username = user_data.get("login")
                print(f"[BotDetector] Identified bot user: {username}")
                return username
            else:
                print(f"[BotDetector] Failed to identify bot user: {result.stderr}")
                return None

        except Exception as e:
            print(f"[BotDetector] Error identifying bot user: {e}")
            return None

    def is_bot_pr(self, pr_data: dict) -> bool:
        """
        Check if PR was created by the bot.

        Args:
            pr_data: PR data from GitHub API (must have 'author' field)

        Returns:
            True if PR author matches bot username
        """
        if not self.bot_username:
            return False

        pr_author = pr_data.get("author", {}).get("login")
        is_bot = pr_author == self.bot_username

        if is_bot:
            print(f"[BotDetector] PR is bot-authored: {pr_author}")

        return is_bot

    def is_bot_commit(self, commit_data: dict) -> bool:
        """
        Check if commit was authored by the bot.

        Args:
            commit_data: Commit data from GitHub API (must have 'author' field)

        Returns:
            True if commit author matches bot username
        """
        if not self.bot_username:
            return False

        # Check both author and committer (could be different)
        commit_author = commit_data.get("author", {}).get("login")
        commit_committer = commit_data.get("committer", {}).get("login")

        is_bot = (
            commit_author == self.bot_username or commit_committer == self.bot_username
        )

        if is_bot:
            print(
                f"[BotDetector] Commit is bot-authored: {commit_author or commit_committer}"
            )

        return is_bot

    def get_last_commit_sha(self, commits: list[dict]) -> str | None:
        """
        Get the SHA of the most recent commit.

        Args:
            commits: List of commit data from GitHub API

        Returns:
            SHA of latest commit or None if no commits
        """
        if not commits:
            return None

        # GitHub API returns commits in chronological order (oldest first, newest last)
        latest = commits[-1]
        return latest.get("oid") or latest.get("sha")

    def is_within_cooling_off(self, pr_number: int) -> tuple[bool, str]:
        """
        Check if PR is within cooling off period.

        Args:
            pr_number: The PR number

        Returns:
            Tuple of (is_cooling_off, reason_message)
        """
        last_review_str = self.state.last_review_times.get(str(pr_number))

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
                print(f"[BotDetector] PR #{pr_number}: {reason}")
                return True, reason

        except (ValueError, TypeError) as e:
            print(f"[BotDetector] Error parsing last review time: {e}")

        return False, ""

    def has_reviewed_commit(self, pr_number: int, commit_sha: str) -> bool:
        """
        Check if we've already reviewed this specific commit.

        Args:
            pr_number: The PR number
            commit_sha: The commit SHA to check

        Returns:
            True if this commit was already reviewed
        """
        reviewed = self.state.reviewed_commits.get(str(pr_number), [])
        return commit_sha in reviewed

    def is_review_in_progress(self, pr_number: int) -> tuple[bool, str]:
        """
        Check if a review is currently in progress for this PR.

        Also detects stale reviews (started > IN_PROGRESS_TIMEOUT_MINUTES ago).

        Args:
            pr_number: The PR number

        Returns:
            Tuple of (is_in_progress, reason_message)
        """
        pr_key = str(pr_number)
        start_time_str = self.state.in_progress_reviews.get(pr_key)

        if not start_time_str:
            return False, ""

        try:
            start_time = datetime.fromisoformat(start_time_str)
            time_elapsed = datetime.now() - start_time

            # Check if review is stale (timeout exceeded)
            if time_elapsed > timedelta(minutes=self.IN_PROGRESS_TIMEOUT_MINUTES):
                # Mark as stale and clear the in-progress state
                print(
                    f"[BotDetector] Review for PR #{pr_number} is stale "
                    f"(started {int(time_elapsed.total_seconds() / 60)}m ago, "
                    f"timeout: {self.IN_PROGRESS_TIMEOUT_MINUTES}m) - clearing in-progress state",
                    file=sys.stderr,
                )
                self.mark_review_finished(pr_number, success=False)
                return False, ""

            # Review is actively in progress
            minutes_elapsed = int(time_elapsed.total_seconds() / 60)
            reason = f"Review already in progress (started {minutes_elapsed}m ago)"
            print(f"[BotDetector] PR #{pr_number}: {reason}", file=sys.stderr)
            return True, reason

        except (ValueError, TypeError) as e:
            print(
                f"[BotDetector] Error parsing in-progress start time: {e}",
                file=sys.stderr,
            )
            # Clear invalid state
            self.mark_review_finished(pr_number, success=False)
            return False, ""

    def mark_review_started(self, pr_number: int) -> None:
        """
        Mark a review as started for this PR.

        This should be called when beginning a review to prevent concurrent reviews.

        Args:
            pr_number: The PR number
        """
        pr_key = str(pr_number)

        # Record start time
        self.state.in_progress_reviews[pr_key] = datetime.now().isoformat()

        # Save state
        self.state.save(self.state_dir)

        logger.info(f"[BotDetector] Marked PR #{pr_number} review as started")
        print(f"[BotDetector] Started review for PR #{pr_number}", file=sys.stderr)

    def mark_review_finished(self, pr_number: int, success: bool = True) -> None:
        """
        Mark a review as finished for this PR.

        This clears the in-progress state. Should be called when review completes
        (successfully or with error) or when detected as stale.

        Args:
            pr_number: The PR number
            success: Whether the review completed successfully
        """
        pr_key = str(pr_number)

        # Clear in-progress state
        if pr_key in self.state.in_progress_reviews:
            del self.state.in_progress_reviews[pr_key]

            # Save state
            self.state.save(self.state_dir)

            status = "successfully" if success else "with error/timeout"
            logger.info(
                f"[BotDetector] Marked PR #{pr_number} review as finished ({status})"
            )
            print(
                f"[BotDetector] Finished review for PR #{pr_number} ({status})",
                file=sys.stderr,
            )

    def should_skip_pr_review(
        self,
        pr_number: int,
        pr_data: dict,
        commits: list[dict] | None = None,
    ) -> tuple[bool, str]:
        """
        Determine if we should skip reviewing this PR.

        This is the main entry point for bot detection logic.

        Args:
            pr_number: The PR number
            pr_data: PR data from GitHub API
            commits: Optional list of commits in the PR

        Returns:
            Tuple of (should_skip, reason)
        """
        # Check 1: Is this a bot-authored PR?
        if not self.review_own_prs and self.is_bot_pr(pr_data):
            reason = f"PR authored by bot user ({self.bot_username})"
            print(f"[BotDetector] SKIP PR #{pr_number}: {reason}")
            return True, reason

        # Check 2: Is the latest commit by the bot?
        # Note: GitHub API returns commits oldest-first, so commits[-1] is the latest
        if commits and not self.review_own_prs:
            latest_commit = commits[-1] if commits else None
            if latest_commit and self.is_bot_commit(latest_commit):
                reason = "Latest commit authored by bot (likely an auto-fix)"
                print(f"[BotDetector] SKIP PR #{pr_number}: {reason}")
                return True, reason

        # Check 3: Is a review already in progress?
        is_in_progress, reason = self.is_review_in_progress(pr_number)
        if is_in_progress:
            print(f"[BotDetector] SKIP PR #{pr_number}: {reason}")
            return True, reason

        # Check 4: Are we in the cooling off period?
        is_cooling, reason = self.is_within_cooling_off(pr_number)
        if is_cooling:
            print(f"[BotDetector] SKIP PR #{pr_number}: {reason}")
            return True, reason

        # Check 5: Have we already reviewed this exact commit?
        head_sha = self.get_last_commit_sha(commits) if commits else None
        if head_sha and self.has_reviewed_commit(pr_number, head_sha):
            reason = f"Already reviewed commit {head_sha[:8]}"
            print(f"[BotDetector] SKIP PR #{pr_number}: {reason}")
            return True, reason

        # All checks passed - safe to review
        print(f"[BotDetector] PR #{pr_number} is safe to review")
        return False, ""

    def mark_reviewed(self, pr_number: int, commit_sha: str) -> None:
        """
        Mark a PR as reviewed at a specific commit.

        This should be called after successfully posting a review.
        Also clears the in-progress state.

        Args:
            pr_number: The PR number
            commit_sha: The commit SHA that was reviewed
        """
        pr_key = str(pr_number)

        # Add to reviewed commits
        if pr_key not in self.state.reviewed_commits:
            self.state.reviewed_commits[pr_key] = []

        if commit_sha not in self.state.reviewed_commits[pr_key]:
            self.state.reviewed_commits[pr_key].append(commit_sha)

        # Update last review time
        self.state.last_review_times[pr_key] = datetime.now().isoformat()

        # Clear in-progress state
        if pr_key in self.state.in_progress_reviews:
            del self.state.in_progress_reviews[pr_key]

        # Save state
        self.state.save(self.state_dir)

        logger.info(
            f"[BotDetector] Marked PR #{pr_number} as reviewed at {commit_sha[:8]} "
            f"({len(self.state.reviewed_commits[pr_key])} total commits reviewed)"
        )

    def clear_pr_state(self, pr_number: int) -> None:
        """
        Clear tracking state for a PR (e.g., when PR is closed/merged).

        Args:
            pr_number: The PR number
        """
        pr_key = str(pr_number)

        if pr_key in self.state.reviewed_commits:
            del self.state.reviewed_commits[pr_key]

        if pr_key in self.state.last_review_times:
            del self.state.last_review_times[pr_key]

        if pr_key in self.state.in_progress_reviews:
            del self.state.in_progress_reviews[pr_key]

        self.state.save(self.state_dir)

        print(f"[BotDetector] Cleared state for PR #{pr_number}")

    def get_stats(self) -> dict:
        """
        Get statistics about bot detection activity.

        Returns:
            Dictionary with stats
        """
        total_prs = len(self.state.reviewed_commits)
        total_reviews = sum(
            len(commits) for commits in self.state.reviewed_commits.values()
        )
        in_progress_count = len(self.state.in_progress_reviews)

        return {
            "bot_username": self.bot_username,
            "review_own_prs": self.review_own_prs,
            "total_prs_tracked": total_prs,
            "total_reviews_performed": total_reviews,
            "in_progress_reviews": in_progress_count,
            "cooling_off_minutes": self.COOLING_OFF_MINUTES,
            "in_progress_timeout_minutes": self.IN_PROGRESS_TIMEOUT_MINUTES,
        }

    def cleanup_stale_prs(self, max_age_days: int = 30) -> int:
        """
        Remove tracking state for PRs that haven't been reviewed recently.

        This prevents unbounded growth of the state file by cleaning up
        entries for PRs that are likely closed/merged.

        Also cleans up stale in-progress reviews (reviews that have been
        in progress for longer than IN_PROGRESS_TIMEOUT_MINUTES).

        Args:
            max_age_days: Remove PRs not reviewed in this many days (default: 30)

        Returns:
            Number of PRs cleaned up
        """
        cutoff = datetime.now() - timedelta(days=max_age_days)
        in_progress_cutoff = datetime.now() - timedelta(
            minutes=self.IN_PROGRESS_TIMEOUT_MINUTES
        )
        prs_to_remove: list[str] = []
        stale_in_progress: list[str] = []

        # Find stale reviewed PRs
        for pr_key, last_review_str in self.state.last_review_times.items():
            try:
                last_review = datetime.fromisoformat(last_review_str)
                if last_review < cutoff:
                    prs_to_remove.append(pr_key)
            except (ValueError, TypeError):
                # Invalid timestamp - mark for removal
                prs_to_remove.append(pr_key)

        # Find stale in-progress reviews
        for pr_key, start_time_str in self.state.in_progress_reviews.items():
            try:
                start_time = datetime.fromisoformat(start_time_str)
                if start_time < in_progress_cutoff:
                    stale_in_progress.append(pr_key)
            except (ValueError, TypeError):
                # Invalid timestamp - mark for removal
                stale_in_progress.append(pr_key)

        # Remove stale PRs
        for pr_key in prs_to_remove:
            if pr_key in self.state.reviewed_commits:
                del self.state.reviewed_commits[pr_key]
            if pr_key in self.state.last_review_times:
                del self.state.last_review_times[pr_key]
            if pr_key in self.state.in_progress_reviews:
                del self.state.in_progress_reviews[pr_key]

        # Remove stale in-progress reviews
        for pr_key in stale_in_progress:
            if pr_key in self.state.in_progress_reviews:
                del self.state.in_progress_reviews[pr_key]

        total_cleaned = len(prs_to_remove) + len(stale_in_progress)

        if total_cleaned > 0:
            self.state.save(self.state_dir)
            if prs_to_remove:
                print(
                    f"[BotDetector] Cleaned up {len(prs_to_remove)} stale PRs "
                    f"(older than {max_age_days} days)"
                )
            if stale_in_progress:
                print(
                    f"[BotDetector] Cleaned up {len(stale_in_progress)} stale in-progress reviews "
                    f"(older than {self.IN_PROGRESS_TIMEOUT_MINUTES} minutes)"
                )

        return total_cleaned

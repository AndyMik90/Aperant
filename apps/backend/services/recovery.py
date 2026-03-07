"""
Smart Rollback and Recovery System
===================================

Automatic recovery from build failures, stuck loops, and broken builds.
Enables true "walk away" automation by detecting and recovering from common failure modes.

Key Features:
- Automatic rollback to last working state
- Circular fix detection (prevents infinite loops)
- Attempt history tracking across sessions
- Smart retry with different approaches
- Escalation to human when stuck
"""

import json
import logging
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path

from core.file_utils import write_json_atomic

# Recovery manager configuration
ATTEMPT_WINDOW_SECONDS = 7200  # Only count attempts within last 2 hours
MAX_ATTEMPT_HISTORY_PER_SUBTASK = 50  # Cap stored attempts per subtask

logger = logging.getLogger(__name__)


class FailureType(Enum):
    """Types of failures that can occur during autonomous builds."""

    BROKEN_BUILD = "broken_build"  # Code doesn't compile/run
    VERIFICATION_FAILED = "verification_failed"  # Subtask verification failed
    CIRCULAR_FIX = "circular_fix"  # Same fix attempted multiple times
    CONTEXT_EXHAUSTED = "context_exhausted"  # Ran out of context mid-subtask
    UNKNOWN = "unknown"


@dataclass
class RecoveryAction:
    """Action to take in response to a failure."""

    action: str  # "rollback", "retry", "skip", "escalate"
    target: str  # commit hash, subtask id, or message
    reason: str


class RecoveryManager:
    """
    Manages recovery from build failures.

    Responsibilities:
    - Track attempt history across sessions
    - Classify failures and determine recovery actions
    - Rollback to working states
    - Detect circular fixes (same approach repeatedly)
    - Escalate stuck subtasks for human intervention
    """

    def __init__(self, spec_dir: Path, project_dir: Path):
        """
        Initialize recovery manager.

        Args:
            spec_dir: Spec directory containing memory/
            project_dir: Root project directory for git operations
        """
        self.spec_dir = spec_dir
        self.project_dir = project_dir
        self.memory_dir = spec_dir / "memory"
        self.attempt_history_file = self.memory_dir / "attempt_history.json"
        self.build_commits_file = self.memory_dir / "build_commits.json"

        # Ensure memory directory exists
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        # Initialize files if they don't exist
        if not self.attempt_history_file.exists():
            self._init_attempt_history()

        if not self.build_commits_file.exists():
            self._init_build_commits()

    def _init_attempt_history(self) -> None:
        """Initialize the attempt history file."""
        initial_data = {
            "subtasks": {},
            "stuck_subtasks": [],
            "metadata": {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_updated": datetime.now(timezone.utc).isoformat(),
            },
        }
        with open(self.attempt_history_file, "w", encoding="utf-8") as f:
            json.dump(initial_data, f, indent=2)

    def _init_build_commits(self) -> None:
        """Initialize the build commits tracking file."""
        initial_data = {
            "commits": [],
            "last_good_commit": None,
            "metadata": {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_updated": datetime.now(timezone.utc).isoformat(),
            },
        }
        with open(self.build_commits_file, "w", encoding="utf-8") as f:
            json.dump(initial_data, f, indent=2)

    def _load_attempt_history(self) -> dict:
        """Load attempt history from JSON file."""
        try:
            with open(self.attempt_history_file, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            self._init_attempt_history()
            with open(self.attempt_history_file, encoding="utf-8") as f:
                return json.load(f)

    def _save_attempt_history(self, data: dict) -> None:
        """Save attempt history to JSON file."""
        data["metadata"]["last_updated"] = datetime.now(timezone.utc).isoformat()
        with open(self.attempt_history_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _load_build_commits(self) -> dict:
        """Load build commits from JSON file."""
        try:
            with open(self.build_commits_file, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            self._init_build_commits()
            with open(self.build_commits_file, encoding="utf-8") as f:
                return json.load(f)

    def _save_build_commits(self, data: dict) -> None:
        """Save build commits to JSON file."""
        data["metadata"]["last_updated"] = datetime.now(timezone.utc).isoformat()
        with open(self.build_commits_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def classify_failure(self, error: str, subtask_id: str) -> FailureType:
        """
        Classify what type of failure occurred.

        Args:
            error: Error message or description
            subtask_id: ID of the subtask that failed

        Returns:
            FailureType enum value
        """
        error_lower = error.lower()

        # Check for broken build indicators
        build_errors = [
            "syntax error",
            "compilation error",
            "module not found",
            "import error",
            "cannot find module",
            "unexpected token",
            "indentation error",
            "parse error",
        ]
        if any(be in error_lower for be in build_errors):
            return FailureType.BROKEN_BUILD

        # Check for verification failures
        verification_errors = [
            "verification failed",
            "expected",
            "assertion",
            "test failed",
            "status code",
        ]
        if any(ve in error_lower for ve in verification_errors):
            return FailureType.VERIFICATION_FAILED

        # Check for context exhaustion
        context_errors = ["context", "token limit", "maximum length"]
        if any(ce in error_lower for ce in context_errors):
            return FailureType.CONTEXT_EXHAUSTED

        # Check for circular fixes (will be determined by attempt history)
        if self.is_circular_fix(subtask_id, error):
            return FailureType.CIRCULAR_FIX

        return FailureType.UNKNOWN

    def get_attempt_count(self, subtask_id: str) -> int:
        """
        Get how many times this subtask has been attempted within the time window.

        Only counts attempts within ATTEMPT_WINDOW_SECONDS (default: 2 hours).
        This prevents unbounded accumulation across crash/restart cycles.

        Args:
            subtask_id: ID of the subtask

        Returns:
            Number of attempts within the time window
        """
        history = self._load_attempt_history()
        subtask_data = history["subtasks"].get(subtask_id, {})
        attempts = subtask_data.get("attempts", [])

        # Calculate cutoff time for the window
        cutoff_time = datetime.now(timezone.utc) - timedelta(
            seconds=ATTEMPT_WINDOW_SECONDS
        )
        # For backward compatibility with naive timestamps, also create naive cutoff
        cutoff_time_naive = datetime.now() - timedelta(seconds=ATTEMPT_WINDOW_SECONDS)

        # Count only attempts within the time window
        recent_count = 0
        for attempt in attempts:
            try:
                attempt_time = datetime.fromisoformat(attempt["timestamp"])
                # Use appropriate cutoff based on whether timestamp is naive or aware
                cutoff = (
                    cutoff_time_naive if attempt_time.tzinfo is None else cutoff_time
                )
                if attempt_time >= cutoff:
                    recent_count += 1
            except (KeyError, ValueError):
                # If timestamp is missing or invalid, count it (backward compatibility)
                recent_count += 1

        return recent_count

    def record_attempt(
        self,
        subtask_id: str,
        session: int,
        success: bool,
        approach: str,
        error: str | None = None,
    ) -> None:
        """
        Record an attempt at a subtask.

        Automatically trims old attempts if the history exceeds MAX_ATTEMPT_HISTORY_PER_SUBTASK.

        Args:
            subtask_id: ID of the subtask
            session: Session number
            success: Whether the attempt succeeded
            approach: Description of the approach taken
            error: Error message if failed
        """
        history = self._load_attempt_history()

        # Initialize subtask entry if it doesn't exist
        if subtask_id not in history["subtasks"]:
            history["subtasks"][subtask_id] = {"attempts": [], "status": "pending"}

        # Add the attempt
        attempt = {
            "session": session,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "approach": approach,
            "success": success,
            "error": error,
        }
        history["subtasks"][subtask_id]["attempts"].append(attempt)

        # Hard cap: trim oldest attempts if we exceed the maximum
        attempts = history["subtasks"][subtask_id]["attempts"]
        if len(attempts) > MAX_ATTEMPT_HISTORY_PER_SUBTASK:
            trimmed_count = len(attempts) - MAX_ATTEMPT_HISTORY_PER_SUBTASK
            history["subtasks"][subtask_id]["attempts"] = attempts[
                -MAX_ATTEMPT_HISTORY_PER_SUBTASK:
            ]
            logger.debug(
                f"Trimmed {trimmed_count} old attempts for subtask {subtask_id} (cap: {MAX_ATTEMPT_HISTORY_PER_SUBTASK})"
            )

        # Update status
        if success:
            history["subtasks"][subtask_id]["status"] = "completed"
        else:
            history["subtasks"][subtask_id]["status"] = "failed"

        self._save_attempt_history(history)

    def is_circular_fix(self, subtask_id: str, current_approach: str) -> bool:
        """
        Detect if we're trying the same approach repeatedly.

        Args:
            subtask_id: ID of the subtask
            current_approach: Description of current approach

        Returns:
            True if this appears to be a circular fix attempt
        """
        history = self._load_attempt_history()
        subtask_data = history["subtasks"].get(subtask_id, {})
        attempts = subtask_data.get("attempts", [])

        if len(attempts) < 2:
            return False

        # Check if last 3 attempts used similar approaches
        # Simple similarity check: look for repeated keywords
        recent_attempts = attempts[-3:] if len(attempts) >= 3 else attempts

        # Extract key terms from current approach (ignore common words)
        stop_words = {
            "with",
            "using",
            "the",
            "a",
            "an",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "trying",
        }
        current_keywords = set(
            word for word in current_approach.lower().split() if word not in stop_words
        )

        similar_count = 0
        for attempt in recent_attempts:
            attempt_keywords = set(
                word
                for word in attempt["approach"].lower().split()
                if word not in stop_words
            )

            # Calculate Jaccard similarity (intersection over union)
            overlap = len(current_keywords & attempt_keywords)
            total = len(current_keywords | attempt_keywords)

            if total > 0:
                similarity = overlap / total
                # If >30% of meaningful words overlap, consider it similar
                # This catches key technical terms appearing repeatedly
                # (e.g., "async await" across multiple attempts)
                if similarity > 0.3:
                    similar_count += 1

        # If 2+ recent attempts were similar to current approach, it's circular
        return similar_count >= 2

    def determine_recovery_action(
        self, failure_type: FailureType, subtask_id: str
    ) -> RecoveryAction:
        """
        Decide what to do based on failure type and history.

        Args:
            failure_type: Type of failure that occurred
            subtask_id: ID of the subtask that failed

        Returns:
            RecoveryAction describing what to do
        """
        attempt_count = self.get_attempt_count(subtask_id)

        if failure_type == FailureType.BROKEN_BUILD:
            # Broken build: rollback to last good state
            last_good = self.get_last_good_commit()
            if last_good:
                return RecoveryAction(
                    action="rollback",
                    target=last_good,
                    reason=f"Build broken in subtask {subtask_id}, rolling back to working state",
                )
            else:
                return RecoveryAction(
                    action="escalate",
                    target=subtask_id,
                    reason="Build broken and no good commit found to rollback to",
                )

        elif failure_type == FailureType.VERIFICATION_FAILED:
            # Verification failed: retry with different approach if < 3 attempts
            if attempt_count < 3:
                return RecoveryAction(
                    action="retry",
                    target=subtask_id,
                    reason=f"Verification failed, retry with different approach (attempt {attempt_count + 1}/3)",
                )
            else:
                return RecoveryAction(
                    action="skip",
                    target=subtask_id,
                    reason=f"Verification failed after {attempt_count} attempts, marking as stuck",
                )

        elif failure_type == FailureType.CIRCULAR_FIX:
            # Circular fix detected: skip and escalate
            return RecoveryAction(
                action="skip",
                target=subtask_id,
                reason="Circular fix detected - same approach tried multiple times",
            )

        elif failure_type == FailureType.CONTEXT_EXHAUSTED:
            # Context exhausted: commit current progress and continue
            return RecoveryAction(
                action="continue",
                target=subtask_id,
                reason="Context exhausted, will commit progress and continue in next session",
            )

        else:  # UNKNOWN
            # Unknown error: retry once, then escalate
            if attempt_count < 2:
                return RecoveryAction(
                    action="retry",
                    target=subtask_id,
                    reason=f"Unknown error, retrying (attempt {attempt_count + 1}/2)",
                )
            else:
                return RecoveryAction(
                    action="escalate",
                    target=subtask_id,
                    reason=f"Unknown error persists after {attempt_count} attempts",
                )

    def get_last_good_commit(self) -> str | None:
        """
        Find the most recent commit where build was working.

        Returns:
            Commit hash or None
        """
        commits = self._load_build_commits()
        return commits.get("last_good_commit")

    def record_good_commit(self, commit_hash: str, subtask_id: str) -> None:
        """
        Record a commit where the build was working.

        Args:
            commit_hash: Git commit hash
            subtask_id: Subtask that was successfully completed
        """
        commits = self._load_build_commits()

        commit_record = {
            "hash": commit_hash,
            "subtask_id": subtask_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        commits["commits"].append(commit_record)
        commits["last_good_commit"] = commit_hash

        self._save_build_commits(commits)

    def rollback_to_commit(self, commit_hash: str) -> bool:
        """
        Rollback to a specific commit.

        Args:
            commit_hash: Git commit hash to rollback to

        Returns:
            True if successful, False otherwise
        """
        try:
            # Use git reset --hard to rollback
            result = subprocess.run(
                ["git", "reset", "--hard", commit_hash],
                cwd=self.project_dir,
                capture_output=True,
                text=True,
                check=True,
            )
            return True
        except subprocess.CalledProcessError as e:
            print(f"Error rolling back to {commit_hash}: {e.stderr}")
            return False

    def mark_subtask_stuck(self, subtask_id: str, reason: str) -> None:
        """
        Mark a subtask as needing human intervention.

        Args:
            subtask_id: ID of the subtask
            reason: Why it's stuck
        """
        history = self._load_attempt_history()

        stuck_entry = {
            "subtask_id": subtask_id,
            "reason": reason,
            "escalated_at": datetime.now(timezone.utc).isoformat(),
            "attempt_count": self.get_attempt_count(subtask_id),
        }

        # Check if already in stuck list
        existing = [
            s for s in history["stuck_subtasks"] if s["subtask_id"] == subtask_id
        ]
        if not existing:
            history["stuck_subtasks"].append(stuck_entry)

        # Update subtask status
        if subtask_id in history["subtasks"]:
            history["subtasks"][subtask_id]["status"] = "stuck"

        self._save_attempt_history(history)

        # Also update the subtask status in implementation_plan.json
        # so that other callers (like is_build_ready_for_qa) see accurate status
        try:
            plan_file = self.spec_dir / "implementation_plan.json"
            if plan_file.exists():
                with open(plan_file, encoding="utf-8") as f:
                    plan = json.load(f)

                updated = False
                for phase in plan.get("phases", []):
                    for subtask in phase.get("subtasks", []):
                        if subtask.get("id") == subtask_id:
                            subtask["status"] = "failed"
                            stuck_note = f"Marked as stuck: {reason}"
                            existing = subtask.get("actual_output", "")
                            subtask["actual_output"] = (
                                f"{stuck_note}\n{existing}" if existing else stuck_note
                            )
                            updated = True
                            break
                    if updated:
                        break

                if updated:
                    write_json_atomic(plan_file, plan, indent=2)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.warning(
                f"Failed to update implementation_plan.json for stuck subtask {subtask_id}: {e}"
            )

    def get_stuck_subtasks(self) -> list[dict]:
        """
        Get all subtasks marked as stuck.

        Returns:
            List of stuck subtask entries
        """
        history = self._load_attempt_history()
        return history.get("stuck_subtasks", [])

    def get_subtask_history(self, subtask_id: str) -> dict:
        """
        Get the attempt history for a specific subtask.

        Args:
            subtask_id: ID of the subtask

        Returns:
            Subtask history dict with attempts
        """
        history = self._load_attempt_history()
        return history["subtasks"].get(
            subtask_id, {"attempts": [], "status": "pending"}
        )

    def get_recovery_hints(self, subtask_id: str) -> list[str]:
        """
        Get hints for recovery based on previous attempts.

        Args:
            subtask_id: ID of the subtask

        Returns:
            List of hint strings
        """
        subtask_history = self.get_subtask_history(subtask_id)
        attempts = subtask_history.get("attempts", [])

        if not attempts:
            return ["This is the first attempt at this subtask"]

        hints = [f"Previous attempts: {len(attempts)}"]

        # Add info about what was tried
        for i, attempt in enumerate(attempts[-3:], 1):
            hints.append(
                f"Attempt {i}: {attempt['approach']} - "
                f"{'SUCCESS' if attempt['success'] else 'FAILED'}"
            )
            if attempt.get("error"):
                hints.append(f"  Error: {attempt['error'][:100]}")

        # Add guidance
        if len(attempts) >= 2:
            hints.append(
                "\n⚠️  IMPORTANT: Try a DIFFERENT approach than previous attempts"
            )
            hints.append(
                "Consider: different library, different pattern, or simpler implementation"
            )

        return hints

    def clear_stuck_subtasks(self) -> None:
        """Clear all stuck subtasks (for manual resolution)."""
        history = self._load_attempt_history()
        history["stuck_subtasks"] = []
        self._save_attempt_history(history)

    def reset_subtask(self, subtask_id: str) -> None:
        """
        Reset a subtask's attempt history.

        Args:
            subtask_id: ID of the subtask to reset
        """
        history = self._load_attempt_history()

        # Clear attempt history
        if subtask_id in history["subtasks"]:
            history["subtasks"][subtask_id] = {"attempts": [], "status": "pending"}

        # Remove from stuck subtasks
        history["stuck_subtasks"] = [
            s for s in history["stuck_subtasks"] if s["subtask_id"] != subtask_id
        ]

        self._save_attempt_history(history)


# Utility functions for integration with agent.py


def check_and_recover(
    spec_dir: Path, project_dir: Path, subtask_id: str, error: str | None = None
) -> RecoveryAction | None:
    """
    Check if recovery is needed and return appropriate action.

    Args:
        spec_dir: Spec directory
        project_dir: Project directory
        subtask_id: Current subtask ID
        error: Error message if any

    Returns:
        RecoveryAction if recovery needed, None otherwise
    """
    if not error:
        return None

    manager = RecoveryManager(spec_dir, project_dir)
    failure_type = manager.classify_failure(error, subtask_id)

    return manager.determine_recovery_action(failure_type, subtask_id)


def get_recovery_context(spec_dir: Path, project_dir: Path, subtask_id: str) -> dict:
    """
    Get recovery context for a subtask (for prompt generation).

    Args:
        spec_dir: Spec directory
        project_dir: Project directory
        subtask_id: Subtask ID

    Returns:
        Dict with recovery hints and history
    """
    manager = RecoveryManager(spec_dir, project_dir)

    return {
        "attempt_count": manager.get_attempt_count(subtask_id),
        "hints": manager.get_recovery_hints(subtask_id),
        "subtask_history": manager.get_subtask_history(subtask_id),
        "stuck_subtasks": manager.get_stuck_subtasks(),
    }


def reset_subtask(spec_dir: Path, project_dir: Path, subtask_id: str) -> None:
    """
    Reset a subtask's attempt history (module-level wrapper).

    Args:
        spec_dir: Spec directory
        project_dir: Project directory
        subtask_id: Subtask ID to reset
    """
    manager = RecoveryManager(spec_dir, project_dir)
    manager.reset_subtask(subtask_id)


def clear_stuck_subtasks(spec_dir: Path, project_dir: Path) -> None:
    """
    Clear all stuck subtasks (module-level wrapper).

    Args:
        spec_dir: Spec directory
        project_dir: Project directory
    """
    manager = RecoveryManager(spec_dir, project_dir)
    manager.clear_stuck_subtasks()

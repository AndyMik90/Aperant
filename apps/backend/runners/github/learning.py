"""
Learning Loop & Outcome Tracking
================================

Tracks review outcomes, predictions, and accuracy to enable system improvement.

Features:
- ReviewOutcome model for tracking predictions vs actual results
- Accuracy metrics per-repo and aggregate
- Pattern detection for cross-project learning
- Feedback loop for prompt optimization

Usage:
    tracker = LearningTracker(state_dir=Path(".auto-claude/github"))

    # Record a prediction
    tracker.record_prediction("repo", review_id, "request_changes", findings)

    # Later, record the outcome
    tracker.record_outcome("repo", review_id, "merged", time_to_merge=timedelta(hours=2))

    # Get accuracy metrics
    metrics = tracker.get_accuracy("repo")
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any


class PredictionType(str, Enum):
    """Types of predictions the system makes."""

    REVIEW_APPROVE = "review_approve"
    REVIEW_REQUEST_CHANGES = "review_request_changes"
    TRIAGE_BUG = "triage_bug"
    TRIAGE_FEATURE = "triage_feature"
    TRIAGE_SPAM = "triage_spam"
    TRIAGE_DUPLICATE = "triage_duplicate"
    AUTOFIX_WILL_WORK = "autofix_will_work"
    LABEL_APPLIED = "label_applied"


class OutcomeType(str, Enum):
    """Actual outcomes that occurred."""

    MERGED = "merged"
    CLOSED = "closed"
    MODIFIED = "modified"  # Changes requested, author modified
    REJECTED = "rejected"  # Override or reversal
    OVERRIDDEN = "overridden"  # User overrode the action
    IGNORED = "ignored"  # No action taken by user
    CONFIRMED = "confirmed"  # User confirmed correct
    STALE = "stale"  # Too old to determine


class AuthorResponse(str, Enum):
    """How the PR/issue author responded to the action."""

    ACCEPTED = "accepted"  # Made requested changes
    DISPUTED = "disputed"  # Pushed back on feedback
    IGNORED = "ignored"  # No response
    THANKED = "thanked"  # Positive acknowledgment
    UNKNOWN = "unknown"  # Can't determine


@dataclass
class ReviewOutcome:
    """
    Tracks prediction vs actual outcome for a review.

    Used to calculate accuracy and identify patterns.
    """

    review_id: str
    repo: str
    pr_number: int
    prediction: PredictionType
    findings_count: int
    high_severity_count: int
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Outcome data (filled in later)
    actual_outcome: OutcomeType | None = None
    time_to_outcome: timedelta | None = None
    author_response: AuthorResponse = AuthorResponse.UNKNOWN
    outcome_recorded_at: datetime | None = None

    # Context for learning
    file_types: list[str] = field(default_factory=list)
    change_size: str = "medium"  # small/medium/large based on additions+deletions
    categories: list[str] = field(default_factory=list)  # security, bug, style, etc.

    @property
    def was_correct(self) -> bool | None:
        """Determine if the prediction was correct."""
        if self.actual_outcome is None:
            return None

        # Review predictions
        if self.prediction == PredictionType.REVIEW_APPROVE:
            return self.actual_outcome in {OutcomeType.MERGED, OutcomeType.CONFIRMED}
        elif self.prediction == PredictionType.REVIEW_REQUEST_CHANGES:
            return self.actual_outcome in {OutcomeType.MODIFIED, OutcomeType.CONFIRMED}

        # Triage predictions
        elif self.prediction == PredictionType.TRIAGE_SPAM:
            return self.actual_outcome in {OutcomeType.CLOSED, OutcomeType.CONFIRMED}
        elif self.prediction == PredictionType.TRIAGE_DUPLICATE:
            return self.actual_outcome in {OutcomeType.CLOSED, OutcomeType.CONFIRMED}

        # Override means we were wrong
        if self.actual_outcome == OutcomeType.OVERRIDDEN:
            return False

        return None

    @property
    def is_complete(self) -> bool:
        """Check if outcome has been recorded."""
        return self.actual_outcome is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "review_id": self.review_id,
            "repo": self.repo,
            "pr_number": self.pr_number,
            "prediction": self.prediction.value,
            "findings_count": self.findings_count,
            "high_severity_count": self.high_severity_count,
            "created_at": self.created_at.isoformat(),
            "actual_outcome": self.actual_outcome.value
            if self.actual_outcome
            else None,
            "time_to_outcome": self.time_to_outcome.total_seconds()
            if self.time_to_outcome
            else None,
            "author_response": self.author_response.value,
            "outcome_recorded_at": self.outcome_recorded_at.isoformat()
            if self.outcome_recorded_at
            else None,
            "file_types": self.file_types,
            "change_size": self.change_size,
            "categories": self.categories,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ReviewOutcome:
        time_to_outcome = None
        if data.get("time_to_outcome") is not None:
            time_to_outcome = timedelta(seconds=data["time_to_outcome"])

        outcome_recorded = None
        if data.get("outcome_recorded_at"):
            outcome_recorded = datetime.fromisoformat(data["outcome_recorded_at"])

        return cls(
            review_id=data["review_id"],
            repo=data["repo"],
            pr_number=data["pr_number"],
            prediction=PredictionType(data["prediction"]),
            findings_count=data.get("findings_count", 0),
            high_severity_count=data.get("high_severity_count", 0),
            created_at=datetime.fromisoformat(data["created_at"]),
            actual_outcome=OutcomeType(data["actual_outcome"])
            if data.get("actual_outcome")
            else None,
            time_to_outcome=time_to_outcome,
            author_response=AuthorResponse(data.get("author_response", "unknown")),
            outcome_recorded_at=outcome_recorded,
            file_types=data.get("file_types", []),
            change_size=data.get("change_size", "medium"),
            categories=data.get("categories", []),
        )


@dataclass
class AccuracyStats:
    """Accuracy statistics for a time period or repo."""

    total_predictions: int = 0
    correct_predictions: int = 0
    incorrect_predictions: int = 0
    pending_outcomes: int = 0

    # By prediction type
    by_type: dict[str, dict[str, int]] = field(default_factory=dict)

    # Time metrics
    avg_time_to_merge: timedelta | None = None
    avg_time_to_feedback: timedelta | None = None

    @property
    def accuracy(self) -> float:
        """Overall accuracy rate."""
        resolved = self.correct_predictions + self.incorrect_predictions
        if resolved == 0:
            return 0.0
        return self.correct_predictions / resolved

    @property
    def completion_rate(self) -> float:
        """Rate of outcomes tracked."""
        if self.total_predictions == 0:
            return 0.0
        return (self.total_predictions - self.pending_outcomes) / self.total_predictions

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_predictions": self.total_predictions,
            "correct_predictions": self.correct_predictions,
            "incorrect_predictions": self.incorrect_predictions,
            "pending_outcomes": self.pending_outcomes,
            "accuracy": self.accuracy,
            "completion_rate": self.completion_rate,
            "by_type": self.by_type,
            "avg_time_to_merge": self.avg_time_to_merge.total_seconds()
            if self.avg_time_to_merge
            else None,
        }


@dataclass
class LearningPattern:
    """
    Detected pattern for cross-project learning.

    Anonymized and aggregated for privacy.
    """

    pattern_id: str
    pattern_type: str  # e.g., "file_type_accuracy", "category_accuracy"
    context: dict[str, Any]  # e.g., {"file_type": "py", "category": "security"}
    sample_size: int
    accuracy: float
    confidence: float  # Based on sample size
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "pattern_id": self.pattern_id,
            "pattern_type": self.pattern_type,
            "context": self.context,
            "sample_size": self.sample_size,
            "accuracy": self.accuracy,
            "confidence": self.confidence,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class LearningTracker:
    """
    Tracks predictions and outcomes to enable learning.

    Usage:
        tracker = LearningTracker(state_dir=Path(".auto-claude/github"))

        # Record prediction when making a review
        tracker.record_prediction(
            repo="owner/repo",
            review_id="review-123",
            prediction=PredictionType.REVIEW_REQUEST_CHANGES,
            findings_count=5,
            high_severity_count=2,
            file_types=["py", "ts"],
            categories=["security", "bug"],
        )

        # Later, record outcome
        tracker.record_outcome(
            repo="owner/repo",
            review_id="review-123",
            outcome=OutcomeType.MODIFIED,
            time_to_outcome=timedelta(hours=2),
            author_response=AuthorResponse.ACCEPTED,
        )
    """

    def __init__(self, state_dir: Path):
        self.state_dir = state_dir
        self.learning_dir = state_dir / "learning"
        self.learning_dir.mkdir(parents=True, exist_ok=True)

        self._outcomes: dict[str, ReviewOutcome] = {}
        self._load_outcomes()

    def _get_outcomes_file(self, repo: str) -> Path:
        safe_name = repo.replace("/", "_")
        return self.learning_dir / f"{safe_name}_outcomes.json"

    def _load_outcomes(self) -> None:
        """Load all outcomes from disk."""
        for file in self.learning_dir.glob("*_outcomes.json"):
            try:
                with open(file, encoding="utf-8") as f:
                    data = json.load(f)
                    for item in data.get("outcomes", []):
                        outcome = ReviewOutcome.from_dict(item)
                        self._outcomes[outcome.review_id] = outcome
            except (json.JSONDecodeError, KeyError):
                continue

    def _save_outcomes(self, repo: str) -> None:
        """Save outcomes for a repo to disk with file locking for concurrency safety."""
        from .file_lock import FileLock, atomic_write

        file = self._get_outcomes_file(repo)
        repo_outcomes = [o for o in self._outcomes.values() if o.repo == repo]

        data = {
            "repo": repo,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "outcomes": [o.to_dict() for o in repo_outcomes],
        }

        # Use file locking and atomic write for safe concurrent access
        with FileLock(file, timeout=5.0):
            with atomic_write(file) as f:
                json.dump(data, f, indent=2)

    def record_prediction(
        self,
        repo: str,
        review_id: str,
        prediction: PredictionType,
        pr_number: int = 0,
        findings_count: int = 0,
        high_severity_count: int = 0,
        file_types: list[str] | None = None,
        change_size: str = "medium",
        categories: list[str] | None = None,
    ) -> ReviewOutcome:
        """
        Record a prediction made by the system.

        Args:
            repo: Repository
            review_id: Unique identifier for this review
            prediction: The prediction type
            pr_number: PR number (if applicable)
            findings_count: Number of findings
            high_severity_count: High severity findings
            file_types: File types involved
            change_size: Size category (small/medium/large)
            categories: Finding categories

        Returns:
            The created ReviewOutcome
        """
        outcome = ReviewOutcome(
            review_id=review_id,
            repo=repo,
            pr_number=pr_number,
            prediction=prediction,
            findings_count=findings_count,
            high_severity_count=high_severity_count,
            file_types=file_types or [],
            change_size=change_size,
            categories=categories or [],
        )

        self._outcomes[review_id] = outcome
        self._save_outcomes(repo)

        return outcome

    def record_outcome(
        self,
        repo: str,
        review_id: str,
        outcome: OutcomeType,
        time_to_outcome: timedelta | None = None,
        author_response: AuthorResponse = AuthorResponse.UNKNOWN,
    ) -> ReviewOutcome | None:
        """
        Record the actual outcome for a prediction.

        Args:
            repo: Repository
            review_id: The review ID to update
            outcome: What actually happened
            time_to_outcome: Time from prediction to outcome
            author_response: How the author responded

        Returns:
            Updated ReviewOutcome or None if not found
        """
        if review_id not in self._outcomes:
            return None

        review_outcome = self._outcomes[review_id]
        review_outcome.actual_outcome = outcome
        review_outcome.time_to_outcome = time_to_outcome
        review_outcome.author_response = author_response
        review_outcome.outcome_recorded_at = datetime.now(timezone.utc)

        self._save_outcomes(repo)

        return review_outcome

    def get_pending_outcomes(self, repo: str | None = None) -> list[ReviewOutcome]:
        """Get predictions that don't have outcomes yet."""
        pending = []
        for outcome in self._outcomes.values():
            if not outcome.is_complete:
                if repo is None or outcome.repo == repo:
                    pending.append(outcome)
        return pending

    def get_accuracy(
        self,
        repo: str | None = None,
        since: datetime | None = None,
        prediction_type: PredictionType | None = None,
    ) -> AccuracyStats:
        """
        Get accuracy statistics.

        Args:
            repo: Filter by repo (None for all)
            since: Only include predictions after this time
            prediction_type: Filter by prediction type

        Returns:
            AccuracyStats with aggregated metrics
        """
        stats = AccuracyStats()
        merge_times = []

        for outcome in self._outcomes.values():
            # Apply filters
            if repo and outcome.repo != repo:
                continue
            if since and outcome.created_at < since:
                continue
            if prediction_type and outcome.prediction != prediction_type:
                continue

            stats.total_predictions += 1

            # Track by type
            type_key = outcome.prediction.value
            if type_key not in stats.by_type:
                stats.by_type[type_key] = {"total": 0, "correct": 0, "incorrect": 0}
            stats.by_type[type_key]["total"] += 1

            if outcome.is_complete:
                was_correct = outcome.was_correct
                if was_correct is True:
                    stats.correct_predictions += 1
                    stats.by_type[type_key]["correct"] += 1
                elif was_correct is False:
                    stats.incorrect_predictions += 1
                    stats.by_type[type_key]["incorrect"] += 1

                # Track merge times
                if (
                    outcome.actual_outcome == OutcomeType.MERGED
                    and outcome.time_to_outcome
                ):
                    merge_times.append(outcome.time_to_outcome)
            else:
                stats.pending_outcomes += 1

        # Calculate average merge time
        if merge_times:
            avg_seconds = sum(t.total_seconds() for t in merge_times) / len(merge_times)
            stats.avg_time_to_merge = timedelta(seconds=avg_seconds)

        return stats

    def get_recent_outcomes(
        self,
        repo: str | None = None,
        limit: int = 50,
    ) -> list[ReviewOutcome]:
        """Get recent outcomes, most recent first."""
        outcomes = list(self._outcomes.values())

        if repo:
            outcomes = [o for o in outcomes if o.repo == repo]

        outcomes.sort(key=lambda o: o.created_at, reverse=True)
        return outcomes[:limit]

    def detect_patterns(self, min_sample_size: int = 20) -> list[LearningPattern]:
        """
        Detect learning patterns from outcomes.

        Aggregates data to identify where the system performs well or poorly.

        Args:
            min_sample_size: Minimum samples to create a pattern

        Returns:
            List of detected patterns
        """
        patterns = []

        # Pattern: Accuracy by file type
        by_file_type: dict[str, dict[str, int]] = {}
        for outcome in self._outcomes.values():
            if not outcome.is_complete or outcome.was_correct is None:
                continue

            for file_type in outcome.file_types:
                if file_type not in by_file_type:
                    by_file_type[file_type] = {"correct": 0, "incorrect": 0}

                if outcome.was_correct:
                    by_file_type[file_type]["correct"] += 1
                else:
                    by_file_type[file_type]["incorrect"] += 1

        for file_type, counts in by_file_type.items():
            total = counts["correct"] + counts["incorrect"]
            if total >= min_sample_size:
                accuracy = counts["correct"] / total
                confidence = min(1.0, total / 100)  # More samples = higher confidence

                patterns.append(
                    LearningPattern(
                        pattern_id=f"file_type_{file_type}",
                        pattern_type="file_type_accuracy",
                        context={"file_type": file_type},
                        sample_size=total,
                        accuracy=accuracy,
                        confidence=confidence,
                    )
                )

        # Pattern: Accuracy by category
        by_category: dict[str, dict[str, int]] = {}
        for outcome in self._outcomes.values():
            if not outcome.is_complete or outcome.was_correct is None:
                continue

            for category in outcome.categories:
                if category not in by_category:
                    by_category[category] = {"correct": 0, "incorrect": 0}

                if outcome.was_correct:
                    by_category[category]["correct"] += 1
                else:
                    by_category[category]["incorrect"] += 1

        for category, counts in by_category.items():
            total = counts["correct"] + counts["incorrect"]
            if total >= min_sample_size:
                accuracy = counts["correct"] / total
                confidence = min(1.0, total / 100)

                patterns.append(
                    LearningPattern(
                        pattern_id=f"category_{category}",
                        pattern_type="category_accuracy",
                        context={"category": category},
                        sample_size=total,
                        accuracy=accuracy,
                        confidence=confidence,
                    )
                )

        # Pattern: Accuracy by change size
        by_size: dict[str, dict[str, int]] = {}
        for outcome in self._outcomes.values():
            if not outcome.is_complete or outcome.was_correct is None:
                continue

            size = outcome.change_size
            if size not in by_size:
                by_size[size] = {"correct": 0, "incorrect": 0}

            if outcome.was_correct:
                by_size[size]["correct"] += 1
            else:
                by_size[size]["incorrect"] += 1

        for size, counts in by_size.items():
            total = counts["correct"] + counts["incorrect"]
            if total >= min_sample_size:
                accuracy = counts["correct"] / total
                confidence = min(1.0, total / 100)

                patterns.append(
                    LearningPattern(
                        pattern_id=f"change_size_{size}",
                        pattern_type="change_size_accuracy",
                        context={"change_size": size},
                        sample_size=total,
                        accuracy=accuracy,
                        confidence=confidence,
                    )
                )

        return patterns

    def get_dashboard_data(self, repo: str | None = None) -> dict[str, Any]:
        """
        Get data for an accuracy dashboard.

        Returns summary suitable for UI display.
        """
        now = datetime.now(timezone.utc)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)

        return {
            "all_time": self.get_accuracy(repo).to_dict(),
            "last_week": self.get_accuracy(repo, since=week_ago).to_dict(),
            "last_month": self.get_accuracy(repo, since=month_ago).to_dict(),
            "patterns": [p.to_dict() for p in self.detect_patterns()],
            "recent_outcomes": [
                o.to_dict() for o in self.get_recent_outcomes(repo, limit=10)
            ],
            "pending_count": len(self.get_pending_outcomes(repo)),
        }

    def check_pr_status(
        self,
        repo: str,
        gh_provider,
    ) -> int:
        """
        Check status of pending outcomes by querying GitHub.

        Args:
            repo: Repository to check
            gh_provider: GitHubProvider instance

        Returns:
            Number of outcomes updated
        """
        # This would be called periodically to update pending outcomes
        # Implementation depends on gh_provider being async
        # Leaving as stub for now
        return 0

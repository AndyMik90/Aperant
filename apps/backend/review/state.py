"""
Review State Management
=======================

Handles the persistence and validation of review approval state for specs.
Tracks approval status, feedback, and detects changes to specs after approval.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# State file name
REVIEW_STATE_FILE = "review_state.json"


def _compute_file_hash(file_path: Path) -> str:
    """Compute MD5 hash of a file's contents for change detection."""
    if not file_path.exists():
        return ""
    try:
        content = file_path.read_text(encoding="utf-8")
        return hashlib.md5(content.encode("utf-8"), usedforsecurity=False).hexdigest()
    except (OSError, UnicodeDecodeError):
        return ""


def _compute_spec_hash(spec_dir: Path) -> str:
    """
    Compute a combined hash of spec.md and implementation_plan.json.
    Used to detect changes after approval.
    """
    spec_hash = _compute_file_hash(spec_dir / "spec.md")
    plan_hash = _compute_file_hash(spec_dir / "implementation_plan.json")
    combined = f"{spec_hash}:{plan_hash}"
    return hashlib.md5(combined.encode("utf-8"), usedforsecurity=False).hexdigest()


@dataclass
class ReviewState:
    """
    Tracks human review status for a spec.

    Attributes:
        approved: Whether the spec has been approved for build
        approved_by: Who approved (username or 'auto' for --auto-approve)
        approved_at: ISO timestamp of approval
        feedback: List of feedback comments from review sessions
        spec_hash: Hash of spec files at time of approval (for change detection)
        review_count: Number of review sessions conducted
    """

    approved: bool = False
    approved_by: str = ""
    approved_at: str = ""
    feedback: list[str] = field(default_factory=list)
    spec_hash: str = ""
    review_count: int = 0

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "approved": self.approved,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at,
            "feedback": self.feedback,
            "spec_hash": self.spec_hash,
            "review_count": self.review_count,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ReviewState":
        """Create from dictionary."""
        return cls(
            approved=data.get("approved", False),
            approved_by=data.get("approved_by", ""),
            approved_at=data.get("approved_at", ""),
            feedback=data.get("feedback", []),
            spec_hash=data.get("spec_hash", ""),
            review_count=data.get("review_count", 0),
        )

    def save(self, spec_dir: Path) -> None:
        """Save state to the spec directory."""
        state_file = Path(spec_dir) / REVIEW_STATE_FILE
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, spec_dir: Path) -> "ReviewState":
        """
        Load state from the spec directory.

        Returns a new empty ReviewState if file doesn't exist or is invalid.
        """
        state_file = Path(spec_dir) / REVIEW_STATE_FILE
        if not state_file.exists():
            return cls()

        try:
            with open(state_file, encoding="utf-8") as f:
                return cls.from_dict(json.load(f))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return cls()

    def is_approved(self) -> bool:
        """Check if the spec is approved (simple check)."""
        return self.approved

    def is_approval_valid(self, spec_dir: Path) -> bool:
        """
        Check if the approval is still valid (spec hasn't changed).

        Returns False if:
        - Not approved
        - spec.md or implementation_plan.json changed since approval
        """
        if not self.approved:
            return False

        if not self.spec_hash:
            # Legacy approval without hash - treat as valid
            return True

        current_hash = _compute_spec_hash(spec_dir)
        return self.spec_hash == current_hash

    def approve(
        self,
        spec_dir: Path,
        approved_by: str = "user",
        auto_save: bool = True,
    ) -> None:
        """
        Mark the spec as approved and compute the current hash.

        Args:
            spec_dir: Spec directory path
            approved_by: Who is approving ('user', 'auto', or username)
            auto_save: Whether to automatically save after approval
        """
        self.approved = True
        self.approved_by = approved_by
        self.approved_at = datetime.now().isoformat()
        self.spec_hash = _compute_spec_hash(spec_dir)
        self.review_count += 1

        if auto_save:
            self.save(spec_dir)

    def reject(self, spec_dir: Path, auto_save: bool = True) -> None:
        """
        Mark the spec as not approved.

        Args:
            spec_dir: Spec directory path
            auto_save: Whether to automatically save after rejection
        """
        self.approved = False
        self.approved_by = ""
        self.approved_at = ""
        self.spec_hash = ""
        self.review_count += 1

        if auto_save:
            self.save(spec_dir)

    def add_feedback(
        self,
        feedback: str,
        spec_dir: Path | None = None,
        auto_save: bool = True,
    ) -> None:
        """
        Add a feedback comment.

        Args:
            feedback: The feedback text to add
            spec_dir: Spec directory path (required if auto_save=True)
            auto_save: Whether to automatically save after adding feedback
        """
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        self.feedback.append(f"[{timestamp}] {feedback}")

        if auto_save and spec_dir:
            self.save(spec_dir)

    def invalidate(self, spec_dir: Path, auto_save: bool = True) -> None:
        """
        Invalidate the current approval (e.g., when spec changes).

        Keeps the feedback history but clears approval status.

        Args:
            spec_dir: Spec directory path
            auto_save: Whether to automatically save
        """
        self.approved = False
        self.approved_at = ""
        self.spec_hash = ""
        # Keep approved_by and feedback as history

        if auto_save:
            self.save(spec_dir)


def get_review_status_summary(spec_dir: Path) -> dict:
    """
    Get a summary of the review status for display.

    Returns:
        Dictionary with status information
    """
    state = ReviewState.load(spec_dir)
    current_hash = _compute_spec_hash(spec_dir)

    return {
        "approved": state.approved,
        "valid": state.is_approval_valid(spec_dir),
        "approved_by": state.approved_by,
        "approved_at": state.approved_at,
        "review_count": state.review_count,
        "feedback_count": len(state.feedback),
        "spec_changed": state.spec_hash != current_hash if state.spec_hash else False,
    }

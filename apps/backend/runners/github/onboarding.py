"""
Onboarding & Progressive Enablement
====================================

Provides guided setup and progressive enablement for GitHub automation.

Features:
- Setup wizard for initial configuration
- Auto-creation of required labels
- Permission validation during setup
- Dry run mode (show what WOULD happen)
- Test mode for first week (comment only)
- Progressive enablement based on accuracy

Usage:
    onboarding = OnboardingManager(config, gh_provider)

    # Run setup wizard
    setup_result = await onboarding.run_setup()

    # Check if in test mode
    if onboarding.is_test_mode():
        # Only comment, don't take actions

    # Get onboarding checklist
    checklist = onboarding.get_checklist()

CLI:
    python runner.py setup --repo owner/repo
    python runner.py setup --dry-run
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any

# Import providers
try:
    from .providers.protocol import LabelData
except (ImportError, ValueError, SystemError):

    @dataclass
    class LabelData:
        name: str
        color: str
        description: str = ""


class OnboardingPhase(str, Enum):
    """Phases of onboarding."""

    NOT_STARTED = "not_started"
    SETUP_PENDING = "setup_pending"
    TEST_MODE = "test_mode"  # Week 1: Comment only
    TRIAGE_ENABLED = "triage_enabled"  # Week 2: Triage active
    REVIEW_ENABLED = "review_enabled"  # Week 3: PR review active
    FULL_ENABLED = "full_enabled"  # Full automation


class EnablementLevel(str, Enum):
    """Progressive enablement levels."""

    OFF = "off"
    COMMENT_ONLY = "comment_only"  # Test mode
    TRIAGE_ONLY = "triage_only"  # Triage + labeling
    REVIEW_ONLY = "review_only"  # PR reviews
    FULL = "full"  # Everything including auto-fix


@dataclass
class ChecklistItem:
    """Single item in the onboarding checklist."""

    id: str
    title: str
    description: str
    completed: bool = False
    required: bool = True
    completed_at: datetime | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "completed": self.completed,
            "required": self.required,
            "completed_at": self.completed_at.isoformat()
            if self.completed_at
            else None,
            "error": self.error,
        }


@dataclass
class SetupResult:
    """Result of running setup."""

    success: bool
    phase: OnboardingPhase
    checklist: list[ChecklistItem]
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    dry_run: bool = False

    @property
    def completion_rate(self) -> float:
        if not self.checklist:
            return 0.0
        completed = sum(1 for item in self.checklist if item.completed)
        return completed / len(self.checklist)

    @property
    def required_complete(self) -> bool:
        return all(item.completed for item in self.checklist if item.required)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "phase": self.phase.value,
            "completion_rate": self.completion_rate,
            "required_complete": self.required_complete,
            "checklist": [item.to_dict() for item in self.checklist],
            "errors": self.errors,
            "warnings": self.warnings,
            "dry_run": self.dry_run,
        }


@dataclass
class OnboardingState:
    """Persistent onboarding state for a repository."""

    repo: str
    phase: OnboardingPhase = OnboardingPhase.NOT_STARTED
    started_at: datetime | None = None
    completed_items: list[str] = field(default_factory=list)
    enablement_level: EnablementLevel = EnablementLevel.OFF
    test_mode_ends_at: datetime | None = None
    auto_upgrade_enabled: bool = True

    # Accuracy tracking for auto-progression
    triage_accuracy: float = 0.0
    triage_actions: int = 0
    review_accuracy: float = 0.0
    review_actions: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "repo": self.repo,
            "phase": self.phase.value,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_items": self.completed_items,
            "enablement_level": self.enablement_level.value,
            "test_mode_ends_at": self.test_mode_ends_at.isoformat()
            if self.test_mode_ends_at
            else None,
            "auto_upgrade_enabled": self.auto_upgrade_enabled,
            "triage_accuracy": self.triage_accuracy,
            "triage_actions": self.triage_actions,
            "review_accuracy": self.review_accuracy,
            "review_actions": self.review_actions,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> OnboardingState:
        started = None
        if data.get("started_at"):
            started = datetime.fromisoformat(data["started_at"])

        test_ends = None
        if data.get("test_mode_ends_at"):
            test_ends = datetime.fromisoformat(data["test_mode_ends_at"])

        return cls(
            repo=data["repo"],
            phase=OnboardingPhase(data.get("phase", "not_started")),
            started_at=started,
            completed_items=data.get("completed_items", []),
            enablement_level=EnablementLevel(data.get("enablement_level", "off")),
            test_mode_ends_at=test_ends,
            auto_upgrade_enabled=data.get("auto_upgrade_enabled", True),
            triage_accuracy=data.get("triage_accuracy", 0.0),
            triage_actions=data.get("triage_actions", 0),
            review_accuracy=data.get("review_accuracy", 0.0),
            review_actions=data.get("review_actions", 0),
        )


# Required labels with their colors and descriptions
REQUIRED_LABELS = [
    LabelData(
        name="auto-fix",
        color="0E8A16",
        description="Trigger automatic fix attempt by AI",
    ),
    LabelData(
        name="auto-triage",
        color="1D76DB",
        description="Automatically triage and categorize this issue",
    ),
    LabelData(
        name="ai-reviewed",
        color="5319E7",
        description="This PR has been reviewed by AI",
    ),
    LabelData(
        name="type:bug",
        color="D73A4A",
        description="Something isn't working",
    ),
    LabelData(
        name="type:feature",
        color="0075CA",
        description="New feature or request",
    ),
    LabelData(
        name="type:docs",
        color="0075CA",
        description="Documentation changes",
    ),
    LabelData(
        name="priority:high",
        color="B60205",
        description="High priority issue",
    ),
    LabelData(
        name="priority:medium",
        color="FBCA04",
        description="Medium priority issue",
    ),
    LabelData(
        name="priority:low",
        color="0E8A16",
        description="Low priority issue",
    ),
    LabelData(
        name="duplicate",
        color="CFD3D7",
        description="This issue or PR already exists",
    ),
    LabelData(
        name="spam",
        color="000000",
        description="Spam or invalid issue",
    ),
]


class OnboardingManager:
    """
    Manages onboarding and progressive enablement.

    Progressive enablement schedule:
    - Week 1 (Test Mode): Comment what would be done, no actions
    - Week 2 (Triage): Enable triage if accuracy > 80%
    - Week 3 (Review): Enable PR review if triage accuracy > 85%
    - Week 4+ (Full): Enable auto-fix if review accuracy > 90%
    """

    # Thresholds for auto-progression
    TRIAGE_THRESHOLD = 0.80  # 80% accuracy
    REVIEW_THRESHOLD = 0.85  # 85% accuracy
    AUTOFIX_THRESHOLD = 0.90  # 90% accuracy
    MIN_ACTIONS_TO_UPGRADE = 20

    def __init__(
        self,
        repo: str,
        state_dir: Path | None = None,
        gh_provider: Any = None,
    ):
        """
        Initialize onboarding manager.

        Args:
            repo: Repository in owner/repo format
            state_dir: Directory for state files
            gh_provider: GitHub provider for API calls
        """
        self.repo = repo
        self.state_dir = state_dir or Path(".auto-claude/github")
        self.gh_provider = gh_provider
        self._state: OnboardingState | None = None

    @property
    def state_file(self) -> Path:
        safe_name = self.repo.replace("/", "_")
        return self.state_dir / "onboarding" / f"{safe_name}.json"

    def get_state(self) -> OnboardingState:
        """Get or create onboarding state."""
        if self._state:
            return self._state

        if self.state_file.exists():
            try:
                with open(self.state_file, encoding="utf-8") as f:
                    data = json.load(f)
                    self._state = OnboardingState.from_dict(data)
            except (json.JSONDecodeError, KeyError):
                self._state = OnboardingState(repo=self.repo)
        else:
            self._state = OnboardingState(repo=self.repo)

        return self._state

    def save_state(self) -> None:
        """Save onboarding state."""
        state = self.get_state()
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(state.to_dict(), f, indent=2)

    async def run_setup(
        self,
        dry_run: bool = False,
        skip_labels: bool = False,
    ) -> SetupResult:
        """
        Run the setup wizard.

        Args:
            dry_run: If True, only report what would be done
            skip_labels: Skip label creation

        Returns:
            SetupResult with checklist status
        """
        checklist = []
        errors = []
        warnings = []

        # 1. Check GitHub authentication
        auth_item = ChecklistItem(
            id="auth",
            title="GitHub Authentication",
            description="Verify GitHub CLI is authenticated",
        )
        try:
            if self.gh_provider:
                await self.gh_provider.get_repository_info()
                auth_item.completed = True
                auth_item.completed_at = datetime.now(timezone.utc)
            elif not dry_run:
                errors.append("No GitHub provider configured")
        except Exception as e:
            auth_item.error = str(e)
            errors.append(f"Authentication failed: {e}")
        checklist.append(auth_item)

        # 2. Check repository permissions
        perms_item = ChecklistItem(
            id="permissions",
            title="Repository Permissions",
            description="Verify push access to repository",
        )
        try:
            if self.gh_provider and not dry_run:
                # Try to get repo info to verify access
                repo_info = await self.gh_provider.get_repository_info()
                permissions = repo_info.get("permissions", {})
                if permissions.get("push"):
                    perms_item.completed = True
                    perms_item.completed_at = datetime.now(timezone.utc)
                else:
                    perms_item.error = "Missing push permission"
                    warnings.append("Write access recommended for full functionality")
            elif dry_run:
                perms_item.completed = True
        except Exception as e:
            perms_item.error = str(e)
        checklist.append(perms_item)

        # 3. Create required labels
        labels_item = ChecklistItem(
            id="labels",
            title="Required Labels",
            description=f"Create {len(REQUIRED_LABELS)} automation labels",
        )
        if skip_labels:
            labels_item.completed = True
            labels_item.description = "Skipped (--skip-labels)"
        elif dry_run:
            labels_item.completed = True
            labels_item.description = f"Would create {len(REQUIRED_LABELS)} labels"
        else:
            try:
                if self.gh_provider:
                    created = 0
                    for label in REQUIRED_LABELS:
                        try:
                            await self.gh_provider.create_label(label)
                            created += 1
                        except Exception:
                            pass  # Label might already exist
                    labels_item.completed = True
                    labels_item.completed_at = datetime.now(timezone.utc)
                    labels_item.description = f"Created/verified {created} labels"
            except Exception as e:
                labels_item.error = str(e)
                errors.append(f"Label creation failed: {e}")
        checklist.append(labels_item)

        # 4. Initialize state directory
        state_item = ChecklistItem(
            id="state",
            title="State Directory",
            description="Create local state directory for automation data",
        )
        if dry_run:
            state_item.completed = True
            state_item.description = f"Would create {self.state_dir}"
        else:
            try:
                self.state_dir.mkdir(parents=True, exist_ok=True)
                (self.state_dir / "pr").mkdir(exist_ok=True)
                (self.state_dir / "issues").mkdir(exist_ok=True)
                (self.state_dir / "autofix").mkdir(exist_ok=True)
                (self.state_dir / "audit").mkdir(exist_ok=True)
                state_item.completed = True
                state_item.completed_at = datetime.now(timezone.utc)
            except Exception as e:
                state_item.error = str(e)
                errors.append(f"State directory creation failed: {e}")
        checklist.append(state_item)

        # 5. Validate configuration
        config_item = ChecklistItem(
            id="config",
            title="Configuration",
            description="Validate automation configuration",
            required=False,
        )
        config_item.completed = True  # Placeholder for future validation
        checklist.append(config_item)

        # Determine success
        success = all(item.completed for item in checklist if item.required)

        # Update state
        if success and not dry_run:
            state = self.get_state()
            state.phase = OnboardingPhase.TEST_MODE
            state.started_at = datetime.now(timezone.utc)
            state.test_mode_ends_at = datetime.now(timezone.utc) + timedelta(days=7)
            state.enablement_level = EnablementLevel.COMMENT_ONLY
            state.completed_items = [item.id for item in checklist if item.completed]
            self.save_state()

        return SetupResult(
            success=success,
            phase=OnboardingPhase.TEST_MODE
            if success
            else OnboardingPhase.SETUP_PENDING,
            checklist=checklist,
            errors=errors,
            warnings=warnings,
            dry_run=dry_run,
        )

    def is_test_mode(self) -> bool:
        """Check if in test mode (comment only)."""
        state = self.get_state()

        if state.phase == OnboardingPhase.TEST_MODE:
            if (
                state.test_mode_ends_at
                and datetime.now(timezone.utc) < state.test_mode_ends_at
            ):
                return True

        return state.enablement_level == EnablementLevel.COMMENT_ONLY

    def get_enablement_level(self) -> EnablementLevel:
        """Get current enablement level."""
        return self.get_state().enablement_level

    def can_perform_action(self, action: str) -> tuple[bool, str]:
        """
        Check if an action is allowed under current enablement.

        Args:
            action: Action to check (triage, review, autofix, label, close)

        Returns:
            Tuple of (allowed, reason)
        """
        level = self.get_enablement_level()

        if level == EnablementLevel.OFF:
            return False, "Automation is disabled"

        if level == EnablementLevel.COMMENT_ONLY:
            if action in ("comment",):
                return True, "Comment-only mode"
            return False, f"Test mode: would {action} but only commenting"

        if level == EnablementLevel.TRIAGE_ONLY:
            if action in ("comment", "triage", "label"):
                return True, "Triage enabled"
            return False, f"Triage mode: {action} not enabled yet"

        if level == EnablementLevel.REVIEW_ONLY:
            if action in ("comment", "triage", "label", "review"):
                return True, "Review enabled"
            return False, f"Review mode: {action} not enabled yet"

        if level == EnablementLevel.FULL:
            return True, "Full automation enabled"

        return False, "Unknown enablement level"

    def record_action(
        self,
        action_type: str,
        was_correct: bool,
    ) -> None:
        """
        Record an action outcome for accuracy tracking.

        Args:
            action_type: Type of action (triage, review)
            was_correct: Whether the action was correct
        """
        state = self.get_state()

        if action_type == "triage":
            state.triage_actions += 1
            # Rolling accuracy
            weight = 1 / state.triage_actions
            state.triage_accuracy = (
                state.triage_accuracy * (1 - weight)
                + (1.0 if was_correct else 0.0) * weight
            )
        elif action_type == "review":
            state.review_actions += 1
            weight = 1 / state.review_actions
            state.review_accuracy = (
                state.review_accuracy * (1 - weight)
                + (1.0 if was_correct else 0.0) * weight
            )

        self.save_state()

    def check_progression(self) -> tuple[bool, str | None]:
        """
        Check if ready to progress to next enablement level.

        Returns:
            Tuple of (should_upgrade, message)
        """
        state = self.get_state()

        if not state.auto_upgrade_enabled:
            return False, "Auto-upgrade disabled"

        now = datetime.now(timezone.utc)

        # Test mode -> Triage
        if state.phase == OnboardingPhase.TEST_MODE:
            if state.test_mode_ends_at and now >= state.test_mode_ends_at:
                return True, "Test period complete - ready for triage"
            days_left = (
                (state.test_mode_ends_at - now).days if state.test_mode_ends_at else 7
            )
            return False, f"Test mode: {days_left} days remaining"

        # Triage -> Review
        if state.phase == OnboardingPhase.TRIAGE_ENABLED:
            if (
                state.triage_actions >= self.MIN_ACTIONS_TO_UPGRADE
                and state.triage_accuracy >= self.REVIEW_THRESHOLD
            ):
                return (
                    True,
                    f"Triage accuracy {state.triage_accuracy:.0%} - ready for reviews",
                )
            return (
                False,
                f"Triage accuracy: {state.triage_accuracy:.0%} (need {self.REVIEW_THRESHOLD:.0%})",
            )

        # Review -> Full
        if state.phase == OnboardingPhase.REVIEW_ENABLED:
            if (
                state.review_actions >= self.MIN_ACTIONS_TO_UPGRADE
                and state.review_accuracy >= self.AUTOFIX_THRESHOLD
            ):
                return (
                    True,
                    f"Review accuracy {state.review_accuracy:.0%} - ready for auto-fix",
                )
            return (
                False,
                f"Review accuracy: {state.review_accuracy:.0%} (need {self.AUTOFIX_THRESHOLD:.0%})",
            )

        return False, None

    def upgrade_level(self) -> bool:
        """
        Upgrade to next enablement level if eligible.

        Returns:
            True if upgraded
        """
        state = self.get_state()

        should_upgrade, _ = self.check_progression()
        if not should_upgrade:
            return False

        # Perform upgrade
        if state.phase == OnboardingPhase.TEST_MODE:
            state.phase = OnboardingPhase.TRIAGE_ENABLED
            state.enablement_level = EnablementLevel.TRIAGE_ONLY
        elif state.phase == OnboardingPhase.TRIAGE_ENABLED:
            state.phase = OnboardingPhase.REVIEW_ENABLED
            state.enablement_level = EnablementLevel.REVIEW_ONLY
        elif state.phase == OnboardingPhase.REVIEW_ENABLED:
            state.phase = OnboardingPhase.FULL_ENABLED
            state.enablement_level = EnablementLevel.FULL
        else:
            return False

        self.save_state()
        return True

    def set_enablement_level(self, level: EnablementLevel) -> None:
        """
        Manually set enablement level.

        Args:
            level: Desired enablement level
        """
        state = self.get_state()
        state.enablement_level = level
        state.auto_upgrade_enabled = False  # Disable auto-upgrade on manual override

        # Update phase to match
        level_to_phase = {
            EnablementLevel.OFF: OnboardingPhase.NOT_STARTED,
            EnablementLevel.COMMENT_ONLY: OnboardingPhase.TEST_MODE,
            EnablementLevel.TRIAGE_ONLY: OnboardingPhase.TRIAGE_ENABLED,
            EnablementLevel.REVIEW_ONLY: OnboardingPhase.REVIEW_ENABLED,
            EnablementLevel.FULL: OnboardingPhase.FULL_ENABLED,
        }
        state.phase = level_to_phase.get(level, OnboardingPhase.NOT_STARTED)

        self.save_state()

    def get_checklist(self) -> list[ChecklistItem]:
        """Get the current onboarding checklist."""
        state = self.get_state()

        items = [
            ChecklistItem(
                id="setup",
                title="Initial Setup",
                description="Run setup wizard to configure automation",
                completed=state.phase != OnboardingPhase.NOT_STARTED,
            ),
            ChecklistItem(
                id="test_mode",
                title="Test Mode (Week 1)",
                description="AI comments what it would do, no actions taken",
                completed=state.phase
                not in {OnboardingPhase.NOT_STARTED, OnboardingPhase.SETUP_PENDING},
            ),
            ChecklistItem(
                id="triage",
                title="Triage Enabled (Week 2)",
                description="Automatic issue triage and labeling",
                completed=state.phase
                in {
                    OnboardingPhase.TRIAGE_ENABLED,
                    OnboardingPhase.REVIEW_ENABLED,
                    OnboardingPhase.FULL_ENABLED,
                },
            ),
            ChecklistItem(
                id="review",
                title="PR Review Enabled (Week 3)",
                description="Automatic PR code reviews",
                completed=state.phase
                in {
                    OnboardingPhase.REVIEW_ENABLED,
                    OnboardingPhase.FULL_ENABLED,
                },
            ),
            ChecklistItem(
                id="autofix",
                title="Auto-Fix Enabled (Week 4+)",
                description="Full autonomous issue fixing",
                completed=state.phase == OnboardingPhase.FULL_ENABLED,
                required=False,
            ),
        ]

        return items

    def get_status_summary(self) -> dict[str, Any]:
        """Get summary of onboarding status."""
        state = self.get_state()
        checklist = self.get_checklist()

        should_upgrade, upgrade_message = self.check_progression()

        return {
            "repo": self.repo,
            "phase": state.phase.value,
            "enablement_level": state.enablement_level.value,
            "started_at": state.started_at.isoformat() if state.started_at else None,
            "test_mode_ends_at": state.test_mode_ends_at.isoformat()
            if state.test_mode_ends_at
            else None,
            "is_test_mode": self.is_test_mode(),
            "checklist": [item.to_dict() for item in checklist],
            "accuracy": {
                "triage": state.triage_accuracy,
                "triage_actions": state.triage_actions,
                "review": state.review_accuracy,
                "review_actions": state.review_actions,
            },
            "progression": {
                "ready_to_upgrade": should_upgrade,
                "message": upgrade_message,
                "auto_upgrade_enabled": state.auto_upgrade_enabled,
            },
        }

"""
Linear Integration Manager
==========================

Manages synchronization between Auto-Build subtasks and Linear issues.
Provides real-time visibility into build progress through Linear.

The integration is OPTIONAL - if LINEAR_API_KEY is not set, all operations
gracefully no-op and the build continues with local tracking only.

Key Features:
- Subtask → Issue mapping (sync implementation_plan.json to Linear)
- Session attempt recording (comments on issues)
- Stuck subtask escalation (move to Blocked, add detailed comments)
- Progress tracking via META issue
"""

import json
import os
from datetime import datetime
from pathlib import Path

from .config import (
    LABELS,
    STATUS_BLOCKED,
    LinearConfig,
    LinearProjectState,
    format_session_comment,
    format_stuck_subtask_comment,
    format_subtask_description,
    get_linear_status,
    get_priority_for_phase,
)


class LinearManager:
    """
    Manages Linear integration for an Auto-Build spec.

    This class provides a high-level interface for:
    - Creating/syncing issues from implementation_plan.json
    - Recording session attempts and results
    - Escalating stuck subtasks
    - Tracking overall progress

    All operations are idempotent and gracefully handle Linear being unavailable.
    """

    def __init__(self, spec_dir: Path, project_dir: Path):
        """
        Initialize Linear manager.

        Args:
            spec_dir: Spec directory (contains implementation_plan.json)
            project_dir: Project root directory
        """
        self.spec_dir = spec_dir
        self.project_dir = project_dir
        self.config = LinearConfig.from_env()
        self.state: LinearProjectState | None = None
        self._mcp_available = False

        # Load existing state if available
        self.state = LinearProjectState.load(spec_dir)

        # Check if Linear MCP tools are available
        self._check_mcp_availability()

    def _check_mcp_availability(self) -> None:
        """Check if Linear MCP tools are available in the environment."""
        # In agent context, MCP tools are available via claude-code
        # We'll assume they're available if LINEAR_API_KEY is set
        self._mcp_available = self.config.is_valid()

    @property
    def is_enabled(self) -> bool:
        """Check if Linear integration is enabled and available."""
        return self.config.is_valid() and self._mcp_available

    @property
    def is_initialized(self) -> bool:
        """Check if Linear project has been initialized for this spec."""
        return self.state is not None and self.state.initialized

    def get_issue_id(self, subtask_id: str) -> str | None:
        """
        Get the Linear issue ID for a subtask.

        Args:
            subtask_id: Subtask ID from implementation_plan.json

        Returns:
            Linear issue ID or None if not mapped
        """
        if not self.state:
            return None
        return self.state.issue_mapping.get(subtask_id)

    def set_issue_id(self, subtask_id: str, issue_id: str) -> None:
        """
        Store the mapping between a subtask and its Linear issue.

        Args:
            subtask_id: Subtask ID from implementation_plan.json
            issue_id: Linear issue ID
        """
        if not self.state:
            self.state = LinearProjectState()

        self.state.issue_mapping[subtask_id] = issue_id
        self.state.save(self.spec_dir)

    def initialize_project(self, team_id: str, project_name: str) -> bool:
        """
        Initialize a Linear project for this spec.

        This should be called by the agent during the planner session
        to set up the Linear project and create initial issues.

        Args:
            team_id: Linear team ID
            project_name: Name for the Linear project

        Returns:
            True if successful
        """
        if not self.is_enabled:
            print("Linear integration not enabled (LINEAR_API_KEY not set)")
            return False

        # Create initial state
        self.state = LinearProjectState(
            initialized=True,
            team_id=team_id,
            project_name=project_name,
            created_at=datetime.now().isoformat(),
        )

        self.state.save(self.spec_dir)
        return True

    def update_project_id(self, project_id: str) -> None:
        """Update the Linear project ID after creation."""
        if self.state:
            self.state.project_id = project_id
            self.state.save(self.spec_dir)

    def update_meta_issue_id(self, meta_issue_id: str) -> None:
        """Update the META issue ID after creation."""
        if self.state:
            self.state.meta_issue_id = meta_issue_id
            self.state.save(self.spec_dir)

    def load_implementation_plan(self) -> dict | None:
        """Load the implementation plan from spec directory."""
        plan_file = self.spec_dir / "implementation_plan.json"
        if not plan_file.exists():
            return None

        try:
            with open(plan_file, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return None

    def get_subtasks_for_sync(self) -> list[dict]:
        """
        Get all subtasks that need Linear issues.

        Returns:
            List of subtask dicts with phase context
        """
        plan = self.load_implementation_plan()
        if not plan:
            return []

        subtasks = []
        phases = plan.get("phases", [])
        total_phases = len(phases)

        for phase in phases:
            phase_num = phase.get("phase", 1)
            phase_name = phase.get("name", f"Phase {phase_num}")

            for subtask in phase.get("subtasks", []):
                subtasks.append(
                    {
                        **subtask,
                        "phase_num": phase_num,
                        "phase_name": phase_name,
                        "total_phases": total_phases,
                        "phase_depends_on": phase.get("depends_on", []),
                    }
                )

        return subtasks

    def generate_issue_data(self, subtask: dict) -> dict:
        """
        Generate Linear issue data from a subtask.

        Args:
            subtask: Subtask dict with phase context

        Returns:
            Dict suitable for Linear create_issue
        """
        phase = {
            "name": subtask.get("phase_name"),
            "id": subtask.get("phase_num"),
        }

        # Determine priority based on phase position
        priority = get_priority_for_phase(
            subtask.get("phase_num", 1), subtask.get("total_phases", 1)
        )

        # Build labels list
        labels = [LABELS["auto_build"]]
        if subtask.get("service"):
            labels.append(f"{LABELS['service']}-{subtask['service']}")
        if subtask.get("phase_num"):
            labels.append(f"{LABELS['phase']}-{subtask['phase_num']}")

        return {
            "title": f"[{subtask.get('id', 'subtask')}] {subtask.get('description', 'Implement subtask')[:100]}",
            "description": format_subtask_description(subtask, phase),
            "priority": priority,
            "labels": labels,
            "status": get_linear_status(subtask.get("status", "pending")),
        }

    def record_session_result(
        self,
        subtask_id: str,
        session_num: int,
        success: bool,
        approach: str = "",
        error: str = "",
        git_commit: str = "",
    ) -> str:
        """
        Record a session result as a Linear comment.

        This is called by post_session_processing in agent.py.

        Args:
            subtask_id: Subtask being worked on
            session_num: Session number
            success: Whether the session succeeded
            approach: What was attempted
            error: Error message if failed
            git_commit: Git commit hash if any

        Returns:
            Formatted comment body (for logging even if Linear unavailable)
        """
        comment = format_session_comment(
            session_num=session_num,
            subtask_id=subtask_id,
            success=success,
            approach=approach,
            error=error,
            git_commit=git_commit,
        )

        # Note: Actual Linear API call will be done by the agent
        # This method prepares the data and returns it
        return comment

    def prepare_status_update(self, subtask_id: str, new_status: str) -> dict:
        """
        Prepare data for a Linear issue status update.

        Args:
            subtask_id: Subtask ID
            new_status: New subtask status (pending, in_progress, completed, etc.)

        Returns:
            Dict with issue_id and linear_status for the update
        """
        issue_id = self.get_issue_id(subtask_id)
        linear_status = get_linear_status(new_status)

        return {
            "issue_id": issue_id,
            "status": linear_status,
            "subtask_id": subtask_id,
        }

    def prepare_stuck_escalation(
        self,
        subtask_id: str,
        attempt_count: int,
        attempts: list[dict],
        reason: str = "",
    ) -> dict:
        """
        Prepare data for escalating a stuck subtask.

        This creates the comment body and status update data.

        Args:
            subtask_id: Stuck subtask ID
            attempt_count: Number of attempts
            attempts: List of attempt records
            reason: Why it's stuck

        Returns:
            Dict with issue_id, comment, labels for escalation
        """
        issue_id = self.get_issue_id(subtask_id)
        comment = format_stuck_subtask_comment(
            subtask_id=subtask_id,
            attempt_count=attempt_count,
            attempts=attempts,
            reason=reason,
        )

        return {
            "issue_id": issue_id,
            "subtask_id": subtask_id,
            "status": STATUS_BLOCKED,
            "comment": comment,
            "labels": [LABELS["stuck"], LABELS["needs_review"]],
        }

    def get_progress_summary(self) -> dict:
        """
        Get a summary of Linear integration progress.

        Returns:
            Dict with progress statistics
        """
        plan = self.load_implementation_plan()
        if not plan:
            return {
                "enabled": self.is_enabled,
                "initialized": False,
                "total_subtasks": 0,
                "mapped_subtasks": 0,
            }

        subtasks = self.get_subtasks_for_sync()
        mapped = sum(1 for s in subtasks if self.get_issue_id(s.get("id", "")))

        return {
            "enabled": self.is_enabled,
            "initialized": self.is_initialized,
            "team_id": self.state.team_id if self.state else None,
            "project_id": self.state.project_id if self.state else None,
            "project_name": self.state.project_name if self.state else None,
            "meta_issue_id": self.state.meta_issue_id if self.state else None,
            "total_subtasks": len(subtasks),
            "mapped_subtasks": mapped,
        }

    def get_linear_context_for_prompt(self) -> str:
        """
        Generate Linear context section for agent prompts.

        This is included in the subtask prompt to give the agent
        awareness of Linear integration status.

        Returns:
            Markdown-formatted context string
        """
        if not self.is_enabled:
            return ""

        summary = self.get_progress_summary()

        if not summary["initialized"]:
            return """
## Linear Integration

Linear integration is enabled but not yet initialized.
During the planner session, create a Linear project and sync issues.

Available Linear MCP tools:
- `mcp__linear-server__list_teams` - List available teams
- `mcp__linear-server__create_project` - Create a new project
- `mcp__linear-server__create_issue` - Create issues for subtasks
- `mcp__linear-server__update_issue` - Update issue status
- `mcp__linear-server__create_comment` - Add session comments
"""

        lines = [
            "## Linear Integration",
            "",
            f"**Project:** {summary['project_name']}",
            f"**Issues:** {summary['mapped_subtasks']}/{summary['total_subtasks']} subtasks mapped",
            "",
            "When working on a subtask:",
            "1. Update issue status to 'In Progress' at start",
            "2. Add comments with progress/blockers",
            "3. Update status to 'Done' when subtask completes",
            "4. If stuck, status will be set to 'Blocked' automatically",
        ]

        return "\n".join(lines)

    def save_state(self) -> None:
        """Save the current state to disk."""
        if self.state:
            self.state.save(self.spec_dir)


# Utility functions for integration with other modules


def get_linear_manager(spec_dir: Path, project_dir: Path) -> LinearManager:
    """
    Get a LinearManager instance for the given spec.

    This is the main entry point for other modules.

    Args:
        spec_dir: Spec directory
        project_dir: Project root directory

    Returns:
        LinearManager instance
    """
    return LinearManager(spec_dir, project_dir)


def is_linear_enabled() -> bool:
    """Quick check if Linear integration is available."""
    return bool(os.environ.get("LINEAR_API_KEY"))


def prepare_planner_linear_instructions(spec_dir: Path) -> str:
    """
    Generate Linear setup instructions for the planner agent.

    This is included in the planner prompt when Linear is enabled.

    Args:
        spec_dir: Spec directory

    Returns:
        Markdown instructions for Linear setup
    """
    if not is_linear_enabled():
        return ""

    return """
## Linear Integration Setup

Linear integration is ENABLED. After creating the implementation plan:

### Step 1: Find the Team
```
Use mcp__linear-server__list_teams to find your team ID
```

### Step 2: Create the Project
```
Use mcp__linear-server__create_project with:
- team: Your team ID
- name: The feature/spec name
- description: Brief summary from spec.md
```
Save the project ID to .linear_project.json

### Step 3: Create Issues for Each Subtask
For each subtask in implementation_plan.json:
```
Use mcp__linear-server__create_issue with:
- team: Your team ID
- project: The project ID
- title: "[subtask-id] Description"
- description: Formatted subtask details
- priority: Based on phase (1=urgent for early phases, 4=low for polish)
- labels: ["auto-claude", "phase-N", "service-NAME"]
```
Save the subtask_id -> issue_id mapping to .linear_project.json

### Step 4: Create META Issue
```
Use mcp__linear-server__create_issue with:
- title: "[META] Build Progress Tracker"
- description: "Session summaries and overall progress tracking"
```
This issue receives session summary comments.

### Important Notes
- Update .linear_project.json after each Linear operation
- The JSON structure should include:
  - initialized: true
  - team_id: "..."
  - project_id: "..."
  - meta_issue_id: "..."
  - issue_mapping: { "subtask-1-1": "LIN-123", ... }
"""


def prepare_coder_linear_instructions(
    spec_dir: Path,
    subtask_id: str,
) -> str:
    """
    Generate Linear instructions for the coding agent.

    Args:
        spec_dir: Spec directory
        subtask_id: Current subtask being worked on

    Returns:
        Markdown instructions for Linear updates
    """
    if not is_linear_enabled():
        return ""

    manager = LinearManager(spec_dir, spec_dir.parent.parent)  # Approximate project_dir

    if not manager.is_initialized:
        return ""

    issue_id = manager.get_issue_id(subtask_id)
    if not issue_id:
        return ""

    return f"""
## Linear Updates

This subtask is linked to Linear issue: `{issue_id}`

### At Session Start
Update the issue status to "In Progress":
```
mcp__linear-server__update_issue(id="{issue_id}", state="In Progress")
```

### During Work
Add comments for significant progress or blockers:
```
mcp__linear-server__create_comment(issueId="{issue_id}", body="...")
```

### On Completion
Update status to "Done":
```
mcp__linear-server__update_issue(id="{issue_id}", state="Done")
```

### Session Summary
At session end, add a comment to the META issue with:
- What was accomplished
- Any blockers or issues found
- Recommendations for next session
"""

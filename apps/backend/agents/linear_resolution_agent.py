"""
Linear Resolution Status Agent Module
====================================

AI-powered agent for detecting already-resolved Linear tickets.

This agent analyzes tickets to identify issues that have already been fixed
or resolved in recent commits, releases, or code changes.
"""

import json
import logging
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .linear_utils import fetch_linear_ticket, format_labels
from .session import run_agent_session

if TYPE_CHECKING:
    from core.client import ClaudeSDKClient

logger = logging.getLogger(__name__)


class LinearResolutionAgent:
    """
    AI agent for detecting already-resolved Linear tickets.

    Uses Claude to analyze tickets against recent code changes to identify
    issues that have already been fixed.
    """

    # AI Prompt for resolution analysis
    RESOLUTION_PROMPT = """You are analyzing Linear tickets to determine if they have already been fixed or resolved.

Given a ticket and recent code changes (commits, releases), identify if the issue described in the ticket has been addressed.

For each ticket, analyze:
1. **Issue Understanding**: What problem does the ticket describe?
2. **Code Changes**: Do any commits address this specific problem?
3. **Release Notes**: Do any releases mention fixes for this issue?
4. **Resolution Status**: Has the issue been fixed, potentially fixed, or is still open?

Classify each ticket as:
- **ALREADY_FIXED**: The issue has been definitively resolved in a recent commit/release.
- **POTENTIALLY_FIXED**: The issue may have been fixed, but requires verification.
- **STILL_OPEN**: The issue has not been addressed and remains open.

Return your analysis as JSON:

```json
{{
  "tickets": [
    {{
      "ticket_id": "{ticket_id}",
      "is_already_fixed": true|false,
      "confidence": "high|medium|low",
      "evidence": [
        {{
          "type": "commit|release|code_change",
          "description": "Brief description of what was fixed",
          "url": "Link to commit/release (if available)",
          "date": "ISO date string"
        }}
      ],
      "reasoning": "Explanation of why this ticket is marked as fixed/potentially fixed/still open",
      "recommended_action": "close|keep_open|investigate",
      "suggested_close_reason": "Reason to use when closing the ticket (if applicable)"
    }}
  ]
}}
```

**Tickets to Analyze:**
{tickets_str}

**Recent Code Changes:**
{recent_changes_str}

Analyze each ticket and return the JSON result.
"""

    def __init__(self, model: str = "claude-3-5-sonnet-20241022"):
        """
        Initialize the Linear Resolution Agent.

        Args:
            model: Claude model to use for analysis
        """
        self.model = model

    async def check_resolution_status(
        self,
        client: "ClaudeSDKClient",
        tickets: list[dict[str, Any]],
        recent_commits: list[dict[str, Any]] | None = None,
        recent_releases: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Analyze tickets to determine if they have already been resolved.

        Args:
            client: Claude SDK client instance
            tickets: List of tickets to analyze
            recent_commits: Recent commit messages/data
            recent_releases: Recent release information

        Returns:
            Dict with resolution analysis results:
            {
                "tickets": [
                    {
                        "ticket_id": str,
                        "is_already_fixed": bool,
                        "confidence": "high|medium|low",
                        "evidence": [...],
                        "reasoning": str,
                        "recommended_action": "close|keep_open|investigate"
                    }
                ]
            }
        """
        # Build tickets string for prompt
        tickets_str = self._format_tickets_for_prompt(tickets)

        # Build recent changes string
        recent_changes_str = self._format_recent_changes(
            recent_commits or [], recent_releases or []
        )

        # Build the prompt
        prompt = self.RESOLUTION_PROMPT.format(
            tickets_str=tickets_str, recent_changes_str=recent_changes_str
        )

        try:
            # Run the analysis
            status, response = await run_agent_session(
                client,
                prompt,
                Path.cwd(),  # Use current working directory for logging
            )

            if status != "success":
                logger.error(f"Resolution analysis failed: {response}")
                return {
                    "tickets": [],
                    "error": str(response),
                }

            # Parse the JSON response
            result = self._parse_resolution_response(response)

            return result

        except Exception as e:
            logger.error(f"Error during resolution analysis: {e}")
            return {
                "tickets": [],
                "error": str(e),
            }

    def _format_tickets_for_prompt(self, tickets: list[dict[str, Any]]) -> str:
        """Format tickets for the AI prompt."""
        if not tickets:
            return "No tickets provided."

        parts = []
        for i, ticket in enumerate(tickets, 1):
            part = f"""
**Ticket {i}:**
- ID: {ticket.get("identifier", ticket.get("id", f"ticket-{i}"))}
- Title: {ticket.get("title", "No title")}
- Description: {ticket.get("description", "No description")[:500]}...
- State: {ticket.get("state", {}).get("name", "Unknown")}
- Labels: {format_labels(ticket.get("labels", {}))}
"""
            parts.append(part)

        return "\n".join(parts)

    def _format_recent_changes(
        self, commits: list[dict[str, Any]], releases: list[dict[str, Any]]
    ) -> str:
        """Format recent commits and releases for the AI prompt."""
        parts = []

        if commits:
            parts.append("**Recent Commits:**")
            for commit in commits[:20]:  # Limit to 20 commits
                parts.append(
                    f"- {commit.get('message', 'No message')} "
                    f"({commit.get('date', 'unknown date')})"
                )

        if releases:
            parts.append("\n**Recent Releases:**")
            for release in releases[:10]:  # Limit to 10 releases
                parts.append(
                    f"- {release.get('name', release.get('tag_name', 'unknown'))}: "
                    f"{release.get('description', 'No description')[:100]}..."
                )

        if not parts:
            return "No recent changes available."

        return "\n".join(parts)

    def _parse_resolution_response(self, response: str) -> dict[str, Any]:
        """
        Parse the AI response to extract resolution results.

        Args:
            response: Raw response from Claude

        Returns:
            Parsed resolution results dict
        """
        # Try to extract JSON from markdown code block
        json_match = re.search(r"```json\s*(\{.*?\})\s*```", response, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # Try to parse raw JSON
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # Fallback: try to find JSON-like structure
        json_match = re.search(r"\{.*\"tickets\".*\}", response, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

        # Return error if parsing fails
        logger.error(f"Failed to parse resolution response: {response[:200]}...")
        return {
            "tickets": [],
            "error": "Failed to parse AI response",
            "raw_response": response[:500],
        }


async def check_tickets_resolution(
    project_dir: str,
    ticket_ids: list[str],
    lookback_days: int = 90,
    model: str | None = None,
) -> dict[str, Any]:
    """
    Check if tickets have already been resolved.

    Args:
        project_dir: Path to the project directory
        ticket_ids: List of ticket IDs to check
        lookback_days: How many days back to look for fixes
        model: Claude model to use (default from settings)

    Returns:
        Resolution check results
    """
    from core.client import create_client

    # Get API key
    api_key = os.environ.get("LINEAR_API_KEY")
    if not api_key:
        return {
            "tickets": [],
            "error": "LINEAR_API_KEY not found in environment",
        }

    # Fetch tickets
    tickets = []
    for tid in ticket_ids:
        ticket = await fetch_linear_ticket(tid, api_key)
        if ticket:
            tickets.append(ticket)

    if not tickets:
        return {
            "tickets": [],
            "error": "No tickets found",
        }

    # Get recent commits (placeholder - would need git integration)
    recent_commits = await _get_recent_commits(project_dir, lookback_days)

    # Get recent releases (placeholder - would need GitHub/GitLab API integration)
    recent_releases = await _get_recent_releases(project_dir, lookback_days)

    # Create client and run analysis
    client = create_client(
        project_dir=project_dir,
        spec_dir=None,
        model=model or "claude-3-5-sonnet-20241022",
        agent_type="linear_resolution",
    )

    agent = LinearResolutionAgent(model=model or "claude-3-5-sonnet-20241022")

    async with client:
        result = await agent.check_resolution_status(
            client, tickets, recent_commits, recent_releases
        )

    return result


async def _get_recent_commits(
    project_dir: str, lookback_days: int
) -> list[dict[str, Any]]:
    """
    Get recent commits from the project.

    This is a placeholder - would need actual git integration.
    """
    # TODO: Implement git integration to fetch actual commits
    return [
        {
            "message": "Fix: Updated authentication flow",
            "date": datetime.now().isoformat(),
            "url": "#",
        },
        {
            "message": "Fix: Resolved crash on startup",
            "date": (datetime.now() - timedelta(days=2)).isoformat(),
            "url": "#",
        },
    ]


async def _get_recent_releases(
    project_dir: str, lookback_days: int
) -> list[dict[str, Any]]:
    """
    Get recent releases from the project.

    This is a placeholder - would need actual GitHub/GitLab API integration.
    """
    # TODO: Implement GitHub/GitLab API integration to fetch actual releases
    return [
        {
            "name": "v1.2.3",
            "tag_name": "v1.2.3",
            "description": "Bug fixes and improvements",
            "date": datetime.now().isoformat(),
            "url": "#",
        },
    ]

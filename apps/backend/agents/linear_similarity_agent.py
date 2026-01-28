"""
Linear Similarity Analysis Agent Module
=======================================

AI-powered agent for detecting similar and duplicate Linear tickets.

This agent analyzes tickets to:
1. Find potential duplicate tickets (same issue reported differently)
2. Identify related tickets (similar themes or components)
3. Recommend actions (merge, link, or keep separate)
"""

import logging
import os
from typing import TYPE_CHECKING, Any

import requests

from .session import run_agent_session

if TYPE_CHECKING:
    from core.client import ClaudeSDKClient

logger = logging.getLogger(__name__)


class LinearSimilarityAgent:
    """
    AI agent for detecting similar Linear tickets.

    Uses Claude to analyze ticket content and find duplicates/related issues.
    """

    # AI Prompt for similarity analysis
    SIMILARITY_PROMPT = """You are analyzing Linear tickets to find similar and duplicate issues.

Given a target ticket and a list of candidate tickets, identify which candidates are similar to the target.

For each candidate, analyze:
1. **Title similarity**: Do they describe the same problem?
2. **Description overlap**: Are the core issues the same?
3. **Context match**: Same component, feature, or area?
4. **Duplicate probability**: Is one a duplicate of the other?

Classify each candidate as:
- **DUPLICATE**: The same issue reported differently. One should be closed as a duplicate.
- **RELATED**: Similar theme or component, but distinct issues. May be worth linking.
- **DISTINCT**: Different issues. No significant overlap.

Return your analysis as JSON:

```json
{{
  "target_ticket_id": "{target_id}",
  "similar_tickets": [
    {{
      "ticket_id": "{candidate_id}",
      "similarity_score": 0.0-1.0,
      "similarity_reasoning": "Brief explanation of why they're similar",
      "confidence": "high|medium|low",
      "recommended_action": "duplicate|related|distinct",
      "shared_keywords": ["keyword1", "keyword2"],
      "differences": "brief explanation of differences (if any)"
    }}
  ]
}}
```

**Similarity Score Guide:**
- 0.9-1.0: Clear duplicate (same issue, same symptoms)
- 0.7-0.9: Likely duplicate or very closely related
- 0.5-0.7: Related issues worth linking
- 0.3-0.5: Some overlap but distinct issues
- 0.0-0.3: Distinct issues

**Target Ticket:**
```
ID: {target_identifier}
Title: {target_title}
Description: {target_description}
Labels: {target_labels}
State: {target_state}
```

**Candidate Tickets:**
{candidate_tickets_str}

Analyze each candidate and return the JSON result.
"""

    def __init__(self, model: str = "claude-3-5-sonnet-20241022"):
        """
        Initialize the Linear Similarity Agent.

        Args:
            model: Claude model to use for analysis
        """
        self.model = model
        self.api_endpoint = "https://api.linear.app/graphql"

    async def find_similar_tickets(
        self,
        client: "ClaudeSDKClient",
        target_ticket: dict[str, Any],
        candidate_tickets: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Analyze target ticket against candidates to find similar issues.

        Args:
            client: Claude SDK client instance
            target_ticket: The ticket to analyze against
            candidate_tickets: List of tickets to compare with target

        Returns:
            Dict with similarity analysis results:
            {
                "target_ticket_id": str,
                "similar_tickets": [
                    {
                        "ticket_id": str,
                        "similarity_score": float,
                        "similarity_reasoning": str,
                        "confidence": "high|medium|low",
                        "recommended_action": "duplicate|related|distinct"
                    }
                ]
            }
        """
        # Build candidate tickets string for prompt
        candidate_tickets_str = self._format_candidates_for_prompt(candidate_tickets)

        # Build the prompt
        prompt = self.SIMILARITY_PROMPT.format(
            target_id=target_ticket.get("id", ""),
            target_identifier=target_ticket.get("identifier", ""),
            target_title=target_ticket.get("title", ""),
            target_description=target_ticket.get("description", "No description"),
            target_labels=self._format_labels(target_ticket.get("labels", {})),
            target_state=target_ticket.get("state", {}).get("name", "Unknown"),
            candidate_tickets_str=candidate_tickets_str,
        )

        try:
            # Run the analysis
            status, response = await run_agent_session(
                client,
                prompt,
                None,  # No spec_dir needed
                max_iterations=1,
            )

            if status != "success":
                logger.error(f"Similarity analysis failed: {response}")
                return {
                    "target_ticket_id": target_ticket.get("id"),
                    "similar_tickets": [],
                    "error": str(response),
                }

            # Parse the JSON response
            result = self._parse_similarity_response(response)

            return result

        except Exception as e:
            logger.error(f"Error during similarity analysis: {e}")
            return {
                "target_ticket_id": target_ticket.get("id"),
                "similar_tickets": [],
                "error": str(e),
            }

    def _format_candidates_for_prompt(self, candidates: list[dict[str, Any]]) -> str:
        """Format candidate tickets for the AI prompt."""
        if not candidates:
            return "No candidates provided."

        parts = []
        for i, ticket in enumerate(candidates, 1):
            part = f"""
```
ID: {ticket.get("identifier", ticket.get("id", f"candidate-{i}"))}
Title: {ticket.get("title", "No title")}
Description: {ticket.get("description", "No description")[:500]}...
Labels: {self._format_labels(ticket.get("labels", {}))}
State: {ticket.get("state", {}).get("name", "Unknown")}
```
"""
            parts.append(part)

        return "\n".join(parts)

    def _format_labels(self, labels_obj: dict[str, Any]) -> str:
        """Format labels object to string."""
        if not labels_obj or "nodes" not in labels_obj:
            return "None"

        labels = [node.get("name", "") for node in labels_obj.get("nodes", [])]
        return ", ".join(labels) if labels else "None"

    def _parse_similarity_response(self, response: str) -> dict[str, Any]:
        """
        Parse the AI response to extract similarity results.

        Args:
            response: Raw response from Claude

        Returns:
            Parsed similarity results dict
        """
        import json
        import re

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
        json_match = re.search(r"\{.*\"similar_tickets\".*\}", response, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

        # Return error if parsing fails
        logger.error(f"Failed to parse similarity response: {response[:200]}...")
        return {
            "target_ticket_id": "unknown",
            "similar_tickets": [],
            "error": "Failed to parse AI response",
            "raw_response": response[:500],
        }


async def analyze_ticket_similarity(
    project_dir: str,
    target_ticket_id: str,
    candidate_ticket_ids: list[str] | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """
    Analyze similarity between a target ticket and candidate tickets.

    Args:
        project_dir: Path to the project directory
        target_ticket_id: ID of the target ticket to analyze
        candidate_ticket_ids: List of candidate ticket IDs (if None, fetches from team)
        model: Claude model to use (default from settings)

    Returns:
        Similarity analysis results
    """
    from core.client import create_client

    # Get API key
    api_key = os.environ.get("LINEAR_API_KEY")
    if not api_key:
        return {
            "target_ticket_id": target_ticket_id,
            "similar_tickets": [],
            "error": "LINEAR_API_KEY not found in environment",
        }

    # Fetch target ticket
    target_ticket = await _fetch_linear_ticket(target_ticket_id, api_key)
    if not target_ticket:
        return {
            "target_ticket_id": target_ticket_id,
            "similar_tickets": [],
            "error": f"Failed to fetch target ticket {target_ticket_id}",
        }

    # Fetch candidates
    if candidate_ticket_ids is None:
        # Fetch all tickets from the same team
        team_id = target_ticket.get("team", {}).get("id")
        candidate_tickets = await _fetch_team_tickets(team_id, api_key)
        # Exclude target ticket from candidates
        candidate_tickets = [
            t for t in candidate_tickets if t.get("id") != target_ticket.get("id")
        ]
    else:
        candidate_tickets = []
        for cid in candidate_ticket_ids:
            ticket = await _fetch_linear_ticket(cid, api_key)
            if ticket:
                candidate_tickets.append(ticket)

    if not candidate_tickets:
        return {
            "target_ticket_id": target_ticket_id,
            "similar_tickets": [],
            "error": "No candidate tickets found",
        }

    # Create client and run analysis
    client = create_client(
        project_dir=project_dir,
        spec_dir=None,
        model=model or "claude-3-5-sonnet-20241022",
        agent_type="linear_similarity",
    )

    agent = LinearSimilarityAgent(model=model or "claude-3-5-sonnet-20241022")

    async with client:
        result = await agent.find_similar_tickets(
            client, target_ticket, candidate_tickets
        )

    return result


async def _fetch_linear_ticket(ticket_id: str, api_key: str) -> dict[str, Any] | None:
    """Fetch a single Linear ticket by ID."""
    query = """
    query($ticketId: String!) {
        issue(id: $ticketId) {
            id
            identifier
            title
            description
            state { id name type }
            priority
            labels { nodes { id name color } }
            team { id name }
            project { id name }
            url
        }
    }
    """

    try:
        response = requests.post(
            "https://api.linear.app/graphql",
            json={"query": query, "variables": {"ticketId": ticket_id}},
            headers={"Authorization": api_key},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("data", {}).get("issue")
    except Exception as e:
        logger.error(f"Failed to fetch ticket {ticket_id}: {e}")
        return None


async def _fetch_team_tickets(team_id: str, api_key: str) -> list[dict[str, Any]]:
    """Fetch all tickets from a team."""
    query = """
    query($teamId: String!) {
        team(id: $teamId) {
            issues(first: 100) {
                nodes {
                    id
                    identifier
                    title
                    description
                    state { id name type }
                    priority
                    labels { nodes { id name color } }
                    url
                }
            }
        }
    }
    """

    try:
        response = requests.post(
            "https://api.linear.app/graphql",
            json={"query": query, "variables": {"teamId": team_id}},
            headers={"Authorization": api_key},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("data", {}).get("team", {}).get("issues", {}).get("nodes", [])
    except Exception as e:
        logger.error(f"Failed to fetch team tickets: {e}")
        return []

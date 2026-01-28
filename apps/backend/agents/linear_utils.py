"""
Linear Utility Functions Module
================================

Shared utility functions for Linear integration agents.
"""

import asyncio
import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)


def format_labels(labels_obj: dict[str, Any]) -> str:
    """
    Format Linear labels object to readable string.

    Args:
        labels_obj: Linear API labels object with 'nodes' array

    Returns:
        Comma-separated label names or "None" if no labels
    """
    if not labels_obj or "nodes" not in labels_obj:
        return "None"

    labels = [node.get("name", "") for node in labels_obj.get("nodes", [])]
    return ", ".join(labels) if labels else "None"


async def fetch_linear_ticket(ticket_id: str, api_key: str) -> dict[str, Any] | None:
    """
    Fetch a single Linear ticket by ID from the API.

    Args:
        ticket_id: Linear ticket identifier (e.g., "LIN-123" or "123")
        api_key: Linear API key

    Returns:
        Ticket data dict or None if fetch fails
    """
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

    # OAuth tokens should use Bearer prefix
    authorization = api_key if api_key.startswith("lin_api_") else f"Bearer {api_key}"

    def _make_request() -> dict[str, Any] | None:
        """Synchronous request function to run in thread pool."""
        try:
            response = requests.post(
                "https://api.linear.app/graphql",
                json={"query": query, "variables": {"ticketId": ticket_id}},
                headers={"Authorization": authorization},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", {}).get("issue")
        except Exception as e:
            logger.error(f"Failed to fetch ticket {ticket_id}: {e}")
            return None

    # Run blocking request in thread pool to avoid blocking event loop
    return await asyncio.to_thread(_make_request)

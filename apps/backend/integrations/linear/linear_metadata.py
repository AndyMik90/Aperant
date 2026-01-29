"""
Linear Workspace Metadata Fetcher
==================================

Fetches and caches workspace metadata from Linear (labels, users, teams, projects, states).

This metadata is used to:
- Provide accurate label recommendations (only suggest labels that exist)
- Suggest valid assignees from team members
- Recommend available projects
- Map priorities correctly
"""

import logging
import os
from datetime import timedelta
from pathlib import Path

import diskcache
import requests

from .linear_utils import get_linear_authorization_header

logger = logging.getLogger(__name__)

# Cache directory and TTL
CACHE_DIR = Path.home() / ".auto-claude" / "cache" / "linear"
CACHE_TTL = timedelta(hours=1)  # Cache metadata for 1 hour


def get_metadata_cache() -> diskcache.Cache:
    """Get or create the metadata cache."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return diskcache.Cache(str(CACHE_DIR))


def fetch_linear_workspace_metadata(api_key: str) -> dict:
    """
    Fetch all workspace metadata from Linear.

    Args:
        api_key: Linear API key

    Returns:
        Dict containing:
        - labels: List of {id, name, color}
        - users: List of {id, name, email, avatarUrl}
        - teams: List of {id, name, members}
        - projects: List of {id, name, state}
        - workflowStates: List of {id, name, type, color}
        - priorities: List of {label, value, description}

    Raises:
        requests.RequestException: If API call fails
    """
    cache = get_metadata_cache()
    cache_key = f"workspace_metadata"

    # Check cache first
    cached_data = cache.get(cache_key)
    if cached_data:
        logger.debug("[LINEAR_METADATA] Using cached workspace metadata")
        return cached_data

    logger.info("[LINEAR_METADATA] Fetching workspace metadata from Linear API")

    # GraphQL query to fetch workspace metadata
    query = """
    query WorkspaceMetadata {
        workspace {
            id
            name
        }
        teams {
            nodes {
                id
                name
                key
                members {
                    nodes {
                        id
                        name
                        email
                        avatarUrl
                        displayName
                    }
                }
            }
        }
        projects {
            nodes {
                id
                name
                state
                url
                teams {
                    nodes {
                        id
                        name
                    }
                }
            }
        }
        labels {
            nodes {
                id
                name
                color
                description
            }
        }
        workflowStates {
            nodes {
                id
                name
                type
                color
                position
            }
        }
        users {
            nodes {
                id
                name
                email
                avatarUrl
                displayName
            }
        }
    }
    """

    headers = {
        "Authorization": get_linear_authorization_header(api_key),
        "Content-Type": "application/json",
    }

    response = requests.post(
        "https://api.linear.app/graphql",
        json={"query": query},
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()

    if "errors" in data:
        error_msg = data["errors"][0].get("message", "Unknown error")
        logger.error(f"[LINEAR_METADATA] API error: {error_msg}")
        raise requests.RequestException(f"Linear API error: {error_msg}")

    # Extract and format metadata
    workspace = data.get("data", {})

    result = {
        "workspace": {
            "id": workspace.get("workspace", {}).get("id"),
            "name": workspace.get("workspace", {}).get("name"),
        },
        "labels": [
            {
                "id": label.get("id"),
                "name": label.get("name"),
                "color": label.get("color"),
                "description": label.get("description"),
            }
            for label in workspace.get("labels", {}).get("nodes", [])
        ],
        "users": [
            {
                "id": user.get("id"),
                "name": user.get("name"),
                "email": user.get("email"),
                "avatarUrl": user.get("avatarUrl"),
                "displayName": user.get("displayName"),
            }
            for user in workspace.get("users", {}).get("nodes", [])
        ],
        "teams": [
            {
                "id": team.get("id"),
                "name": team.get("name"),
                "key": team.get("key"),
                "members": [
                    {
                        "id": member.get("id"),
                        "name": member.get("name"),
                        "email": member.get("email"),
                        "avatarUrl": member.get("avatarUrl"),
                        "displayName": member.get("displayName"),
                    }
                    for member in team.get("members", {}).get("nodes", [])
                ],
            }
            for team in workspace.get("teams", {}).get("nodes", [])
        ],
        "projects": [
            {
                "id": project.get("id"),
                "name": project.get("name"),
                "state": project.get("state"),
                "url": project.get("url"),
                "teams": [
                    {
                        "id": t.get("id"),
                        "name": t.get("name"),
                    }
                    for t in project.get("teams", {}).get("nodes", [])
                ],
            }
            for project in workspace.get("projects", {}).get("nodes", [])
        ],
        "workflowStates": [
            {
                "id": state.get("id"),
                "name": state.get("name"),
                "type": state.get("type"),
                "color": state.get("color"),
                "position": state.get("position"),
            }
            for state in workspace.get("workflowStates", {}).get("nodes", [])
        ],
        # Linear priority values (0-4, where 4 = urgent)
        "priorities": [
            {"label": "No priority", "value": 0, "description": "No priority set"},
            {"label": "Urgent", "value": 4, "description": "Urgent - immediate attention needed"},
            {"label": "High", "value": 3, "description": "High priority"},
            {"label": "Medium", "value": 2, "description": "Medium priority"},
            {"label": "Low", "value": 1, "description": "Low priority"},
        ],
    }

    logger.info(
        f"[LINEAR_METADATA] Fetched {len(result['labels'])} labels, "
        f"{len(result['users'])} users, {len(result['teams'])} teams, "
        f"{len(result['projects'])} projects, {len(result['workflowStates'])} states"
    )

    # Cache the result
    cache.set(cache_key, result, expire=CACHE_TTL.total_seconds())

    return result


def invalidate_metadata_cache() -> None:
    """Clear the metadata cache."""
    cache = get_metadata_cache()
    cache.delete("workspace_metadata")
    logger.info("[LINEAR_METADATA] Metadata cache invalidated")


def get_linear_labels(api_key: str) -> list[dict]:
    """Convenience function to get just the labels."""
    metadata = fetch_linear_workspace_metadata(api_key)
    return metadata["labels"]


def get_linear_users(api_key: str) -> list[dict]:
    """Convenience function to get just the users."""
    metadata = fetch_linear_workspace_metadata(api_key)
    return metadata["users"]


def get_linear_teams(api_key: str) -> list[dict]:
    """Convenience function to get just the teams."""
    metadata = fetch_linear_workspace_metadata(api_key)
    return metadata["teams"]


def get_linear_projects(api_key: str) -> list[dict]:
    """Convenience function to get just the projects."""
    metadata = fetch_linear_workspace_metadata(api_key)
    return metadata["projects"]


def find_label_by_name(api_key: str, name: str) -> dict | None:
    """Find a label by name (case-insensitive)."""
    labels = get_linear_labels(api_key)
    name_lower = name.lower()
    for label in labels:
        if label["name"].lower() == name_lower:
            return label
    return None


def find_user_by_email(api_key: str, email: str) -> dict | None:
    """Find a user by email (case-insensitive)."""
    users = get_linear_users(api_key)
    email_lower = email.lower()
    for user in users:
        if user.get("email", "").lower() == email_lower:
            return user
    return None


def find_project_by_name(api_key: str, name: str) -> dict | None:
    """Find a project by name (case-insensitive)."""
    projects = get_linear_projects(api_key)
    name_lower = name.lower()
    for project in projects:
        if project["name"].lower() == name_lower:
            return project
    return None

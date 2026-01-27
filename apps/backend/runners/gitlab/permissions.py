"""
GitLab Permission and Authorization System
==========================================

Verifies who can trigger automation actions and validates token permissions.

Key features:
- Label-adder verification (who added the trigger label)
- Role-based access control (OWNER, MAINTAINER, DEVELOPER)
- Token scope validation (fail fast if insufficient)
- Group membership checks
- Permission denial logging with actor info
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)

# Import encode_project_path for URL-encoding project paths
try:
    from ..glab_client import encode_project_path
except (ImportError, ValueError, SystemError):
    from glab_client import encode_project_path


# GitLab permission roles (access levels)
# 50 = Reporter, 30 = Developer, 40 = Maintainer, 10 = Guest
# Owner = Maintainer + owns project
GitLabRole = Literal["OWNER", "MAINTAINER", "DEVELOPER", "REPORTER", "GUEST", "NONE"]


@dataclass
class PermissionCheckResult:
    """Result of a permission check."""

    allowed: bool
    username: str
    role: GitLabRole
    reason: str | None = None


class PermissionError(Exception):
    """Raised when permission checks fail."""

    pass


class GitLabPermissionChecker:
    """
    Verifies permissions for GitLab automation actions.

    Required token scopes:
    - api: Full API access

    Usage:
        checker = GitLabPermissionChecker(
            glab_client=glab_client,
            project="namespace/project",
            allowed_roles=["OWNER", "MAINTAINER"]
        )

        # Check who added a label
        username, role = await checker.check_label_adder(123, "auto-fix")

        # Verify if user can trigger auto-fix
        result = await checker.is_allowed_for_autofix(username)
    """

    # GitLab access levels
    ACCESS_LEVELS = {
        "GUEST": 10,
        "REPORTER": 20,
        "DEVELOPER": 30,
        "MAINTAINER": 40,
        "OWNER": 50,
    }

    def __init__(
        self,
        glab_client,  # GitLabClient from glab_client.py
        project: str,
        allowed_roles: list[str] | None = None,
        allow_external_contributors: bool = False,
    ):
        """
        Initialize permission checker.

        Args:
            glab_client: GitLab API client instance
            project: Project in "namespace/project" format
            allowed_roles: List of allowed roles (default: OWNER, MAINTAINER, DEVELOPER)
            allow_external_contributors: Allow users with no write access (default: False)
        """
        self.glab_client = glab_client
        self.project = project

        # Default to trusted roles if not specified
        self.allowed_roles = allowed_roles or ["OWNER", "MAINTAINER"]
        self.allow_external_contributors = allow_external_contributors

        # Cache for user roles (avoid repeated API calls)
        self._role_cache: dict[str, GitLabRole] = {}

        logger.info(
            f"Initialized GitLab permission checker for {project} "
            f"with allowed roles: {self.allowed_roles}"
        )

    async def verify_token_scopes(self) -> None:
        """
        Verify token has required scopes. Raises PermissionError if insufficient.

        This should be called at startup to fail fast if permissions are inadequate.
        """
        logger.info("Verifying GitLab token and permissions...")

        try:
            # Verify we can access the project (checks auth + project access)
            project_info = await self.glab_client._fetch_async(
                f"/projects/{encode_project_path(self.glab_client.config.project)}"
            )

            if not project_info:
                raise PermissionError(
                    f"Cannot access project {self.project}. "
                    f"Check your token is valid and has 'api' scope."
                )

            logger.info(f"✓ Token verified for {self.project}")

        except PermissionError:
            raise
        except Exception as e:
            logger.error(f"Failed to verify token: {e}")
            raise PermissionError(f"Could not verify token permissions: {e}")

    async def check_label_adder(
        self, issue_iid: int, label: str
    ) -> tuple[str, GitLabRole]:
        """
        Check who added a specific label to an issue.

        Args:
            issue_iid: Issue internal ID (iid)
            label: Label name to check

        Returns:
            Tuple of (username, role) who added the label

        Raises:
            PermissionError: If label was not found or couldn't determine who added it
        """
        logger.info(f"Checking who added label '{label}' to issue #{issue_iid}")

        try:
            # Get issue resource label events (who added/removed labels)
            events = await self.glab_client._fetch_async(
                f"/projects/{encode_project_path(self.glab_client.config.project)}/issues/{issue_iid}/resource_label_events"
            )

            # Find most recent label addition event
            for event in reversed(events):
                if (
                    event.get("action") == "add"
                    and event.get("label", {}).get("name") == label
                ):
                    user = event.get("user", {})
                    username = user.get("username")

                    if not username:
                        raise PermissionError(
                            f"Could not determine who added label '{label}'"
                        )

                    # Get role for this user
                    role = await self.get_user_role(username)

                    logger.info(
                        f"Label '{label}' was added by {username} (role: {role})"
                    )
                    return username, role

            raise PermissionError(
                f"Label '{label}' not found in issue #{issue_iid} label events"
            )

        except Exception as e:
            logger.error(f"Failed to check label adder: {e}")
            raise PermissionError(f"Could not verify label adder: {e}")

    async def get_user_role(self, username: str) -> GitLabRole:
        """
        Get a user's role in the project.

        Args:
            username: GitLab username

        Returns:
            User's role (OWNER, MAINTAINER, DEVELOPER, REPORTER, GUEST, NONE)

        Note:
            - OWNER: Project owner or namespace owner
            - MAINTAINER: Has Maintainer access level (40+)
            - DEVELOPER: Has Developer access level (30+)
            - REPORTER: Has Reporter access level (20+)
            - GUEST: Has Guest access level (10+)
            - NONE: No relationship to project
        """
        # Check cache first
        if username in self._role_cache:
            return self._role_cache[username]

        logger.debug(f"Checking role for user: {username}")

        try:
            # Check project members
            members = await self.glab_client.get_project_members_async(query=username)

            if members:
                # Use exact match verification to avoid privilege escalation
                # GitLab's query parameter performs fuzzy matching
                member = next(
                    (m for m in members if m.get("username") == username), None
                )
                if not member:
                    # No exact match found
                    role = "NONE"
                    self._role_cache[username] = role
                    return role

                access_level = member.get("access_level", 0)

                if access_level >= self.ACCESS_LEVELS["OWNER"]:
                    role = "OWNER"
                elif access_level >= self.ACCESS_LEVELS["MAINTAINER"]:
                    role = "MAINTAINER"
                elif access_level >= self.ACCESS_LEVELS["DEVELOPER"]:
                    role = "DEVELOPER"
                elif access_level >= self.ACCESS_LEVELS["REPORTER"]:
                    role = "REPORTER"
                else:
                    role = "GUEST"

                self._role_cache[username] = role
                return role

            # Not a direct member - check if user is the namespace owner
            project_info = await self.glab_client._fetch_async(
                f"/projects/{encode_project_path(self.glab_client.config.project)}"
            )
            namespace_path = project_info.get("namespace", {}).get("full_path", "")
            namespace_info = await self.glab_client._fetch_async(
                f"/namespaces/{encode_project_path(namespace_path)}"
            )

            # Check if namespace owner matches username
            owner_id = namespace_info.get("owner_id")
            if owner_id:
                # Get user info
                user_info = await self.glab_client._fetch_async(
                    f"/users?username={username}"
                )
                if user_info and user_info[0].get("id") == owner_id:
                    role = "OWNER"
                    self._role_cache[username] = role
                    return role

            # No relationship found
            role = "NONE"
            self._role_cache[username] = role
            return role

        except Exception as e:
            logger.error(f"Error checking user role for {username}: {e}")
            # Fail safe - treat as no permission
            return "NONE"

    async def is_allowed_for_autofix(self, username: str) -> PermissionCheckResult:
        """
        Check if a user is allowed to trigger auto-fix.

        Args:
            username: GitLab username to check

        Returns:
            PermissionCheckResult with allowed status and details
        """
        logger.info(f"Checking auto-fix permission for user: {username}")

        role = await self.get_user_role(username)

        # Check if role is allowed
        if role in self.allowed_roles:
            logger.info(f"✓ User {username} ({role}) is allowed to trigger auto-fix")
            return PermissionCheckResult(
                allowed=True, username=username, role=role, reason=None
            )

        # Permission denied
        reason = (
            f"User {username} has role '{role}', which is not in allowed roles: "
            f"{self.allowed_roles}"
        )

        logger.warning(
            f"✗ Auto-fix permission denied for {username}: {reason}",
            extra={
                "username": username,
                "role": role,
                "allowed_roles": self.allowed_roles,
            },
        )

        return PermissionCheckResult(
            allowed=False, username=username, role=role, reason=reason
        )

    async def verify_automation_trigger(
        self, issue_iid: int, trigger_label: str
    ) -> PermissionCheckResult:
        """
        Complete verification for an automation trigger (e.g., auto-fix label).

        This is the main entry point for permission checks.

        Args:
            issue_iid: Issue internal ID
            trigger_label: Label that triggered automation

        Returns:
            PermissionCheckResult with full details

        Raises:
            PermissionError: If verification fails
        """
        logger.info(
            f"Verifying automation trigger for issue #{issue_iid}, label: {trigger_label}"
        )

        # Step 1: Find who added the label
        username, role = await self.check_label_adder(issue_iid, trigger_label)

        # Step 2: Check if they're allowed
        result = await self.is_allowed_for_autofix(username)

        # Step 3: Log if denied
        if not result.allowed:
            self.log_permission_denial(
                action="auto-fix",
                username=username,
                role=role,
                issue_iid=issue_iid,
            )

        return result

    def log_permission_denial(
        self,
        action: str,
        username: str,
        role: GitLabRole,
        issue_iid: int | None = None,
        mr_iid: int | None = None,
    ) -> None:
        """
        Log a permission denial with full context.

        Args:
            action: Action that was denied (e.g., "auto-fix", "mr-review")
            username: GitLab username
            role: User's role
            issue_iid: Optional issue internal ID
            mr_iid: Optional MR internal ID
        """
        context = {
            "action": action,
            "username": username,
            "role": role,
            "project": self.project,
            "allowed_roles": self.allowed_roles,
            "allow_external_contributors": self.allow_external_contributors,
        }

        if issue_iid:
            context["issue_iid"] = issue_iid
        if mr_iid:
            context["mr_iid"] = mr_iid

        logger.warning(
            f"PERMISSION DENIED: {username} ({role}) attempted {action} in {self.project}",
            extra=context,
        )

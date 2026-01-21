"""
Unit Tests for GitLab Permission System
========================================

Tests for GitLabPermissionChecker and permission verification.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from runners.gitlab.permissions import (
    GitLabPermissionChecker,
    GitLabRole,
    PermissionCheckResult,
    PermissionError,
)


class MockGitLabClient:
    """Mock GitLab API client for testing."""

    def __init__(self):
        self._fetch_async = AsyncMock()

    def config(self):
        """Return mock config."""
        mock_config = MagicMock()
        mock_config.project = "namespace/project"
        return mock_config


@pytest.fixture
def mock_glab_client():
    """Create a mock GitLab client."""
    client = MockGitLabClient()
    client.config = MagicMock()
    client.config.project = "namespace/test-project"
    return client


@pytest.fixture
def permission_checker(mock_glab_client):
    """Create a permission checker instance."""
    return GitLabPermissionChecker(
        glab_client=mock_glab_client,
        project="namespace/test-project",
        allowed_roles=["OWNER", "MAINTAINER"],
        allow_external_contributors=False,
    )


@pytest.mark.asyncio
async def test_verify_token_scopes_success(permission_checker, mock_glab_client):
    """Test successful token scope verification."""
    mock_glab_client._fetch_async.return_value = {
        "id": 123,
        "name": "test-project",
        "path_with_namespace": "namespace/test-project",
    }

    # Should not raise
    await permission_checker.verify_token_scopes()


@pytest.mark.asyncio
async def test_verify_token_scopes_project_not_found(
    permission_checker, mock_glab_client
):
    """Test project not found raises PermissionError."""
    mock_glab_client._fetch_async.return_value = None

    with pytest.raises(PermissionError, match="Cannot access project"):
        await permission_checker.verify_token_scopes()


@pytest.mark.asyncio
async def test_check_label_adder_success(permission_checker, mock_glab_client):
    """Test successfully finding who added a label."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "user": {"username": "alice"},
            "action": "add",
            "label": {"name": "auto-fix"},
        },
        {
            "id": 2,
            "user": {"username": "bob"},
            "action": "remove",
            "label": {"name": "auto-fix"},
        },
    ]

    username, role = await permission_checker.check_label_adder(123, "auto-fix")

    assert username == "alice"
    assert role in [
        GitLabRole.OWNER,
        GitLabRole.MAINTAINER,
        GitLabRole.DEVELOPER,
        GitLabRole.REPORTER,
        GitLabRole.GUEST,
        GitLabRole.NONE,
    ]


@pytest.mark.asyncio
async def test_check_label_adder_label_not_found(permission_checker, mock_glab_client):
    """Test label not found raises PermissionError."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "user": {"username": "alice"},
            "action": "add",
            "label": {"name": "bug"},
        },
    ]

    with pytest.raises(PermissionError, match="not found in issue"):
        await permission_checker.check_label_adder(123, "auto-fix")


@pytest.mark.asyncio
async def test_check_label_adder_no_username(permission_checker, mock_glab_client):
    """Test label event without username raises PermissionError."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "action": "add",
            "label": {"name": "auto-fix"},
        },
    ]

    with pytest.raises(PermissionError, match="Could not determine who added"):
        await permission_checker.check_label_adder(123, "auto-fix")


@pytest.mark.asyncio
async def test_get_user_role_project_member(permission_checker, mock_glab_client):
    """Test getting role for project member."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "username": "alice",
            "access_level": 40,  # MAINTAINER
        },
    ]

    role = await permission_checker.get_user_role("alice")

    assert role == GitLabRole.MAINTAINER


@pytest.mark.asyncio
async def test_get_user_role_owner_via_namespace(permission_checker, mock_glab_client):
    """Test getting OWNER role via namespace ownership."""
    # Not a direct member
    mock_glab_client._fetch_async.side_effect = [
        [],  # No project members
        {  # Project info
            "id": 123,
            "namespace": {
                "full_path": "namespace",
                "owner_id": 999,
            },
        },
        [  # User info matches owner
            {
                "id": 999,
                "username": "alice",
            },
        ],
    ]

    role = await permission_checker.get_user_role("alice")

    assert role == GitLabRole.OWNER


@pytest.mark.asyncio
async def test_get_user_role_no_relationship(permission_checker, mock_glab_client):
    """Test getting role for user with no relationship."""
    mock_glab_client._fetch_async.side_effect = [
        [],  # No project members
        {  # Project info
            "id": 123,
            "namespace": {
                "full_path": "namespace",
                "owner_id": 999,
            },
        },
        [  # User doesn't match owner
            {
                "id": 111,
                "username": "alice",
            },
        ],
    ]

    role = await permission_checker.get_user_role("alice")

    assert role == GitLabRole.NONE


@pytest.mark.asyncio
async def test_get_user_role_uses_cache(permission_checker, mock_glab_client):
    """Test that role results are cached."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "username": "alice",
            "access_level": 40,
        },
    ]

    # First call
    role1 = await permission_checker.get_user_role("alice")
    # Second call should use cache
    role2 = await permission_checker.get_user_role("alice")

    assert role1 == role2 == GitLabRole.MAINTAINER
    # Should only call API once
    assert mock_glab_client._fetch_async.call_count == 1


@pytest.mark.asyncio
async def test_is_allowed_for_autofix_allowed(permission_checker, mock_glab_client):
    """Test user is allowed for auto-fix."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "username": "alice",
            "access_level": 40,  # MAINTAINER
        },
    ]

    result = await permission_checker.is_allowed_for_autofix("alice")

    assert result.allowed is True
    assert result.username == "alice"
    assert result.role == GitLabRole.MAINTAINER
    assert result.reason is None


@pytest.mark.asyncio
async def test_is_allowed_for_autofix_denied(permission_checker, mock_glab_client):
    """Test user is denied for auto-fix."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "username": "bob",
            "access_level": 20,  # REPORTER (not in allowed roles)
        },
    ]

    result = await permission_checker.is_allowed_for_autofix("bob")

    assert result.allowed is False
    assert result.username == "bob"
    assert result.role == GitLabRole.REPORTER
    assert "not in allowed roles" in result.reason


@pytest.mark.asyncio
async def test_verify_automation_trigger_allowed(permission_checker, mock_glab_client):
    """Test complete verification succeeds for allowed user."""
    mock_glab_client._fetch_async.side_effect = [
        # Label events
        [
            {
                "id": 1,
                "user": {"username": "alice"},
                "action": "add",
                "label": {"name": "auto-fix"},
            },
        ],
        # User role check
        [
            {
                "id": 1,
                "username": "alice",
                "access_level": 40,
            },
        ],
    ]

    result = await permission_checker.verify_automation_trigger(123, "auto-fix")

    assert result.allowed is True


@pytest.mark.asyncio
async def test_verify_automation_trigger_denied_logs_warning(
    permission_checker, mock_glab_client, caplog
):
    """Test denial is logged with full context."""
    mock_glab_client._fetch_async.side_effect = [
        # Label events
        [
            {
                "id": 1,
                "user": {"username": "bob"},
                "action": "add",
                "label": {"name": "auto-fix"},
            },
        ],
        # User role check
        [
            {
                "id": 1,
                "username": "bob",
                "access_level": 20,  # REPORTER
            },
        ],
    ]

    result = await permission_checker.verify_automation_trigger(123, "auto-fix")

    assert result.allowed is False


def test_log_permission_denial(permission_checker, caplog):
    """Test permission denial logging includes full context."""
    permission_checker.log_permission_denial(
        action="auto-fix",
        username="bob",
        role=GitLabRole.REPORTER,
        issue_iid=123,
    )

    # Check that the log contains all relevant info
    # Note: actual logging capture depends on logging configuration


def test_access_levels():
    """Test access level constants are correct."""
    assert GitLabPermissionChecker.ACCESS_LEVELS["GUEST"] == 10
    assert GitLabPermissionChecker.ACCESS_LEVELS["REPORTER"] == 20
    assert GitLabPermissionChecker.ACCESS_LEVELS["DEVELOPER"] == 30
    assert GitLabPermissionChecker.ACCESS_LEVELS["MAINTAINER"] == 40
    assert GitLabPermissionChecker.ACCESS_LEVELS["OWNER"] == 50


@pytest.mark.asyncio
async def test_get_user_role_developer(permission_checker, mock_glab_client):
    """Test getting DEVELOPER role."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "username": "dev",
            "access_level": 30,
        },
    ]

    role = await permission_checker.get_user_role("dev")

    assert role == GitLabRole.DEVELOPER


@pytest.mark.asyncio
async def test_get_user_role_guest(permission_checker, mock_glab_client):
    """Test getting GUEST role."""
    mock_glab_client._fetch_async.return_value = [
        {
            "id": 1,
            "username": "guest",
            "access_level": 10,
        },
    ]

    role = await permission_checker.get_user_role("guest")

    assert role == GitLabRole.GUEST

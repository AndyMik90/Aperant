"""
Tests for GitHub Permission System (permissions.py)
==================================================

Tests permission checking, role-based access control, and
authorization for GitHub automation actions.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from runners.github.permissions import (
    GitHubRole,
    PermissionCheckResult,
    PermissionError,
    GitHubPermissionChecker,
)


# ============================================================================
# PermissionCheckResult Tests
# ============================================================================


class TestPermissionCheckResult:
    """Tests for PermissionCheckResult dataclass."""

    def test_allowed_result(self):
        """Test creating allowed result."""
        result = PermissionCheckResult(
            allowed=True,
            username="alice",
            role="OWNER"
        )
        assert result.allowed is True
        assert result.username == "alice"
        assert result.role == "OWNER"
        assert result.reason is None

    def test_denied_result_with_reason(self):
        """Test creating denied result with reason."""
        result = PermissionCheckResult(
            allowed=False,
            username="bob",
            role="CONTRIBUTOR",
            reason="Not in allowed roles"
        )
        assert result.allowed is False
        assert result.reason == "Not in allowed roles"


# ============================================================================
# PermissionError Tests
# ============================================================================


class TestPermissionError:
    """Tests for PermissionError exception."""

    def test_raise_and_catch(self):
        """Test raising and catching PermissionError."""
        with pytest.raises(PermissionError) as exc_info:
            raise PermissionError("Access denied")
        assert "Access denied" in str(exc_info.value)


# ============================================================================
# GitHubPermissionChecker Init Tests
# ============================================================================


class TestGitHubPermissionCheckerInit:
    """Tests for GitHubPermissionChecker initialization."""

    def test_init_with_defaults(self):
        """Test initialization with default values."""
        mock_client = AsyncMock()
        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )
        assert checker.gh_client == mock_client
        assert checker.repo == "owner/repo"
        assert checker.owner == "owner"
        assert checker.repo_name == "repo"
        assert checker.allowed_roles == ["OWNER", "MEMBER", "COLLABORATOR"]
        assert checker.allow_external_contributors is False
        assert checker._role_cache == {}

    def test_init_with_custom_roles(self):
        """Test initialization with custom allowed roles."""
        mock_client = AsyncMock()
        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo",
            allowed_roles=["OWNER"]
        )
        assert checker.allowed_roles == ["OWNER"]

    def test_init_with_external_contributors(self):
        """Test initialization allowing external contributors."""
        mock_client = AsyncMock()
        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo",
            allow_external_contributors=True
        )
        assert checker.allow_external_contributors is True

    def test_required_scopes(self):
        """Test required scopes constants."""
        assert "repo" in GitHubPermissionChecker.REQUIRED_SCOPES
        assert "read:org" in GitHubPermissionChecker.REQUIRED_SCOPES

    def test_minimum_scopes(self):
        """Test minimum scopes constants."""
        assert GitHubPermissionChecker.MINIMUM_SCOPES == ["repo"]


# ============================================================================
# verify_token_scopes Tests
# ============================================================================


class TestVerifyTokenScopes:
    """Tests for verify_token_scopes method."""

    @pytest.mark.asyncio
    async def test_verify_success_with_push(self):
        """Test successful verification with push access."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={
            "permissions": {"push": True, "admin": False},
            "owner": {"type": "User"}
        })

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        # Should not raise
        await checker.verify_token_scopes()

    @pytest.mark.asyncio
    async def test_verify_success_with_admin(self):
        """Test successful verification with admin access."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={
            "permissions": {"push": False, "admin": True},
            "owner": {"type": "User"}
        })

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        # Should not raise
        await checker.verify_token_scopes()

    @pytest.mark.asyncio
    async def test_verify_no_write_access(self):
        """Test verification with no write access."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={
            "permissions": {"push": False, "admin": False},
            "owner": {"type": "User"}
        })

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        # Should not raise, just log warning
        await checker.verify_token_scopes()

    @pytest.mark.asyncio
    async def test_verify_org_access(self):
        """Test verification with organization access."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(side_effect=[
            # First call: repo info
            {
                "permissions": {"push": True},
                "owner": {"type": "Organization"}
            },
            # Second call: org check
            {"login": "test-org"}
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        await checker.verify_token_scopes()

    @pytest.mark.asyncio
    async def test_verify_org_access_fails(self):
        """Test verification when org access fails."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(side_effect=[
            # Repo info
            {
                "permissions": {"push": True},
                "owner": {"type": "Organization"}
            },
            # Org check fails
            Exception("Not authorized")
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        # Should not raise, just log warning
        await checker.verify_token_scopes()

    @pytest.mark.asyncio
    async def test_verify_repo_not_accessible(self):
        """Test verification when repo is not accessible."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value=None)

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        with pytest.raises(PermissionError, match="Cannot access repository"):
            await checker.verify_token_scopes()

    @pytest.mark.asyncio
    async def test_verify_api_error(self):
        """Test verification when API call fails."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(side_effect=Exception("Network error"))

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        with pytest.raises(PermissionError, match="Could not verify token"):
            await checker.verify_token_scopes()


# ============================================================================
# check_label_adder Tests
# ============================================================================


class TestCheckLabelAdder:
    """Tests for check_label_adder method."""

    @pytest.mark.asyncio
    async def test_finds_label_adder(self):
        """Test finding user who added label."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value=[
            {
                "event": "labeled",
                "label": {"name": "auto-fix"},
                "actor": {"login": "alice"}
            },
            {
                "event": "commented",
                "actor": {"login": "bob"}
            }
        ])
        mock_client.api_get = AsyncMock(side_effect=[
            # Events call
            [
                {
                    "event": "labeled",
                    "label": {"name": "auto-fix"},
                    "actor": {"login": "alice"}
                }
            ],
            # Role check
            {}
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        # Mock get_user_role
        async def mock_get_user_role(username):
            return "MEMBER"

        with patch.object(checker, 'get_user_role', side_effect=mock_get_user_role):
            username, role = await checker.check_label_adder(123, "auto-fix")

        assert username == "alice"
        assert role == "MEMBER"

    @pytest.mark.asyncio
    async def test_label_not_found(self):
        """Test when label is not found in events."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value=[
            {"event": "commented", "actor": {"login": "alice"}}
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        with pytest.raises(PermissionError, match="not found"):
            await checker.check_label_adder(123, "auto-fix")

    @pytest.mark.asyncio
    async def test_actor_without_login(self):
        """Test when actor has no login field."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value=[
            {
                "event": "labeled",
                "label": {"name": "auto-fix"},
                "actor": {}  # No login
            }
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        with pytest.raises(PermissionError):
            await checker.check_label_adder(123, "auto-fix")


# ============================================================================
# get_user_role Tests
# ============================================================================


class TestGetUserRole:
    """Tests for get_user_role method."""

    @pytest.mark.asyncio
    async def test_owner_role(self):
        """Test user is repository owner."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="alice/repo"
        )

        role = await checker.get_user_role("alice")
        assert role == "OWNER"

    @pytest.mark.asyncio
    async def test_owner_case_insensitive(self):
        """Test owner check is case insensitive."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="Alice/repo"
        )

        role = await checker.get_user_role("ALICE")
        assert role == "OWNER"

    @pytest.mark.asyncio
    async def test_collaborator_role(self):
        """Test user with write access."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={
            "permission": "write"
        })

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        role = await checker.get_user_role("bob")
        assert role == "COLLABORATOR"

    @pytest.mark.asyncio
    async def test_admin_permission(self):
        """Test user with admin permission."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={
            "permission": "admin"
        })

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        role = await checker.get_user_role("bob")
        assert role == "COLLABORATOR"

    @pytest.mark.asyncio
    async def test_maintain_permission(self):
        """Test user with maintain permission."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={
            "permission": "maintain"
        })

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        role = await checker.get_user_role("bob")
        assert role == "COLLABORATOR"

    @pytest.mark.asyncio
    async def test_org_member_role(self):
        """Test organization member."""
        mock_client = AsyncMock()
        # First call: collaborator check (fails)
        # Second call: repo info (org repo)
        # Third call: org membership check (succeeds)
        mock_client.api_get = AsyncMock(side_effect=[
            Exception("Not a collaborator"),
            {"owner": {"type": "Organization"}},
            {}  # Org member check succeeds
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        role = await checker.get_user_role("bob")
        assert role == "MEMBER"

    @pytest.mark.asyncio
    async def test_contributor_role(self):
        """Test contributor (no write access but has contributions)."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(side_effect=[
            Exception("Not a collaborator"),
            {"owner": {"type": "User"}},
            [{"login": "bob"}]  # Contributors list
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        role = await checker.get_user_role("bob")
        assert role == "CONTRIBUTOR"

    @pytest.mark.asyncio
    async def test_no_role(self):
        """Test user with no relationship to repo."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(side_effect=[
            Exception("Not a collaborator"),
            {"owner": {"type": "User"}},
            Exception("No contributors")
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        role = await checker.get_user_role("stranger")
        assert role == "NONE"

    @pytest.mark.asyncio
    async def test_role_caching(self):
        """Test that roles are cached."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={
            "permission": "write"
        })

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        # First call
        role1 = await checker.get_user_role("bob")
        # Second call should use cache
        role2 = await checker.get_user_role("bob")

        assert role1 == role2
        assert mock_client.api_get.call_count == 1


# ============================================================================
# is_allowed_for_autofix Tests
# ============================================================================


class TestIsAllowedForAutofix:
    """Tests for is_allowed_for_autofix method."""

    @pytest.mark.asyncio
    async def test_allowed_owner(self):
        """Test owner is allowed."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        async def mock_role(username):
            return "OWNER"

        with patch.object(checker, 'get_user_role', side_effect=mock_role):
            result = await checker.is_allowed_for_autofix("owner")

        assert result.allowed is True
        assert result.username == "owner"
        assert result.role == "OWNER"
        assert result.reason is None

    @pytest.mark.asyncio
    async def test_allowed_member(self):
        """Test member is allowed."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        async def mock_role(username):
            return "MEMBER"

        with patch.object(checker, 'get_user_role', side_effect=mock_role):
            result = await checker.is_allowed_for_autofix("alice")

        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_allowed_collaborator(self):
        """Test collaborator is allowed."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        async def mock_role(username):
            return "COLLABORATOR"

        with patch.object(checker, 'get_user_role', side_effect=mock_role):
            result = await checker.is_allowed_for_autofix("bob")

        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_denied_contributor(self):
        """Test contributor is denied by default."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        async def mock_role(username):
            return "CONTRIBUTOR"

        with patch.object(checker, 'get_user_role', side_effect=mock_role):
            result = await checker.is_allowed_for_autofix("charlie")

        assert result.allowed is False
        assert "CONTRIBUTOR" in result.reason
        assert "not in allowed roles" in result.reason

    @pytest.mark.asyncio
    async def test_denied_none(self):
        """Test user with no role is denied."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        async def mock_role(username):
            return "NONE"

        with patch.object(checker, 'get_user_role', side_effect=mock_role):
            result = await checker.is_allowed_for_autofix("stranger")

        assert result.allowed is False

    @pytest.mark.asyncio
    async def test_allowed_contributor_with_flag(self):
        """Test contributor is allowed when external contributors allowed."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo",
            allow_external_contributors=True
        )

        async def mock_role(username):
            return "CONTRIBUTOR"

        with patch.object(checker, 'get_user_role', side_effect=mock_role):
            result = await checker.is_allowed_for_autofix("contributor")

        assert result.allowed is True


# ============================================================================
# check_org_membership Tests
# ============================================================================


class TestCheckOrgMembership:
    """Tests for check_org_membership method."""

    @pytest.mark.asyncio
    async def test_org_member(self):
        """Test user is org member."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(side_effect=[
            {"owner": {"type": "Organization"}},
            {}  # Membership check succeeds
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        result = await checker.check_org_membership("alice")
        assert result is True

    @pytest.mark.asyncio
    async def test_not_org_member(self):
        """Test user is not org member."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(side_effect=[
            {"owner": {"type": "Organization"}},
            Exception("Not a member")
        ])

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        result = await checker.check_org_membership("bob")
        assert result is False

    @pytest.mark.asyncio
    async def test_not_org_repo(self):
        """Test non-organization repo returns True."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={
            "owner": {"type": "User"}
        })

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        result = await checker.check_org_membership("alice")
        assert result is True  # Not an org repo, so N/A


# ============================================================================
# check_team_membership Tests
# ============================================================================


class TestCheckTeamMembership:
    """Tests for check_team_membership method."""

    @pytest.mark.asyncio
    async def test_team_member(self):
        """Test user is team member."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(return_value={})

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        result = await checker.check_team_membership("alice", "developers")
        assert result is True

    @pytest.mark.asyncio
    async def test_not_team_member(self):
        """Test user is not team member."""
        mock_client = AsyncMock()
        mock_client.api_get = AsyncMock(side_effect=Exception("Not a member"))

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        result = await checker.check_team_membership("bob", "developers")
        assert result is False


# ============================================================================
# log_permission_denial Tests
# ============================================================================


class TestLogPermissionDenial:
    """Tests for log_permission_denial method."""

    def test_log_denial_basic(self):
        """Test basic permission denial logging."""
        mock_client = AsyncMock()
        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        # Should not raise
        with patch('runners.github.permissions.logger'):
            checker.log_permission_denial(
                action="auto-fix",
                username="bob",
                role="CONTRIBUTOR"
            )

    def test_log_denial_with_issue(self):
        """Test permission denial logging with issue number."""
        mock_client = AsyncMock()
        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        with patch('runners.github.permissions.logger'):
            checker.log_permission_denial(
                action="auto-fix",
                username="bob",
                role="CONTRIBUTOR",
                issue_number=123
            )

    def test_log_denial_with_pr(self):
        """Test permission denial logging with PR number."""
        mock_client = AsyncMock()
        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        with patch('runners.github.permissions.logger'):
            checker.log_permission_denial(
                action="pr-review",
                username="bob",
                role="CONTRIBUTOR",
                pr_number=456
            )


# ============================================================================
# verify_automation_trigger Tests
# ============================================================================


class TestVerifyAutomationTrigger:
    """Tests for verify_automation_trigger method."""

    @pytest.mark.asyncio
    async def test_allowed_trigger(self):
        """Test successful automation trigger verification."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        with patch.object(checker, 'check_label_adder', return_value=("alice", "OWNER")), \
             patch.object(checker, 'is_allowed_for_autofix', return_value=PermissionCheckResult(
                 allowed=True, username="alice", role="OWNER"
             )):
            result = await checker.verify_automation_trigger(123, "auto-fix")

        assert result.allowed is True
        assert result.username == "alice"

    @pytest.mark.asyncio
    async def test_denied_trigger(self):
        """Test denied automation trigger."""
        mock_client = AsyncMock()

        checker = GitHubPermissionChecker(
            gh_client=mock_client,
            repo="owner/repo"
        )

        with patch.object(checker, 'check_label_adder', return_value=("bob", "CONTRIBUTOR")), \
             patch.object(checker, 'is_allowed_for_autofix', return_value=PermissionCheckResult(
                 allowed=False, username="bob", role="CONTRIBUTOR", reason="Not allowed"
             )), \
             patch.object(checker, 'log_permission_denial'):
            result = await checker.verify_automation_trigger(123, "auto-fix")

        assert result.allowed is False
        assert result.username == "bob"

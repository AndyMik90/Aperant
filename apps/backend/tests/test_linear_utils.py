"""
Unit Tests for Linear Utils

Tests for:
- Authorization header construction with OAuth tokens
- Authorization header construction with API keys
- Linear ticket fetching
"""

import asyncio
from unittest.mock import Mock, patch

import pytest


class TestAuthorizationHeader:
    """Test Linear API authorization header construction in fetch_linear_ticket."""

    @pytest.mark.asyncio
    async def test_authorization_with_oauth_token(self):
        """OAuth tokens should be prefixed with 'Bearer '."""
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"issue": {"id": "ISSUE-1", "title": "Test Ticket"}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_utils import fetch_linear_ticket

            await fetch_linear_ticket("LIN-123", api_key="oauth_token_456")

            # Verify Authorization header includes "Bearer " prefix
            call_args = mock_post.call_args
            headers = call_args.kwargs.get("headers", {})
            assert headers["Authorization"] == "Bearer oauth_token_456"

    @pytest.mark.asyncio
    async def test_authorization_with_personal_api_key(self):
        """Personal API keys (lin_api_*) should be used directly."""
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"issue": {"id": "ISSUE-1", "title": "Test Ticket"}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_utils import fetch_linear_ticket

            await fetch_linear_ticket("LIN-123", api_key="lin_api_abcdefghij")

            # Verify Authorization header does NOT include "Bearer " prefix
            call_args = mock_post.call_args
            headers = call_args.kwargs.get("headers", {})
            assert headers["Authorization"] == "lin_api_abcdefghij"
            assert not headers["Authorization"].startswith("Bearer ")

    @pytest.mark.asyncio
    async def test_authorization_with_linear_api_token(self):
        """Linear API tokens (starting with lin_) should use Bearer prefix."""
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"issue": {"id": "ISSUE-1", "title": "Test Ticket"}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_utils import fetch_linear_ticket

            await fetch_linear_ticket("LIN-123", api_key="lin_test_token_123")

            # Verify Authorization header includes "Bearer " prefix
            call_args = mock_post.call_args
            headers = call_args.kwargs.get("headers", {})
            assert headers["Authorization"] == "Bearer lin_test_token_123"

    @pytest.mark.asyncio
    async def test_authorization_consistency_with_linear_validator(self):
        """Authorization logic should match linear_validator.py pattern.

        This test ensures consistency across all Linear API callers.
        """
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {"data": {"issue": {"id": "ISSUE-1"}}}
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_utils import fetch_linear_ticket

            # Test the pattern from linear_validator.py
            api_key = "test_token"
            expected = (
                api_key if api_key.startswith("lin_api_") else f"Bearer {api_key}"
            )

            await fetch_linear_ticket("LIN-123", api_key=api_key)

            call_args = mock_post.call_args
            headers = call_args.kwargs.get("headers", {})
            assert headers["Authorization"] == expected


class TestFetchLinearTicket:
    """Test ticket fetching functionality."""

    @pytest.mark.asyncio
    async def test_fetch_returns_ticket(self):
        """Should return ticket data from API response."""
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock response with ticket
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {
                    "issue": {
                        "id": "LIN-123",
                        "title": "Bug in login",
                        "description": "Users cannot login",
                        "state": {"name": "In Progress"},
                        "priority": 1,
                        "labels": {"nodes": [{"name": "bug"}]},
                        "url": "https://linear.app/issue/LIN-123",
                    }
                }
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_utils import fetch_linear_ticket

            ticket = await fetch_linear_ticket("LIN-123", api_key="lin_api_test")

            assert ticket is not None
            assert ticket["id"] == "LIN-123"
            assert ticket["title"] == "Bug in login"
            assert ticket["state"]["name"] == "In Progress"

    @pytest.mark.asyncio
    async def test_fetch_handles_missing_ticket(self):
        """Should return None when ticket not found."""
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock response with null issue
            mock_response = Mock()
            mock_response.json.return_value = {"data": {"issue": None}}
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_utils import fetch_linear_ticket

            ticket = await fetch_linear_ticket("NON-EXISTENT", api_key="lin_api_test")

            assert ticket is None

    @pytest.mark.asyncio
    async def test_fetch_handles_api_error(self):
        """Should return None on API error."""
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock error response
            mock_post.side_effect = Exception("Network error")

            from agents.linear_utils import fetch_linear_ticket

            ticket = await fetch_linear_ticket("LIN-123", api_key="lin_api_test")

            assert ticket is None

    @pytest.mark.asyncio
    async def test_fetch_uses_correct_endpoint(self):
        """Should call Linear GraphQL endpoint."""
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {"data": {"issue": {"id": "LIN-123"}}}
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_utils import fetch_linear_ticket

            await fetch_linear_ticket("LIN-123", api_key="lin_api_test")

            # Verify correct endpoint
            call_args = mock_post.call_args
            assert call_args.args[0] == "https://api.linear.app/graphql"

    @pytest.mark.asyncio
    async def test_fetch_has_timeout(self):
        """Should use timeout for API requests."""
        with patch("agents.linear_utils.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {"data": {"issue": {"id": "LIN-123"}}}
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_utils import fetch_linear_ticket

            await fetch_linear_ticket("LIN-123", api_key="lin_api_test")

            # Verify timeout is set
            call_args = mock_post.call_args
            timeout = call_args.kwargs.get("timeout")
            assert timeout is not None
            assert timeout == 30


class TestFormatLabels:
    """Test label formatting utility."""

    def test_format_labels_with_nodes(self):
        """Should format labels with nodes."""
        from agents.linear_utils import format_labels

        labels_obj = {"nodes": [{"name": "bug"}, {"name": "urgent"}]}

        result = format_labels(labels_obj)
        assert result == "bug, urgent"

    def test_format_labels_empty_nodes(self):
        """Should return 'None' for empty labels."""
        from agents.linear_utils import format_labels

        labels_obj = {"nodes": []}

        result = format_labels(labels_obj)
        assert result == "None"

    def test_format_labels_missing_nodes(self):
        """Should return 'None' when nodes key missing."""
        from agents.linear_utils import format_labels

        labels_obj = {}

        result = format_labels(labels_obj)
        assert result == "None"

    def test_format_labels_none_input(self):
        """Should return 'None' for None input."""
        from agents.linear_utils import format_labels

        result = format_labels(None)
        assert result == "None"

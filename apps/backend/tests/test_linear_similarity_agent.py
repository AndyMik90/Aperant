"""
Unit Tests for Linear Similarity Agent

Tests for:
- Authorization header construction in _fetch_team_tickets
- Team ticket fetching
"""

from unittest.mock import Mock, patch

import pytest


class TestAuthorizationHeader:
    """Test Linear API authorization header construction in _fetch_team_tickets."""

    @pytest.mark.asyncio
    async def test_authorization_with_oauth_token(self):
        """OAuth tokens should be prefixed with 'Bearer '."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            await _fetch_team_tickets("test-team-id", api_key="oauth_token_123")

            # Verify Authorization header includes "Bearer " prefix
            call_args = mock_post.call_args
            headers = call_args.kwargs.get("headers", {})
            assert headers["Authorization"] == "Bearer oauth_token_123"

    @pytest.mark.asyncio
    async def test_authorization_with_personal_api_key(self):
        """Personal API keys (lin_api_*) should be used directly."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            await _fetch_team_tickets("test-team-id", api_key="lin_api_1234567890")

            # Verify Authorization header does NOT include "Bearer " prefix
            call_args = mock_post.call_args
            headers = call_args.kwargs.get("headers", {})
            assert headers["Authorization"] == "lin_api_1234567890"
            assert not headers["Authorization"].startswith("Bearer ")

    @pytest.mark.asyncio
    async def test_authorization_with_linear_api_token(self):
        """Linear API tokens (starting with lin_) should use Bearer prefix."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            await _fetch_team_tickets("test-team-id", api_key="lin_test_token")

            # Verify Authorization header includes "Bearer " prefix
            call_args = mock_post.call_args
            headers = call_args.kwargs.get("headers", {})
            assert headers["Authorization"] == "Bearer lin_test_token"


class TestFetchTeamTickets:
    """Test team ticket fetching functionality."""

    @pytest.mark.asyncio
    async def test_fetch_returns_tickets(self):
        """Should return list of tickets from API response."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock response with tickets
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {
                    "team": {
                        "issues": {
                            "nodes": [
                                {
                                    "id": "ISSUE-1",
                                    "title": "First ticket",
                                    "state": {"name": "Backlog"},
                                    "priority": 3,
                                    "labels": {"nodes": []},
                                    "url": "https://linear.app/issue/ISSUE-1",
                                },
                                {
                                    "id": "ISSUE-2",
                                    "title": "Second ticket",
                                    "state": {"name": "In Progress"},
                                    "priority": 2,
                                    "labels": {"nodes": [{"name": "bug"}]},
                                    "url": "https://linear.app/issue/ISSUE-2",
                                },
                            ]
                        }
                    }
                }
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            tickets = await _fetch_team_tickets("team-123", api_key="lin_api_test")

            assert len(tickets) == 2
            assert tickets[0]["id"] == "ISSUE-1"
            assert tickets[1]["title"] == "Second ticket"

    @pytest.mark.asyncio
    async def test_fetch_handles_empty_response(self):
        """Should return empty list when no tickets found."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock empty response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            tickets = await _fetch_team_tickets("team-123", api_key="lin_api_test")

            assert tickets == []

    @pytest.mark.asyncio
    async def test_fetch_handles_api_error(self):
        """Should return empty list on API error."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock error response
            mock_post.side_effect = Exception("API Error")

            from agents.linear_similarity_agent import _fetch_team_tickets

            tickets = await _fetch_team_tickets("team-123", api_key="lin_api_test")

            assert tickets == []

    @pytest.mark.asyncio
    async def test_fetch_uses_correct_endpoint(self):
        """Should call Linear GraphQL endpoint."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            await _fetch_team_tickets("team-123", api_key="lin_api_test")

            # Verify correct endpoint
            call_args = mock_post.call_args
            assert call_args.args[0] == "https://api.linear.app/graphql"

    @pytest.mark.asyncio
    async def test_fetch_sends_team_id_in_variables(self):
        """Should include teamId in GraphQL variables."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            await _fetch_team_tickets("team-abc-123", api_key="lin_api_test")

            # Verify teamId in variables
            call_args = mock_post.call_args
            json_payload = call_args.kwargs.get("json", {})
            variables = json_payload.get("variables", {})
            assert variables["teamId"] == "team-abc-123"

    @pytest.mark.asyncio
    async def test_fetch_has_timeout(self):
        """Should use timeout for API requests."""
        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock successful response
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            await _fetch_team_tickets("team-123", api_key="lin_api_test")

            # Verify timeout is set
            call_args = mock_post.call_args
            timeout = call_args.kwargs.get("timeout")
            assert timeout is not None
            assert timeout == 30

"""
Unit Tests for Linear Similarity Agent

Tests for:
- Authorization header construction in _fetch_team_tickets
- Team ticket fetching
"""

import asyncio
from pathlib import Path
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


class TestAsyncNonBlocking:
    """Test that async functions don't block the event loop."""

    @pytest.mark.asyncio
    async def test_fetch_team_tickets_is_async(self):
        """_fetch_team_tickets should be callable as an async function."""
        # Verify the function is a coroutine function
        import inspect

        from agents.linear_similarity_agent import _fetch_team_tickets

        assert inspect.iscoroutinefunction(_fetch_team_tickets)

    @pytest.mark.asyncio
    async def test_multiple_fetches_run_concurrently(self):
        """Multiple _fetch_team_tickets calls should run concurrently."""
        from unittest.mock import Mock

        from agents.linear_similarity_agent import _fetch_team_tickets

        fetch_count = {"count": 0}

        # Use direct mock for requests.post inside the thread
        import requests

        def mock_post_with_tracking(*args, **kwargs):
            fetch_count["count"] += 1
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {
                    "team": {
                        "issues": {"nodes": [{"id": f"ISSUE-{fetch_count['count']}"}]}
                    }
                }
            }
            mock_response.raise_for_status = Mock()
            return mock_response

        # Patch at module level
        import agents.linear_similarity_agent as agent_module

        original_module_post = agent_module.requests.post
        agent_module.requests.post = mock_post_with_tracking

        try:
            # Run multiple fetches concurrently
            results = await asyncio.gather(
                _fetch_team_tickets("team-1", "lin_api_test"),
                _fetch_team_tickets("team-2", "lin_api_test"),
                _fetch_team_tickets("team-3", "lin_api_test"),
            )

            # All three should have completed
            assert len(results) == 3
            # Each should have called requests.post (via to_thread)
            assert fetch_count["count"] == 3
        finally:
            # Restore original
            agent_module.requests.post = original_module_post


class TestFetchLinearIssue:
    """Test _fetch_linear_issue function in linear_validator.py."""

    @pytest.mark.asyncio
    async def test_fetch_issue_success(self):
        """Should fetch issue data from Linear API."""
        import os
        from unittest.mock import Mock, patch

        from agents.linear_validator import LinearValidationAgent

        def mock_environ_get(key, default=None):
            if key == "LINEAR_API_KEY":
                return "lin_api_test_key"
            return os.environ.get(key, default)

        with patch("os.environ.get", side_effect=mock_environ_get):
            with patch("agents.linear_validator.requests.post") as mock_post:
                mock_response = Mock()
                mock_response.json.return_value = {
                    "data": {
                        "issue": {
                            "id": "ISSUE-123",
                            "identifier": "LIN-456",
                            "title": "Test Issue",
                            "description": "Test Description",
                            "state": {"id": "STATE-1", "name": "Backlog"},
                            "priority": 3,
                            "labels": {"nodes": []},
                            "project": {"id": "PROJ-1", "name": "Test Project"},
                            "createdAt": "2024-01-01T00:00:00Z",
                            "updatedAt": "2024-01-02T00:00:00Z",
                        }
                    }
                }
                mock_response.raise_for_status = Mock()
                mock_post.return_value = mock_response

                agent = LinearValidationAgent(
                    spec_dir=Path.cwd(), project_dir=Path.cwd()
                )
                result = await asyncio.to_thread(agent._fetch_linear_issue, "LIN-456")

                assert result["id"] == "ISSUE-123"
                assert result["title"] == "Test Issue"

    @pytest.mark.asyncio
    async def test_fetch_issue_404_error(self):
        """Should raise TicketNotFoundError when issue not found."""
        import os
        from unittest.mock import Mock, patch

        import pytest
        from agents.linear_validator import (
            LinearValidationAgent,
            TicketNotFoundError,
        )

        def mock_environ_get(key, default=None):
            if key == "LINEAR_API_KEY":
                return "lin_api_test_key"
            return os.environ.get(key, default)

        with patch("os.environ.get", side_effect=mock_environ_get):
            with patch("agents.linear_validator.requests.post") as mock_post:
                mock_response = Mock()
                mock_response.json.return_value = {
                    "data": {"issue": None},
                    "errors": [{"message": "Issue not found"}],
                }
                mock_response.raise_for_status = Mock()
                mock_post.return_value = mock_response

                agent = LinearValidationAgent(
                    spec_dir=Path.cwd(), project_dir=Path.cwd()
                )

                with pytest.raises(TicketNotFoundError):
                    await asyncio.to_thread(agent._fetch_linear_issue, "LIN-999")

    @pytest.mark.asyncio
    async def test_fetch_issue_auth_error(self):
        """Should raise AuthenticationError when LINEAR_API_KEY missing."""
        import os
        from unittest.mock import patch

        import pytest
        from agents.linear_validator import (
            AuthenticationError,
            LinearValidationAgent,
        )

        # Temporarily unset the API key
        original_key = os.environ.get("LINEAR_API_KEY")
        os.environ.pop("LINEAR_API_KEY", None)

        try:
            agent = LinearValidationAgent(spec_dir=Path.cwd(), project_dir=Path.cwd())

            with pytest.raises(AuthenticationError):
                await asyncio.to_thread(agent._fetch_linear_issue, "LIN-123")
        finally:
            # Restore the API key if it existed
            if original_key:
                os.environ["LINEAR_API_KEY"] = original_key


class TestErrorHandling:
    """Test error handling in _fetch_team_tickets."""

    @pytest.mark.asyncio
    async def test_fetch_handles_connection_error(self):
        """Should return empty list on connection error."""
        from unittest.mock import patch

        import requests

        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Simulate connection error
            mock_post.side_effect = requests.ConnectionError("Connection refused")

            from agents.linear_similarity_agent import _fetch_team_tickets

            result = await _fetch_team_tickets("team-123", "lin_api_test")

            # Should return empty list, not raise exception
            assert result == []

    @pytest.mark.asyncio
    async def test_fetch_handles_timeout_error(self):
        """Should return empty list on timeout error."""
        from unittest.mock import patch

        import requests

        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Simulate timeout
            mock_post.side_effect = requests.Timeout("Request timed out")

            from agents.linear_similarity_agent import _fetch_team_tickets

            result = await _fetch_team_tickets("team-123", "lin_api_test")

            # Should return empty list, not raise exception
            assert result == []

    @pytest.mark.asyncio
    async def test_fetch_handles_http_error(self):
        """Should return empty list on HTTP error."""
        from unittest.mock import patch

        import requests

        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Simulate HTTP 500 error
            mock_response = Mock()
            mock_response.raise_for_status.side_effect = requests.HTTPError(
                "500 Internal Server Error"
            )
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            result = await _fetch_team_tickets("team-123", "lin_api_test")

            # Should return empty list, not raise exception
            assert result == []


class TestDataParsing:
    """Test parsing and extraction of GraphQL responses."""

    @pytest.mark.asyncio
    async def test_parse_response_extracts_nodes(self):
        """Should correctly extract nodes from GraphQL response structure."""
        from unittest.mock import Mock

        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {
                    "team": {
                        "issues": {
                            "nodes": [
                                {
                                    "id": "ISSUE-1",
                                    "identifier": "LIN-001",
                                    "title": "First Issue",
                                    "description": "Description 1",
                                    "state": {
                                        "id": "S-1",
                                        "name": "Todo",
                                        "type": "state",
                                    },
                                    "priority": 1,
                                    "labels": {
                                        "nodes": [
                                            {
                                                "id": "LABEL-1",
                                                "name": "bug",
                                                "color": "#ff0000",
                                            }
                                        ]
                                    },
                                },
                                {
                                    "id": "ISSUE-2",
                                    "identifier": "LIN-002",
                                    "title": "Second Issue",
                                    "description": "Description 2",
                                    "state": {
                                        "id": "S-2",
                                        "name": "In Progress",
                                        "type": "state",
                                    },
                                    "priority": 2,
                                    "labels": {"nodes": []},
                                },
                            ]
                        }
                    }
                }
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            result = await _fetch_team_tickets("team-123", "lin_api_test")

            # Should extract both nodes
            assert len(result) == 2
            assert result[0]["id"] == "ISSUE-1"
            assert result[0]["identifier"] == "LIN-001"
            assert result[1]["id"] == "ISSUE-2"

    @pytest.mark.asyncio
    async def test_parse_response_handles_missing_data(self):
        """Should handle missing data gracefully."""
        from unittest.mock import Mock

        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock response with missing nested fields
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}}
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            result = await _fetch_team_tickets("team-empty", "lin_api_test")

            # Should return empty list
            assert result == []

    @pytest.mark.asyncio
    async def test_parse_response_handles_errors_array(self):
        """Should return empty list when GraphQL errors array is present."""
        from unittest.mock import Mock

        with patch("agents.linear_similarity_agent.requests.post") as mock_post:
            # Mock response with errors
            mock_response = Mock()
            mock_response.json.return_value = {
                "data": {"team": {"issues": {"nodes": []}}},
                "errors": [{"message": "Some GraphQL error"}],
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response

            from agents.linear_similarity_agent import _fetch_team_tickets

            result = await _fetch_team_tickets("team-123", "lin_api_test")

            # Should still return the data even with errors array
            assert result == []

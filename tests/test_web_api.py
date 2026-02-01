#!/usr/bin/env python3
"""
Tests for Web API (FastAPI)
============================

Tests the web API functionality including:
- Health checks
- Projects CRUD operations
- Settings management
- Task operations
- WebSocket connections
"""

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def test_client():
    """Create a test client for the FastAPI app."""
    # Mock environment to avoid loading production .env
    with patch.dict(os.environ, {}, clear=False):
        from apps.backend.web.main import app
        with TestClient(app) as client:
            yield client


@pytest.fixture
def mock_projects_file(tmp_path):
    """Create a temporary projects file for testing."""
    projects_file = tmp_path / "projects.json"
    projects_data = [
        {
            "id": "test-project-1",
            "name": "Test Project 1",
            "path": str(tmp_path / "project1"),
            "created_at": "2024-01-01T00:00:00",
            "specs_count": 5,
            "last_accessed": "2024-01-15T10:30:00"
        },
        {
            "id": "test-project-2",
            "name": "Test Project 2",
            "path": str(tmp_path / "project2"),
            "created_at": "2024-01-02T00:00:00",
            "specs_count": 3,
            "last_accessed": None
        }
    ]
    with open(projects_file, "w") as f:
        json.dump(projects_data, f)
    
    with patch("apps.backend.web.routers.projects.get_projects_file", return_value=projects_file):
        yield projects_file, projects_data


class TestHealthEndpoint:
    """Tests for health check endpoint."""

    def test_health_check_returns_200(self, test_client):
        """Health endpoint should return 200 OK."""
        response = test_client.get("/api/health")
        assert response.status_code == 200

    def test_health_check_response_format(self, test_client):
        """Health endpoint should return correct format."""
        response = test_client.get("/api/health")
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "auto-claude-api"


class TestConnectionManager:
    """Tests for WebSocket ConnectionManager."""

    def test_connection_manager_initialization(self):
        """ConnectionManager should initialize with empty connections."""
        from apps.backend.web.main import ConnectionManager
        
        manager = ConnectionManager()
        assert manager.active_connections == []

    @pytest.mark.asyncio
    async def test_connect_adds_websocket(self):
        """connect() should add websocket to active connections."""
        from apps.backend.web.main import ConnectionManager
        
        manager = ConnectionManager()
        mock_websocket = AsyncMock()
        
        await manager.connect(mock_websocket)
        
        assert mock_websocket in manager.active_connections
        mock_websocket.accept.assert_called_once()

    def test_disconnect_removes_websocket(self):
        """disconnect() should remove websocket from active connections."""
        from apps.backend.web.main import ConnectionManager
        
        manager = ConnectionManager()
        mock_websocket = MagicMock()
        manager.active_connections.append(mock_websocket)
        
        manager.disconnect(mock_websocket)
        
        assert mock_websocket not in manager.active_connections

    def test_disconnect_handles_missing_websocket(self):
        """disconnect() should handle websocket that's not in list."""
        from apps.backend.web.main import ConnectionManager
        
        manager = ConnectionManager()
        mock_websocket = MagicMock()
        
        # Should not raise error
        manager.disconnect(mock_websocket)
        assert mock_websocket not in manager.active_connections

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all_connections(self):
        """broadcast() should send message to all connected clients."""
        from apps.backend.web.main import ConnectionManager
        
        manager = ConnectionManager()
        mock_ws1 = AsyncMock()
        mock_ws2 = AsyncMock()
        manager.active_connections = [mock_ws1, mock_ws2]
        
        test_message = {"type": "test", "data": "hello"}
        await manager.broadcast(test_message)
        
        mock_ws1.send_json.assert_called_once_with(test_message)
        mock_ws2.send_json.assert_called_once_with(test_message)

    @pytest.mark.asyncio
    async def test_broadcast_handles_send_errors(self):
        """broadcast() should handle errors when sending to clients."""
        from apps.backend.web.main import ConnectionManager
        
        manager = ConnectionManager()
        mock_ws_good = AsyncMock()
        mock_ws_bad = AsyncMock()
        mock_ws_bad.send_json.side_effect = Exception("Connection closed")
        manager.active_connections = [mock_ws_good, mock_ws_bad]
        
        test_message = {"type": "test", "data": "hello"}
        
        # Should not raise error
        await manager.broadcast(test_message)
        
        # Good connection should still receive message
        mock_ws_good.send_json.assert_called_once_with(test_message)


class TestProjectsEndpoints:
    """Tests for projects router endpoints."""

    def test_list_projects_empty(self, test_client):
        """GET /api/projects should return empty list when no projects exist."""
        with patch("apps.backend.web.routers.projects.load_projects", return_value=[]):
            response = test_client.get("/api/projects")
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"] == []

    def test_list_projects_with_data(self, test_client, mock_projects_file):
        """GET /api/projects should return list of projects."""
        projects_file, projects_data = mock_projects_file
        
        response = test_client.get("/api/projects")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert isinstance(data["data"], list)
        assert len(data["data"]) == 2

    def test_create_project_validates_name(self, test_client):
        """POST /api/projects should validate project name."""
        with patch("apps.backend.web.routers.projects.save_projects"):
            response = test_client.post(
                "/api/projects",
                json={"name": "", "path": "/some/path"}
            )
            assert response.status_code == 422  # Validation error

    def test_create_project_validates_path(self, test_client):
        """POST /api/projects should validate project path."""
        with patch("apps.backend.web.routers.projects.save_projects"):
            response = test_client.post(
                "/api/projects",
                json={"name": "Test Project", "path": ""}
            )
            assert response.status_code == 422  # Validation error

    def test_delete_project_returns_404_for_missing(self, test_client):
        """DELETE /api/projects/{id} should return 404 for non-existent project."""
        with patch("apps.backend.web.routers.projects.load_projects", return_value=[]):
            response = test_client.delete("/api/projects/nonexistent-id")
            assert response.status_code == 404


class TestAPIConnectionTest:
    """Tests for /api/test-connection endpoint."""

    def test_test_connection_requires_base_url(self, test_client):
        """POST /api/test-connection should require baseUrl."""
        response = test_client.post(
            "/api/test-connection",
            json={"apiKey": "test-key"}
        )
        data = response.json()
        assert data["success"] is False
        assert "Missing" in data["error"]

    def test_test_connection_requires_api_key(self, test_client):
        """POST /api/test-connection should require apiKey."""
        response = test_client.post(
            "/api/test-connection",
            json={"baseUrl": "https://api.example.com"}
        )
        data = response.json()
        assert data["success"] is False
        assert "Missing" in data["error"]

    def test_test_connection_validates_url_format(self, test_client):
        """POST /api/test-connection should validate URL format."""
        response = test_client.post(
            "/api/test-connection",
            json={"baseUrl": "invalid-url", "apiKey": "test-key"}
        )
        data = response.json()
        assert data["success"] is False
        assert "http://" in data["error"] or "https://" in data["error"]

    @pytest.mark.asyncio
    async def test_test_connection_handles_timeout(self, test_client):
        """POST /api/test-connection should handle timeout errors."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get.side_effect = Exception("Timeout")
            
            response = test_client.post(
                "/api/test-connection",
                json={"baseUrl": "https://api.example.com", "apiKey": "test-key"}
            )
            data = response.json()
            assert data["success"] is False


class TestBrowseFolders:
    """Tests for /api/browse-folders endpoint."""

    def test_browse_folders_defaults_to_home(self, test_client):
        """GET /api/browse-folders should default to home directory."""
        response = test_client.get("/api/browse-folders")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "currentPath" in data["data"]
        assert str(Path.home()) == data["data"]["currentPath"]

    def test_browse_folders_with_path(self, test_client, tmp_path):
        """GET /api/browse-folders should browse specified path."""
        # Create test directory structure
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        (test_dir / "subdir1").mkdir()
        (test_dir / "subdir2").mkdir()
        
        response = test_client.get(f"/api/browse-folders?path={test_dir}")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]["entries"]) == 2

    def test_browse_folders_handles_nonexistent_path(self, test_client):
        """GET /api/browse-folders should handle non-existent paths."""
        response = test_client.get("/api/browse-folders?path=/nonexistent/path/xyz")
        data = response.json()
        assert data["success"] is False
        assert "does not exist" in data["error"]

    def test_browse_folders_filters_hidden_directories(self, test_client, tmp_path):
        """GET /api/browse-folders should not return hidden directories."""
        # Create test directories
        (tmp_path / "visible").mkdir()
        (tmp_path / ".hidden").mkdir()
        
        response = test_client.get(f"/api/browse-folders?path={tmp_path}")
        data = response.json()
        
        entry_names = [e["name"] for e in data["data"]["entries"]]
        assert "visible" in entry_names
        assert ".hidden" not in entry_names


class TestTabState:
    """Tests for tab state management endpoints."""

    def test_get_tab_state_initially_empty(self, test_client):
        """GET /api/tabs should return empty state initially."""
        response = test_client.get("/api/tabs")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # Initial state might be empty dict
        assert isinstance(data["data"], dict)

    def test_save_and_retrieve_tab_state(self, test_client):
        """PUT /api/tabs should save state and GET should retrieve it."""
        tab_state = {
            "activeTabId": "project-123",
            "tabs": [
                {"id": "project-123", "type": "project", "name": "My Project"}
            ]
        }
        
        # Save tab state
        save_response = test_client.put("/api/tabs", json=tab_state)
        assert save_response.status_code == 200
        assert save_response.json()["success"] is True
        
        # Retrieve tab state
        get_response = test_client.get("/api/tabs")
        assert get_response.status_code == 200
        data = get_response.json()
        assert data["success"] is True
        assert data["data"] == tab_state


class TestWebSocketEndpoint:
    """Tests for WebSocket endpoint."""

    def test_websocket_accepts_connection(self, test_client):
        """WebSocket endpoint should accept connections."""
        with test_client.websocket_connect("/ws") as websocket:
            # Connection successful if no exception
            assert websocket is not None

    def test_websocket_responds_to_ping(self, test_client):
        """WebSocket should respond to ping with pong."""
        with test_client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "ping"})
            response = websocket.receive_json()
            assert response["type"] == "pong"

    def test_websocket_handles_subscription(self, test_client):
        """WebSocket should handle subscription requests."""
        with test_client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "subscribe", "channel": "task_status"})
            response = websocket.receive_json()
            assert response["type"] == "subscribed"
            assert response["channel"] == "task_status"

    def test_websocket_handles_unknown_event(self, test_client):
        """WebSocket should return error for unknown event types."""
        with test_client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "unknown_event"})
            response = websocket.receive_json()
            assert response["type"] == "error"
            assert "Unknown event type" in response["message"]


class TestCORSMiddleware:
    """Tests for CORS middleware configuration."""

    def test_cors_allows_all_origins(self, test_client):
        """CORS should allow requests from any origin."""
        response = test_client.get(
            "/api/health",
            headers={"Origin": "https://example.com"}
        )
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers

    def test_cors_allows_all_methods(self, test_client):
        """CORS should allow all HTTP methods."""
        response = test_client.options(
            "/api/health",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "DELETE"
            }
        )
        assert "access-control-allow-methods" in response.headers


class TestRequestLogging:
    """Tests for request logging middleware."""

    def test_middleware_logs_incoming_requests(self, test_client, caplog):
        """Middleware should log incoming HTTP requests."""
        import logging
        
        with caplog.at_level(logging.INFO):
            test_client.get("/api/health")
            
            # Check that request was logged
            log_messages = [record.message for record in caplog.records]
            assert any("GET" in msg and "/api/health" in msg for msg in log_messages)

    def test_middleware_logs_response_status(self, test_client, caplog):
        """Middleware should log response status and duration."""
        import logging
        
        with caplog.at_level(logging.INFO):
            test_client.get("/api/health")
            
            # Check that response status was logged
            log_messages = [record.message for record in caplog.records]
            assert any("200" in msg for msg in log_messages)


class TestStaticFileServing:
    """Tests for static file serving (SPA mode)."""

    def test_api_routes_not_intercepted(self, test_client):
        """API routes should not be intercepted by SPA catchall."""
        # Non-existent API route should return 404
        response = test_client.get("/api/nonexistent")
        assert response.status_code == 404

    def test_spa_catchall_for_non_api_routes(self, test_client):
        """Non-API routes should serve SPA index.html if it exists."""
        # This test requires static files to be built
        # If static files don't exist, should return appropriate response
        response = test_client.get("/some-spa-route")
        # Should either serve index.html or return JSON message
        assert response.status_code in [200, 404]

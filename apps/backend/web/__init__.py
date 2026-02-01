"""
Auto Claude Web API
====================

FastAPI-based web server providing HTTP/WebSocket endpoints for the Auto-Claude
web frontend. This module exposes the backend functionality via RESTful APIs,
allowing remote clients to manage projects, tasks, and settings.

Endpoints:
- /api/health - Health check
- /api/projects - Project management
- /api/projects/{project_id}/tasks - Task management per project
- /api/tasks/{task_id} - Task details and control
- /api/settings - Application settings
- /ws - WebSocket for real-time updates
"""

from .main import app

__all__ = ["app"]

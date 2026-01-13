"""
Tests for Context Builder
=========================

Tests for context/builder.py which orchestrates context building for tasks,
including file discovery, keyword extraction, and pattern matching.
"""

import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock


class TestContextBuilder:
    """Tests for ContextBuilder class."""

    @pytest.fixture
    def project_with_services(self, temp_dir):
        """Create a project with service directories and code files."""
        # Create project structure
        backend_dir = temp_dir / "backend"
        backend_dir.mkdir()

        # Create backend files
        (backend_dir / "app").mkdir()
        (backend_dir / "app" / "__init__.py").write_text("# App module")
        (backend_dir / "app" / "auth.py").write_text(
            "def login(user, password):\n    '''Handle user login'''\n    pass\n"
        )
        (backend_dir / "app" / "users.py").write_text(
            "class User:\n    '''User model'''\n    def __init__(self, name):\n        self.name = name\n"
        )

        frontend_dir = temp_dir / "frontend"
        frontend_dir.mkdir()

        # Create frontend files
        (frontend_dir / "src").mkdir()
        (frontend_dir / "src" / "App.tsx").write_text(
            "export function App() {\n  return <div>Login Form</div>;\n}\n"
        )
        (frontend_dir / "src" / "Login.tsx").write_text(
            "export function Login() {\n  const handleLogin = () => {};\n  return <form>Login</form>;\n}\n"
        )

        # Create project index
        auto_claude_dir = temp_dir / ".auto-claude"
        auto_claude_dir.mkdir()
        project_index = {
            "project_type": "monorepo",
            "services": {
                "backend": {
                    "path": "backend",
                    "language": "python",
                    "framework": "flask",
                },
                "frontend": {
                    "path": "frontend",
                    "language": "typescript",
                    "framework": "react",
                },
            },
        }
        (auto_claude_dir / "project_index.json").write_text(json.dumps(project_index))

        return temp_dir

    def test_loads_project_index_from_file(self, project_with_services):
        """Should load project index from .auto-claude/project_index.json."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        assert builder.project_index["project_type"] == "monorepo"
        assert "backend" in builder.project_index["services"]
        assert "frontend" in builder.project_index["services"]

    def test_build_context_returns_task_context(self, project_with_services):
        """Should return TaskContext with relevant files."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            context = builder.build_context(
                task="Add user login functionality",
                services=["backend"],
            )

        assert context.task_description == "Add user login functionality"
        assert "backend" in context.scoped_services

    def test_auto_detects_services_from_task(self, project_with_services):
        """Should auto-detect relevant services when not specified."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        # Mock service matcher to return predictable results
        builder.service_matcher.suggest_services = MagicMock(
            return_value=["backend", "frontend"]
        )

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            context = builder.build_context(
                task="Add login form to frontend with backend API",
            )

        assert "backend" in context.scoped_services or "frontend" in context.scoped_services

    def test_extracts_keywords_from_task(self, project_with_services):
        """Should extract keywords when not provided."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        # Verify keyword extractor is called
        builder.keyword_extractor.extract_keywords = MagicMock(
            return_value=["login", "user", "authentication"]
        )

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            builder.build_context(
                task="Add user login with authentication",
                services=["backend"],
            )

        builder.keyword_extractor.extract_keywords.assert_called_once()

    def test_uses_provided_keywords(self, project_with_services):
        """Should use provided keywords instead of extracting."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)
        builder.keyword_extractor.extract_keywords = MagicMock()

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            builder.build_context(
                task="Add some feature",
                services=["backend"],
                keywords=["custom", "keywords"],
            )

        # Should not call keyword extractor when keywords provided
        builder.keyword_extractor.extract_keywords.assert_not_called()

    def test_finds_files_matching_keywords(self, project_with_services):
        """Should find files containing the search keywords."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            context = builder.build_context(
                task="Fix login bug",
                services=["backend"],
                keywords=["login"],
            )

        # Should find auth.py which contains 'login'
        all_files = context.files_to_modify + context.files_to_reference
        file_paths = [f["path"] if isinstance(f, dict) else f.path for f in all_files]
        assert any("auth" in path for path in file_paths)

    def test_includes_service_context(self, project_with_services):
        """Should include service context information."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            context = builder.build_context(
                task="Add feature",
                services=["backend"],
            )

        assert "backend" in context.service_contexts
        assert context.service_contexts["backend"]["source"] == "generated"
        assert context.service_contexts["backend"]["language"] == "python"

    def test_loads_service_context_from_file(self, project_with_services):
        """Should load SERVICE_CONTEXT.md when present."""
        from context.builder import ContextBuilder

        # Create SERVICE_CONTEXT.md
        backend_dir = project_with_services / "backend"
        (backend_dir / "SERVICE_CONTEXT.md").write_text("# Backend Service\n\nThis is the API service.")

        builder = ContextBuilder(project_with_services)

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            context = builder.build_context(
                task="Add feature",
                services=["backend"],
            )

        assert context.service_contexts["backend"]["source"] == "SERVICE_CONTEXT.md"
        assert "Backend Service" in context.service_contexts["backend"]["content"]

    def test_skips_nonexistent_services(self, project_with_services):
        """Should skip services that don't exist in project index."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            context = builder.build_context(
                task="Add feature",
                services=["nonexistent_service"],
            )

        # Should not crash, just return empty context
        assert context.files_to_modify == []
        assert "nonexistent_service" not in context.service_contexts

    @pytest.mark.asyncio
    async def test_build_context_async(self, project_with_services):
        """Should work with async version."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        with patch("context.builder.fetch_graph_hints", new_callable=AsyncMock, return_value=[]):
            context = await builder.build_context_async(
                task="Add user login",
                services=["backend"],
                include_graph_hints=False,
            )

        assert context.task_description == "Add user login"

    @pytest.mark.asyncio
    async def test_includes_graph_hints_when_enabled(self, project_with_services):
        """Should include graph hints from Graphiti when enabled."""
        from context.builder import ContextBuilder

        builder = ContextBuilder(project_with_services)

        mock_hints = [
            {"type": "pattern", "content": "Use JWT tokens for auth"},
        ]

        with patch("context.builder.is_graphiti_enabled", return_value=True):
            with patch("context.builder.fetch_graph_hints", new_callable=AsyncMock, return_value=mock_hints):
                context = await builder.build_context_async(
                    task="Add auth",
                    services=["backend"],
                    include_graph_hints=True,
                )

        assert len(context.graph_hints) == 1
        assert context.graph_hints[0]["type"] == "pattern"


class TestContextBuilderEdgeCases:
    """Edge case tests for ContextBuilder."""

    def test_handles_empty_project_index(self, temp_dir):
        """Should handle missing project index gracefully."""
        from context.builder import ContextBuilder

        # Create minimal project structure without index
        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "main.py").write_text("print('hello')")

        with patch("context.builder.ContextBuilder._load_project_index", return_value={}):
            builder = ContextBuilder(temp_dir)

        assert builder.project_index == {}

    def test_handles_service_with_no_files(self, temp_dir):
        """Should handle empty service directories."""
        from context.builder import ContextBuilder

        # Create empty service directory
        (temp_dir / "backend").mkdir()

        project_index = {
            "services": {
                "backend": {"path": "backend", "language": "python"},
            }
        }

        with patch("context.builder.is_graphiti_enabled", return_value=False):
            builder = ContextBuilder(temp_dir, project_index=project_index)
            context = builder.build_context(
                task="Add feature",
                services=["backend"],
            )

        assert context.files_to_modify == []
        assert context.files_to_reference == []

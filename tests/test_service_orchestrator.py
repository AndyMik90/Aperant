#!/usr/bin/env python3
"""
Tests for the service_orchestrator module.

Tests cover:
- Docker-compose detection
- Monorepo service discovery
- Service configuration
- Orchestration results
"""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

# Add auto-claude to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from services.orchestrator import (
    ServiceConfig,
    OrchestrationResult,
    ServiceOrchestrator,
    ServiceContext,
    is_multi_service_project,
    get_service_config,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


# =============================================================================
# DATA CLASS TESTS
# =============================================================================


class TestServiceConfig:
    """Tests for ServiceConfig dataclass."""

    def test_create_config(self):
        """Test creating a service config."""
        config = ServiceConfig(
            name="api",
            port=8000,
            type="docker",
            health_check_url="http://localhost:8000/health",
        )

        assert config.name == "api"
        assert config.port == 8000
        assert config.type == "docker"

    def test_config_defaults(self):
        """Test service config defaults."""
        config = ServiceConfig(name="worker")

        assert config.path is None
        assert config.port is None
        assert config.type == "docker"
        assert config.startup_timeout == 120


class TestOrchestrationResult:
    """Tests for OrchestrationResult dataclass."""

    def test_create_result(self):
        """Test creating an orchestration result."""
        result = OrchestrationResult()

        assert result.success is False
        assert result.services_started == []
        assert result.services_failed == []
        assert result.errors == []

    def test_result_with_data(self):
        """Test result with actual data."""
        result = OrchestrationResult(
            success=True,
            services_started=["api", "worker"],
            errors=[],
        )

        assert result.success is True
        assert len(result.services_started) == 2


# =============================================================================
# DOCKER-COMPOSE DETECTION
# =============================================================================


class TestDockerComposeDetection:
    """Tests for docker-compose file detection."""

    def test_detect_docker_compose_yml(self, temp_dir):
        """Test detecting docker-compose.yml."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("version: '3'\nservices:\n  api:\n    image: nginx\n")

        orchestrator = ServiceOrchestrator(temp_dir)

        assert orchestrator.has_docker_compose() is True

    def test_detect_docker_compose_yaml(self, temp_dir):
        """Test detecting docker-compose.yaml."""
        compose = temp_dir / "docker-compose.yaml"
        compose.write_text("version: '3'\nservices:\n  api:\n    image: nginx\n")

        orchestrator = ServiceOrchestrator(temp_dir)

        assert orchestrator.has_docker_compose() is True

    def test_detect_compose_yml(self, temp_dir):
        """Test detecting compose.yml (Docker Compose v2)."""
        compose = temp_dir / "compose.yml"
        compose.write_text("services:\n  api:\n    image: nginx\n")

        orchestrator = ServiceOrchestrator(temp_dir)

        assert orchestrator.has_docker_compose() is True

    def test_detect_dev_compose(self, temp_dir):
        """Test detecting docker-compose.dev.yml."""
        compose = temp_dir / "docker-compose.dev.yml"
        compose.write_text("services:\n  api:\n    image: nginx\n")

        orchestrator = ServiceOrchestrator(temp_dir)

        assert orchestrator.has_docker_compose() is True

    def test_no_compose_file(self, temp_dir):
        """Test when no compose file exists."""
        orchestrator = ServiceOrchestrator(temp_dir)

        assert orchestrator.has_docker_compose() is False


# =============================================================================
# SERVICE PARSING
# =============================================================================


class TestServiceParsing:
    """Tests for service parsing from docker-compose."""

    def test_parse_simple_services(self, temp_dir):
        """Test parsing simple service list."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("""
services:
  api:
    image: nginx
  worker:
    image: python
""")

        orchestrator = ServiceOrchestrator(temp_dir)
        services = orchestrator.get_services()

        service_names = [s.name for s in services]
        assert "api" in service_names
        assert "worker" in service_names

    def test_is_multi_service_with_compose(self, temp_dir):
        """Test multi-service detection with compose."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("""
services:
  api:
    image: nginx
  db:
    image: postgres
""")

        orchestrator = ServiceOrchestrator(temp_dir)

        assert orchestrator.is_multi_service() is True


# =============================================================================
# MONOREPO DETECTION
# =============================================================================


class TestMonorepoDetection:
    """Tests for monorepo service discovery."""

    def test_detect_services_directory(self, temp_dir):
        """Test detecting services in services/ directory."""
        services_dir = temp_dir / "services"
        services_dir.mkdir()

        # Create service directories
        api_service = services_dir / "api"
        api_service.mkdir()
        (api_service / "package.json").write_text("{}")

        worker_service = services_dir / "worker"
        worker_service.mkdir()
        (worker_service / "requirements.txt").write_text("celery")

        orchestrator = ServiceOrchestrator(temp_dir)
        services = orchestrator.get_services()

        service_names = [s.name for s in services]
        assert "api" in service_names
        assert "worker" in service_names

    def test_detect_packages_directory(self, temp_dir):
        """Test detecting services in packages/ directory."""
        packages_dir = temp_dir / "packages"
        packages_dir.mkdir()

        frontend = packages_dir / "frontend"
        frontend.mkdir()
        (frontend / "package.json").write_text("{}")

        orchestrator = ServiceOrchestrator(temp_dir)
        services = orchestrator.get_services()

        service_names = [s.name for s in services]
        assert "frontend" in service_names

    def test_detect_apps_directory(self, temp_dir):
        """Test detecting services in apps/ directory."""
        apps_dir = temp_dir / "apps"
        apps_dir.mkdir()

        web = apps_dir / "web"
        web.mkdir()
        (web / "package.json").write_text("{}")

        orchestrator = ServiceOrchestrator(temp_dir)
        services = orchestrator.get_services()

        service_names = [s.name for s in services]
        assert "web" in service_names

    def test_service_directory_indicators(self, temp_dir):
        """Test various service directory indicators."""
        services_dir = temp_dir / "services"
        services_dir.mkdir()

        # Test different indicators
        indicators = [
            ("node-app", "package.json"),
            ("python-app", "pyproject.toml"),
            ("go-app", "main.go"),
            ("rust-app", "Cargo.toml"),
            ("docker-app", "Dockerfile"),
        ]

        for dir_name, indicator in indicators:
            service_dir = services_dir / dir_name
            service_dir.mkdir()
            (service_dir / indicator).write_text("")

        orchestrator = ServiceOrchestrator(temp_dir)
        services = orchestrator.get_services()

        assert len(services) == len(indicators)

    def test_ignore_non_service_directories(self, temp_dir):
        """Test that non-service directories are ignored."""
        services_dir = temp_dir / "services"
        services_dir.mkdir()

        # Create a non-service directory (no indicators)
        empty_dir = services_dir / "empty"
        empty_dir.mkdir()

        # Create a service directory
        api_service = services_dir / "api"
        api_service.mkdir()
        (api_service / "package.json").write_text("{}")

        orchestrator = ServiceOrchestrator(temp_dir)
        services = orchestrator.get_services()

        service_names = [s.name for s in services]
        assert "api" in service_names
        assert "empty" not in service_names


# =============================================================================
# MULTI-SERVICE DETECTION
# =============================================================================


class TestMultiServiceDetection:
    """Tests for multi-service project detection."""

    def test_single_service_not_multi(self, temp_dir):
        """Test that single service is not multi-service."""
        (temp_dir / "package.json").write_text("{}")

        orchestrator = ServiceOrchestrator(temp_dir)

        assert orchestrator.is_multi_service() is False

    def test_compose_always_multi(self, temp_dir):
        """Test that docker-compose is always multi-service."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("services:\n  api:\n    image: nginx\n")

        orchestrator = ServiceOrchestrator(temp_dir)

        # Docker compose projects are considered multi-service
        assert orchestrator.is_multi_service() is True

    def test_multiple_services_is_multi(self, temp_dir):
        """Test that multiple services is multi-service."""
        services_dir = temp_dir / "services"
        services_dir.mkdir()

        for name in ["api", "worker"]:
            service_dir = services_dir / name
            service_dir.mkdir()
            (service_dir / "package.json").write_text("{}")

        orchestrator = ServiceOrchestrator(temp_dir)

        assert orchestrator.is_multi_service() is True


# =============================================================================
# SERIALIZATION
# =============================================================================


class TestSerialization:
    """Tests for configuration serialization."""

    def test_to_dict(self, temp_dir):
        """Test converting config to dictionary."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("services:\n  api:\n    image: nginx\n")

        orchestrator = ServiceOrchestrator(temp_dir)
        config = orchestrator.to_dict()

        assert isinstance(config, dict)
        assert "is_multi_service" in config
        assert "has_docker_compose" in config
        assert "services" in config

    def test_json_serializable(self, temp_dir):
        """Test that config is JSON serializable."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("services:\n  api:\n    image: nginx\n")

        orchestrator = ServiceOrchestrator(temp_dir)
        config = orchestrator.to_dict()

        # Should not raise
        json_str = json.dumps(config)
        assert isinstance(json_str, str)


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


class TestConvenienceFunctions:
    """Tests for convenience functions."""

    def test_is_multi_service_project(self, temp_dir):
        """Test is_multi_service_project function."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("services:\n  api:\n    image: nginx\n")

        result = is_multi_service_project(temp_dir)

        assert result is True

    def test_is_multi_service_project_false(self, temp_dir):
        """Test is_multi_service_project returns false."""
        (temp_dir / "package.json").write_text("{}")

        result = is_multi_service_project(temp_dir)

        assert result is False

    def test_get_service_config(self, temp_dir):
        """Test get_service_config function."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("services:\n  api:\n    image: nginx\n")

        config = get_service_config(temp_dir)

        assert isinstance(config, dict)
        assert config["has_docker_compose"] is True


# =============================================================================
# CONTEXT MANAGER
# =============================================================================


class TestServiceContext:
    """Tests for ServiceContext context manager."""

    def test_context_manager_no_services(self, temp_dir):
        """Test context manager with no services."""
        (temp_dir / "package.json").write_text("{}")

        with ServiceContext(temp_dir) as ctx:
            assert ctx.success is True  # No services to start

    def test_context_manager_attributes(self, temp_dir):
        """Test context manager attributes."""
        with ServiceContext(temp_dir) as ctx:
            assert hasattr(ctx, "orchestrator")
            assert hasattr(ctx, "success")


# =============================================================================
# EDGE CASES
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases."""

    def test_nonexistent_directory(self):
        """Test handling of non-existent directory."""
        fake_dir = Path("/tmp/test-nonexistent-orchestrator-123456")

        # Should not crash - mock exists to avoid permission error
        with patch.object(Path, 'exists', return_value=False):
            orchestrator = ServiceOrchestrator(fake_dir)
            assert orchestrator.is_multi_service() is False

    def test_empty_compose_file(self, temp_dir):
        """Test handling of empty compose file."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("")

        # Should not crash
        orchestrator = ServiceOrchestrator(temp_dir)
        assert orchestrator.has_docker_compose() is True

    def test_invalid_compose_yaml(self, temp_dir):
        """Test handling of invalid YAML in compose file."""
        compose = temp_dir / "docker-compose.yml"
        compose.write_text("invalid: yaml: [")

        # Should not crash
        orchestrator = ServiceOrchestrator(temp_dir)
        assert orchestrator.has_docker_compose() is True

    def test_service_path_tracking(self, temp_dir):
        """Test that service paths are tracked correctly."""
        services_dir = temp_dir / "services"
        services_dir.mkdir()

        api_service = services_dir / "api"
        api_service.mkdir()
        (api_service / "package.json").write_text("{}")

        orchestrator = ServiceOrchestrator(temp_dir)
        services = orchestrator.get_services()

        api = next((s for s in services if s.name == "api"), None)
        assert api is not None
        assert api.path == "services/api"
        assert api.type == "local"

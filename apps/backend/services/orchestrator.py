#!/usr/bin/env python3
"""
Service Orchestrator Module
===========================

Orchestrates multi-service environments for testing.
Handles docker-compose, monorepo service discovery, and health checks.

The service orchestrator is used by:
- QA Agent: To start services before integration/e2e tests
- Validation Strategy: To determine if multi-service orchestration is needed

Usage:
    from services.orchestrator import ServiceOrchestrator

    orchestrator = ServiceOrchestrator(project_dir)
    if orchestrator.is_multi_service():
        orchestrator.start_services()
        # run tests
        orchestrator.stop_services()
"""

import json
import shlex
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class ServiceConfig:
    """
    Configuration for a single service.

    Attributes:
        name: Name of the service
        path: Path to the service (relative to project root)
        port: Port the service runs on
        type: Type of service (docker, local, mock)
        health_check_url: URL for health check
        startup_command: Command to start the service
        startup_timeout: Timeout in seconds for startup
    """

    name: str
    path: str | None = None
    port: int | None = None
    type: str = "docker"  # docker, local, mock
    health_check_url: str | None = None
    startup_command: str | None = None
    startup_timeout: int = 120


@dataclass
class OrchestrationResult:
    """
    Result of service orchestration.

    Attributes:
        success: Whether all services started successfully
        services_started: List of services that were started
        services_failed: List of services that failed to start
        errors: List of error messages
    """

    success: bool = False
    services_started: list[str] = field(default_factory=list)
    services_failed: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


# =============================================================================
# SERVICE ORCHESTRATOR
# =============================================================================


class ServiceOrchestrator:
    """
    Orchestrates multi-service environments.

    Supports:
    - Docker Compose for containerized services
    - Monorepo service discovery
    - Health check waiting
    """

    def __init__(self, project_dir: Path) -> None:
        """
        Initialize the service orchestrator.

        Args:
            project_dir: Path to the project root
        """
        self.project_dir = Path(project_dir)
        self._compose_file: Path | None = None
        self._services: list[ServiceConfig] = []
        self._processes: dict[str, subprocess.Popen] = {}
        self._discover_services()

    def _discover_services(self) -> None:
        """Discover services in the project."""
        # Check for docker-compose
        self._compose_file = self._find_compose_file()

        if self._compose_file:
            self._parse_compose_services()
        else:
            # Check for monorepo structure
            self._discover_monorepo_services()

    def _find_compose_file(self) -> Path | None:
        """Find docker-compose configuration file."""
        candidates = [
            "docker-compose.yml",
            "docker-compose.yaml",
            "compose.yml",
            "compose.yaml",
            "docker-compose.dev.yml",
            "docker-compose.dev.yaml",
        ]

        for candidate in candidates:
            path = self.project_dir / candidate
            if path.exists():
                return path

        return None

    def _parse_compose_services(self) -> None:
        """Parse services from docker-compose file."""
        if not self._compose_file:
            return

        try:
            # Try to import yaml
            import yaml

            HAS_YAML = True
        except ImportError:
            HAS_YAML = False

        if not HAS_YAML:
            # Basic parsing without yaml module
            content = self._compose_file.read_text(encoding="utf-8")
            if "services:" in content:
                # Very basic service name extraction
                lines = content.split("\n")
                in_services = False
                for line in lines:
                    if line.strip() == "services:":
                        in_services = True
                        continue
                    if (
                        in_services
                        and line.startswith("  ")
                        and not line.startswith("    ")
                    ):
                        service_name = line.strip().rstrip(":")
                        if service_name:
                            self._services.append(ServiceConfig(name=service_name))
            return

        try:
            with open(self._compose_file, encoding="utf-8") as f:
                compose_data = yaml.safe_load(f)

            services = compose_data.get("services", {})
            for name, config in services.items():
                if not isinstance(config, dict):
                    continue

                # Extract port mapping
                ports = config.get("ports", [])
                port = None
                if ports:
                    try:
                        port_mapping = str(ports[0])
                        if ":" in port_mapping:
                            port = int(port_mapping.split(":")[0])
                    except (ValueError, IndexError):
                        # Skip malformed port mappings (e.g., environment variables)
                        port = None

                # Determine health check URL
                health_url = None
                if port:
                    health_url = f"http://localhost:{port}/health"

                self._services.append(
                    ServiceConfig(
                        name=name,
                        port=port,
                        type="docker",
                        health_check_url=health_url,
                    )
                )
        except Exception:
            pass

    def _discover_monorepo_services(self) -> None:
        """Discover services in a monorepo structure."""
        # Common monorepo patterns
        service_dirs = [
            "services",
            "packages",
            "apps",
            "microservices",
        ]

        for service_dir in service_dirs:
            dir_path = self.project_dir / service_dir
            if dir_path.exists() and dir_path.is_dir():
                for item in dir_path.iterdir():
                    if item.is_dir() and self._is_service_directory(item):
                        self._services.append(
                            ServiceConfig(
                                name=item.name,
                                path=item.relative_to(self.project_dir).as_posix(),
                                type="local",
                            )
                        )

    def _is_service_directory(self, path: Path) -> bool:
        """Check if a directory contains a service."""
        # Look for indicators of a service
        indicators = [
            "package.json",
            "pyproject.toml",
            "requirements.txt",
            "Dockerfile",
            "main.py",
            "app.py",
            "index.ts",
            "index.js",
            "main.go",
            "Cargo.toml",
        ]

        return any((path / indicator).exists() for indicator in indicators)

    def is_multi_service(self) -> bool:
        """
        Check if this is a multi-service project.

        Returns:
            True if multiple services are detected
        """
        return len(self._services) > 1 or self._compose_file is not None

    def has_docker_compose(self) -> bool:
        """
        Check if project has docker-compose configuration.

        Returns:
            True if docker-compose file exists
        """
        return self._compose_file is not None

    def get_services(self) -> list[ServiceConfig]:
        """
        Get list of discovered services.

        Returns:
            List of ServiceConfig objects
        """
        return self._services.copy()

    def start_services(self, timeout: int = 120) -> OrchestrationResult:
        """
        Start all services.

        Args:
            timeout: Timeout in seconds for all services to start

        Returns:
            OrchestrationResult with status
        """
        result = OrchestrationResult()

        if self._compose_file:
            return self._start_docker_compose(timeout)
        else:
            return self._start_local_services(timeout)

    def _start_docker_compose(self, timeout: int) -> OrchestrationResult:
        """Start services using docker-compose."""
        result = OrchestrationResult()

        try:
            # Check if docker-compose is available
            docker_cmd = self._get_docker_compose_cmd()
            if not docker_cmd:
                result.errors.append("docker-compose not found")
                return result

            # Start services
            cmd = docker_cmd + ["up", "-d"]

            proc = subprocess.run(
                cmd,
                cwd=self.project_dir,
                capture_output=True,
                text=True,
                timeout=timeout,
            )

            if proc.returncode != 0:
                result.errors.append(f"docker-compose up failed: {proc.stderr}")
                return result

            # Wait for health checks
            if self._wait_for_health(timeout):
                result.success = True
                result.services_started = [s.name for s in self._services]
            else:
                result.errors.append("Services did not become healthy in time")
                result.services_failed = [s.name for s in self._services]

        except subprocess.TimeoutExpired:
            result.errors.append("docker-compose startup timed out")
        except Exception as e:
            result.errors.append(f"Error starting services: {str(e)}")

        return result

    def _start_local_services(self, timeout: int) -> OrchestrationResult:
        """Start local services (non-docker)."""
        result = OrchestrationResult()

        for service in self._services:
            if service.startup_command:
                try:
                    # Use shlex.split() for safe parsing of shell-like syntax
                    # shell=False prevents shell injection vulnerabilities
                    proc = subprocess.Popen(
                        shlex.split(service.startup_command),
                        shell=False,
                        cwd=self.project_dir / service.path
                        if service.path
                        else self.project_dir,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                    )
                    self._processes[service.name] = proc
                    result.services_started.append(service.name)
                except Exception as e:
                    result.errors.append(f"Failed to start {service.name}: {str(e)}")
                    result.services_failed.append(service.name)

        # Wait for services to be ready
        if result.services_started:
            if self._wait_for_health(timeout):
                result.success = True
            else:
                result.errors.append("Services did not become healthy in time")

        return result

    def stop_services(self) -> None:
        """Stop all running services."""
        if self._compose_file:
            self._stop_docker_compose()
        else:
            self._stop_local_services()

    def _stop_docker_compose(self) -> None:
        """Stop services using docker-compose."""
        try:
            docker_cmd = self._get_docker_compose_cmd()
            if docker_cmd:
                subprocess.run(
                    docker_cmd + ["down"],
                    cwd=self.project_dir,
                    capture_output=True,
                    timeout=60,
                )
        except Exception:
            pass

    def _stop_local_services(self) -> None:
        """Stop local services."""
        for name, proc in self._processes.items():
            try:
                proc.terminate()
                proc.wait(timeout=10)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        self._processes.clear()

    def _get_docker_compose_cmd(self) -> list[str] | None:
        """Get the docker-compose command (v1 or v2)."""
        # Try docker compose v2 first
        try:
            proc = subprocess.run(
                ["docker", "compose", "version"],
                capture_output=True,
                timeout=5,
            )
            if proc.returncode == 0:
                return ["docker", "compose", "-f", str(self._compose_file)]
        except Exception:
            pass

        # Try docker-compose v1
        try:
            proc = subprocess.run(
                ["docker-compose", "version"],
                capture_output=True,
                timeout=5,
            )
            if proc.returncode == 0:
                return ["docker-compose", "-f", str(self._compose_file)]
        except Exception:
            pass

        return None

    def _wait_for_health(self, timeout: int) -> bool:
        """
        Wait for all services to become healthy.

        Args:
            timeout: Maximum time to wait in seconds

        Returns:
            True if all services became healthy
        """
        start_time = time.time()

        while time.time() - start_time < timeout:
            all_healthy = True

            for service in self._services:
                if service.port:
                    if not self._check_port(service.port):
                        all_healthy = False
                        break

            if all_healthy:
                return True

            time.sleep(2)

        return False

    def _check_port(self, port: int) -> bool:
        """Check if a port is responding."""
        import socket

        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                result = s.connect_ex(("localhost", port))
                return result == 0
        except Exception:
            return False

    def to_dict(self) -> dict[str, Any]:
        """Convert orchestration config to dictionary."""
        return {
            "is_multi_service": self.is_multi_service(),
            "has_docker_compose": self.has_docker_compose(),
            "compose_file": str(self._compose_file) if self._compose_file else None,
            "services": [
                {
                    "name": s.name,
                    "path": s.path,
                    "port": s.port,
                    "type": s.type,
                    "health_check_url": s.health_check_url,
                }
                for s in self._services
            ],
        }


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


def is_multi_service_project(project_dir: Path) -> bool:
    """
    Check if project is multi-service.

    Args:
        project_dir: Path to project root

    Returns:
        True if multi-service project
    """
    orchestrator = ServiceOrchestrator(project_dir)
    return orchestrator.is_multi_service()


def get_service_config(project_dir: Path) -> dict[str, Any]:
    """
    Get service configuration for project.

    Args:
        project_dir: Path to project root

    Returns:
        Dictionary with service configuration
    """
    orchestrator = ServiceOrchestrator(project_dir)
    return orchestrator.to_dict()


# =============================================================================
# CONTEXT MANAGER
# =============================================================================


class ServiceContext:
    """
    Context manager for service orchestration.

    Usage:
        with ServiceContext(project_dir) as services:
            # Services are running
            run_tests()
        # Services are stopped
    """

    def __init__(self, project_dir: Path, timeout: int = 120) -> None:
        """Initialize service context."""
        self.orchestrator = ServiceOrchestrator(project_dir)
        self.timeout = timeout
        self.result: OrchestrationResult | None = None

    def __enter__(self) -> "ServiceContext":
        """Start services on context entry."""
        if self.orchestrator.is_multi_service():
            self.result = self.orchestrator.start_services(self.timeout)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Stop services on context exit."""
        self.orchestrator.stop_services()

    @property
    def success(self) -> bool:
        """Check if services started successfully."""
        if self.result:
            return self.result.success
        return True  # No services to start


# =============================================================================
# CLI
# =============================================================================


def main() -> None:
    """CLI entry point for testing."""
    import argparse

    parser = argparse.ArgumentParser(description="Service orchestration")
    parser.add_argument("project_dir", type=Path, help="Path to project root")
    parser.add_argument("--start", action="store_true", help="Start services")
    parser.add_argument("--stop", action="store_true", help="Stop services")
    parser.add_argument("--status", action="store_true", help="Show service status")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    orchestrator = ServiceOrchestrator(args.project_dir)

    if args.start:
        result = orchestrator.start_services()
        if args.json:
            print(
                json.dumps(
                    {
                        "success": result.success,
                        "services_started": result.services_started,
                        "errors": result.errors,
                    },
                    indent=2,
                )
            )
        else:
            print(f"Started: {result.services_started}")
            if result.errors:
                print(f"Errors: {result.errors}")
    elif args.stop:
        orchestrator.stop_services()
        print("Services stopped")
    else:
        # Default: show status
        config = orchestrator.to_dict()

        if args.json:
            print(json.dumps(config, indent=2))
        else:
            print(f"Multi-service: {config['is_multi_service']}")
            print(f"Docker Compose: {config['has_docker_compose']}")
            if config["compose_file"]:
                print(f"Compose File: {config['compose_file']}")
            print(f"\nServices ({len(config['services'])}):")
            for service in config["services"]:
                port_info = f":{service['port']}" if service["port"] else ""
                print(f"  - {service['name']} ({service['type']}){port_info}")


if __name__ == "__main__":
    main()

"""
Service Analyzer Module
=======================

Main ServiceAnalyzer class that coordinates all analysis for a single service/package.
Integrates framework detection, route analysis, database models, and context extraction.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .base import BaseAnalyzer
from .context_analyzer import ContextAnalyzer
from .database_detector import DatabaseDetector
from .framework_analyzer import FrameworkAnalyzer
from .route_detector import RouteDetector


class ServiceAnalyzer(BaseAnalyzer):
    """Analyzes a single service/package within a project."""

    def __init__(self, service_path: Path, service_name: str):
        super().__init__(service_path)
        self.name = service_name
        self.analysis = {
            "name": service_name,
            "path": str(service_path),
            "language": None,
            "framework": None,
            "type": None,  # backend, frontend, worker, library, etc.
        }

    def analyze(self) -> dict[str, Any]:
        """Run full analysis on this service."""
        self._detect_language_and_framework()
        self._detect_service_type()
        self._find_key_directories()
        self._find_entry_points()
        self._detect_dependencies()
        self._detect_dependency_locations()
        self._detect_package_manager()
        self._detect_testing()
        self._find_dockerfile()

        # Comprehensive context extraction
        self._detect_environment_variables()
        self._detect_api_routes()
        self._detect_database_models()
        self._detect_external_services()
        self._detect_auth_patterns()
        self._detect_migrations()
        self._detect_background_jobs()
        self._detect_api_documentation()
        self._detect_monitoring()

        return self.analysis

    def _detect_language_and_framework(self) -> None:
        """Detect primary language and framework."""
        framework_analyzer = FrameworkAnalyzer(self.path, self.analysis)
        framework_analyzer.detect_language_and_framework()

    def _detect_service_type(self) -> None:
        """Infer service type from name and content if not already set."""
        if self.analysis.get("type"):
            return

        name_lower = self.name.lower()

        # Infer from name
        if any(kw in name_lower for kw in ["frontend", "client", "web", "ui", "app"]):
            self.analysis["type"] = "frontend"
        elif any(kw in name_lower for kw in ["backend", "api", "server", "service"]):
            self.analysis["type"] = "backend"
        elif any(
            kw in name_lower for kw in ["worker", "job", "queue", "task", "celery"]
        ):
            self.analysis["type"] = "worker"
        elif any(kw in name_lower for kw in ["scraper", "crawler", "spider"]):
            self.analysis["type"] = "scraper"
        elif any(kw in name_lower for kw in ["proxy", "gateway", "router"]):
            self.analysis["type"] = "proxy"
        elif any(
            kw in name_lower for kw in ["lib", "shared", "common", "core", "utils"]
        ):
            self.analysis["type"] = "library"
        else:
            # Try to infer from language and content if name doesn't match
            language = self.analysis.get("language")

            if language == "Python":
                # Check if it's a CLI tool, framework, or backend service
                has_run_py = (self.path / "run.py").exists()
                has_main_py = (self.path / "main.py").exists()
                has_main_module = (self.path / "__main__.py").exists()

                # Check for agent/automation framework patterns
                has_agent_files = any(
                    (self.path / f).exists()
                    for f in ["agent.py", "agents", "runner.py", "runners"]
                )

                if has_run_py or has_main_py or has_main_module or has_agent_files:
                    # It's a backend tool/framework/CLI
                    self.analysis["type"] = "backend"
                    return

            # Default to unknown if no clear indicators
            self.analysis["type"] = "unknown"

    def _find_key_directories(self) -> None:
        """Find important directories within this service."""
        key_dirs = {}

        # Common directory patterns
        patterns = {
            "src": "Source code",
            "lib": "Library code",
            "app": "Application code",
            "api": "API endpoints",
            "routes": "Route handlers",
            "controllers": "Controllers",
            "models": "Data models",
            "schemas": "Schemas/DTOs",
            "services": "Business logic",
            "components": "UI components",
            "pages": "Page components",
            "views": "Views/templates",
            "hooks": "Custom hooks",
            "utils": "Utilities",
            "helpers": "Helper functions",
            "middleware": "Middleware",
            "tests": "Tests",
            "test": "Tests",
            "__tests__": "Tests",
            "config": "Configuration",
            "tasks": "Background tasks",
            "jobs": "Background jobs",
            "workers": "Worker processes",
        }

        for dir_name, purpose in patterns.items():
            dir_path = self.path / dir_name
            if dir_path.exists() and dir_path.is_dir():
                key_dirs[dir_name] = {
                    "path": str(dir_path.relative_to(self.path)),
                    "purpose": purpose,
                }

        if key_dirs:
            self.analysis["key_directories"] = key_dirs

    def _find_entry_points(self) -> None:
        """Find main entry point files."""
        entry_patterns = [
            "main.py",
            "app.py",
            "__main__.py",
            "server.py",
            "wsgi.py",
            "asgi.py",
            "index.ts",
            "index.js",
            "main.ts",
            "main.js",
            "server.ts",
            "server.js",
            "app.ts",
            "app.js",
            "src/index.ts",
            "src/index.js",
            "src/main.ts",
            "src/app.ts",
            "src/server.ts",
            "src/App.tsx",
            "src/App.jsx",
            "pages/_app.tsx",
            "pages/_app.js",  # Next.js
            "main.go",
            "cmd/main.go",
            "src/main.rs",
            "src/lib.rs",
        ]

        for pattern in entry_patterns:
            if self._exists(pattern):
                self.analysis["entry_point"] = pattern
                break

    def _detect_dependencies(self) -> None:
        """Extract key dependencies."""
        if self._exists("package.json"):
            pkg = self._read_json("package.json")
            if pkg:
                deps = pkg.get("dependencies", {})
                dev_deps = pkg.get("devDependencies", {})
                self.analysis["dependencies"] = list(deps.keys())[:20]  # Top 20
                self.analysis["dev_dependencies"] = list(dev_deps.keys())[:10]

        elif self._exists("requirements.txt"):
            content = self._read_file("requirements.txt")
            deps = []
            for line in content.split("\n"):
                line = line.strip()
                if line and not line.startswith("#") and not line.startswith("-"):
                    match = re.match(r"^([a-zA-Z0-9_-]+)", line)
                    if match:
                        deps.append(match.group(1))
            self.analysis["dependencies"] = deps[:20]

    def _detect_dependency_locations(self) -> None:
        """Detect where dependencies live on disk for this service."""
        locations: list[dict[str, Any]] = []

        # Node.js: node_modules (only if package.json exists)
        if self._exists("package.json"):
            node_modules = self.path / "node_modules"
            locations.append(
                {
                    "type": "node_modules",
                    "path": "node_modules",
                    "exists": node_modules.exists() and node_modules.is_dir(),
                }
            )

        # Python: .venv or venv
        for venv_dir in [".venv", "venv"]:
            venv_path = self.path / venv_dir
            if venv_path.exists() and venv_path.is_dir():
                entry: dict[str, Any] = {
                    "type": "venv",
                    "path": venv_dir,
                    "exists": True,
                }
                # Find requirements file
                for req_file in ["requirements.txt", "pyproject.toml", "Pipfile"]:
                    if self._exists(req_file):
                        entry["requirements_file"] = req_file
                        break
                locations.append(entry)
                break
        else:
            # No venv found, still record requirements file if present
            for req_file in ["requirements.txt", "pyproject.toml", "Pipfile"]:
                if self._exists(req_file):
                    locations.append(
                        {
                            "type": "venv",
                            "path": ".venv",
                            "exists": False,
                            "requirements_file": req_file,
                        }
                    )
                    break

        # PHP: vendor
        vendor_path = self.path / "vendor"
        if vendor_path.exists() and vendor_path.is_dir():
            locations.append(
                {
                    "type": "vendor_php",
                    "path": "vendor",
                    "exists": True,
                }
            )

        # Rust: target
        target_path = self.path / "target"
        if target_path.exists() and target_path.is_dir():
            locations.append(
                {
                    "type": "cargo_target",
                    "path": "target",
                    "exists": True,
                }
            )

        # Ruby: vendor/bundle
        bundle_path = self.path / "vendor" / "bundle"
        if bundle_path.exists() and bundle_path.is_dir():
            locations.append(
                {
                    "type": "vendor_bundle",
                    "path": "vendor/bundle",
                    "exists": True,
                }
            )

        self.analysis["dependency_locations"] = locations

    def _detect_package_manager(self) -> None:
        """Detect the package manager used by this service."""
        # Node.js package managers
        if self._exists("package-lock.json"):
            self.analysis["package_manager"] = "npm"
        elif self._exists("yarn.lock"):
            self.analysis["package_manager"] = "yarn"
        elif self._exists("pnpm-lock.yaml"):
            self.analysis["package_manager"] = "pnpm"
        elif self._exists("bun.lockb") or self._exists("bun.lock"):
            self.analysis["package_manager"] = "bun"
        # Python package managers
        elif self._exists("Pipfile"):
            self.analysis["package_manager"] = "pipenv"
        elif self._exists("pyproject.toml"):
            if self._exists("uv.lock"):
                self.analysis["package_manager"] = "uv"
            elif self._exists("poetry.lock"):
                self.analysis["package_manager"] = "poetry"
            else:
                self.analysis["package_manager"] = "pip"
        elif self._exists("requirements.txt"):
            self.analysis["package_manager"] = "pip"
        # Other
        elif self._exists("Cargo.toml"):
            self.analysis["package_manager"] = "cargo"
        elif self._exists("go.mod"):
            self.analysis["package_manager"] = "go_mod"
        elif self._exists("Gemfile"):
            self.analysis["package_manager"] = "gem"
        elif self._exists("composer.json"):
            self.analysis["package_manager"] = "composer"
        else:
            self.analysis["package_manager"] = None

    def _detect_testing(self) -> None:
        """Detect testing framework and configuration."""
        if self._exists("package.json"):
            pkg = self._read_json("package.json")
            if pkg:
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                if "vitest" in deps:
                    self.analysis["testing"] = "Vitest"
                elif "jest" in deps:
                    self.analysis["testing"] = "Jest"
                if "@playwright/test" in deps:
                    self.analysis["e2e_testing"] = "Playwright"
                elif "cypress" in deps:
                    self.analysis["e2e_testing"] = "Cypress"

        elif self._exists("pytest.ini") or self._exists("pyproject.toml"):
            self.analysis["testing"] = "pytest"

        # Find test directory
        for test_dir in ["tests", "test", "__tests__", "spec"]:
            if self._exists(test_dir):
                self.analysis["test_directory"] = test_dir
                break

    def _find_dockerfile(self) -> None:
        """Find Dockerfile for this service."""
        dockerfile_patterns = [
            "Dockerfile",
            f"Dockerfile.{self.name}",
            f"docker/{self.name}.Dockerfile",
            f"docker/Dockerfile.{self.name}",
            "../docker/Dockerfile." + self.name,
        ]

        for pattern in dockerfile_patterns:
            if self._exists(pattern):
                self.analysis["dockerfile"] = pattern
                break

    def _detect_environment_variables(self) -> None:
        """Detect environment variables."""
        context = ContextAnalyzer(self.path, self.analysis)
        context.detect_environment_variables()

    def _detect_api_routes(self) -> None:
        """Detect API routes."""
        route_detector = RouteDetector(self.path)
        routes = route_detector.detect_all_routes()

        if routes:
            self.analysis["api"] = {
                "routes": routes,
                "total_routes": len(routes),
                "methods": list(
                    set(method for r in routes for method in r.get("methods", []))
                ),
                "protected_routes": [
                    r["path"] for r in routes if r.get("requires_auth")
                ],
            }

    def _detect_database_models(self) -> None:
        """Detect database models."""
        db_detector = DatabaseDetector(self.path)
        models = db_detector.detect_all_models()

        if models:
            self.analysis["database"] = {
                "models": models,
                "total_models": len(models),
                "model_names": list(models.keys()),
            }

    def _detect_external_services(self) -> None:
        """Detect external services."""
        context = ContextAnalyzer(self.path, self.analysis)
        context.detect_external_services()

    def _detect_auth_patterns(self) -> None:
        """Detect authentication patterns."""
        context = ContextAnalyzer(self.path, self.analysis)
        context.detect_auth_patterns()

    def _detect_migrations(self) -> None:
        """Detect database migrations."""
        context = ContextAnalyzer(self.path, self.analysis)
        context.detect_migrations()

    def _detect_background_jobs(self) -> None:
        """Detect background jobs."""
        context = ContextAnalyzer(self.path, self.analysis)
        context.detect_background_jobs()

    def _detect_api_documentation(self) -> None:
        """Detect API documentation."""
        context = ContextAnalyzer(self.path, self.analysis)
        context.detect_api_documentation()

    def _detect_monitoring(self) -> None:
        """Detect monitoring setup."""
        context = ContextAnalyzer(self.path, self.analysis)
        context.detect_monitoring()

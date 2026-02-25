"""
Project Analyzer Module
=======================

Analyzes entire projects, detecting monorepo structures, services, infrastructure, and conventions.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import SERVICE_INDICATORS, SERVICE_ROOT_FILES, SKIP_DIRS
from .service_analyzer import ServiceAnalyzer


class ProjectAnalyzer:
    """Analyzes an entire project, detecting monorepo structure and all services."""

    def __init__(self, project_dir: Path):
        self.project_dir = project_dir.resolve()
        self.index = {
            "project_root": str(self.project_dir),
            "project_type": "single",  # or "monorepo"
            "services": {},
            "infrastructure": {},
            "conventions": {},
        }

    def analyze(self) -> dict[str, Any]:
        """Run full project analysis."""
        self._detect_project_type()
        self._find_and_analyze_services()
        self._aggregate_dependency_locations()
        self._analyze_infrastructure()
        self._detect_conventions()
        self._map_dependencies()
        return self.index

    def _detect_project_type(self) -> None:
        """Detect if this is a monorepo or single project."""
        monorepo_indicators = [
            "pnpm-workspace.yaml",
            "lerna.json",
            "nx.json",
            "turbo.json",
            "rush.json",
        ]

        for indicator in monorepo_indicators:
            if (self.project_dir / indicator).exists():
                self.index["project_type"] = "monorepo"
                self.index["monorepo_tool"] = indicator.replace(".json", "").replace(
                    ".yaml", ""
                )
                return

        # Check for packages/apps directories
        if (self.project_dir / "packages").exists() or (
            self.project_dir / "apps"
        ).exists():
            self.index["project_type"] = "monorepo"
            return

        # Check for multiple service directories
        service_dirs_found = 0
        for item in self.project_dir.iterdir():
            if not item.is_dir():
                continue
            if item.name in SKIP_DIRS or item.name.startswith("."):
                continue

            # Check if this directory has service root files
            if any((item / f).exists() for f in SERVICE_ROOT_FILES):
                service_dirs_found += 1

        # If we have 2+ directories with service root files, it's likely a monorepo
        if service_dirs_found >= 2:
            self.index["project_type"] = "monorepo"

    def _find_and_analyze_services(self) -> None:
        """Find all services and analyze each."""
        services = {}

        if self.index["project_type"] == "monorepo":
            # Look for services in common locations
            service_locations = [
                self.project_dir,
                self.project_dir / "packages",
                self.project_dir / "apps",
                self.project_dir / "services",
            ]

            for location in service_locations:
                if not location.exists():
                    continue

                for item in location.iterdir():
                    if not item.is_dir():
                        continue
                    if item.name in SKIP_DIRS:
                        continue
                    if item.name.startswith("."):
                        continue

                    # Check if this looks like a service
                    has_root_file = any((item / f).exists() for f in SERVICE_ROOT_FILES)
                    is_service_name = item.name.lower() in SERVICE_INDICATORS

                    if has_root_file or (
                        location == self.project_dir and is_service_name
                    ):
                        analyzer = ServiceAnalyzer(item, item.name)
                        service_info = analyzer.analyze()
                        if service_info.get(
                            "language"
                        ):  # Only include if we detected something
                            services[item.name] = service_info
        else:
            # Single project - analyze root
            analyzer = ServiceAnalyzer(self.project_dir, "main")
            service_info = analyzer.analyze()
            if service_info.get("language"):
                services["main"] = service_info

        self.index["services"] = services

    def _aggregate_dependency_locations(self) -> None:
        """Aggregate dependency location metadata from all services.

        Collects dependency_locations from each service and stores them as
        paths relative to the project root (e.g., 'apps/backend/.venv'
        instead of just '.venv').
        """
        aggregated: list[dict[str, Any]] = []

        for service_name, service_info in self.index.get("services", {}).items():
            service_deps = service_info.get("dependency_locations", [])
            service_path = service_info.get("path", "")

            # Compute service-relative prefix once per service
            service_rel: Path | None = None
            if service_path:
                try:
                    service_rel = Path(service_path).relative_to(self.project_dir)
                except ValueError:
                    # Service path is outside the project root — skip its deps
                    # to avoid producing absolute paths that bypass containment
                    continue

            for dep in service_deps:
                dep_path = dep.get("path")
                if not dep_path:
                    continue

                # Build project-relative path from service path + dep path
                if service_rel is not None:
                    project_relative = str(service_rel / dep_path)
                else:
                    project_relative = dep_path

                entry: dict[str, Any] = {
                    "type": dep.get("type", "unknown"),
                    "path": project_relative,
                    "exists": dep.get("exists", False),
                    "service": service_name,
                }
                if dep.get("requirements_file"):
                    # Convert to project-relative path like we do for "path"
                    if service_rel is not None:
                        entry["requirements_file"] = str(
                            service_rel / dep["requirements_file"]
                        )
                    else:
                        entry["requirements_file"] = dep["requirements_file"]
                pkg_mgr = dep.get("package_manager") or service_info.get(
                    "package_manager"
                )
                if pkg_mgr:
                    entry["package_manager"] = pkg_mgr
                aggregated.append(entry)

        self.index["dependency_locations"] = aggregated

    def _analyze_infrastructure(self) -> None:
        """Analyze infrastructure configuration."""
        infra = {}

        # Docker
        if (self.project_dir / "docker-compose.yml").exists():
            infra["docker_compose"] = "docker-compose.yml"
            compose_content = self._read_file("docker-compose.yml")
            infra["docker_services"] = self._parse_compose_services(compose_content)
        elif (self.project_dir / "docker-compose.yaml").exists():
            infra["docker_compose"] = "docker-compose.yaml"
            compose_content = self._read_file("docker-compose.yaml")
            infra["docker_services"] = self._parse_compose_services(compose_content)

        if (self.project_dir / "Dockerfile").exists():
            infra["dockerfile"] = "Dockerfile"

        # Docker directory
        docker_dir = self.project_dir / "docker"
        if docker_dir.exists():
            dockerfiles = list(docker_dir.glob("Dockerfile*")) + list(
                docker_dir.glob("*.Dockerfile")
            )
            if dockerfiles:
                infra["docker_directory"] = "docker/"
                infra["dockerfiles"] = [
                    str(f.relative_to(self.project_dir)) for f in dockerfiles
                ]

        # CI/CD
        if (self.project_dir / ".github" / "workflows").exists():
            infra["ci"] = "GitHub Actions"
            workflows = list((self.project_dir / ".github" / "workflows").glob("*.yml"))
            infra["ci_workflows"] = [f.name for f in workflows]
        elif (self.project_dir / ".gitlab-ci.yml").exists():
            infra["ci"] = "GitLab CI"
        elif (self.project_dir / ".circleci").exists():
            infra["ci"] = "CircleCI"

        # Deployment
        deployment_files = {
            "vercel.json": "Vercel",
            "netlify.toml": "Netlify",
            "fly.toml": "Fly.io",
            "render.yaml": "Render",
            "railway.json": "Railway",
            "Procfile": "Heroku",
            "app.yaml": "Google App Engine",
            "serverless.yml": "Serverless Framework",
        }

        for file, platform in deployment_files.items():
            if (self.project_dir / file).exists():
                infra["deployment"] = platform
                break

        self.index["infrastructure"] = infra

    def _parse_compose_services(self, content: str) -> list[str]:
        """Extract service names from docker-compose content."""
        services = []
        in_services = False
        for line in content.split("\n"):
            if line.strip() == "services:":
                in_services = True
                continue
            if in_services:
                # Service names are at 2-space indent
                if (
                    line.startswith("  ")
                    and not line.startswith("    ")
                    and line.strip().endswith(":")
                ):
                    service_name = line.strip().rstrip(":")
                    services.append(service_name)
                elif line and not line.startswith(" "):
                    break  # End of services section
        return services

    def _detect_conventions(self) -> None:
        """Detect project-wide conventions."""
        conventions = {}

        # Python linting
        if (self.project_dir / "ruff.toml").exists() or self._has_in_pyproject("ruff"):
            conventions["python_linting"] = "Ruff"
        elif (self.project_dir / ".flake8").exists():
            conventions["python_linting"] = "Flake8"
        elif (self.project_dir / "pylintrc").exists():
            conventions["python_linting"] = "Pylint"

        # Python formatting
        if (self.project_dir / "pyproject.toml").exists():
            content = self._read_file("pyproject.toml")
            if "[tool.black]" in content:
                conventions["python_formatting"] = "Black"

        # JavaScript/TypeScript linting
        eslint_files = [
            ".eslintrc",
            ".eslintrc.js",
            ".eslintrc.json",
            ".eslintrc.yml",
            "eslint.config.js",
        ]
        if any((self.project_dir / f).exists() for f in eslint_files):
            conventions["js_linting"] = "ESLint"

        # Prettier
        prettier_files = [
            ".prettierrc",
            ".prettierrc.js",
            ".prettierrc.json",
            "prettier.config.js",
        ]
        if any((self.project_dir / f).exists() for f in prettier_files):
            conventions["formatting"] = "Prettier"

        # TypeScript
        if (self.project_dir / "tsconfig.json").exists():
            conventions["typescript"] = True

        # Git hooks
        if (self.project_dir / ".husky").exists():
            conventions["git_hooks"] = "Husky"
        elif (self.project_dir / ".pre-commit-config.yaml").exists():
            conventions["git_hooks"] = "pre-commit"

        self.index["conventions"] = conventions

    def _map_dependencies(self) -> None:
        """Map dependencies between services."""
        services = self.index.get("services", {})

        for service_name, service_info in services.items():
            consumes = []

            # Check for API client patterns
            if service_info.get("type") == "frontend":
                # Frontend typically consumes backend
                for other_name, other_info in services.items():
                    if other_info.get("type") == "backend":
                        consumes.append(f"{other_name}.api")

            # Check for shared libraries
            if service_info.get("dependencies"):
                deps = service_info["dependencies"]
                for other_name in services.keys():
                    if other_name in deps or f"@{other_name}" in str(deps):
                        consumes.append(other_name)

            if consumes:
                service_info["consumes"] = consumes

    def _has_in_pyproject(self, tool: str) -> bool:
        """Check if a tool is configured in pyproject.toml."""
        if (self.project_dir / "pyproject.toml").exists():
            content = self._read_file("pyproject.toml")
            return f"[tool.{tool}]" in content
        return False

    def _read_file(self, path: str) -> str:
        try:
            return (self.project_dir / path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return ""

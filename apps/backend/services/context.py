#!/usr/bin/env python3
"""
Service Context Generator
=========================

Generates SERVICE_CONTEXT.md files for services in a project.
These files help AI agents understand a service quickly without
analyzing the entire codebase.

Usage:
    # Generate for a specific service
    python auto-claude/service_context.py --service backend --output backend/SERVICE_CONTEXT.md

    # Generate for all services (using project index)
    python auto-claude/service_context.py --all

    # Generate with custom project index
    python auto-claude/service_context.py --service frontend --index auto-claude/project_index.json
"""

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ServiceContext:
    """Context information for a service."""

    name: str
    path: str
    service_type: str
    language: str
    framework: str
    entry_points: list[str] = field(default_factory=list)
    key_directories: dict[str, str] = field(default_factory=dict)
    dependencies: list[str] = field(default_factory=list)
    api_patterns: list[str] = field(default_factory=list)
    common_commands: dict[str, str] = field(default_factory=dict)
    environment_vars: list[str] = field(default_factory=list)
    ports: list[int] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class ServiceContextGenerator:
    """Generates SERVICE_CONTEXT.md files for services."""

    def __init__(self, project_dir: Path, project_index: dict | None = None):
        self.project_dir = project_dir.resolve()
        self.project_index = project_index or self._load_project_index()

    def _load_project_index(self) -> dict:
        """Load project index from file (.auto-claude is the installed instance)."""
        index_file = self.project_dir / ".auto-claude" / "project_index.json"
        if index_file.exists():
            with open(index_file, encoding="utf-8") as f:
                return json.load(f)
        return {"services": {}}

    def generate_for_service(self, service_name: str) -> ServiceContext:
        """Generate context for a specific service."""
        service_info = self.project_index.get("services", {}).get(service_name, {})

        if not service_info:
            raise ValueError(f"Service '{service_name}' not found in project index")

        service_path = Path(service_info.get("path", service_name))
        if not service_path.is_absolute():
            service_path = self.project_dir / service_path

        # Build context from project index + file discovery
        context = ServiceContext(
            name=service_name,
            path=str(service_path.relative_to(self.project_dir)),
            service_type=service_info.get("type", "unknown"),
            language=service_info.get("language", "unknown"),
            framework=service_info.get("framework", "unknown"),
        )

        # Extract entry points
        if service_info.get("entry_point"):
            context.entry_points.append(service_info["entry_point"])

        # Extract key directories
        context.key_directories = service_info.get("key_directories", {})

        # Extract ports
        if service_info.get("port"):
            context.ports.append(service_info["port"])

        # Discover additional context from files
        self._discover_entry_points(service_path, context)
        self._discover_dependencies(service_path, context)
        self._discover_api_patterns(service_path, context)
        self._discover_common_commands(service_path, context)
        self._discover_environment_vars(service_path, context)

        return context

    def _discover_entry_points(self, service_path: Path, context: ServiceContext):
        """Discover entry points by looking for common patterns."""
        entry_patterns = [
            "main.py",
            "app.py",
            "server.py",
            "index.py",
            "__main__.py",
            "main.ts",
            "index.ts",
            "server.ts",
            "app.ts",
            "main.js",
            "index.js",
            "server.js",
            "app.js",
            "main.go",
            "cmd/main.go",
            "src/main.rs",
            "src/lib.rs",
        ]

        for pattern in entry_patterns:
            entry_file = service_path / pattern
            if entry_file.exists():
                rel_path = str(entry_file.relative_to(service_path))
                if rel_path not in context.entry_points:
                    context.entry_points.append(rel_path)

    def _discover_dependencies(self, service_path: Path, context: ServiceContext):
        """Discover key dependencies from package files."""
        # Python
        requirements = service_path / "requirements.txt"
        if requirements.exists():
            try:
                content = requirements.read_text(encoding="utf-8")
                for line in content.split("\n")[:20]:  # Top 20 deps
                    line = line.strip()
                    if line and not line.startswith("#"):
                        # Extract package name (before ==, >=, etc.)
                        pkg = line.split("==")[0].split(">=")[0].split("[")[0].strip()
                        if pkg and pkg not in context.dependencies:
                            context.dependencies.append(pkg)
            except OSError:
                pass

        # Node.js
        package_json = service_path / "package.json"
        if package_json.exists():
            try:
                with open(package_json, encoding="utf-8") as f:
                    pkg = json.load(f)
                    deps = list(pkg.get("dependencies", {}).keys())[:15]
                    context.dependencies.extend(
                        [d for d in deps if d not in context.dependencies]
                    )
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                pass

    def _discover_api_patterns(self, service_path: Path, context: ServiceContext):
        """Discover API patterns (routes, endpoints)."""
        # Look for route definitions
        route_files = (
            list(service_path.glob("**/routes*.py"))
            + list(service_path.glob("**/router*.py"))
            + list(service_path.glob("**/routes*.ts"))
            + list(service_path.glob("**/router*.ts"))
            + list(service_path.glob("**/api/**/*.py"))
            + list(service_path.glob("**/api/**/*.ts"))
        )

        for route_file in route_files[:5]:  # Check first 5
            try:
                content = route_file.read_text(encoding="utf-8")
                # Look for common route patterns
                if "@app.route" in content or "@router." in content:
                    context.api_patterns.append(
                        f"Flask/FastAPI routes in {route_file.name}"
                    )
                elif "express.Router" in content or "app.get" in content:
                    context.api_patterns.append(f"Express routes in {route_file.name}")
            except (OSError, UnicodeDecodeError):
                pass

    def _discover_common_commands(self, service_path: Path, context: ServiceContext):
        """Discover common commands from package files and Makefiles."""
        # From package.json scripts
        package_json = service_path / "package.json"
        if package_json.exists():
            try:
                with open(package_json, encoding="utf-8") as f:
                    pkg = json.load(f)
                    scripts = pkg.get("scripts", {})
                    for name in ["dev", "start", "build", "test", "lint"]:
                        if name in scripts:
                            context.common_commands[name] = f"npm run {name}"
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                pass

        # From Makefile
        makefile = service_path / "Makefile"
        if makefile.exists():
            try:
                content = makefile.read_text(encoding="utf-8")
                for line in content.split("\n"):
                    if line and not line.startswith("\t") and ":" in line:
                        target = line.split(":")[0].strip()
                        if target in [
                            "dev",
                            "run",
                            "start",
                            "test",
                            "build",
                            "install",
                        ]:
                            context.common_commands[target] = f"make {target}"
            except OSError:
                pass

        # Infer from framework
        if context.framework == "flask":
            context.common_commands.setdefault("dev", "flask run")
        elif context.framework == "fastapi":
            context.common_commands.setdefault("dev", "uvicorn main:app --reload")
        elif context.framework == "django":
            context.common_commands.setdefault("dev", "python manage.py runserver")
        elif context.framework in ("next", "nextjs"):
            context.common_commands.setdefault("dev", "npm run dev")
        elif context.framework in ("react", "vite"):
            context.common_commands.setdefault("dev", "npm run dev")

    def _discover_environment_vars(self, service_path: Path, context: ServiceContext):
        """Discover environment variables from .env files."""
        env_files = [".env.example", ".env.sample", ".env.template", ".env"]

        for env_file in env_files:
            env_path = service_path / env_file
            if env_path.exists():
                try:
                    content = env_path.read_text(encoding="utf-8")
                    for line in content.split("\n"):
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            var_name = line.split("=")[0].strip()
                            if var_name and var_name not in context.environment_vars:
                                context.environment_vars.append(var_name)
                except OSError:
                    pass
                break  # Only use first found

    def generate_markdown(self, context: ServiceContext) -> str:
        """Generate SERVICE_CONTEXT.md content from context."""
        lines = [
            f"# {context.name.title()} Service Context",
            "",
            f"> Auto-generated context for AI agents working on the {context.name} service.",
            "",
            "## Overview",
            "",
            f"- **Type**: {context.service_type}",
            f"- **Language**: {context.language}",
            f"- **Framework**: {context.framework}",
            f"- **Path**: `{context.path}`",
        ]

        if context.ports:
            lines.append(f"- **Port(s)**: {', '.join(str(p) for p in context.ports)}")

        # Entry Points
        if context.entry_points:
            lines.extend(
                [
                    "",
                    "## Entry Points",
                    "",
                ]
            )
            for entry in context.entry_points:
                lines.append(f"- `{entry}`")

        # Key Directories
        if context.key_directories:
            lines.extend(
                [
                    "",
                    "## Key Directories",
                    "",
                    "| Directory | Purpose |",
                    "|-----------|---------|",
                ]
            )
            for dir_name, purpose in context.key_directories.items():
                lines.append(f"| `{dir_name}` | {purpose} |")

        # Dependencies
        if context.dependencies:
            lines.extend(
                [
                    "",
                    "## Key Dependencies",
                    "",
                ]
            )
            for dep in context.dependencies[:15]:  # Limit to 15
                lines.append(f"- {dep}")

        # API Patterns
        if context.api_patterns:
            lines.extend(
                [
                    "",
                    "## API Patterns",
                    "",
                ]
            )
            for pattern in context.api_patterns:
                lines.append(f"- {pattern}")

        # Common Commands
        if context.common_commands:
            lines.extend(
                [
                    "",
                    "## Common Commands",
                    "",
                    "```bash",
                ]
            )
            for name, cmd in context.common_commands.items():
                lines.append(f"# {name}")
                lines.append(cmd)
                lines.append("")
            lines.append("```")

        # Environment Variables
        if context.environment_vars:
            lines.extend(
                [
                    "",
                    "## Environment Variables",
                    "",
                ]
            )
            for var in context.environment_vars[:20]:  # Limit to 20
                lines.append(f"- `{var}`")

        # Notes
        if context.notes:
            lines.extend(
                [
                    "",
                    "## Notes",
                    "",
                ]
            )
            for note in context.notes:
                lines.append(f"- {note}")

        lines.extend(
            [
                "",
                "---",
                "",
                "*This file was auto-generated by the Auto-Build framework.*",
                "*Update manually if you need to add service-specific patterns or notes.*",
            ]
        )

        return "\n".join(lines)

    def generate_and_save(
        self,
        service_name: str,
        output_path: Path | None = None,
    ) -> Path:
        """Generate SERVICE_CONTEXT.md and save to file."""
        context = self.generate_for_service(service_name)
        markdown = self.generate_markdown(context)

        if output_path is None:
            service_path = self.project_dir / context.path
            output_path = service_path / "SERVICE_CONTEXT.md"

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding="utf-8")

        print(f"Generated SERVICE_CONTEXT.md for {service_name}: {output_path}")
        return output_path


def generate_all_contexts(project_dir: Path, project_index: dict | None = None):
    """Generate SERVICE_CONTEXT.md for all services in the project."""
    generator = ServiceContextGenerator(project_dir, project_index)

    services = generator.project_index.get("services", {})
    generated = []

    for service_name in services:
        try:
            path = generator.generate_and_save(service_name)
            generated.append((service_name, str(path)))
        except Exception as e:
            print(f"Failed to generate context for {service_name}: {e}")

    return generated


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate SERVICE_CONTEXT.md files for services"
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Project directory (default: current directory)",
    )
    parser.add_argument(
        "--service",
        type=str,
        default=None,
        help="Service name to generate context for",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output file path (default: [service]/SERVICE_CONTEXT.md)",
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=None,
        help="Path to project_index.json",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Generate for all services",
    )

    args = parser.parse_args()

    # Load project index if specified
    project_index = None
    if args.index and args.index.exists():
        with open(args.index, encoding="utf-8") as f:
            project_index = json.load(f)

    if args.all:
        generated = generate_all_contexts(args.project_dir, project_index)
        print(f"\nGenerated {len(generated)} SERVICE_CONTEXT.md files")
    elif args.service:
        generator = ServiceContextGenerator(args.project_dir, project_index)
        generator.generate_and_save(args.service, args.output)
    else:
        parser.print_help()
        print("\nError: Specify --service or --all")
        exit(1)


if __name__ == "__main__":
    main()

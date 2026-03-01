"""
Base Analyzer Module
====================

Provides common constants, utilities, and base functionality shared across all analyzers.
"""

from __future__ import annotations

import json
from pathlib import Path

# Directories to skip during analysis
SKIP_DIRS = {
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    ".env",
    "env",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "target",
    "vendor",
    ".idea",
    ".vscode",
    ".pytest_cache",
    ".mypy_cache",
    "coverage",
    ".coverage",
    "htmlcov",
    "eggs",
    "*.egg-info",
    ".turbo",
    ".cache",
    ".worktrees",  # Skip git worktrees directory
    ".auto-claude",  # Skip auto-claude metadata directory
}

# Common service directory names
SERVICE_INDICATORS = {
    "backend",
    "frontend",
    "api",
    "web",
    "app",
    "server",
    "client",
    "worker",
    "workers",
    "services",
    "packages",
    "apps",
    "libs",
    "scraper",
    "crawler",
    "proxy",
    "gateway",
    "admin",
    "dashboard",
    "mobile",
    "desktop",
    "cli",
    "sdk",
    "core",
    "shared",
    "common",
    "docs",
    "documentation",
    "microservices",
}

# Files that indicate a service root
SERVICE_ROOT_FILES = {
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "Gemfile",
    "composer.json",
    "pom.xml",
    "build.gradle",
    "Makefile",
    "Dockerfile",
    # Documentation tools
    "mkdocs.yml",
    "mkdocs.yaml",
    "docusaurus.config.js",
    "docusaurus.config.ts",
    "conf.py",
    "book.toml",
}

# Glob patterns that indicate a service root (for files with variable names)
SERVICE_ROOT_GLOBS = [
    "*.csproj",
    "*.fsproj",
    "*.sln",
]

# Deeper glob patterns for projects that nest manifests in subdirectories (e.g. .NET repos with src/)
SERVICE_ROOT_DEEP_GLOBS = [
    "src/**/*.csproj",
    "src/**/*.fsproj",
    "src/**/*.cs",  # Fallback: .cs source files without .csproj (incomplete repos)
]


def has_service_root(dir_path: Path) -> bool:
    """Check if a directory has service root indicators (exact files or glob patterns)."""
    if any((dir_path / f).exists() for f in SERVICE_ROOT_FILES):
        return True
    if any(
        next(dir_path.glob(pattern), None) is not None for pattern in SERVICE_ROOT_GLOBS
    ):
        return True
    # Check deeper patterns for .NET repos that keep .csproj in src/ subdirectories
    return any(
        next(dir_path.glob(pattern), None) is not None
        for pattern in SERVICE_ROOT_DEEP_GLOBS
    )


class BaseAnalyzer:
    """Base class with common utilities for all analyzers."""

    def __init__(self, path: Path):
        self.path = path.resolve()

    def _exists(self, path: str) -> bool:
        """Check if a file exists relative to the analyzer's path."""
        return (self.path / path).exists()

    def _read_file(self, path: str) -> str:
        """Read a file relative to the analyzer's path."""
        try:
            return (self.path / path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return ""

    def _read_json(self, path: str) -> dict | None:
        """Read and parse a JSON file relative to the analyzer's path."""
        content = self._read_file(path)
        if content:
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                return None
        return None

    def _infer_env_var_type(self, value: str) -> str:
        """Infer the type of an environment variable from its value."""
        if not value:
            return "string"

        # Boolean
        if value.lower() in ["true", "false", "1", "0", "yes", "no"]:
            return "boolean"

        # Number
        if value.isdigit():
            return "number"

        # URL
        if value.startswith(
            (
                "http://",
                "https://",
                "postgres://",
                "postgresql://",
                "mysql://",
                "mongodb://",
                "redis://",
            )
        ):
            return "url"

        # Email
        if "@" in value and "." in value:
            return "email"

        # Path
        if "/" in value or "\\" in value:
            return "path"

        return "string"

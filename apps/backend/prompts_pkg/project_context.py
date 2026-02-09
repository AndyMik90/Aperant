"""
Project Context Detection
=========================

Detects project capabilities from project_index.json to determine which
MCP tools and validation sections are relevant for the project.

This enables dynamic prompt assembly where QA agents only receive documentation
for tools relevant to their project type (Electron, Expo, Next.js, etc.),
saving context window and keeping agents focused.
"""

import json
from pathlib import Path


def load_project_index(project_dir: Path) -> dict:
    """
    Load project_index.json from the project's .ac.jerry directory.

    Args:
        project_dir: Root directory of the project

    Returns:
        Parsed project index dict, or empty dict if not found
    """
    index_file = project_dir / ".ac.jerry" / "project_index.json"
    if not index_file.exists():
        return {}

    try:
        with open(index_file, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def detect_project_capabilities(project_index: dict) -> dict:
    """
    Detect what MCP tools and validation types are relevant for this project.

    Analyzes the project_index.json to identify:
    - Desktop app frameworks (Electron, Tauri)
    - Mobile frameworks (Expo, React Native)
    - Web frontend frameworks (React, Vue, Next.js, etc.)
    - Backend capabilities (APIs, databases)

    Args:
        project_index: Parsed project_index.json dict

    Returns:
        Dictionary of capability flags:
        - is_electron: True if project uses Electron
        - is_tauri: True if project uses Tauri
        - is_expo: True if project uses Expo
        - is_react_native: True if project uses React Native
        - is_web_frontend: True if project has web frontend (React, Vue, etc.)
        - is_nextjs: True if project uses Next.js
        - is_nuxt: True if project uses Nuxt
        - has_api: True if project has API routes
        - has_database: True if project has database connections
    """
    capabilities = {
        # Desktop app frameworks
        "is_electron": False,
        "is_tauri": False,
        # Mobile frameworks
        "is_expo": False,
        "is_react_native": False,
        # Web frontend frameworks
        "is_web_frontend": False,
        "is_nextjs": False,
        "is_nuxt": False,
        # Backend capabilities
        "has_api": False,
        "has_database": False,
    }

    services = project_index.get("services", {})

    # Handle both dict format (services by name) and list format
    if isinstance(services, dict):
        service_list = services.values()
    elif isinstance(services, list):
        service_list = services
    else:
        service_list = []

    for service in service_list:
        if not isinstance(service, dict):
            continue

        # Collect all dependencies
        deps = set()
        for dep in service.get("dependencies", []):
            if isinstance(dep, str):
                deps.add(dep.lower())
        for dep in service.get("dev_dependencies", []):
            if isinstance(dep, str):
                deps.add(dep.lower())

        # Get framework (normalize to lowercase)
        framework = str(service.get("framework", "")).lower()

        # Desktop app detection
        if "electron" in deps or any("@electron" in d for d in deps):
            capabilities["is_electron"] = True
        if "@tauri-apps/api" in deps or "tauri" in deps:
            capabilities["is_tauri"] = True

        # Mobile framework detection
        if "expo" in deps:
            capabilities["is_expo"] = True
        if "react-native" in deps:
            capabilities["is_react_native"] = True

        # Web frontend detection
        web_frameworks = ("react", "vue", "svelte", "angular", "solid")
        if framework in web_frameworks:
            capabilities["is_web_frontend"] = True

        # Meta-framework detection
        if framework in ("nextjs", "next.js", "next"):
            capabilities["is_nextjs"] = True
            capabilities["is_web_frontend"] = True
        if framework in ("nuxt", "nuxt.js"):
            capabilities["is_nuxt"] = True
            capabilities["is_web_frontend"] = True

        # Also check deps for framework indicators
        if "next" in deps:
            capabilities["is_nextjs"] = True
            capabilities["is_web_frontend"] = True
        if "nuxt" in deps:
            capabilities["is_nuxt"] = True
            capabilities["is_web_frontend"] = True
        if "vite" in deps and not capabilities["is_electron"]:
            # Vite usually indicates web frontend (unless Electron)
            capabilities["is_web_frontend"] = True

        # API detection
        api_info = service.get("api", {})
        if isinstance(api_info, dict) and api_info.get("routes"):
            capabilities["has_api"] = True

        # Database detection
        if service.get("database"):
            capabilities["has_database"] = True
        # Also check for ORM/database deps
        db_deps = {
            "prisma",
            "drizzle-orm",
            "typeorm",
            "sequelize",
            "mongoose",
            "sqlalchemy",
            "alembic",
            "django",
            "peewee",
        }
        if deps & db_deps:
            capabilities["has_database"] = True

    return capabilities


def should_refresh_project_index(project_dir: Path) -> bool:
    """
    Check if project_index.json needs refresh based on dependency file changes.

    Uses smart caching: only refresh if dependency files (package.json,
    pyproject.toml, etc.) have been modified since the last index generation.

    Args:
        project_dir: Root directory of the project

    Returns:
        True if index should be regenerated, False if cache is still valid
    """
    index_file = project_dir / ".ac.jerry" / "project_index.json"

    if not index_file.exists():
        return True  # No index, must generate

    try:
        index_mtime = index_file.stat().st_mtime
    except OSError:
        return True  # Can't stat file, regenerate

    # Check all dependency files that could change frameworks
    dep_files = [
        project_dir / "package.json",
        project_dir / "pyproject.toml",
        project_dir / "requirements.txt",
        project_dir / "Gemfile",
        project_dir / "go.mod",
        project_dir / "Cargo.toml",
        project_dir / "composer.json",
    ]

    for dep_file in dep_files:
        try:
            dep_mtime = dep_file.stat().st_mtime
            if dep_mtime > index_mtime:
                return True  # Dependency file changed, refresh needed
        except (OSError, FileNotFoundError):
            continue  # Skip files we can't stat or don't exist

    # Also check subdirectories for monorepos (first level only)
    try:
        for subdir in project_dir.iterdir():
            if not subdir.is_dir():
                continue
            # Skip hidden dirs and common non-service dirs
            if subdir.name.startswith(".") or subdir.name in (
                "node_modules",
                "__pycache__",
                "dist",
                "build",
                ".git",
            ):
                continue

            subdir_pkg = subdir / "package.json"
            try:
                pkg_mtime = subdir_pkg.stat().st_mtime
                if pkg_mtime > index_mtime:
                    return True
            except (OSError, FileNotFoundError):
                continue

            subdir_pyproject = subdir / "pyproject.toml"
            try:
                pyproject_mtime = subdir_pyproject.stat().st_mtime
                if pyproject_mtime > index_mtime:
                    return True
            except (OSError, FileNotFoundError):
                continue
    except OSError:
        pass  # Can't iterate dir, use cached index

    return False  # Cache is fresh


def get_mcp_tools_for_project(capabilities: dict) -> list[str]:
    """
    Get list of MCP tool documentation files to include based on capabilities.

    Args:
        capabilities: Dict from detect_project_capabilities()

    Returns:
        List of prompt file paths (relative to prompts/) to include
    """
    tools = []

    # Desktop app validation
    if capabilities.get("is_electron"):
        tools.append("mcp_tools/electron_validation.md")
    if capabilities.get("is_tauri"):
        tools.append("mcp_tools/tauri_validation.md")

    # Web browser automation (for non-Electron web apps)
    if capabilities.get("is_web_frontend") and not capabilities.get("is_electron"):
        tools.append("mcp_tools/puppeteer_browser.md")

    # Database validation
    if capabilities.get("has_database"):
        tools.append("mcp_tools/database_validation.md")

    # API testing
    if capabilities.get("has_api"):
        tools.append("mcp_tools/api_validation.md")

    return tools

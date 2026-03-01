"""
Framework Analyzer Module
=========================

Detects programming languages, frameworks, and related technologies across different ecosystems.
Supports Python, Node.js/TypeScript, Go, Rust, Ruby, C#/.NET, and documentation tools.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import BaseAnalyzer


class FrameworkAnalyzer(BaseAnalyzer):
    """Analyzes and detects programming languages and frameworks."""

    def __init__(self, path: Path, analysis: dict[str, Any]):
        super().__init__(path)
        self.analysis = analysis

    def detect_language_and_framework(self) -> None:
        """Detect primary language and framework."""
        # Python detection
        if self._exists("requirements.txt"):
            self.analysis["language"] = "Python"
            self.analysis["package_manager"] = "pip"
            deps = self._read_file("requirements.txt")
            self._detect_python_framework(deps)

        elif self._exists("pyproject.toml"):
            self.analysis["language"] = "Python"
            content = self._read_file("pyproject.toml")
            if "[tool.poetry]" in content:
                self.analysis["package_manager"] = "poetry"
            elif "[tool.uv]" in content:
                self.analysis["package_manager"] = "uv"
            else:
                self.analysis["package_manager"] = "pip"
            self._detect_python_framework(content)

        elif self._exists("Pipfile"):
            self.analysis["language"] = "Python"
            self.analysis["package_manager"] = "pipenv"
            content = self._read_file("Pipfile")
            self._detect_python_framework(content)

        # Node.js/TypeScript detection
        elif self._exists("package.json"):
            pkg = self._read_json("package.json")
            if pkg:
                # Check if TypeScript
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                if "typescript" in deps:
                    self.analysis["language"] = "TypeScript"
                else:
                    self.analysis["language"] = "JavaScript"

                self.analysis["package_manager"] = self._detect_node_package_manager()
                self._detect_node_framework(pkg)

        # Go detection
        elif self._exists("go.mod"):
            self.analysis["language"] = "Go"
            self.analysis["package_manager"] = "go mod"
            content = self._read_file("go.mod")
            self._detect_go_framework(content)

        # Rust detection
        elif self._exists("Cargo.toml"):
            self.analysis["language"] = "Rust"
            self.analysis["package_manager"] = "cargo"
            content = self._read_file("Cargo.toml")
            self._detect_rust_framework(content)

        # Swift/iOS detection (check BEFORE Ruby - iOS projects often have Gemfile for CocoaPods/Fastlane)
        elif self._exists("Package.swift") or any(self.path.glob("*.xcodeproj")):
            self.analysis["language"] = "Swift"
            if self._exists("Package.swift"):
                self.analysis["package_manager"] = "Swift Package Manager"
            else:
                self.analysis["package_manager"] = "Xcode"
            self._detect_swift_framework()

        # Ruby detection
        elif self._exists("Gemfile"):
            self.analysis["language"] = "Ruby"
            self.analysis["package_manager"] = "bundler"
            content = self._read_file("Gemfile")
            self._detect_ruby_framework(content)

        # C#/.NET detection (check root and src/ subdirectories)
        elif (
            any(self.path.glob("*.csproj"))
            or any(self.path.glob("*.sln"))
            or any(self.path.glob("src/**/*.csproj"))
        ):
            self.analysis["language"] = "C#"
            self.analysis["package_manager"] = "NuGet"
            self._detect_dotnet_framework()

        # Documentation tool detection (standalone, no language-specific manifest)
        elif self._exists("mkdocs.yml") or self._exists("mkdocs.yaml"):
            self.analysis["language"] = "Python"
            self.analysis["framework"] = "MkDocs"
            self.analysis["type"] = "documentation"
            self.analysis["package_manager"] = "pip"
            self._detect_mkdocs_details()
        elif self._exists("book.toml"):
            self.analysis["language"] = "Rust"
            self.analysis["framework"] = "mdBook"
            self.analysis["type"] = "documentation"
            self.analysis["package_manager"] = "cargo"
        elif self._exists("conf.py"):
            content = self._read_file("conf.py")
            if "sphinx" in content.lower():
                self.analysis["language"] = "Python"
                self.analysis["framework"] = "Sphinx"
                self.analysis["type"] = "documentation"
                self.analysis["package_manager"] = "pip"

        # Fallback: detect C# by .cs source files even without .csproj/.sln
        # (handles repos where project files are missing or not yet committed)
        elif any(self.path.glob("src/**/*.cs")):
            self.analysis["language"] = "C#"
            self.analysis["package_manager"] = "NuGet"
            self._detect_dotnet_framework()

    def _detect_python_framework(self, content: str) -> None:
        """Detect Python framework."""
        from .port_detector import PortDetector

        content_lower = content.lower()

        # Web frameworks (with conventional defaults)
        frameworks = {
            "fastapi": {"name": "FastAPI", "type": "backend", "port": 8000},
            "flask": {"name": "Flask", "type": "backend", "port": 5000},
            "django": {"name": "Django", "type": "backend", "port": 8000},
            "starlette": {"name": "Starlette", "type": "backend", "port": 8000},
            "litestar": {"name": "Litestar", "type": "backend", "port": 8000},
        }

        for key, info in frameworks.items():
            if key in content_lower:
                self.analysis["framework"] = info["name"]
                self.analysis["type"] = info["type"]
                # Try to detect actual port, fall back to default
                port_detector = PortDetector(self.path, self.analysis)
                detected_port = port_detector.detect_port_from_sources(info["port"])
                self.analysis["default_port"] = detected_port
                break

        # Task queues
        if "celery" in content_lower:
            self.analysis["task_queue"] = "Celery"
            if not self.analysis.get("type"):
                self.analysis["type"] = "worker"
        elif "dramatiq" in content_lower:
            self.analysis["task_queue"] = "Dramatiq"
        elif "huey" in content_lower:
            self.analysis["task_queue"] = "Huey"

        # ORM
        if "sqlalchemy" in content_lower:
            self.analysis["orm"] = "SQLAlchemy"
        elif "tortoise" in content_lower:
            self.analysis["orm"] = "Tortoise ORM"
        elif "prisma" in content_lower:
            self.analysis["orm"] = "Prisma"

    def _detect_node_framework(self, pkg: dict) -> None:
        """Detect Node.js/TypeScript framework."""
        from .port_detector import PortDetector

        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        deps_lower = {k.lower(): k for k in deps.keys()}
        main_deps = pkg.get("dependencies", {})
        main_deps_lower = {k.lower(): k for k in main_deps.keys()}

        # Documentation frameworks (check before generic frontend)
        doc_frameworks = {
            "@docusaurus/core": {
                "name": "Docusaurus",
                "type": "documentation",
                "port": 3000,
            },
            "vitepress": {"name": "VitePress", "type": "documentation", "port": 5173},
            "vuepress": {"name": "VuePress", "type": "documentation", "port": 8080},
            "@vuepress/core": {
                "name": "VuePress",
                "type": "documentation",
                "port": 8080,
            },
            "nextra": {"name": "Nextra", "type": "documentation", "port": 3000},
        }

        # Storybook packages are typically devDependencies and should only be treated
        # as the primary framework when present in dependencies (not devDependencies).
        # Apps with Storybook in devDependencies alongside React/Angular/Vue should be
        # classified as frontend, not documentation.
        storybook_packages = {
            "storybook": {"name": "Storybook", "type": "documentation", "port": 6006},
            "@storybook/react": {
                "name": "Storybook",
                "type": "documentation",
                "port": 6006,
            },
            "@storybook/angular": {
                "name": "Storybook",
                "type": "documentation",
                "port": 6006,
            },
            "@storybook/vue3": {
                "name": "Storybook",
                "type": "documentation",
                "port": 6006,
            },
        }

        port_detector = PortDetector(self.path, self.analysis)

        for key, info in doc_frameworks.items():
            if key in deps_lower:
                self.analysis["framework"] = info["name"]
                self.analysis["type"] = info["type"]
                detected_port = port_detector.detect_port_from_sources(info["port"])
                self.analysis["default_port"] = detected_port
                return  # Documentation framework found, skip other detection

        # Only classify Storybook as primary framework if it's in main dependencies
        for key, info in storybook_packages.items():
            if key in main_deps_lower:
                self.analysis["framework"] = info["name"]
                self.analysis["type"] = info["type"]
                detected_port = port_detector.detect_port_from_sources(info["port"])
                self.analysis["default_port"] = detected_port
                return  # Storybook is the primary framework

        # Microfrontend detection (adds metadata, then falls through to frontend detection)
        mfe_indicators = {
            "@module-federation/enhanced": "Module Federation",
            "@module-federation/runtime": "Module Federation",
            "@angular-architects/module-federation": "Module Federation",
            "@angular-architects/native-federation": "Native Federation",
            "single-spa": "single-spa",
            "qiankun": "Qiankun",
        }
        for key, mfe_name in mfe_indicators.items():
            if key in deps_lower:
                self.analysis["microfrontend"] = mfe_name
                break
        # Also check webpack config for ModuleFederationPlugin
        if not self.analysis.get("microfrontend"):
            for config_file in ["webpack.config.js", "webpack.config.ts"]:
                if self._exists(config_file):
                    wpc = self._read_file(config_file)
                    if "ModuleFederationPlugin" in wpc or "moduleFederation" in wpc:
                        self.analysis["microfrontend"] = "Module Federation"
                        break

        # Frontend frameworks
        frontend_frameworks = {
            "next": {"name": "Next.js", "type": "frontend", "port": 3000},
            "nuxt": {"name": "Nuxt", "type": "frontend", "port": 3000},
            "react": {"name": "React", "type": "frontend", "port": 3000},
            "vue": {"name": "Vue", "type": "frontend", "port": 5173},
            "svelte": {"name": "Svelte", "type": "frontend", "port": 5173},
            "@sveltejs/kit": {"name": "SvelteKit", "type": "frontend", "port": 5173},
            "angular": {"name": "Angular", "type": "frontend", "port": 4200},
            "@angular/core": {"name": "Angular", "type": "frontend", "port": 4200},
            "solid-js": {"name": "SolidJS", "type": "frontend", "port": 3000},
            "astro": {"name": "Astro", "type": "frontend", "port": 4321},
        }

        # Backend frameworks
        backend_frameworks = {
            "express": {"name": "Express", "type": "backend", "port": 3000},
            "fastify": {"name": "Fastify", "type": "backend", "port": 3000},
            "koa": {"name": "Koa", "type": "backend", "port": 3000},
            "hono": {"name": "Hono", "type": "backend", "port": 3000},
            "elysia": {"name": "Elysia", "type": "backend", "port": 3000},
            "@nestjs/core": {"name": "NestJS", "type": "backend", "port": 3000},
        }

        port_detector = PortDetector(self.path, self.analysis)

        # Check frontend first (Next.js includes React, etc.)
        for key, info in frontend_frameworks.items():
            if key in deps_lower:
                self.analysis["framework"] = info["name"]
                self.analysis["type"] = info["type"]
                detected_port = port_detector.detect_port_from_sources(info["port"])
                self.analysis["default_port"] = detected_port
                break

        # If no frontend, check backend
        if not self.analysis.get("framework"):
            for key, info in backend_frameworks.items():
                if key in deps_lower:
                    self.analysis["framework"] = info["name"]
                    self.analysis["type"] = info["type"]
                    detected_port = port_detector.detect_port_from_sources(info["port"])
                    self.analysis["default_port"] = detected_port
                    break

        # Build tool
        if "vite" in deps_lower:
            self.analysis["build_tool"] = "Vite"
            if not self.analysis.get("default_port"):
                detected_port = port_detector.detect_port_from_sources(5173)
                self.analysis["default_port"] = detected_port
        elif "webpack" in deps_lower:
            self.analysis["build_tool"] = "Webpack"
        elif "esbuild" in deps_lower:
            self.analysis["build_tool"] = "esbuild"
        elif "turbopack" in deps_lower:
            self.analysis["build_tool"] = "Turbopack"

        # Styling
        if "tailwindcss" in deps_lower:
            self.analysis["styling"] = "Tailwind CSS"
        elif "styled-components" in deps_lower:
            self.analysis["styling"] = "styled-components"
        elif "@emotion/react" in deps_lower:
            self.analysis["styling"] = "Emotion"

        # State management
        if "zustand" in deps_lower:
            self.analysis["state_management"] = "Zustand"
        elif "@reduxjs/toolkit" in deps_lower or "redux" in deps_lower:
            self.analysis["state_management"] = "Redux"
        elif "jotai" in deps_lower:
            self.analysis["state_management"] = "Jotai"
        elif "pinia" in deps_lower:
            self.analysis["state_management"] = "Pinia"

        # Task queues
        if "bullmq" in deps_lower or "bull" in deps_lower:
            self.analysis["task_queue"] = "BullMQ"
            if not self.analysis.get("type"):
                self.analysis["type"] = "worker"

        # ORM
        if "@prisma/client" in deps_lower or "prisma" in deps_lower:
            self.analysis["orm"] = "Prisma"
        elif "typeorm" in deps_lower:
            self.analysis["orm"] = "TypeORM"
        elif "drizzle-orm" in deps_lower:
            self.analysis["orm"] = "Drizzle"
        elif "mongoose" in deps_lower:
            self.analysis["orm"] = "Mongoose"

        # Scripts
        scripts = pkg.get("scripts", {})
        pkg_mgr = self.analysis.get("package_manager", "npm")
        if "dev" in scripts:
            self.analysis["dev_command"] = f"{pkg_mgr} run dev"
        elif "start" in scripts:
            self.analysis["dev_command"] = f"{pkg_mgr} run start"

        # Capture available scripts for downstream consumers (QA agents, init.sh)
        if scripts:
            self.analysis["scripts"] = dict(scripts)

    def _detect_go_framework(self, content: str) -> None:
        """Detect Go framework."""
        from .port_detector import PortDetector

        frameworks = {
            "gin-gonic/gin": {"name": "Gin", "port": 8080},
            "labstack/echo": {"name": "Echo", "port": 8080},
            "gofiber/fiber": {"name": "Fiber", "port": 3000},
            "go-chi/chi": {"name": "Chi", "port": 8080},
        }

        for key, info in frameworks.items():
            if key in content:
                self.analysis["framework"] = info["name"]
                self.analysis["type"] = "backend"
                port_detector = PortDetector(self.path, self.analysis)
                detected_port = port_detector.detect_port_from_sources(info["port"])
                self.analysis["default_port"] = detected_port
                break

    def _detect_rust_framework(self, content: str) -> None:
        """Detect Rust framework."""
        from .port_detector import PortDetector

        frameworks = {
            "actix-web": {"name": "Actix Web", "port": 8080},
            "axum": {"name": "Axum", "port": 3000},
            "rocket": {"name": "Rocket", "port": 8000},
        }

        for key, info in frameworks.items():
            if key in content:
                self.analysis["framework"] = info["name"]
                self.analysis["type"] = "backend"
                port_detector = PortDetector(self.path, self.analysis)
                detected_port = port_detector.detect_port_from_sources(info["port"])
                self.analysis["default_port"] = detected_port
                break

    def _detect_ruby_framework(self, content: str) -> None:
        """Detect Ruby framework."""
        from .port_detector import PortDetector

        port_detector = PortDetector(self.path, self.analysis)

        if "rails" in content.lower():
            self.analysis["framework"] = "Ruby on Rails"
            self.analysis["type"] = "backend"
            detected_port = port_detector.detect_port_from_sources(3000)
            self.analysis["default_port"] = detected_port
        elif "sinatra" in content.lower():
            self.analysis["framework"] = "Sinatra"
            self.analysis["type"] = "backend"
            detected_port = port_detector.detect_port_from_sources(4567)
            self.analysis["default_port"] = detected_port

        if "sidekiq" in content.lower():
            self.analysis["task_queue"] = "Sidekiq"

    def _detect_swift_framework(self) -> None:
        """Detect Swift/iOS framework and dependencies."""
        try:
            # Scan Swift files for imports, excluding hidden/vendor dirs
            swift_files = []
            for swift_file in self.path.rglob("*.swift"):
                # Skip hidden directories, node_modules, .worktrees, etc.
                if any(
                    part.startswith(".") or part in ("node_modules", "Pods", "Carthage")
                    for part in swift_file.parts
                ):
                    continue
                swift_files.append(swift_file)
                if len(swift_files) >= 50:  # Limit for performance
                    break

            imports = set()
            for swift_file in swift_files:
                try:
                    content = swift_file.read_text(encoding="utf-8", errors="ignore")
                    for line in content.split("\n"):
                        line = line.strip()
                        if line.startswith("import "):
                            module = line.replace("import ", "").split()[0]
                            imports.add(module)
                except Exception:
                    continue  # Silently skip unparseable Swift files

            # Detect UI framework
            if "SwiftUI" in imports:
                self.analysis["framework"] = "SwiftUI"
                self.analysis["type"] = "mobile"
            elif "UIKit" in imports:
                self.analysis["framework"] = "UIKit"
                self.analysis["type"] = "mobile"
            elif "AppKit" in imports:
                self.analysis["framework"] = "AppKit"
                self.analysis["type"] = "desktop"

            # Detect iOS/Apple frameworks
            apple_frameworks = []
            framework_map = {
                "Combine": "Combine",
                "CoreData": "CoreData",
                "MapKit": "MapKit",
                "WidgetKit": "WidgetKit",
                "CoreLocation": "CoreLocation",
                "StoreKit": "StoreKit",
                "CloudKit": "CloudKit",
                "ActivityKit": "ActivityKit",
                "UserNotifications": "UserNotifications",
            }
            for key, name in framework_map.items():
                if key in imports:
                    apple_frameworks.append(name)

            if apple_frameworks:
                self.analysis["apple_frameworks"] = apple_frameworks

            # Detect SPM dependencies from Package.swift or xcodeproj
            dependencies = self._detect_spm_dependencies()
            if dependencies:
                self.analysis["spm_dependencies"] = dependencies
        except Exception:
            # Silently fail if Swift detection has issues
            pass

    def _detect_spm_dependencies(self) -> list[str]:
        """Detect Swift Package Manager dependencies."""
        dependencies = []

        # Try Package.swift first
        if self._exists("Package.swift"):
            content = self._read_file("Package.swift")
            # Look for .package(url: "...", patterns
            import re

            urls = re.findall(r'\.package\s*\([^)]*url:\s*"([^"]+)"', content)
            for url in urls:
                # Extract package name from URL
                name = url.rstrip("/").split("/")[-1].replace(".git", "")
                if name:
                    dependencies.append(name)

        # Also check xcodeproj for XCRemoteSwiftPackageReference
        for xcodeproj in self.path.glob("*.xcodeproj"):
            pbxproj = xcodeproj / "project.pbxproj"
            if pbxproj.exists():
                try:
                    content = pbxproj.read_text(encoding="utf-8", errors="ignore")
                    import re

                    # Match repositoryURL patterns
                    urls = re.findall(r'repositoryURL\s*=\s*"([^"]+)"', content)
                    for url in urls:
                        name = url.rstrip("/").split("/")[-1].replace(".git", "")
                        if name and name not in dependencies:
                            dependencies.append(name)
                except Exception:
                    continue  # Silently skip unparseable .pbxproj files

        return dependencies

    def _detect_node_package_manager(self) -> str:
        """Detect Node.js package manager."""
        if self._exists("pnpm-lock.yaml"):
            return "pnpm"
        elif self._exists("yarn.lock"):
            return "yarn"
        elif self._exists("bun.lockb") or self._exists("bun.lock"):
            return "bun"
        return "npm"

    def _detect_dotnet_framework(self) -> None:
        """Detect .NET framework from .csproj/.sln files.

        Handles two cases:
        1. .NET Solution (Clean Architecture): .sln + src/ with sub-projects
           → Treated as a SINGLE service with aggregated analysis
        2. Single .csproj project → Standard single-project detection
        """

        from .port_detector import PortDetector

        # ---- .NET Solution detection ----
        # Parse the .sln file directly to discover all projects in the solution.
        # A solution with 2+ projects is treated as a single service (not a monorepo).
        sln_files = list(self.path.glob("*.sln"))

        if sln_files:
            best_solution = None
            best_size = -1
            for sln_path in sorted(sln_files):
                candidate = self._map_dotnet_solution(sln_path)
                if candidate:
                    size = len(candidate.get("entry_points", [])) + len(
                        candidate.get("libraries", [])
                    )
                    if size > best_size:
                        best_solution = candidate
                        best_size = size
            if best_solution and (
                best_solution["entry_points"] or best_solution["libraries"]
            ):
                self.analysis["dotnet_solution"] = best_solution
                self._apply_dotnet_solution_framework(best_solution)
                return

        # ---- Single .csproj detection ----
        csproj_files = list(self.path.glob("*.csproj"))
        if not csproj_files:
            csproj_files = list(self.path.glob("**/*.csproj"))[:5]

        if not csproj_files:
            return

        all_packages: set[str] = set()
        sdk_types: list[str] = []
        has_azure_functions_version = False

        for csproj in csproj_files[:3]:
            info = self._parse_csproj_info(csproj)
            all_packages.update(info.get("packages", set()))
            if info.get("sdk"):
                sdk_types.append(info["sdk"])
            if info.get("is_azure_functions"):
                has_azure_functions_version = True

        # Pick the most specific SDK type: prefer specialized SDKs over the generic one.
        # E.g., Microsoft.NET.Sdk.Web is more specific than Microsoft.NET.Sdk.
        sdk_type = ""
        sdk_priority = [
            "Microsoft.NET.Sdk.BlazorWebAssembly",
            "Microsoft.NET.Sdk.Web",
            "Microsoft.NET.Sdk.Worker",
            "Microsoft.NET.Sdk.WindowsDesktop",
            "Microsoft.NET.Sdk.Maui",
        ]
        for preferred in sdk_priority:
            if preferred in sdk_types:
                sdk_type = preferred
                break
        if not sdk_type and sdk_types:
            sdk_type = sdk_types[0]

        port_detector = PortDetector(self.path, self.analysis)

        # Azure Functions (check before ASP.NET Core — AF projects may reference AspNetCore)
        is_azure_functions = has_azure_functions_version or any(
            "microsoft.azure.functions.worker" in p for p in all_packages
        )
        if is_azure_functions:
            self.analysis["framework"] = "Azure Functions"
            self.analysis["type"] = "worker"
            self.analysis["default_port"] = port_detector.detect_port_from_sources(7071)
            if any("durabletask" in p for p in all_packages):
                self.analysis["durable_functions"] = True

        # ASP.NET Core Web API
        elif sdk_type == "Microsoft.NET.Sdk.Web" or any(
            p.startswith("microsoft.aspnetcore") for p in all_packages
        ):
            if (
                any("blazor" in p for p in all_packages)
                or sdk_type == "Microsoft.NET.Sdk.BlazorWebAssembly"
            ):
                self.analysis["framework"] = "Blazor"
                self.analysis["type"] = "frontend"
                self.analysis["default_port"] = port_detector.detect_port_from_sources(
                    5000
                )
            else:
                self.analysis["framework"] = "ASP.NET Core"
                self.analysis["type"] = "backend"
                self.analysis["default_port"] = port_detector.detect_port_from_sources(
                    5000
                )

            if any("microsoft.aspnetcore.openapi" in p for p in all_packages) or any(
                "swashbuckle" in p for p in all_packages
            ):
                self.analysis["api_docs"] = "Swagger/OpenAPI"

        # WPF
        elif sdk_type == "Microsoft.NET.Sdk.WindowsDesktop" or any(
            "wpf" in p for p in all_packages
        ):
            self.analysis["framework"] = "WPF"
            self.analysis["type"] = "desktop"

        # MAUI
        elif (
            any("microsoft.maui" in p for p in all_packages)
            or sdk_type == "Microsoft.NET.Sdk.Maui"
        ):
            self.analysis["framework"] = "MAUI"
            self.analysis["type"] = "mobile"

        # Worker Service
        elif sdk_type == "Microsoft.NET.Sdk.Worker" or any(
            "microsoft.extensions.hosting" in p for p in all_packages
        ):
            self.analysis["framework"] = ".NET Worker"
            self.analysis["type"] = "worker"

        # gRPC
        elif any("grpc" in p for p in all_packages):
            self.analysis["framework"] = "gRPC .NET"
            self.analysis["type"] = "backend"
            self.analysis["default_port"] = port_detector.detect_port_from_sources(5000)

        # Generic .NET (library or console)
        else:
            self.analysis["framework"] = ".NET"
            if not self.analysis.get("type"):
                self.analysis["type"] = "backend"

        self._apply_dotnet_metadata(all_packages)

    # .sln GUIDs
    _SLN_FOLDER_GUID = "2150E333-8FDC-42A3-9474-1A3956D46DE8"

    def _map_dotnet_solution(self, sln_path: Path) -> dict | None:
        """Map a .NET solution by parsing the .sln file.

        The .sln file lists every project with its name, relative path to .csproj,
        and a type GUID. Solution Folders (virtual grouping) are skipped.
        Each real project's .csproj is then parsed to classify it as:
        - API entry point (Microsoft.NET.Sdk.Web)
        - Worker entry point (Azure Functions / Microsoft.NET.Sdk.Worker)
        - Test project (path contains 'tests' or 'test')
        - Library (everything else, classified by name)
        """
        import re

        try:
            sln_content = sln_path.read_text(encoding="utf-8", errors="ignore")
        except (OSError, UnicodeDecodeError):
            return None

        # Parse Project entries from .sln
        # Format: Project("{TYPE_GUID}") = "Name", "path\to\project.csproj", "{PROJ_GUID}"
        project_pattern = re.compile(
            r'Project\("\{([^}]+)\}"\)\s*=\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"\{[^}]+\}"'
        )

        entry_points: list[dict] = []
        libraries: list[dict] = []
        test_projects: list[dict] = []
        all_packages: set[str] = set()
        projects: dict[str, dict] = {}
        dependency_graph: dict[str, list[str]] = {}

        for match in project_pattern.finditer(sln_content):
            type_guid = match.group(1).upper()
            project_name = match.group(2)
            project_rel_path = match.group(3).replace(
                "\\", "/"
            )  # Normalize to Unix paths

            # Skip Solution Folders (virtual grouping, no actual project)
            if type_guid == self._SLN_FOLDER_GUID:
                continue

            # Resolve absolute path to .csproj
            csproj_path = self.path / project_rel_path
            if not csproj_path.exists():
                continue

            # Get the project directory path relative to solution root
            project_dir = str(csproj_path.parent.relative_to(self.path))

            # Parse .csproj to determine type
            info = self._parse_csproj_info(csproj_path)
            packages = info.pop("packages", set())
            project_references = info.get("project_references", [])
            all_packages.update(packages)

            sdk = info.get("sdk", "")
            is_test = "test" in project_dir.lower()

            entry = {
                "name": project_name,
                "path": project_dir,
            }

            is_entry_point = False

            if is_test:
                role = "test"
                test_projects.append(entry)
            elif sdk == "Microsoft.NET.Sdk.Web":
                role = "api"
                is_entry_point = True
                entry["type"] = "api"
                entry_points.append(entry)
            elif info.get("is_azure_functions"):
                role = "worker"
                is_entry_point = True
                entry["type"] = "worker"
                entry["framework"] = "Azure Functions"
                entry_points.append(entry)
            elif sdk == "Microsoft.NET.Sdk.Worker":
                role = "worker"
                is_entry_point = True
                entry["type"] = "worker"
                entry["framework"] = ".NET Worker"
                entry_points.append(entry)
            elif info.get("output_type", "").lower() == "exe":
                role = "tool"
                is_entry_point = True
                entry["type"] = "tool"
                entry_points.append(entry)
            else:
                # Library — classify by name
                name_lower = project_name.lower()
                if "gateway" in name_lower:
                    role = "data_access"
                elif name_lower == "application":
                    role = "business_logic"
                elif name_lower == "contracts":
                    role = "contracts"
                elif "infrastructure" in name_lower:
                    role = "infrastructure"
                elif name_lower == "client":
                    role = "client"
                else:
                    role = "library"
                entry["role"] = role
                libraries.append(entry)

            # Per-project detail record
            projects[project_name] = {
                "path": project_dir,
                "sdk": sdk or None,
                "target_framework": info.get("target_framework"),
                "output_type": info.get("output_type"),
                "role": role,
                "is_entry_point": is_entry_point,
                "container_support": info.get("container_support", False),
                "packages": sorted(packages),
                "project_references": project_references,
            }
            dependency_graph[project_name] = project_references

        if not entry_points and not libraries:
            return None

        return {
            "solution_file": sln_path.name,
            "entry_points": entry_points,
            "libraries": libraries,
            "test_projects": test_projects,
            "all_packages": sorted(all_packages),
            "projects": projects,
            "dependency_graph": dependency_graph,
        }

    def _parse_csproj_info(self, csproj_path: Path) -> dict:
        """Parse a .csproj file and extract SDK type, packages, project references, and key properties."""
        import re
        import xml.etree.ElementTree as ET
        from pathlib import PureWindowsPath

        info: dict = {"packages": set(), "project_references": []}

        try:
            content = csproj_path.read_text(encoding="utf-8", errors="ignore")

            sdk_match = re.search(r'Sdk="([^"]+)"', content)
            if sdk_match:
                info["sdk"] = sdk_match.group(1)

            output_match = re.search(r"<OutputType>([^<]+)</OutputType>", content)
            if output_match:
                info["output_type"] = output_match.group(1)

            tf_match = re.search(r"<TargetFramework>([^<]+)</TargetFramework>", content)
            if tf_match:
                info["target_framework"] = tf_match.group(1)

            if "<AzureFunctionsVersion>" in content:
                info["is_azure_functions"] = True

            if "<EnableSdkContainerSupport>" in content:
                info["container_support"] = True

            # Parse XML tree once for both PackageReference and ProjectReference
            try:
                tree = ET.fromstring(content)
                ns = ""
                ns_match = re.search(r"\{([^}]+)\}", tree.tag)
                if ns_match:
                    ns = ns_match.group(1)

                # PackageReference
                found_packages = list(tree.iter("PackageReference"))
                if not found_packages and ns:
                    found_packages = list(tree.iter(f"{{{ns}}}PackageReference"))
                for pkg_ref in found_packages:
                    include = pkg_ref.get("Include", "")
                    if include:
                        info["packages"].add(include.lower())
                if not found_packages:
                    refs = re.findall(r'<PackageReference\s+Include="([^"]+)"', content)
                    info["packages"].update(r.lower() for r in refs)

                # ProjectReference
                found_proj_refs = list(tree.iter("ProjectReference"))
                if not found_proj_refs and ns:
                    found_proj_refs = list(tree.iter(f"{{{ns}}}ProjectReference"))
                for proj_ref in found_proj_refs:
                    include = proj_ref.get("Include", "")
                    if include:
                        info["project_references"].append(PureWindowsPath(include).stem)
                if not found_proj_refs:
                    proj_refs = re.findall(
                        r'<ProjectReference\s+Include="([^"]+)"', content
                    )
                    info["project_references"] = [
                        PureWindowsPath(r).stem for r in proj_refs
                    ]

            except Exception:
                # Broad catch: malformed .csproj files can raise ET.ParseError,
                # TypeError (None content), ValueError (encoding issues), or other
                # unexpected exceptions. Fall back to regex extraction.
                refs = re.findall(r'<PackageReference\s+Include="([^"]+)"', content)
                info["packages"].update(r.lower() for r in refs)
                proj_refs = re.findall(
                    r'<ProjectReference\s+Include="([^"]+)"', content
                )
                info["project_references"] = [Path(r).stem for r in proj_refs]

            # Check Azure Functions worker packages
            if any("microsoft.azure.functions.worker" in p for p in info["packages"]):
                info["is_azure_functions"] = True

        except (OSError, UnicodeDecodeError):
            pass  # Expected for .csproj files that can't be read or decoded

        return info

    def _apply_dotnet_solution_framework(self, solution: dict) -> None:
        """Set framework properties based on .NET solution structure."""
        from .port_detector import PortDetector

        entry_points = solution["entry_points"]
        all_packages = set(solution.get("all_packages", []))

        # Determine primary framework from entry points
        has_api = any(ep.get("type") == "api" for ep in entry_points)
        has_worker = any(ep.get("type") == "worker" for ep in entry_points)

        if has_api:
            self.analysis["framework"] = "ASP.NET Core"
            self.analysis["type"] = "backend"
        elif has_worker:
            ep = next(ep for ep in entry_points if ep["type"] == "worker")
            self.analysis["framework"] = ep.get("framework", ".NET Worker")
            self.analysis["type"] = "worker"
        else:
            self.analysis["framework"] = ".NET"
            self.analysis["type"] = "library"

        # Record all components (API + Workers)
        if has_api and has_worker:
            self.analysis["components"] = [
                {
                    "name": ep["name"],
                    "type": ep["type"],
                    "path": ep["path"],
                    "framework": ep.get("framework", self.analysis["framework"]),
                }
                for ep in entry_points
            ]

        # Port detection — try API entry point first
        port_detector = PortDetector(self.path, self.analysis)
        self.analysis["default_port"] = port_detector.detect_port_from_sources(5000)

        # API docs
        if any("microsoft.aspnetcore.openapi" in p for p in all_packages) or any(
            "swashbuckle" in p for p in all_packages
        ):
            self.analysis["api_docs"] = "Swagger/OpenAPI"

        self._apply_dotnet_metadata(all_packages)

    def _apply_dotnet_metadata(self, all_packages: set[str]) -> None:
        """Apply common .NET metadata (ORM, messaging, testing) from packages."""
        # ORM detection
        if any(
            "entityframeworkcore" in p or "entityframework" in p for p in all_packages
        ):
            self.analysis["orm"] = "Entity Framework"
        elif any("dapper" in p for p in all_packages):
            self.analysis["orm"] = "Dapper"
        elif any("npgsql" in p for p in all_packages):
            self.analysis["orm"] = "Npgsql"

        # Task queue / messaging
        if any("masstransit" in p for p in all_packages):
            self.analysis["task_queue"] = "MassTransit"
        elif any("hangfire" in p for p in all_packages):
            self.analysis["task_queue"] = "Hangfire"
        elif any("rabbitmq" in p for p in all_packages):
            self.analysis["task_queue"] = "RabbitMQ"

        # Testing
        if any("xunit" in p for p in all_packages):
            self.analysis["testing"] = "xUnit"
        elif any("nunit" in p for p in all_packages):
            self.analysis["testing"] = "NUnit"
        elif any("mstest" in p for p in all_packages):
            self.analysis["testing"] = "MSTest"

        # Durable functions
        if any("durabletask" in p for p in all_packages):
            self.analysis["durable_functions"] = True

    def _detect_mkdocs_details(self) -> None:
        """Detect MkDocs configuration details."""
        from .port_detector import PortDetector

        config_file = "mkdocs.yml" if self._exists("mkdocs.yml") else "mkdocs.yaml"
        content = self._read_file(config_file)
        content_lower = content.lower()

        if "material" in content_lower:
            self.analysis["framework"] = "MkDocs Material"
        port_detector = PortDetector(self.path, self.analysis)
        self.analysis["default_port"] = port_detector.detect_port_from_sources(8000)

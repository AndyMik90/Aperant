"""
Framework Analyzer Module
=========================

Detects programming languages, frameworks, and related technologies across different ecosystems.
Supports Python, Node.js/TypeScript, Go, Rust, and Ruby frameworks.
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
                    continue

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
                    continue

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

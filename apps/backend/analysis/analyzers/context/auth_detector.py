"""
Authentication Patterns Detector Module
========================================

Detects authentication and authorization patterns:
- JWT authentication
- OAuth providers
- Session-based authentication
- API key authentication
- User models
- Auth middleware and decorators
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..base import BaseAnalyzer


class AuthDetector(BaseAnalyzer):
    """Detects authentication and authorization patterns."""

    JWT_LIBS = ["python-jose", "pyjwt", "jsonwebtoken", "jose"]
    OAUTH_LIBS = ["authlib", "passport", "next-auth", "@auth/core", "oauth2"]
    SESSION_LIBS = ["flask-login", "express-session", "django.contrib.auth"]

    USER_MODEL_FILES = [
        "models/user.py",
        "models/User.py",
        "app/models/user.py",
        "models/user.ts",
        "models/User.ts",
        "src/models/user.ts",
    ]

    def __init__(self, path: Path, analysis: dict[str, Any]):
        super().__init__(path)
        self.analysis = analysis

    def detect(self) -> None:
        """
        Detect authentication and authorization patterns.

        Detects: JWT, OAuth, session-based, API keys, user models, protected routes.
        """
        auth_info = {
            "strategies": [],
            "libraries": [],
            "user_model": None,
            "middleware": [],
        }

        # Get all dependencies
        all_deps = self._get_all_dependencies()

        # Detect auth strategies and libraries
        self._detect_jwt(all_deps, auth_info)
        self._detect_oauth(all_deps, auth_info)
        self._detect_session(all_deps, auth_info)

        # Find user model
        auth_info["user_model"] = self._find_user_model()

        # Detect auth middleware/decorators
        auth_info["middleware"] = self._find_auth_middleware()

        # Remove duplicates from strategies
        auth_info["strategies"] = list(set(auth_info["strategies"]))

        if auth_info["strategies"] or auth_info["libraries"]:
            self.analysis["auth"] = auth_info

    def _get_all_dependencies(self) -> set[str]:
        """Extract all dependencies from Python and Node.js projects."""
        all_deps = set()

        if self._exists("requirements.txt"):
            content = self._read_file("requirements.txt")
            all_deps.update(re.findall(r"^([a-zA-Z0-9_-]+)", content, re.MULTILINE))

        pkg = self._read_json("package.json")
        if pkg:
            all_deps.update(pkg.get("dependencies", {}).keys())

        return all_deps

    def _detect_jwt(self, all_deps: set[str], auth_info: dict[str, Any]) -> None:
        """Detect JWT authentication libraries."""
        for lib in self.JWT_LIBS:
            if lib in all_deps:
                auth_info["strategies"].append("jwt")
                auth_info["libraries"].append(lib)
                break

    def _detect_oauth(self, all_deps: set[str], auth_info: dict[str, Any]) -> None:
        """Detect OAuth authentication libraries."""
        for lib in self.OAUTH_LIBS:
            if lib in all_deps:
                auth_info["strategies"].append("oauth")
                auth_info["libraries"].append(lib)
                break

    def _detect_session(self, all_deps: set[str], auth_info: dict[str, Any]) -> None:
        """Detect session-based authentication libraries."""
        for lib in self.SESSION_LIBS:
            if lib in all_deps:
                auth_info["strategies"].append("session")
                auth_info["libraries"].append(lib)
                break

    def _find_user_model(self) -> str | None:
        """Find the user model file."""
        for model_file in self.USER_MODEL_FILES:
            if self._exists(model_file):
                return model_file
        return None

    def _find_auth_middleware(self) -> list[str]:
        """Detect auth middleware and decorators from Python files."""
        # Limit to first 20 files for performance
        all_py_files = list(self.path.glob("**/*.py"))[:20]
        auth_decorators = set()

        for py_file in all_py_files:
            try:
                content = py_file.read_text(encoding="utf-8")
                # Find custom decorators
                if (
                    "@require" in content
                    or "@login_required" in content
                    or "@authenticate" in content
                ):
                    decorators = re.findall(r"@(\w*(?:require|auth|login)\w*)", content)
                    auth_decorators.update(decorators)
            except (OSError, UnicodeDecodeError):
                continue

        return list(auth_decorators) if auth_decorators else []

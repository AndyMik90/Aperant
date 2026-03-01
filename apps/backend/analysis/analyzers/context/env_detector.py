"""
Environment Variable Detector Module
=====================================

Detects and analyzes environment variables from multiple sources:
- .env files and variants
- .env.example files
- docker-compose.yml
- .NET: appsettings.json, appsettings.{Environment}.json
- Source code (os.getenv, process.env)
- C#: IConfiguration, Environment.GetEnvironmentVariable
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..base import BaseAnalyzer


class EnvironmentDetector(BaseAnalyzer):
    """Detects environment variables and their configurations."""

    def __init__(self, path: Path, analysis: dict[str, Any]):
        super().__init__(path)
        self.analysis = analysis

    def detect(self) -> None:
        """
        Discover all environment variables from multiple sources.

        Extracts from: .env files, docker-compose, example files.
        Categorizes as required/optional and detects sensitive data.
        """
        env_vars = {}
        required_vars = set()
        optional_vars = set()

        # Parse various sources
        self._parse_env_files(env_vars)
        self._parse_env_example(env_vars, required_vars)
        self._parse_docker_compose(env_vars)
        self._parse_code_references(env_vars, optional_vars)

        # .NET appsettings.json
        self._parse_appsettings(env_vars)

        # .NET launchSettings.json (Properties/launchSettings.json)
        self._parse_launch_settings(env_vars)

        # Mark required vs optional
        for key in env_vars:
            if "required" not in env_vars[key]:
                env_vars[key]["required"] = key in required_vars

        if env_vars:
            self.analysis["environment"] = {
                "variables": env_vars,
                "required_count": len(required_vars),
                "optional_count": len(optional_vars),
                "detected_count": len(env_vars),
            }

    def _parse_env_files(self, env_vars: dict[str, Any]) -> None:
        """Parse .env files and variants."""
        env_files = [
            ".env",
            ".env.local",
            ".env.development",
            ".env.production",
            ".env.dev",
            ".env.prod",
            ".env.test",
            ".env.staging",
            "config/.env",
            "../.env",
        ]

        for env_file in env_files:
            content = self._read_file(env_file)
            if not content:
                continue

            for line in content.split("\n"):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue

                # Parse KEY=value or KEY="value" or KEY='value'
                match = re.match(r"^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$", line)
                if match:
                    key = match.group(1)
                    value = match.group(2).strip().strip('"').strip("'")

                    # Detect if sensitive
                    is_sensitive = self._is_sensitive_key(key)

                    # Detect type
                    var_type = self._infer_env_var_type(value)

                    env_vars[key] = {
                        "value": "<REDACTED>" if is_sensitive else value,
                        "source": env_file,
                        "type": var_type,
                        "sensitive": is_sensitive,
                    }

    def _parse_env_example(
        self, env_vars: dict[str, Any], required_vars: set[str]
    ) -> None:
        """Parse .env.example to find required variables."""
        example_content = self._read_file(".env.example") or self._read_file(
            ".env.sample"
        )
        if not example_content:
            return

        for line in example_content.split("\n"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            match = re.match(r"^([A-Z_][A-Z0-9_]*)\s*=", line)
            if match:
                key = match.group(1)
                required_vars.add(key)

                if key not in env_vars:
                    env_vars[key] = {
                        "value": None,
                        "source": ".env.example",
                        "type": "string",
                        "sensitive": self._is_sensitive_key(key),
                        "required": True,
                    }

    def _parse_docker_compose(self, env_vars: dict[str, Any]) -> None:
        """Parse docker-compose.yml environment section."""
        for compose_file in ["docker-compose.yml", "../docker-compose.yml"]:
            content = self._read_file(compose_file)
            if not content:
                continue

            # Look for environment variables in docker-compose
            in_env_section = False
            for line in content.split("\n"):
                if "environment:" in line:
                    in_env_section = True
                    continue

                if in_env_section:
                    # Check if we left the environment section
                    if line and not line.startswith((" ", "\t", "-")):
                        in_env_section = False
                        continue

                    # Parse - KEY=value or - KEY
                    match = re.match(r"^\s*-\s*([A-Z_][A-Z0-9_]*)", line)
                    if match:
                        key = match.group(1)
                        if key not in env_vars:
                            env_vars[key] = {
                                "value": None,
                                "source": compose_file,
                                "type": "string",
                                "sensitive": False,
                            }

    def _parse_code_references(
        self, env_vars: dict[str, Any], optional_vars: set[str]
    ) -> None:
        """Scan code for os.getenv() / process.env usage to find optional vars."""
        entry_files = [
            "app.py",
            "main.py",
            "config.py",
            "settings.py",
            "src/config.py",
            "src/settings.py",
            "index.js",
            "index.ts",
            "config.js",
            "config.ts",
            "Program.cs",
            "Startup.cs",
        ]

        for entry_file in entry_files:
            content = self._read_file(entry_file)
            if not content:
                continue

            # Python: os.getenv("VAR") or os.environ.get("VAR")
            python_patterns = [
                r'os\.getenv\(["\']([A-Z_][A-Z0-9_]*)["\']',
                r'os\.environ\.get\(["\']([A-Z_][A-Z0-9_]*)["\']',
                r'os\.environ\[["\']([A-Z_][A-Z0-9_]*)["\']',
            ]

            # JavaScript: process.env.VAR
            js_patterns = [
                r"process\.env\.([A-Z_][A-Z0-9_]*)",
            ]

            # C#: IConfiguration / Environment.GetEnvironmentVariable
            csharp_patterns = [
                r'GetEnvironmentVariable\(["\']([A-Z_][A-Z0-9_]*)["\']',
                r'configuration\[["\']([A-Za-z_:][A-Za-z0-9_:]*)["\']',
                r'Configuration\[["\']([A-Za-z_:][A-Za-z0-9_:]*)["\']',
            ]

            for pattern in python_patterns + js_patterns + csharp_patterns:
                matches = re.findall(pattern, content)
                for var_name in matches:
                    if var_name not in env_vars:
                        optional_vars.add(var_name)
                        env_vars[var_name] = {
                            "value": None,
                            "source": f"code:{entry_file}",
                            "type": "string",
                            "sensitive": self._is_sensitive_key(var_name),
                            "required": False,
                        }

    def _parse_appsettings(self, env_vars: dict[str, Any]) -> None:
        """Parse .NET appsettings.json configuration files.

        For .NET solutions, scans entry point sub-project directories.
        """
        base_files = [
            "appsettings.json",
            "appsettings.Development.json",
            "appsettings.Production.json",
            "appsettings.Staging.json",
        ]

        # Build list of directories to scan
        scan_dirs = [""]  # Root directory
        solution = self.analysis.get("dotnet_solution")
        if solution:
            for ep in solution.get("entry_points", []):
                scan_dirs.append(ep["path"])

        for scan_dir in scan_dirs:
            for base_file in base_files:
                settings_file = f"{scan_dir}/{base_file}" if scan_dir else base_file
                content = self._read_json(settings_file)
                if not content:
                    continue

                source = settings_file if scan_dir else base_file
                self._flatten_appsettings(content, "", source, env_vars)

    def _flatten_appsettings(
        self, obj: dict, prefix: str, source: str, env_vars: dict[str, Any]
    ) -> None:
        """Recursively flatten appsettings JSON into colon-separated keys."""
        # Skip certain top-level keys that are just noise
        skip_sections = {"$schema", "iisSettings", "profiles"}

        for key, value in obj.items():
            if key in skip_sections:
                continue

            full_key = f"{prefix}:{key}" if prefix else key

            if isinstance(value, dict):
                self._flatten_appsettings(value, full_key, source, env_vars)
            elif isinstance(value, list):
                # Skip arrays (usually complex config)
                continue
            else:
                # Leaf value
                str_value = str(value) if value is not None else ""
                is_sensitive = self._is_sensitive_key(full_key)
                var_type = self._infer_env_var_type(str_value)

                # Connection strings are URLs
                if "connectionstring" in full_key.lower():
                    var_type = "url"
                    is_sensitive = True

                if full_key not in env_vars:
                    env_vars[full_key] = {
                        "value": "<REDACTED>" if is_sensitive else str_value,
                        "source": source,
                        "type": var_type,
                        "sensitive": is_sensitive,
                    }

    def _parse_launch_settings(self, env_vars: dict[str, Any]) -> None:
        """Parse .NET Properties/launchSettings.json for environment variables.

        For .NET solutions, scans entry point sub-project directories.
        """
        launch_paths = [
            "Properties/launchSettings.json",
            "properties/launchSettings.json",
        ]

        # For .NET solutions, also scan entry point directories
        solution = self.analysis.get("dotnet_solution")
        if solution:
            for ep in solution.get("entry_points", []):
                launch_paths.append(f"{ep['path']}/Properties/launchSettings.json")

        for launch_path in launch_paths:
            data = self._read_json(launch_path)
            if not data:
                continue

            profiles = data.get("profiles", {})

            # Prefer "http" profile, then first available
            for profile_key in ["http", *profiles.keys()]:
                profile = profiles.get(profile_key)
                if not profile:
                    continue

                env_variables = profile.get("environmentVariables", {})
                if not env_variables:
                    continue

                for key, value in env_variables.items():
                    if key in env_vars:
                        continue

                    str_value = str(value) if value is not None else ""
                    is_sensitive = self._is_sensitive_key(key)
                    var_type = self._infer_env_var_type(str_value)

                    env_vars[key] = {
                        "value": "<REDACTED>" if is_sensitive else str_value,
                        "source": f"launchSettings:{profile_key}",
                        "type": var_type,
                        "sensitive": is_sensitive,
                    }

                # Only use the first profile with env vars
                return

    @staticmethod
    def _is_sensitive_key(key: str) -> bool:
        """Determine if an environment variable key contains sensitive data."""
        sensitive_keywords = [
            "secret",
            "key",
            "password",
            "token",
            "api_key",
            "private",
            "credential",
            "auth",
        ]
        return any(keyword in key.lower() for keyword in sensitive_keywords)

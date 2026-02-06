"""
Config File Parser
==================

Utilities for reading and parsing project configuration files
(package.json, pyproject.toml, composer.json, etc.).
"""

import json
import sys
from pathlib import Path

# tomllib is available in Python 3.11+, use tomli for older versions
if sys.version_info >= (3, 11):
    import tomllib
else:
    try:
        import tomli as tomllib
    except ImportError:
        raise ImportError(
            "Python < 3.11 requires 'tomli' package for TOML parsing. "
            "Install with: pip install tomli"
        ) from None


class ConfigParser:
    """Parses project configuration files."""

    def __init__(self, project_dir: Path):
        """
        Initialize config parser.

        Args:
            project_dir: Root directory of the project
        """
        self.project_dir = Path(project_dir).resolve()

    def read_json(self, filename: str) -> dict | None:
        """Read a JSON file from project root."""
        try:
            with open(self.project_dir / filename, encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def read_toml(self, filename: str) -> dict | None:
        """Read a TOML file from project root."""
        try:
            with open(self.project_dir / filename, "rb") as f:
                return tomllib.load(f)
        except FileNotFoundError:
            return None
        except Exception as e:
            # Handle both tomllib.TOMLDecodeError and tomli.TOMLDecodeError
            if "TOMLDecodeError" in type(e).__name__:
                return None
            raise

    def read_text(self, filename: str) -> str | None:
        """Read a text file from project root."""
        try:
            with open(self.project_dir / filename, encoding="utf-8") as f:
                return f.read()
        except (OSError, FileNotFoundError):
            return None

    def file_exists(self, *paths: str) -> bool:
        """Check if any of the given files/patterns exist."""
        for p in paths:
            # Handle glob patterns
            if "*" in p:
                if list(self.project_dir.glob(p)):
                    return True
            else:
                if (self.project_dir / p).exists():
                    return True
        return False

    def glob_files(self, pattern: str) -> list[Path]:
        """Find files matching a pattern."""
        return list(self.project_dir.glob(pattern))

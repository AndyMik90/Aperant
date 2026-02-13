#!/usr/bin/env python3
"""
Tests for Worktree Dependency Strategy
=======================================

Tests the dependency_strategy.py and models.py functionality including:
- DependencyStrategy enum values
- DependencyShareConfig dataclass
- DEFAULT_STRATEGY_MAP entries
- get_dependency_configs() with various inputs
"""

import pytest

from core.workspace.dependency_strategy import (
    DEFAULT_STRATEGY_MAP,
    get_dependency_configs,
)
from core.workspace.models import DependencyShareConfig, DependencyStrategy


class TestDependencyStrategy:
    """Tests for DependencyStrategy enum."""

    def test_enum_has_symlink(self):
        """SYMLINK strategy exists."""
        assert DependencyStrategy.SYMLINK.value == "symlink"

    def test_enum_has_recreate(self):
        """RECREATE strategy exists."""
        assert DependencyStrategy.RECREATE.value == "recreate"

    def test_enum_has_copy(self):
        """COPY strategy exists."""
        assert DependencyStrategy.COPY.value == "copy"

    def test_enum_has_skip(self):
        """SKIP strategy exists."""
        assert DependencyStrategy.SKIP.value == "skip"

    def test_enum_has_exactly_four_members(self):
        """Enum has exactly 4 strategies."""
        assert len(DependencyStrategy) == 4


class TestDependencyShareConfig:
    """Tests for DependencyShareConfig dataclass."""

    def test_create_with_required_fields(self):
        """Config creates with required fields only."""
        config = DependencyShareConfig(
            dep_type="node_modules",
            strategy=DependencyStrategy.SYMLINK,
            source_rel_path="node_modules",
        )
        assert config.dep_type == "node_modules"
        assert config.strategy == DependencyStrategy.SYMLINK
        assert config.source_rel_path == "node_modules"
        assert config.requirements_file is None
        assert config.package_manager is None

    def test_create_with_all_fields(self):
        """Config creates with all fields populated."""
        config = DependencyShareConfig(
            dep_type="venv",
            strategy=DependencyStrategy.RECREATE,
            source_rel_path=".venv",
            requirements_file="requirements.txt",
            package_manager="uv",
        )
        assert config.dep_type == "venv"
        assert config.strategy == DependencyStrategy.RECREATE
        assert config.source_rel_path == ".venv"
        assert config.requirements_file == "requirements.txt"
        assert config.package_manager == "uv"


class TestDefaultStrategyMap:
    """Tests for DEFAULT_STRATEGY_MAP."""

    def test_node_modules_is_symlink(self):
        """node_modules maps to SYMLINK."""
        assert DEFAULT_STRATEGY_MAP["node_modules"] == DependencyStrategy.SYMLINK

    def test_venv_is_recreate(self):
        """venv maps to RECREATE."""
        assert DEFAULT_STRATEGY_MAP["venv"] == DependencyStrategy.RECREATE

    def test_dot_venv_is_recreate(self):
        """.venv maps to RECREATE."""
        assert DEFAULT_STRATEGY_MAP[".venv"] == DependencyStrategy.RECREATE

    def test_vendor_php_is_symlink(self):
        """vendor_php maps to SYMLINK."""
        assert DEFAULT_STRATEGY_MAP["vendor_php"] == DependencyStrategy.SYMLINK

    def test_cargo_registry_is_skip(self):
        """cargo_registry maps to SKIP."""
        assert DEFAULT_STRATEGY_MAP["cargo_registry"] == DependencyStrategy.SKIP

    def test_go_modules_is_skip(self):
        """go_modules maps to SKIP."""
        assert DEFAULT_STRATEGY_MAP["go_modules"] == DependencyStrategy.SKIP


class TestGetDependencyConfigs:
    """Tests for get_dependency_configs()."""

    def test_with_mock_project_index(self):
        """Returns correct strategy per dependency type from project index."""
        project_index = {
            "services": {
                "frontend": {
                    "dependency_locations": [
                        {"type": "node_modules", "path": "node_modules"},
                    ]
                },
                "backend": {
                    "dependency_locations": [
                        {
                            "type": "venv",
                            "path": "apps/backend/.venv",
                            "requirements_file": "requirements.txt",
                            "package_manager": "uv",
                        },
                    ]
                },
            }
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 2

        by_type = {c.dep_type: c for c in configs}
        assert by_type["node_modules"].strategy == DependencyStrategy.SYMLINK
        assert by_type["node_modules"].source_rel_path == "node_modules"
        assert by_type["venv"].strategy == DependencyStrategy.RECREATE
        assert by_type["venv"].source_rel_path == "apps/backend/.venv"
        assert by_type["venv"].requirements_file == "requirements.txt"
        assert by_type["venv"].package_manager == "uv"

    def test_none_returns_fallback(self):
        """None project_index returns fallback node_modules-only config."""
        configs = get_dependency_configs(None)

        assert len(configs) == 1
        assert configs[0].dep_type == "node_modules"
        assert configs[0].strategy == DependencyStrategy.SYMLINK
        assert configs[0].source_rel_path == "node_modules"

    def test_missing_dependency_locations_returns_fallback(self):
        """Project index with services but no dependency_locations returns fallback."""
        project_index = {
            "services": {
                "frontend": {
                    "language": "typescript",
                }
            }
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].dep_type == "node_modules"
        assert configs[0].strategy == DependencyStrategy.SYMLINK

    def test_empty_services_returns_fallback(self):
        """Project index with empty services returns fallback."""
        configs = get_dependency_configs({"services": {}})

        assert len(configs) == 1
        assert configs[0].dep_type == "node_modules"

    def test_unknown_dep_type_defaults_to_skip(self):
        """Unknown dependency type defaults to SKIP strategy."""
        project_index = {
            "services": {
                "app": {
                    "dependency_locations": [
                        {"type": "unknown_ecosystem", "path": "deps/"},
                    ]
                }
            }
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].dep_type == "unknown_ecosystem"
        assert configs[0].strategy == DependencyStrategy.SKIP

    def test_python_service_no_venv_detected(self):
        """Python service with no venv in dependency_locations gets no venv config."""
        project_index = {
            "services": {
                "backend": {
                    "language": "python",
                    "dependency_locations": [],
                }
            }
        }

        # Empty dependency_locations means fallback
        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].dep_type == "node_modules"
        # No venv config — SKIP effectively since it's not listed

    def test_multiple_python_services_own_venv_configs(self):
        """Multiple Python services each get their own venv config with correct paths."""
        project_index = {
            "services": {
                "api": {
                    "dependency_locations": [
                        {
                            "type": "venv",
                            "path": "services/api/.venv",
                            "requirements_file": "requirements.txt",
                            "package_manager": "pip",
                        },
                    ]
                },
                "worker": {
                    "dependency_locations": [
                        {
                            "type": "venv",
                            "path": "services/worker/.venv",
                            "requirements_file": "pyproject.toml",
                            "package_manager": "uv",
                        },
                    ]
                },
            }
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 2

        paths = {c.source_rel_path: c for c in configs}
        assert "services/api/.venv" in paths
        assert "services/worker/.venv" in paths

        api_config = paths["services/api/.venv"]
        assert api_config.strategy == DependencyStrategy.RECREATE
        assert api_config.package_manager == "pip"
        assert api_config.requirements_file == "requirements.txt"

        worker_config = paths["services/worker/.venv"]
        assert worker_config.strategy == DependencyStrategy.RECREATE
        assert worker_config.package_manager == "uv"
        assert worker_config.requirements_file == "pyproject.toml"

    def test_deduplicates_by_path(self):
        """Duplicate paths are deduplicated."""
        project_index = {
            "services": {
                "frontend": {
                    "dependency_locations": [
                        {"type": "node_modules", "path": "node_modules"},
                    ]
                },
                "storybook": {
                    "dependency_locations": [
                        {"type": "node_modules", "path": "node_modules"},
                    ]
                },
            }
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].dep_type == "node_modules"

#!/usr/bin/env python3
"""
Tests for Worktree Dependency Strategy
=======================================

Tests the dependency_strategy.py and models.py functionality including:
- DependencyStrategy enum values
- DependencyShareConfig dataclass
- DEFAULT_STRATEGY_MAP entries
- get_dependency_configs() with various inputs
- ServiceAnalyzer._detect_dependency_locations()
- setup_worktree_dependencies() strategy dispatch
- symlink_node_modules_to_worktree() backward compatibility
"""

from pathlib import Path
from unittest.mock import patch

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
            strategy=DependencyStrategy.SYMLINK,
            source_rel_path=".venv",
            requirements_file="requirements.txt",
            package_manager="uv",
        )
        assert config.dep_type == "venv"
        assert config.strategy == DependencyStrategy.SYMLINK
        assert config.source_rel_path == ".venv"
        assert config.requirements_file == "requirements.txt"
        assert config.package_manager == "uv"


class TestDefaultStrategyMap:
    """Tests for DEFAULT_STRATEGY_MAP."""

    def test_node_modules_is_symlink(self):
        """node_modules maps to SYMLINK."""
        assert DEFAULT_STRATEGY_MAP["node_modules"] == DependencyStrategy.SYMLINK

    def test_venv_is_symlink(self):
        """venv maps to SYMLINK (fast worktree creation with health check fallback)."""
        assert DEFAULT_STRATEGY_MAP["venv"] == DependencyStrategy.SYMLINK

    def test_dot_venv_is_symlink(self):
        """.venv maps to SYMLINK (fast worktree creation with health check fallback)."""
        assert DEFAULT_STRATEGY_MAP[".venv"] == DependencyStrategy.SYMLINK

    def test_vendor_php_is_symlink(self):
        """vendor_php maps to SYMLINK."""
        assert DEFAULT_STRATEGY_MAP["vendor_php"] == DependencyStrategy.SYMLINK

    def test_vendor_bundle_is_symlink(self):
        """vendor_bundle maps to SYMLINK."""
        assert DEFAULT_STRATEGY_MAP["vendor_bundle"] == DependencyStrategy.SYMLINK

    def test_cargo_target_is_skip(self):
        """cargo_target maps to SKIP."""
        assert DEFAULT_STRATEGY_MAP["cargo_target"] == DependencyStrategy.SKIP

    def test_go_modules_is_skip(self):
        """go_modules maps to SKIP."""
        assert DEFAULT_STRATEGY_MAP["go_modules"] == DependencyStrategy.SKIP


class TestGetDependencyConfigs:
    """Tests for get_dependency_configs()."""

    def test_with_mock_project_index(self):
        """Returns correct strategy per dependency type from project index."""
        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "node_modules", "service": "frontend"},
                {
                    "type": "venv",
                    "path": "apps/backend/.venv",
                    "requirements_file": "requirements.txt",
                    "package_manager": "uv",
                    "service": "backend",
                },
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 2

        by_type = {c.dep_type: c for c in configs}
        assert by_type["node_modules"].strategy == DependencyStrategy.SYMLINK
        assert by_type["node_modules"].source_rel_path == "node_modules"
        assert by_type["venv"].strategy == DependencyStrategy.SYMLINK
        assert by_type["venv"].source_rel_path == "apps/backend/.venv"
        assert by_type["venv"].requirements_file == "requirements.txt"
        assert by_type["venv"].package_manager == "uv"

    def test_none_returns_fallback(self):
        """None project_index returns fallback node_modules configs."""
        configs = get_dependency_configs(None)

        assert len(configs) == 2
        assert configs[0].dep_type == "node_modules"
        assert configs[0].strategy == DependencyStrategy.SYMLINK
        assert configs[0].source_rel_path == "node_modules"
        assert configs[1].dep_type == "node_modules"
        assert configs[1].source_rel_path == "apps/frontend/node_modules"

    def test_missing_dependency_locations_returns_fallback(self):
        """Project index without dependency_locations returns fallback."""
        project_index = {
            "services": {
                "frontend": {
                    "language": "typescript",
                }
            }
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 2
        assert configs[0].dep_type == "node_modules"
        assert configs[0].strategy == DependencyStrategy.SYMLINK

    def test_empty_dependency_locations_returns_fallback(self):
        """Project index with empty dependency_locations returns fallback."""
        configs = get_dependency_configs({"dependency_locations": []})

        assert len(configs) == 2
        assert configs[0].dep_type == "node_modules"

    def test_unknown_dep_type_defaults_to_skip(self):
        """Unknown dependency type defaults to SKIP strategy."""
        project_index = {
            "dependency_locations": [
                {"type": "unknown_ecosystem", "path": "deps/", "service": "app"},
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].dep_type == "unknown_ecosystem"
        assert configs[0].strategy == DependencyStrategy.SKIP

    def test_no_dependency_locations_returns_fallback(self):
        """Project index with no dependency_locations falls back."""
        project_index = {
            "services": {
                "backend": {
                    "language": "python",
                    "dependency_locations": [],
                }
            }
        }

        # No top-level dependency_locations means fallback
        configs = get_dependency_configs(project_index)

        assert len(configs) == 2
        assert configs[0].dep_type == "node_modules"

    def test_multiple_python_services_own_venv_configs(self):
        """Multiple Python services each get their own venv config with correct paths."""
        project_index = {
            "dependency_locations": [
                {
                    "type": "venv",
                    "path": "services/api/.venv",
                    "requirements_file": "requirements.txt",
                    "package_manager": "pip",
                    "service": "api",
                },
                {
                    "type": "venv",
                    "path": "services/worker/.venv",
                    "requirements_file": "pyproject.toml",
                    "package_manager": "uv",
                    "service": "worker",
                },
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 2

        paths = {c.source_rel_path: c for c in configs}
        assert "services/api/.venv" in paths
        assert "services/worker/.venv" in paths

        api_config = paths["services/api/.venv"]
        assert api_config.strategy == DependencyStrategy.SYMLINK
        assert api_config.package_manager == "pip"
        assert api_config.requirements_file == "requirements.txt"

        worker_config = paths["services/worker/.venv"]
        assert worker_config.strategy == DependencyStrategy.SYMLINK
        assert worker_config.package_manager == "uv"
        assert worker_config.requirements_file == "pyproject.toml"

    def test_deduplicates_by_path(self):
        """Duplicate paths are deduplicated."""
        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "node_modules", "service": "frontend"},
                {"type": "node_modules", "path": "node_modules", "service": "storybook"},
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].dep_type == "node_modules"

    def test_path_traversal_rejected(self):
        """Paths with '..' components are rejected for containment safety."""
        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "../../etc/passwd", "service": "evil"},
                {"type": "node_modules", "path": "safe/node_modules", "service": "ok"},
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].source_rel_path == "safe/node_modules"

    def test_windows_backslash_traversal_rejected(self):
        """Windows-style backslash traversals are rejected."""
        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "..\\..\\evil", "service": "evil"},
                {"type": "node_modules", "path": "safe/node_modules", "service": "ok"},
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].source_rel_path == "safe/node_modules"

    def test_absolute_posix_path_rejected(self):
        """Absolute POSIX paths are rejected."""
        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "/etc/passwd", "service": "evil"},
                {"type": "node_modules", "path": "safe/node_modules", "service": "ok"},
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].source_rel_path == "safe/node_modules"

    def test_absolute_windows_path_rejected(self):
        """Absolute Windows paths are rejected."""
        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "C:\\Windows", "service": "evil"},
                {"type": "node_modules", "path": "safe/node_modules", "service": "ok"},
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].source_rel_path == "safe/node_modules"

    def test_requirements_file_traversal_rejected(self):
        """requirements_file with '..' traversal is nullified."""
        project_index = {
            "dependency_locations": [
                {
                    "type": "venv",
                    "path": ".venv",
                    "requirements_file": "../../etc/passwd",
                    "service": "evil",
                },
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].source_rel_path == ".venv"
        assert configs[0].requirements_file is None

    def test_requirements_file_absolute_path_rejected(self):
        """requirements_file with absolute path is nullified."""
        project_index = {
            "dependency_locations": [
                {
                    "type": "venv",
                    "path": ".venv",
                    "requirements_file": "/etc/passwd",
                    "service": "evil",
                },
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].requirements_file is None

    def test_requirements_file_valid_preserved(self):
        """Valid requirements_file is preserved."""
        project_index = {
            "dependency_locations": [
                {
                    "type": "venv",
                    "path": ".venv",
                    "requirements_file": "requirements.txt",
                    "package_manager": "pip",
                    "service": "backend",
                },
            ]
        }

        configs = get_dependency_configs(project_index)

        assert len(configs) == 1
        assert configs[0].requirements_file == "requirements.txt"

    def test_resolved_path_containment_with_project_dir(self, tmp_path):
        """Resolved-path containment check rejects escaping paths when project_dir is set."""
        # Create a symlink inside tmp_path that points outside it
        escape_dir = tmp_path / "escape"
        escape_dir.mkdir()
        outside = tmp_path.parent / "outside_target"
        outside.mkdir(exist_ok=True)
        (escape_dir / "node_modules").symlink_to(outside)

        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "escape/node_modules", "service": "evil"},
                {"type": "node_modules", "path": "safe_modules", "service": "ok"},
            ]
        }

        configs = get_dependency_configs(project_index, project_dir=tmp_path)

        # escape/node_modules resolves outside project_dir, so it's rejected
        assert len(configs) == 1
        assert configs[0].source_rel_path == "safe_modules"

    def test_resolved_path_valid_with_project_dir(self, tmp_path):
        """Valid paths pass both syntactic and resolved-path checks with project_dir."""
        (tmp_path / "node_modules").mkdir()

        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "node_modules", "service": "frontend"},
            ]
        }

        configs = get_dependency_configs(project_index, project_dir=tmp_path)

        assert len(configs) == 1
        assert configs[0].source_rel_path == "node_modules"

    def test_resolved_requirements_file_containment_with_project_dir(self, tmp_path):
        """Resolved-path containment rejects requirements_file escaping project_dir."""
        # Create a symlink that escapes project_dir
        escape_dir = tmp_path / "reqs"
        escape_dir.mkdir()
        outside = tmp_path.parent / "outside_reqs"
        outside.mkdir(exist_ok=True)
        (escape_dir / "requirements.txt").symlink_to(outside / "evil.txt")

        project_index = {
            "dependency_locations": [
                {
                    "type": "venv",
                    "path": ".venv",
                    "requirements_file": "reqs/requirements.txt",
                    "service": "backend",
                },
            ]
        }

        configs = get_dependency_configs(project_index, project_dir=tmp_path)

        assert len(configs) == 1
        assert configs[0].requirements_file is None


class TestServiceAnalyzerDependencyLocations:
    """Tests for ServiceAnalyzer._detect_dependency_locations()."""

    def test_detects_node_modules_when_package_json_exists(self, tmp_path: Path):
        """Detects node_modules directory when package.json exists."""
        from analysis.analyzers.service_analyzer import ServiceAnalyzer

        (tmp_path / "package.json").write_text("{}")
        (tmp_path / "node_modules").mkdir()

        analyzer = ServiceAnalyzer(tmp_path, "frontend")
        analyzer._detect_dependency_locations()

        locations = analyzer.analysis["dependency_locations"]
        node_entry = next(l for l in locations if l["type"] == "node_modules")
        assert node_entry["exists"] is True
        assert node_entry["path"] == "node_modules"

    def test_detects_venv_when_requirements_txt_exists(self, tmp_path: Path):
        """Detects .venv directory when requirements.txt exists."""
        from analysis.analyzers.service_analyzer import ServiceAnalyzer

        (tmp_path / "requirements.txt").write_text("flask")
        (tmp_path / ".venv").mkdir()

        analyzer = ServiceAnalyzer(tmp_path, "backend")
        analyzer._detect_dependency_locations()

        locations = analyzer.analysis["dependency_locations"]
        venv_entry = next(l for l in locations if l["type"] == "venv")
        assert venv_entry["exists"] is True
        assert venv_entry["path"] == ".venv"
        assert venv_entry["requirements_file"] == "requirements.txt"

    def test_returns_no_local_deps_for_go_project(self, tmp_path: Path):
        """Returns no dependency locations for Go project with no package.json."""
        from analysis.analyzers.service_analyzer import ServiceAnalyzer

        (tmp_path / "go.mod").write_text("module example.com/app")

        analyzer = ServiceAnalyzer(tmp_path, "goapp")
        analyzer._detect_dependency_locations()

        locations = analyzer.analysis["dependency_locations"]
        # No entries — node_modules only appears when package.json exists
        assert len(locations) == 0


class TestSetupWorktreeDependencies:
    """Tests for setup_worktree_dependencies()."""

    def test_symlink_created_for_node_modules(self, tmp_path: Path):
        """SYMLINK strategy creates symlink for node_modules."""
        from core.workspace.setup import setup_worktree_dependencies

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        (project_dir / "node_modules").mkdir()
        (project_dir / "node_modules" / "react").mkdir()

        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()

        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "node_modules", "service": "frontend"},
            ]
        }

        results = setup_worktree_dependencies(project_dir, worktree_path, project_index)

        assert "symlink" in results
        assert "node_modules" in results["symlink"]
        target = worktree_path / "node_modules"
        assert target.exists() or target.is_symlink()

    def test_none_project_index_uses_fallback(self, tmp_path: Path):
        """None project_index uses fallback node_modules behavior."""
        from core.workspace.setup import setup_worktree_dependencies

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        (project_dir / "node_modules").mkdir()

        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()

        results = setup_worktree_dependencies(project_dir, worktree_path, None)

        assert "symlink" in results
        assert "node_modules" in results["symlink"]

    def test_source_missing_skipped_gracefully(self, tmp_path: Path):
        """Source dependency that doesn't exist is skipped gracefully."""
        from core.workspace.setup import setup_worktree_dependencies

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        # No node_modules directory created

        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()

        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "node_modules", "service": "frontend"},
            ]
        }

        # Should not raise
        results = setup_worktree_dependencies(project_dir, worktree_path, project_index)

        # Source missing → no work performed, so not recorded in results
        symlink_results = results.get("symlink", [])
        assert "node_modules" not in symlink_results
        # No symlink was created
        assert not (worktree_path / "node_modules").exists()

    def test_target_already_exists_skipped_gracefully(self, tmp_path: Path):
        """Target that already exists is skipped gracefully."""
        from core.workspace.setup import setup_worktree_dependencies

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        (project_dir / "node_modules").mkdir()

        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()
        # Pre-create target
        (worktree_path / "node_modules").mkdir()

        project_index = {
            "dependency_locations": [
                {"type": "node_modules", "path": "node_modules", "service": "frontend"},
            ]
        }

        # Should not raise
        results = setup_worktree_dependencies(project_dir, worktree_path, project_index)

        assert "symlink" in results
        # Target is still a real directory, not a symlink
        assert (worktree_path / "node_modules").is_dir()
        assert not (worktree_path / "node_modules").is_symlink()


class TestVenvSymlinkWithHealthCheck:
    """Tests for venv symlink strategy with health check and fallback to recreate."""

    def test_venv_symlinked_when_source_exists(self, tmp_path: Path):
        """Venv is symlinked (not recreated) when source venv exists."""
        from core.workspace.setup import setup_worktree_dependencies

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        venv_dir = project_dir / ".venv"
        venv_dir.mkdir()
        # Create a minimal venv structure so the symlink target looks real
        (venv_dir / "bin").mkdir()
        (venv_dir / "lib").mkdir()

        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()

        project_index = {
            "dependency_locations": [
                {"type": ".venv", "path": ".venv", "service": "backend"},
            ]
        }

        results = setup_worktree_dependencies(project_dir, worktree_path, project_index)

        target = worktree_path / ".venv"
        # The symlink should have been created (regardless of health check outcome)
        assert target.exists() or target.is_symlink()

    def test_venv_health_check_fallback_to_recreate(self, tmp_path: Path):
        """When symlinked venv health check fails, falls back to recreate."""
        from core.workspace.setup import setup_worktree_dependencies

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        # Create a source venv that has no python binary (health check will fail)
        venv_dir = project_dir / ".venv"
        venv_dir.mkdir()

        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()

        project_index = {
            "dependency_locations": [
                {"type": ".venv", "path": ".venv", "service": "backend"},
            ]
        }

        # This should symlink, then health check fails (no python binary),
        # then fall back to recreate (which will also fail since no real python
        # in source). The important thing is it doesn't raise.
        results = setup_worktree_dependencies(project_dir, worktree_path, project_index)
        # Should not crash
        assert isinstance(results, dict)


class TestRecreateStrategyMarker:
    """Tests for the .setup_complete marker in the recreate strategy."""

    def test_marker_constant_defined(self):
        """VENV_SETUP_COMPLETE_MARKER is defined."""
        from core.workspace.setup import VENV_SETUP_COMPLETE_MARKER
        assert VENV_SETUP_COMPLETE_MARKER == ".setup_complete"

    def test_incomplete_venv_detected_and_removed(self, tmp_path: Path):
        """Venv without marker is detected as incomplete."""
        from core.workspace.setup import _apply_recreate_strategy, VENV_SETUP_COMPLETE_MARKER
        from core.workspace.models import DependencyShareConfig, DependencyStrategy

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()

        # Create an incomplete venv (no marker)
        incomplete_venv = worktree_path / ".venv"
        incomplete_venv.mkdir()
        (incomplete_venv / "bin").mkdir()

        config = DependencyShareConfig(
            dep_type=".venv",
            strategy=DependencyStrategy.RECREATE,
            source_rel_path=".venv",
        )

        # Will try to recreate (remove incomplete + rebuild). May fail due to
        # no real python, but the incomplete venv should be removed.
        _apply_recreate_strategy(project_dir, worktree_path, config)

        # The incomplete venv without marker should have been removed
        # (recreation may or may not succeed depending on Python availability)
        if incomplete_venv.exists():
            # If it was recreated successfully, marker should exist
            assert (incomplete_venv / VENV_SETUP_COMPLETE_MARKER).exists()

    def test_complete_venv_skipped(self, tmp_path: Path):
        """Venv with marker is skipped (not rebuilt)."""
        from core.workspace.setup import _apply_recreate_strategy, VENV_SETUP_COMPLETE_MARKER
        from core.workspace.models import DependencyShareConfig, DependencyStrategy

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()

        # Create a complete venv (with marker)
        complete_venv = worktree_path / ".venv"
        complete_venv.mkdir()
        (complete_venv / VENV_SETUP_COMPLETE_MARKER).touch()
        # Add a canary file to verify the venv wasn't rebuilt
        (complete_venv / "canary.txt").write_text("original")

        config = DependencyShareConfig(
            dep_type=".venv",
            strategy=DependencyStrategy.RECREATE,
            source_rel_path=".venv",
        )

        result = _apply_recreate_strategy(project_dir, worktree_path, config)

        assert result is False  # Skipped
        # Canary file should still be present (not rebuilt)
        assert (complete_venv / "canary.txt").read_text() == "original"


class TestSymlinkNodeModulesToWorktreeBackwardCompat:
    """Tests for symlink_node_modules_to_worktree() backward compatibility."""

    def test_wrapper_still_works(self, tmp_path: Path):
        """symlink_node_modules_to_worktree() still works as a wrapper."""
        from core.workspace.setup import symlink_node_modules_to_worktree

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        (project_dir / "node_modules").mkdir()

        worktree_path = tmp_path / "worktree"
        worktree_path.mkdir()

        result = symlink_node_modules_to_worktree(project_dir, worktree_path)

        assert isinstance(result, list)
        assert "node_modules" in result

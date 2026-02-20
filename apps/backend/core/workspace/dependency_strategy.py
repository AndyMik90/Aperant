"""
Dependency Strategy Mapping
============================

Maps dependency types to sharing strategies for worktree creation.

Each dependency ecosystem has different constraints:

- **node_modules**: Safe to symlink. Node's resolution algorithm follows symlinks
  correctly, and the directory is self-contained.

- **venv / .venv**: Symlinked for fast worktree creation. CPython bug #106045
  (pyvenv.cfg symlink resolution) does not affect typical usage (running scripts,
  imports, pip). A health check after symlinking verifies usability; if it fails,
  the caller falls back to recreating the venv.

- **vendor (PHP)**: Safe to symlink. Composer's autoloader uses ``__DIR__``-relative
  paths that resolve correctly through symlinks.

- **cargo target / go modules**: Skip entirely. Rust's ``target/`` dir contains
  per-machine build artifacts that must be rebuilt. Go uses a global module cache
  (``$GOPATH/pkg/mod``), so there is nothing in-tree to share.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path, PurePosixPath, PureWindowsPath

logger = logging.getLogger(__name__)

from .models import DependencyShareConfig, DependencyStrategy

# ---------------------------------------------------------------------------
# Default strategy map
# ---------------------------------------------------------------------------
# Maps dependency type identifiers to the strategy that should be used when
# sharing that dependency across worktrees.  Data-driven — add new entries
# here rather than writing if/else branches.
# ---------------------------------------------------------------------------

DEFAULT_STRATEGY_MAP: dict[str, DependencyStrategy] = {
    # JavaScript / Node.js — symlink is safe and fast
    "node_modules": DependencyStrategy.SYMLINK,
    # Python — symlink for fast worktree creation (health check + fallback to recreate)
    "venv": DependencyStrategy.SYMLINK,
    ".venv": DependencyStrategy.SYMLINK,
    # PHP — Composer vendor dir is safe to symlink
    "vendor_php": DependencyStrategy.SYMLINK,
    # Ruby — Bundler vendor/bundle is safe to symlink
    "vendor_bundle": DependencyStrategy.SYMLINK,
    # Rust — build output dir, skip (rebuilt per-worktree)
    "cargo_target": DependencyStrategy.SKIP,
    # Go — global module cache, nothing in-tree to share
    "go_modules": DependencyStrategy.SKIP,
}


def get_dependency_configs(
    project_index: dict | None,
    project_dir: Path | None = None,
) -> list[DependencyShareConfig]:
    """Derive dependency share configs from a project index.

    If *project_index* is ``None`` or lacks ``dependency_locations``,
    falls back to a hardcoded node_modules config for backward compatibility
    with existing worktree setups.

    Args:
        project_index: Parsed ``project_index.json`` dict, or ``None``.
        project_dir: Project root directory for resolved-path containment
            checks (defense-in-depth).  Should always be provided when
            *project_index* is not ``None`` — omitting it disables the
            resolved-path security check.

    Returns:
        List of :class:`DependencyShareConfig` objects — one per discovered
        dependency location.
    """

    configs: list[DependencyShareConfig] = []
    seen: set[str] = set()

    if project_index is not None:
        if project_dir is None:
            logger.warning(
                "get_dependency_configs called with project_index but no "
                "project_dir — resolved-path containment check is disabled"
            )

        # Use the aggregated top-level dependency_locations which already
        # contain project-relative paths (e.g. "apps/backend/.venv" instead
        # of just ".venv").  This avoids a monorepo path resolution bug
        # where service-relative paths were incorrectly treated as project-
        # relative.
        dep_locations = project_index.get("dependency_locations") or []
        for dep in dep_locations:
            if not isinstance(dep, dict):
                continue

            dep_type = dep.get("type", "")
            rel_path = dep.get("path", "")

            if not dep_type or not rel_path:
                continue

            # Path containment: reject absolute paths and traversals.
            # Check both POSIX and Windows path styles for cross-platform safety.
            p = PurePosixPath(rel_path)
            if p.is_absolute() or PureWindowsPath(rel_path).is_absolute():
                continue
            if ".." in p.parts or ".." in PureWindowsPath(rel_path).parts:
                continue

            # Defense-in-depth: verify the resolved path stays within project_dir
            if project_dir is not None:
                resolved = (project_dir / rel_path).resolve()
                if not str(resolved).startswith(str(project_dir.resolve()) + os.sep):
                    continue

            # Deduplicate by relative path
            if rel_path in seen:
                continue
            seen.add(rel_path)

            strategy = DEFAULT_STRATEGY_MAP.get(dep_type, DependencyStrategy.SKIP)

            # Validate requirements_file path containment too
            req_file = dep.get("requirements_file")
            if req_file:
                rp = PurePosixPath(req_file)
                if (
                    rp.is_absolute()
                    or PureWindowsPath(req_file).is_absolute()
                    or ".." in rp.parts
                    or ".." in PureWindowsPath(req_file).parts
                ):
                    req_file = None

                # Defense-in-depth: resolved-path containment (matches rel_path check)
                if req_file and project_dir is not None:
                    resolved_req = (project_dir / req_file).resolve()
                    if not str(resolved_req).startswith(
                        str(project_dir.resolve()) + os.sep
                    ):
                        req_file = None

            configs.append(
                DependencyShareConfig(
                    dep_type=dep_type,
                    strategy=strategy,
                    source_rel_path=rel_path,
                    requirements_file=req_file,
                    package_manager=dep.get("package_manager"),
                )
            )

    # Fallback: if no configs were discovered, default to node_modules-only
    # so existing worktree behaviour is preserved.
    if not configs:
        configs.append(
            DependencyShareConfig(
                dep_type="node_modules",
                strategy=DependencyStrategy.SYMLINK,
                source_rel_path="node_modules",
            )
        )
        configs.append(
            DependencyShareConfig(
                dep_type="node_modules",
                strategy=DependencyStrategy.SYMLINK,
                source_rel_path="apps/frontend/node_modules",
            )
        )

    return configs

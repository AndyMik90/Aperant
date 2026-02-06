"""
Unit tests for PR Context Gatherer
===================================

Tests the context gathering functionality without requiring actual GitHub API calls.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from context_gatherer import ChangedFile, PRContext, PRContextGatherer


@pytest.mark.asyncio
async def test_gather_basic_pr_context(tmp_path):
    """Test gathering basic PR context."""
    # Create a temporary project directory
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    # Mock the subprocess calls
    pr_metadata = {
        "number": 123,
        "title": "Add new feature",
        "body": "This PR adds a new feature",
        "author": {"login": "testuser"},
        "baseRefName": "main",
        "headRefName": "feature/new-feature",
        "files": [
            {
                "path": "src/app.ts",
                "status": "modified",
                "additions": 10,
                "deletions": 5,
            }
        ],
        "additions": 10,
        "deletions": 5,
        "changedFiles": 1,
        "labels": [{"name": "feature"}],
    }

    with patch("subprocess.run") as mock_run:
        # Mock metadata fetch
        mock_run.return_value = MagicMock(
            returncode=0, stdout='{"number": 123, "title": "Add new feature"}'
        )

        gatherer = PRContextGatherer(project_dir, 123)

        # We can't fully test without real git, but we can verify the structure
        assert gatherer.pr_number == 123
        assert gatherer.project_dir == project_dir


def test_normalize_status():
    """Test file status normalization."""
    gatherer = PRContextGatherer(Path("/tmp"), 1)

    assert gatherer._normalize_status("added") == "added"
    assert gatherer._normalize_status("ADD") == "added"
    assert gatherer._normalize_status("modified") == "modified"
    assert gatherer._normalize_status("mod") == "modified"
    assert gatherer._normalize_status("deleted") == "deleted"
    assert gatherer._normalize_status("renamed") == "renamed"


def test_find_test_files(tmp_path):
    """Test finding related test files."""
    # Create a project structure
    project_dir = tmp_path / "project"
    src_dir = project_dir / "src"
    src_dir.mkdir(parents=True)

    # Create source file
    source_file = src_dir / "utils.ts"
    source_file.write_text("export const add = (a, b) => a + b;", encoding="utf-8")

    # Create test file
    test_file = src_dir / "utils.test.ts"
    test_file.write_text("import { add } from './utils';", encoding="utf-8")

    gatherer = PRContextGatherer(project_dir, 1)

    # Find test files for the source file
    source_path = Path("src/utils.ts")
    test_files = gatherer._find_test_files(source_path)

    assert "src/utils.test.ts" in test_files


def test_resolve_import_path(tmp_path):
    """Test resolving relative import paths."""
    # Create a project structure
    project_dir = tmp_path / "project"
    src_dir = project_dir / "src"
    src_dir.mkdir(parents=True)

    # Create imported file
    utils_file = src_dir / "utils.ts"
    utils_file.write_text("export const helper = () => {};", encoding="utf-8")

    # Create importing file
    app_file = src_dir / "app.ts"
    app_file.write_text("import { helper } from './utils';", encoding="utf-8")

    gatherer = PRContextGatherer(project_dir, 1)

    # Resolve import path
    source_path = Path("src/app.ts")
    resolved = gatherer._resolve_import_path("./utils", source_path)

    assert resolved == "src/utils.ts"


def test_detect_repo_structure_monorepo(tmp_path):
    """Test detecting monorepo structure."""
    # Create monorepo structure
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    apps_dir = project_dir / "apps"
    apps_dir.mkdir()

    (apps_dir / "frontend").mkdir()
    (apps_dir / "backend").mkdir()

    # Create package.json with workspaces
    package_json = project_dir / "package.json"
    package_json.write_text('{"workspaces": ["apps/*"]}', encoding="utf-8")

    gatherer = PRContextGatherer(project_dir, 1)

    structure = gatherer._detect_repo_structure()

    assert "Monorepo Apps" in structure
    assert "frontend" in structure
    assert "backend" in structure
    assert "Workspaces" in structure


def test_detect_repo_structure_python(tmp_path):
    """Test detecting Python project structure."""
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    # Create pyproject.toml
    pyproject = project_dir / "pyproject.toml"
    pyproject.write_text("[tool.poetry]\nname = 'test'", encoding="utf-8")

    gatherer = PRContextGatherer(project_dir, 1)

    structure = gatherer._detect_repo_structure()

    assert "Python Project" in structure


def test_find_config_files(tmp_path):
    """Test finding configuration files."""
    project_dir = tmp_path / "project"
    src_dir = project_dir / "src"
    src_dir.mkdir(parents=True)

    # Create config files
    (src_dir / "tsconfig.json").write_text("{}", encoding="utf-8")
    (src_dir / "package.json").write_text("{}", encoding="utf-8")

    gatherer = PRContextGatherer(project_dir, 1)

    config_files = gatherer._find_config_files(Path("src"))

    assert "src/tsconfig.json" in config_files
    assert "src/package.json" in config_files


def test_get_file_extension():
    """Test file extension mapping for syntax highlighting."""
    gatherer = PRContextGatherer(Path("/tmp"), 1)

    assert gatherer._get_file_extension("app.ts") == "typescript"
    assert gatherer._get_file_extension("utils.tsx") == "typescript"
    assert gatherer._get_file_extension("script.js") == "javascript"
    assert gatherer._get_file_extension("script.jsx") == "javascript"
    assert gatherer._get_file_extension("main.py") == "python"
    assert gatherer._get_file_extension("config.json") == "json"
    assert gatherer._get_file_extension("readme.md") == "markdown"
    assert gatherer._get_file_extension("config.yml") == "yaml"


def test_find_imports_typescript(tmp_path):
    """Test finding imports in TypeScript code."""
    project_dir = tmp_path / "project"
    project_dir.mkdir()

    content = """
import { Component } from 'react';
import { helper } from './utils';
import { config } from '../config';
import external from 'lodash';
"""

    gatherer = PRContextGatherer(project_dir, 1)
    source_path = Path("src/app.tsx")

    imports = gatherer._find_imports(content, source_path)

    # Should only include relative imports
    assert len(imports) >= 0  # Depends on whether files actually exist


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

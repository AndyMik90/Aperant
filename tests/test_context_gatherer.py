"""
Tests for GitHub PR Context Gatherer (context_gatherer.py)
===================================================

Tests the context gathering phase for PR reviews including:
- Data models (ChangedFile, AIBotComment, PRContext)
- Validation functions
- Import resolution logic
- Static helper methods
- FollowupContextGatherer functionality
- AI bot review detection and inclusion
"""

import ast
import json
import os
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch
import tempfile

import pytest

from runners.github.context_gatherer import (
    # Dataclasses
    ChangedFile,
    AIBotComment,
    PRContext,
    # Main classes
    PRContextGatherer,
    FollowupContextGatherer,
    # Validation functions
    _validate_git_ref,
    _validate_file_path,
    # Constants
    AI_BOT_PATTERNS,
    CONFIG_FILE_NAMES,
)
from runners.github.models import PRReviewResult, FollowupReviewContext


# ============================================================================
# Validation Functions Tests
# ============================================================================


class TestValidationFunctions:
    """Tests for input validation functions."""

    def test_validate_git_ref_valid(self):
        """Test valid git refs are accepted."""
        assert _validate_git_ref("main") is True
        assert _validate_git_ref("feature/branch-123") is True
        assert _validate_git_ref("develop") is True
        assert _validate_git_ref("abc123def456") is True
        assert _validate_git_ref("v1.0.0") is True

    def test_validate_git_ref_invalid(self):
        """Test invalid git refs are rejected."""
        assert _validate_git_ref("") is False
        assert _validate_git_ref(None) is False
        # Too long
        assert _validate_git_ref("a" * 257) is False
        # Contains dangerous characters
        assert _validate_git_ref("branch;rm -rf /") is False
        assert _validate_git_ref("branch && echo") is False
        assert _validate_git_ref("branch|cat") is False
        assert _validate_git_ref("branch$(whoami)") is False

    def test_validate_file_path_valid(self):
        """Test valid file paths are accepted."""
        assert _validate_file_path("src/app.tsx") is True
        assert _validate_file_path("tests/unit/test.py") is True
        assert _validate_file_path("package.json") is True
        assert _validate_file_path("src/components/Button.tsx") is True
        assert _validate_file_path("@types/node") is True

    def test_validate_file_path_invalid(self):
        """Test invalid file paths are rejected."""
        assert _validate_file_path("") is False
        assert _validate_file_path(None) is False
        # Too long
        assert _validate_file_path("a" * 1025) is False
        # Path traversal attempts
        assert _validate_file_path("../../../etc/passwd") is False
        assert _validate_file_path("../secret") is False
        assert _validate_file_path("./../../etc/passwd") is False
        # Absolute paths
        assert _validate_file_path("/etc/passwd") is False
        assert _validate_file_path("/home/user/file") is False
        # Command injection attempts
        assert _validate_file_path("file;rm -rf /") is False
        assert _validate_file_path("file && cat") is False
        assert _validate_file_path("file|whoami") is False


# ============================================================================
# Dataclass Tests
# ============================================================================


class TestChangedFile:
    """Tests for ChangedFile dataclass."""

    def test_create_changed_file(self):
        """Test creating a ChangedFile instance."""
        file = ChangedFile(
            path="src/app.tsx",
            status="modified",
            additions=10,
            deletions=5,
            content="new content",
            base_content="old content",
            patch="diff content"
        )
        assert file.path == "src/app.tsx"
        assert file.status == "modified"
        assert file.additions == 10
        assert file.deletions == 5


class TestAIBotComment:
    """Tests for AIBotComment dataclass."""

    def test_create_ai_bot_comment(self):
        """Test creating an AIBotComment instance."""
        comment = AIBotComment(
            comment_id=123,
            author="coderabbitai",
            tool_name="CodeRabbit",
            body="Consider adding error handling",
            file="src/app.tsx",
            line=42,
            created_at="2024-01-01T00:00:00Z"
        )
        assert comment.comment_id == 123
        assert comment.tool_name == "CodeRabbit"
        assert comment.file == "src/app.tsx"
        assert comment.line == 42

    def test_create_ai_bot_comment_minimal(self):
        """Test creating an AIBotComment with minimal info."""
        comment = AIBotComment(
            comment_id=456,
            author="greptile",
            tool_name="Greptile",
            body="General PR comment",
            file="",
            line=0,
            created_at="2024-01-01T00:00:00Z"
        )
        assert comment.file == ""
        assert comment.line == 0


class TestPRContext:
    """Tests for PRContext dataclass."""

    def test_create_pr_context_minimal(self):
        """Test creating a PRContext with required fields."""
        context = PRContext(
            pr_number=42,
            title="Test PR",
            description="Test description",
            author="testuser",
            base_branch="main",
            head_branch="feature",
            state="open",
            changed_files=[],
            diff="diff content",
            repo_structure="Standard repo",
            related_files=[]
        )
        assert context.pr_number == 42
        assert context.title == "Test PR"
        assert context.ai_bot_comments == []
        assert context.diff_truncated is False

    def test_create_pr_context_full(self):
        """Test creating a PRContext with all fields."""
        files = [
            ChangedFile(
                path="file.py",
                status="added",
                additions=100,
                deletions=0,
                content="",
                base_content="",
                patch=""
            )
        ]
        ai_comments = [
            AIBotComment(
                comment_id=1,
                author="coderabbitai",
                tool_name="CodeRabbit",
                body="Comment",
                file="",
                line=0,
                created_at="2024-01-01T00:00:00Z"
            )
        ]

        context = PRContext(
            pr_number=123,
            title="Feature",
            description="Desc",
            author="user",
            base_branch="main",
            head_branch="feature",
            state="open",
            changed_files=files,
            diff="",
            repo_structure="",
            related_files=[],
            commits=[],
            labels=["enhancement"],
            total_additions=100,
            total_deletions=0,
            ai_bot_comments=ai_comments,
            diff_truncated=True,
            head_sha="abc123",
            base_sha="def456",
            has_merge_conflicts=True,
            merge_state_status="DIRTY"
        )
        assert context.diff_truncated is True
        assert context.has_merge_conflicts is True
        assert context.merge_state_status == "DIRTY"
        assert len(context.ai_bot_comments) == 1


# ============================================================================
# AI Bot Patterns Tests
# ============================================================================


class TestAIBotPatterns:
    """Tests for AI_BOT_PATTERNS constant."""

    def test_ai_bot_patterns_is_dict(self):
        """Test AI_BOT_PATTERNS is a dictionary."""
        assert isinstance(AI_BOT_PATTERNS, dict)

    def test_ai_bot_patterns_has_common_bots(self):
        """Test common AI bots are in patterns."""
        assert "coderabbitai" in AI_BOT_PATTERNS
        assert "greptile" in AI_BOT_PATTERNS
        assert "cursor" in AI_BOT_PATTERNS
        assert "copilot" in AI_BOT_PATTERNS

    def test_ai_bot_patterns_values(self):
        """Test pattern values are display names."""
        assert AI_BOT_PATTERNS["coderabbitai"] == "CodeRabbit"
        assert AI_BOT_PATTERNS["greptile"] == "Greptile"
        assert AI_BOT_PATTERNS["cursor"] == "Cursor"


# ============================================================================
# Config File Names Tests
# ============================================================================


class TestConfigFileNames:
    """Tests for CONFIG_FILE_NAMES constant."""

    def test_config_file_names_is_list(self):
        """Test CONFIG_FILE_NAMES is a list."""
        assert isinstance(CONFIG_FILE_NAMES, list)

    def test_config_file_names_has_common_configs(self):
        """Test common config files are in the list."""
        assert "tsconfig.json" in CONFIG_FILE_NAMES
        assert "package.json" in CONFIG_FILE_NAMES
        assert "pyproject.toml" in CONFIG_FILE_NAMES
        assert "setup.py" in CONFIG_FILE_NAMES


# ============================================================================
# PRContextGatherer Tests
# ============================================================================


class TestPRContextGathererInit:
    """Tests for PRContextGatherer initialization."""

    def test_init_with_defaults(self, tmp_path):
        """Test initialization with default parameters."""
        gatherer = PRContextGatherer(
            project_dir=tmp_path,
            pr_number=42
        )
        assert gatherer.project_dir == tmp_path
        assert gatherer.pr_number == 42
        assert gatherer.repo is None

    def test_init_with_repo(self, tmp_path):
        """Test initialization with repo parameter."""
        gatherer = PRContextGatherer(
            project_dir=tmp_path,
            pr_number=100,
            repo="owner/repo"
        )
        assert gatherer.repo == "owner/repo"


class TestPRContextGathererNormalizeStatus:
    """Tests for _normalize_status method."""

    def test_normalize_status_added(self, tmp_path):
        """Test normalizing 'added' status."""
        gatherer = PRContextGatherer(tmp_path, 1)
        assert gatherer._normalize_status("added") == "added"
        assert gatherer._normalize_status("add") == "added"
        assert gatherer._normalize_status("ADDED") == "added"
        assert gatherer._normalize_status("ADD") == "added"

    def test_normalize_status_modified(self, tmp_path):
        """Test normalizing 'modified' status."""
        gatherer = PRContextGatherer(tmp_path, 1)
        assert gatherer._normalize_status("modified") == "modified"
        assert gatherer._normalize_status("mod") == "modified"
        assert gatherer._normalize_status("changed") == "modified"
        assert gatherer._normalize_status("MODIFIED") == "modified"

    def test_normalize_status_deleted(self, tmp_path):
        """Test normalizing 'deleted' status."""
        gatherer = PRContextGatherer(tmp_path, 1)
        assert gatherer._normalize_status("deleted") == "deleted"
        assert gatherer._normalize_status("del") == "deleted"
        assert gatherer._normalize_status("removed") == "deleted"
        assert gatherer._normalize_status("DELETED") == "deleted"

    def test_normalize_status_renamed(self, tmp_path):
        """Test normalizing 'renamed' status."""
        gatherer = PRContextGatherer(tmp_path, 1)
        assert gatherer._normalize_status("renamed") == "renamed"
        assert gatherer._normalize_status("rename") == "renamed"

    def test_normalize_status_unknown(self, tmp_path):
        """Test normalizing unknown status."""
        gatherer = PRContextGatherer(tmp_path, 1)
        assert gatherer._normalize_status("unknown_status") == "unknown_status"


class TestPRContextGathererFindRelatedFiles:
    """Tests for _find_related_files method."""

    def test_find_related_files_returns_empty(self, tmp_path):
        """Test _find_related_files returns empty list (deprecated)."""
        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._find_related_files([])
        assert result == []

    def test_find_related_files_with_changed_files(self, tmp_path):
        """Test _find_related_files with changed files still returns empty."""
        gatherer = PRContextGatherer(tmp_path, 1)
        files = [
            ChangedFile(
                path="src/app.tsx",
                status="modified",
                additions=10,
                deletions=5,
                content="",
                base_content="",
                patch=""
            )
        ]
        result = gatherer._find_related_files(files)
        assert result == []


class TestPRContextGathererFindDependents:
    """Tests for _find_dependents method."""

    def test_find_dependents_returns_empty(self, tmp_path):
        """Test _find_dependents returns empty set (deprecated)."""
        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._find_dependents("src/utils.py")
        assert result == set()


class TestPRContextGathererPrioritizeRelatedFiles:
    """Tests for _prioritize_related_files method."""

    def test_prioritize_related_files_returns_empty(self, tmp_path):
        """Test _prioritize_related_files returns empty list (deprecated)."""
        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._prioritize_related_files(set())
        assert result == []


class TestPRContextGathererStaticFindRelatedFiles:
    """Tests for static find_related_files_for_root method."""

    def test_find_related_files_for_root_returns_empty(self, tmp_path):
        """Test static method returns empty list (deprecated)."""
        result = PRContextGatherer.find_related_files_for_root(
            changed_files=[],
            project_root=tmp_path
        )
        assert result == []


class TestPRContextGathererParseAIComment:
    """Tests for _parse_ai_comment method."""

    def test_parse_ai_comment_review_comment_known_bot(self, tmp_path):
        """Test parsing review comment from known AI bot."""
        gatherer = PRContextGatherer(tmp_path, 1)
        comment = {
            "id": 123,
            "author": {"login": "coderabbitai"},
            "body": "Consider using const instead of let",
            "path": "src/app.tsx",
            "line": 42,
            "createdAt": "2024-01-01T00:00:00Z"
        }
        result = gatherer._parse_ai_comment(comment, is_review_comment=True)
        assert result is not None
        assert result.tool_name == "CodeRabbit"
        assert result.file == "src/app.tsx"
        assert result.line == 42

    def test_parse_ai_comment_issue_comment_known_bot(self, tmp_path):
        """Test parsing issue comment from known AI bot."""
        gatherer = PRContextGatherer(tmp_path, 1)
        comment = {
            "id": 456,
            "author": {"login": "greptile"},
            "body": "Overall good PR!",
            "createdAt": "2024-01-01T00:00:00Z"
        }
        result = gatherer._parse_ai_comment(comment, is_review_comment=False)
        assert result is not None
        assert result.tool_name == "Greptile"
        assert result.file is None

    def test_parse_ai_comment_human_author(self, tmp_path):
        """Test parsing comment from human (not AI bot)."""
        gatherer = PRContextGatherer(tmp_path, 1)
        comment = {
            "id": 789,
            "author": {"login": "human-developer"},
            "body": "Looks good!",
            "createdAt": "2024-01-01T00:00:00Z"
        }
        result = gatherer._parse_ai_comment(comment, is_review_comment=False)
        assert result is None

    def test_parse_ai_comment_null_author(self, tmp_path):
        """Test parsing comment with null author."""
        gatherer = PRContextGatherer(tmp_path, 1)
        comment = {
            "id": 999,
            "author": None,
            "user": None,
            "body": "Test",
            "createdAt": "2024-01-01T00:00:00Z"
        }
        result = gatherer._parse_ai_comment(comment, is_review_comment=False)
        assert result is None

    def test_parse_ai_comment_fallback_to_user_field(self, tmp_path):
        """Test parsing comment that uses 'user' field instead of 'author'."""
        gatherer = PRContextGatherer(tmp_path, 1)
        comment = {
            "id": 111,
            "user": {"login": "cursor-ai"},
            "body": "Suggestion here",
            "createdAt": "2024-01-01T00:00:00Z"
        }
        result = gatherer._parse_ai_comment(comment, is_review_comment=False)
        assert result is not None
        assert result.tool_name == "Cursor"


class TestPRContextGathererDetectRepoStructure:
    """Tests for _detect_repo_structure method."""

    def test_detect_structure_standard_repo(self, tmp_path):
        """Test detecting standard single-package repository."""
        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._detect_repo_structure()
        assert result == "**Structure**: Standard single-package repository"

    def test_detect_structure_monorepo_apps(self, tmp_path):
        """Test detecting monorepo with apps directory."""
        apps_dir = tmp_path / "apps"
        apps_dir.mkdir()
        (apps_dir / "frontend").mkdir()
        (apps_dir / "backend").mkdir()

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._detect_repo_structure()
        assert "Monorepo Apps" in result
        assert "frontend" in result
        assert "backend" in result

    def test_detect_structure_packages(self, tmp_path):
        """Test detecting monorepo with packages directory."""
        packages_dir = tmp_path / "packages"
        packages_dir.mkdir()
        (packages_dir / "shared").mkdir()
        (packages_dir / "utils").mkdir()

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._detect_repo_structure()
        assert "Packages" in result
        assert "shared" in result
        assert "utils" in result

    def test_detect_structure_python_project(self, tmp_path):
        """Test detecting Python project."""
        (tmp_path / "pyproject.toml").touch()

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._detect_repo_structure()
        assert "Python Project" in result

    def test_detect_structure_vite(self, tmp_path):
        """Test detecting Vite build system."""
        (tmp_path / "vite.config.ts").touch()

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._detect_repo_structure()
        assert "Vite" in result

    def test_detect_structure_electron(self, tmp_path):
        """Test detecting Electron app."""
        (tmp_path / "electron.vite.config.ts").touch()

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._detect_repo_structure()
        assert "Electron" in result

    def test_detect_structure_workspaces(self, tmp_path):
        """Test detecting npm workspaces."""
        (tmp_path / "package.json").write_text(
            json.dumps({"workspaces": ["apps/*", "packages/*"]})
        )

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._detect_repo_structure()
        assert "Workspaces" in result


class TestPRContextGathererResolveImportPath:
    """Tests for _resolve_import_path method."""

    def test_resolve_import_relative_file_exists(self, tmp_path):
        """Test resolving relative import to existing file."""
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        utils_file = src_dir / "utils.ts"
        utils_file.write_text("// utils")

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._resolve_import_path("./utils.ts", Path("src/app.ts"))
        # Normalize path for Windows compatibility
        assert os.path.normpath(result) == os.path.normpath("src/utils.ts")

    def test_resolve_relative_with_extension_finding(self, tmp_path):
        """Test resolving relative import without extension."""
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        utils_file = src_dir / "utils.ts"
        utils_file.write_text("// utils")

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._resolve_import_path("./utils", Path("src/app.ts"))
        assert os.path.normpath(result) == os.path.normpath("src/utils.ts")

    def test_resolve_import_index_file(self, tmp_path):
        """Test resolving import to index file."""
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        components_dir = src_dir / "components"
        components_dir.mkdir()
        index_file = components_dir / "index.ts"
        index_file.write_text("// index")

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._resolve_import_path("./components", Path("src/app.ts"))
        assert os.path.normpath(result) == os.path.normpath("src/components/index.ts")

    def test_resolve_import_parent_directory(self, tmp_path):
        """Test resolving import to parent directory."""
        root_dir = tmp_path / "src"
        root_dir.mkdir()
        utils_file = root_dir / "utils.ts"
        utils_file.write_text("// utils")

        components_dir = root_dir / "components"
        components_dir.mkdir()

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._resolve_import_path("../utils", Path("src/components/Button.tsx"))
        assert os.path.normpath(result) == os.path.normpath("src/utils.ts")

    def test_resolve_import_not_found(self, tmp_path):
        """Test resolving import that doesn't exist."""
        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._resolve_import_path("./nonexistent", Path("src/app.ts"))
        assert result is None


class TestPRContextGathererLoadJsonSafe:
    """Tests for _load_json_safe method."""

    def test_load_json_valid(self, tmp_path):
        """Test loading valid JSON file."""
        (tmp_path / "config.json").write_text('{"key": "value"}')

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._load_json_safe("config.json")
        assert result == {"key": "value"}

    def test_load_json_with_comments(self, tmp_path):
        """Test loading JSON with comments (tsconfig-style)."""
        (tmp_path / "tsconfig.json").write_text(
            '{\n  // This is a comment\n  "key": "value"\n}'
        )

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._load_json_safe("tsconfig.json")
        assert result == {"key": "value"}

    def test_load_json_with_block_comments(self, tmp_path):
        """Test loading JSON with block comments."""
        (tmp_path / "tsconfig.json").write_text(
            '{\n  /* Block comment */\n  "key": "value"\n}'
        )

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._load_json_safe("tsconfig.json")
        assert result == {"key": "value"}

    def test_load_json_not_found(self, tmp_path):
        """Test loading non-existent JSON file."""
        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._load_json_safe("nonexistent.json")
        assert result is None

    def test_load_json_invalid(self, tmp_path):
        """Test loading invalid JSON file."""
        (tmp_path / "bad.json").write_text('{invalid json}')

        gatherer = PRContextGatherer(tmp_path, 1)
        # Mock safe_print to avoid style parameter error
        with patch('runners.github.context_gatherer.safe_print'):
            result = gatherer._load_json_safe("bad.json")
        # Returns None because JSON parsing fails
        assert result is None


class TestPRContextGathererLoadTsconfigPaths:
    """Tests for _load_tsconfig_paths method."""

    def test_load_tsconfig_paths_basic(self, tmp_path):
        """Test loading basic tsconfig paths."""
        (tmp_path / "tsconfig.json").write_text(
            json.dumps({
                "compilerOptions": {
                    "paths": {
                        "@/*": ["src/*"],
                        "@shared/*": ["src/shared/*"]
                    }
                }
            })
        )

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._load_tsconfig_paths()
        assert result is not None
        assert "@/*" in result
        assert "@shared/*" in result

    def test_load_tsconfig_paths_with_extends(self, tmp_path):
        """Test loading tsconfig with extends."""
        (tmp_path / "tsconfig.base.json").write_text(
            json.dumps({
                "compilerOptions": {
                    "paths": {
                        "@base/*": ["src/base/*"]
                    }
                }
            })
        )
        (tmp_path / "tsconfig.json").write_text(
            json.dumps({
                "extends": "./tsconfig.base.json",
                "compilerOptions": {
                    "paths": {
                        "@/*": ["src/*"]
                    }
                }
            })
        )

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._load_tsconfig_paths()
        assert result is not None
        assert "@base/*" in result
        assert "@/*" in result

    def test_load_tsconfig_paths_no_file(self, tmp_path):
        """Test loading tsconfig when file doesn't exist."""
        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._load_tsconfig_paths()
        assert result is None


class TestPRContextGathererFindPythonImports:
    """Tests for _find_python_imports method."""

    def test_find_python_imports_basic(self, tmp_path):
        """Test finding Python imports."""
        code = """
import os
import sys
from utils import helper
from .local import local_func
"""
        gatherer = PRContextGatherer(tmp_path, 1)
        imports = gatherer._find_python_imports(code, Path("src/app.py"))

        # Should find imports that can be resolved
        assert isinstance(imports, set)

    def test_find_python_imports_invalid_syntax(self, tmp_path):
        """Test finding imports in invalid Python code."""
        code = "this is not valid python code {{{"

        gatherer = PRContextGatherer(tmp_path, 1)
        imports = gatherer._find_python_imports(code, Path("src/app.py"))
        # Should return empty set for invalid syntax
        assert imports == set()


class TestPRContextGathererResolvePythonImport:
    """Tests for _resolve_python_import method."""

    def test_resolve_python_import_relative(self, tmp_path):
        """Test resolving relative Python import."""
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        utils_file = src_dir / "utils.py"
        utils_file.write_text("# utils")

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._resolve_python_import("utils", 1, Path("src/app.py"))
        assert os.path.normpath(result) == os.path.normpath("src/utils.py")

    def test_resolve_python_import_package(self, tmp_path):
        """Test resolving Python package import."""
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        utils_dir = src_dir / "utils"
        utils_dir.mkdir()
        init_file = utils_dir / "__init__.py"
        init_file.write_text("# init")

        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._resolve_python_import("utils", 1, Path("src/app.py"))
        assert os.path.normpath(result) == os.path.normpath("src/utils/__init__.py")

    def test_resolve_python_import_not_found(self, tmp_path):
        """Test resolving Python import that doesn't exist."""
        gatherer = PRContextGatherer(tmp_path, 1)
        result = gatherer._resolve_python_import("nonexistent", 1, Path("src/app.py"))
        assert result is None


class TestPRContextGathererAsyncMethods:
    """Tests for async methods using mocks."""

    @pytest.mark.asyncio
    async def test_fetch_commits_success(self, tmp_path):
        """Test fetching commits successfully."""
        gatherer = PRContextGatherer(tmp_path, 1)
        mock_commits = [
            {"sha": "abc123", "message": "First commit"},
            {"sha": "def456", "message": "Second commit"}
        ]

        with patch.object(gatherer.gh_client, 'pr_get', return_value={"commits": mock_commits}):
            result = await gatherer._fetch_commits()
            assert result == mock_commits

    @pytest.mark.asyncio
    async def test_fetch_commits_error(self, tmp_path):
        """Test fetching commits with error."""
        gatherer = PRContextGatherer(tmp_path, 1)

        with patch.object(gatherer.gh_client, 'pr_get', side_effect=Exception("API error")):
            result = await gatherer._fetch_commits()
            assert result == []

    @pytest.mark.asyncio
    async def test_fetch_pr_diff_success(self, tmp_path):
        """Test fetching PR diff successfully."""
        gatherer = PRContextGatherer(tmp_path, 1)
        diff_content = "diff --git a/file.py b/file.py\n+new line"

        with patch.object(gatherer.gh_client, 'pr_diff', return_value=diff_content):
            result = await gatherer._fetch_pr_diff()
            assert result == diff_content

    @pytest.mark.asyncio
    async def test_fetch_pr_diff_too_large(self, tmp_path):
        """Test handling PR that exceeds diff limit."""
        from runners.github.gh_client import PRTooLargeError

        gatherer = PRContextGatherer(tmp_path, 1)

        with patch.object(gatherer.gh_client, 'pr_diff', side_effect=PRTooLargeError("Diff too large")):
            result = await gatherer._fetch_pr_diff()
            assert result == ""

    @pytest.mark.asyncio
    async def test_fetch_pr_review_comments_empty(self, tmp_path):
        """Test fetching review comments when none exist."""
        gatherer = PRContextGatherer(tmp_path, 1)

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""

        with patch.object(gatherer.gh_client, 'run', return_value=mock_result):
            result = await gatherer._fetch_pr_review_comments()
            assert result == []

    @pytest.mark.asyncio
    async def test_fetch_pr_issue_comments_empty(self, tmp_path):
        """Test fetching issue comments when none exist."""
        gatherer = PRContextGatherer(tmp_path, 1)

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = ""

        with patch.object(gatherer.gh_client, 'run', return_value=mock_result):
            result = await gatherer._fetch_pr_issue_comments()
            assert result == []

    @pytest.mark.asyncio
    async def test_fetch_ai_bot_comments(self, tmp_path):
        """Test fetching AI bot comments."""
        gatherer = PRContextGatherer(tmp_path, 1)

        review_comment = {
            "id": 1,
            "author": {"login": "coderabbitai"},
            "body": "Review comment",
            "path": "file.py",
            "line": 10,
            "createdAt": "2024-01-01T00:00:00Z"
        }

        issue_comment = {
            "id": 2,
            "author": {"login": "greptile"},
            "body": "Issue comment",
            "createdAt": "2024-01-01T00:00:00Z"
        }

        with patch.object(gatherer, '_fetch_pr_review_comments', return_value=[review_comment]):
            with patch.object(gatherer, '_fetch_pr_issue_comments', return_value=[issue_comment]):
                result = await gatherer._fetch_ai_bot_comments()
                assert len(result) == 2
                assert any(c.tool_name == "CodeRabbit" for c in result)
                assert any(c.tool_name == "Greptile" for c in result)


# ============================================================================
# FollowupContextGatherer Tests
# ============================================================================


class TestFollowupContextGathererInit:
    """Tests for FollowupContextGatherer initialization."""

    def test_init(self, tmp_path):
        """Test FollowupContextGatherer initialization."""
        previous_review = PRReviewResult(
            pr_number=42,
            repo="owner/repo",
            success=True,
            reviewed_commit_sha="abc123"
        )

        gatherer = FollowupContextGatherer(
            project_dir=tmp_path,
            pr_number=42,
            previous_review=previous_review,
            repo="owner/repo"
        )

        assert gatherer.project_dir == tmp_path
        assert gatherer.pr_number == 42
        assert gatherer.previous_review == previous_review


class TestFollowupContextGathererGather:
    """Tests for FollowupContextGatherer.gather method."""

    @pytest.mark.asyncio
    async def test_gather_no_previous_sha(self, tmp_path):
        """Test gathering when previous review has no commit SHA."""
        previous_review = PRReviewResult(
            pr_number=42,
            repo="owner/repo",
            success=True
        )

        gatherer = FollowupContextGatherer(
            project_dir=tmp_path,
            pr_number=42,
            previous_review=previous_review
        )

        with patch('runners.github.context_gatherer.safe_print'):
            result = await gatherer.gather()
            assert result.previous_commit_sha == ""
            assert result.current_commit_sha == ""

    @pytest.mark.asyncio
    async def test_gather_no_current_sha(self, tmp_path):
        """Test gathering when current SHA cannot be fetched."""
        previous_review = PRReviewResult(
            pr_number=42,
            repo="owner/repo",
            success=True,
            reviewed_commit_sha="abc123"
        )

        gatherer = FollowupContextGatherer(
            project_dir=tmp_path,
            pr_number=42,
            previous_review=previous_review
        )

        with patch.object(gatherer.gh_client, 'get_pr_head_sha', return_value=None):
            with patch('runners.github.context_gatherer.safe_print'):
                result = await gatherer.gather()
                assert result.current_commit_sha == ""

    @pytest.mark.asyncio
    async def test_gather_same_sha(self, tmp_path):
        """Test gathering when SHA hasn't changed."""
        sha = "abc123def456"
        previous_review = PRReviewResult(
            pr_number=42,
            repo="owner/repo",
            success=True,
            reviewed_commit_sha=sha
        )

        gatherer = FollowupContextGatherer(
            project_dir=tmp_path,
            pr_number=42,
            previous_review=previous_review
        )

        with patch.object(gatherer.gh_client, 'get_pr_head_sha', return_value=sha):
            with patch('runners.github.context_gatherer.safe_print'):
                result = await gatherer.gather()
                assert result.previous_commit_sha == sha
                assert result.current_commit_sha == sha


# ============================================================================
# AI Reviews Inclusion Tests (From Original File)
# ============================================================================


class TestAIReviewsInclusion:
    """Tests that AI bot formal reviews are included in follow-up context."""

    def test_followup_context_includes_ai_reviews_field(self):
        """Verify FollowupReviewContext has ai_bot_comments_since_review field."""
        previous_review = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[],
            summary="Test",
            overall_status="approve",
            reviewed_commit_sha="abc123",
            reviewed_at=datetime.now().isoformat(),
        )

        # Create context with AI reviews included
        context = FollowupReviewContext(
            pr_number=42,
            previous_review=previous_review,
            previous_commit_sha="abc123",
            current_commit_sha="def456",
            ai_bot_comments_since_review=[
                {"user": {"login": "coderabbitai[bot]"}, "body": "AI review content"}
            ],
        )

        # Verify AI reviews are accessible
        assert len(context.ai_bot_comments_since_review) == 1
        assert context.ai_bot_comments_since_review[0]["body"] == "AI review content"

    @pytest.mark.asyncio
    async def test_gather_followup_context_includes_ai_reviews(self, tmp_path):
        """Test that FollowupContextGatherer.gather() includes AI formal reviews.

        This is the key test that verifies the fix for the bug where AI formal reviews
        (from CodeRabbit, Cursor, etc.) were fetched but not included in the context.
        """
        previous_review = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[],
            summary="Test",
            overall_status="approve",
            reviewed_commit_sha="abc123",
            reviewed_at=datetime.now().isoformat(),
        )

        # Create mock GitHub client
        mock_gh_client = AsyncMock()
        mock_gh_client.get_pr_head_sha.return_value = "def456"
        mock_gh_client.pr_get.return_value = {
            "mergeable": "MERGEABLE",
            "mergeStateStatus": "CLEAN",
        }
        mock_gh_client.get_pr_files_changed_since.return_value = ([], [])  # (files, commits)
        mock_gh_client.get_comments_since.return_value = {
            "review_comments": [
                {
                    "id": 1,
                    "user": {"login": "coderabbitai[bot]"},
                    "body": "AI inline comment",
                }
            ],
            "issue_comments": [],
        }

        # Mock formal PR reviews - THIS IS THE KEY DATA
        mock_gh_client.get_reviews_since.return_value = [
            {
                "id": 100,
                "user": {"login": "coderabbitai[bot]"},
                "body": "## CodeRabbit Summary\n\nThis PR looks good overall.",
                "state": "COMMENTED",
            },
            {
                "id": 101,
                "user": {"login": "gemini-code-assist[bot]"},
                "body": "## Gemini Review\n\nNo issues found.",
                "state": "APPROVED",
            },
            {
                "id": 102,
                "user": {"login": "human-reviewer"},
                "body": "LGTM",
                "state": "APPROVED",
            },
        ]

        gatherer = FollowupContextGatherer(
            project_dir=tmp_path,
            pr_number=42,
            previous_review=previous_review,
            repo="test/repo",
        )
        gatherer.gh_client = mock_gh_client

        # Call the method under test
        context = await gatherer.gather()

        # ASSERTION: AI formal reviews should be in ai_bot_comments_since_review
        ai_feedback = context.ai_bot_comments_since_review

        # Should include: 1 AI inline comment + 2 AI formal reviews = 3 items
        assert len(ai_feedback) == 3

        # Verify the AI reviews are included (not just comments)
        ai_bodies = [item.get("body", "") for item in ai_feedback]
        assert any("CodeRabbit Summary" in body for body in ai_bodies)
        assert any("Gemini Review" in body for body in ai_bodies)

        # Verify contributor review is NOT in AI feedback
        assert not any("LGTM" in body for body in ai_bodies)

        # Verify contributor review IS in contributor_comments
        contributor_feedback = context.contributor_comments_since_review
        contributor_bodies = [item.get("body", "") for item in contributor_feedback]
        assert any("LGTM" in body for body in contributor_bodies)

    @pytest.mark.asyncio
    async def test_ai_reviews_counted_correctly_in_logs(self, tmp_path):
        """Test that the logging correctly counts AI feedback including reviews."""
        previous_review = PRReviewResult(
            pr_number=42,
            repo="test/repo",
            success=True,
            findings=[],
            summary="Test",
            overall_status="approve",
            reviewed_commit_sha="abc123",
            reviewed_at=datetime.now().isoformat(),
        )

        mock_gh_client = AsyncMock()
        mock_gh_client.get_pr_head_sha.return_value = "def456"
        mock_gh_client.pr_get.return_value = {
            "mergeable": "MERGEABLE",
            "mergeStateStatus": "CLEAN",
        }
        mock_gh_client.get_pr_files_changed_since.return_value = ([], [])
        mock_gh_client.get_comments_since.return_value = {
            "review_comments": [],
            "issue_comments": [],
        }
        # 2 AI reviews, 1 contributor review
        mock_gh_client.get_reviews_since.return_value = [
            {"id": 1, "user": {"login": "coderabbitai[bot]"}, "body": "AI 1", "state": "COMMENTED"},
            {"id": 2, "user": {"login": "copilot[bot]"}, "body": "AI 2", "state": "COMMENTED"},
            {"id": 3, "user": {"login": "developer"}, "body": "Human", "state": "APPROVED"},
        ]

        gatherer = FollowupContextGatherer(
            project_dir=tmp_path,
            pr_number=42,
            previous_review=previous_review,
            repo="test/repo",
        )
        gatherer.gh_client = mock_gh_client
        context = await gatherer.gather()

        # 2 AI reviews should be in ai_bot_comments_since_review
        assert len(context.ai_bot_comments_since_review) == 2

        # 1 contributor review should be in contributor_comments_since_review
        assert len(context.contributor_comments_since_review) == 1

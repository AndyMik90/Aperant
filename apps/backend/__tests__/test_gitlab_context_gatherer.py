"""
Unit Tests for GitLab MR Context Gatherer Enhancements
======================================================

Tests for enhanced context gathering including monorepo detection,
related files finding, and AI bot comment detection.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Try imports with fallback for different environments
try:
    from runners.gitlab.services.context_gatherer import (
        CONFIG_FILE_NAMES,
        GITLAB_AI_BOT_PATTERNS,
        MRContextGatherer,
    )
except ImportError:
    from runners.gitlab.context_gatherer import (
        CONFIG_FILE_NAMES,
        GITLAB_AI_BOT_PATTERNS,
        MRContextGatherer,
    )


@pytest.fixture
def mock_client():
    """Create a mock GitLab client."""
    client = MagicMock()
    client.get_mr_async = AsyncMock()
    client.get_mr_changes_async = AsyncMock()
    client.get_mr_commits_async = AsyncMock()
    client.get_mr_notes_async = AsyncMock()
    client.get_mr_pipeline_async = AsyncMock()
    return client


@pytest.fixture
def sample_mr_data():
    """Sample MR data from GitLab API."""
    return {
        "iid": 123,
        "title": "Add new feature",
        "description": "This adds a cool feature",
        "author": {"username": "developer"},
        "source_branch": "feature-branch",
        "target_branch": "main",
        "state": "opened",
    }


@pytest.fixture
def sample_changes_data():
    """Sample MR changes data."""
    return {
        "changes": [
            {
                "new_path": "src/utils/helpers.py",
                "old_path": "src/utils/helpers.py",
                "diff": "@@ -1,1 +1,2 @@\n def helper():\n+    return True",
                "new_file": False,
                "deleted_file": False,
                "renamed_file": False,
            },
        ],
        "additions": 10,
        "deletions": 5,
    }


@pytest.fixture
def sample_commits():
    """Sample commit data."""
    return [
        {
            "id": "abc123",
            "short_id": "abc123",
            "title": "Add feature",
            "message": "Add feature",
        }
    ]


@pytest.fixture
def tmp_project_dir(tmp_path):
    """Create a temporary project directory with structure."""
    # Create monorepo structure
    (tmp_path / "apps").mkdir()
    (tmp_path / "apps" / "backend").mkdir()
    (tmp_path / "apps" / "frontend").mkdir()
    (tmp_path / "packages").mkdir()
    (tmp_path / "packages" / "shared").mkdir()

    # Create config files
    (tmp_path / "package.json").write_text(
        '{"workspaces": ["apps/*", "packages/*"]}', encoding="utf-8"
    )
    (tmp_path / "tsconfig.json").write_text(
        '{"compilerOptions": {"paths": {"@/*": ["src/*"]}}}', encoding="utf-8"
    )
    (tmp_path / ".gitlab-ci.yml").write_text("stages:\n  - test", encoding="utf-8")

    # Create source files
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "utils").mkdir()
    (tmp_path / "src" / "utils" / "helpers.py").write_text(
        "def helper():\n    return True", encoding="utf-8"
    )

    # Create test files
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_helpers.py").write_text(
        "def test_helper():\n    assert True", encoding="utf-8"
    )

    return tmp_path


@pytest.fixture
def gatherer(tmp_project_dir):
    """Create a context gatherer instance."""
    return MRContextGatherer(
        project_dir=tmp_project_dir,
        mr_iid=123,
        config=MagicMock(project="namespace/project", token="test-token"),
    )


class TestAIBotPatterns:
    """Test AI bot pattern detection."""

    def test_gitlab_ai_bot_patterns_comprehensive(self):
        """Test that AI bot patterns include major tools."""
        # Check for known AI tools
        assert "coderabbit" in GITLAB_AI_BOT_PATTERNS
        assert "greptile" in GITLAB_AI_BOT_PATTERNS
        assert "cursor" in GITLAB_AI_BOT_PATTERNS
        assert "sourcery-ai" in GITLAB_AI_BOT_PATTERNS
        assert "codium" in GITLAB_AI_BOT_PATTERNS

    def test_config_file_names_include_gitlab_ci(self):
        """Test that GitLab CI config is included."""
        assert ".gitlab-ci.yml" in CONFIG_FILE_NAMES


class TestRepoStructureDetection:
    """Test monorepo and project structure detection."""

    def test_detect_monorepo_apps(self, gatherer, tmp_project_dir):
        """Test detection of apps/ directory."""
        structure = gatherer._detect_repo_structure()

        assert "Monorepo Apps" in structure
        assert "backend" in structure
        assert "frontend" in structure

    def test_detect_monorepo_packages(self, gatherer, tmp_project_dir):
        """Test detection of packages/ directory."""
        structure = gatherer._detect_repo_structure()

        assert "Packages" in structure
        assert "shared" in structure

    def test_detect_workspaces(self, gatherer, tmp_project_dir):
        """Test detection of npm workspaces."""
        structure = gatherer._detect_repo_structure()

        assert "Workspaces" in structure

    def test_detect_gitlab_ci(self, gatherer, tmp_project_dir):
        """Test detection of GitLab CI config."""
        structure = gatherer._detect_repo_structure()

        assert "GitLab CI" in structure

    def test_detect_standard_repo(self, tmp_path):
        """Test detection of standard repo without monorepo structure."""
        gatherer = MRContextGatherer(
            project_dir=tmp_path,
            mr_iid=123,
            config=MagicMock(project="namespace/project"),
        )

        structure = gatherer._detect_repo_structure()

        assert "Standard single-package repository" in structure


class TestRelatedFilesFinding:
    """Test finding related files for context."""

    def test_find_test_files(self, gatherer, tmp_project_dir):
        """Test finding test files for a source file."""
        source_path = Path("src/utils/helpers.py")
        tests = gatherer._find_test_files(source_path)

        # Should find the test file we created
        assert "tests/test_helpers.py" in tests

    def test_find_config_files(self, gatherer, tmp_project_dir):
        """Test finding config files in directory."""
        directory = Path(tmp_project_dir)
        configs = gatherer._find_config_files(directory)

        # Should find config files in root
        assert "package.json" in configs
        assert "tsconfig.json" in configs
        assert ".gitlab-ci.yml" in configs

    def test_find_type_definitions(self, gatherer, tmp_project_dir):
        """Test finding TypeScript type definition files."""
        # Create a TypeScript file
        (tmp_project_dir / "src" / "types.ts").write_text(
            "export type Foo = string;", encoding="utf-8"
        )
        (tmp_project_dir / "src" / "types.d.ts").write_text(
            "export type Bar = number;", encoding="utf-8"
        )

        source_path = Path("src/types.ts")
        type_defs = gatherer._find_type_definitions(source_path)

        assert "src/types.d.ts" in type_defs

    def test_find_dependents_limits_generic_names(self, gatherer, tmp_project_dir):
        """Test that generic names are skipped in dependent finding."""
        # Generic names should be skipped to avoid too many matches
        for stem in ["index", "main", "app", "utils", "helpers", "types", "constants"]:
            result = gatherer._find_dependents(f"src/{stem}.py")
            assert result == set()  # Should skip generic names

    def test_prioritize_related_files(self, gatherer):
        """Test prioritization of related files."""
        files = {
            "tests/test_utils.py",  # Test file - highest priority
            "src/utils.d.ts",  # Type definition - high priority
            "tsconfig.json",  # Config - medium priority
            "src/random.py",  # Other - low priority
        }

        prioritized = gatherer._prioritize_related_files(files, limit=10)

        # Test files should come first
        assert prioritized[0] == "tests/test_utils.py"
        assert "src/utils.d.ts" in prioritized[1:3]  # Type files next
        assert "tsconfig.json" in prioritized  # Configs included


class TestJSONLoading:
    """Test JSON loading with comment handling."""

    def test_load_json_safe_standard(self, gatherer, tmp_project_dir):
        """Test loading standard JSON without comments."""
        (tmp_project_dir / "standard.json").write_text(
            '{"key": "value"}', encoding="utf-8"
        )

        result = gatherer._load_json_safe("standard.json")

        assert result == {"key": "value"}

    def test_load_json_safe_with_comments(self, gatherer, tmp_project_dir):
        """Test loading JSON with tsconfig-style comments."""
        (tmp_project_dir / "with-comments.json").write_text(
            "{\n"
            "  // Single-line comment\n"
            '  "key": "value",\n'
            "  /* Multi-line\n"
            "     comment */\n"
            '  "key2": "value2"\n'
            "}",
            encoding="utf-8",
        )

        result = gatherer._load_json_safe("with-comments.json")

        assert result == {"key": "value", "key2": "value2"}

    def test_load_json_safe_nonexistent(self, gatherer, tmp_project_dir):
        """Test loading non-existent JSON file."""
        result = gatherer._load_json_safe("nonexistent.json")

        assert result is None

    def test_load_tsconfig_paths(self, gatherer, tmp_project_dir):
        """Test loading tsconfig paths."""
        result = gatherer._load_tsconfig_paths()

        assert result is not None
        assert "@/*" in result
        assert "src/*" in result["@/*"]


class TestStaticMethods:
    """Test static utility methods."""

    def test_find_related_files_for_root(self, tmp_project_dir):
        """Test static method for finding related files."""
        changed_files = [
            {"new_path": "src/utils/helpers.py", "old_path": "src/utils/helpers.py"},
        ]

        related = MRContextGatherer.find_related_files_for_root(
            changed_files=changed_files,
            project_root=tmp_project_dir,
        )

        # Should find test file
        assert "tests/test_helpers.py" in related
        # Should not include the changed file itself
        assert "src/utils/helpers.py" not in related


@pytest.mark.asyncio
class TestGatherIntegration:
    """Test the full gather method integration."""

    async def test_gather_with_enhancements(
        self, gatherer, mock_client, sample_mr_data, sample_changes_data, sample_commits
    ):
        """Test that gather includes repo structure and related files."""
        # Setup mock responses
        mock_client.get_mr_async.return_value = sample_mr_data
        mock_client.get_mr_changes_async.return_value = sample_changes_data
        mock_client.get_mr_commits_async.return_value = sample_commits
        mock_client.get_mr_notes_async.return_value = []
        mock_client.get_mr_pipeline_async.return_value = {
            "id": 456,
            "status": "success",
        }

        result = await gatherer.gather()

        # Verify enhanced fields are populated
        assert result.mr_iid == 123
        assert result.repo_structure != ""
        assert (
            "Monorepo" in result.repo_structure or "Standard" in result.repo_structure
        )
        assert isinstance(result.related_files, list)
        assert result.ci_status == "success"
        assert result.ci_pipeline_id == 456

    @pytest.mark.asyncio
    async def test_gather_handles_missing_ci(
        self, gatherer, mock_client, sample_mr_data, sample_changes_data, sample_commits
    ):
        """Test that gather handles missing CI pipeline gracefully."""
        mock_client.get_mr_async.return_value = sample_mr_data
        mock_client.get_mr_changes_async.return_value = sample_changes_data
        mock_client.get_mr_commits_async.return_value = sample_commits
        mock_client.get_mr_notes_async.return_value = []
        mock_client.get_mr_pipeline_async.return_value = None

        result = await gatherer.gather()

        # Should not fail, CI fields should be None
        assert result.ci_status is None
        assert result.ci_pipeline_id is None


class TestAIBotCommentDetection:
    """Test AI bot comment detection and parsing."""

    def test_parse_ai_comment_known_tool(self, gatherer):
        """Test parsing comment from known AI tool."""
        note = {
            "id": 1,
            "author": {"username": "coderabbit[bot]"},
            "body": "Consider using async/await here",
            "created_at": "2024-01-01T00:00:00Z",
        }

        result = gatherer._parse_ai_comment(note)

        assert result is not None
        assert result.tool_name == "CodeRabbit"
        assert result.author == "coderabbit[bot]"

    def test_parse_ai_comment_unknown_user(self, gatherer):
        """Test parsing comment from unknown user."""
        note = {
            "id": 1,
            "author": {"username": "developer"},
            "body": "Just a regular comment",
            "created_at": "2024-01-01T00:00:00Z",
        }

        result = gatherer._parse_ai_comment(note)

        assert result is None

    def test_parse_ai_comment_no_author(self, gatherer):
        """Test parsing comment with no author."""
        note = {
            "id": 1,
            "body": "Anonymous comment",
            "created_at": "2024-01-01T00:00:00Z",
        }

        result = gatherer._parse_ai_comment(note)

        assert result is None


class TestValidation:
    """Test input validation functions."""

    def test_validate_git_ref_valid(self):
        """Test validation of valid git refs."""
        from runners.gitlab.services.context_gatherer import _validate_git_ref

        assert _validate_git_ref("main") is True
        assert _validate_git_ref("feature-branch") is True
        assert _validate_git_ref("feature/branch-123") is True
        assert _validate_git_ref("abc123def456") is True

    def test_validate_git_ref_invalid(self):
        """Test validation rejects invalid git refs."""
        from runners.gitlab.services.context_gatherer import _validate_git_ref

        assert _validate_git_ref("") is False  # Empty
        assert _validate_git_ref("a" * 300) is False  # Too long
        assert _validate_git_ref("branch;rm -rf") is False  # Invalid chars

    def test_validate_file_path_valid(self):
        """Test validation of valid file paths."""
        from runners.gitlab.services.context_gatherer import _validate_file_path

        assert _validate_file_path("src/file.py") is True
        assert _validate_file_path("src/utils/helpers.ts") is True
        assert _validate_file_path("src/config.json") is True

    def test_validate_file_path_invalid(self):
        """Test validation rejects invalid file paths."""
        from runners.gitlab.services.context_gatherer import _validate_file_path

        assert _validate_file_path("") is False  # Empty
        assert _validate_file_path("../etc/passwd") is False  # Path traversal
        assert _validate_file_path("/etc/passwd") is False  # Absolute path
        assert _validate_file_path("a" * 1100) is False  # Too long

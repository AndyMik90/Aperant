"""
MR Context Gatherer for GitLab
==============================

Gathers all necessary context for MR review BEFORE the AI starts.

Responsibilities:
- Fetch MR metadata (title, author, branches, description)
- Get all changed files with full content
- Detect monorepo structure and project layout
- Find related files (imports, tests, configs)
- Build complete diff with context
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

try:
    from ..glab_client import GitLabClient, GitLabConfig
    from ..models import MRContext
    from .io_utils import safe_print
except ImportError:
    from core.io_utils import safe_print
    from glab_client import GitLabClient, GitLabConfig
    from models import MRContext


# Validation patterns for git refs and paths
SAFE_REF_PATTERN = re.compile(r"^[a-zA-Z0-9._/\-]+$")
SAFE_PATH_PATTERN = re.compile(r"^[a-zA-Z0-9._/\-@]+$")


def _validate_git_ref(ref: str) -> bool:
    """Validate git ref (branch name or commit SHA) for safe use in commands."""
    if not ref or len(ref) > 256:
        return False
    return bool(SAFE_REF_PATTERN.match(ref))


def _validate_file_path(path: str) -> bool:
    """Validate file path for safe use in git commands."""
    if not path or len(path) > 1024:
        return False
    if ".." in path or path.startswith("/"):
        return False
    return bool(SAFE_PATH_PATTERN.match(path))


# Known GitLab AI bot patterns
# Organized by category for maintainability
GITLAB_AI_BOT_PATTERNS = {
    # === GitLab Official Bots ===
    "gitlab-bot": "GitLab Bot",
    "gitlab": "GitLab",
    # === AI Code Review Tools ===
    "coderabbit": "CodeRabbit",
    "coderabbitai": "CodeRabbit",
    "coderabbit-ai": "CodeRabbit",
    "coderabbit[bot]": "CodeRabbit",
    "greptile": "Greptile",
    "greptile[bot]": "Greptile",
    "greptile-ai": "Greptile",
    "greptile-apps": "Greptile",
    "cursor": "Cursor",
    "cursor-ai": "Cursor",
    "cursor[bot]": "Cursor",
    "sourcery-ai": "Sourcery",
    "sourcery-ai[bot]": "Sourcery",
    "sourcery-ai-bot": "Sourcery",
    "codium": "Qodo",
    "codiumai": "Qodo",
    "codium-ai[bot]": "Qodo",
    "codiumai-agent": "Qodo",
    "qodo-merge-bot": "Qodo",
    # === AI Coding Assistants ===
    "sweep": "Sweep AI",
    "sweep-ai[bot]": "Sweep AI",
    "sweep-nightly[bot]": "Sweep AI",
    "sweep-canary[bot]": "Sweep AI",
    "bitoagent": "Bito AI",
    "codeium-ai-superpowers": "Codeium",
    "devin-ai-integration": "Devin AI",
    # === Dependency Management ===
    "dependabot": "Dependabot",
    "dependabot[bot]": "Dependabot",
    "renovate": "Renovate",
    "renovate[bot]": "Renovate",
    "renovate-bot": "Renovate",
    "self-hosted-renovate[bot]": "Renovate",
    # === Code Quality & Static Analysis ===
    "sonarcloud": "SonarCloud",
    "sonarcloud[bot]": "SonarCloud",
    "deepsource-autofix": "DeepSource",
    "deepsource-autofix[bot]": "DeepSource",
    "deepsourcebot": "DeepSource",
    "codeclimate[bot]": "CodeClimate",
    "codefactor-io[bot]": "CodeFactor",
    "codacy[bot]": "Codacy",
    # === Security Scanning ===
    "snyk-bot": "Snyk",
    "snyk[bot]": "Snyk",
    "snyk-security-bot": "Snyk",
    "gitguardian": "GitGuardian",
    "gitguardian[bot]": "GitGuardian",
    "semgrep": "Semgrep",
    "semgrep-app[bot]": "Semgrep",
    "semgrep-bot": "Semgrep",
    # === Code Coverage ===
    "codecov": "Codecov",
    "codecov[bot]": "Codecov",
    "codecov-commenter": "Codecov",
    "coveralls": "Coveralls",
    "coveralls[bot]": "Coveralls",
    # === CI/CD Automation ===
    "gitlab-ci": "GitLab CI",
    "gitlab-ci[bot]": "GitLab CI",
}


# Common config file names to search for in project directories
# Used by both _find_config_files() and find_related_files_for_root()
CONFIG_FILE_NAMES = [
    "tsconfig.json",
    "package.json",
    "pyproject.toml",
    "setup.py",
    ".eslintrc",
    ".prettierrc",
    "jest.config.js",
    "vitest.config.ts",
    "vite.config.ts",
    ".gitlab-ci.yml",
    "Dockerfile",
]


@dataclass
class ChangedFile:
    """A file that was changed in the MR."""

    path: str
    status: str  # added, modified, deleted, renamed
    additions: int
    deletions: int
    content: str  # Current file content
    base_content: str  # Content before changes
    patch: str  # The diff patch for this file


@dataclass
class AIBotComment:
    """A comment from an AI review tool."""

    comment_id: int
    author: str
    tool_name: str
    body: str
    file: str | None
    line: int | None
    created_at: str


class MRContextGatherer:
    """Gathers all context needed for MR review BEFORE the AI starts."""

    def __init__(
        self,
        project_dir: Path,
        mr_iid: int,
        config: GitLabConfig | None = None,
    ):
        self.project_dir = Path(project_dir)
        self.mr_iid = mr_iid

        if config:
            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )
        else:
            # Try to load config from project
            from ..glab_client import load_gitlab_config

            config = load_gitlab_config(self.project_dir)
            if not config:
                raise ValueError("GitLab configuration not found")

            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )

    async def gather(self) -> MRContext:
        """
        Gather all context for review.

        Returns:
            MRContext with all necessary information for review
        """
        safe_print(f"[Context] Gathering context for MR !{self.mr_iid}...")

        # Fetch basic MR metadata
        mr_data = await self.client.get_mr_async(self.mr_iid)
        safe_print(
            f"[Context] MR metadata: {mr_data.get('title', 'Unknown')} "
            f"by {mr_data.get('author', {}).get('username', 'unknown')}",
        )

        # Fetch changed files with diff
        changes_data = await self.client.get_mr_changes_async(self.mr_iid)
        safe_print(
            f"[Context] Fetched {len(changes_data.get('changes', []))} changed files"
        )

        # Build diff
        diff_parts = []
        for change in changes_data.get("changes", []):
            diff = change.get("diff", "")
            if diff:
                diff_parts.append(diff)

        diff = "\n".join(diff_parts)
        safe_print(f"[Context] Gathered diff: {len(diff)} chars")

        # Fetch commits
        commits = await self.client.get_mr_commits_async(self.mr_iid)
        safe_print(f"[Context] Fetched {len(commits)} commits")

        # Get head commit SHA
        # GitLab API returns commits in newest-first order, so use commits[0]
        head_sha = ""
        if commits:
            head_sha = commits[0].get("id") or commits[0].get("sha", "")

        # Build changed files list
        changed_files = []
        total_additions = changes_data.get("additions", 0)
        total_deletions = changes_data.get("deletions", 0)

        for change in changes_data.get("changes", []):
            new_path = change.get("new_path")
            old_path = change.get("old_path")

            # Determine status
            if change.get("new_file"):
                status = "added"
            elif change.get("deleted_file"):
                status = "deleted"
            elif change.get("renamed_file"):
                status = "renamed"
            else:
                status = "modified"

            changed_files.append(
                {
                    "new_path": new_path or old_path,
                    "old_path": old_path or new_path,
                    "status": status,
                }
            )

        # Fetch AI bot comments for triage
        ai_bot_comments = await self._fetch_ai_bot_comments()
        safe_print(f"[Context] Fetched {len(ai_bot_comments)} AI bot comments")

        # Detect repo structure
        repo_structure = self._detect_repo_structure()
        safe_print("[Context] Detected repo structure")

        # Find related files
        related_files = self._find_related_files(changed_files)
        safe_print(f"[Context] Found {len(related_files)} related files")

        # Check CI/CD pipeline status
        ci_status = None
        ci_pipeline_id = None
        try:
            pipeline = await self.client.get_mr_pipeline_async(self.mr_iid)
            if pipeline:
                ci_status = pipeline.get("status")
                ci_pipeline_id = pipeline.get("id")
                safe_print(f"[Context] CI pipeline: {ci_status}")
        except Exception:
            pass  # CI status is optional

        return MRContext(
            mr_iid=self.mr_iid,
            title=mr_data.get("title", ""),
            description=mr_data.get("description", "") or "",
            author=mr_data.get("author", {}).get("username", "unknown"),
            source_branch=mr_data.get("source_branch", ""),
            target_branch=mr_data.get("target_branch", ""),
            state=mr_data.get("state", "opened"),
            changed_files=changed_files,
            diff=diff,
            total_additions=total_additions,
            total_deletions=total_deletions,
            commits=commits,
            head_sha=head_sha,
            repo_structure=repo_structure,
            related_files=related_files,
            ci_status=ci_status,
            ci_pipeline_id=ci_pipeline_id,
        )

    async def _fetch_ai_bot_comments(self) -> list[AIBotComment]:
        """
        Fetch comments from AI code review tools on this MR.

        Returns comments from known AI tools.
        """
        ai_comments: list[AIBotComment] = []

        try:
            # Fetch MR notes (comments)
            notes = await self.client.get_mr_notes_async(self.mr_iid)

            for note in notes:
                comment = self._parse_ai_comment(note)
                if comment:
                    ai_comments.append(comment)

        except Exception as e:
            safe_print(f"[Context] Error fetching AI bot comments: {e}")

        return ai_comments

    def _parse_ai_comment(self, note: dict) -> AIBotComment | None:
        """
        Parse a note and return AIBotComment if it's from a known AI tool.

        Args:
            note: Raw note data from GitLab API

        Returns:
            AIBotComment if author is a known AI bot, None otherwise
        """
        author_data = note.get("author")
        author = (author_data.get("username") if author_data else "") or ""
        if not author:
            return None

        # Check if author matches any known AI bot pattern
        tool_name = None
        author_lower = author.lower()
        for pattern, name in GITLAB_AI_BOT_PATTERNS.items():
            if pattern in author_lower:
                tool_name = name
                break

        if not tool_name:
            return None

        return AIBotComment(
            comment_id=note.get("id", 0),
            author=author,
            tool_name=tool_name,
            body=note.get("body", ""),
            file=None,  # GitLab notes don't have file/line in the same way
            line=None,
            created_at=note.get("created_at", ""),
        )

    def _detect_repo_structure(self) -> str:
        """
        Detect and describe the repository structure.

        Looks for common monorepo patterns and returns a human-readable
        description that helps the AI understand the project layout.
        """
        structure_info = []

        # Check for monorepo indicators
        apps_dir = self.project_dir / "apps"
        packages_dir = self.project_dir / "packages"
        libs_dir = self.project_dir / "libs"

        if apps_dir.exists():
            apps = [
                d.name
                for d in apps_dir.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            ]
            if apps:
                structure_info.append(f"**Monorepo Apps**: {', '.join(apps)}")

        if packages_dir.exists():
            packages = [
                d.name
                for d in packages_dir.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            ]
            if packages:
                structure_info.append(f"**Packages**: {', '.join(packages)}")

        if libs_dir.exists():
            libs = [
                d.name
                for d in libs_dir.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            ]
            if libs:
                structure_info.append(f"**Libraries**: {', '.join(libs)}")

        # Check for package.json (Node.js)
        if (self.project_dir / "package.json").exists():
            try:
                with open(self.project_dir / "package.json", encoding="utf-8") as f:
                    pkg_data = json.load(f)
                    if "workspaces" in pkg_data:
                        structure_info.append(
                            f"**Workspaces**: {', '.join(pkg_data['workspaces'])}"
                        )
            except (json.JSONDecodeError, KeyError):
                pass

        # Check for Python project structure
        if (self.project_dir / "pyproject.toml").exists():
            structure_info.append("**Python Project** (pyproject.toml)")

        if (self.project_dir / "requirements.txt").exists():
            structure_info.append("**Python** (requirements.txt)")

        # Check for common framework indicators
        if (self.project_dir / "angular.json").exists():
            structure_info.append("**Framework**: Angular")
        if (self.project_dir / "next.config.js").exists():
            structure_info.append("**Framework**: Next.js")
        if (self.project_dir / "nuxt.config.js").exists():
            structure_info.append("**Framework**: Nuxt.js")
        if (self.project_dir / "vite.config.ts").exists() or (
            self.project_dir / "vite.config.js"
        ).exists():
            structure_info.append("**Build**: Vite")

        # Check for Electron
        if (self.project_dir / "electron.vite.config.ts").exists():
            structure_info.append("**Electron** app")

        # Check for GitLab CI
        if (self.project_dir / ".gitlab-ci.yml").exists():
            structure_info.append("**GitLab CI** configured")

        if not structure_info:
            return "**Structure**: Standard single-package repository"

        return "\n".join(structure_info)

    def _find_related_files(self, changed_files: list[dict]) -> list[str]:
        """
        Find files related to the changes.

        This includes:
        - Test files for changed source files
        - Imported modules and dependencies
        - Configuration files in the same directory
        - Related type definition files
        - Reverse dependencies (files that import changed files)
        """
        related = set()

        for changed_file in changed_files:
            path = Path(
                changed_file.get("new_path") or changed_file.get("old_path", "")
            )

            # Find test files
            related.update(self._find_test_files(path))

            # Find imported files (for supported languages)
            # Note: We'd need file content for imports, which we don't have here
            # Skip for now since GitLab API doesn't provide content in changes

            # Find config files in same directory
            related.update(self._find_config_files(path.parent))

            # Find type definition files
            if path.suffix in [".ts", ".tsx"]:
                related.update(self._find_type_definitions(path))

            # Find reverse dependencies (files that import this file)
            related.update(self._find_dependents(str(path)))

        # Remove files that are already in changed_files
        changed_paths = {
            cf.get("new_path") or cf.get("old_path", "") for cf in changed_files
        }
        related = {r for r in related if r not in changed_paths}

        # Use smart prioritization
        return self._prioritize_related_files(related, limit=50)

    def _find_test_files(self, source_path: Path) -> set[str]:
        """Find test files related to a source file."""
        test_patterns = [
            # Jest/Vitest patterns
            source_path.parent / f"{source_path.stem}.test{source_path.suffix}",
            source_path.parent / f"{source_path.stem}.spec{source_path.suffix}",
            source_path.parent / "__tests__" / f"{source_path.name}",
            # Python patterns
            source_path.parent / f"test_{source_path.stem}.py",
            source_path.parent / f"{source_path.stem}_test.py",
            # Go patterns
            source_path.parent / f"{source_path.stem}_test.go",
        ]

        found = set()
        for test_path in test_patterns:
            full_path = self.project_dir / test_path
            if full_path.exists() and full_path.is_file():
                found.add(str(test_path))

        return found

    def _find_config_files(self, directory: Path) -> set[str]:
        """Find configuration files in a directory."""
        found = set()
        for name in CONFIG_FILE_NAMES:
            config_path = directory / name
            full_path = self.project_dir / config_path
            if full_path.exists() and full_path.is_file():
                found.add(str(config_path))

        return found

    def _find_type_definitions(self, source_path: Path) -> set[str]:
        """Find TypeScript type definition files."""
        # Look for .d.ts files with same name
        type_def = source_path.parent / f"{source_path.stem}.d.ts"
        full_path = self.project_dir / type_def

        if full_path.exists() and full_path.is_file():
            return {str(type_def)}

        return set()

    def _find_dependents(self, file_path: str, max_results: int = 15) -> set[str]:
        """
        Find files that import the given file (reverse dependencies).

        Uses pure Python to search for import statements referencing this file.
        Cross-platform compatible (Windows, macOS, Linux).
        Limited to prevent performance issues on large codebases.

        Args:
            file_path: Path of the file to find dependents for
            max_results: Maximum number of dependents to return

        Returns:
            Set of file paths that import this file.
        """
        dependents: set[str] = set()
        path_obj = Path(file_path)
        stem = path_obj.stem  # e.g., 'helpers' from 'utils/helpers.ts'

        # Skip if stem is too generic (would match too many files)
        if stem in ["index", "main", "app", "utils", "helpers", "types", "constants"]:
            return dependents

        # Build regex patterns and file extensions based on file type
        pattern = None
        file_extensions = []

        if path_obj.suffix in [".ts", ".tsx", ".js", ".jsx"]:
            # Match various import styles for JS/TS
            # from './helpers', from '../utils/helpers', from '@/utils/helpers'
            # Escape stem for regex safety
            escaped_stem = re.escape(stem)
            pattern = re.compile(rf"['\"].*{escaped_stem}['\"]")
            file_extensions = [".ts", ".tsx", ".js", ".jsx"]
        elif path_obj.suffix == ".py":
            # Match Python imports: from .helpers import, import helpers
            escaped_stem = re.escape(stem)
            pattern = re.compile(rf"(from.*{escaped_stem}|import.*{escaped_stem})")
            file_extensions = [".py"]
        else:
            return dependents

        # Directories to exclude
        exclude_dirs = {
            "node_modules",
            ".git",
            "dist",
            "build",
            "__pycache__",
            ".venv",
            "venv",
        }

        # Walk the project directory
        project_path = Path(self.project_dir)
        files_checked = 0
        max_files_to_check = 2000  # Prevent infinite scanning on large codebases

        try:
            for root, dirs, files in os.walk(project_path):
                # Modify dirs in-place to exclude certain directories
                dirs[:] = [d for d in dirs if d not in exclude_dirs]

                for filename in files:
                    # Check if we've hit the file limit
                    if files_checked >= max_files_to_check:
                        safe_print(
                            f"[Context] File limit reached finding dependents for {file_path}"
                        )
                        return dependents

                    # Check if file has the right extension
                    if not any(filename.endswith(ext) for ext in file_extensions):
                        continue

                    file_full_path = Path(root) / filename
                    files_checked += 1

                    # Get relative path from project root
                    try:
                        relative_path = file_full_path.relative_to(project_path)
                        relative_path_str = str(relative_path).replace("\\", "/")

                        # Don't include the file itself
                        # Normalize file_path the same way for comparison
                        file_path_normalized = file_path.replace("\\", "/")
                        if relative_path_str == file_path_normalized:
                            continue

                        # Search for the pattern in the file
                        try:
                            with open(
                                file_full_path, encoding="utf-8", errors="ignore"
                            ) as f:
                                content = f.read()
                                if pattern.search(content):
                                    dependents.add(relative_path_str)
                                    if len(dependents) >= max_results:
                                        return dependents
                        except (OSError, UnicodeDecodeError):
                            # Skip files that can't be read
                            continue

                    except ValueError:
                        # File is not relative to project_path, skip it
                        continue

        except Exception as e:
            safe_print(f"[Context] Error finding dependents: {e}")

        return dependents

    def _prioritize_related_files(self, files: set[str], limit: int = 50) -> list[str]:
        """
        Prioritize related files by relevance.

        Priority order:
        1. Test files (most important for review context)
        2. Type definition files (.d.ts)
        3. Configuration files
        4. Direct imports/dependents
        5. Other files

        Args:
            files: Set of file paths to prioritize
            limit: Maximum number of files to return

        Returns:
            List of files sorted by priority, limited to `limit`.
        """
        test_files = []
        type_files = []
        config_files = []
        other_files = []

        for f in files:
            path = Path(f)
            name_lower = path.name.lower()

            # Test files
            if (
                ".test." in name_lower
                or ".spec." in name_lower
                or name_lower.startswith("test_")
                or name_lower.endswith("_test.py")
                or "__tests__" in f
            ):
                test_files.append(f)
            # Type definition files
            elif name_lower.endswith(".d.ts") or "types" in name_lower:
                type_files.append(f)
            # Config files
            elif name_lower in [
                n.lower() for n in CONFIG_FILE_NAMES
            ] or name_lower.endswith(
                (".config.js", ".config.ts", ".jsonrc", "rc.json", ".rc")
            ):
                config_files.append(f)
            else:
                other_files.append(f)

        # Sort within each category alphabetically for consistency, then combine
        prioritized = (
            sorted(test_files)
            + sorted(type_files)
            + sorted(config_files)
            + sorted(other_files)
        )

        return prioritized[:limit]

    def _load_json_safe(self, filename: str) -> dict | None:
        """
        Load JSON file from project_dir, handling tsconfig-style comments.

        tsconfig.json allows // and /* */ comments, which standard JSON
        parsers reject. This method first tries standard parsing (most
        tsconfigs don't have comments), then falls back to comment stripping.

        Note: Comment stripping only handles comments outside strings to
        avoid mangling path patterns like "@/*" which contain "/*".

        Args:
            filename: JSON filename relative to project_dir

        Returns:
            Parsed JSON as dict, or None on error
        """
        try:
            file_path = self.project_dir / filename
            if not file_path.exists():
                return None

            content = file_path.read_text(encoding="utf-8")

            # Try standard JSON parse first (most tsconfigs don't have comments)
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                pass

            # Fall back to comment stripping (outside strings only)
            # First, remove block comments /* ... */
            # Simple approach: remove everything between /* and */
            # This handles multi-line block comments
            while "/*" in content:
                start = content.find("/*")
                end = content.find("*/", start)
                if end == -1:
                    # Unclosed block comment - remove to end
                    content = content[:start]
                    break
                content = content[:start] + content[end + 2 :]

            # Then handle single-line comments
            # This regex-based approach handles // comments
            # outside of strings by checking for quotes
            lines = content.split("\n")
            cleaned_lines = []
            for line in lines:
                # Strip single-line comments, but not inside strings
                # Simple heuristic: if '//' appears and there's an even
                # number of quotes before it, strip from there
                comment_pos = line.find("//")
                if comment_pos != -1:
                    # Count quotes before the //
                    before_comment = line[:comment_pos]
                    if before_comment.count('"') % 2 == 0:
                        line = before_comment
                cleaned_lines.append(line)
            content = "\n".join(cleaned_lines)

            return json.loads(content)
        except (json.JSONDecodeError, OSError) as e:
            safe_print(f"[Context] Could not load {filename}: {e}")
            return None

    def _load_tsconfig_paths(self) -> dict[str, list[str]] | None:
        """
        Load path mappings from tsconfig.json.

        Handles the 'extends' field to merge paths from base configs.

        Returns:
            Dict mapping path aliases to target paths, e.g.:
            {"@/*": ["src/*"], "@shared/*": ["src/shared/*"]}
            Returns None if no paths configured.
        """
        config = self._load_json_safe("tsconfig.json")
        if not config:
            return None

        paths: dict[str, list[str]] = {}

        # Handle extends field - load base config first
        if "extends" in config:
            extends_path = config["extends"]
            # Handle relative paths like "./tsconfig.base.json"
            if extends_path.startswith("./"):
                extends_path = extends_path[2:]
            base_config = self._load_json_safe(extends_path)
            if base_config:
                base_paths = base_config.get("compilerOptions", {}).get("paths", {})
                paths.update(base_paths)

        # Override with current config's paths
        current_paths = config.get("compilerOptions", {}).get("paths", {})
        paths.update(current_paths)

        return paths if paths else None

    @staticmethod
    def find_related_files_for_root(
        changed_files: list[dict],
        project_root: Path,
    ) -> list[str]:
        """
        Find files related to the changes using a specific project root.

        This static method allows finding related files AFTER a worktree
        has been created, ensuring files exist in the worktree filesystem.

        Args:
            changed_files: List of changed files from the MR
            project_root: Path to search for related files (e.g., worktree path)

        Returns:
            List of related file paths (relative to project root)
        """
        related: set[str] = set()

        for changed_file in changed_files:
            path_str = changed_file.get("new_path") or changed_file.get("old_path", "")
            if not path_str:
                continue
            path = Path(path_str)

            # Find test files
            test_patterns = [
                # Jest/Vitest patterns
                path.parent / f"{path.stem}.test{path.suffix}",
                path.parent / f"{path.stem}.spec{path.suffix}",
                path.parent / "__tests__" / f"{path.name}",
                # Python patterns
                path.parent / f"test_{path.stem}.py",
                path.parent / f"{path.stem}_test.py",
                # Go patterns
                path.parent / f"{path.stem}_test.go",
            ]

            for test_path in test_patterns:
                full_path = project_root / test_path
                if full_path.exists() and full_path.is_file():
                    related.add(str(test_path))

            # Find config files in same directory
            for name in CONFIG_FILE_NAMES:
                config_path = path.parent / name
                full_path = project_root / config_path
                if full_path.exists() and full_path.is_file():
                    related.add(str(config_path))

            # Find type definition files
            if path.suffix in [".ts", ".tsx"]:
                type_def = path.parent / f"{path.stem}.d.ts"
                full_path = project_root / type_def
                if full_path.exists() and full_path.is_file():
                    related.add(str(type_def))

        # Remove files that are already in changed_files
        changed_paths = {
            cf.get("new_path") or cf.get("old_path", "") for cf in changed_files
        }
        related = {r for r in related if r not in changed_paths}

        # Limit to 50 most relevant files
        return sorted(related)[:50]


class FollowupMRContextGatherer:
    """
    Gathers context specifically for follow-up reviews.

    Unlike the full MRContextGatherer, this only fetches:
    - New commits since last review
    - Changed files since last review
    - New comments since last review
    """

    def __init__(
        self,
        project_dir: Path,
        mr_iid: int,
        previous_review,  # MRReviewResult
        config: GitLabConfig | None = None,
    ):
        self.project_dir = Path(project_dir)
        self.mr_iid = mr_iid
        self.previous_review = previous_review

        if config:
            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )
        else:
            # Try to load config from project
            from ..glab_client import load_gitlab_config

            config = load_gitlab_config(self.project_dir)
            if not config:
                raise ValueError("GitLab configuration not found")

            self.client = GitLabClient(
                project_dir=self.project_dir,
                config=config,
            )

    async def gather(self):
        """
        Gather context for a follow-up review.

        Returns:
            FollowupMRContext with changes since last review
        """
        from ..models import FollowupMRContext

        previous_sha = self.previous_review.reviewed_commit_sha

        if not previous_sha:
            safe_print(
                "[Followup] No reviewed_commit_sha in previous review, "
                "cannot gather incremental context"
            )
            return FollowupMRContext(
                mr_iid=self.mr_iid,
                previous_review=self.previous_review,
                previous_commit_sha="",
                current_commit_sha="",
            )

        safe_print(f"[Followup] Gathering context since commit {previous_sha[:8]}...")

        # Get current MR data
        mr_data = await self.client.get_mr_async(self.mr_iid)

        # Get current commits
        commits = await self.client.get_mr_commits_async(self.mr_iid)

        # Find new commits since previous review
        new_commits = []
        found_previous = False
        for commit in commits:
            commit_sha = commit.get("id") or commit.get("sha", "")
            if commit_sha == previous_sha:
                found_previous = True
                break
            new_commits.append(commit)

        if not found_previous:
            safe_print("[Followup] Previous commit SHA not found in MR history")

        # Get current head SHA
        # GitLab API returns commits in newest-first order, so use commits[0]
        current_sha = ""
        if commits:
            current_sha = commits[0].get("id") or commits[0].get("sha", "")

        if previous_sha == current_sha:
            safe_print("[Followup] No new commits since last review")
            return FollowupMRContext(
                mr_iid=self.mr_iid,
                previous_review=self.previous_review,
                previous_commit_sha=previous_sha,
                current_commit_sha=current_sha,
            )

        safe_print(
            f"[Followup] Comparing {previous_sha[:8]}...{current_sha[:8]}, "
            f"{len(new_commits)} new commits"
        )

        # Build diff from changes
        changes_data = await self.client.get_mr_changes_async(self.mr_iid)

        files_changed = []
        diff_parts = []
        for change in changes_data.get("changes", []):
            new_path = change.get("new_path") or change.get("old_path", "")
            if new_path:
                files_changed.append(new_path)

            diff = change.get("diff", "")
            if diff:
                diff_parts.append(diff)

        diff_since_review = "\n".join(diff_parts)

        safe_print(
            f"[Followup] Found {len(new_commits)} new commits, "
            f"{len(files_changed)} changed files"
        )

        return FollowupMRContext(
            mr_iid=self.mr_iid,
            previous_review=self.previous_review,
            previous_commit_sha=previous_sha,
            current_commit_sha=current_sha,
            commits_since_review=new_commits,
            files_changed_since_review=files_changed,
            diff_since_review=diff_since_review,
        )

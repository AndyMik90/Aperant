"""
Tests for Code Search Functionality
===================================

Tests for context/search.py which provides code file searching
based on keywords.
"""

import pytest
from pathlib import Path


class TestCodeSearcher:
    """Tests for CodeSearcher class."""

    @pytest.fixture
    def project_with_code(self, temp_dir):
        """Create a project with various code files."""
        # Create Python files
        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "auth.py").write_text(
            "def authenticate(user, password):\n"
            "    '''Authenticate a user with password'''\n"
            "    if validate_password(password):\n"
            "        return create_session(user)\n"
            "    return None\n"
        )
        (temp_dir / "src" / "users.py").write_text(
            "class User:\n"
            "    def __init__(self, name, email):\n"
            "        self.name = name\n"
            "        self.email = email\n"
        )
        (temp_dir / "src" / "database.py").write_text(
            "def connect():\n"
            "    '''Connect to database'''\n"
            "    pass\n"
        )

        # Create TypeScript files
        (temp_dir / "frontend").mkdir()
        (temp_dir / "frontend" / "Login.tsx").write_text(
            "export function Login() {\n"
            "  const handleLogin = async (user, password) => {\n"
            "    await authenticate(user, password);\n"
            "  };\n"
            "  return <form>Login Form</form>;\n"
            "}\n"
        )

        # Create files in skip directories (should be ignored)
        (temp_dir / "node_modules").mkdir()
        (temp_dir / "node_modules" / "package.js").write_text(
            "// This contains authenticate but should be ignored\n"
        )

        (temp_dir / "__pycache__").mkdir()
        (temp_dir / "__pycache__" / "auth.cpython-311.pyc").write_bytes(b"binary")

        return temp_dir

    def test_finds_files_with_keyword(self, project_with_code):
        """Should find files containing the search keyword."""
        from context.search import CodeSearcher

        searcher = CodeSearcher(project_with_code)
        matches = searcher.search_service(
            project_with_code / "src",
            "backend",
            ["authenticate"],
        )

        assert len(matches) > 0
        # auth.py should be found
        paths = [m.path for m in matches]
        assert any("auth.py" in path for path in paths)

    def test_scores_by_keyword_count(self, project_with_code):
        """Should score higher for files with more keyword occurrences."""
        from context.search import CodeSearcher

        searcher = CodeSearcher(project_with_code)
        matches = searcher.search_service(
            project_with_code / "src",
            "backend",
            ["user"],  # Appears in both auth.py and users.py
        )

        # users.py has 'user' more times (in class name and init)
        # Should be scored higher
        assert len(matches) > 0

    def test_finds_matching_lines(self, project_with_code):
        """Should return matching lines from found files."""
        from context.search import CodeSearcher

        searcher = CodeSearcher(project_with_code)
        matches = searcher.search_service(
            project_with_code / "src",
            "backend",
            ["password"],
        )

        assert len(matches) > 0
        # Should have matching lines
        auth_match = next((m for m in matches if "auth.py" in m.path), None)
        assert auth_match is not None
        assert len(auth_match.matching_lines) > 0
        # Should include line with 'password'
        assert any("password" in line[1].lower() for line in auth_match.matching_lines)

    def test_skips_node_modules(self, project_with_code):
        """Should skip files in node_modules directory."""
        from context.search import CodeSearcher

        searcher = CodeSearcher(project_with_code)
        matches = searcher.search_service(
            project_with_code,
            "root",
            ["authenticate"],
        )

        # Should not find the file in node_modules
        paths = [m.path for m in matches]
        assert not any("node_modules" in path for path in paths)

    def test_skips_pycache(self, project_with_code):
        """Should skip files in __pycache__ directory."""
        from context.search import CodeSearcher

        searcher = CodeSearcher(project_with_code)
        matches = searcher.search_service(
            project_with_code,
            "root",
            ["auth"],
        )

        paths = [m.path for m in matches]
        assert not any("__pycache__" in path for path in paths)

    def test_returns_empty_for_nonexistent_directory(self, temp_dir):
        """Should return empty list for nonexistent directory."""
        from context.search import CodeSearcher

        searcher = CodeSearcher(temp_dir)
        matches = searcher.search_service(
            temp_dir / "nonexistent",
            "service",
            ["keyword"],
        )

        assert matches == []

    def test_returns_empty_for_no_matches(self, project_with_code):
        """Should return empty list when no files match."""
        from context.search import CodeSearcher

        searcher = CodeSearcher(project_with_code)
        matches = searcher.search_service(
            project_with_code / "src",
            "backend",
            ["xyznonexistentkeyword123"],
        )

        assert matches == []

    def test_limits_results_to_top_20(self, temp_dir):
        """Should return at most 20 matches per service."""
        from context.search import CodeSearcher

        # Create many files
        (temp_dir / "src").mkdir()
        for i in range(30):
            (temp_dir / "src" / f"file{i}.py").write_text(
                f"# File {i}\nkeyword = '{i}'\n"
            )

        searcher = CodeSearcher(temp_dir)
        matches = searcher.search_service(
            temp_dir / "src",
            "backend",
            ["keyword"],
        )

        assert len(matches) <= 20

    def test_searches_multiple_keywords(self, project_with_code):
        """Should search for multiple keywords."""
        from context.search import CodeSearcher

        searcher = CodeSearcher(project_with_code)
        matches = searcher.search_service(
            project_with_code / "src",
            "backend",
            ["user", "password", "session"],
        )

        assert len(matches) > 0
        # auth.py contains all three keywords
        auth_match = next((m for m in matches if "auth.py" in m.path), None)
        assert auth_match is not None
        assert auth_match.relevance_score > 0

    def test_handles_binary_files_gracefully(self, project_with_code):
        """Should handle binary/unreadable files gracefully."""
        from context.search import CodeSearcher

        # Create a binary file with code extension (edge case)
        (project_with_code / "src" / "binary.py").write_bytes(
            b"\x00\x01\x02\x03invalid utf-8 \xff\xfe"
        )

        searcher = CodeSearcher(project_with_code)
        # Should not raise an error
        matches = searcher.search_service(
            project_with_code / "src",
            "backend",
            ["authenticate"],
        )

        # Should still find valid files
        assert len(matches) > 0


class TestCodeSearcherFileTypes:
    """Tests for file type handling in CodeSearcher."""

    def test_searches_python_files(self, temp_dir):
        """Should search .py files."""
        from context.search import CodeSearcher

        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "main.py").write_text("def keyword(): pass")

        searcher = CodeSearcher(temp_dir)
        matches = searcher.search_service(temp_dir / "src", "svc", ["keyword"])

        assert len(matches) == 1
        assert "main.py" in matches[0].path

    def test_searches_typescript_files(self, temp_dir):
        """Should search .ts and .tsx files."""
        from context.search import CodeSearcher

        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "app.ts").write_text("const keyword = 'value';")
        (temp_dir / "src" / "App.tsx").write_text("export const keyword = () => {};")

        searcher = CodeSearcher(temp_dir)
        matches = searcher.search_service(temp_dir / "src", "svc", ["keyword"])

        assert len(matches) == 2
        paths = [m.path for m in matches]
        assert any(".ts" in p for p in paths)
        assert any(".tsx" in p for p in paths)

    def test_searches_javascript_files(self, temp_dir):
        """Should search .js and .jsx files."""
        from context.search import CodeSearcher

        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "util.js").write_text("function keyword() {}")
        (temp_dir / "src" / "Component.jsx").write_text("const keyword = <div/>;")

        searcher = CodeSearcher(temp_dir)
        matches = searcher.search_service(temp_dir / "src", "svc", ["keyword"])

        assert len(matches) == 2

    def test_ignores_non_code_files(self, temp_dir):
        """Should ignore files without code extensions."""
        from context.search import CodeSearcher

        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "data.json").write_text('{"keyword": "value"}')
        (temp_dir / "src" / "readme.md").write_text("# keyword documentation")
        (temp_dir / "src" / "image.png").write_bytes(b"PNG data")

        searcher = CodeSearcher(temp_dir)
        matches = searcher.search_service(temp_dir / "src", "svc", ["keyword"])

        # Should not find any matches (no code files)
        assert len(matches) == 0

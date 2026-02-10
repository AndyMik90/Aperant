#!/usr/bin/env python3
"""
Tests for Workspace Merge Operations
=====================================

Tests the merge functionality including:
- Language inference from file paths
- Code fence stripping
- Simple 3-way merge attempts
- Merge prompt building
- Merge progress callbacks
- AI-assisted merge operations
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

# Test constant - in the new per-spec architecture, each spec has its own worktree
# named after the spec itself. This constant is used for test assertions.
TEST_SPEC_NAME = "test-spec"


class TestInferLanguageFromPath:
    def test_python_file(self):
        """Correctly identifies Python files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("test.py") == "python"
        assert _infer_language_from_path("src/app.py") == "python"

    def test_javascript_file(self):
        """Correctly identifies JavaScript files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("test.js") == "javascript"
        assert _infer_language_from_path("src/app.js") == "javascript"

    def test_jsx_file(self):
        """Correctly identifies JSX files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("App.jsx") == "javascript"

    def test_typescript_file(self):
        """Correctly identifies TypeScript files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("test.ts") == "typescript"

    def test_tsx_file(self):
        """Correctly identifies TSX files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("App.tsx") == "typescript"

    def test_rust_file(self):
        """Correctly identifies Rust files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("main.rs") == "rust"

    def test_go_file(self):
        """Correctly identifies Go files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("main.go") == "go"

    def test_java_file(self):
        """Correctly identifies Java files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Main.java") == "java"

    def test_cpp_file(self):
        """Correctly identifies C++ files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("main.cpp") == "cpp"

    def test_c_file(self):
        """Correctly identifies C files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("main.c") == "c"

    def test_header_file(self):
        """Correctly identifies C header files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("header.h") == "c"

    def test_hpp_file(self):
        """Correctly identifies C++ header files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("header.hpp") == "cpp"

    def test_ruby_file(self):
        """Correctly identifies Ruby files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("app.rb") == "ruby"

    def test_php_file(self):
        """Correctly identifies PHP files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("index.php") == "php"

    def test_swift_file(self):
        """Correctly identifies Swift files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("App.swift") == "swift"

    def test_kotlin_file(self):
        """Correctly identifies Kotlin files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Main.kt") == "kotlin"

    def test_scala_file(self):
        """Correctly identifies Scala files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Main.scala") == "scala"

    def test_json_file(self):
        """Correctly identifies JSON files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.json") == "json"

    def test_yaml_file(self):
        """Correctly identifies YAML files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.yaml") == "yaml"

    def test_yml_file(self):
        """Correctly identifies YML files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.yml") == "yaml"

    def test_toml_file(self):
        """Correctly identifies TOML files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.toml") == "toml"

    def test_markdown_file(self):
        """Correctly identifies Markdown files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("README.md") == "markdown"

    def test_html_file(self):
        """Correctly identifies HTML files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("index.html") == "html"

    def test_css_file(self):
        """Correctly identifies CSS files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("style.css") == "css"

    def test_scss_file(self):
        """Correctly identifies SCSS files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("style.scss") == "scss"

    def test_sql_file(self):
        """Correctly identifies SQL files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("query.sql") == "sql"

    def test_unknown_extension(self):
        """Defaults to 'text' for unknown extensions."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("file.unknown") == "text"

    def test_no_extension(self):
        """Defaults to 'text' for files without extension."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Makefile") == "text"

    def test_case_insensitive(self):
        """Handles uppercase extensions correctly."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("test.PY") == "python"
        assert _infer_language_from_path("test.JS") == "javascript"

    def test_nested_path(self):
        """Correctly infers language from nested paths."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("src/components/Button.tsx") == "typescript"

    def test_dockerfile(self):
        """Defaults to 'text' for Dockerfile without extension."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Dockerfile") == "text"

    def test_makefile(self):
        """Defaults to 'text' for Makefile without extension."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("Makefile") == "text"

    def test_gitignore(self):
        """Defaults to 'text' for .gitignore without extension."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path(".gitignore") == "text"

    def test_env_file(self):
        """Defaults to 'text' for .env files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path(".env") == "text"

    def test_config_yaml(self):
        """Identifies YAML in config files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("app.config.yaml") == "yaml"

    def test_sh_file(self):
        """Defaults to 'text' for shell scripts."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("script.sh") == "text"

    def test_txt_file(self):
        """Defaults to 'text' for .txt files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("notes.txt") == "text"

    def test_xml_file(self):
        """Defaults to 'text' for .xml files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("config.xml") == "text"

    def test_md_file_in_docs(self):
        """Identifies markdown in documentation paths."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("docs/api.md") == "markdown"

    def test_package_json(self):
        """Identifies JSON in package files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("package.json") == "json"

    def test_tsconfig_json(self):
        """Identifies JSON in TypeScript config files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("tsconfig.json") == "json"

    def test_python_init_file(self):
        """Identifies Python in __init__ files."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("package/__init__.py") == "python"

    def test_absolute_path(self):
        """Handles absolute paths correctly."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("/usr/local/bin/script.py") == "python"

    def test_windows_path(self):
        """Handles Windows paths correctly."""
        from core.workspace import _infer_language_from_path

        assert _infer_language_from_path("C:\\Users\\test\\file.js") == "javascript"


class TestStripCodeFences:
    """Tests for _strip_code_fences function."""

    def test_basic_code_fence(self):
        """Removes basic markdown code fences."""
        from core.workspace import _strip_code_fences

        content = "```python\ndef hello():\n    pass\n```"
        result = _strip_code_fences(content)
        assert result == "def hello():\n    pass"

    def test_code_fence_with_language(self):
        """Removes code fence with language specified."""
        from core.workspace import _strip_code_fences

        content = "```javascript\nconst x = 1;\n```"
        result = _strip_code_fences(content)
        assert result == "const x = 1;"

    def test_no_code_fence(self):
        """Returns content unchanged when no code fence present."""
        from core.workspace import _strip_code_fences

        content = "just some text"
        result = _strip_code_fences(content)
        assert result == content

    def test_code_fence_without_closing_fence(self):
        """Handles opening fence without closing fence."""
        from core.workspace import _strip_code_fences

        content = "```python\ndef hello():\n    pass"
        result = _strip_code_fences(content)
        assert result == "def hello():\n    pass"

    def test_multiple_lines_fence(self):
        """Handles multi-line code with fences."""
        from core.workspace import _strip_code_fences

        content = "```\nline1\nline2\nline3\n```"
        result = _strip_code_fences(content)
        assert result == "line1\nline2\nline3"

    def test_whitespace_around_fences(self):
        """Handles whitespace around code fences."""
        from core.workspace import _strip_code_fences

        content = "  ```python\ndef hello():\n  ```  "
        result = _strip_code_fences(content)
        assert "def hello():" in result

    def test_empty_fence(self):
        """Handles empty code fence."""
        from core.workspace import _strip_code_fences

        content = "```\n```"
        result = _strip_code_fences(content)
        assert result == ""

    def test_fence_with_no_language(self):
        """Handles fence without language specifier."""
        from core.workspace import _strip_code_fences

        content = "```\ncode here\n```"
        result = _strip_code_fences(content)
        assert result == "code here"

    def test_code_fence_with_spaces_in_fence_marker(self):
        """Handles fence markers with extra spaces."""
        from core.workspace import _strip_code_fences

        content = "``` python\ndef hello():\n    pass\n```"
        result = _strip_code_fences(content)
        assert "def hello():" in result

    def test_nested_fences_not_supported(self):
        """Doesn't handle nested fences (edge case)."""
        from core.workspace import _strip_code_fences

        content = "```\nouter ``` inner\ncode\n```"
        result = _strip_code_fences(content)
        # Should strip first fence
        assert result.startswith("outer")

    def test_only_fence_at_start(self):
        """Only strips fence if at start of content."""
        from core.workspace import _strip_code_fences

        content = "text\n```python\ncode\n```"
        result = _strip_code_fences(content)
        assert result == content

    def test_preserves_internal_markers(self):
        """Preserves triple backticks that aren't fences."""
        from core.workspace import _strip_code_fences

        content = "```python\ncode with ``` in it\n```"
        result = _strip_code_fences(content)
        assert "code with ``` in it" in result

    def test_multiple_fences_only_first(self):
        """Only removes first fence pair."""
        from core.workspace import _strip_code_fences

        content = "```\ncode1\n```\n```\ncode2\n```"
        result = _strip_code_fences(content)
        # First fence removed, second preserved
        assert result.startswith("code1")

    def test_closing_fence_with_extra_text(self):
        """Handles closing fence with text after."""
        from core.workspace import _strip_code_fences

        content = "```python\ncode\n``` extra"
        result = _strip_code_fences(content)
        assert result == "code\n``` extra"

    def test_four_backticks(self):
        """Handles four backticks (edge case)."""
        from core.workspace import _strip_code_fences

        content = "````python\ncode\n````"
        result = _strip_code_fences(content)
        # Should strip the fence
        assert "code" in result

    def test_unicode_in_code(self):
        """Preserves unicode characters in code."""
        from core.workspace import _strip_code_fences

        content = "```python\n# Comment with émoji 🎉\n```"
        result = _strip_code_fences(content)
        assert "émoji" in result
        assert "🎉" in result

    def test_trailing_newlines_preserved(self):
        """Preserves internal newlines in code content."""
        from core.workspace import _strip_code_fences

        content = "```python\ncode\n```"
        result = _strip_code_fences(content)
        assert result == "code"

    def test_single_line_code(self):
        """Handles single line code with fences."""
        from core.workspace import _strip_code_fences

        content = "```python\nx = 1\n```"
        result = _strip_code_fences(content)
        assert result == "x = 1"

    def test_code_with_tabs(self):
        """Preserves tabs in code content."""
        from core.workspace import _strip_code_fences

        content = "```python\n\tdef test():\n\t\tpass\n```"
        result = _strip_code_fences(content)
        assert "\t" in result

    def test_mixed_line_endings(self):
        """Handles mixed line endings."""
        from core.workspace import _strip_code_fences

        content = "```python\r\nline1\r\nline2\r\n```"
        result = _strip_code_fences(content)
        assert "line1" in result
        assert "line2" in result

    def test_fence_with_attributes(self):
        """Handles fence with extra attributes."""
        from core.workspace import _strip_code_fences

        content = '```python title="test.py"\ncode\n```'
        result = _strip_code_fences(content)
        assert "code" in result

    def test_leading_spaces_in_content(self):
        """Preserves leading spaces in code."""
        from core.workspace import _strip_code_fences

        content = "```python\n    indented code\n```"
        result = _strip_code_fences(content)
        assert "    indented code" in result

    def test_code_with_emoji(self):
        """Preserves emoji in code content."""
        from core.workspace import _strip_code_fences

        content = "```python\n# 🎉 party time\n```"
        result = _strip_code_fences(content)
        assert "🎉" in result

    def test_very_long_code_line(self):
        """Handles very long code lines."""
        from core.workspace import _strip_code_fences

        long_line = "x" * 1000
        content = f"```\n{long_line}\n```"
        result = _strip_code_fences(content)
        assert len(result) == 1000


class TestTrySimple3wayMerge:
    """Tests for _try_simple_3way_merge function."""

    def test_both_sides_identical(self):
        """Returns content when both sides are identical."""
        from core.workspace import _try_simple_3way_merge

        base = "original"
        ours = "modified"
        theirs = "modified"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "modified"

    def test_only_ours_changed(self):
        """Returns ours when only ours changed from base."""
        from core.workspace import _try_simple_3way_merge

        base = "original"
        ours = "ours modified"
        theirs = "original"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "ours modified"

    def test_only_theirs_changed(self):
        """Returns theirs when only theirs changed from base."""
        from core.workspace import _try_simple_3way_merge

        base = "original"
        ours = "original"
        theirs = "theirs modified"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "theirs modified"

    def test_both_changed_differently(self):
        """Returns False when both changed differently."""
        from core.workspace import _try_simple_3way_merge

        base = "original"
        ours = "ours change"
        theirs = "theirs change"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is False
        assert result is None

    def test_none_base_identical_sides(self):
        """Returns ours when base is None and both sides identical."""
        from core.workspace import _try_simple_3way_merge

        base = None
        ours = "same"
        theirs = "same"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "same"

    def test_none_base_different_sides(self):
        """Returns False when base is None and sides differ."""
        from core.workspace import _try_simple_3way_merge

        base = None
        ours = "ours"
        theirs = "theirs"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is False
        assert result is None

    def test_empty_strings(self):
        """Handles empty strings correctly."""
        from core.workspace import _try_simple_3way_merge

        base = ""
        ours = ""
        theirs = ""

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == ""

    def test_multiline_content(self):
        """Handles multiline content correctly."""
        from core.workspace import _try_simple_3way_merge

        base = "line1\nline2"
        ours = "line1\nline2"
        theirs = "line1\nline2\nline3"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        assert success is True
        assert result == "line1\nline2\nline3"

    def test_whitespace_differences(self):
        """Treats whitespace differences as changes."""
        from core.workspace import _try_simple_3way_merge

        base = "text"
        ours = "text "
        theirs = "text"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        # Different from base means ours is the change
        assert success is True
        assert result == "text "

    def test_all_same(self):
        """Returns True when all three are the same."""
        from core.workspace import _try_simple_3way_merge

        content = "same content"
        success, result = _try_simple_3way_merge(content, content, content)
        assert success is True
        assert result == content

    def test_newline_differences(self):
        """Handles trailing newline differences."""
        from core.workspace import _try_simple_3way_merge

        base = "text"
        ours = "text\n"
        theirs = "text"

        success, result = _try_simple_3way_merge(base, ours, theirs)
        # Different from base means ours is the change
        assert success is True
        assert result == "text\n"


class TestBuildMergePrompt:
    """Tests for _build_merge_prompt function."""

    def test_basic_prompt_structure(self):
        """Creates prompt with all required sections."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "test.py",
            "base content",
            "main content",
            "worktree content",
            "spec-001",
        )

        assert "FILE: test.py" in prompt
        assert "TASK: spec-001" in prompt
        assert "OURS" in prompt
        assert "THEIRS" in prompt
        assert "main content" in prompt
        assert "worktree content" in prompt

    def test_includes_language_from_file(self):
        """Infers and includes language in code fence."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "test.py",
            "base",
            "main",
            "worktree",
            "spec",
        )

        assert "```python" in prompt

    def test_with_base_content(self):
        """Includes BASE section when base content provided."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.js",
            "base content",
            "main",
            "worktree",
            "spec",
        )

        assert "BASE (common ancestor" in prompt
        assert "base content" in prompt

    def test_without_base_content(self):
        """Handles None base content gracefully."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.ts",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "BASE" not in prompt or "common ancestor" not in prompt

    def test_truncates_large_base_content(self):
        """Truncates base content over 10000 characters."""
        from core.workspace import _build_merge_prompt

        large_base = "x" * 15000
        prompt = _build_merge_prompt(
            "file.py",
            large_base,
            "main",
            "worktree",
            "spec",
        )

        assert "(truncated)" in prompt
        assert len(prompt) < len(large_base) + 1000

    def test_truncates_large_main_content(self):
        """Truncates main content over 15000 characters."""
        from core.workspace import _build_merge_prompt

        large_main = "y" * 20000
        prompt = _build_merge_prompt(
            "file.py",
            "base",
            large_main,
            "worktree",
            "spec",
        )

        assert "(truncated)" in prompt

    def test_truncates_large_worktree_content(self):
        """Truncates worktree content over 15000 characters."""
        from core.workspace import _build_merge_prompt

        large_worktree = "z" * 20000
        prompt = _build_merge_prompt(
            "file.py",
            "base",
            "main",
            large_worktree,
            "spec",
        )

        assert "(truncated)" in prompt

    def test_typescript_language(self):
        """Uses typescript for .ts files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.ts",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```typescript" in prompt

    def test_javascript_language(self):
        """Uses javascript for .js files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.js",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```javascript" in prompt

    def test_json_language(self):
        """Uses json for .json files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "config.json",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```json" in prompt

    def test_spec_name_included(self):
        """Includes spec name in prompt."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "my-spec-name",
        )

        assert "TASK: my-spec-name" in prompt

    def test_merge_instruction(self):
        """Includes merge instruction."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "3-way code merge" in prompt or "combine changes" in prompt.lower()

    def test_output_instruction(self):
        """Includes instruction to output only code."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "OUTPUT THE MERGED CODE ONLY" in prompt or "no explanations" in prompt

    def test_no_markdown_fences_instruction(self):
        """Includes instruction about no markdown fences."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "no markdown fences" in prompt

    def test_ours_section_description(self):
        """Describes OURS correctly."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main content",
            "worktree",
            "spec",
        )

        assert "OURS (current main branch" in prompt

    def test_theirs_section_description(self):
        """Describes THEIRS correctly."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree content",
            "spec",
        )

        assert "THEIRS (task worktree" in prompt

    def test_special_characters_in_content(self):
        """Handles special characters in content."""
        from core.workspace import _build_merge_prompt

        content = "code with 'quotes' and \"double quotes\" and \n newlines"
        prompt = _build_merge_prompt(
            "file.py",
            None,
            content,
            content,
            "spec",
        )

        assert "quotes" in prompt
        assert "\n" in prompt or "newlines" in prompt

    def test_empty_contents(self):
        """Handles empty contents gracefully."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            "",
            "",
            "",
            "spec",
        )

        # Should still have structure
        assert "FILE:" in prompt
        assert "OURS" in prompt
        assert "THEIRS" in prompt

    def test_markdown_language(self):
        """Uses markdown for .md files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "README.md",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```markdown" in prompt

    def test_yaml_language(self):
        """Uses yaml for .yml files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "config.yml",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```yaml" in prompt

    def test_cpp_language(self):
        """Uses cpp for .cpp files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "main.cpp",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```cpp" in prompt

    def test_rust_language(self):
        """Uses rust for .rs files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "main.rs",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```rust" in prompt

    def test_go_language(self):
        """Uses go for .go files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "main.go",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```go" in prompt

    def test_ruby_language(self):
        """Uses ruby for .rb files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "app.rb",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```ruby" in prompt

    def test_java_language(self):
        """Uses java for .java files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "Main.java",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```java" in prompt

    def test_sql_language(self):
        """Uses sql for .sql files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "query.sql",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```sql" in prompt

    def test_html_language(self):
        """Uses html for .html files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "index.html",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```html" in prompt

    def test_css_language(self):
        """Uses css for .css files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "style.css",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```css" in prompt

    def test_scss_language(self):
        """Uses scss for .scss files."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "style.scss",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```scss" in prompt

    def test_text_language_for_unknown(self):
        """Uses text for unknown extensions."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.unknown",
            None,
            "main",
            "worktree",
            "spec",
        )

        assert "```text" in prompt

    def test_truncates_both_large_contents(self):
        """Truncates both main and worktree when large."""
        from core.workspace import _build_merge_prompt

        large_main = "x" * 20000
        large_worktree = "y" * 20000
        prompt = _build_merge_prompt(
            "file.py",
            None,
            large_main,
            large_worktree,
            "spec",
        )

        # Should have truncation markers
        assert prompt.count("(truncated)") >= 2

    def test_preserves_small_base_content(self):
        """Does not truncate small base content."""
        from core.workspace import _build_merge_prompt

        base = "small base"
        prompt = _build_merge_prompt(
            "file.py",
            base,
            "main",
            "worktree",
            "spec",
        )

        assert "small base" in prompt
        assert "(truncated)" not in prompt

    def test_spec_name_with_special_chars(self):
        """Handles spec names with special characters."""
        from core.workspace import _build_merge_prompt

        prompt = _build_merge_prompt(
            "file.py",
            None,
            "main",
            "worktree",
            "spec-001_feature",
        )

        assert "spec-001_feature" in prompt


class TestCreateMergeProgressCallback:
    """Tests for _create_merge_progress_callback function."""

    def test_returns_callable_when_piped(self, monkeypatch):
        """Returns emit_progress when stdout is not a TTY."""
        from core.workspace import _create_merge_progress_callback
        from merge.progress import emit_progress

        # Mock sys.stdout.isatty to return False
        monkeypatch.setattr("sys.stdout.isatty", lambda: False)

        callback = _create_merge_progress_callback()
        assert callback is not None
        assert callback == emit_progress

    def test_returns_none_when_tty(self, monkeypatch):
        """Returns None when stdout is a TTY."""
        from core.workspace import _create_merge_progress_callback

        # Mock sys.stdout.isatty to return True
        monkeypatch.setattr("sys.stdout.isatty", lambda: True)

        callback = _create_merge_progress_callback()
        assert callback is None

    def test_callback_emits_progress_json(self, monkeypatch, capsys):
        """Emits proper progress JSON when callback is used."""
        from core.workspace import _create_merge_progress_callback
        from merge.progress import MergeProgressStage

        # Mock sys.stdout.isatty to return False
        monkeypatch.setattr("sys.stdout.isatty", lambda: False)

        callback = _create_merge_progress_callback()
        if callback:
            callback(
                MergeProgressStage.ANALYZING,
                50,
                "Test message",
                {"test_key": "test_value"},
            )

            captured = capsys.readouterr()
            assert '"type": "progress"' in captured.out
            assert '"percent": 50' in captured.out
            assert '"message": "Test message"' in captured.out

    def test_multiple_callbacks_different_stages(self, monkeypatch, capsys):
        """Handles multiple callback calls with different stages."""
        from core.workspace import _create_merge_progress_callback
        from merge.progress import MergeProgressStage

        # Mock sys.stdout.isatty to return False
        monkeypatch.setattr("sys.stdout.isatty", lambda: False)

        callback = _create_merge_progress_callback()
        if callback:
            callback(MergeProgressStage.ANALYZING, 0, "Starting")
            callback(MergeProgressStage.COMPLETE, 100, "Done")

            captured = capsys.readouterr()
            assert "Starting" in captured.out
            assert "Done" in captured.out
            assert '"percent": 0' in captured.out
            assert '"percent": 100' in captured.out


# Helper classes for AI merge tests
class TextBlock:
    """Mock TextBlock for testing AI merge responses."""

    def __init__(self, text: str):
        self.text = text
        # Set __name__ for type checking
        self.__class__.__name__ = "TextBlock"


class AssistantMessage:
    """Mock AssistantMessage for testing AI merge responses."""

    def __init__(self, content: list):
        self.content = content
        # Set __name__ for type checking
        self.__class__.__name__ = "AssistantMessage"


class MockClientBase:
    """Base mock client class that implements async context manager."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def query(self, prompt):
        return None


class TestAttemptAiMerge:
    """Tests for _attempt_ai_merge function with extensive mocking."""

    def test_successful_merge_returns_true_and_content(self, temp_git_repo: Path):
        """Successful AI merge returns (True, merged_content, "")."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import ParallelMergeTask, _attempt_ai_merge

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="def foo():\n    pass",
            worktree_content="def bar():\n    pass",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client class that properly implements async context manager
        class MockClient(MockClientBase):
            def __init__(self):
                self.query_calls = []

            async def query(self, prompt):
                self.query_calls.append(prompt)
                return None

            async def receive_response(self):
                mock_msg = AssistantMessage([TextBlock("def merged():\n    pass")])
                yield mock_msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            with patch(
                "core.workspace.git_utils.validate_merged_syntax",
                return_value=(True, ""),
            ):
                result = asyncio.run(
                    _attempt_ai_merge(
                        task,
                        "test prompt",
                        model="claude-haiku-4-5-20251001",
                        max_thinking_tokens=1024,
                    )
                )

        assert result[0] is True
        assert result[1] == "def merged():\n    pass"
        assert result[2] == ""

    def test_ai_returns_natural_language_returns_error(self, temp_git_repo: Path):
        """AI returning natural language instead of code returns error."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import ParallelMergeTask, _attempt_ai_merge

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns natural language
        class MockClient(MockClientBase):
            async def receive_response(self):
                msg = AssistantMessage(
                    [TextBlock("I need to see more context to merge this properly.")]
                )
                yield msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            result = asyncio.run(
                _attempt_ai_merge(
                    task,
                    "test prompt",
                    model="claude-haiku-4-5-20251001",
                    max_thinking_tokens=1024,
                )
            )

        assert result[0] is False
        assert result[1] is None
        assert "explanation instead of code" in result[2].lower()

    def test_invalid_syntax_after_merge_returns_error(self, temp_git_repo: Path):
        """Invalid syntax after merge returns (False, None, error)."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import ParallelMergeTask, _attempt_ai_merge

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns invalid Python
        class MockClient(MockClientBase):
            async def receive_response(self):
                msg = AssistantMessage([TextBlock("def merged(:\n    pass")])
                yield msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            result = asyncio.run(
                _attempt_ai_merge(
                    task,
                    "test prompt",
                    model="claude-haiku-4-5-20251001",
                    max_thinking_tokens=1024,
                )
            )

        assert result[0] is False
        assert result[1] is None
        assert "syntax" in result[2].lower()

    def test_empty_ai_response_returns_error(self, temp_git_repo: Path):
        """Empty AI response returns (False, None, error)."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import ParallelMergeTask, _attempt_ai_merge

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns empty response
        class MockClient(MockClientBase):
            response_text = ""

            async def receive_response(self):
                # Empty generator - yields nothing
                return
                yield

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            result = asyncio.run(
                _attempt_ai_merge(
                    task,
                    "test prompt",
                    model="claude-haiku-4-5-20251001",
                    max_thinking_tokens=1024,
                )
            )

        assert result[0] is False
        assert result[1] is None
        assert "empty response" in result[2].lower()

    def test_code_fence_stripping_is_applied(self, temp_git_repo: Path):
        """Code fence stripping is applied to AI response."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import ParallelMergeTask, _attempt_ai_merge

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns code with fences
        class MockClient(MockClientBase):
            async def receive_response(self):
                # Use markdown-style code fences (backticks)
                block = TextBlock("```python\ndef merged():\n    pass\n```")
                msg = AssistantMessage([block])
                yield msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            with patch(
                "core.workspace.git_utils.validate_merged_syntax",
                return_value=(True, ""),
            ):
                result = asyncio.run(
                    _attempt_ai_merge(
                        task,
                        "test prompt",
                        model="claude-haiku-4-5-20251001",
                        max_thinking_tokens=1024,
                    )
                )

        assert result[0] is True
        # Code fences should be stripped
        assert not result[1].startswith("```")
        assert "def merged():" in result[1]

    def test_response_with_code_patterns_passes_natural_language_check(
        self, temp_git_repo: Path
    ):
        """Response with code patterns passes natural language check."""
        import asyncio
        from unittest.mock import patch

        from core.workspace import ParallelMergeTask, _attempt_ai_merge

        task = ParallelMergeTask(
            file_path="test.py",
            main_content="main",
            worktree_content="worktree",
            base_content=None,
            spec_name="spec-001",
            project_dir=temp_git_repo,
        )

        # Create a mock client that returns valid code
        class MockClient(MockClientBase):
            async def receive_response(self):
                # Response that has "i need to" but also has code patterns
                block = TextBlock(
                    "# I need to handle edge cases\ndef merged():\n    pass\n"
                )
                msg = AssistantMessage([block])
                yield msg

        mock_client = MockClient()

        with patch("core.simple_client.create_simple_client", return_value=mock_client):
            with patch(
                "core.workspace.git_utils.validate_merged_syntax",
                return_value=(True, ""),
            ):
                result = asyncio.run(
                    _attempt_ai_merge(
                        task,
                        "test prompt",
                        model="claude-haiku-4-5-20251001",
                        max_thinking_tokens=1024,
                    )
                )

        # Should pass because it has code patterns (def)
        assert result[0] is True
        assert "def merged():" in result[1]

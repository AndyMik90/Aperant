"""
Constants for Context Building
================================

Configuration constants for directory skipping and file filtering.
"""

# Directories to skip during code search
SKIP_DIRS = {
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "target",
    "vendor",
    ".idea",
    ".vscode",
    "ac-jerry",
    ".pytest_cache",
    ".mypy_cache",
    "coverage",
    ".turbo",
    ".cache",
}

# File extensions to search for code files
CODE_EXTENSIONS = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".vue",
    ".svelte",
    ".go",
    ".rs",
    ".rb",
    ".php",
}

"""
Agent Utilities
===============

Shared utility functions for GitHub PR review agents.
"""

from pathlib import Path


def create_working_dir_injector(working_dir: Path):
    """Factory that creates a prompt injector with working directory context.

    Args:
        working_dir: The working directory path to inject into prompts

    Returns:
        A function that takes (prompt, fallback) and returns the prompt with
        working directory prefix prepended.
    """
    working_dir_prefix = (
        f"## Working Directory\n\n"
        f"Your working directory is: `{working_dir.resolve()}`\n"
        f"All file paths should be relative to this directory.\n"
        f"Use the Read, Grep, and Glob tools to examine files.\n\n"
    )

    def with_working_dir(prompt: str | None, fallback: str) -> str:
        """Inject working directory context into agent prompt."""
        base = prompt or fallback
        return f"{working_dir_prefix}{base}"

    return with_working_dir

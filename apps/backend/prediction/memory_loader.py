"""
Memory loading utilities for bug prediction.
Loads historical data from gotchas, patterns, and attempt history.
"""

import json
from pathlib import Path


class MemoryLoader:
    """Loads historical data from memory files."""

    def __init__(self, memory_dir: Path):
        """
        Initialize the memory loader.

        Args:
            memory_dir: Path to the memory directory (e.g., specs/001/memory/)
        """
        self.memory_dir = Path(memory_dir)
        self.gotchas_file = self.memory_dir / "gotchas.md"
        self.patterns_file = self.memory_dir / "patterns.md"
        self.history_file = self.memory_dir / "attempt_history.json"

    def load_gotchas(self) -> list[str]:
        """
        Load gotchas from previous sessions.

        Returns:
            List of gotcha strings
        """
        if not self.gotchas_file.exists():
            return []

        gotchas = []
        content = self.gotchas_file.read_text(encoding="utf-8")

        # Parse markdown list items
        for line in content.split("\n"):
            line = line.strip()
            if line.startswith("-") or line.startswith("*"):
                gotcha = line.lstrip("-*").strip()
                if gotcha:
                    gotchas.append(gotcha)

        return gotchas

    def load_patterns(self) -> list[str]:
        """
        Load successful patterns from previous sessions.

        Returns:
            List of pattern strings with format "Pattern Name: detail"
        """
        if not self.patterns_file.exists():
            return []

        patterns = []
        content = self.patterns_file.read_text(encoding="utf-8")

        # Parse markdown sections
        current_pattern = None
        for line in content.split("\n"):
            line = line.strip()
            if line.startswith("##"):
                # Pattern heading
                current_pattern = line.lstrip("#").strip()
            elif line and current_pattern:
                # Pattern detail
                if line.startswith("-") or line.startswith("*"):
                    detail = line.lstrip("-*").strip()
                    patterns.append(f"{current_pattern}: {detail}")

        return patterns

    def load_attempt_history(self) -> list[dict]:
        """
        Load historical subtask attempts.

        Returns:
            List of attempt dictionaries with keys like:
            - subtask_id
            - subtask_description
            - status
            - error_message
            - files_modified
        """
        if not self.history_file.exists():
            return []

        try:
            with open(self.history_file, encoding="utf-8") as f:
                history = json.load(f)
                return history.get("attempts", [])
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return []

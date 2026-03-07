"""
Code Search Functionality
==========================

Search codebase for relevant files based on keywords.
"""

from pathlib import Path

from .constants import CODE_EXTENSIONS, SKIP_DIRS
from .models import FileMatch


class CodeSearcher:
    """Searches code files for relevant matches."""

    def __init__(self, project_dir: Path):
        self.project_dir = project_dir.resolve()

    def search_service(
        self,
        service_path: Path,
        service_name: str,
        keywords: list[str],
    ) -> list[FileMatch]:
        """
        Search a service for files matching keywords.

        Args:
            service_path: Path to the service directory
            service_name: Name of the service
            keywords: List of keywords to search for

        Returns:
            List of FileMatch objects sorted by relevance
        """
        matches = []

        if not service_path.exists():
            return matches

        for file_path in self._iter_code_files(service_path):
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
                content_lower = content.lower()

                # Score this file
                score = 0
                matching_keywords = []
                matching_lines = []

                for keyword in keywords:
                    if keyword in content_lower:
                        # Count occurrences
                        count = content_lower.count(keyword)
                        score += min(count, 10)  # Cap at 10 per keyword
                        matching_keywords.append(keyword)

                        # Find matching lines (first 3 per keyword)
                        lines = content.split("\n")
                        found = 0
                        for i, line in enumerate(lines, 1):
                            if keyword in line.lower() and found < 3:
                                matching_lines.append((i, line.strip()[:100]))
                                found += 1

                if score > 0:
                    rel_path = str(file_path.relative_to(self.project_dir))
                    matches.append(
                        FileMatch(
                            path=rel_path,
                            service=service_name,
                            reason=f"Contains: {', '.join(matching_keywords)}",
                            relevance_score=score,
                            matching_lines=matching_lines[:5],  # Top 5 lines
                        )
                    )

            except (OSError, UnicodeDecodeError):
                continue

        # Sort by relevance
        matches.sort(key=lambda m: m.relevance_score, reverse=True)
        return matches[:20]  # Top 20 per service

    def _iter_code_files(self, directory: Path):
        """
        Iterate over code files in a directory.

        Args:
            directory: Root directory to search

        Yields:
            Path objects for code files
        """
        for item in directory.rglob("*"):
            if item.is_file() and item.suffix in CODE_EXTENSIONS:
                # Check if in skip directory
                parts = item.relative_to(directory).parts
                if not any(part in SKIP_DIRS for part in parts):
                    yield item

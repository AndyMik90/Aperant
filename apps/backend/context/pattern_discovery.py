"""
Pattern Discovery
=================

Discovers code patterns from reference files to guide implementation.
"""

from pathlib import Path

from .models import FileMatch


class PatternDiscoverer:
    """Discovers code patterns from reference files."""

    def __init__(self, project_dir: Path):
        self.project_dir = project_dir.resolve()

    def discover_patterns(
        self,
        reference_files: list[FileMatch],
        keywords: list[str],
        max_files: int = 5,
    ) -> dict[str, str]:
        """
        Discover code patterns from reference files.

        Args:
            reference_files: List of FileMatch objects to analyze
            keywords: Keywords to look for in the code
            max_files: Maximum number of files to analyze

        Returns:
            Dictionary mapping pattern keys to code snippets
        """
        patterns = {}

        for match in reference_files[:max_files]:
            try:
                file_path = self.project_dir / match.path
                content = file_path.read_text(encoding="utf-8", errors="ignore")

                # Look for common patterns
                for keyword in keywords:
                    if keyword in content.lower():
                        # Extract a snippet around the keyword
                        lines = content.split("\n")
                        for i, line in enumerate(lines):
                            if keyword in line.lower():
                                # Get context (3 lines before and after)
                                start = max(0, i - 3)
                                end = min(len(lines), i + 4)
                                snippet = "\n".join(lines[start:end])

                                pattern_key = f"{keyword}_pattern"
                                if pattern_key not in patterns:
                                    patterns[pattern_key] = (
                                        f"From {match.path}:\n{snippet[:300]}"
                                    )
                                break

            except (OSError, UnicodeDecodeError):
                continue

        return patterns

"""
Storage and Persistence Module
================================

Handles file system operations for evolution tracking:
- Loading/saving evolution data from JSON
- Storing baseline content snapshots
- Reading file contents from disk
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from ..types import FileEvolution

logger = logging.getLogger(__name__)


class EvolutionStorage:
    """
    Manages persistence of file evolution data.

    Responsibilities:
    - Load/save evolution data to JSON
    - Store baseline content snapshots
    - Read file contents safely
    """

    def __init__(
        self,
        project_dir: Path,
        storage_dir: Path,
    ):
        """
        Initialize evolution storage.

        Args:
            project_dir: Root directory of the project
            storage_dir: Directory for evolution data (.auto-claude/)
        """
        self.project_dir = Path(project_dir).resolve()
        self.storage_dir = Path(storage_dir).resolve()
        self.baselines_dir = self.storage_dir / "baselines"
        self.evolution_file = self.storage_dir / "file_evolution.json"

        # Ensure directories exist
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.baselines_dir.mkdir(parents=True, exist_ok=True)

    def load_evolutions(self) -> dict[str, FileEvolution]:
        """
        Load evolution data from disk.

        Returns:
            Dictionary mapping file paths to FileEvolution objects
        """
        if not self.evolution_file.exists():
            return {}

        try:
            with open(self.evolution_file, encoding="utf-8") as f:
                data = json.load(f)

            evolutions = {}
            for file_path, evolution_data in data.items():
                evolutions[file_path] = FileEvolution.from_dict(evolution_data)

            logger.debug(f"Loaded evolution data for {len(evolutions)} files")
            return evolutions

        except Exception as e:
            logger.error(f"Failed to load evolution data: {e}")
            return {}

    def save_evolutions(self, evolutions: dict[str, FileEvolution]) -> None:
        """
        Persist evolution data to disk.

        Args:
            evolutions: Dictionary mapping file paths to FileEvolution objects
        """
        try:
            data = {
                file_path: evolution.to_dict()
                for file_path, evolution in evolutions.items()
            }

            with open(self.evolution_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

            logger.debug(f"Saved evolution data for {len(evolutions)} files")

        except Exception as e:
            logger.error(f"Failed to save evolution data: {e}")

    def store_baseline_content(
        self,
        file_path: str,
        content: str,
        task_id: str,
    ) -> str:
        """
        Store baseline content to disk.

        Args:
            file_path: Relative path to the file
            content: File content to store
            task_id: Task identifier

        Returns:
            Path to the stored baseline file (relative to storage_dir)
        """
        from ..types import sanitize_path_for_storage

        safe_name = sanitize_path_for_storage(file_path)
        baseline_path = self.baselines_dir / task_id / f"{safe_name}.baseline"
        baseline_path.parent.mkdir(parents=True, exist_ok=True)

        with open(baseline_path, "w", encoding="utf-8") as f:
            f.write(content)

        return str(baseline_path.relative_to(self.storage_dir))

    def read_baseline_content(self, baseline_snapshot_path: str) -> str | None:
        """
        Read baseline content from disk.

        Args:
            baseline_snapshot_path: Path to baseline file (relative to storage_dir)

        Returns:
            Baseline content, or None if not available
        """
        baseline_path = self.storage_dir / baseline_snapshot_path
        if baseline_path.exists():
            try:
                return baseline_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                return baseline_path.read_text(encoding="utf-8", errors="replace")
            except Exception as e:
                logger.warning(f"Could not read baseline {baseline_snapshot_path}: {e}")
        return None

    def read_file_content(self, file_path: Path | str) -> str | None:
        """
        Read file content from project directory.

        Args:
            file_path: Path to file (absolute or relative to project)

        Returns:
            File content, or None if not readable
        """
        try:
            path = Path(file_path)
            if not path.is_absolute():
                path = self.project_dir / path
            return path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.warning(f"Could not read {file_path}: {e}")
            return None

    def get_relative_path(self, file_path: Path | str) -> str:
        """
        Get path relative to project root.

        Args:
            file_path: Absolute or relative file path

        Returns:
            Path relative to project directory
        """
        path = Path(file_path)
        if path.is_absolute():
            try:
                # Resolve both paths to handle symlinks (e.g., /var -> /private/var on macOS)
                resolved_path = path.resolve()
                return resolved_path.relative_to(self.project_dir).as_posix()
            except ValueError:
                # Path is not under project_dir, return as-is
                return path.as_posix()
        return path.as_posix()

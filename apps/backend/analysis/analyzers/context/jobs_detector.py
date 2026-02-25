"""
Background Jobs Detector Module
================================

Detects background job and task queue systems:
- Celery (Python)
- BullMQ/Bull (Node.js)
- Sidekiq (Ruby)
- Scheduled tasks and cron jobs
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..base import BaseAnalyzer


class JobsDetector(BaseAnalyzer):
    """Detects background job and task queue systems."""

    def __init__(self, path: Path, analysis: dict[str, Any]):
        super().__init__(path)
        self.analysis = analysis

    def detect(self) -> None:
        """
        Detect background job/task queue systems.

        Detects: Celery, BullMQ, Sidekiq, cron jobs, scheduled tasks.
        """
        jobs_info = None

        # Try each job system in order
        jobs_info = (
            self._detect_celery() or self._detect_bullmq() or self._detect_sidekiq()
        )

        if jobs_info:
            self.analysis["background_jobs"] = jobs_info

    def _detect_celery(self) -> dict[str, Any] | None:
        """Detect Celery (Python) task queue."""
        celery_files = list(self.path.glob("**/celery.py")) + list(
            self.path.glob("**/tasks.py")
        )
        if not celery_files:
            return None

        tasks = []
        for task_file in celery_files:
            try:
                content = task_file.read_text(encoding="utf-8")
                # Find @celery.task or @shared_task decorators
                task_pattern = r"@(?:celery\.task|shared_task|app\.task)\s*(?:\([^)]*\))?\s*def\s+(\w+)"
                task_matches = re.findall(task_pattern, content)

                for task_name in task_matches:
                    tasks.append(
                        {
                            "name": task_name,
                            "file": str(task_file.relative_to(self.path)),
                        }
                    )

            except (OSError, UnicodeDecodeError):
                continue

        if not tasks:
            return None

        return {
            "system": "celery",
            "tasks": tasks,
            "total_tasks": len(tasks),
            "worker_command": "celery -A app worker",
        }

    def _detect_bullmq(self) -> dict[str, Any] | None:
        """Detect BullMQ/Bull (Node.js) task queue."""
        if not self._exists("package.json"):
            return None

        pkg = self._read_json("package.json")
        if not pkg:
            return None

        deps = pkg.get("dependencies", {})
        if "bullmq" in deps:
            return {
                "system": "bullmq",
                "tasks": [],
                "worker_command": "node worker.js",
            }
        elif "bull" in deps:
            return {
                "system": "bull",
                "tasks": [],
                "worker_command": "node worker.js",
            }

        return None

    def _detect_sidekiq(self) -> dict[str, Any] | None:
        """Detect Sidekiq (Ruby) background jobs."""
        if not self._exists("Gemfile"):
            return None

        gemfile = self._read_file("Gemfile")
        if "sidekiq" not in gemfile.lower():
            return None

        return {
            "system": "sidekiq",
            "worker_command": "bundle exec sidekiq",
        }

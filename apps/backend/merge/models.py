"""
Merge Models
============

Data models for merge orchestration.

This module contains all the data classes used by the merge orchestrator:
- MergeStats: Statistics from merge operations
- TaskMergeRequest: Request to merge a specific task
- MergeReport: Complete report from a merge operation
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .types import MergeResult


@dataclass
class MergeStats:
    """Statistics from a merge operation."""

    files_processed: int = 0
    files_auto_merged: int = 0
    files_ai_merged: int = 0
    files_need_review: int = 0
    files_failed: int = 0
    conflicts_detected: int = 0
    conflicts_auto_resolved: int = 0
    conflicts_ai_resolved: int = 0
    ai_calls_made: int = 0
    estimated_tokens_used: int = 0
    duration_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "files_processed": self.files_processed,
            "files_auto_merged": self.files_auto_merged,
            "files_ai_merged": self.files_ai_merged,
            "files_need_review": self.files_need_review,
            "files_failed": self.files_failed,
            "conflicts_detected": self.conflicts_detected,
            "conflicts_auto_resolved": self.conflicts_auto_resolved,
            "conflicts_ai_resolved": self.conflicts_ai_resolved,
            "ai_calls_made": self.ai_calls_made,
            "estimated_tokens_used": self.estimated_tokens_used,
            "duration_seconds": self.duration_seconds,
        }

    @property
    def success_rate(self) -> float:
        """Calculate the success rate (auto + AI merges / total)."""
        if self.files_processed == 0:
            return 1.0
        return (self.files_auto_merged + self.files_ai_merged) / self.files_processed

    @property
    def auto_merge_rate(self) -> float:
        """Calculate percentage resolved without AI."""
        if self.conflicts_detected == 0:
            return 1.0
        return self.conflicts_auto_resolved / self.conflicts_detected


@dataclass
class TaskMergeRequest:
    """Request to merge a specific task's changes."""

    task_id: str
    worktree_path: Path
    intent: str = ""
    priority: int = 0  # Higher = merge first in case of ordering


@dataclass
class MergeReport:
    """Complete report from a merge operation."""

    started_at: datetime
    completed_at: datetime | None = None
    tasks_merged: list[str] = field(default_factory=list)
    file_results: dict[str, MergeResult] = field(default_factory=dict)
    stats: MergeStats = field(default_factory=MergeStats)
    success: bool = True
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat()
            if self.completed_at
            else None,
            "tasks_merged": self.tasks_merged,
            "file_results": {
                path: result.to_dict() for path, result in self.file_results.items()
            },
            "stats": self.stats.to_dict(),
            "success": self.success,
            "error": self.error,
        }

    def save(self, path: Path) -> None:
        """Save report to JSON file."""
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

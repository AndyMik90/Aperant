"""
Conflict Resolver
=================

Conflict resolution logic for merge orchestration.

This module handles:
- Resolving conflicts using AutoMerger and AIResolver
- Building human-readable explanations
- Determining merge decisions
"""

from __future__ import annotations

import logging

from .ai_resolver import AIResolver
from .auto_merger import AutoMerger, MergeContext
from .file_merger import apply_ai_merge, extract_location_content
from .progress import MergeProgressCallback, MergeProgressStage
from .types import (
    ConflictRegion,
    ConflictSeverity,
    MergeDecision,
    MergeResult,
    TaskSnapshot,
)

logger = logging.getLogger(__name__)


class ConflictResolver:
    """
    Resolves conflicts using deterministic and AI-based strategies.

    This class coordinates between AutoMerger (for deterministic conflicts)
    and AIResolver (for ambiguous conflicts requiring AI assistance).
    """

    def __init__(
        self,
        auto_merger: AutoMerger,
        ai_resolver: AIResolver | None = None,
        enable_ai: bool = True,
    ):
        """
        Initialize the conflict resolver.

        Args:
            auto_merger: AutoMerger instance for deterministic resolution
            ai_resolver: Optional AIResolver instance for AI-based resolution
            enable_ai: Whether to use AI for ambiguous conflicts
        """
        self.auto_merger = auto_merger
        self.ai_resolver = ai_resolver
        self.enable_ai = enable_ai

    def resolve_conflicts(
        self,
        file_path: str,
        baseline_content: str,
        task_snapshots: list[TaskSnapshot],
        conflicts: list[ConflictRegion],
        progress_callback: MergeProgressCallback | None = None,
    ) -> MergeResult:
        """
        Resolve conflicts using AutoMerger and AIResolver.

        Args:
            file_path: Path to the file being merged
            baseline_content: Original file content
            task_snapshots: Snapshots from all tasks modifying this file
            conflicts: List of detected conflicts
            progress_callback: Optional callback for emitting per-conflict
                resolution progress with details about current file and conflict count

        Returns:
            MergeResult with resolution details
        """
        merged_content = baseline_content
        resolved: list[ConflictRegion] = []
        remaining: list[ConflictRegion] = []
        ai_calls = 0
        tokens_used = 0
        total_conflicts = len(conflicts)

        for idx, conflict in enumerate(conflicts):
            if progress_callback:
                # Emit per-conflict progress within the resolving stage (50-75%)
                # Calculate progress after processing (idx + 1) to reach 75% on last conflict
                conflict_percent = 50 + int(((idx + 1) / max(total_conflicts, 1)) * 25)
                progress_callback(
                    stage=MergeProgressStage.RESOLVING,
                    percent=conflict_percent,
                    message=f"Resolving conflict {idx + 1}/{total_conflicts} in {file_path}",
                    details={
                        "current_file": file_path,
                        "conflicts_found": total_conflicts,
                        "conflicts_resolved": len(resolved),
                    },
                )
            # Try auto-merge first
            if conflict.can_auto_merge and conflict.merge_strategy:
                context = MergeContext(
                    file_path=file_path,
                    baseline_content=merged_content,
                    task_snapshots=task_snapshots,
                    conflict=conflict,
                )

                result = self.auto_merger.merge(context, conflict.merge_strategy)

                if result.success:
                    merged_content = result.merged_content or merged_content
                    resolved.append(conflict)
                    continue

            # Try AI resolver if enabled
            if (
                self.enable_ai
                and self.ai_resolver
                and conflict.severity
                in {
                    ConflictSeverity.MEDIUM,
                    ConflictSeverity.HIGH,
                }
            ):
                # Extract baseline for conflict location
                conflict_baseline = extract_location_content(
                    baseline_content, conflict.location
                )

                ai_result = self.ai_resolver.resolve_conflict(
                    conflict=conflict,
                    baseline_code=conflict_baseline,
                    task_snapshots=task_snapshots,
                )

                ai_calls += ai_result.ai_calls_made
                tokens_used += ai_result.tokens_used

                if ai_result.success:
                    # Apply AI-merged content
                    merged_content = apply_ai_merge(
                        merged_content,
                        conflict.location,
                        ai_result.merged_content or "",
                    )
                    resolved.append(conflict)
                    continue

            # Could not resolve
            remaining.append(conflict)

        # Determine final decision
        if not remaining:
            decision = (
                MergeDecision.AUTO_MERGED if ai_calls == 0 else MergeDecision.AI_MERGED
            )
        elif remaining and resolved:
            decision = MergeDecision.NEEDS_HUMAN_REVIEW
        else:
            decision = MergeDecision.FAILED

        return MergeResult(
            decision=decision,
            file_path=file_path,
            merged_content=merged_content if decision != MergeDecision.FAILED else None,
            conflicts_resolved=resolved,
            conflicts_remaining=remaining,
            ai_calls_made=ai_calls,
            tokens_used=tokens_used,
            explanation=build_explanation(resolved, remaining),
        )


def build_explanation(
    resolved: list[ConflictRegion],
    remaining: list[ConflictRegion],
) -> str:
    """
    Build a human-readable explanation of the merge.

    Args:
        resolved: List of successfully resolved conflicts
        remaining: List of unresolved conflicts

    Returns:
        Multi-line explanation string
    """
    parts = []

    if resolved:
        parts.append(f"Resolved {len(resolved)} conflict(s):")
        for c in resolved[:5]:  # Limit to first 5
            strategy_str = c.merge_strategy.value if c.merge_strategy else "auto"
            parts.append(f"  - {c.location}: {strategy_str}")
        if len(resolved) > 5:
            parts.append(f"  ... and {len(resolved) - 5} more")

    if remaining:
        parts.append(f"\nUnresolved {len(remaining)} conflict(s) - need human review:")
        for c in remaining[:5]:
            parts.append(f"  - {c.location}: {c.reason}")
        if len(remaining) > 5:
            parts.append(f"  ... and {len(remaining) - 5} more")

    return "\n".join(parts) if parts else "No conflicts"

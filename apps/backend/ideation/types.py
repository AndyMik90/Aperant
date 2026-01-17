"""
Type definitions for the ideation module.

Contains dataclasses and type definitions used throughout ideation components.
"""

from dataclasses import dataclass
from pathlib import Path


@dataclass
class IdeationPhaseResult:
    """Result of an ideation phase execution."""

    phase: str
    ideation_type: str | None
    success: bool
    output_files: list[str]
    ideas_count: int
    errors: list[str]
    retries: int


@dataclass
class IdeationConfig:
    """Configuration for ideation generation."""

    project_dir: Path
    output_dir: Path
    enabled_types: list[str]
    include_roadmap_context: bool = True
    include_kanban_context: bool = True
    max_ideas_per_type: int = 5
    model: str = "sonnet"  # Changed from "opus" (fix #433)
    refresh: bool = False
    append: bool = False  # If True, preserve existing ideas when merging
    language: str = "en"  # Output language for generated content (en, zh-CN, fr, etc.)

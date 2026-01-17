"""
Data models for roadmap generation.
"""

from dataclasses import dataclass
from pathlib import Path


@dataclass
class RoadmapPhaseResult:
    """Result of a roadmap phase execution."""

    phase: str
    success: bool
    output_files: list[str]
    errors: list[str]
    retries: int


@dataclass
class RoadmapConfig:
    """Configuration for roadmap generation."""

    project_dir: Path
    output_dir: Path
    model: str = "sonnet"  # Changed from "opus" (fix #433)
    refresh: bool = False  # Force regeneration even if roadmap exists
    enable_competitor_analysis: bool = False  # Enable competitor analysis phase
    language: str = "en"  # Output language for generated content (en, zh-CN, fr, etc.)

"""
Smart Project Analyzer for Dynamic Security Profiles
=====================================================

FACADE MODULE: This module re-exports all functionality from the
ac-jerry/project/ package for backward compatibility.

The implementation has been refactored into focused modules:
- project/command_registry.py - Command registries
- project/models.py - Data structures
- project/config_parser.py - Config file parsing
- project/stack_detector.py - Stack detection
- project/framework_detector.py - Framework detection
- project/structure_analyzer.py - Project structure analysis
- project/analyzer.py - Main orchestration

This file maintains the original API so existing imports continue to work.

This system:
1. Detects languages, frameworks, databases, and infrastructure
2. Parses package.json scripts, Makefile targets, pyproject.toml scripts
3. Builds a tailored security profile for the specific project
4. Caches the profile for subsequent runs
5. Can re-analyze when project structure changes

The goal: Allow an AI developer to run any command that's legitimately
needed for the detected tech stack, while blocking dangerous operations.
"""

# Re-export all public API from the project module
from project import (
    # Command registries
    BASE_COMMANDS,
    VALIDATED_COMMANDS,
    CustomScripts,
    # Main classes
    ProjectAnalyzer,
    SecurityProfile,
    TechnologyStack,
    # Utility functions
    get_or_create_profile,
    is_command_allowed,
    needs_validation,
)

# Also re-export command registries for backward compatibility
from project.command_registry import (
    CLOUD_COMMANDS,
    CODE_QUALITY_COMMANDS,
    DATABASE_COMMANDS,
    FRAMEWORK_COMMANDS,
    INFRASTRUCTURE_COMMANDS,
    LANGUAGE_COMMANDS,
    PACKAGE_MANAGER_COMMANDS,
    VERSION_MANAGER_COMMANDS,
)

__all__ = [
    # Main classes
    "ProjectAnalyzer",
    "SecurityProfile",
    "TechnologyStack",
    "CustomScripts",
    # Utility functions
    "get_or_create_profile",
    "is_command_allowed",
    "needs_validation",
    # Base command sets
    "BASE_COMMANDS",
    "VALIDATED_COMMANDS",
    # Technology-specific command sets
    "LANGUAGE_COMMANDS",
    "PACKAGE_MANAGER_COMMANDS",
    "FRAMEWORK_COMMANDS",
    "DATABASE_COMMANDS",
    "INFRASTRUCTURE_COMMANDS",
    "CLOUD_COMMANDS",
    "CODE_QUALITY_COMMANDS",
    "VERSION_MANAGER_COMMANDS",
]


# =============================================================================
# CLI for testing
# =============================================================================

if __name__ == "__main__":
    import sys
    from pathlib import Path

    if len(sys.argv) < 2:
        print("Usage: python project_analyzer.py <project_dir> [--force]")
        sys.exit(1)

    project_dir = Path(sys.argv[1])
    force = "--force" in sys.argv

    if not project_dir.exists():
        print(f"Error: {project_dir} does not exist")
        sys.exit(1)

    profile = get_or_create_profile(project_dir, force_reanalyze=force)

    print("\nAllowed commands:")
    for cmd in sorted(profile.get_all_allowed_commands()):
        print(f"  {cmd}")

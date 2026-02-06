"""
Analyzers Package
=================

Modular analyzer system for detecting project structure, frameworks, and services.

Main exports:
- ServiceAnalyzer: Analyzes a single service/package
- ProjectAnalyzer: Analyzes entire projects (single or monorepo)
- analyze_project: Convenience function for project analysis
- analyze_service: Convenience function for service analysis
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .project_analyzer_module import ProjectAnalyzer
from .service_analyzer import ServiceAnalyzer

# Re-export main classes
__all__ = [
    "ServiceAnalyzer",
    "ProjectAnalyzer",
    "analyze_project",
    "analyze_service",
]


def analyze_project(project_dir: Path, output_file: Path | None = None) -> dict:
    """
    Analyze a project and optionally save results.

    Args:
        project_dir: Path to the project root
        output_file: Optional path to save JSON output

    Returns:
        Project index as a dictionary
    """
    import json

    analyzer = ProjectAnalyzer(project_dir)
    results = analyzer.analyze()

    if output_file:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"Project index saved to: {output_file}")

    return results


def analyze_service(
    project_dir: Path, service_name: str, output_file: Path | None = None
) -> dict:
    """
    Analyze a specific service within a project.

    Args:
        project_dir: Path to the project root
        service_name: Name of the service to analyze
        output_file: Optional path to save JSON output

    Returns:
        Service analysis as a dictionary
    """
    import json

    # Find the service
    service_path = project_dir / service_name
    if not service_path.exists():
        # Check common locations
        for parent in ["packages", "apps", "services"]:
            candidate = project_dir / parent / service_name
            if candidate.exists():
                service_path = candidate
                break

    if not service_path.exists():
        raise ValueError(f"Service '{service_name}' not found in {project_dir}")

    analyzer = ServiceAnalyzer(service_path, service_name)
    results = analyzer.analyze()

    if output_file:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"Service analysis saved to: {output_file}")

    return results

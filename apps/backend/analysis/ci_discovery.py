#!/usr/bin/env python3
"""
CI Discovery Module
===================

Parses CI/CD configuration files to extract test commands and workflows.
Supports GitHub Actions, GitLab CI, CircleCI, and Jenkins.

The CI discovery results are used by:
- QA Agent: To understand existing CI test patterns
- Validation Strategy: To match CI commands
- Planner: To align verification with CI

Usage:
    from ci_discovery import CIDiscovery

    discovery = CIDiscovery()
    result = discovery.discover(project_dir)

    if result:
        print(f"CI System: {result.ci_system}")
        print(f"Test Commands: {result.test_commands}")
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Try to import yaml, fall back gracefully
try:
    import yaml

    HAS_YAML = True
except ImportError:
    HAS_YAML = False


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class CIWorkflow:
    """
    Represents a CI workflow or job.

    Attributes:
        name: Name of the workflow/job
        trigger: What triggers this workflow (push, pull_request, etc.)
        steps: List of step names or commands
        test_related: Whether this appears to be test-related
    """

    name: str
    trigger: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    test_related: bool = False


@dataclass
class CIConfig:
    """
    Result of CI configuration discovery.

    Attributes:
        ci_system: Name of CI system (github_actions, gitlab, circleci, jenkins)
        config_files: List of CI config files found
        test_commands: Extracted test commands by type
        coverage_command: Coverage command if found
        workflows: List of discovered workflows
        environment_variables: Environment variables used
    """

    ci_system: str
    config_files: list[str] = field(default_factory=list)
    test_commands: dict[str, str] = field(default_factory=dict)
    coverage_command: str | None = None
    workflows: list[CIWorkflow] = field(default_factory=list)
    environment_variables: list[str] = field(default_factory=list)


# =============================================================================
# CI PARSERS
# =============================================================================


class CIDiscovery:
    """
    Discovers CI/CD configurations in a project.

    Analyzes:
    - GitHub Actions (.github/workflows/*.yml)
    - GitLab CI (.gitlab-ci.yml)
    - CircleCI (.circleci/config.yml)
    - Jenkins (Jenkinsfile)
    """

    def __init__(self) -> None:
        """Initialize CI discovery."""
        self._cache: dict[str, CIConfig | None] = {}

    def discover(self, project_dir: Path) -> CIConfig | None:
        """
        Discover CI configuration in the project.

        Args:
            project_dir: Path to the project root

        Returns:
            CIConfig if CI found, None otherwise
        """
        project_dir = Path(project_dir)
        cache_key = str(project_dir.resolve())

        if cache_key in self._cache:
            return self._cache[cache_key]

        # Try each CI system
        result = None

        # GitHub Actions
        github_workflows = project_dir / ".github" / "workflows"
        if github_workflows.exists():
            result = self._parse_github_actions(github_workflows)

        # GitLab CI
        if not result:
            gitlab_ci = project_dir / ".gitlab-ci.yml"
            if gitlab_ci.exists():
                result = self._parse_gitlab_ci(gitlab_ci)

        # CircleCI
        if not result:
            circleci = project_dir / ".circleci" / "config.yml"
            if circleci.exists():
                result = self._parse_circleci(circleci)

        # Jenkins
        if not result:
            jenkinsfile = project_dir / "Jenkinsfile"
            if jenkinsfile.exists():
                result = self._parse_jenkinsfile(jenkinsfile)

        self._cache[cache_key] = result
        return result

    def _parse_github_actions(self, workflows_dir: Path) -> CIConfig:
        """Parse GitHub Actions workflow files."""
        result = CIConfig(ci_system="github_actions")

        workflow_files = list(workflows_dir.glob("*.yml")) + list(
            workflows_dir.glob("*.yaml")
        )

        for wf_file in workflow_files:
            result.config_files.append(
                str(wf_file.relative_to(workflows_dir.parent.parent))
            )

            try:
                content = wf_file.read_text(encoding="utf-8")
                workflow_data = self._parse_yaml(content)

                if not workflow_data:
                    continue

                # Get workflow name
                wf_name = workflow_data.get("name", wf_file.stem)

                # Get triggers
                triggers = []
                on_trigger = workflow_data.get("on", {})
                if isinstance(on_trigger, str):
                    triggers = [on_trigger]
                elif isinstance(on_trigger, list):
                    triggers = on_trigger
                elif isinstance(on_trigger, dict):
                    triggers = list(on_trigger.keys())

                # Parse jobs
                jobs = workflow_data.get("jobs", {})
                for job_name, job_config in jobs.items():
                    if not isinstance(job_config, dict):
                        continue

                    steps = job_config.get("steps", [])
                    step_commands = []
                    test_related = False

                    for step in steps:
                        if not isinstance(step, dict):
                            continue

                        # Get step name or command
                        step_name = step.get("name", "")
                        run_cmd = step.get("run", "")
                        uses = step.get("uses", "")

                        if step_name:
                            step_commands.append(step_name)
                        if run_cmd:
                            step_commands.append(run_cmd)
                            # Extract test commands
                            self._extract_test_commands(run_cmd, result)
                        if uses:
                            step_commands.append(f"uses: {uses}")

                        # Check if test-related
                        test_keywords = ["test", "pytest", "jest", "vitest", "coverage"]
                        if any(kw in str(step).lower() for kw in test_keywords):
                            test_related = True

                    result.workflows.append(
                        CIWorkflow(
                            name=f"{wf_name}/{job_name}",
                            trigger=triggers,
                            steps=step_commands,
                            test_related=test_related,
                        )
                    )

                # Extract environment variables
                env = workflow_data.get("env", {})
                if isinstance(env, dict):
                    result.environment_variables.extend(env.keys())

            except Exception:
                continue

        return result

    def _parse_gitlab_ci(self, config_file: Path) -> CIConfig:
        """Parse GitLab CI configuration."""
        result = CIConfig(
            ci_system="gitlab",
            config_files=[".gitlab-ci.yml"],
        )

        try:
            content = config_file.read_text(encoding="utf-8")
            data = self._parse_yaml(content)

            if not data:
                return result

            # Parse jobs (top-level keys that aren't special keywords)
            special_keys = {
                "stages",
                "variables",
                "image",
                "services",
                "before_script",
                "after_script",
                "cache",
                "include",
                "default",
                "workflow",
            }

            for key, value in data.items():
                if key.startswith(".") or key in special_keys:
                    continue

                if not isinstance(value, dict):
                    continue

                job_config = value
                script = job_config.get("script", [])
                if isinstance(script, str):
                    script = [script]

                test_related = any(
                    kw in str(script).lower()
                    for kw in ["test", "pytest", "jest", "vitest", "coverage"]
                )

                result.workflows.append(
                    CIWorkflow(
                        name=key,
                        trigger=job_config.get("only", [])
                        or job_config.get("rules", []),
                        steps=script,
                        test_related=test_related,
                    )
                )

                # Extract test commands
                for cmd in script:
                    if isinstance(cmd, str):
                        self._extract_test_commands(cmd, result)

            # Extract variables
            variables = data.get("variables", {})
            if isinstance(variables, dict):
                result.environment_variables.extend(variables.keys())

        except Exception:
            pass

        return result

    def _parse_circleci(self, config_file: Path) -> CIConfig:
        """Parse CircleCI configuration."""
        result = CIConfig(
            ci_system="circleci",
            config_files=[".circleci/config.yml"],
        )

        try:
            content = config_file.read_text(encoding="utf-8")
            data = self._parse_yaml(content)

            if not data:
                return result

            # Parse jobs
            jobs = data.get("jobs", {})
            for job_name, job_config in jobs.items():
                if not isinstance(job_config, dict):
                    continue

                steps = job_config.get("steps", [])
                step_commands = []
                test_related = False

                for step in steps:
                    if isinstance(step, str):
                        step_commands.append(step)
                    elif isinstance(step, dict):
                        if "run" in step:
                            run = step["run"]
                            if isinstance(run, str):
                                step_commands.append(run)
                                self._extract_test_commands(run, result)
                            elif isinstance(run, dict):
                                cmd = run.get("command", "")
                                step_commands.append(cmd)
                                self._extract_test_commands(cmd, result)

                        if any(
                            kw in str(step).lower()
                            for kw in ["test", "pytest", "jest", "coverage"]
                        ):
                            test_related = True

                result.workflows.append(
                    CIWorkflow(
                        name=job_name,
                        trigger=[],
                        steps=step_commands,
                        test_related=test_related,
                    )
                )

        except Exception:
            pass

        return result

    def _parse_jenkinsfile(self, jenkinsfile: Path) -> CIConfig:
        """Parse Jenkinsfile (basic extraction)."""
        result = CIConfig(
            ci_system="jenkins",
            config_files=["Jenkinsfile"],
        )

        try:
            content = jenkinsfile.read_text(encoding="utf-8")

            # Extract sh commands using regex
            sh_pattern = re.compile(r'sh\s+[\'"]([^\'"]+)[\'"]')
            matches = sh_pattern.findall(content)

            steps = []
            test_related = False

            for cmd in matches:
                steps.append(cmd)
                self._extract_test_commands(cmd, result)

                if any(
                    kw in cmd.lower() for kw in ["test", "pytest", "jest", "coverage"]
                ):
                    test_related = True

            # Extract stage names
            stage_pattern = re.compile(r'stage\s*\([\'"]([^\'"]+)[\'"]\)')
            stages = stage_pattern.findall(content)

            for stage in stages:
                result.workflows.append(
                    CIWorkflow(
                        name=stage,
                        trigger=[],
                        steps=steps if "test" in stage.lower() else [],
                        test_related="test" in stage.lower(),
                    )
                )

        except Exception:
            pass

        return result

    def _parse_yaml(self, content: str) -> dict | None:
        """Parse YAML content, with fallback to basic parsing if yaml not available."""
        if HAS_YAML:
            try:
                return yaml.safe_load(content)
            except Exception:
                return None

        # Basic fallback for simple YAML (very limited)
        # This won't work for complex structures
        return None

    def _extract_test_commands(self, cmd: str, result: CIConfig) -> None:
        """Extract test commands from a command string."""
        cmd_lower = cmd.lower()

        # Python pytest
        if "pytest" in cmd_lower:
            if "pytest" not in result.test_commands:
                result.test_commands["unit"] = cmd.strip()
            if "--cov" in cmd_lower:
                result.coverage_command = cmd.strip()

        # Node.js test commands
        if (
            "npm test" in cmd_lower
            or "yarn test" in cmd_lower
            or "pnpm test" in cmd_lower
        ):
            if "unit" not in result.test_commands:
                result.test_commands["unit"] = cmd.strip()

        # Jest/Vitest
        if "jest" in cmd_lower or "vitest" in cmd_lower:
            if "unit" not in result.test_commands:
                result.test_commands["unit"] = cmd.strip()
            if "--coverage" in cmd_lower:
                result.coverage_command = cmd.strip()

        # E2E testing
        if "playwright" in cmd_lower:
            result.test_commands["e2e"] = cmd.strip()
        if "cypress" in cmd_lower:
            result.test_commands["e2e"] = cmd.strip()

        # Integration tests
        if "integration" in cmd_lower:
            result.test_commands["integration"] = cmd.strip()

        # Go tests
        if "go test" in cmd_lower:
            if "unit" not in result.test_commands:
                result.test_commands["unit"] = cmd.strip()

        # Rust tests
        if "cargo test" in cmd_lower:
            if "unit" not in result.test_commands:
                result.test_commands["unit"] = cmd.strip()

    def to_dict(self, result: CIConfig) -> dict[str, Any]:
        """Convert result to dictionary for JSON serialization."""
        return {
            "ci_system": result.ci_system,
            "config_files": result.config_files,
            "test_commands": result.test_commands,
            "coverage_command": result.coverage_command,
            "workflows": [
                {
                    "name": w.name,
                    "trigger": w.trigger,
                    "steps": w.steps,
                    "test_related": w.test_related,
                }
                for w in result.workflows
            ],
            "environment_variables": result.environment_variables,
        }

    def clear_cache(self) -> None:
        """Clear the internal cache."""
        self._cache.clear()


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


def discover_ci(project_dir: Path) -> CIConfig | None:
    """
    Convenience function to discover CI configuration.

    Args:
        project_dir: Path to project root

    Returns:
        CIConfig if found, None otherwise
    """
    discovery = CIDiscovery()
    return discovery.discover(project_dir)


def get_ci_test_commands(project_dir: Path) -> dict[str, str]:
    """
    Get test commands from CI configuration.

    Args:
        project_dir: Path to project root

    Returns:
        Dictionary of test type to command
    """
    discovery = CIDiscovery()
    result = discovery.discover(project_dir)
    if result:
        return result.test_commands
    return {}


def get_ci_system(project_dir: Path) -> str | None:
    """
    Get the CI system name if configured.

    Args:
        project_dir: Path to project root

    Returns:
        CI system name or None
    """
    discovery = CIDiscovery()
    result = discovery.discover(project_dir)
    if result:
        return result.ci_system
    return None


# =============================================================================
# CLI
# =============================================================================


def main() -> None:
    """CLI entry point for testing."""
    import argparse

    parser = argparse.ArgumentParser(description="Discover CI configuration")
    parser.add_argument("project_dir", type=Path, help="Path to project root")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    discovery = CIDiscovery()
    result = discovery.discover(args.project_dir)

    if not result:
        print("No CI configuration found")
        return

    if args.json:
        print(json.dumps(discovery.to_dict(result), indent=2))
    else:
        print(f"CI System: {result.ci_system}")
        print(f"Config Files: {', '.join(result.config_files)}")
        print("\nTest Commands:")
        for test_type, cmd in result.test_commands.items():
            print(f"  {test_type}: {cmd}")
        if result.coverage_command:
            print(f"\nCoverage Command: {result.coverage_command}")
        print(f"\nWorkflows ({len(result.workflows)}):")
        for w in result.workflows:
            marker = "[TEST]" if w.test_related else ""
            print(f"  - {w.name} {marker}")
            if w.trigger:
                print(f"    Triggers: {', '.join(str(t) for t in w.trigger)}")
        if result.environment_variables:
            print(f"\nEnvironment Variables: {', '.join(result.environment_variables)}")


if __name__ == "__main__":
    main()

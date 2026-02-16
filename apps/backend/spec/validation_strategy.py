#!/usr/bin/env python3
"""
Validation Strategy Module
==========================

Builds validation strategies based on project type and risk level.
This module determines how the QA agent should validate implementations.

The validation strategy is used by:
- Planner Agent: To define verification requirements in the implementation plan
- QA Agent: To determine what tests to create and run

Usage:
    from spec.validation_strategy import ValidationStrategyBuilder

    builder = ValidationStrategyBuilder()
    strategy = builder.build_strategy(project_dir, spec_dir, "medium")

    for step in strategy:
        print(f"Run: {step.command}")
"""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from risk_classifier import RiskClassifier

# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class ValidationStep:
    """
    A single validation step to execute.

    Attributes:
        name: Human-readable name of the step
        command: Command to execute (or "manual" for manual steps)
        expected_outcome: Description of what success looks like
        step_type: Type of validation (test, visual, api, security, manual)
        required: Whether this step is mandatory
        blocking: Whether failure blocks approval
    """

    name: str
    command: str
    expected_outcome: str
    step_type: str  # test, visual, api, security, manual
    required: bool = True
    blocking: bool = True


@dataclass
class ValidationStrategy:
    """
    Complete validation strategy for a task.

    Attributes:
        risk_level: Risk level (trivial, low, medium, high, critical)
        project_type: Detected project type
        steps: List of validation steps to execute
        test_types_required: List of test types to create
        security_scan_required: Whether security scanning is needed
        staging_deployment_required: Whether staging deployment is needed
        skip_validation: Whether validation can be skipped entirely
        reasoning: Explanation of the strategy
    """

    risk_level: str
    project_type: str
    steps: list[ValidationStep] = field(default_factory=list)
    test_types_required: list[str] = field(default_factory=list)
    security_scan_required: bool = False
    staging_deployment_required: bool = False
    skip_validation: bool = False
    reasoning: str = ""


# =============================================================================
# PROJECT TYPE DETECTION
# =============================================================================


# Project type indicators
PROJECT_TYPE_INDICATORS = {
    "html_css": {
        "files": ["index.html", "style.css", "styles.css"],
        "extensions": [".html", ".css"],
        "no_package_manager": True,
    },
    "react_spa": {
        "dependencies": ["react", "react-dom"],
        "files": ["package.json"],
    },
    "vue_spa": {
        "dependencies": ["vue"],
        "files": ["package.json"],
    },
    "nextjs": {
        "dependencies": ["next"],
        "files": ["next.config.js", "next.config.mjs", "next.config.ts"],
    },
    "nodejs": {
        "files": ["package.json"],
        "not_dependencies": ["react", "vue", "next", "angular"],
    },
    "python_api": {
        "dependencies_python": ["fastapi", "flask", "django"],
        "files": ["pyproject.toml", "setup.py", "requirements.txt"],
    },
    "python_cli": {
        "files": ["pyproject.toml", "setup.py"],
        "entry_points": True,
    },
    "rust": {
        "files": ["Cargo.toml"],
    },
    "go": {
        "files": ["go.mod"],
    },
    "ruby": {
        "files": ["Gemfile"],
    },
}


def detect_project_type(project_dir: Path) -> str:
    """
    Detect the project type based on files and dependencies.

    Args:
        project_dir: Path to the project directory

    Returns:
        Project type string (e.g., "react_spa", "python_api", "nodejs")
    """
    project_dir = Path(project_dir)

    # Check for specific frameworks first
    package_json = project_dir / "package.json"
    if package_json.exists():
        try:
            with open(package_json, encoding="utf-8") as f:
                pkg = json.load(f)
            deps = pkg.get("dependencies", {})
            dev_deps = pkg.get("devDependencies", {})
            all_deps = {**deps, **dev_deps}

            if "electron" in all_deps:
                return "electron"
            if "next" in all_deps:
                return "nextjs"
            if "react" in all_deps:
                return "react_spa"
            if "vue" in all_deps:
                return "vue_spa"
            if "@angular/core" in all_deps:
                return "angular_spa"
            return "nodejs"
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return "nodejs"

    # Check for Python projects
    pyproject = project_dir / "pyproject.toml"
    requirements = project_dir / "requirements.txt"
    if pyproject.exists() or requirements.exists():
        # Try to detect API framework
        deps_text = ""
        if requirements.exists():
            deps_text = requirements.read_text(encoding="utf-8").lower()
        if pyproject.exists():
            deps_text += pyproject.read_text(encoding="utf-8").lower()

        if "fastapi" in deps_text or "flask" in deps_text or "django" in deps_text:
            return "python_api"
        if "click" in deps_text or "typer" in deps_text or "argparse" in deps_text:
            return "python_cli"
        return "python"

    # Check for other languages
    if (project_dir / "Cargo.toml").exists():
        return "rust"
    if (project_dir / "go.mod").exists():
        return "go"
    if (project_dir / "Gemfile").exists():
        return "ruby"

    # Check for simple HTML/CSS
    html_files = list(project_dir.glob("*.html"))
    if html_files:
        return "html_css"

    return "unknown"


# =============================================================================
# VALIDATION STRATEGY BUILDER
# =============================================================================


class ValidationStrategyBuilder:
    """
    Builds validation strategies based on project type and risk level.

    The builder uses the risk assessment from complexity_assessment.json
    and adapts the validation strategy to the detected project type.
    """

    def __init__(self) -> None:
        """Initialize the strategy builder."""
        self._risk_classifier = RiskClassifier()

    def build_strategy(
        self,
        project_dir: Path,
        spec_dir: Path,
        risk_level: str | None = None,
    ) -> ValidationStrategy:
        """
        Build a validation strategy for the given project and spec.

        Args:
            project_dir: Path to the project root
            spec_dir: Path to the spec directory
            risk_level: Override risk level (if not provided, reads from assessment)

        Returns:
            ValidationStrategy with appropriate steps
        """
        project_dir = Path(project_dir)
        spec_dir = Path(spec_dir)

        # Get risk level from assessment if not provided
        if risk_level is None:
            assessment = self._risk_classifier.load_assessment(spec_dir)
            if assessment:
                risk_level = assessment.validation.risk_level
            else:
                risk_level = "medium"  # Default to medium

        # Detect project type
        project_type = detect_project_type(project_dir)

        # Build strategy based on project type
        strategy_builders = {
            "html_css": self._strategy_for_html_css,
            "react_spa": self._strategy_for_spa,
            "vue_spa": self._strategy_for_spa,
            "angular_spa": self._strategy_for_spa,
            "nextjs": self._strategy_for_fullstack,
            "nodejs": self._strategy_for_nodejs,
            "electron": self._strategy_for_electron,
            "python_api": self._strategy_for_python_api,
            "python_cli": self._strategy_for_cli,
            "python": self._strategy_for_python,
            "rust": self._strategy_for_rust,
            "go": self._strategy_for_go,
            "ruby": self._strategy_for_ruby,
        }

        builder_func = strategy_builders.get(project_type, self._strategy_default)
        strategy = builder_func(project_dir, risk_level)

        # Add security scanning for high+ risk
        if risk_level in ["high", "critical"]:
            strategy = self._add_security_steps(strategy, project_type)

        # Set common properties
        strategy.risk_level = risk_level
        strategy.project_type = project_type
        strategy.skip_validation = risk_level == "trivial"

        return strategy

    def _strategy_for_html_css(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for simple HTML/CSS projects.

        Focus on visual verification and accessibility.
        """
        steps = [
            ValidationStep(
                name="Start HTTP Server",
                command="python -m http.server 8000 &",
                expected_outcome="Server running on port 8000",
                step_type="setup",
                required=True,
                blocking=True,
            ),
            ValidationStep(
                name="Visual Verification",
                command="npx playwright screenshot http://localhost:8000 screenshot.png",
                expected_outcome="Screenshot captured without errors",
                step_type="visual",
                required=True,
                blocking=False,
            ),
            ValidationStep(
                name="Console Error Check",
                command="npx playwright test --grep 'console-errors'",
                expected_outcome="No JavaScript console errors",
                step_type="test",
                required=True,
                blocking=True,
            ),
        ]

        # Add Lighthouse for medium+ risk
        if risk_level in ["medium", "high", "critical"]:
            steps.append(
                ValidationStep(
                    name="Lighthouse Audit",
                    command="npx lighthouse http://localhost:8000 --output=json --output-path=lighthouse.json",
                    expected_outcome="Performance > 90, Accessibility > 90",
                    step_type="visual",
                    required=True,
                    blocking=risk_level in ["high", "critical"],
                )
            )

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="html_css",
            steps=steps,
            test_types_required=["visual"] if risk_level != "trivial" else [],
            reasoning="HTML/CSS project requires visual verification and accessibility checks.",
        )

    def _strategy_for_spa(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for Single Page Applications (React, Vue, Angular).

        Focus on component tests and E2E testing.
        """
        steps = []

        # Unit/component tests for all non-trivial
        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Unit/Component Tests",
                    command="npm test",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # E2E tests for medium+ risk
        if risk_level in ["medium", "high", "critical"]:
            steps.append(
                ValidationStep(
                    name="E2E Tests",
                    command="npx playwright test",
                    expected_outcome="All E2E tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # Browser console check
        steps.append(
            ValidationStep(
                name="Console Error Check",
                command="npm run dev & sleep 5 && npx playwright test --grep 'no-console-errors'",
                expected_outcome="No console errors in browser",
                step_type="test",
                required=True,
                blocking=risk_level in ["high", "critical"],
            )
        )

        # Determine test types
        test_types = ["unit"]
        if risk_level in ["medium", "high", "critical"]:
            test_types.append("integration")
        if risk_level in ["high", "critical"]:
            test_types.append("e2e")

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="spa",
            steps=steps,
            test_types_required=test_types,
            reasoning="SPA requires component tests for logic and E2E for user flows.",
        )

    def _strategy_for_fullstack(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for fullstack frameworks (Next.js, Rails, Django).

        Focus on API tests, frontend tests, and integration.
        """
        steps = []

        # Unit tests
        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Unit Tests",
                    command="npm test",
                    expected_outcome="All unit tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # API tests for medium+ risk
        if risk_level in ["medium", "high", "critical"]:
            steps.append(
                ValidationStep(
                    name="API Integration Tests",
                    command="npm run test:api",
                    expected_outcome="All API tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # E2E tests for high+ risk
        if risk_level in ["high", "critical"]:
            steps.append(
                ValidationStep(
                    name="E2E Tests",
                    command="npm run test:e2e",
                    expected_outcome="All E2E tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # Database migration check
        steps.append(
            ValidationStep(
                name="Database Migration Check",
                command="npm run db:migrate:status",
                expected_outcome="All migrations applied successfully",
                step_type="api",
                required=risk_level in ["medium", "high", "critical"],
                blocking=True,
            )
        )

        # Determine test types
        test_types = ["unit"]
        if risk_level in ["medium", "high", "critical"]:
            test_types.append("integration")
        if risk_level in ["high", "critical"]:
            test_types.append("e2e")

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="fullstack",
            steps=steps,
            test_types_required=test_types,
            reasoning="Fullstack requires API tests, frontend tests, and DB migration checks.",
        )

    def _strategy_for_nodejs(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for Node.js backend projects.
        """
        steps = []

        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Unit Tests",
                    command="npm test",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        if risk_level in ["medium", "high", "critical"]:
            steps.append(
                ValidationStep(
                    name="Integration Tests",
                    command="npm run test:integration",
                    expected_outcome="All integration tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        test_types = ["unit"]
        if risk_level in ["medium", "high", "critical"]:
            test_types.append("integration")

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="nodejs",
            steps=steps,
            test_types_required=test_types,
            reasoning="Node.js backend requires unit and integration tests.",
        )

    def _strategy_for_python_api(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for Python API projects (FastAPI, Flask, Django).
        """
        steps = []

        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Unit Tests",
                    command="pytest tests/ -v",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        if risk_level in ["medium", "high", "critical"]:
            steps.append(
                ValidationStep(
                    name="API Tests",
                    command="pytest tests/api/ -v",
                    expected_outcome="All API tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )
            steps.append(
                ValidationStep(
                    name="Coverage Check",
                    command="pytest --cov=src --cov-report=term-missing",
                    expected_outcome="Coverage >= 80%",
                    step_type="test",
                    required=True,
                    blocking=risk_level == "critical",
                )
            )

        if risk_level in ["high", "critical"]:
            steps.append(
                ValidationStep(
                    name="Database Migration Check",
                    command="alembic current && alembic check",
                    expected_outcome="Migrations are current and valid",
                    step_type="api",
                    required=True,
                    blocking=True,
                )
            )

        test_types = ["unit"]
        if risk_level in ["medium", "high", "critical"]:
            test_types.append("integration")
        if risk_level in ["high", "critical"]:
            test_types.append("e2e")

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="python_api",
            steps=steps,
            test_types_required=test_types,
            reasoning="Python API requires pytest tests and migration checks.",
        )

    def _strategy_for_cli(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for CLI tools.
        """
        steps = []

        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Unit Tests",
                    command="pytest tests/ -v",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )
            steps.append(
                ValidationStep(
                    name="CLI Help Check",
                    command="python -m module_name --help",
                    expected_outcome="Help text displays without errors",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        if risk_level in ["medium", "high", "critical"]:
            steps.append(
                ValidationStep(
                    name="CLI Output Verification",
                    command="python -m module_name --version",
                    expected_outcome="Version displays correctly",
                    step_type="test",
                    required=True,
                    blocking=False,
                )
            )

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="python_cli",
            steps=steps,
            test_types_required=["unit"],
            reasoning="CLI tools require output verification and unit tests.",
        )

    def _strategy_for_python(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for generic Python projects.
        """
        steps = []

        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Unit Tests",
                    command="pytest tests/ -v",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        test_types = ["unit"]
        if risk_level in ["medium", "high", "critical"]:
            test_types.append("integration")

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="python",
            steps=steps,
            test_types_required=test_types,
            reasoning="Python project requires pytest unit tests.",
        )

    def _strategy_for_rust(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for Rust projects.
        """
        steps = []

        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Cargo Test",
                    command="cargo test",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )
            steps.append(
                ValidationStep(
                    name="Cargo Clippy",
                    command="cargo clippy -- -D warnings",
                    expected_outcome="No clippy warnings",
                    step_type="test",
                    required=True,
                    blocking=risk_level in ["high", "critical"],
                )
            )

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="rust",
            steps=steps,
            test_types_required=["unit"],
            reasoning="Rust project requires cargo test and clippy checks.",
        )

    def _strategy_for_go(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for Go projects.
        """
        steps = []

        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Go Test",
                    command="go test ./...",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )
            steps.append(
                ValidationStep(
                    name="Go Vet",
                    command="go vet ./...",
                    expected_outcome="No issues found",
                    step_type="test",
                    required=True,
                    blocking=risk_level in ["high", "critical"],
                )
            )

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="go",
            steps=steps,
            test_types_required=["unit"],
            reasoning="Go project requires go test and vet checks.",
        )

    def _strategy_for_ruby(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for Ruby projects.
        """
        steps = []

        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="RSpec Tests",
                    command="bundle exec rspec",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="ruby",
            steps=steps,
            test_types_required=["unit"],
            reasoning="Ruby project requires RSpec tests.",
        )

    def _strategy_for_electron(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Validation strategy for Electron desktop applications.

        Focus on main/renderer process tests, E2E testing, and app packaging.
        """
        steps = []

        # Unit tests for all non-trivial
        if risk_level != "trivial":
            steps.append(
                ValidationStep(
                    name="Unit Tests",
                    command="npm test",
                    expected_outcome="All tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # E2E tests for medium+ risk (Electron apps need GUI testing)
        if risk_level in ["medium", "high", "critical"]:
            steps.append(
                ValidationStep(
                    name="E2E Tests",
                    command="npm run test:e2e",
                    expected_outcome="All E2E tests pass",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # App build/package verification for medium+ risk
        if risk_level in ["medium", "high", "critical"]:
            steps.append(
                ValidationStep(
                    name="Build Verification",
                    command="npm run build",
                    expected_outcome="App builds without errors",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # Console error check for high+ risk
        if risk_level in ["high", "critical"]:
            steps.append(
                ValidationStep(
                    name="Console Error Check",
                    command="npm run test:console",
                    expected_outcome="No console errors in main or renderer process",
                    step_type="test",
                    required=True,
                    blocking=True,
                )
            )

        # Determine test types
        test_types = ["unit"]
        if risk_level in ["medium", "high", "critical"]:
            test_types.append("integration")
            test_types.append("e2e")

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="electron",
            steps=steps,
            test_types_required=test_types,
            reasoning="Electron app requires unit tests, E2E tests for GUI, and build verification.",
        )

    def _strategy_default(
        self, project_dir: Path, risk_level: str
    ) -> ValidationStrategy:
        """
        Default validation strategy for unknown project types.
        """
        steps = [
            ValidationStep(
                name="Manual Verification",
                command="manual",
                expected_outcome="Code changes reviewed and tested manually",
                step_type="manual",
                required=True,
                blocking=True,
            ),
        ]

        return ValidationStrategy(
            risk_level=risk_level,
            project_type="unknown",
            steps=steps,
            test_types_required=[],
            reasoning="Unknown project type - manual verification required.",
        )

    def _add_security_steps(
        self, strategy: ValidationStrategy, project_type: str
    ) -> ValidationStrategy:
        """
        Add security scanning steps to a strategy.
        """
        security_steps = []

        # Secrets scanning (always for high+ risk)
        security_steps.append(
            ValidationStep(
                name="Secrets Scan",
                command="python auto-claude/scan_secrets.py --all-files --json",
                expected_outcome="No secrets detected",
                step_type="security",
                required=True,
                blocking=True,
            )
        )

        # Language-specific SAST
        if project_type in ["python", "python_api", "python_cli"]:
            security_steps.append(
                ValidationStep(
                    name="Bandit Security Scan",
                    command="bandit -r src/ -f json",
                    expected_outcome="No high severity issues",
                    step_type="security",
                    required=True,
                    blocking=True,
                )
            )

        if project_type in ["nodejs", "react_spa", "vue_spa", "nextjs"]:
            security_steps.append(
                ValidationStep(
                    name="npm audit",
                    command="npm audit --json",
                    expected_outcome="No critical vulnerabilities",
                    step_type="security",
                    required=True,
                    blocking=True,
                )
            )

        strategy.steps.extend(security_steps)
        strategy.security_scan_required = True

        return strategy

    def to_dict(self, strategy: ValidationStrategy) -> dict[str, Any]:
        """
        Convert a ValidationStrategy to a dictionary for JSON serialization.
        """
        return {
            "risk_level": strategy.risk_level,
            "project_type": strategy.project_type,
            "skip_validation": strategy.skip_validation,
            "test_types_required": strategy.test_types_required,
            "security_scan_required": strategy.security_scan_required,
            "staging_deployment_required": strategy.staging_deployment_required,
            "reasoning": strategy.reasoning,
            "steps": [
                {
                    "name": step.name,
                    "command": step.command,
                    "expected_outcome": step.expected_outcome,
                    "type": step.step_type,
                    "required": step.required,
                    "blocking": step.blocking,
                }
                for step in strategy.steps
            ],
        }


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


def build_validation_strategy(
    project_dir: Path,
    spec_dir: Path,
    risk_level: str | None = None,
) -> ValidationStrategy:
    """
    Convenience function to build a validation strategy.

    Args:
        project_dir: Path to project root
        spec_dir: Path to spec directory
        risk_level: Optional override for risk level

    Returns:
        ValidationStrategy object
    """
    builder = ValidationStrategyBuilder()
    return builder.build_strategy(project_dir, spec_dir, risk_level)


def get_strategy_as_dict(
    project_dir: Path,
    spec_dir: Path,
    risk_level: str | None = None,
) -> dict[str, Any]:
    """
    Get validation strategy as a dictionary.

    Args:
        project_dir: Path to project root
        spec_dir: Path to spec directory
        risk_level: Optional override for risk level

    Returns:
        Dictionary representation of strategy
    """
    builder = ValidationStrategyBuilder()
    strategy = builder.build_strategy(project_dir, spec_dir, risk_level)
    return builder.to_dict(strategy)


# =============================================================================
# CLI
# =============================================================================


def main() -> None:
    """CLI entry point for testing."""
    import argparse

    parser = argparse.ArgumentParser(description="Build validation strategy")
    parser.add_argument("project_dir", type=Path, help="Path to project root")
    parser.add_argument("--spec-dir", type=Path, help="Path to spec directory")
    parser.add_argument("--risk-level", type=str, help="Override risk level")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    spec_dir = args.spec_dir or args.project_dir
    builder = ValidationStrategyBuilder()
    strategy = builder.build_strategy(args.project_dir, spec_dir, args.risk_level)

    if args.json:
        print(json.dumps(builder.to_dict(strategy), indent=2))
    else:
        print(f"Project Type: {strategy.project_type}")
        print(f"Risk Level: {strategy.risk_level}")
        print(f"Skip Validation: {strategy.skip_validation}")
        print(f"Test Types: {', '.join(strategy.test_types_required)}")
        print(f"Security Scan: {strategy.security_scan_required}")
        print(f"Reasoning: {strategy.reasoning}")
        print(f"\nValidation Steps ({len(strategy.steps)}):")
        for i, step in enumerate(strategy.steps, 1):
            print(f"  {i}. {step.name}")
            print(f"     Command: {step.command}")
            print(f"     Expected: {step.expected_outcome}")


if __name__ == "__main__":
    main()

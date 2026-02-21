"""
Spec Writing and Critique Phase Implementations
================================================

Phases for spec document creation and quality assurance.
"""

import json
from pathlib import Path

from .. import validator, writer
from ..discovery import get_project_index_stats
from .models import MAX_RETRIES, PhaseResult


def _is_greenfield_project(spec_dir: Path) -> bool:
    """Check if the project is empty/greenfield (0 discovered files)."""
    stats = get_project_index_stats(spec_dir)
    if not stats:
        return False  # Can't determine - don't assume greenfield
    return stats.get("file_count", 0) == 0


def _greenfield_context() -> str:
    """Return additional context for greenfield/empty projects."""
    return """
**GREENFIELD PROJECT**: This is an empty or new project with no existing code.
There are no existing files to reference or modify. You are creating everything from scratch.

Adapt your approach:
- Do NOT reference existing files, patterns, or code structures
- Focus on what needs to be CREATED, not modified
- Define the initial project structure, files, and directories
- Specify the tech stack, frameworks, and dependencies to install
- Provide setup instructions for the new project
- For "Files to Modify" and "Files to Reference" sections, list files to CREATE instead
- For "Patterns to Follow", describe industry best practices rather than existing code
"""


class SpecPhaseMixin:
    """Mixin for spec writing and critique phase methods."""

    def _check_and_log_greenfield(self) -> bool:
        """Check if the project is greenfield and log if so.

        Returns:
            True if the project is greenfield (no existing files).
        """
        is_greenfield = _is_greenfield_project(self.spec_dir)
        if is_greenfield:
            self.ui.print_status(
                "Greenfield project detected - adapting spec for new project", "info"
            )
        return is_greenfield

    async def phase_quick_spec(self) -> PhaseResult:
        """Quick spec for simple tasks - combines context and spec in one step."""
        spec_file = self.spec_dir / "spec.md"
        plan_file = self.spec_dir / "implementation_plan.json"

        if spec_file.exists() and plan_file.exists():
            self.ui.print_status("Quick spec already exists", "success")
            return PhaseResult(
                "quick_spec", True, [str(spec_file), str(plan_file)], [], 0
            )

        is_greenfield = self._check_and_log_greenfield()

        errors = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running quick spec agent (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
**Task**: {self.task_description}
**Spec Directory**: {self.spec_dir}
**Complexity**: SIMPLE (1-2 files expected)

This is a SIMPLE task. Create a minimal spec and implementation plan directly.
No research or extensive analysis needed.
{_greenfield_context() if is_greenfield else ""}
Create:
1. A concise spec.md with just the essential sections
2. A simple implementation_plan.json with 1-2 subtasks
"""
            success, output = await self.run_agent_fn(
                "spec_quick.md",
                additional_context=context_str,
                phase_name="quick_spec",
            )

            if success and spec_file.exists():
                # Create minimal plan if agent didn't
                if not plan_file.exists():
                    writer.create_minimal_plan(self.spec_dir, self.task_description)

                self.ui.print_status("Quick spec created", "success")
                return PhaseResult(
                    "quick_spec", True, [str(spec_file), str(plan_file)], [], attempt
                )

            errors.append(f"Attempt {attempt + 1}: Quick spec agent failed")

        return PhaseResult("quick_spec", False, [], errors, MAX_RETRIES)

    async def phase_spec_writing(self) -> PhaseResult:
        """Write the spec.md document."""
        spec_file = self.spec_dir / "spec.md"

        if spec_file.exists():
            result = self.spec_validator.validate_spec_document()
            if result.valid:
                self.ui.print_status("spec.md already exists and is valid", "success")
                return PhaseResult("spec_writing", True, [str(spec_file)], [], 0)
            self.ui.print_status(
                "spec.md exists but has issues, regenerating...", "warning"
            )

        is_greenfield = self._check_and_log_greenfield()
        greenfield_ctx = _greenfield_context() if is_greenfield else ""

        errors = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running spec writer (attempt {attempt + 1})...", "progress"
            )

            success, output = await self.run_agent_fn(
                "spec_writer.md",
                additional_context=greenfield_ctx,
                phase_name="spec_writing",
            )

            if success and spec_file.exists():
                result = self.spec_validator.validate_spec_document()
                if result.valid:
                    self.ui.print_status("Created valid spec.md", "success")
                    return PhaseResult(
                        "spec_writing", True, [str(spec_file)], [], attempt
                    )
                else:
                    errors.append(
                        f"Attempt {attempt + 1}: Spec invalid - {result.errors}"
                    )
                    self.ui.print_status(
                        f"Spec created but invalid: {result.errors}", "error"
                    )
            else:
                errors.append(f"Attempt {attempt + 1}: Agent did not create spec.md")

        return PhaseResult("spec_writing", False, [], errors, MAX_RETRIES)

    async def phase_self_critique(self) -> PhaseResult:
        """Self-critique the spec using extended thinking."""
        spec_file = self.spec_dir / "spec.md"
        research_file = self.spec_dir / "research.json"
        critique_file = self.spec_dir / "critique_report.json"

        if not spec_file.exists():
            self.ui.print_status("No spec.md to critique", "error")
            return PhaseResult(
                "self_critique", False, [], ["spec.md does not exist"], 0
            )

        if critique_file.exists():
            with open(critique_file, encoding="utf-8") as f:
                critique = json.load(f)
                if critique.get("issues_fixed", False) or critique.get(
                    "no_issues_found", False
                ):
                    self.ui.print_status("Self-critique already completed", "success")
                    return PhaseResult(
                        "self_critique", True, [str(critique_file)], [], 0
                    )

        errors = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running self-critique agent (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
**Spec File**: {spec_file}
**Research File**: {research_file}
**Critique Output**: {critique_file}

Use EXTENDED THINKING (ultrathink) to deeply analyze the spec.md:

1. **Technical Accuracy**: Do code examples match the research findings?
2. **Completeness**: Are all requirements covered? Edge cases handled?
3. **Consistency**: Do package names, APIs, and patterns match throughout?
4. **Feasibility**: Is the implementation approach realistic?

For each issue found:
- Fix it directly in spec.md
- Document what was fixed in critique_report.json

Output critique_report.json with:
{{
  "issues_found": [...],
  "issues_fixed": true/false,
  "no_issues_found": true/false,
  "critique_summary": "..."
}}
"""
            success, output = await self.run_agent_fn(
                "spec_critic.md",
                additional_context=context_str,
                phase_name="self_critique",
            )

            if success:
                if not critique_file.exists():
                    validator.create_minimal_critique(
                        self.spec_dir,
                        reason="Agent completed without explicit issues",
                    )

                result = self.spec_validator.validate_spec_document()
                if result.valid:
                    self.ui.print_status(
                        "Self-critique completed, spec is valid", "success"
                    )
                    return PhaseResult(
                        "self_critique", True, [str(critique_file)], [], attempt
                    )
                else:
                    self.ui.print_status(
                        f"Spec invalid after critique: {result.errors}", "warning"
                    )
                    errors.append(
                        f"Attempt {attempt + 1}: Spec still invalid after critique"
                    )
            else:
                errors.append(f"Attempt {attempt + 1}: Critique agent failed")

        validator.create_minimal_critique(
            self.spec_dir,
            reason="Critique failed after retries",
        )
        return PhaseResult(
            "self_critique", True, [str(critique_file)], errors, MAX_RETRIES
        )

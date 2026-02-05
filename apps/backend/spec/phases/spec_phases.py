"""
Spec Writing and Critique Phase Implementations
================================================

Phases for spec document creation and quality assurance.
"""

import json
from typing import TYPE_CHECKING

from .. import validator, writer
from .models import MAX_RETRIES, PhaseResult

if TYPE_CHECKING:
    pass


class SpecPhaseMixin:
    """Mixin for spec writing and critique phase methods."""

    async def phase_quick_spec(self) -> PhaseResult:
        """Quick spec for simple tasks - combines context and spec in one step."""
        spec_file = self.spec_dir / "spec.md"
        plan_file = self.spec_dir / "implementation_plan.json"

        if spec_file.exists() and plan_file.exists():
            self.ui.print_status("Quick spec already exists", "success")
            return PhaseResult(
                "quick_spec", True, [str(spec_file), str(plan_file)], [], 0
            )

        errors = []
        last_validation_result = None  # Track validation errors for injection

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

Create:
1. A concise spec.md with just the essential sections
2. A simple implementation_plan.json with 1-2 subtasks
"""
            # Inject validation errors from previous attempt if any
            if last_validation_result and not last_validation_result.valid:
                error_context = self._build_validation_error_context(
                    last_validation_result, attempt
                )
                context_str += error_context

            success, output = await self.run_agent_fn(
                "spec_quick.md",
                additional_context=context_str,
                phase_name="quick_spec",
            )

            if success and spec_file.exists():
                # Validate the spec document
                result = self.spec_validator.validate_spec_document()
                if not result.valid:
                    # Store for next attempt's error injection
                    last_validation_result = result
                    errors.append(f"Attempt {attempt + 1}: Spec invalid - {result.errors}")
                    self.ui.print_status(
                        f"Spec created but invalid: {result.errors}", "warning"
                    )
                    continue

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

        errors = []
        last_validation_result = None  # Track validation errors for injection

        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running spec writer (attempt {attempt + 1})...", "progress"
            )

            # Build additional context with validation errors from previous attempt
            additional_context = ""
            if last_validation_result and not last_validation_result.valid:
                error_injection = self._build_validation_error_context(
                    last_validation_result, attempt
                )
                additional_context = error_injection

            success, output = await self.run_agent_fn(
                "spec_writer.md",
                additional_context=additional_context,
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
                    # Store validation result for next attempt's error injection
                    last_validation_result = result
                    errors.append(
                        f"Attempt {attempt + 1}: Spec invalid - {result.errors}"
                    )
                    self.ui.print_status(
                        f"Spec created but invalid: {result.errors}", "error"
                    )
            else:
                errors.append(f"Attempt {attempt + 1}: Agent did not create spec.md")

        return PhaseResult("spec_writing", False, [], errors, MAX_RETRIES)

    def _build_validation_error_context(self, validation_result, attempt: int) -> str:
        """
        Build context string with validation errors for agent retry.

        This injects specific error feedback into the agent's context so it can
        self-correct rather than blindly retrying with the same approach.

        Args:
            validation_result: The ValidationResult from the previous attempt
            attempt: The current attempt number (0-indexed)

        Returns:
            Formatted string with error details and fix suggestions
        """
        lines = [
            "",
            "=" * 60,
            f"⚠️  VALIDATION FAILED (Attempt {attempt + 1})",
            "=" * 60,
            "",
            "Your spec.md is missing required sections or has errors.",
            "",
            "## Errors Found",
            "",
        ]

        for error in validation_result.errors:
            lines.append(f"- ❌ {error}")

        if validation_result.warnings:
            lines.append("")
            lines.append("## Warnings")
            lines.append("")
            for warning in validation_result.warnings:
                lines.append(f"- ⚠️ {warning}")

        if validation_result.fixes:
            lines.append("")
            lines.append("## Suggested Fixes")
            lines.append("")
            for fix in validation_result.fixes:
                lines.append(f"- → {fix}")

        lines.extend(
            [
                "",
                "## Required Actions",
                "",
                "1. Read the existing spec.md file",
                "2. Identify the missing sections listed above",
                "3. Add ONLY the missing sections - do NOT rewrite the entire spec",
                "4. Ensure all required sections have proper content (not placeholders)",
                "",
                "Required sections: Overview, Workflow Type, Task Scope, Success Criteria",
                "",
            ]
        )

        return "\n".join(lines)

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
            with open(critique_file) as f:
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

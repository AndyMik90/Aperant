"""
Ralph Prompt Generator
======================

Generates Ralph-compatible prompts for autonomous task execution.
Learns from successful prompts in docs/ralph/prompts/ to create
prompts that follow proven patterns for preventing early stops,
skipping, and other failure modes.

Key patterns extracted from production runs:
- "You are an EXECUTOR, not an EVALUATOR" identity
- Task tables with promises
- Explicit EXECUTION PROTOCOL
- ANTI-SKIP RULES
- CRITICAL CONSTRAINTS
- HARD STOP RULE

Reference: docs/plans/RALPH_IMPLEMENTATION_GUIDE.md (v2.5)
"""

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# Template sections for Ralph prompts
RALPH_IDENTITY_TEMPLATE = """YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a {task_count}-TASK JOB. Do NOT stop until all tasks are complete."""

RALPH_REPOSITORY_TEMPLATE = """Repository:
- Project root: {project_root}
- Spec location: {spec_location}"""

RALPH_TASK_TABLE_HEADER = """| # | Task | Description | Promise |
|---|------|-------------|---------|"""

RALPH_EXECUTION_PROTOCOL_HEADER = """---

EXECUTION PROTOCOL"""

RALPH_CRITICAL_CONSTRAINTS_TEMPLATE = """---

CRITICAL CONSTRAINTS

1. {task_count}-TASK JOB - Do NOT stop until all {task_count} tasks are complete.
2. ALL REQUIRED - Every task is marked REQUIRED - no skipping allowed.
3. NO SUMMARIES - Progress summaries are NOT stopping points.
4. CONTINUATION - After each task, say: NEXT: Task N"""

RALPH_ANTI_SKIP_RULES = """---

ANTI-SKIP RULES

You may NOT skip because:
- Task 'seems complex' ❌
- Current implementation 'works well' ❌
- You 'prefer' a different design ❌
- Task 'requires major changes' ❌

You may ONLY skip if:
- Actual error after 3 fix attempts ✅
- File genuinely doesn't exist ✅
- Dependency genuinely missing ✅"""

RALPH_HARD_STOP_RULE_TEMPLATE = """---

⚠️ HARD STOP RULE: You may NOT stop until {final_promise} is output.

If you find yourself writing 'excellent progress' or 'good work today' - STOP. That is the early-stop psychology. Instead, check how many tasks remain and continue working.

CURRENT STATUS: 0 of {task_count} tasks complete. BEGIN NOW."""


class RalphPromptPatterns:
    """
    Stores patterns extracted from successful Ralph prompts.
    Used by RalphPromptGenerator to create consistent, effective prompts.
    """

    def __init__(self):
        self.task_table_formats: list[dict] = []
        self.promise_formats: list[str] = []
        self.constraint_phrases: list[str] = []
        self.execution_protocol_steps: list[str] = []
        self.max_iterations_seen: list[int] = []

    def add_pattern(self, pattern_type: str, pattern: Any) -> None:
        """Add a pattern to the appropriate collection."""
        if pattern_type == "task_table":
            self.task_table_formats.append(pattern)
        elif pattern_type == "promise":
            self.promise_formats.append(pattern)
        elif pattern_type == "constraint":
            self.constraint_phrases.append(pattern)
        elif pattern_type == "execution_step":
            self.execution_protocol_steps.append(pattern)
        elif pattern_type == "max_iterations":
            self.max_iterations_seen.append(pattern)


class RalphPromptGenerator:
    """
    Generates Ralph-compatible prompts from spec.md and implementation_plan.json.

    Usage:
        generator = RalphPromptGenerator(prompts_dir="docs/ralph/prompts/")
        generator.analyze_patterns()
        prompt = generator.generate_prompt(spec_dir, project_root)
    """

    def __init__(self, prompts_dir: str | Path | None = None):
        """
        Initialize the generator.

        Args:
            prompts_dir: Directory containing example Ralph prompts (.md files).
                        Defaults to docs/ralph/prompts/ relative to project root.
        """
        if prompts_dir:
            self.prompts_dir = Path(prompts_dir)
        else:
            # Find prompts dir relative to this file
            # This file is at apps/backend/prompts_pkg/ralph_prompt_generator.py
            # Prompts are at docs/ralph/prompts/
            this_file = Path(__file__)
            project_root = this_file.parent.parent.parent.parent
            self.prompts_dir = project_root / "docs" / "ralph" / "prompts"

        self.patterns = RalphPromptPatterns()
        self._patterns_analyzed = False

    def analyze_patterns(self) -> RalphPromptPatterns:
        """
        Read all .md files from the prompts directory and extract common patterns.

        Returns:
            RalphPromptPatterns with extracted patterns from successful prompts.
        """
        if not self.prompts_dir.exists():
            logger.warning(f"Prompts directory not found: {self.prompts_dir}")
            self._patterns_analyzed = True
            return self.patterns

        prompt_files = list(self.prompts_dir.glob("*.md"))
        logger.info(f"Analyzing {len(prompt_files)} prompt files from {self.prompts_dir}")

        for prompt_file in prompt_files:
            try:
                content = prompt_file.read_text(encoding="utf-8")
                self._extract_patterns_from_prompt(content, prompt_file.name)
            except Exception as e:
                logger.warning(f"Failed to analyze {prompt_file.name}: {e}")

        self._patterns_analyzed = True
        logger.info(f"Patterns extracted: {len(self.patterns.promise_formats)} promises, "
                   f"{len(self.patterns.constraint_phrases)} constraints, "
                   f"{len(self.patterns.max_iterations_seen)} iteration configs")

        return self.patterns

    def _extract_patterns_from_prompt(self, content: str, filename: str) -> None:
        """Extract patterns from a single prompt file."""

        # Extract promise patterns (e.g., <promise>TASK_NAME_COMPLETE</promise>)
        promise_matches = re.findall(r'<promise>([A-Z0-9_]+)</promise>', content)
        for promise in promise_matches:
            if promise not in self.patterns.promise_formats:
                self.patterns.promise_formats.append(promise)

        # Extract max iterations from command (--max-iterations N)
        iterations_match = re.search(r'--max-iterations\s+(\d+)', content)
        if iterations_match:
            self.patterns.max_iterations_seen.append(int(iterations_match.group(1)))

        # Extract task table formats
        table_match = re.search(r'\|\s*#\s*\|\s*Task.*?\n\|[-\s|]+\n((?:\|.*?\n)+)', content)
        if table_match:
            table_rows = table_match.group(1).strip().split('\n')
            task_count = len(table_rows)
            self.patterns.add_pattern("task_table", {
                "filename": filename,
                "task_count": task_count,
                "rows": table_rows[:3]  # Store first 3 rows as example
            })

        # Extract constraint phrases
        constraint_patterns = [
            r'Do NOT stop until',
            r'ALL REQUIRED',
            r'no skipping',
            r'You are an EXECUTOR',
            r'not an EVALUATOR',
            r'HARD STOP RULE',
            r'early-stop psychology',
        ]
        for pattern in constraint_patterns:
            if re.search(pattern, content, re.IGNORECASE):
                if pattern not in self.patterns.constraint_phrases:
                    self.patterns.constraint_phrases.append(pattern)

        # Extract execution protocol steps
        protocol_match = re.search(r'EXECUTION PROTOCOL\n+((?:\d+\..*?\n)+)', content)
        if protocol_match:
            steps = protocol_match.group(1).strip().split('\n')
            for step in steps[:5]:  # First 5 steps
                if step.strip() and step not in self.patterns.execution_protocol_steps:
                    self.patterns.execution_protocol_steps.append(step.strip())

    def generate_prompt(
        self,
        spec_dir: str | Path,
        project_root: str | Path,
        title: str | None = None,
        max_iterations: int | None = None,
    ) -> str:
        """
        Generate a Ralph prompt from spec.md and implementation_plan.json.

        Args:
            spec_dir: Directory containing spec.md and implementation_plan.json
            project_root: Root directory of the project
            title: Optional title for the prompt (extracted from spec if not provided)
            max_iterations: Max iterations (defaults to calculated based on task count)

        Returns:
            Complete Ralph prompt string ready for /ralph-loop command
        """
        if not self._patterns_analyzed:
            self.analyze_patterns()

        spec_dir = Path(spec_dir)
        project_root = Path(project_root)

        # Load spec.md
        spec_file = spec_dir / "spec.md"
        if not spec_file.exists():
            raise FileNotFoundError(f"spec.md not found in {spec_dir}")

        spec_content = spec_file.read_text(encoding="utf-8")

        # Load implementation_plan.json if it exists
        plan_file = spec_dir / "implementation_plan.json"
        plan = None
        if plan_file.exists():
            try:
                plan = json.loads(plan_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse {plan_file}")

        # Extract tasks from spec and/or plan
        tasks = self._extract_tasks(spec_content, plan)

        if not tasks:
            raise ValueError("No tasks found in spec.md or implementation_plan.json")

        # Extract or use provided title
        if not title:
            title = self._extract_title(spec_content, spec_dir)

        # Calculate max iterations
        if max_iterations is None:
            max_iterations = self._calculate_max_iterations(len(tasks))

        # Generate the prompt
        prompt = self._build_prompt(
            title=title,
            tasks=tasks,
            project_root=project_root,
            spec_dir=spec_dir,
            max_iterations=max_iterations,
        )

        return prompt

    def _extract_tasks(self, spec_content: str, plan: dict | None) -> list[dict]:
        """Extract tasks from spec content and/or implementation plan."""
        tasks = []

        # Try to extract from implementation_plan.json first
        if plan:
            phases = plan.get("phases", [])
            for phase in phases:
                subtasks = phase.get("subtasks", [])
                for subtask in subtasks:
                    task_id = subtask.get("id", f"TASK_{len(tasks) + 1}")
                    description = subtask.get("description", "")
                    tasks.append({
                        "id": task_id,
                        "description": description,
                        "files": subtask.get("files_to_modify", []) + subtask.get("files_to_create", []),
                    })

        # If no tasks from plan, try to extract from spec.md
        if not tasks:
            # Look for implementation steps
            step_pattern = r'###\s*Step\s*(\d+)[:\s]+([^\n]+)'
            matches = re.findall(step_pattern, spec_content)
            for step_num, step_title in matches:
                tasks.append({
                    "id": f"STEP_{step_num}",
                    "description": step_title.strip(),
                    "files": [],
                })

        # If still no tasks, look for task headers
        if not tasks:
            task_pattern = r'###\s*(?:TASK[_-]?)?(\d+|[A-Z]+[_-]?\d*)[:\s]+([^\n]+)'
            matches = re.findall(task_pattern, spec_content, re.IGNORECASE)
            for task_id, task_title in matches:
                tasks.append({
                    "id": f"TASK_{task_id}".upper(),
                    "description": task_title.strip(),
                    "files": [],
                })

        return tasks

    def _extract_title(self, spec_content: str, spec_dir: Path) -> str:
        """Extract title from spec content or generate from directory name."""
        # Try to find title in spec
        title_match = re.search(r'^#\s+(?:Task:\s*)?(.+)$', spec_content, re.MULTILINE)
        if title_match:
            return title_match.group(1).strip()

        # Try feature field from spec
        feature_match = re.search(r'"feature":\s*"([^"]+)"', spec_content)
        if feature_match:
            return feature_match.group(1)

        # Fall back to directory name
        return spec_dir.name.replace("-", " ").replace("_", " ").title()

    def _calculate_max_iterations(self, task_count: int) -> int:
        """Calculate appropriate max iterations based on task count."""
        # Base: 20 iterations per task, minimum 50, maximum 200
        calculated = task_count * 20

        # Use average from analyzed prompts if available
        if self.patterns.max_iterations_seen:
            avg_seen = sum(self.patterns.max_iterations_seen) / len(self.patterns.max_iterations_seen)
            # Weight toward the calculated value
            calculated = int(calculated * 0.6 + avg_seen * 0.4)

        return max(50, min(200, calculated))

    def _build_prompt(
        self,
        title: str,
        tasks: list[dict],
        project_root: Path,
        spec_dir: Path,
        max_iterations: int,
    ) -> str:
        """Build the complete Ralph prompt."""
        task_count = len(tasks)

        # Generate promise names for each task
        base_promise = self._sanitize_promise_name(title)
        final_promise = f"<promise>{base_promise}_COMPLETE</promise>"

        sections = []

        # Header with title
        sections.append(f'You are completing {title} for Auto-Claude (Jerry).')
        sections.append("")

        # Identity section
        sections.append(RALPH_IDENTITY_TEMPLATE.format(task_count=task_count))
        sections.append("")

        # Repository section
        sections.append(RALPH_REPOSITORY_TEMPLATE.format(
            project_root=project_root,
            spec_location=spec_dir.relative_to(project_root) if spec_dir.is_relative_to(project_root) else spec_dir
        ))
        sections.append("")

        # Primary documentation
        sections.append("Primary documentation:")
        sections.append(f"- {spec_dir.relative_to(project_root) if spec_dir.is_relative_to(project_root) else spec_dir}/spec.md (READ THIS FULLY)")
        sections.append("")

        # Task section header
        sections.append("---")
        sections.append("")
        sections.append(f"{title.upper()} ({task_count} tasks)")
        sections.append("")

        # Task table
        sections.append(RALPH_TASK_TABLE_HEADER)
        for i, task in enumerate(tasks, 1):
            task_promise = f"{task['id'].upper()}_COMPLETE"
            desc = task['description'][:50] + "..." if len(task['description']) > 50 else task['description']
            sections.append(f"| {i} | {task['id']} | {desc} | {task_promise} |")
        sections.append("")
        sections.append(f"FINAL: {final_promise}")

        # Execution protocol
        sections.append(RALPH_EXECUTION_PROTOCOL_HEADER)
        sections.append("")

        # Generate steps for each task
        step_num = 1
        sections.append(f"{step_num}. Read spec.md fully before starting.")
        step_num += 1

        for i, task in enumerate(tasks, 1):
            next_action = f"**NEXT: Task {i + 1}**" if i < task_count else "**NEXT: Verify**"
            sections.append(f"{step_num}. Task {i} ({task['id']}): {task['description']}")
            sections.append(f"   - Complete task → output promise → {next_action}")
            step_num += 1

        sections.append(f"{step_num}. Run: npm run build (fix any errors)")
        step_num += 1
        sections.append(f"{step_num}. Output: {final_promise}")
        sections.append("")

        # Critical constraints
        sections.append(RALPH_CRITICAL_CONSTRAINTS_TEMPLATE.format(task_count=task_count))
        sections.append("")

        # Anti-skip rules
        sections.append(RALPH_ANTI_SKIP_RULES)
        sections.append("")

        # Hard stop rule
        sections.append(RALPH_HARD_STOP_RULE_TEMPLATE.format(
            final_promise=final_promise,
            task_count=task_count
        ))

        # Build the complete prompt
        prompt_content = "\n".join(sections)

        # Build the full command
        command = f'/ralph-loop:ralph-loop "\n{prompt_content}\n" --max-iterations {max_iterations} --completion-promise "{base_promise}_COMPLETE"'

        return command

    def _sanitize_promise_name(self, title: str) -> str:
        """Convert title to a valid promise name (UPPERCASE_WITH_UNDERSCORES)."""
        # Remove special characters, replace spaces with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9\s]', '', title)
        sanitized = re.sub(r'\s+', '_', sanitized.strip())
        return sanitized.upper()

    def save_prompt(
        self,
        spec_dir: str | Path,
        project_root: str | Path,
        output_file: str | Path | None = None,
        **kwargs
    ) -> Path:
        """
        Generate and save a Ralph prompt to a file.

        Args:
            spec_dir: Directory containing spec.md
            project_root: Root directory of the project
            output_file: Output file path. Defaults to spec_dir/RALPH_PROMPT.md
            **kwargs: Additional arguments passed to generate_prompt()

        Returns:
            Path to the saved file
        """
        spec_dir = Path(spec_dir)

        if output_file is None:
            output_file = spec_dir / "RALPH_PROMPT.md"
        else:
            output_file = Path(output_file)

        prompt = self.generate_prompt(spec_dir, project_root, **kwargs)

        # Wrap in markdown code block for better readability
        content = f"""# Ralph Prompt

Generated from: {spec_dir.name}/spec.md

## Command

```bash
{prompt}
```

## Usage

1. Copy the command above
2. Paste into Claude Code terminal
3. Wait for completion promise

"""

        output_file.write_text(content, encoding="utf-8")
        logger.info(f"Ralph prompt saved to {output_file}")

        return output_file


# Convenience function for direct usage
def generate_ralph_prompt(spec_dir: str | Path, project_root: str | Path, **kwargs) -> str:
    """
    Generate a Ralph prompt from a spec directory.

    Args:
        spec_dir: Directory containing spec.md and implementation_plan.json
        project_root: Root directory of the project
        **kwargs: Additional arguments (title, max_iterations)

    Returns:
        Complete Ralph prompt string
    """
    generator = RalphPromptGenerator()
    return generator.generate_prompt(spec_dir, project_root, **kwargs)

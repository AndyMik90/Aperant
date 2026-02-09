"""
AI-powered idea generation.

Uses Claude agents to generate ideas of different types:
- Code improvements
- UI/UX improvements
- Documentation gaps
- Security hardening
- Performance optimizations
- Code quality
"""

import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from client import create_client
from phase_config import (
    get_model_betas,
    get_thinking_budget,
    get_thinking_kwargs_for_model,
    resolve_model_id,
)
from ui import print_status

# Ideation types
IDEATION_TYPES = [
    "code_improvements",
    "ui_ux_improvements",
    "documentation_gaps",
    "security_hardening",
    "performance_optimizations",
    "code_quality",
]

IDEATION_TYPE_LABELS = {
    "code_improvements": "Code Improvements",
    "ui_ux_improvements": "UI/UX Improvements",
    "documentation_gaps": "Documentation Gaps",
    "security_hardening": "Security Hardening",
    "performance_optimizations": "Performance Optimizations",
    "code_quality": "Code Quality & Refactoring",
}

IDEATION_TYPE_PROMPTS = {
    "code_improvements": "ideation_code_improvements.md",
    "ui_ux_improvements": "ideation_ui_ux.md",
    "documentation_gaps": "ideation_documentation.md",
    "security_hardening": "ideation_security.md",
    "performance_optimizations": "ideation_performance.md",
    "code_quality": "ideation_code_quality.md",
}


class IdeationGenerator:
    """Generates ideas using AI agents."""

    def __init__(
        self,
        project_dir: Path,
        output_dir: Path,
        model: str = "sonnet",  # Changed from "opus" (fix #433)
        thinking_level: str = "medium",
        max_ideas_per_type: int = 5,
        fast_mode: bool = False,
    ):
        self.project_dir = Path(project_dir)
        self.output_dir = Path(output_dir)
        self.model = model
        self.thinking_level = thinking_level
        self.thinking_budget = get_thinking_budget(thinking_level)
        self.max_ideas_per_type = max_ideas_per_type
        self.fast_mode = fast_mode
        self.prompts_dir = Path(__file__).parent.parent / "prompts"

    async def run_agent(
        self,
        prompt_file: str,
        additional_context: str = "",
    ) -> tuple[bool, str]:
        """Run an agent with the given prompt."""
        prompt_path = self.prompts_dir / prompt_file

        if not prompt_path.exists():
            return False, f"Prompt not found: {prompt_path}"

        # Load prompt
        prompt = prompt_path.read_text(encoding="utf-8")

        # Add context
        prompt += f"\n\n---\n\n**Output Directory**: {self.output_dir}\n"
        prompt += f"**Project Directory**: {self.project_dir}\n"
        prompt += f"**Max Ideas**: {self.max_ideas_per_type}\n"

        if additional_context:
            prompt += f"\n{additional_context}\n"

        # Create client with thinking budget
        # Use agent_type="ideation" to avoid loading unnecessary MCP servers
        # which can cause 60-second timeout delays
        resolved_model = resolve_model_id(self.model)
        betas = get_model_betas(self.model)
        thinking_kwargs = get_thinking_kwargs_for_model(
            resolved_model, self.thinking_level
        )
        client = create_client(
            self.project_dir,
            self.output_dir,
            resolved_model,
            agent_type="ideation",
            betas=betas,
            fast_mode=self.fast_mode,
            **thinking_kwargs,
        )

        try:
            async with client:
                await client.query(prompt)

                response_text = ""
                async for msg in client.receive_response():
                    msg_type = type(msg).__name__

                    if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            block_type = type(block).__name__
                            if block_type == "TextBlock" and hasattr(block, "text"):
                                response_text += block.text
                                print(block.text, end="", flush=True)
                            elif block_type == "ToolUseBlock" and hasattr(
                                block, "name"
                            ):
                                print(f"\n[Tool: {block.name}]", flush=True)

                print()
                return True, response_text

        except Exception as e:
            return False, str(e)

    async def run_recovery_agent(
        self,
        output_file: Path,
        ideation_type: str,
        error: str,
        current_content: str,
    ) -> bool:
        """Run a recovery agent to fix validation errors in the output file."""

        # Truncate content if too long
        max_content_length = 8000
        if len(current_content) > max_content_length:
            current_content = current_content[:max_content_length] + "\n... (truncated)"

        recovery_prompt = f"""# Ideation Output Recovery

The ideation output file failed validation. Your task is to fix it.

## Error
{error}

## Expected Format
The output file must be valid JSON with the following structure:

```json
{{
  "{ideation_type}": [
    {{
      "id": "...",
      "type": "{ideation_type}",
      "title": "...",
      "description": "...",
      ... other fields ...
    }}
  ]
}}
```

**CRITICAL**: The top-level key MUST be `"{ideation_type}"` (not "ideas" or anything else).

## Current File Content
File: {output_file}

```json
{current_content}
```

## Your Task
1. Read the current file content above
2. Identify what's wrong based on the error message
3. Fix the JSON structure to match the expected format
4. Write the corrected content to {output_file}

Common fixes:
- If the key is "ideas", rename it to "{ideation_type}"
- If the JSON is invalid, fix the syntax errors
- If there are no ideas, ensure the array has at least one idea object

Write the fixed JSON to the file now.
"""

        # Use agent_type="ideation" for recovery agent as well
        resolved_model = resolve_model_id(self.model)
        betas = get_model_betas(self.model)
        thinking_kwargs = get_thinking_kwargs_for_model(
            resolved_model, self.thinking_level
        )
        client = create_client(
            self.project_dir,
            self.output_dir,
            resolved_model,
            agent_type="ideation",
            betas=betas,
            fast_mode=self.fast_mode,
            **thinking_kwargs,
        )

        try:
            async with client:
                await client.query(recovery_prompt)

                async for msg in client.receive_response():
                    msg_type = type(msg).__name__

                    if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            block_type = type(block).__name__
                            if block_type == "TextBlock" and hasattr(block, "text"):
                                print(block.text, end="", flush=True)
                            elif block_type == "ToolUseBlock" and hasattr(
                                block, "name"
                            ):
                                print(f"\n[Recovery Tool: {block.name}]", flush=True)

                print()
                return True

        except Exception as e:
            print_status(f"Recovery agent error: {e}", "error")
            return False

    def get_prompt_file(self, ideation_type: str) -> str | None:
        """Get the prompt file for a specific ideation type."""
        return IDEATION_TYPE_PROMPTS.get(ideation_type)

    def get_type_label(self, ideation_type: str) -> str:
        """Get the human-readable label for an ideation type."""
        return IDEATION_TYPE_LABELS.get(ideation_type, ideation_type)

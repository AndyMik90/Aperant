"""
Prompts Module
==============

Prompt generation and templates for AI interactions.
"""

# Import all functions from prompt_generator
# Import project context utilities
from .project_context import (
    detect_project_capabilities,
    get_mcp_tools_for_project,
    load_project_index,
    should_refresh_project_index,
)
from .prompt_generator import (
    format_context_for_prompt,
    generate_environment_context,
    generate_planner_prompt,
    generate_subtask_prompt,
    get_relative_spec_path,
    load_subtask_context,
)

# Import all functions from prompts
from .prompts import (
    get_coding_prompt,
    get_followup_planner_prompt,
    get_planner_prompt,
    get_qa_fixer_prompt,
    get_qa_reviewer_prompt,
    is_first_run,
)

# Import Ralph prompt generator
from .ralph_prompt_generator import (
    RalphPromptGenerator,
    RalphPromptPatterns,
    generate_ralph_prompt,
)

__all__ = [
    # prompt_generator functions
    "get_relative_spec_path",
    "generate_environment_context",
    "generate_subtask_prompt",
    "generate_planner_prompt",
    "load_subtask_context",
    "format_context_for_prompt",
    # prompts functions
    "get_planner_prompt",
    "get_coding_prompt",
    "get_followup_planner_prompt",
    "get_qa_reviewer_prompt",
    "get_qa_fixer_prompt",
    "is_first_run",
    # project_context functions
    "load_project_index",
    "detect_project_capabilities",
    "get_mcp_tools_for_project",
    "should_refresh_project_index",
    # ralph_prompt_generator
    "RalphPromptGenerator",
    "RalphPromptPatterns",
    "generate_ralph_prompt",
]

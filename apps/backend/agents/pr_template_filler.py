"""
PR Template Filler Agent Module
================================

Detects GitHub PR templates in a project and uses Claude to intelligently
fill them based on code changes, spec context, commit history, and branch info.
"""

import logging
from pathlib import Path

from core.client import create_client
from task_logger import LogPhase, get_task_logger

from .session import run_agent_session

logger = logging.getLogger(__name__)

# Maximum diff size (in characters) before truncating to file-level summaries
MAX_DIFF_CHARS = 30_000


def detect_pr_template(project_dir: Path | str) -> str | None:
    """
    Detect a GitHub PR template in the project.

    Searches for:
    1. .github/PULL_REQUEST_TEMPLATE.md (single template)
    2. .github/PULL_REQUEST_TEMPLATE/ directory (picks the first .md file)

    Args:
        project_dir: Root directory of the project

    Returns:
        The template content as a string, or None if no template is found.
    """
    project_dir = Path(project_dir)
    # Check for single template file
    single_template = project_dir / ".github" / "PULL_REQUEST_TEMPLATE.md"
    if single_template.is_file():
        try:
            content = single_template.read_text(encoding="utf-8")
            if content.strip():
                logger.info(f"Found PR template: {single_template}")
                return content
        except Exception as e:
            logger.warning(f"Failed to read PR template {single_template}: {e}")

    # Check for template directory (pick first .md file alphabetically)
    template_dir = project_dir / ".github" / "PULL_REQUEST_TEMPLATE"
    if template_dir.is_dir():
        try:
            md_files = sorted(template_dir.glob("*.md"))
            if md_files:
                content = md_files[0].read_text(encoding="utf-8")
                if content.strip():
                    logger.info(f"Found PR template: {md_files[0]}")
                    return content
        except Exception as e:
            logger.warning(f"Failed to read PR template from {template_dir}: {e}")

    logger.info("No GitHub PR template found in project")
    return None


def _truncate_diff(diff_summary: str) -> str:
    """
    Truncate a large diff to file-level summaries to stay within token limits.

    If the diff is within MAX_DIFF_CHARS, return it unchanged.
    Otherwise, extract only file-level change summaries (e.g. file names
    with insertions/deletions counts) and discard line-level detail.

    Args:
        diff_summary: The full diff summary text

    Returns:
        The original or truncated diff summary.
    """
    if len(diff_summary) <= MAX_DIFF_CHARS:
        return diff_summary

    lines = diff_summary.splitlines()
    summary_lines: list[str] = []
    summary_lines.append("(Diff truncated to file-level summaries due to size)")
    summary_lines.append("")

    for line in lines:
        # Keep file-level summary lines (stat lines, file headers, etc.)
        stripped = line.strip()
        if (
            stripped.startswith("diff --git")
            or stripped.startswith("---")
            or stripped.startswith("+++")
            or "file changed" in stripped.lower()
            or "files changed" in stripped.lower()
            or "insertion" in stripped.lower()
            or "deletion" in stripped.lower()
            or stripped.startswith("rename")
            or stripped.startswith("new file")
            or stripped.startswith("deleted file")
            or stripped.startswith("Binary files")
        ):
            summary_lines.append(line)

    # If we couldn't extract meaningful summaries, take the first chunk
    if len(summary_lines) <= 2:
        truncated = diff_summary[:MAX_DIFF_CHARS]
        return truncated + "\n\n(... diff truncated due to size)"

    return "\n".join(summary_lines)


def _strip_markdown_fences(content: str) -> str:
    """
    Strip markdown code fences from the response if present.

    The AI sometimes wraps the output in ```markdown ... ``` even when instructed
    not to. This ensures the PR body renders correctly on GitHub.

    Args:
        content: The response content to clean

    Returns:
        The content with markdown fences stripped.
    """
    result = content

    # Strip opening fence (```markdown or just ```)
    if result.startswith("```markdown"):
        result = result[len("```markdown") :].lstrip("\n")
    elif result.startswith("```md"):
        result = result[len("```md") :].lstrip("\n")
    elif result.startswith("```"):
        result = result[3:].lstrip("\n")

    # Strip closing fence
    if result.endswith("```"):
        result = result[:-3].rstrip("\n")

    return result.strip()


def _build_prompt(
    template_content: str,
    diff_summary: str,
    spec_overview: str,
    commit_log: str,
    branch_name: str,
    target_branch: str,
) -> str:
    """
    Build the prompt for the PR template filler agent.

    Combines the system prompt context variables into a single message
    that includes the template and all change context.

    Args:
        template_content: The PR template markdown
        diff_summary: Git diff summary (possibly truncated)
        spec_overview: Spec.md content or summary
        commit_log: Git log of commits in the PR
        branch_name: Source branch name
        target_branch: Target branch name

    Returns:
        The assembled prompt string.
    """
    return f"""Fill out the following GitHub PR template using the provided context.
Return ONLY the filled template markdown — no preamble, no explanation, no code fences.

## Checkbox Guidelines

IMPORTANT: Be accurate and honest about what has and hasn't been verified.

**Check these based on context (you can infer from the diff/spec):**
- Base Branch targeting — check based on target_branch value
- Type of Change (bug fix, feature, docs, refactor, test) — infer from diff and spec
- Area (Frontend, Backend, Fullstack) — infer from changed file paths
- Feature Toggle "N/A" — if the feature appears complete and not behind a flag
- Breaking Changes "No" — if changes appear backward compatible

**Leave UNCHECKED (these require human verification you cannot perform):**
- "I've tested my changes locally" — you have not tested anything
- "All CI checks pass" — CI has not run yet
- "Windows/macOS/Linux tested" — requires manual testing on each platform
- "All existing tests pass" — CI has not run yet
- "New features include test coverage" — unless test files are clearly visible in the diff
- "Bug fixes include regression tests" — unless test files are clearly visible in the diff

**For platform/code quality checkboxes:**
- "Used centralized platform/ module" — leave unchecked unless you can verify from the diff
- "No hardcoded paths" — leave unchecked unless you can verify from the diff
- "PR is small and focused (< 400 lines)" — check only if diff stats show < 400 lines changed

**For the "I've synced with develop branch" checkbox:**
- Leave unchecked — you cannot verify the sync status

## PR Template

{template_content}

## Change Context

### Branch Information
- **Source branch:** {branch_name}
- **Target branch:** {target_branch}

### Git Diff Summary
```
{diff_summary}
```

### Spec Overview
{spec_overview}

### Commit History
```
{commit_log}
```

Fill every section of the PR template. Follow the checkbox guidelines above carefully.
Output ONLY the completed template — no code fences, no preamble."""


def _load_spec_overview(spec_dir: Path) -> str:
    """
    Load the spec.md content for context. Falls back to a brief note if unavailable.

    Args:
        spec_dir: Directory containing the spec files

    Returns:
        The spec content or a fallback message.
    """
    spec_file = spec_dir / "spec.md"
    if spec_file.is_file():
        try:
            content = spec_file.read_text(encoding="utf-8")
            # Truncate very long specs to keep prompt manageable
            if len(content) > 8000:
                return content[:8000] + "\n\n(... spec truncated for brevity)"
            return content
        except Exception as e:
            logger.warning(f"Failed to read spec.md: {e}")
    return "(No spec overview available)"


async def run_pr_template_filler(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    thinking_budget: int | None = None,
    branch_name: str = "",
    target_branch: str = "develop",
    diff_summary: str = "",
    commit_log: str = "",
    verbose: bool = False,
) -> str | None:
    """
    Run the PR template filler agent to generate a filled PR body.

    Detects the project's PR template, gathers change context, and invokes
    Claude to intelligently fill out the template sections.

    Args:
        project_dir: Root directory of the project
        spec_dir: Directory containing the spec files
        model: Claude model to use
        thinking_budget: Max thinking tokens (None to disable extended thinking)
        branch_name: Source branch name for the PR
        target_branch: Target branch name for the PR
        diff_summary: Git diff summary of changes
        commit_log: Git log of commits included in the PR
        verbose: Whether to show detailed output

    Returns:
        The filled template markdown string, or None if template detection fails
        or the agent encounters an error.
    """
    # Detect PR template
    template_content = detect_pr_template(project_dir)
    if template_content is None:
        logger.info("No PR template detected — skipping template filler")
        return None

    # Load spec overview
    spec_overview = _load_spec_overview(spec_dir)

    # Truncate diff if too large
    truncated_diff = _truncate_diff(diff_summary)

    # Build the prompt
    prompt = _build_prompt(
        template_content=template_content,
        diff_summary=truncated_diff,
        spec_overview=spec_overview,
        commit_log=commit_log,
        branch_name=branch_name,
        target_branch=target_branch,
    )

    # Initialize task logger
    task_logger = get_task_logger(spec_dir)
    if task_logger:
        task_logger.start_phase(LogPhase.CODING, "PR template filling")

    # Create client following the pattern from planner.py
    client = create_client(
        project_dir,
        spec_dir,
        model,
        agent_type="pr_template_filler",
        max_thinking_tokens=thinking_budget,
    )

    try:
        async with client:
            status, response, _ = await run_agent_session(
                client, prompt, spec_dir, verbose, phase=LogPhase.CODING
            )

        if task_logger:
            task_logger.end_phase(
                LogPhase.CODING,
                success=(status != "error"),
                message="PR template filling completed",
            )

        if status == "error":
            logger.error("PR template filler agent returned an error")
            return None

        # The agent should return only the filled template markdown
        if response and response.strip():
            result = _strip_markdown_fences(response.strip())
            logger.info("PR template filled successfully")
            return result

        logger.warning("PR template filler returned empty response")
        return None

    except Exception as e:
        logger.error(f"PR template filler error: {e}")
        if task_logger:
            task_logger.log_error(f"PR template filler error: {e}", LogPhase.CODING)
        return None

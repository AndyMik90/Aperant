"""
Commit Message Generator
========================

Generates high-quality commit messages using Claude Haiku.

Features:
- Conventional commits format (feat/fix/refactor/etc)
- GitHub issue references (Fixes #123)
- Context-aware descriptions from spec metadata
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Map task categories to conventional commit types
CATEGORY_TO_COMMIT_TYPE = {
    "feature": "feat",
    "bug_fix": "fix",
    "bug": "fix",
    "refactoring": "refactor",
    "refactor": "refactor",
    "documentation": "docs",
    "docs": "docs",
    "testing": "test",
    "test": "test",
    "performance": "perf",
    "perf": "perf",
    "security": "security",
    "chore": "chore",
    "style": "style",
    "ci": "ci",
    "build": "build",
}

SYSTEM_PROMPT = """You are a Git expert who writes clear, concise commit messages following conventional commits format.

Rules:
1. First line: type(scope): description (max 72 chars total)
2. Leave blank line after first line
3. Body: 1-3 sentences explaining WHAT changed and WHY
4. If GitHub issue number provided, end with "Fixes #N" on its own line
5. Be specific about the changes, not generic
6. Use imperative mood ("Add feature" not "Added feature")

Types: feat, fix, refactor, docs, test, perf, chore, style, ci, build

Example output:
feat(auth): add OAuth2 login flow

Implement OAuth2 authentication with Google and GitHub providers.
Add token refresh logic and secure storage.

Fixes #42"""


def _get_spec_context(spec_dir: Path) -> dict:
    """
    Extract context from spec files for commit message generation.

    Returns dict with:
    - title: Feature/task title
    - category: Task category (feature, bug_fix, etc)
    - description: Brief description
    - github_issue: GitHub issue number if linked
    """
    context = {
        "title": "",
        "category": "chore",
        "description": "",
        "github_issue": None,
    }

    # Try to read spec.md for title
    spec_file = spec_dir / "spec.md"
    if spec_file.exists():
        try:
            content = spec_file.read_text(encoding="utf-8")
            # Extract title from first H1 or H2
            title_match = re.search(r"^#+ (.+)$", content, re.MULTILINE)
            if title_match:
                context["title"] = title_match.group(1).strip()

            # Look for overview/description section
            overview_match = re.search(
                r"## Overview\s*\n(.+?)(?=\n##|\Z)", content, re.DOTALL
            )
            if overview_match:
                context["description"] = overview_match.group(1).strip()[:200]
        except Exception as e:
            logger.debug(f"Could not read spec.md: {e}")

    # Try to read requirements.json for metadata
    req_file = spec_dir / "requirements.json"
    if req_file.exists():
        try:
            req_data = json.loads(req_file.read_text(encoding="utf-8"))
            if not context["title"] and req_data.get("feature"):
                context["title"] = req_data["feature"]
            if req_data.get("workflow_type"):
                context["category"] = req_data["workflow_type"]
            if req_data.get("task_description") and not context["description"]:
                context["description"] = req_data["task_description"][:200]
        except Exception as e:
            logger.debug(f"Could not read requirements.json: {e}")

    # Try to read implementation_plan.json for GitHub issue
    plan_file = spec_dir / "implementation_plan.json"
    if plan_file.exists():
        try:
            plan_data = json.loads(plan_file.read_text(encoding="utf-8"))
            # Check for GitHub metadata
            metadata = plan_data.get("metadata", {})
            if metadata.get("githubIssueNumber"):
                context["github_issue"] = metadata["githubIssueNumber"]
            # Fallback title
            if not context["title"]:
                context["title"] = plan_data.get("feature") or plan_data.get(
                    "title", ""
                )
        except Exception as e:
            logger.debug(f"Could not read implementation_plan.json: {e}")

    return context


def _build_prompt(
    spec_context: dict,
    diff_summary: str,
    files_changed: list[str],
) -> str:
    """Build the prompt for Claude."""
    commit_type = CATEGORY_TO_COMMIT_TYPE.get(
        spec_context.get("category", "").lower(), "chore"
    )

    github_ref = ""
    if spec_context.get("github_issue"):
        github_ref = f"\nGitHub Issue: #{spec_context['github_issue']} (include 'Fixes #{spec_context['github_issue']}' at the end)"

    # Truncate file list if too long
    if len(files_changed) > 20:
        files_display = (
            "\n".join(files_changed[:20])
            + f"\n... and {len(files_changed) - 20} more files"
        )
    else:
        files_display = (
            "\n".join(files_changed) if files_changed else "(no files listed)"
        )

    prompt = f"""Generate a commit message for this change.

Task: {spec_context.get("title", "Unknown task")}
Type: {commit_type}
Files changed: {len(files_changed)}
{github_ref}

Description: {spec_context.get("description", "No description available")}

Changed files:
{files_display}

Diff summary:
{diff_summary[:2000] if diff_summary else "(no diff available)"}

Generate ONLY the commit message, nothing else. Follow the format exactly:
type(scope): short description

Body explaining changes.

Fixes #N (if applicable)"""

    return prompt


async def _call_claude(prompt: str) -> str:
    """Call Claude for commit message generation.

    Reads model/thinking settings from environment variables:
    - UTILITY_MODEL_ID: Full model ID (e.g., "claude-haiku-4-5-20251001")
    - UTILITY_THINKING_BUDGET: Thinking budget tokens (e.g., "1024")
    """
    from core.auth import ensure_claude_code_oauth_token, get_auth_token
    from core.model_config import get_utility_model_config

    if not get_auth_token():
        logger.warning("No authentication token found")
        return ""

    ensure_claude_code_oauth_token()

    try:
        from core.simple_client import create_simple_client
    except ImportError:
        logger.warning("core.simple_client not available")
        return ""

    # Get model settings from environment (passed from frontend)
    model, thinking_budget = get_utility_model_config()

    logger.info(
        f"Commit message using model={model}, thinking_budget={thinking_budget}"
    )

    client = create_simple_client(
        agent_type="commit_message",
        model=model,
        system_prompt=SYSTEM_PROMPT,
        max_thinking_tokens=thinking_budget,
    )

    try:
        async with client:
            await client.query(prompt)

            response_text = ""
            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        # Must check block type - only TextBlock has .text attribute
                        block_type = type(block).__name__
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            response_text += block.text

            logger.info(f"Generated commit message: {len(response_text)} chars")
            return response_text.strip()

    except Exception as e:
        logger.error(f"Claude SDK call failed: {e}")
        print(f"    [WARN] Commit message generation failed: {e}", file=sys.stderr)
        return ""


def generate_commit_message_sync(
    project_dir: Path,
    spec_name: str,
    diff_summary: str = "",
    files_changed: list[str] | None = None,
    github_issue: int | None = None,
) -> str:
    """
    Generate a commit message synchronously.

    Args:
        project_dir: Project root directory
        spec_name: Spec identifier (e.g., "001-add-feature")
        diff_summary: Git diff stat or summary
        files_changed: List of changed file paths
        github_issue: GitHub issue number if linked (overrides spec metadata)

    Returns:
        Generated commit message or fallback message
    """
    # Find spec directory
    spec_dir = project_dir / ".ac.jerry" / "specs" / spec_name
    if not spec_dir.exists():
        # Try alternative location
        spec_dir = project_dir / "ac-jerry" / "specs" / spec_name

    # Get context from spec files
    spec_context = _get_spec_context(spec_dir) if spec_dir.exists() else {}

    # Override with provided github_issue
    if github_issue:
        spec_context["github_issue"] = github_issue

    # Build prompt
    prompt = _build_prompt(
        spec_context,
        diff_summary,
        files_changed or [],
    )

    # Call Claude
    try:
        # Check if we're already in an async context
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # Already in an async context - run in a new thread
            # Use lambda to ensure coroutine is created inside the worker thread
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as pool:
                result = pool.submit(lambda: asyncio.run(_call_claude(prompt))).result()
        else:
            result = asyncio.run(_call_claude(prompt))

        if result:
            return result
    except Exception as e:
        logger.error(f"Failed to generate commit message: {e}")

    # Fallback message
    commit_type = CATEGORY_TO_COMMIT_TYPE.get(
        spec_context.get("category", "").lower(), "chore"
    )
    title = spec_context.get("title", spec_name)
    fallback = f"{commit_type}: {title}"

    if github_issue or spec_context.get("github_issue"):
        issue_num = github_issue or spec_context.get("github_issue")
        fallback += f"\n\nFixes #{issue_num}"

    return fallback


async def generate_commit_message(
    project_dir: Path,
    spec_name: str,
    diff_summary: str = "",
    files_changed: list[str] | None = None,
    github_issue: int | None = None,
) -> str:
    """
    Generate a commit message asynchronously.

    Args:
        project_dir: Project root directory
        spec_name: Spec identifier (e.g., "001-add-feature")
        diff_summary: Git diff stat or summary
        files_changed: List of changed file paths
        github_issue: GitHub issue number if linked (overrides spec metadata)

    Returns:
        Generated commit message or fallback message
    """
    # Find spec directory
    spec_dir = project_dir / ".ac.jerry" / "specs" / spec_name
    if not spec_dir.exists():
        spec_dir = project_dir / "ac-jerry" / "specs" / spec_name

    # Get context from spec files
    spec_context = _get_spec_context(spec_dir) if spec_dir.exists() else {}

    # Override with provided github_issue
    if github_issue:
        spec_context["github_issue"] = github_issue

    # Build prompt
    prompt = _build_prompt(
        spec_context,
        diff_summary,
        files_changed or [],
    )

    # Call Claude
    try:
        result = await _call_claude(prompt)
        if result:
            return result
    except Exception as e:
        logger.error(f"Failed to generate commit message: {e}")

    # Fallback message
    commit_type = CATEGORY_TO_COMMIT_TYPE.get(
        spec_context.get("category", "").lower(), "chore"
    )
    title = spec_context.get("title", spec_name)
    fallback = f"{commit_type}: {title}"

    if github_issue or spec_context.get("github_issue"):
        issue_num = github_issue or spec_context.get("github_issue")
        fallback += f"\n\nFixes #{issue_num}"

    return fallback

"""
Conversation Compaction Module
==============================

Summarizes phase outputs to maintain continuity between phases while
reducing token usage. After each phase completes, key findings are
summarized and passed as context to subsequent phases.

Also provides spec summary generation for resume sessions to avoid
re-reading the full spec.md on every agent session.
"""

import json
import logging
import re
from pathlib import Path

from core.auth import require_auth_token
from core.simple_client import create_simple_client

logger = logging.getLogger(__name__)


async def summarize_phase_output(
    phase_name: str,
    phase_output: str,
    model: str = "sonnet",  # Shorthand - resolved via API Profile if configured
    target_words: int = 500,
) -> str:
    """
    Summarize phase output to a concise summary for subsequent phases.

    Uses Sonnet for cost efficiency since this is a simple summarization task.

    Args:
        phase_name: Name of the completed phase (e.g., 'discovery', 'requirements')
        phase_output: Full output content from the phase (file contents, decisions)
        model: Model to use for summarization (defaults to Sonnet for efficiency)
        target_words: Target summary length in words (~500-1000 recommended)

    Returns:
        Concise summary of key findings, decisions, and insights from the phase
    """
    # Validate auth token
    require_auth_token()

    # Limit input size to avoid token overflow
    max_input_chars = 15000
    truncated_output = phase_output[:max_input_chars]
    if len(phase_output) > max_input_chars:
        truncated_output += "\n\n[... output truncated for summarization ...]"

    prompt = f"""Summarize the key findings from the "{phase_name}" phase in {target_words} words or less.

Focus on extracting ONLY the most critical information that subsequent phases need:
- Key decisions made and their rationale
- Critical files, components, or patterns identified
- Important constraints or requirements discovered
- Actionable insights for implementation

Be concise and use bullet points. Skip boilerplate and meta-commentary.

## Phase Output:
{truncated_output}

## Summary:
"""

    client = create_simple_client(
        agent_type="spec_compaction",
        model=model,
        system_prompt=(
            "You are a concise technical summarizer. Extract only the most "
            "critical information from phase outputs. Use bullet points. "
            "Focus on decisions, discoveries, and actionable insights."
        ),
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
            return response_text.strip()
    except Exception as e:
        # Fallback: return truncated raw output on error
        # This ensures we don't block the pipeline if summarization fails
        fallback = phase_output[:2000]
        if len(phase_output) > 2000:
            fallback += "\n\n[... truncated ...]"
        return f"[Summarization failed: {e}]\n\n{fallback}"


def format_phase_summaries(summaries: dict[str, str]) -> str:
    """
    Format accumulated phase summaries for injection into agent context.

    Args:
        summaries: Dict mapping phase names to their summaries

    Returns:
        Formatted string suitable for agent context injection
    """
    if not summaries:
        return ""

    formatted_parts = ["## Context from Previous Phases\n"]
    for phase_name, summary in summaries.items():
        formatted_parts.append(
            f"### {phase_name.replace('_', ' ').title()}\n{summary}\n"
        )

    return "\n".join(formatted_parts)


def gather_phase_outputs(spec_dir: Path, phase_name: str) -> str:
    """
    Gather output files from a completed phase for summarization.

    Args:
        spec_dir: Path to the spec directory
        phase_name: Name of the completed phase

    Returns:
        Concatenated content of phase output files
    """
    outputs = []

    # Map phases to their expected output files
    phase_outputs: dict[str, list[str]] = {
        "discovery": ["context.json"],
        "requirements": ["requirements.json"],
        "research": ["research.json"],
        "context": ["context.json"],
        "quick_spec": ["spec.md"],
        "spec_writing": ["spec.md"],
        "self_critique": ["spec.md", "critique_notes.md"],
        "planning": ["implementation_plan.json"],
        "validation": [],  # No output files to summarize
    }

    output_files = phase_outputs.get(phase_name, [])

    for filename in output_files:
        file_path = spec_dir / filename
        if file_path.exists():
            try:
                content = file_path.read_text()
                # Limit individual file size
                if len(content) > 10000:
                    content = content[:10000] + "\n\n[... file truncated ...]"
                outputs.append(f"**{filename}**:\n```\n{content}\n```")
            except Exception:
                pass  # Skip files that can't be read

    return "\n\n".join(outputs) if outputs else ""


def generate_spec_summary(spec_dir: Path) -> str:
    """
    Generate a compact spec summary for resume sessions (~200 tokens).

    Extracts key information from spec.md and implementation_plan.json without
    making any LLM calls. The summary replaces the agent's need to `cat spec.md`
    on resumed sessions, saving 2,000-5,000 tokens per session.

    Args:
        spec_dir: Path to the spec directory containing spec.md and implementation_plan.json

    Returns:
        Compact summary string, or empty string if spec files are missing
    """
    spec_file = spec_dir / "spec.md"
    plan_file = spec_dir / "implementation_plan.json"

    if not spec_file.exists():
        return ""

    try:
        spec_content = spec_file.read_text(encoding="utf-8")
    except OSError:
        return ""

    # Extract feature/title from spec
    title = ""
    title_match = re.search(r"^#\s+(?:Task:\s*)?(.+)$", spec_content, re.MULTILINE)
    if title_match:
        title = title_match.group(1).strip()

    # Extract workflow type and feature from plan
    workflow_type = ""
    plan_feature = ""
    completed = 0
    total = 0
    pending_subtask_ids = []
    services = set()

    if plan_file.exists():
        try:
            plan = json.loads(plan_file.read_text(encoding="utf-8"))
            workflow_type = plan.get("workflow_type", "")
            plan_feature = plan.get("feature", "")
            for phase in plan.get("phases", []):
                for subtask in phase.get("subtasks", []):
                    total += 1
                    status = subtask.get("status", "pending")
                    if status == "completed":
                        completed += 1
                    elif status in ("pending", "in_progress"):
                        pending_subtask_ids.append(subtask.get("id", "?"))
                    svc = subtask.get("service", "")
                    if svc and svc != "all":
                        services.add(svc)
        except (json.JSONDecodeError, OSError):
            pass

    # Use plan feature as fallback title
    if not title and plan_feature:
        title = plan_feature

    # Extract key requirements (first 5 bullet points or numbered items from spec)
    requirements = []
    for match in re.finditer(r"^[\s]*[-*]\s+(.+)$", spec_content, re.MULTILINE):
        req = match.group(1).strip()
        if len(req) > 10 and not req.startswith("http"):
            requirements.append(req)
        if len(requirements) >= 5:
            break

    # Build compact summary
    lines = [
        f"SPEC SUMMARY (full spec: {spec_dir.name}/spec.md)",
        f"Feature: {title}" if title else "",
        f"Workflow: {workflow_type}" if workflow_type else "",
    ]

    if requirements:
        lines.append("Key requirements:")
        for req in requirements:
            # Truncate long requirements
            if len(req) > 80:
                req = req[:77] + "..."
            lines.append(f"- {req}")

    if services:
        lines.append(f"Services: {', '.join(sorted(services))}")

    if total > 0:
        lines.append(f"Subtasks: {completed}/{total} completed, {total - completed} pending")
        if pending_subtask_ids and len(pending_subtask_ids) <= 8:
            lines.append(f"Pending: {', '.join(pending_subtask_ids)}")

    return "\n".join(line for line in lines if line)


def save_spec_summary(spec_dir: Path) -> bool:
    """
    Generate and save a spec summary to spec_dir/spec_summary.txt.

    Called after the first successful subtask completion. Subsequent resume
    sessions read this file instead of the full spec.md.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        True if summary was saved, False otherwise
    """
    summary = generate_spec_summary(spec_dir)
    if not summary:
        return False

    try:
        summary_file = spec_dir / "spec_summary.txt"
        summary_file.write_text(summary, encoding="utf-8")
        logger.debug(f"Spec summary saved to {summary_file}")
        return True
    except OSError as e:
        logger.warning(f"Failed to save spec summary: {e}")
        return False


def load_spec_summary(spec_dir: Path) -> str:
    """
    Load a previously saved spec summary.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Summary string, or empty string if not found
    """
    summary_file = spec_dir / "spec_summary.txt"
    if summary_file.exists():
        try:
            return summary_file.read_text(encoding="utf-8")
        except OSError:
            pass
    return ""

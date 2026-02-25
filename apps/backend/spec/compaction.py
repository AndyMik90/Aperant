"""
Conversation Compaction Module
==============================

Summarizes phase outputs to maintain continuity between phases while
reducing token usage. After each phase completes, key findings are
summarized and passed as context to subsequent phases.
"""

from pathlib import Path

from core.auth import require_auth_token
from core.simple_client import create_simple_client


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
                content = file_path.read_text(encoding="utf-8")
                # Limit individual file size
                if len(content) > 10000:
                    content = content[:10000] + "\n\n[... file truncated ...]"
                outputs.append(f"**{filename}**:\n```\n{content}\n```")
            except Exception:
                pass  # Skip files that can't be read

    return "\n\n".join(outputs) if outputs else ""

"""
Parallel Agent Orchestrator Base
=================================

Abstract base class for parallel specialist agent orchestration.

Extracts shared patterns from the PR review parallel orchestrator so that
both PR review and issue investigation can reuse:
- SpecialistConfig dataclass for agent definition
- Prompt loading from prompts/github/ directory
- SDK session creation and stream processing
- asyncio.gather-based parallel execution
- Progress reporting via callback

Subclasses must implement domain-specific logic (prompt building, result
parsing, verdict generation, etc.).
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from ...core.client import create_client
    from ...phase_config import (
        get_model_betas,
        get_thinking_kwargs_for_model,
    )
    from .io_utils import safe_print
    from .sdk_utils import process_sdk_stream
except (ImportError, ValueError, SystemError):
    from core.client import create_client
    from phase_config import (
        get_model_betas,
        get_thinking_kwargs_for_model,
    )
    from services.io_utils import safe_print
    from services.sdk_utils import process_sdk_stream


logger = logging.getLogger(__name__)

# Import investigation Bash safety hook (lazy - only used when Bash is in tools)
_investigation_bash_guard = None


def _get_investigation_bash_guard():
    """Lazy-import the investigation Bash guard to avoid circular imports."""
    global _investigation_bash_guard
    if _investigation_bash_guard is None:
        try:
            from .investigation_hooks import investigation_bash_guard

            _investigation_bash_guard = investigation_bash_guard
        except (ImportError, ValueError, SystemError):
            try:
                from services.investigation_hooks import investigation_bash_guard

                _investigation_bash_guard = investigation_bash_guard
            except (ImportError, ModuleNotFoundError):
                from investigation_hooks import investigation_bash_guard

                _investigation_bash_guard = investigation_bash_guard
    return _investigation_bash_guard


# Check if debug mode is enabled
DEBUG_MODE = os.environ.get("DEBUG", "").lower() in ("true", "1", "yes")


@dataclass
class SpecialistConfig:
    """Configuration for a specialist agent in parallel SDK sessions."""

    name: str
    prompt_file: str
    tools: list[str]
    description: str
    max_turns: int = 30


class ParallelAgentOrchestrator:
    """
    Base class for parallel specialist agent orchestration.

    Provides shared infrastructure for running multiple Claude SDK sessions
    in parallel via asyncio.gather(). Subclasses define their own specialist
    configurations, prompt building, and result parsing.

    Shared capabilities:
    - Load prompt files from prompts/github/ directory
    - Run individual specialist SDK sessions with structured output
    - Run multiple specialists in parallel and collect results
    - Report progress via callback
    """

    def __init__(
        self,
        project_dir: Path,
        github_dir: Path,
        config: Any,
        progress_callback: Any = None,
    ):
        self.project_dir = Path(project_dir)
        self.github_dir = Path(github_dir)
        self.config = config
        self.progress_callback = progress_callback

    def _report_progress(self, phase: str, progress: int, message: str, **kwargs):
        """Report progress if callback is set."""
        if self.progress_callback:
            import sys

            if "orchestrator" in sys.modules:
                ProgressCallback = sys.modules["orchestrator"].ProgressCallback
            else:
                try:
                    from ..orchestrator import ProgressCallback
                except ImportError:
                    from orchestrator import ProgressCallback

            self.progress_callback(
                ProgressCallback(
                    phase=phase, progress=progress, message=message, **kwargs
                )
            )

    def _load_prompt(self, filename: str) -> str:
        """Load a prompt file from the prompts/github directory."""
        prompt_file = (
            Path(__file__).parent.parent.parent.parent / "prompts" / "github" / filename
        )
        if prompt_file.exists():
            return prompt_file.read_text(encoding="utf-8")
        logger.warning(f"Prompt file not found: {prompt_file}")
        return ""

    async def _run_specialist_session(
        self,
        config: SpecialistConfig,
        prompt: str,
        project_root: Path,
        model: str,
        thinking_budget: int | None,
        output_schema: dict[str, Any] | None = None,
        agent_type: str = "pr_reviewer",
        context_name: str | None = None,
        max_messages: int | None = None,
        on_thinking: Any | None = None,
        on_tool_use: Any | None = None,
        on_tool_result: Any | None = None,
        resume_session_id: str | None = None,
        thinking_level: str | None = None,
        effort_level: str | None = None,
    ) -> dict[str, Any]:
        """Run a single specialist as its own SDK session.

        This is the generic version that accepts a pre-built prompt and
        output schema. Subclasses build domain-specific prompts and parse
        results from the returned dict.

        Args:
            config: Specialist configuration
            prompt: Full system prompt (already built by subclass)
            project_root: Working directory for the agent
            model: Model to use
            thinking_budget: Max thinking tokens
            output_schema: JSON schema dict for structured output (optional)
            agent_type: Agent type for create_client (e.g., "pr_reviewer",
                       "investigation_specialist")
            context_name: Name for logging (defaults to "Specialist:{config.name}")
            max_messages: Optional max message count for stream processing

        Returns:
            Dict with keys from process_sdk_stream:
            - result_text: Raw text output
            - structured_output: Parsed structured output (if schema provided)
            - error: Error message (if any)
            - msg_count: Total message count
        """
        log_name = context_name or f"Specialist:{config.name}"

        safe_print(
            f"[{log_name}] Starting analysis...",
            flush=True,
        )

        try:
            # Create SDK client for this specialist
            # Use per-specialist model for betas (not the global config model)
            betas = get_model_betas(model or self.config.model or "sonnet")

            # Get thinking budget - use explicit budget if provided, otherwise derive from thinking level
            if thinking_budget is not None:
                thinking_kwargs = {"max_thinking_tokens": thinking_budget}
            else:
                # Use per-specialist thinking level when provided
                effective_thinking = (
                    thinking_level or self.config.thinking_level or "medium"
                )
                thinking_kwargs = get_thinking_kwargs_for_model(
                    model, effective_thinking
                )

            # Override effort_level if explicitly provided (e.g., investigation
            # agents always use "high" effort regardless of thinking level).
            # Only applies to adaptive models (Opus 4.6+) where thinking_kwargs
            # includes effort_level; non-adaptive models silently skip this.
            if effort_level and "effort_level" in thinking_kwargs:
                thinking_kwargs["effort_level"] = effort_level

            client_kwargs: dict[str, Any] = {
                "project_dir": project_root,
                "spec_dir": self.github_dir,
                "model": model,
                "agent_type": agent_type,
                "betas": betas,
                "fast_mode": self.config.fast_mode,
                **thinking_kwargs,
            }

            if output_schema:
                client_kwargs["output_format"] = {
                    "type": "json_schema",
                    "schema": output_schema,
                }

            client = create_client(**client_kwargs)

            # Resume previous session if session ID provided
            if resume_session_id:
                client.options.resume = resume_session_id
                safe_print(
                    f"[{log_name}] Resuming session: {resume_session_id[:20]}..."
                )

            # Add investigation Bash safety hook if agent has Bash access
            if "Bash" in config.tools:
                try:
                    from claude_agent_sdk.types import HookMatcher

                    bash_guard = _get_investigation_bash_guard()
                    existing_hooks = client.options.hooks or {}
                    pre_tool_hooks = existing_hooks.get("PreToolUse", [])
                    pre_tool_hooks.append(
                        HookMatcher(matcher="Bash", hooks=[bash_guard])
                    )
                    existing_hooks["PreToolUse"] = pre_tool_hooks
                    client.options.hooks = existing_hooks
                except ImportError:
                    logger.warning(
                        f"[{log_name}] Could not import HookMatcher — "
                        "Bash access will be unguarded"
                    )

            async with client:
                await client.query(prompt)

                # Capture session ID for resume support
                session_id = getattr(client, "session_id", None)

                # Build stream kwargs
                stream_kwargs: dict[str, Any] = {
                    "client": client,
                    "context_name": log_name,
                    "model": model,
                    "system_prompt": prompt,
                    "agent_definitions": {},
                }
                if max_messages is not None:
                    stream_kwargs["max_messages"] = max_messages
                if on_thinking is not None:
                    stream_kwargs["on_thinking"] = on_thinking
                if on_tool_use is not None:
                    stream_kwargs["on_tool_use"] = on_tool_use
                if on_tool_result is not None:
                    stream_kwargs["on_tool_result"] = on_tool_result

                stream_result = await process_sdk_stream(**stream_kwargs)

                error = stream_result.get("error")
                if error:
                    logger.error(f"[{log_name}] SDK stream failed: {error}")
                    safe_print(
                        f"[{log_name}] Analysis failed: {error}",
                        flush=True,
                    )

                return {**stream_result, "session_id": session_id}

        except Exception as e:
            logger.error(
                f"[{log_name}] Session failed: {e}",
                exc_info=True,
            )
            safe_print(
                f"[{log_name}] Error: {e}",
                flush=True,
            )
            return {
                "result_text": "",
                "structured_output": None,
                "error": str(e),
                "msg_count": 0,
            }

    async def _run_parallel_specialists(
        self,
        tasks: list[asyncio.Task | Any],
        orchestrator_name: str = "ParallelOrchestrator",
        retry_tasks: list[Any] | None = None,
        retry_configs: list[dict[str, Any]] | None = None,
    ) -> list[Any]:
        """Run pre-built async tasks in parallel and collect results.

        Failed specialists are retried once before being discarded.
        If retry_tasks is provided, it should be a list of callables
        (0-arg coroutine factories) that can recreate the coroutine
        for a retry attempt.

        Results preserve positional order: result[i] corresponds to tasks[i].
        Failed specialists (after retry) are represented as None in the list.

        Args:
            tasks: List of coroutines/tasks to run in parallel
            orchestrator_name: Name for logging
            retry_tasks: Optional list of 0-arg callables that recreate
                        the coroutine for each task (same order as tasks).
                        If None, failed tasks are not retried.
            retry_configs: Optional list of dicts with retry configuration:
                        - name: Specialist name for logging
                        - lifecycle_wrapper: Optional callable that wraps a coroutine
                          with lifecycle events (agent_started, agent_done)

        Returns:
            List of results preserving original task order.
            Failed tasks are None; successful tasks contain the result dict.
        """
        safe_print(
            f"[{orchestrator_name}] Launching {len(tasks)} specialists in parallel...",
            flush=True,
        )

        results = await asyncio.gather(*tasks, return_exceptions=True)

        def _should_retry_result(result: Any) -> bool:
            """Retry recoverable stream errors without structured output."""
            if not isinstance(result, dict):
                return False
            if result.get("structured_output"):
                return False
            return bool(result.get("error") and result.get("error_recoverable"))

        # Build position-indexed result map
        result_map: dict[int, Any] = {}
        failed_indices: list[int] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"[{orchestrator_name}] Specialist task failed: {result}")
                failed_indices.append(i)
            else:
                result_map[i] = result
                if _should_retry_result(result):
                    logger.warning(
                        f"[{orchestrator_name}] Specialist {i} returned recoverable "
                        f"error '{result.get('error')}', scheduling retry"
                    )
                    failed_indices.append(i)

        # Preserve order while de-duping in case a task matched multiple conditions.
        failed_indices = list(dict.fromkeys(failed_indices))

        # Retry failed specialists once if retry factories are provided
        if failed_indices and retry_tasks:
            retryable = [
                (idx, retry_tasks[idx])
                for idx in failed_indices
                if idx < len(retry_tasks) and retry_tasks[idx] is not None
            ]
            if retryable:
                safe_print(
                    f"[{orchestrator_name}] Retrying {len(retryable)} failed specialist(s)...",
                    flush=True,
                )
                # Apply lifecycle wrapper to retry coroutines if provided
                retry_coroutines = []
                for idx, factory in retryable:
                    coro = factory()
                    # Apply lifecycle wrapper if available for this task
                    if retry_configs and idx < len(retry_configs):
                        config = retry_configs[idx]
                        wrapper = config.get("lifecycle_wrapper")
                        if wrapper:
                            spec_name = config.get("name", f"specialist_{idx}")
                            coro = wrapper(spec_name, coro)
                    retry_coroutines.append(coro)

                retry_results = await asyncio.gather(
                    *retry_coroutines, return_exceptions=True
                )
                still_failing = []
                for (idx, _), retry_result in zip(retryable, retry_results):
                    if isinstance(retry_result, Exception):
                        logger.error(
                            f"[{orchestrator_name}] Retry also failed for specialist {idx}: {retry_result}"
                        )
                        still_failing.append(idx)
                    else:
                        retry_has_error = bool(
                            isinstance(retry_result, dict)
                            and retry_result.get("error")
                            and not retry_result.get("structured_output")
                        )
                        if retry_has_error:
                            logger.warning(
                                f"[{orchestrator_name}] Retry for specialist {idx} "
                                f"still returned error: {retry_result.get('error')}"
                            )
                            still_failing.append(idx)
                            # Keep original result when available (it may contain
                            # more complete text output than the retry).
                            if idx not in result_map:
                                result_map[idx] = retry_result
                        else:
                            safe_print(
                                f"[{orchestrator_name}] Retry succeeded for specialist {idx}",
                                flush=True,
                            )
                            result_map[idx] = retry_result

                # Log final summary of permanently failed specialists
                if still_failing:
                    logger.error(
                        f"[{orchestrator_name}] Specialists {still_failing} failed permanently after retry"
                    )

        succeeded = len(result_map)
        safe_print(
            f"[{orchestrator_name}] All specialists complete. "
            f"{succeeded}/{len(tasks)} succeeded.",
            flush=True,
        )

        # Return ordered list preserving original positions (None for failures)
        return [result_map.get(i) for i in range(len(tasks))]

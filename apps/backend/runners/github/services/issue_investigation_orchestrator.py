"""
Issue Investigation Orchestrator
==================================

Runs 4 specialist agents in two phases to investigate a GitHub issue:

Phase 1 (parallel or sequential): root_cause + reproducer
Phase 2 (parallel): impact + fix_advisor (with root cause context injected)

Specialists:
- Root Cause Analyzer: trace bug to source code paths
- Impact Assessor: blast radius and affected components
- Fix Advisor: concrete fix approaches with files and patterns
- Reproducer: reproducibility and test coverage

Inherits from ParallelAgentOrchestrator for shared SDK session
infrastructure. Uses structured output via Pydantic model schemas.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from ...phase_config import (
        get_thinking_budget,
        resolve_model_id,
    )
    from ..sanitize import (
        get_prompt_safety_prefix,
        sanitize_github_content,
        wrap_for_prompt,
    )
    from .investigation_hooks import emit_json_event
    from .investigation_models import (
        FixAdvice,
        ImpactAssessment,
        InvestigationReport,
        ReproductionAnalysis,
        RootCauseAnalysis,
    )
    from .investigation_persistence import (
        save_agent_log,
        save_investigation_report,
        save_specialist_session,
    )
    from .io_utils import safe_print
    from .parallel_agent_base import ParallelAgentOrchestrator, SpecialistConfig
    from .sdk_utils import _get_tool_detail
except (ImportError, ValueError, SystemError):
    try:
        from sanitize import (
            get_prompt_safety_prefix,
            sanitize_github_content,
            wrap_for_prompt,
        )
        from services.investigation_hooks import emit_json_event
        from services.investigation_models import (
            FixAdvice,
            ImpactAssessment,
            InvestigationReport,
            ReproductionAnalysis,
            RootCauseAnalysis,
        )
        from services.investigation_persistence import (
            save_agent_log,
            save_investigation_report,
            save_specialist_session,
        )
        from services.io_utils import safe_print
        from services.parallel_agent_base import (
            ParallelAgentOrchestrator,
            SpecialistConfig,
        )
        from services.sdk_utils import _get_tool_detail
    except (ImportError, ModuleNotFoundError):
        from investigation_hooks import emit_json_event
        from investigation_models import (
            FixAdvice,
            ImpactAssessment,
            InvestigationReport,
            ReproductionAnalysis,
            RootCauseAnalysis,
        )
        from investigation_persistence import (
            save_agent_log,
            save_investigation_report,
            save_specialist_session,
        )
        from io_utils import safe_print
        from parallel_agent_base import ParallelAgentOrchestrator, SpecialistConfig
        from sanitize import (
            get_prompt_safety_prefix,
            sanitize_github_content,
            wrap_for_prompt,
        )
        from sdk_utils import _get_tool_detail
    from phase_config import (
        get_thinking_budget,
        resolve_model_id,
    )


logger = logging.getLogger(__name__)

# =============================================================================
# Image URL Extraction
# =============================================================================

_IMAGE_URL_PATTERNS = [
    # Markdown: ![alt](url) or ![alt](url "title")
    re.compile(r"!\[.*?\]\((https?://[^\s)]+)\)"),
    # HTML: <img src="url"> or <img src='url'>
    re.compile(r'<img[^>]+src=["\'](https?://[^"\']+)["\']', re.IGNORECASE),
]


def extract_image_urls(text: str) -> list[str]:
    """Extract image URLs from GitHub issue markdown.

    Supports both markdown syntax (![](url)) and HTML <img> tags.
    Returns a deduplicated list of HTTP/HTTPS image URLs.

    Args:
        text: Issue body or comment text

    Returns:
        List of unique image URLs found in the text
    """
    if not text:
        return []

    urls: set[str] = set()
    for pattern in _IMAGE_URL_PATTERNS:
        urls.update(pattern.findall(text))

    # Return sorted list for deterministic ordering
    return sorted(urls)


# =============================================================================
# Specialist Timeout Configuration
# =============================================================================

# Specialist timeout: 15 minutes per specialist
# This allows sufficient time for deep codebase analysis, including:
# - Repository indexing and search operations
# - Multi-file trace analysis for root cause
# - Complex dependency graph exploration
# - Test execution and coverage analysis
SPECIALIST_TIMEOUT_SECONDS = 900  # 15 minutes


async def _run_with_timeout(coro, name: str, timeout: int = SPECIALIST_TIMEOUT_SECONDS):
    """Run a coroutine with a timeout, returning a TimeoutError on expiry."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        logger.error(f"Specialist {name} timed out after {timeout}s")
        return TimeoutError(f"Specialist {name} timed out after {timeout}s")


# =============================================================================
# Per-Specialist Max Tokens Configuration
# =============================================================================

# Per-specialist max_tokens configuration (Opus 4.6 supports up to 128K)
#
# Root cause gets highest limit for deep analysis:
# - Multi-file tracing across entire codebase
# - Complex dependency chain analysis
# - Historical git log exploration
# - Pattern matching across modules
#
# Other specialists use standard limit:
# - Component mapping and impact assessment
# - Fix approach generation
# - Test coverage and reproducibility analysis
#
# Note: Values are 1 token lower than API max to reserve space for message separator
SPECIALIST_MAX_TOKENS = {
    # Keep budgets below API max ceilings to reduce quota spikes and improve
    # reliability under shared-account investigations.
    "root_cause": 63999,
    "impact": 31999,
    "fix_advisor": 31999,
    "reproducer": 31999,
}

# =============================================================================
# Specialist Configurations
# =============================================================================

INVESTIGATION_SPECIALISTS: list[SpecialistConfig] = [
    SpecialistConfig(
        name="root_cause",
        prompt_file="investigation_root_cause.md",
        tools=["Read", "Grep", "Glob", "Bash"],
        description="Trace the bug/issue to its source code paths and identify the root cause",
    ),
    SpecialistConfig(
        name="impact",
        prompt_file="investigation_impact.md",
        tools=["Read", "Grep", "Glob", "Bash"],
        description="Determine blast radius, affected components, and user impact",
    ),
    SpecialistConfig(
        name="fix_advisor",
        prompt_file="investigation_fix_advice.md",
        tools=["Read", "Grep", "Glob", "Bash"],
        description="Suggest concrete fix approaches with files to modify and patterns to follow",
    ),
    SpecialistConfig(
        name="reproducer",
        prompt_file="investigation_reproduction.md",
        tools=["Read", "Grep", "Glob"],
        description="Determine reproducibility, check test coverage, and suggest test approaches",
    ),
]

# Map specialist name → Pydantic model for structured output
_SPECIALIST_SCHEMAS: dict[str, type] = {
    "root_cause": RootCauseAnalysis,
    "impact": ImpactAssessment,
    "fix_advisor": FixAdvice,
    "reproducer": ReproductionAnalysis,
}


class IssueInvestigationOrchestrator(ParallelAgentOrchestrator):
    """
    Orchestrator for two-phase issue investigation.

    Runs 4 specialist agents in two sequential phases, each with their own
    SDK session and structured output schema. Phase 1 runs root_cause and
    reproducer in either parallel or sequential mode. Phase 2 runs impact
    and fix_advisor in parallel, with root cause findings injected as
    context. Results are combined into an InvestigationReport.

    Inherits from ParallelAgentOrchestrator:
    - _report_progress() — progress callback
    - _load_prompt() — loads from prompts/github/ directory
    - _run_specialist_session() — generic SDK session runner
    - _run_parallel_specialists() — asyncio.gather wrapper
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._cancel_event = asyncio.Event()

    def cancel(self):
        """Signal the investigation to cancel."""
        self._cancel_event.set()

    def _create_cancelled_report(
        self,
        issue_number: int,
        issue_title: str,
        investigation_id: str,
    ) -> InvestigationReport:
        """Create a report for a cancelled investigation.

        Args:
            issue_number: GitHub issue number
            issue_title: Issue title
            investigation_id: Unique investigation ID

        Returns:
            InvestigationReport with placeholder values for cancelled state
        """
        return InvestigationReport(
            issue_number=issue_number,
            issue_title=issue_title,
            investigation_id=investigation_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            ai_summary="Investigation was cancelled.",
            severity="medium",
            likely_resolved=False,
            root_cause=RootCauseAnalysis(
                identified_root_cause="Investigation cancelled",
                confidence="low",
                evidence="",
            ),
            impact=ImpactAssessment(
                severity="medium",
                blast_radius="Unknown (cancelled)",
                user_impact="Unknown (cancelled)",
                regression_risk="Unknown",
            ),
            fix_advice=FixAdvice(),
            reproduction=ReproductionAnalysis(
                reproducible="unlikely",
                test_coverage={
                    "has_existing_tests": False,
                    "test_files": [],
                    "coverage_assessment": "Unknown (cancelled)",
                },
                suggested_test_approach="Unknown (cancelled)",
            ),
        )

    async def investigate(
        self,
        issue_number: int,
        issue_title: str,
        issue_body: str,
        issue_labels: list[str] | None = None,
        issue_comments: list[str] | None = None,
        project_root: Path | None = None,
        resume_sessions: dict[str, str] | None = None,
    ) -> InvestigationReport:
        """
        Run a full investigation on a GitHub issue.

        Args:
            issue_number: GitHub issue number
            issue_title: Issue title
            issue_body: Issue body text
            issue_labels: Issue labels (optional)
            issue_comments: Issue comments (optional)
            project_root: Working directory for agents (worktree path).
                         Defaults to self.project_dir.

        Returns:
            InvestigationReport combining all specialist results
        """
        working_dir = project_root or self.project_dir
        investigation_id = f"inv-{uuid.uuid4().hex[:12]}"

        logger.info(
            f"[Investigation] Starting investigation {investigation_id} "
            f"for issue #{issue_number}: {issue_title}"
        )

        self._report_progress(
            "investigating",
            10,
            f"Starting investigation for issue #{issue_number}...",
            issue_number=issue_number,
        )

        # Check for cancellation before context gathering
        if self._cancel_event.is_set():
            logger.info("Investigation cancelled before context gathering")
            emit_json_event("investigation_cancelled", "orchestrator")
            return self._create_cancelled_report(
                issue_number=issue_number,
                issue_title=issue_title,
                investigation_id=investigation_id,
            )

        # Build issue context for all specialists
        issue_context = self._build_issue_context(
            issue_number=issue_number,
            issue_title=issue_title,
            issue_body=issue_body,
            issue_labels=issue_labels or [],
            issue_comments=issue_comments or [],
            project_root=working_dir,
        )

        # Yield to event loop to ensure cancellation event propagates
        await asyncio.sleep(0)

        # Resolve per-specialist config
        specialist_config = self.config.specialist_config or {}
        phase_1_mode = getattr(self.config, "investigation_phase1_mode", "sequential")

        # Fallback model/thinking for specialists not in config
        fallback_model_shorthand = self.config.model or "sonnet"
        fallback_model = resolve_model_id(fallback_model_shorthand)
        fallback_thinking_level = self.config.thinking_level or "medium"

        logger.info(
            f"[Investigation] Using fallback model={fallback_model}, "
            f"thinking_level={fallback_thinking_level}, "
            f"specialist_config={specialist_config}"
        )

        # Check for cancellation before specialist dispatch
        if self._cancel_event.is_set():
            logger.info("Investigation cancelled before specialist dispatch")
            emit_json_event("investigation_cancelled", "orchestrator")
            return self._create_cancelled_report(
                issue_number=issue_number,
                issue_title=issue_title,
                investigation_id=investigation_id,
            )

        self._report_progress(
            "investigating",
            20,
            "Launching investigation...",
            issue_number=issue_number,
        )

        # Run specialists in two phases (root_cause+reproducer, then impact+fix_advisor)
        specialist_results = await self._run_investigation_specialists(
            issue_context=issue_context,
            project_root=working_dir,
            specialist_config=specialist_config,
            fallback_model=fallback_model,
            fallback_thinking_level=fallback_thinking_level,
            phase_1_mode=phase_1_mode,
            issue_number=issue_number,
            resume_sessions=resume_sessions,
        )

        # Check for cancellation after specialist execution
        if self._cancel_event.is_set():
            logger.info("Investigation cancelled after specialist execution")
            emit_json_event("investigation_cancelled", "orchestrator")
            return self._create_cancelled_report(
                issue_number=issue_number,
                issue_title=issue_title,
                investigation_id=investigation_id,
            )

        self._report_progress(
            "investigating",
            80,
            "Combining specialist results...",
            issue_number=issue_number,
        )

        # Build the combined report
        report = await self._build_report(
            issue_number=issue_number,
            issue_title=issue_title,
            investigation_id=investigation_id,
            specialist_results=specialist_results,
        )

        # Save agent logs
        for name, result in specialist_results.items():
            log_text = result.get("result_text", "")
            if log_text:
                save_agent_log(self.project_dir, issue_number, name, log_text)

        # Save report
        save_investigation_report(self.project_dir, issue_number, report)

        self._report_progress(
            "investigating",
            100,
            "Investigation complete!",
            issue_number=issue_number,
        )

        logger.info(
            f"[Investigation] Investigation {investigation_id} complete. "
            f"Severity: {report.severity}, likely_resolved: {report.likely_resolved}"
        )

        return report

    def _get_recent_commits(self, project_root: Path, max_count: int = 20) -> str:
        """
        Fetch recent git commits to provide context for investigation.

        Args:
            project_root: Path to the git repository
            max_count: Maximum number of commits to fetch

        Returns:
            Formatted string with recent commits, or error message if failed
        """
        try:
            result = subprocess.run(
                [
                    "git",
                    "log",
                    "--oneline",
                    "-n",
                    str(max_count),
                    "--date=short",
                    "--format=%h | %ad | %s",
                ],
                cwd=project_root,
                capture_output=True,
                text=True,
                timeout=10,
            )

            if result.returncode != 0:
                logger.warning(f"Git log failed: {result.stderr}")
                return ""

            commits = result.stdout.strip()
            if not commits:
                return ""

            return f"""
### Recent Commits (last {max_count})

```
{commits}
```
"""

        except subprocess.TimeoutExpired:
            logger.warning("Git log timed out")
            return ""
        except FileNotFoundError:
            logger.warning("Git not found in project")
            return ""
        except Exception as e:
            logger.warning(f"Failed to fetch git log: {e}")
            return ""

    def _build_issue_context(
        self,
        issue_number: int,
        issue_title: str,
        issue_body: str,
        issue_labels: list[str],
        issue_comments: list[str],
        project_root: Path,
    ) -> str:
        """Build the issue context string injected into all specialist prompts.

        Extracts and lists any image URLs found in the issue body or comments.
        All user-controlled content (title, body, comments) is sanitized to
        prevent prompt injection attacks.
        """
        labels_str = ", ".join(issue_labels) if issue_labels else "(none)"

        # Sanitize user-controlled inputs before interpolation
        safe_title = sanitize_github_content(issue_title, "issue_body").content
        safe_body = (
            sanitize_github_content(issue_body, "issue_body").content
            if issue_body
            else ""
        )

        # Extract image URLs before sanitization (from original content)
        body_images = extract_image_urls(issue_body)

        # Extract image URLs from comments
        comment_images: set[str] = set()
        for comment in issue_comments:
            comment_images.update(extract_image_urls(comment))

        # Combine all images (deduplicated via set)
        all_images = sorted(set(body_images) | comment_images)

        # Build images section if any were found
        images_section = ""
        if all_images:
            images_list = "\n".join(
                f"- {url}" for url in all_images[:20]
            )  # Limit to 20 images
            images_section = f"""

### Images ({len(all_images)} found)
{images_list}
"""

        comments_section = ""
        if issue_comments:
            comments_list = []
            for i, comment in enumerate(issue_comments[:10], 1):
                # Sanitize and truncate each comment
                safe_comment = sanitize_github_content(comment, "comment").content
                truncated = (
                    safe_comment[:500] + "..."
                    if len(safe_comment) > 500
                    else safe_comment
                )
                comments_list.append(f"**Comment {i}:**\n{truncated}")
            comments_section = f"""
### Comments ({len(issue_comments)} total)
{chr(10).join(comments_list)}
"""

        # Fetch recent git commits for context
        commits_section = self._get_recent_commits(project_root, max_count=20)

        # Wrap user content in delimiters with prompt hardening
        return f"""
{get_prompt_safety_prefix()}
## GitHub Issue #{issue_number}

**Title:** {safe_title}
**Labels:** {labels_str}
{images_section}
### Description
{wrap_for_prompt(safe_body or "(No description provided)", "issue_body")}
{comments_section}
{commits_section}
"""

    def _build_specialist_prompt(
        self,
        config: SpecialistConfig,
        issue_context: str,
        project_root: Path,
        root_cause_context: str = "",
    ) -> str:
        """Build the full prompt for a specialist agent.

        Args:
            config: Specialist configuration
            issue_context: Pre-built issue context string
            project_root: Working directory for the agent
            root_cause_context: Optional root cause context from Phase 1
                               (injected into Phase 2 prompts)

        Returns:
            Full system prompt with context injected
        """
        base_prompt = self._load_prompt(config.prompt_file)
        if not base_prompt:
            base_prompt = (
                f"You are an issue investigation specialist ({config.name}). "
                f"Analyze the issue and provide findings for: {config.description}."
            )

        # Inject working directory
        working_dir_section = f"""
## Working Directory

All file paths are relative to: `{project_root}`
Use Read, Grep, and Glob tools to explore the codebase.
"""

        return base_prompt + working_dir_section + issue_context + root_cause_context

    def _build_root_cause_context(self, root_cause: RootCauseAnalysis | None) -> str:
        """Build root cause context string for injection into Phase 2 prompts."""
        if not root_cause:
            return ""

        code_paths_str = ""
        if hasattr(root_cause, "code_paths") and root_cause.code_paths:
            paths = root_cause.code_paths
            if isinstance(paths, list):
                formatted = []
                for p in paths:
                    if isinstance(p, str):
                        formatted.append(f"- {p}")
                    elif hasattr(p, "file"):
                        # CodePath model: format as file:line with description
                        line_info = f"L{p.start_line}" if p.start_line else ""
                        if p.end_line:
                            line_info += f"-L{p.end_line}"
                        desc = f" — {p.description}" if p.description else ""
                        formatted.append(f"- `{p.file}:{line_info}`{desc}")
                    else:
                        formatted.append(f"- {str(p)}")
                code_paths_str = "\n".join(formatted)
            else:
                code_paths_str = str(paths)

        return f"""
## Root Cause Analysis (from prior investigation phase)

**Root Cause:** {root_cause.identified_root_cause}

**Confidence:** {root_cause.confidence}

**Code Paths:**
{code_paths_str}

**Evidence:** {root_cause.evidence}

**Likely Already Fixed:** {root_cause.likely_already_fixed}

Use this root cause analysis to inform your assessment. Do NOT re-investigate
the root cause — focus on your specialty using these findings as ground truth.
"""

    async def _run_investigation_specialists(
        self,
        issue_context: str,
        project_root: Path,
        specialist_config: dict[str, dict[str, str]],
        fallback_model: str,
        fallback_thinking_level: str,
        phase_1_mode: str = "sequential",
        issue_number: int | None = None,
        resume_sessions: dict[str, str] | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Run investigation specialists in two phases.

        Phase 1 (parallel/sequential): root_cause + reproducer
        Phase 2 (parallel): impact + fix_advisor (with root cause context)

        Args:
            issue_context: Pre-built issue context
            project_root: Working directory
            specialist_config: Per-specialist model/thinking overrides
            fallback_model: Default model ID for specialists without overrides
            fallback_thinking_level: Default thinking level for specialists
                                    without overrides
            phase_1_mode: Execution mode for phase 1 specialists.
                         Supported: "parallel", "sequential"
            issue_number: GitHub issue number (for session persistence)
            resume_sessions: Optional dict mapping specialist name to SDK
                           session ID for resuming interrupted sessions.

        Returns:
            Dict mapping specialist name -> stream result dict
        """
        PHASE_1_NAMES = {"root_cause", "reproducer"}
        VALID_PHASE_1_MODES = {"parallel", "sequential"}

        mode = str(phase_1_mode or "sequential").strip().lower()
        if mode not in VALID_PHASE_1_MODES:
            logger.warning(
                f"[Investigation] Unknown phase_1_mode='{phase_1_mode}', "
                "falling back to sequential"
            )
            mode = "sequential"

        phase_1_specs = [
            s for s in INVESTIGATION_SPECIALISTS if s.name in PHASE_1_NAMES
        ]
        phase_2_specs = [
            s for s in INVESTIGATION_SPECIALISTS if s.name not in PHASE_1_NAMES
        ]

        def _missing_result(
            error: str = "Specialist did not complete",
        ) -> dict[str, Any]:
            """Build a normalized missing/failed specialist result payload."""
            return {
                "result_text": "",
                "structured_output": None,
                "error": error,
                "msg_count": 0,
            }

        # Shared completion counter for incremental progress reporting
        _agents_done = 0
        _agents_lock = asyncio.Lock()

        def _resolve_specialist(cfg_name: str):
            """Resolve model, thinking budget, and thinking level for a specialist."""
            sc = specialist_config.get(cfg_name, {})
            model_str = sc.get("model", fallback_model)
            # If model_str is a shorthand, resolve it
            if not model_str.startswith("claude-"):
                model_str = resolve_model_id(model_str)
            thinking_lvl = sc.get("thinking", fallback_thinking_level)
            # Use per-specialist max_tokens if available, otherwise fallback to thinking level
            budget = SPECIALIST_MAX_TOKENS.get(
                cfg_name, get_thinking_budget(thinking_lvl)
            )
            return model_str, budget, thinking_lvl

        # Build coroutine factories so failed specialists can be retried
        def _make_specialist_factory(
            cfg: SpecialistConfig,
            model: str,
            budget: int | None,
            thinking_lvl: str = "medium",
            root_cause_ctx: str = "",
        ):
            """Create a 0-arg callable that returns a fresh coroutine."""

            def factory():
                _prompt = self._build_specialist_prompt(
                    cfg, issue_context, project_root, root_cause_context=root_cause_ctx
                )
                _schema_class = _SPECIALIST_SCHEMAS.get(cfg.name)
                _output_schema = (
                    _schema_class.model_json_schema() if _schema_class else None
                )
                # Look up resume session ID for this specialist
                _resume_id = resume_sessions.get(cfg.name) if resume_sessions else None
                # Track tool_id -> tool_name so on_tool_result can include the tool name
                _tool_names: dict[str, str] = {}

                def _on_tool_use(name, tid, inp, _name=cfg.name, _map=_tool_names):
                    _map[tid] = name
                    # StructuredOutput is an internal SDK tool — don't show in UI
                    if name == "StructuredOutput":
                        return
                    emit_json_event(
                        "tool_start",
                        _name,
                        tool=name,
                        detail=_get_tool_detail(name, inp),
                    )

                def _on_tool_result(
                    tid, err, content, _name=cfg.name, _map=_tool_names
                ):
                    tool = _map.pop(tid, None)
                    # StructuredOutput is an internal SDK tool — don't show in UI
                    if tool == "StructuredOutput":
                        return
                    kwargs = {"tool": tool, "success": not err}
                    if err and content:
                        # Include truncated error detail for failed tools
                        kwargs["error"] = str(content)[:200]
                    emit_json_event("tool_end", _name, **kwargs)

                return self._run_specialist_session(
                    config=cfg,
                    prompt=_prompt,
                    project_root=project_root,
                    model=model,
                    thinking_budget=budget,
                    output_schema=_output_schema,
                    agent_type="investigation_specialist",
                    context_name=f"Investigation:{cfg.name}",
                    resume_session_id=_resume_id,
                    thinking_level=thinking_lvl,
                    effort_level="high",
                    on_thinking=lambda text, _name=cfg.name: emit_json_event(
                        "thinking",
                        _name,
                        chars=len(text),
                        preview=text[:200].replace("\n", " "),
                    ),
                    on_tool_use=_on_tool_use,
                    on_tool_result=_on_tool_result,
                )

            return factory

        async def _retry_lifecycle_wrapper(agent_name: str, coro):
            """Wrap a retry coroutine with final completion events only.

            Retries should not emit a new ``agent_started`` lifecycle event,
            because the UI treats that as a brand-new run and resets timers.
            """
            try:
                result = await _run_with_timeout(
                    coro, agent_name, SPECIALIST_TIMEOUT_SECONDS
                )
                if isinstance(result, TimeoutError):
                    emit_json_event(
                        "agent_done",
                        agent_name,
                        success=False,
                        error=str(result)[:200],
                    )
                    result = {
                        "result_text": "",
                        "structured_output": None,
                        "error": str(result),
                        "msg_count": 0,
                    }
                else:
                    success = self._specialist_succeeded_for_lifecycle(result)
                    emit_json_event(
                        "agent_done",
                        agent_name,
                        success=success,
                        error=result.get("error") if not success else None,
                    )
            except Exception as e:
                emit_json_event(
                    "agent_done",
                    agent_name,
                    success=False,
                    error=str(e)[:200],
                )
                raise
            return result

        def _should_defer_failed_lifecycle(result: dict[str, Any] | None) -> bool:
            """Return True when a recoverable stream error will be retried.

            For recoverable errors we defer failed lifecycle emission until the
            retry result is known, preventing failed->started flapping in the UI.
            """
            if not isinstance(result, dict):
                return False
            if result.get("structured_output"):
                return False
            return bool(result.get("error") and result.get("error_recoverable"))

        async def _agent_lifecycle_wrapper(
            cfg: SpecialistConfig,
            coro,
            progress_base: int,
            progress_step: int,
        ):
            """Wrap a specialist coroutine with timeout and agent_started/agent_done events."""
            nonlocal _agents_done

            emit_json_event("agent_started", cfg.name)

            try:
                result = await _run_with_timeout(
                    coro, cfg.name, SPECIALIST_TIMEOUT_SECONDS
                )
                # _run_with_timeout returns a TimeoutError instance (not raised) on timeout
                if isinstance(result, TimeoutError):
                    emit_json_event(
                        "agent_done",
                        cfg.name,
                        success=False,
                        error=str(result)[:200],
                    )
                    result = {
                        "result_text": "",
                        "structured_output": None,
                        "error": str(result),
                        "msg_count": 0,
                    }
                else:
                    # Recoverable stream failures are retried by
                    # _run_parallel_specialists. Avoid emitting a failed
                    # lifecycle event here so the UI does not flap/reset.
                    if not _should_defer_failed_lifecycle(result):
                        success = self._specialist_succeeded_for_lifecycle(result)
                        emit_json_event(
                            "agent_done",
                            cfg.name,
                            success=success,
                            error=result.get("error") if not success else None,
                        )
            except Exception as e:
                emit_json_event(
                    "agent_done",
                    cfg.name,
                    success=False,
                    error=str(e)[:200],
                )
                raise

            # Bump incremental progress (thread-safe via asyncio lock)
            async with _agents_lock:
                _agents_done += 1
                self._report_progress(
                    "investigating",
                    progress_base + (_agents_done * progress_step),
                    f"{cfg.name} complete",
                    issue_number=issue_number,
                )

            return result

        # === Phase 1: root_cause + reproducer ===
        phase_1_result_map: dict[str, dict[str, Any]] = {}
        root_cause_ctx = ""
        root_cause_parsed = None

        if mode == "parallel":
            self._report_progress(
                "investigating",
                20,
                "Phase 1 (parallel): Root Cause Agent + Reproducer Agent...",
                issue_number=issue_number,
            )

            _agents_done = 0
            phase_1_coroutines = []
            phase_1_retry_factories = []
            phase_1_retry_configs = []
            for cfg in phase_1_specs:
                model, budget, thinking_lvl = _resolve_specialist(cfg.name)
                factory = _make_specialist_factory(
                    cfg, model, budget, thinking_lvl=thinking_lvl
                )
                phase_1_coroutines.append(
                    _agent_lifecycle_wrapper(cfg, factory(), 20, 15)
                )
                phase_1_retry_factories.append(factory)
                # Create a simplified lifecycle wrapper for retries (without progress tracking)
                phase_1_retry_configs.append(
                    {
                        "name": cfg.name,
                        "lifecycle_wrapper": lambda name, coro: (
                            _retry_lifecycle_wrapper(name, coro)
                        ),
                    }
                )

            phase_1_results = await self._run_parallel_specialists(
                tasks=phase_1_coroutines,
                orchestrator_name="IssueInvestigation:Phase1",
                retry_tasks=phase_1_retry_factories,
                retry_configs=phase_1_retry_configs,
            )

            # Map phase 1 results
            for i, cfg in enumerate(phase_1_specs):
                result = phase_1_results[i] if i < len(phase_1_results) else None
                phase_1_result_map[cfg.name] = (
                    result if result is not None else _missing_result()
                )

            # Parse root cause for context injection into Phase 2
            root_cause_parsed = await self._parse_specialist_result(
                "root_cause", phase_1_result_map, RootCauseAnalysis
            )
            root_cause_ctx = self._build_root_cause_context(root_cause_parsed)
        else:
            self._report_progress(
                "investigating",
                20,
                "Phase 1 (sequential): Root Cause Agent then Reproducer Agent...",
                issue_number=issue_number,
            )

            _agents_done = 0
            for cfg in phase_1_specs:
                if self._cancel_event.is_set():
                    logger.info(
                        f"Investigation cancelled during Phase 1 before {cfg.name}"
                    )
                    break

                model, budget, thinking_lvl = _resolve_specialist(cfg.name)
                phase_1_root_cause_ctx = (
                    root_cause_ctx if cfg.name == "reproducer" else ""
                )
                factory = _make_specialist_factory(
                    cfg,
                    model,
                    budget,
                    thinking_lvl=thinking_lvl,
                    root_cause_ctx=phase_1_root_cause_ctx,
                )

                single_result = await self._run_parallel_specialists(
                    tasks=[_agent_lifecycle_wrapper(cfg, factory(), 20, 15)],
                    orchestrator_name=f"IssueInvestigation:Phase1:{cfg.name}",
                    retry_tasks=[factory],
                    retry_configs=[
                        {
                            "name": cfg.name,
                            "lifecycle_wrapper": lambda name, coro: (
                                _retry_lifecycle_wrapper(name, coro)
                            ),
                        }
                    ],
                )
                result = single_result[0] if single_result else None
                phase_1_result_map[cfg.name] = (
                    result if result is not None else _missing_result()
                )

                if cfg.name == "root_cause":
                    root_cause_parsed = await self._parse_specialist_result(
                        "root_cause", phase_1_result_map, RootCauseAnalysis
                    )
                    root_cause_ctx = self._build_root_cause_context(root_cause_parsed)

            # Fill any missing phase-1 specialists after cancellation/interruption.
            for cfg in phase_1_specs:
                if cfg.name not in phase_1_result_map:
                    phase_1_result_map[cfg.name] = _missing_result(
                        "Specialist cancelled"
                    )

            if root_cause_parsed is None:
                root_cause_parsed = await self._parse_specialist_result(
                    "root_cause", phase_1_result_map, RootCauseAnalysis
                )
            root_cause_ctx = self._build_root_cause_context(root_cause_parsed)

        # Yield to event loop to ensure cancellation event propagates
        await asyncio.sleep(0)

        # Check for cancellation between Phase 1 and Phase 2
        if self._cancel_event.is_set():
            logger.info("Investigation cancelled between Phase 1 and Phase 2")
            emit_json_event("investigation_cancelled", "orchestrator")
            # Return phase 1 results only (phase 2 will have defaults)
            phase_2_result_map: dict[str, dict[str, Any]] = {}
            for cfg in phase_2_specs:
                phase_2_result_map[cfg.name] = {
                    **_missing_result("Specialist cancelled"),
                }
            return {**phase_1_result_map, **phase_2_result_map}

        # === Phase 2: impact + fix_advisor (with root cause context) ===
        self._report_progress(
            "investigating",
            55,
            "Phase 2: Impact Agent + Fix Advisor Agent...",
            issue_number=issue_number,
        )

        _agents_done = 0
        phase_2_coroutines = []
        phase_2_retry_factories = []
        phase_2_retry_configs = []
        for cfg in phase_2_specs:
            model, budget, thinking_lvl = _resolve_specialist(cfg.name)
            factory = _make_specialist_factory(
                cfg,
                model,
                budget,
                thinking_lvl=thinking_lvl,
                root_cause_ctx=root_cause_ctx,
            )
            phase_2_coroutines.append(_agent_lifecycle_wrapper(cfg, factory(), 55, 13))
            phase_2_retry_factories.append(factory)
            # Create a simplified lifecycle wrapper for retries (without progress tracking)
            phase_2_retry_configs.append(
                {
                    "name": cfg.name,
                    "lifecycle_wrapper": lambda name, coro: _retry_lifecycle_wrapper(
                        name, coro
                    ),
                }
            )

        phase_2_results = await self._run_parallel_specialists(
            tasks=phase_2_coroutines,
            orchestrator_name="IssueInvestigation:Phase2",
            retry_tasks=phase_2_retry_factories,
            retry_configs=phase_2_retry_configs,
        )

        # Map phase 2 results
        phase_2_result_map: dict[str, dict[str, Any]] = {}
        for i, cfg in enumerate(phase_2_specs):
            result = phase_2_results[i] if i < len(phase_2_results) else None
            phase_2_result_map[cfg.name] = (
                result if result is not None else _missing_result()
            )

        # Combine all results
        all_results = {**phase_1_result_map, **phase_2_result_map}

        # Save session IDs for resume support (both phases)
        if issue_number is not None:
            for config in INVESTIGATION_SPECIALISTS:
                result = all_results.get(config.name)
                if result and result.get("session_id"):
                    try:
                        save_specialist_session(
                            self.project_dir,
                            issue_number,
                            config.name,
                            result["session_id"],
                        )
                    except Exception as e:
                        logger.warning(
                            f"Failed to save session ID for {config.name}: {e}"
                        )

        return all_results

    @staticmethod
    def _specialist_succeeded_for_lifecycle(result: dict[str, Any] | None) -> bool:
        """Determine whether a specialist should be marked green in timeline UI."""
        if not isinstance(result, dict):
            return False
        # Structured output is authoritative success, even if stream emitted
        # a recoverable warning/error marker.
        if result.get("structured_output"):
            return True
        return not bool(result.get("error"))

    async def _build_report(
        self,
        issue_number: int,
        issue_title: str,
        investigation_id: str,
        specialist_results: dict[str, dict[str, Any]],
    ) -> InvestigationReport:
        """Combine specialist results into an InvestigationReport.

        Parses structured output from each specialist and falls back to
        defaults if parsing fails.

        Args:
            issue_number: GitHub issue number
            issue_title: Issue title
            investigation_id: Unique investigation ID
            specialist_results: Dict mapping specialist name → stream result

        Returns:
            Combined InvestigationReport
        """
        # Parse each specialist's structured output
        root_cause = await self._parse_specialist_result(
            "root_cause", specialist_results, RootCauseAnalysis
        )
        impact = await self._parse_specialist_result(
            "impact", specialist_results, ImpactAssessment
        )
        fix_advice = await self._parse_specialist_result(
            "fix_advisor", specialist_results, FixAdvice
        )
        reproduction = await self._parse_specialist_result(
            "reproducer", specialist_results, ReproductionAnalysis
        )
        reproducer_error = str(
            (specialist_results.get("reproducer") or {}).get("error") or ""
        ).strip()

        # Compute overall severity from impact assessment
        severity = impact.severity if impact else "medium"

        # Check if likely already resolved
        likely_resolved = root_cause.likely_already_fixed if root_cause else False

        # Build AI summary
        ai_summary = self._generate_summary(
            root_cause=root_cause,
            impact=impact,
            fix_advice=fix_advice,
            reproduction=reproduction,
        )

        # Use defaults for any missing specialist results
        if not root_cause:
            root_cause = RootCauseAnalysis(
                identified_root_cause="Unable to determine root cause (specialist failed)",
                confidence="low",
                evidence="Investigation specialist did not complete successfully",
            )
        if not impact:
            impact = ImpactAssessment(
                severity="medium",
                blast_radius="Unable to assess (specialist failed)",
                user_impact="Unable to assess (specialist failed)",
                regression_risk="Unknown",
            )
        if not fix_advice:
            fix_advice = FixAdvice()
        if not reproduction:
            reason = self._humanize_specialist_error(reproducer_error)
            coverage_assessment = (
                f"Unable to assess ({reason})"
                if reason
                else "Unable to assess (specialist failed)"
            )
            test_approach = (
                f"Unable to determine ({reason})"
                if reason
                else "Unable to determine (specialist failed)"
            )
            reproduction = ReproductionAnalysis(
                reproducible="unlikely",
                test_coverage={
                    "has_existing_tests": False,
                    "test_files": [],
                    "coverage_assessment": coverage_assessment,
                },
                suggested_test_approach=test_approach,
            )

        return InvestigationReport(
            issue_number=issue_number,
            issue_title=issue_title,
            investigation_id=investigation_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            root_cause=root_cause,
            impact=impact,
            fix_advice=fix_advice,
            reproduction=reproduction,
            ai_summary=ai_summary,
            severity=severity,
            likely_resolved=likely_resolved,
        )

    async def _parse_specialist_result(
        self,
        name: str,
        specialist_results: dict[str, dict[str, Any]],
        model_class: type,
    ) -> Any | None:
        """Parse structured output from a specialist into a Pydantic model.

        Args:
            name: Specialist name
            specialist_results: Dict of all specialist results
            model_class: Pydantic model class to validate against

        Returns:
            Parsed model instance, or None if parsing failed
        """
        result = specialist_results.get(name)
        if not result:
            return None

        structured_output = result.get("structured_output")
        structured_output_candidate = result.get("structured_output_candidate")
        tool_activity = result.get("tool_activity")
        if not isinstance(tool_activity, list):
            tool_activity = []
        last_assistant_text = result.get("last_assistant_text", "")
        full_result_text = result.get("result_text", "")
        # Prefer the final assistant text block when available; it is usually
        # cleaner than the concatenated full transcript.
        result_text = last_assistant_text or full_result_text
        tool_activity_lines = [
            str(line).strip() for line in tool_activity if str(line).strip()
        ][-120:]
        tool_activity_text = "\n".join(tool_activity_lines)
        extraction_text = result_text.strip()
        if tool_activity_text:
            extraction_text = (
                f"{extraction_text}\n\nTool activity:\n{tool_activity_text}"
                if extraction_text
                else f"Tool activity:\n{tool_activity_text}"
            )

        if structured_output:
            try:
                return model_class.model_validate(structured_output)
            except Exception as e:
                logger.error(
                    f"[Investigation] Failed to parse {name} output: {e}",
                    exc_info=True,
                )
                safe_print(f"[Investigation] {name}: schema validation failed: {e}")
                partial_recovered = self._recover_from_partial_structured_output(
                    name=name,
                    model_class=model_class,
                    structured_output=structured_output,
                    fallback_text=extraction_text,
                )
                if partial_recovered is not None:
                    safe_print(
                        f"[Investigation] {name}: recovered partial structured output"
                    )
                    return partial_recovered

        if not structured_output:
            error = result.get("error", "unknown")
            msg_count = result.get("msg_count", 0)
            logger.warning(
                f"[Investigation] No structured output from {name} "
                f"(error={error}, msgs={msg_count})"
            )
            safe_print(
                f"[Investigation] {name}: no structured output "
                f"(error={error}, msgs={msg_count})"
            )

        if not structured_output and isinstance(structured_output_candidate, dict):
            safe_print(f"[Investigation] {name}: trying unvalidated output candidate")
            try:
                return model_class.model_validate(structured_output_candidate)
            except Exception as e:
                logger.warning(
                    f"[Investigation] {name}: candidate validation failed: {e}"
                )
                partial_candidate = self._recover_from_partial_structured_output(
                    name=name,
                    model_class=model_class,
                    structured_output=structured_output_candidate,
                    fallback_text=extraction_text,
                )
                if partial_candidate is not None:
                    safe_print(
                        f"[Investigation] {name}: recovered from output candidate"
                    )
                    return partial_candidate

        json_recovered = self._recover_from_text_json(
            name=name,
            model_class=model_class,
            text=result_text,
        )
        if json_recovered is not None:
            safe_print(f"[Investigation] {name}: recovered JSON from text output")
            return json_recovered

        error_text = str(result.get("error") or "").lower()
        if "rate_limit" in error_text or "hit your limit" in error_text:
            return None

        recovered = await self._attempt_specialist_extraction_call(
            name=name,
            model_class=model_class,
            analysis_text=extraction_text,
        )
        if recovered is not None:
            safe_print(f"[Investigation] {name}: recovered structured output")
            return recovered

        return None

    @staticmethod
    def _humanize_specialist_error(error: str) -> str:
        """Convert internal specialist error codes/messages to user-facing text."""
        if not error:
            return ""
        lowered = error.lower()
        if "rate_limit" in lowered or "hit your limit" in lowered:
            return "rate limit reached"
        if "structured_output_validation_failed" in lowered:
            return "structured output validation failed"
        if "tool_use_concurrency_error" in lowered:
            return "tool concurrency error"
        # Keep fallback concise for UI readability.
        return error.strip()[:120]

    @staticmethod
    def _to_string_list(value: Any) -> list[str]:
        """Normalize a value into a list of non-empty strings."""
        if value is None:
            return []
        if isinstance(value, str):
            s = value.strip()
            return [s] if s else []
        if not isinstance(value, list):
            return []
        normalized: list[str] = []
        for item in value:
            if item is None:
                continue
            s = str(item).strip()
            if s:
                normalized.append(s)
        return normalized

    @staticmethod
    def _normalize_reproducible_value(value: Any, fallback_text: str = "") -> str:
        """Map free-form reproducibility values into canonical buckets."""
        raw = str(value).strip().lower() if value is not None else ""

        direct_map = {
            "yes": "yes",
            "true": "yes",
            "reproducible": "yes",
            "likely": "likely",
            "maybe": "likely",
            "sometimes": "likely",
            "intermittent": "likely",
            "unlikely": "unlikely",
            "no": "no",
            "false": "no",
        }
        if raw in direct_map:
            return direct_map[raw]

        if "cannot reproduce" in raw or "can't reproduce" in raw:
            return "no"
        if "not reproducible" in raw:
            return "no"
        if "likely" in raw:
            return "likely"
        if "unlikely" in raw:
            return "unlikely"
        if "yes" in raw:
            return "yes"
        if "no" in raw:
            return "no"

        text = fallback_text.lower()
        if "cannot reproduce" in text or "can't reproduce" in text:
            return "no"
        if "not reproducible" in text:
            return "no"
        if "reproducible: yes" in text:
            return "yes"
        if "reproducible: likely" in text:
            return "likely"
        if "reproducible: unlikely" in text:
            return "unlikely"
        if "reproducible: no" in text:
            return "no"

        return "unlikely"

    def _coerce_reproduction_output(
        self,
        structured_output: Any,
        fallback_text: str = "",
    ) -> ReproductionAnalysis | None:
        """Best-effort recovery for partial/invalid reproducer structured output."""
        if not isinstance(structured_output, dict):
            return None

        reproduction_steps = self._to_string_list(
            structured_output.get("reproduction_steps")
        )
        if not reproduction_steps and fallback_text:
            for line in fallback_text.splitlines():
                trimmed = line.strip()
                # Capture bullet/numbered steps from free-form fallback text.
                if re.match(r"^(\d+[\).\:-]|[-*])\s+", trimmed):
                    step = re.sub(r"^(\d+[\).\:-]|[-*])\s+", "", trimmed).strip()
                    if step:
                        reproduction_steps.append(step)
                if len(reproduction_steps) >= 10:
                    break

        related_test_files = self._to_string_list(
            structured_output.get("related_test_files")
        )

        raw_test_coverage = structured_output.get("test_coverage")
        if isinstance(raw_test_coverage, dict):
            test_files = self._to_string_list(raw_test_coverage.get("test_files"))
            has_existing_tests = raw_test_coverage.get("has_existing_tests")
            if isinstance(has_existing_tests, str):
                has_existing_tests = has_existing_tests.strip().lower() in (
                    "true",
                    "yes",
                    "1",
                )
            if not isinstance(has_existing_tests, bool):
                has_existing_tests = bool(test_files)
            coverage_assessment = str(
                raw_test_coverage.get("coverage_assessment")
                or "Unable to assess existing test coverage from available evidence"
            )
        else:
            test_files = related_test_files.copy()
            has_existing_tests = bool(test_files)
            coverage_assessment = (
                "Unable to assess existing test coverage from available evidence"
            )

        if not related_test_files and test_files:
            related_test_files = test_files.copy()

        normalized_payload = {
            "reproducible": self._normalize_reproducible_value(
                structured_output.get("reproducible"), fallback_text
            ),
            "reproduction_steps": reproduction_steps,
            "test_coverage": {
                "has_existing_tests": has_existing_tests,
                "test_files": test_files,
                "coverage_assessment": coverage_assessment,
            },
            "related_test_files": related_test_files,
            "suggested_test_approach": str(
                structured_output.get("suggested_test_approach")
                or structured_output.get("test_approach")
                or "Unable to determine a reliable test approach from available evidence"
            ),
        }

        try:
            return ReproductionAnalysis.model_validate(normalized_payload)
        except Exception:
            return None

    @staticmethod
    def _extract_json_object_from_text(text: str) -> dict[str, Any] | None:
        """Extract the first valid JSON object from free-form model text."""
        if not text:
            return None

        starts = [idx for idx, ch in enumerate(text) if ch == "{"]
        for start in starts:
            depth = 0
            in_string = False
            escaped = False
            for i in range(start, len(text)):
                ch = text[i]
                if in_string:
                    if escaped:
                        escaped = False
                    elif ch == "\\":
                        escaped = True
                    elif ch == '"':
                        in_string = False
                    continue

                if ch == '"':
                    in_string = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = text[start : i + 1]
                        try:
                            parsed = json.loads(candidate)
                        except Exception:
                            break
                        if isinstance(parsed, dict):
                            return parsed
                        break
        return None

    @staticmethod
    def _is_reproduction_analysis_model(model_class: type) -> bool:
        """Identify ReproductionAnalysis even when imported via a different module path."""
        if getattr(model_class, "__name__", "") == ReproductionAnalysis.__name__:
            return True

        fields = getattr(model_class, "model_fields", None)
        if not isinstance(fields, dict):
            return False

        return {"reproducible", "test_coverage", "suggested_test_approach"}.issubset(
            fields.keys()
        )

    def _recover_from_partial_structured_output(
        self,
        name: str,
        model_class: type,
        structured_output: Any,
        fallback_text: str,
    ) -> Any | None:
        """Try model-specific recovery when structured output is close to valid."""
        if self._is_reproduction_analysis_model(model_class):
            recovered = self._coerce_reproduction_output(
                structured_output=structured_output,
                fallback_text=fallback_text,
            )
            if recovered is not None:
                logger.info(f"[Investigation] Recovered partial output for {name}")
            return recovered
        return None

    def _recover_from_text_json(
        self,
        name: str,
        model_class: type,
        text: str,
    ) -> Any | None:
        """Try recovering by extracting a JSON object embedded in text output."""
        parsed = self._extract_json_object_from_text(text)
        if not parsed:
            return None

        try:
            return model_class.model_validate(parsed)
        except Exception as e:
            logger.warning(f"[Investigation] {name}: text JSON validation failed: {e}")
            if self._is_reproduction_analysis_model(model_class):
                return self._coerce_reproduction_output(
                    structured_output=parsed,
                    fallback_text=text,
                )
            return None

    async def _attempt_specialist_extraction_call(
        self,
        name: str,
        model_class: type,
        analysis_text: str,
    ) -> Any | None:
        """Recover specialist output when native structured output is missing."""
        analysis_text = (analysis_text or "").strip()
        if not analysis_text:
            return None

        # Keep extraction prompt bounded.
        max_chars = 16_000
        if len(analysis_text) > max_chars:
            analysis_text = analysis_text[-max_chars:]

        model = self.config.model or "sonnet"
        if not model.startswith("claude-"):
            model = resolve_model_id(model)

        extraction_prompt = (
            "Convert the specialist analysis into JSON that matches the provided schema.\n"
            "Rules:\n"
            "- Use only facts present in the analysis text.\n"
            "- If a field is missing, use conservative defaults rather than inventing details.\n"
            "- Keep list fields as empty lists when unknown.\n\n"
            f"Specialist: {name}\n"
            "Analysis text:\n"
            f"{analysis_text}"
        )

        extraction_cfg = SpecialistConfig(
            name=f"{name}_extract",
            prompt_file="",
            tools=[],
            description=f"Structured output recovery for {name}",
            max_turns=2,
        )

        safe_print(f"[Investigation] {name}: attempting extraction recovery")
        try:
            extraction_result = await self._run_specialist_session(
                config=extraction_cfg,
                prompt=extraction_prompt,
                project_root=self.project_dir,
                model=model,
                thinking_budget=get_thinking_budget("low"),
                output_schema=model_class.model_json_schema(),
                agent_type="investigation_specialist_extraction",
                context_name=f"Investigation:{name}:extract",
                max_messages=120,
                thinking_level="low",
            )
        except Exception as e:
            logger.warning(
                f"[Investigation] {name}: extraction recovery failed to run: {e}"
            )
            return None

        recovered_output = extraction_result.get("structured_output")
        if not recovered_output:
            text_recovered = self._recover_from_text_json(
                name=name,
                model_class=model_class,
                text=(
                    extraction_result.get("last_assistant_text")
                    or extraction_result.get("result_text", "")
                ),
            )
            if text_recovered is not None:
                return text_recovered
            logger.warning(
                f"[Investigation] {name}: extraction call returned no structured output"
            )
            return None

        try:
            return model_class.model_validate(recovered_output)
        except Exception as e:
            logger.warning(
                f"[Investigation] {name}: extraction output validation failed: {e}"
            )
            partial_recovered = self._recover_from_partial_structured_output(
                name=name,
                model_class=model_class,
                structured_output=recovered_output,
                fallback_text=analysis_text,
            )
            if partial_recovered is not None:
                return partial_recovered
            return None

    def _generate_summary(
        self,
        root_cause: RootCauseAnalysis | None,
        impact: ImpactAssessment | None,
        fix_advice: FixAdvice | None,
        reproduction: ReproductionAnalysis | None,
    ) -> str:
        """Generate a human-readable summary from specialist results."""
        parts = []

        if root_cause:
            parts.append(
                f"Root cause ({root_cause.confidence} confidence): "
                f"{root_cause.identified_root_cause}"
            )

        if impact:
            parts.append(f"Severity: {impact.severity}. {impact.user_impact}")

        if fix_advice and fix_advice.approaches:
            rec_idx = fix_advice.recommended_approach
            if 0 <= rec_idx < len(fix_advice.approaches):
                approach = fix_advice.approaches[rec_idx]
                parts.append(
                    f"Recommended fix ({approach.complexity}): {approach.description}"
                )

        if reproduction:
            parts.append(f"Reproducible: {reproduction.reproducible}.")

        return (
            " ".join(parts)
            if parts
            else "Investigation completed but no specialist produced results."
        )

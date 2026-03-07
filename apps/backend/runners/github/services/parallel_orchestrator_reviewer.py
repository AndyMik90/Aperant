"""
Parallel Orchestrator PR Reviewer
==================================

PR reviewer using Claude Agent SDK subagents for parallel specialist analysis.

The orchestrator analyzes the PR and delegates to specialized agents (security,
quality, logic, codebase-fit, ai-triage) which run in parallel. Results are
synthesized into a final verdict.

Key Design:
- AI decides which agents to invoke (NOT programmatic rules)
- Subagents defined via SDK `agents={}` parameter
- SDK handles parallel execution automatically
- User-configured model from frontend settings (no hardcoding)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Note: AgentDefinition import kept for backwards compatibility but no longer used
# The Task tool's custom subagent_type feature is broken in Claude Code CLI
# See: https://github.com/anthropics/claude-code/issues/8697
from claude_agent_sdk import AgentDefinition  # noqa: F401

try:
    from ...core.client import create_client
    from ...phase_config import (
        get_model_betas,
        get_thinking_budget,
        get_thinking_kwargs_for_model,
        resolve_model_id,
    )
    from ..context_gatherer import PRContext, _validate_git_ref
    from ..gh_client import GHClient
    from ..models import (
        BRANCH_BEHIND_BLOCKER_MSG,
        BRANCH_BEHIND_REASONING,
        GitHubRunnerConfig,
        MergeVerdict,
        PRReviewFinding,
        PRReviewResult,
        ReviewSeverity,
    )
    from .agent_utils import create_working_dir_injector
    from .category_utils import map_category
    from .io_utils import safe_print
    from .pr_worktree_manager import PRWorktreeManager
    from .pydantic_models import (
        AgentAgreement,
        FindingValidationResponse,
        ParallelOrchestratorResponse,
        SpecialistResponse,
    )
    from .sdk_utils import process_sdk_stream
except (ImportError, ValueError, SystemError):
    from context_gatherer import PRContext, _validate_git_ref
    from core.client import create_client
    from gh_client import GHClient
    from models import (
        BRANCH_BEHIND_BLOCKER_MSG,
        BRANCH_BEHIND_REASONING,
        GitHubRunnerConfig,
        MergeVerdict,
        PRReviewFinding,
        PRReviewResult,
        ReviewSeverity,
    )
    from phase_config import (
        get_model_betas,
        get_thinking_budget,
        get_thinking_kwargs_for_model,
        resolve_model_id,
    )
    from services.agent_utils import create_working_dir_injector
    from services.category_utils import map_category
    from services.io_utils import safe_print
    from services.pr_worktree_manager import PRWorktreeManager
    from services.pydantic_models import (
        AgentAgreement,
        FindingValidationResponse,
        ParallelOrchestratorResponse,
        SpecialistResponse,
    )
    from services.sdk_utils import process_sdk_stream


# =============================================================================
# Specialist Configuration for Parallel SDK Sessions
# =============================================================================


@dataclass
class SpecialistConfig:
    """Configuration for a specialist agent in parallel SDK sessions."""

    name: str
    prompt_file: str
    tools: list[str]
    description: str


# Define specialist configurations
# Each specialist runs as its own SDK session with its own system prompt and tools
SPECIALIST_CONFIGS: list[SpecialistConfig] = [
    SpecialistConfig(
        name="security",
        prompt_file="pr_security_agent.md",
        tools=["Read", "Grep", "Glob"],
        description="Security vulnerabilities, OWASP Top 10, auth issues, injection, XSS",
    ),
    SpecialistConfig(
        name="quality",
        prompt_file="pr_quality_agent.md",
        tools=["Read", "Grep", "Glob"],
        description="Code quality, complexity, duplication, error handling, patterns",
    ),
    SpecialistConfig(
        name="logic",
        prompt_file="pr_logic_agent.md",
        tools=["Read", "Grep", "Glob"],
        description="Logic correctness, edge cases, algorithms, race conditions",
    ),
    SpecialistConfig(
        name="codebase-fit",
        prompt_file="pr_codebase_fit_agent.md",
        tools=["Read", "Grep", "Glob"],
        description="Naming conventions, ecosystem fit, architectural alignment",
    ),
]


logger = logging.getLogger(__name__)

# Check if debug mode is enabled
DEBUG_MODE = os.environ.get("DEBUG", "").lower() in ("true", "1", "yes")

# Directory for PR review worktrees (inside github/pr for consistency)
PR_WORKTREE_DIR = ".auto-claude/github/pr/worktrees"


def _is_finding_in_scope(
    finding: PRReviewFinding,
    changed_files: list[str],
) -> tuple[bool, str]:
    """
    Check if finding is within PR scope.

    Args:
        finding: The finding to check
        changed_files: List of file paths changed in the PR

    Returns:
        Tuple of (is_in_scope, reason)
    """
    if not finding.file:
        return False, "No file specified"

    # Check if file is in changed files
    if finding.file not in changed_files:
        # Use schema field instead of keyword detection
        is_impact = getattr(finding, "is_impact_finding", False)

        if not is_impact:
            return (
                False,
                f"File '{finding.file}' not in PR changed files and not an impact finding",
            )

    # Check line number is reasonable (> 0)
    if finding.line is not None and finding.line <= 0:
        return False, f"Invalid line number: {finding.line}"

    return True, "In scope"


class ParallelOrchestratorReviewer:
    """
    PR reviewer using SDK subagents for parallel specialist analysis.

    The orchestrator:
    1. Analyzes the PR (size, complexity, file types, risk areas)
    2. Delegates to appropriate specialist agents (SDK handles parallel execution)
    3. Synthesizes findings into a final verdict

    Model Configuration:
    - Orchestrator uses user-configured model from frontend settings
    - Specialist agents use model="inherit" (same as orchestrator)
    """

    def __init__(
        self,
        project_dir: Path,
        github_dir: Path,
        config: GitHubRunnerConfig,
        progress_callback=None,
    ):
        self.project_dir = Path(project_dir)
        self.github_dir = Path(github_dir)
        self.config = config
        self.progress_callback = progress_callback
        self.worktree_manager = PRWorktreeManager(project_dir, PR_WORKTREE_DIR)

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

    def _create_pr_worktree(self, head_sha: str, pr_number: int) -> Path:
        """Create a temporary worktree at the PR head commit.

        Args:
            head_sha: The commit SHA of the PR head (validated before use)
            pr_number: The PR number for naming

        Returns:
            Path to the created worktree

        Raises:
            RuntimeError: If worktree creation fails
            ValueError: If head_sha fails validation (command injection prevention)
        """
        # SECURITY: Validate git ref before use in subprocess calls
        if not _validate_git_ref(head_sha):
            raise ValueError(
                f"Invalid git ref: '{head_sha}'. "
                "Must contain only alphanumeric characters, dots, slashes, underscores, and hyphens."
            )

        return self.worktree_manager.create_worktree(head_sha, pr_number)

    def _cleanup_pr_worktree(self, worktree_path: Path) -> None:
        """Remove a temporary PR review worktree with fallback chain.

        Args:
            worktree_path: Path to the worktree to remove
        """
        self.worktree_manager.remove_worktree(worktree_path)

    def _cleanup_stale_pr_worktrees(self) -> None:
        """Clean up orphaned, expired, and excess PR review worktrees on startup."""
        stats = self.worktree_manager.cleanup_worktrees()
        if stats["total"] > 0:
            logger.info(
                f"[PRReview] Cleanup: removed {stats['total']} worktrees "
                f"(orphaned={stats['orphaned']}, expired={stats['expired']}, excess={stats['excess']})"
            )

    def _define_specialist_agents(
        self, project_root: Path | None = None
    ) -> dict[str, AgentDefinition]:
        """
        Define specialist agents for the SDK.

        Each agent has:
        - description: When the orchestrator should invoke this agent
        - prompt: System prompt for the agent (includes working directory)
        - tools: Tools the agent can use (read-only for PR review)
        - model: "inherit" = use same model as orchestrator (user's choice)

        Args:
            project_root: Working directory for the agents (worktree path).
                         If None, falls back to self.project_dir.

        Returns AgentDefinition dataclass instances as required by the SDK.
        """
        # Use provided project_root or fall back to default
        working_dir = project_root or self.project_dir

        # Load agent prompts from files
        security_prompt = self._load_prompt("pr_security_agent.md")
        quality_prompt = self._load_prompt("pr_quality_agent.md")
        logic_prompt = self._load_prompt("pr_logic_agent.md")
        codebase_fit_prompt = self._load_prompt("pr_codebase_fit_agent.md")
        ai_triage_prompt = self._load_prompt("pr_ai_triage.md")
        validator_prompt = self._load_prompt("pr_finding_validator.md")

        # CRITICAL: Inject working directory into all prompts
        # Subagents don't inherit cwd from parent, so they need explicit path info
        with_working_dir = create_working_dir_injector(working_dir)

        return {
            "security-reviewer": AgentDefinition(
                description=(
                    "Security specialist. Use for OWASP Top 10, authentication, "
                    "injection, cryptographic issues, and sensitive data exposure. "
                    "Invoke when PR touches auth, API endpoints, user input, database queries, "
                    "or file operations. Use Read, Grep, and Glob tools to explore related files, "
                    "callers, and tests as needed."
                ),
                prompt=with_working_dir(
                    security_prompt, "You are a security expert. Find vulnerabilities."
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
            "quality-reviewer": AgentDefinition(
                description=(
                    "Code quality expert. Use for complexity, duplication, error handling, "
                    "maintainability, and pattern adherence. Invoke when PR has complex logic, "
                    "large functions, or significant business logic changes. Use Grep to search "
                    "for similar patterns across the codebase for consistency checks."
                ),
                prompt=with_working_dir(
                    quality_prompt,
                    "You are a code quality expert. Find quality issues.",
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
            "logic-reviewer": AgentDefinition(
                description=(
                    "Logic and correctness specialist. Use for algorithm verification, "
                    "edge cases, state management, and race conditions. Invoke when PR has "
                    "algorithmic changes, data transformations, concurrent operations, or bug fixes. "
                    "Use Grep to find callers and dependents that may be affected by logic changes."
                ),
                prompt=with_working_dir(
                    logic_prompt, "You are a logic expert. Find correctness issues."
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
            "codebase-fit-reviewer": AgentDefinition(
                description=(
                    "Codebase consistency expert. Use for naming conventions, ecosystem fit, "
                    "architectural alignment, and avoiding reinvention. Invoke when PR introduces "
                    "new patterns, large additions, or code that might duplicate existing functionality. "
                    "Use Grep and Glob to explore existing patterns and conventions in the codebase."
                ),
                prompt=with_working_dir(
                    codebase_fit_prompt,
                    "You are a codebase expert. Check for consistency.",
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
            "ai-triage-reviewer": AgentDefinition(
                description=(
                    "AI comment validator. Use for triaging comments from CodeRabbit, "
                    "Gemini Code Assist, Cursor, Greptile, and other AI reviewers. "
                    "Invoke when PR has existing AI review comments that need validation."
                ),
                prompt=with_working_dir(
                    ai_triage_prompt,
                    "You are an AI triage expert. Validate AI comments.",
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
            "finding-validator": AgentDefinition(
                description=(
                    "Finding validation specialist. Re-investigates findings to validate "
                    "they are actually real issues, not false positives. "
                    "Reads the ACTUAL CODE at the finding location with fresh eyes. "
                    "CRITICAL: Invoke for ALL findings after specialist agents complete. "
                    "Can confirm findings as valid OR dismiss them as false positives. "
                    "Use Read, Grep, and Glob to check for mitigations the original agent missed."
                ),
                prompt=with_working_dir(
                    validator_prompt, "You validate whether findings are real issues."
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
        }

    # =========================================================================
    # Parallel SDK Sessions Implementation
    # =========================================================================
    # This replaces the broken Task tool subagent approach.
    # Each specialist runs as its own SDK session in parallel via asyncio.gather()
    # See: https://github.com/anthropics/claude-code/issues/8697

    def _build_specialist_prompt(
        self,
        config: SpecialistConfig,
        context: PRContext,
        project_root: Path,
    ) -> str:
        """Build the full prompt for a specialist agent.

        Args:
            config: Specialist configuration
            context: PR context with files and patches
            project_root: Working directory for the agent

        Returns:
            Full system prompt with context injected
        """
        # Load base prompt from file
        base_prompt = self._load_prompt(config.prompt_file)
        if not base_prompt:
            base_prompt = f"You are a {config.name} specialist for PR review."

        # Inject working directory using the existing helper
        with_working_dir = create_working_dir_injector(project_root)
        prompt_with_cwd = with_working_dir(
            base_prompt,
            f"You are a {config.name} specialist. Find {config.description}.",
        )

        # Build file list
        files_list = []
        for file in context.changed_files:
            files_list.append(
                f"- `{file.path}` (+{file.additions}/-{file.deletions}) - {file.status}"
            )

        # Build diff content (limited to avoid context overflow)
        patches = []
        MAX_DIFF_CHARS = 150_000  # Smaller limit per specialist

        for file in context.changed_files:
            if file.patch:
                patches.append(f"\n### File: {file.path}\n{file.patch}")

        diff_content = "\n".join(patches)
        if len(diff_content) > MAX_DIFF_CHARS:
            diff_content = diff_content[:MAX_DIFF_CHARS] + "\n\n... (diff truncated)"

        # Compose full prompt with PR context
        pr_context = f"""
## PR Context

**PR #{context.pr_number}**: {context.title}

**Description:**
{context.description or "(No description provided)"}

### Changed Files ({len(context.changed_files)} files, +{context.total_additions}/-{context.total_deletions})
{chr(10).join(files_list)}

### Diff
{diff_content}

## Your Task

Analyze this PR for {config.description}.
Use the Read, Grep, and Glob tools to explore the codebase as needed.
Report findings with specific file paths, line numbers, and code evidence.
"""

        return prompt_with_cwd + pr_context

    async def _run_specialist_session(
        self,
        config: SpecialistConfig,
        context: PRContext,
        project_root: Path,
        model: str,
        thinking_budget: int | None,
    ) -> tuple[str, list[PRReviewFinding]]:
        """Run a single specialist as its own SDK session.

        Args:
            config: Specialist configuration
            context: PR context
            project_root: Working directory
            model: Model to use
            thinking_budget: Max thinking tokens

        Returns:
            Tuple of (specialist_name, findings)
        """
        safe_print(
            f"[Specialist:{config.name}] Starting analysis...",
            flush=True,
        )

        # Build the specialist prompt with PR context
        prompt = self._build_specialist_prompt(config, context, project_root)

        try:
            # Create SDK client for this specialist
            # Note: Agent type uses the generic "pr_reviewer" since individual
            # specialist types aren't registered in AGENT_CONFIGS. The specialist-specific
            # system prompt handles differentiation.
            # Get betas from model shorthand (before resolution to full ID)
            betas = get_model_betas(self.config.model or "sonnet")
            thinking_kwargs = get_thinking_kwargs_for_model(
                model, self.config.thinking_level or "medium"
            )
            client = create_client(
                project_dir=project_root,
                spec_dir=self.github_dir,
                model=model,
                agent_type="pr_reviewer",
                betas=betas,
                fast_mode=self.config.fast_mode,
                output_format={
                    "type": "json_schema",
                    "schema": SpecialistResponse.model_json_schema(),
                },
                **thinking_kwargs,
            )

            async with client:
                await client.query(prompt)

                # Process SDK stream
                stream_result = await process_sdk_stream(
                    client=client,
                    context_name=f"Specialist:{config.name}",
                    model=model,
                    system_prompt=prompt,
                    agent_definitions={},  # No subagents for specialists
                )

                error = stream_result.get("error")
                if error:
                    logger.error(
                        f"[Specialist:{config.name}] SDK stream failed: {error}"
                    )
                    safe_print(
                        f"[Specialist:{config.name}] Analysis failed: {error}",
                        flush=True,
                    )
                    return (config.name, [])

                # Parse structured output
                structured_output = stream_result.get("structured_output")
                findings = self._parse_specialist_output(
                    config.name, structured_output, stream_result.get("result_text", "")
                )

                safe_print(
                    f"[Specialist:{config.name}] Complete: {len(findings)} findings",
                    flush=True,
                )

                return (config.name, findings)

        except Exception as e:
            logger.error(
                f"[Specialist:{config.name}] Session failed: {e}",
                exc_info=True,
            )
            safe_print(
                f"[Specialist:{config.name}] Error: {e}",
                flush=True,
            )
            return (config.name, [])

    def _parse_specialist_output(
        self,
        specialist_name: str,
        structured_output: dict[str, Any] | None,
        result_text: str,
    ) -> list[PRReviewFinding]:
        """Parse findings from specialist output.

        Args:
            specialist_name: Name of the specialist
            structured_output: Structured JSON output if available
            result_text: Raw text output as fallback

        Returns:
            List of PRReviewFinding objects
        """
        findings = []

        if structured_output:
            try:
                result = SpecialistResponse.model_validate(structured_output)

                for f in result.findings:
                    finding_id = hashlib.md5(
                        f"{f.file}:{f.line}:{f.title}".encode(),
                        usedforsecurity=False,
                    ).hexdigest()[:12]

                    category = map_category(f.category)

                    try:
                        severity = ReviewSeverity(f.severity.lower())
                    except ValueError:
                        severity = ReviewSeverity.MEDIUM

                    finding = PRReviewFinding(
                        id=finding_id,
                        file=f.file,
                        line=f.line,
                        end_line=f.end_line,
                        title=f.title,
                        description=f.description,
                        category=category,
                        severity=severity,
                        suggested_fix=f.suggested_fix or "",
                        evidence=f.evidence,
                        source_agents=[specialist_name],
                        is_impact_finding=f.is_impact_finding,
                    )
                    findings.append(finding)

                logger.info(
                    f"[Specialist:{specialist_name}] Parsed {len(findings)} findings from structured output"
                )

            except Exception as e:
                logger.error(
                    f"[Specialist:{specialist_name}] Failed to parse structured output: {e}"
                )
                # Attempt to extract findings from raw dict before falling to text parsing
                findings = self._extract_specialist_partial_data(
                    specialist_name, structured_output
                )
                if findings:
                    logger.info(
                        f"[Specialist:{specialist_name}] Recovered {len(findings)} findings from partial extraction"
                    )

        if not findings and result_text:
            # Fallback to text parsing
            findings = self._parse_text_output(result_text)
            for f in findings:
                f.source_agents = [specialist_name]

        return findings

    def _extract_specialist_partial_data(
        self,
        specialist_name: str,
        data: dict[str, Any],
    ) -> list[PRReviewFinding]:
        """Extract findings from raw specialist dict when Pydantic validation fails.

        Defensively extracts each finding individually so partial results are preserved
        even if some findings have validation issues.
        """
        findings = []
        raw_findings = data.get("findings", [])
        if not isinstance(raw_findings, list):
            return findings

        for f in raw_findings:
            if not isinstance(f, dict):
                continue
            try:
                file_path = f.get("file", "unknown")
                line = f.get("line", 0) or 0
                title = f.get("title", "Unknown issue")

                finding_id = hashlib.md5(
                    f"{file_path}:{line}:{title}".encode(),
                    usedforsecurity=False,
                ).hexdigest()[:12]

                category = map_category(f.get("category", "quality"))

                try:
                    severity = ReviewSeverity(str(f.get("severity", "medium")).lower())
                except ValueError:
                    severity = ReviewSeverity.MEDIUM

                finding = PRReviewFinding(
                    id=finding_id,
                    file=file_path,
                    line=line,
                    end_line=f.get("end_line"),
                    title=title,
                    description=f.get("description", ""),
                    category=category,
                    severity=severity,
                    suggested_fix=f.get("suggested_fix", ""),
                    evidence=f.get("evidence"),
                    source_agents=[specialist_name],
                    is_impact_finding=bool(f.get("is_impact_finding", False)),
                )
                findings.append(finding)
            except Exception as e:
                logger.debug(
                    f"[Specialist:{specialist_name}] Skipping malformed finding: {e}"
                )

        return findings

    async def _run_parallel_specialists(
        self,
        context: PRContext,
        project_root: Path,
        model: str,
        thinking_budget: int | None,
    ) -> tuple[list[PRReviewFinding], list[str]]:
        """Run all specialists in parallel and collect findings.

        Args:
            context: PR context
            project_root: Working directory
            model: Model to use
            thinking_budget: Max thinking tokens

        Returns:
            Tuple of (all_findings, agents_invoked)
        """
        safe_print(
            f"[ParallelOrchestrator] Launching {len(SPECIALIST_CONFIGS)} specialists in parallel...",
            flush=True,
        )

        # Create tasks for all specialists
        tasks = [
            self._run_specialist_session(
                config=config,
                context=context,
                project_root=project_root,
                model=model,
                thinking_budget=thinking_budget,
            )
            for config in SPECIALIST_CONFIGS
        ]

        # Run all specialists in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Collect findings and track which agents ran
        all_findings: list[PRReviewFinding] = []
        agents_invoked: list[str] = []

        for result in results:
            if isinstance(result, Exception):
                logger.error(f"[ParallelOrchestrator] Specialist task failed: {result}")
                continue

            specialist_name, findings = result
            agents_invoked.append(specialist_name)
            all_findings.extend(findings)

        safe_print(
            f"[ParallelOrchestrator] All specialists complete. "
            f"Total findings: {len(all_findings)}",
            flush=True,
        )

        return (all_findings, agents_invoked)

    def _build_orchestrator_prompt(self, context: PRContext) -> str:
        """Build full prompt for orchestrator with PR context."""
        # Load orchestrator prompt
        base_prompt = self._load_prompt("pr_parallel_orchestrator.md")
        if not base_prompt:
            base_prompt = "You are a PR reviewer. Analyze and delegate to specialists."

        # Build file list
        files_list = []
        for file in context.changed_files:
            files_list.append(
                f"- `{file.path}` (+{file.additions}/-{file.deletions}) - {file.status}"
            )

        # Build composite diff
        patches = []
        MAX_DIFF_CHARS = 200_000

        for file in context.changed_files:
            if file.patch:
                patches.append(f"\n### File: {file.path}\n{file.patch}")

        diff_content = "\n".join(patches)

        if len(diff_content) > MAX_DIFF_CHARS:
            diff_content = diff_content[:MAX_DIFF_CHARS] + "\n\n... (diff truncated)"

        # Build AI comments context if present (with timestamps for timeline awareness)
        ai_comments_section = ""
        if context.ai_bot_comments:
            ai_comments_list = []
            for comment in context.ai_bot_comments[:20]:
                ai_comments_list.append(
                    f"- **{comment.tool_name}** ({comment.created_at}) on {comment.file or 'general'}: "
                    f"{comment.body[:200]}..."
                )
            ai_comments_section = f"""
### AI Review Comments (need triage)
Found {len(context.ai_bot_comments)} comments from AI tools.
**IMPORTANT: Check timestamps! If a later commit fixed an AI-flagged issue, use ADDRESSED verdict (not FALSE_POSITIVE).**

{chr(10).join(ai_comments_list)}
"""

        # Build commits timeline section (important for AI triage)
        commits_section = ""
        if context.commits:
            commits_list = []
            for commit in context.commits:
                sha = commit.get("oid", "")[:8]
                message = commit.get("messageHeadline", "")
                committed_at = commit.get("committedDate", "")
                commits_list.append(f"- `{sha}` ({committed_at}): {message}")
            commits_section = f"""
### Commit Timeline
{chr(10).join(commits_list)}
"""

        # Removed: Related files and import graph sections
        # LLM agents now discover relevant files themselves via Read, Grep, Glob tools
        related_files_section = ""
        import_graph_section = ""

        pr_context = f"""
---

## PR Context for Review

**PR Number:** {context.pr_number}
**Title:** {context.title}
**Author:** {context.author}
**Base:** {context.base_branch} ← **Head:** {context.head_branch}
**Files Changed:** {len(context.changed_files)} files
**Total Changes:** +{context.total_additions}/-{context.total_deletions} lines

### Description
{context.description}

### All Changed Files
{chr(10).join(files_list)}
{related_files_section}{import_graph_section}{commits_section}{ai_comments_section}
### Code Changes
```diff
{diff_content}
```

---

Now analyze this PR and delegate to the appropriate specialist agents.
Remember: YOU decide which agents to invoke based on YOUR analysis.
The SDK will run invoked agents in parallel automatically.
"""

        return base_prompt + pr_context

    def _create_sdk_client(
        self, project_root: Path, model: str, thinking_budget: int | None
    ):
        """Create SDK client with subagents and configuration.

        Args:
            project_root: Root directory of the project
            model: Model to use for orchestrator
            thinking_budget: Max thinking tokens budget

        Returns:
            Configured SDK client instance
        """
        # Get betas from model shorthand (before resolution to full ID)
        betas = get_model_betas(self.config.model or "sonnet")
        thinking_kwargs = get_thinking_kwargs_for_model(
            model, self.config.thinking_level or "medium"
        )
        return create_client(
            project_dir=project_root,
            spec_dir=self.github_dir,
            model=model,
            agent_type="pr_orchestrator_parallel",
            betas=betas,
            fast_mode=self.config.fast_mode,
            agents=self._define_specialist_agents(project_root),
            output_format={
                "type": "json_schema",
                "schema": ParallelOrchestratorResponse.model_json_schema(),
            },
            **thinking_kwargs,
        )

    def _extract_structured_output(
        self, structured_output: dict[str, Any] | None, result_text: str
    ) -> tuple[list[PRReviewFinding], list[str]]:
        """Parse and extract findings from structured output or text fallback.

        Args:
            structured_output: Structured JSON output from agent
            result_text: Raw text output as fallback

        Returns:
            Tuple of (findings list, agents_invoked list)
        """
        agents_from_structured: list[str] = []

        if structured_output:
            findings, agents_from_structured = self._parse_structured_output(
                structured_output
            )
            if findings is None and result_text:
                findings = self._parse_text_output(result_text)
            elif findings is None:
                findings = []
        else:
            findings = self._parse_text_output(result_text)

        return findings, agents_from_structured

    def _log_agents_invoked(self, agents: list[str]) -> None:
        """Log invoked agents with clear formatting.

        Args:
            agents: List of agent names that were invoked
        """
        if agents:
            safe_print(
                f"[ParallelOrchestrator] Specialist agents invoked: {', '.join(agents)}",
                flush=True,
            )
            for agent in agents:
                safe_print(f"[Agent:{agent}] Analysis complete")

    def _log_findings_summary(self, findings: list[PRReviewFinding]) -> None:
        """Log findings summary for verification.

        Args:
            findings: List of findings to summarize
        """
        if findings:
            safe_print(
                f"[ParallelOrchestrator] Parsed {len(findings)} findings from structured output",
                flush=True,
            )
            safe_print("[ParallelOrchestrator] Findings summary:")
            for i, f in enumerate(findings, 1):
                safe_print(
                    f"  [{f.severity.value.upper()}] {i}. {f.title} ({f.file}:{f.line})",
                    flush=True,
                )

    def _create_finding_from_structured(self, finding_data: Any) -> PRReviewFinding:
        """Create a PRReviewFinding from structured output data.

        Args:
            finding_data: Finding data from structured output

        Returns:
            PRReviewFinding instance
        """
        finding_id = hashlib.md5(
            f"{finding_data.file}:{finding_data.line}:{finding_data.title}".encode(),
            usedforsecurity=False,
        ).hexdigest()[:12]

        category = map_category(finding_data.category)

        try:
            severity = ReviewSeverity(finding_data.severity.lower())
        except ValueError:
            severity = ReviewSeverity.MEDIUM

        # Extract evidence from verification.code_examined if available
        evidence = None
        if hasattr(finding_data, "verification") and finding_data.verification:
            verification = finding_data.verification
            if hasattr(verification, "code_examined") and verification.code_examined:
                evidence = verification.code_examined
        # Fallback to evidence field if present (e.g. from dict-based parsing)
        if not evidence:
            evidence = getattr(finding_data, "evidence", None)

        # Extract end_line if present
        end_line = getattr(finding_data, "end_line", None)

        # Extract source_agents if present
        source_agents = getattr(finding_data, "source_agents", []) or []

        # Extract cross_validated if present
        cross_validated = getattr(finding_data, "cross_validated", False)

        # Extract is_impact_finding if present (for findings about callers/affected files)
        is_impact_finding = getattr(finding_data, "is_impact_finding", False)

        return PRReviewFinding(
            id=finding_id,
            file=finding_data.file,
            line=finding_data.line,
            end_line=end_line,
            title=finding_data.title,
            description=finding_data.description,
            category=category,
            severity=severity,
            suggested_fix=finding_data.suggested_fix or "",
            evidence=evidence,
            source_agents=source_agents,
            cross_validated=cross_validated,
            is_impact_finding=is_impact_finding,
        )

    async def _get_ci_status(self, pr_number: int) -> dict:
        """Fetch CI status for the PR.

        Args:
            pr_number: PR number

        Returns:
            Dict with passing, failing, pending, failed_checks, awaiting_approval
        """
        try:
            gh_client = GHClient(
                project_dir=self.project_dir,
                default_timeout=30.0,
                repo=self.config.repo,
            )
            return await gh_client.get_pr_checks_comprehensive(pr_number)
        except Exception as e:
            logger.warning(f"[PRReview] Failed to get CI status: {e}")
            return {
                "passing": 0,
                "failing": 0,
                "pending": 0,
                "failed_checks": [],
                "awaiting_approval": 0,
            }

    async def review(self, context: PRContext) -> PRReviewResult:
        """
        Main review entry point.

        Args:
            context: Full PR context with all files and patches

        Returns:
            PRReviewResult with findings and verdict
        """
        logger.info(
            f"[ParallelOrchestrator] Starting review for PR #{context.pr_number}"
        )

        # Clean up any stale worktrees from previous runs
        self._cleanup_stale_pr_worktrees()

        # Track worktree for cleanup
        worktree_path: Path | None = None

        try:
            self._report_progress(
                "orchestrating",
                35,
                "Parallel orchestrator analyzing PR...",
                pr_number=context.pr_number,
            )

            # Create temporary worktree at PR head commit for isolated review
            # This MUST happen BEFORE building the prompt so we can find related files
            # that exist in the PR but not in the current checkout
            head_sha = context.head_sha or context.head_branch

            if DEBUG_MODE:
                safe_print(
                    f"[PRReview] DEBUG: context.head_sha='{context.head_sha}'",
                    flush=True,
                )
                safe_print(
                    f"[PRReview] DEBUG: context.head_branch='{context.head_branch}'",
                    flush=True,
                )
                safe_print(f"[PRReview] DEBUG: resolved head_sha='{head_sha}'")

            # SECURITY: Validate the resolved head_sha (whether SHA or branch name)
            # This catches invalid refs early before subprocess calls
            if head_sha and not _validate_git_ref(head_sha):
                logger.warning(
                    f"[ParallelOrchestrator] Invalid git ref '{head_sha}', "
                    "using current checkout for safety"
                )
                head_sha = None

            if not head_sha:
                if DEBUG_MODE:
                    safe_print("[PRReview] DEBUG: No head_sha - using fallback")
                logger.warning(
                    "[ParallelOrchestrator] No head_sha available, using current checkout"
                )
                # Fallback to original behavior if no SHA available
                project_root = (
                    self.project_dir.parent.parent
                    if self.project_dir.name == "backend"
                    else self.project_dir
                )
            else:
                if DEBUG_MODE:
                    safe_print(
                        f"[PRReview] DEBUG: Creating worktree for head_sha={head_sha}",
                        flush=True,
                    )
                try:
                    worktree_path = self._create_pr_worktree(
                        head_sha, context.pr_number
                    )
                    project_root = worktree_path
                    # Count files in worktree to give user visibility (with limit to avoid slowdown)
                    MAX_FILE_COUNT = 10000
                    try:
                        file_count = 0
                        for f in worktree_path.rglob("*"):
                            if f.is_file() and ".git" not in f.parts:
                                file_count += 1
                                if file_count >= MAX_FILE_COUNT:
                                    break
                    except (OSError, PermissionError):
                        file_count = 0
                    file_count_str = (
                        f"{file_count:,}+"
                        if file_count >= MAX_FILE_COUNT
                        else f"{file_count:,}"
                    )
                    # Always log worktree creation with file count (not gated by DEBUG_MODE)
                    safe_print(
                        f"[PRReview] Created temporary worktree: {worktree_path.name} ({file_count_str} files)",
                        flush=True,
                    )
                    safe_print(
                        f"[PRReview] Worktree contains PR branch HEAD: {head_sha[:8]}",
                        flush=True,
                    )
                except (RuntimeError, ValueError) as e:
                    if DEBUG_MODE:
                        safe_print(
                            f"[PRReview] DEBUG: Worktree creation FAILED: {e}",
                            flush=True,
                        )
                    logger.warning(
                        f"[ParallelOrchestrator] Worktree creation failed, "
                        f"using current checkout: {e}"
                    )
                    # Fallback to original behavior if worktree creation fails
                    project_root = (
                        self.project_dir.parent.parent
                        if self.project_dir.name == "backend"
                        else self.project_dir
                    )

            # Removed: Related files rescanning
            # LLM agents now discover relevant files themselves via Read, Grep, Glob tools
            # No need to pre-scan the codebase programmatically

            # Use model and thinking level from config (user settings)
            # Resolve model shorthand via environment variable override if configured
            model_shorthand = self.config.model or "sonnet"
            model = resolve_model_id(model_shorthand)
            thinking_level = self.config.thinking_level or "medium"
            thinking_budget = get_thinking_budget(thinking_level)

            logger.info(
                f"[ParallelOrchestrator] Using model={model}, "
                f"thinking_level={thinking_level}, thinking_budget={thinking_budget}"
            )

            self._report_progress(
                "orchestrating",
                40,
                "Running specialist agents in parallel...",
                pr_number=context.pr_number,
            )

            # =================================================================
            # PARALLEL SDK SESSIONS APPROACH
            # =================================================================
            # Instead of using broken Task tool subagents, we spawn each
            # specialist as its own SDK session and run them in parallel.
            # See: https://github.com/anthropics/claude-code/issues/8697
            #
            # This gives us:
            # - True parallel execution via asyncio.gather()
            # - Full control over each specialist's tools and prompts
            # - No dependency on broken CLI features
            # =================================================================

            # Run all specialists in parallel
            findings, agents_invoked = await self._run_parallel_specialists(
                context=context,
                project_root=project_root,
                model=model,
                thinking_budget=thinking_budget,
            )

            # Log results
            logger.info(
                f"[ParallelOrchestrator] Parallel specialists complete: "
                f"{len(findings)} findings from {len(agents_invoked)} agents"
            )

            self._report_progress(
                "finalizing",
                50,
                "Synthesizing findings...",
                pr_number=context.pr_number,
            )

            # Log completion with agent info
            safe_print(
                f"[ParallelOrchestrator] Complete. Agents invoked: {agents_invoked}",
                flush=True,
            )

            # Deduplicate findings
            unique_findings = self._deduplicate_findings(findings)

            # Cross-validate findings: boost confidence when multiple agents agree
            cross_validated_findings, agent_agreement = self._cross_validate_findings(
                unique_findings
            )

            # Log cross-validation results
            logger.info(
                f"[PRReview] Cross-validation: {len(agent_agreement.agreed_findings)} multi-agent, "
                f"{len(cross_validated_findings) - len(agent_agreement.agreed_findings)} single-agent"
            )

            # Log full agreement details at debug level for monitoring
            logger.debug(
                f"[PRReview] AgentAgreement: {agent_agreement.model_dump_json()}"
            )

            # Stage 1: Line number verification (cheap pre-filter)
            # Catches hallucinated line numbers without AI cost
            verified_findings, line_rejected = self._verify_line_numbers(
                cross_validated_findings,
                project_root,
            )

            logger.info(
                f"[PRReview] Line verification: {len(line_rejected)} rejected, "
                f"{len(verified_findings)} passed"
            )

            # Stage 2: AI validation (if findings remain)
            # Finding-validator re-reads code with fresh eyes
            if verified_findings:
                validated_by_ai = await self._validate_findings(
                    verified_findings, context, project_root
                )
            else:
                validated_by_ai = []

            logger.info(
                f"[PRReview] After validation: {len(validated_by_ai)} findings "
                f"(from {len(cross_validated_findings)} cross-validated)"
            )

            # Apply programmatic evidence and scope filters
            # These catch edge cases that slip through the finding-validator
            changed_file_paths = [f.path for f in context.changed_files]
            validated_findings = []
            filtered_findings = []

            for finding in validated_by_ai:
                # Check scope (evidence now enforced by schema)
                scope_valid, scope_reason = _is_finding_in_scope(
                    finding, changed_file_paths
                )
                if not scope_valid:
                    logger.info(
                        f"[PRReview] Filtered finding {finding.id}: {scope_reason}"
                    )
                    filtered_findings.append((finding, scope_reason))
                    continue

                validated_findings.append(finding)

            logger.info(
                f"[PRReview] Findings: {len(validated_findings)} valid, "
                f"{len(filtered_findings)} filtered"
            )

            # Separate active findings (drive verdict) from dismissed (shown in UI only)
            active_findings = []
            dismissed_findings = []
            for f in validated_findings:
                if f.validation_status == "dismissed_false_positive":
                    dismissed_findings.append(f)
                else:
                    active_findings.append(f)

            safe_print(
                f"[ParallelOrchestrator] Final: {len(active_findings)} active, "
                f"{len(dismissed_findings)} disputed by validator",
                flush=True,
            )
            logger.info(
                f"[PRReview] Final findings: {len(active_findings)} active, "
                f"{len(dismissed_findings)} disputed"
            )

            # All findings (active + dismissed) go in the result for UI display
            all_review_findings = validated_findings
            logger.info(
                f"[ParallelOrchestrator] Review complete: {len(all_review_findings)} findings "
                f"({len(active_findings)} active, {len(dismissed_findings)} disputed)"
            )

            # Fetch CI status for verdict consideration
            ci_status = await self._get_ci_status(context.pr_number)
            logger.info(
                f"[PRReview] CI status: {ci_status.get('passing', 0)} passing, "
                f"{ci_status.get('failing', 0)} failing, {ci_status.get('pending', 0)} pending"
            )

            # Generate verdict from ACTIVE findings only (dismissed don't affect verdict)
            verdict, verdict_reasoning, blockers = self._generate_verdict(
                active_findings,
                has_merge_conflicts=context.has_merge_conflicts,
                merge_state_status=context.merge_state_status,
                ci_status=ci_status,
            )

            # Generate summary
            summary = self._generate_summary(
                verdict=verdict,
                verdict_reasoning=verdict_reasoning,
                blockers=blockers,
                findings=all_review_findings,
                agents_invoked=agents_invoked,
            )

            # Map verdict to overall_status
            if verdict == MergeVerdict.BLOCKED:
                overall_status = "request_changes"
            elif verdict == MergeVerdict.NEEDS_REVISION:
                overall_status = "request_changes"
            elif verdict == MergeVerdict.MERGE_WITH_CHANGES:
                overall_status = "comment"
            else:
                overall_status = "approve"

            # Extract HEAD SHA from commits for follow-up review tracking
            head_sha = None
            if context.commits:
                latest_commit = context.commits[-1]
                head_sha = latest_commit.get("oid") or latest_commit.get("sha")

            # Get file blob SHAs for rebase-resistant follow-up reviews
            # Blob SHAs persist across rebases - same content = same blob SHA
            file_blobs: dict[str, str] = {}
            try:
                gh_client = GHClient(
                    project_dir=self.project_dir,
                    default_timeout=30.0,
                    repo=self.config.repo,
                )
                pr_files = await gh_client.get_pr_files(context.pr_number)
                for file in pr_files:
                    filename = file.get("filename", "")
                    blob_sha = file.get("sha", "")
                    if filename and blob_sha:
                        file_blobs[filename] = blob_sha
                logger.info(
                    f"Captured {len(file_blobs)} file blob SHAs for follow-up tracking"
                )
            except Exception as e:
                logger.warning(f"Could not capture file blobs: {e}")

            result = PRReviewResult(
                pr_number=context.pr_number,
                repo=self.config.repo,
                success=True,
                findings=all_review_findings,
                summary=summary,
                overall_status=overall_status,
                verdict=verdict,
                verdict_reasoning=verdict_reasoning,
                blockers=blockers,
                reviewed_commit_sha=head_sha,
                reviewed_file_blobs=file_blobs,
            )

            self._report_progress(
                "analyzed",
                60,
                "Parallel analysis complete",
                pr_number=context.pr_number,
            )

            return result

        except Exception as e:
            logger.error(f"[ParallelOrchestrator] Review failed: {e}", exc_info=True)
            return PRReviewResult(
                pr_number=context.pr_number,
                repo=self.config.repo,
                success=False,
                error=str(e),
            )
        finally:
            # Always cleanup worktree, even on error
            if worktree_path:
                self._cleanup_pr_worktree(worktree_path)

    def _parse_structured_output(
        self, structured_output: dict[str, Any]
    ) -> tuple[list[PRReviewFinding] | None, list[str]]:
        """Parse findings and agents from SDK structured output.

        Returns:
            Tuple of (findings list or None if parsing failed, agents list)
        """
        findings = []
        agents_from_output: list[str] = []

        try:
            result = ParallelOrchestratorResponse.model_validate(structured_output)
            agents_from_output = result.agents_invoked or []

            logger.info(
                f"[ParallelOrchestrator] Structured output: verdict={result.verdict}, "
                f"{len(result.findings)} findings, agents={agents_from_output}"
            )

            # Log agents invoked with clear formatting
            self._log_agents_invoked(agents_from_output)

            # Convert structured findings to PRReviewFinding objects
            for f in result.findings:
                finding = self._create_finding_from_structured(f)
                findings.append(finding)

            # Log findings summary for verification
            self._log_findings_summary(findings)

        except Exception as e:
            logger.error(
                f"[ParallelOrchestrator] Structured output parsing failed: {e}"
            )
            return None, agents_from_output

        return findings, agents_from_output

    def _extract_json_from_text(self, output: str) -> dict[str, Any] | None:
        """Extract JSON object from text output.

        Args:
            output: Text output to parse

        Returns:
            Parsed JSON dict or None if not found
        """
        import json
        import re

        # Try to find JSON in code blocks
        code_block_pattern = r"```(?:json)?\s*(\{[\s\S]*?\})\s*```"
        code_block_match = re.search(code_block_pattern, output)

        if code_block_match:
            json_str = code_block_match.group(1)
            return json.loads(json_str)

        # Try to find raw JSON object
        start = output.find("{")
        if start == -1:
            return None

        brace_count = 0
        end = -1
        for i in range(start, len(output)):
            if output[i] == "{":
                brace_count += 1
            elif output[i] == "}":
                brace_count -= 1
                if brace_count == 0:
                    end = i
                    break

        if end != -1:
            json_str = output[start : end + 1]
            return json.loads(json_str)

        return None

    def _create_finding_from_dict(self, f_data: dict[str, Any]) -> PRReviewFinding:
        """Create a PRReviewFinding from dictionary data.

        Args:
            f_data: Finding data as dictionary

        Returns:
            PRReviewFinding instance
        """
        finding_id = hashlib.md5(
            f"{f_data.get('file', 'unknown')}:{f_data.get('line', 0)}:{f_data.get('title', 'Untitled')}".encode(),
            usedforsecurity=False,
        ).hexdigest()[:12]

        category = map_category(f_data.get("category", "quality"))

        try:
            severity = ReviewSeverity(f_data.get("severity", "medium").lower())
        except ValueError:
            severity = ReviewSeverity.MEDIUM

        return PRReviewFinding(
            id=finding_id,
            file=f_data.get("file", "unknown"),
            line=f_data.get("line", 0),
            title=f_data.get("title", "Untitled"),
            description=f_data.get("description", ""),
            category=category,
            severity=severity,
            suggested_fix=f_data.get("suggested_fix", ""),
            evidence=f_data.get("evidence"),
        )

    def _parse_text_output(self, output: str) -> list[PRReviewFinding]:
        """Parse findings from text output (fallback)."""
        findings = []

        try:
            # Extract JSON from text
            data = self._extract_json_from_text(output)
            if not data:
                return findings

            # Get findings array from JSON
            findings_data = data.get("findings", [])

            # Convert each finding dict to PRReviewFinding
            for f_data in findings_data:
                finding = self._create_finding_from_dict(f_data)
                findings.append(finding)

        except Exception as e:
            logger.error(f"[ParallelOrchestrator] Text parsing failed: {e}")

        return findings

    def _normalize_confidence(self, value: int | float) -> float:
        """Normalize confidence to 0.0-1.0 range."""
        if value > 1:
            return value / 100.0
        return float(value)

    def _deduplicate_findings(
        self, findings: list[PRReviewFinding]
    ) -> list[PRReviewFinding]:
        """Remove duplicate findings."""
        seen = set()
        unique = []

        for f in findings:
            key = (f.file, f.line, f.title.lower().strip())
            if key not in seen:
                seen.add(key)
                unique.append(f)

        return unique

    def _cross_validate_findings(
        self, findings: list[PRReviewFinding]
    ) -> tuple[list[PRReviewFinding], AgentAgreement]:
        """
        Cross-validate findings to boost confidence when multiple agents agree.

        Groups findings by location key (file, line, category) and:
        - For groups with 2+ findings: merges into one, boosts confidence by 0.15,
          sets cross_validated=True, collects all source agents
        - For single-agent findings: keeps as-is, ensures source_agents is populated

        Args:
            findings: List of deduplicated findings to cross-validate

        Returns:
            Tuple of (cross-validated findings, AgentAgreement tracking object)
        """
        # Confidence boost for multi-agent agreement
        CONFIDENCE_BOOST = 0.15
        MAX_CONFIDENCE = 0.95

        # Group findings by location key: (file, line, category)
        groups: dict[tuple, list[PRReviewFinding]] = defaultdict(list)
        for finding in findings:
            key = (finding.file, finding.line, finding.category.value)
            groups[key].append(finding)

        validated_findings: list[PRReviewFinding] = []
        agreed_finding_ids: list[str] = []

        for key, group in groups.items():
            if len(group) >= 2:
                # Multi-agent agreement: merge findings
                # Sort by severity to keep highest severity finding
                severity_order = {
                    ReviewSeverity.CRITICAL: 0,
                    ReviewSeverity.HIGH: 1,
                    ReviewSeverity.MEDIUM: 2,
                    ReviewSeverity.LOW: 3,
                }
                group.sort(key=lambda f: severity_order.get(f.severity, 99))
                primary = group[0]

                # Collect all source agents from group
                all_agents: list[str] = []
                for f in group:
                    if f.source_agents:
                        for agent in f.source_agents:
                            if agent not in all_agents:
                                all_agents.append(agent)

                # Combine evidence from all findings
                all_evidence: list[str] = []
                for f in group:
                    if f.evidence and f.evidence.strip():
                        all_evidence.append(f.evidence.strip())
                combined_evidence = (
                    "\n---\n".join(all_evidence) if all_evidence else None
                )

                # Combine descriptions
                all_descriptions: list[str] = [primary.description]
                for f in group[1:]:
                    if f.description and f.description not in all_descriptions:
                        all_descriptions.append(f.description)
                combined_description = " | ".join(all_descriptions)

                # Boost confidence (capped at MAX_CONFIDENCE)
                base_confidence = primary.confidence or 0.5
                boosted_confidence = min(
                    base_confidence + CONFIDENCE_BOOST, MAX_CONFIDENCE
                )

                # Update the primary finding with merged data
                primary.confidence = boosted_confidence
                primary.cross_validated = True
                primary.source_agents = all_agents
                primary.evidence = combined_evidence
                primary.description = combined_description

                validated_findings.append(primary)
                agreed_finding_ids.append(primary.id)

                logger.debug(
                    f"[PRReview] Cross-validated finding {primary.id}: "
                    f"merged {len(group)} findings, agents={all_agents}, "
                    f"confidence={boosted_confidence:.2f}"
                )
            else:
                # Single-agent finding: keep as-is
                finding = group[0]

                # Ensure source_agents is populated (use empty list if not set)
                if not finding.source_agents:
                    finding.source_agents = []

                validated_findings.append(finding)

        # Create agent agreement tracking object
        agent_agreement = AgentAgreement(
            agreed_findings=agreed_finding_ids,
            conflicting_findings=[],  # Not implemented yet - reserved for future
            resolution_notes=None,
        )

        return validated_findings, agent_agreement

    def _verify_line_numbers(
        self,
        findings: list[PRReviewFinding],
        worktree_path: Path,
    ) -> tuple[list[PRReviewFinding], list[tuple[PRReviewFinding, str]]]:
        """
        Pre-filter findings with obviously invalid line numbers.

        Catches hallucinated line numbers without AI cost by checking that
        the line number doesn't exceed the file length.

        Args:
            findings: Findings from specialist agents
            worktree_path: Path to PR worktree (or project root)

        Returns:
            Tuple of (valid_findings, rejected_findings_with_reasons)
        """
        valid = []
        rejected: list[tuple[PRReviewFinding, str]] = []

        # Cache file line counts to avoid re-reading
        line_counts: dict[str, int | float] = {}

        for finding in findings:
            file_path = worktree_path / finding.file

            # Check file exists
            if not file_path.exists():
                rejected.append((finding, f"File does not exist: {finding.file}"))
                logger.info(
                    f"[PRReview] Rejected {finding.id}: File does not exist: {finding.file}"
                )
                continue

            # Get line count (cached)
            if finding.file not in line_counts:
                try:
                    content = file_path.read_text(encoding="utf-8", errors="replace")
                    line_counts[finding.file] = len(content.splitlines())
                except Exception as e:
                    logger.warning(
                        f"[PRReview] Could not read file {finding.file}: {e}"
                    )
                    # Allow finding on read error (conservative - don't block on read issues)
                    line_counts[finding.file] = float("inf")

            max_line = line_counts[finding.file]

            # Check line number is valid
            if finding.line > max_line:
                reason = (
                    f"Line {finding.line} exceeds file length ({int(max_line)} lines)"
                )
                rejected.append((finding, reason))
                logger.info(f"[PRReview] Rejected {finding.id}: {reason}")
                continue

            valid.append(finding)

        # Log summary
        logger.info(
            f"[PRReview] Line verification: {len(rejected)} findings rejected, "
            f"{len(valid)} passed"
        )

        return valid, rejected

    async def _validate_findings(
        self,
        findings: list[PRReviewFinding],
        context: PRContext,
        worktree_path: Path,
    ) -> list[PRReviewFinding]:
        """
        Validate findings using the finding-validator agent.

        Invokes the finding-validator agent to re-read code with fresh eyes
        and determine if findings are real issues or false positives.

        Args:
            findings: Pre-filtered findings from specialist agents
            context: PR context with changed files
            worktree_path: Path to PR worktree for code reading

        Returns:
            List of validated findings (only confirmed_valid and needs_human_review)
        """
        import json

        if not findings:
            return []

        # Retry configuration for API errors
        MAX_VALIDATION_RETRIES = 2
        VALIDATOR_MAX_MESSAGES = 200  # Lower limit for validator (simpler task)

        # Build validation prompt with all findings
        findings_json = []
        for f in findings:
            findings_json.append(
                {
                    "id": f.id,
                    "file": f.file,
                    "line": f.line,
                    "title": f.title,
                    "description": f.description,
                    "severity": f.severity.value,
                    "category": f.category.value,
                    "evidence": f.evidence,
                }
            )

        changed_files_str = ", ".join(cf.path for cf in context.changed_files)
        prompt = f"""
## Findings to Validate

The following findings were reported by specialist agents. Your job is to validate each one.

**Changed files in this PR:** {changed_files_str}

**Findings:**
```json
{json.dumps(findings_json, indent=2)}
```

For EACH finding above:
1. Read the actual code at the file/line location
2. Determine if the issue actually exists
3. Return validation status with code evidence
"""

        # Resolve model for validator
        model_shorthand = self.config.model or "sonnet"
        model = resolve_model_id(model_shorthand)

        # Retry loop for transient API errors
        last_error = None
        for attempt in range(MAX_VALIDATION_RETRIES + 1):
            if attempt > 0:
                logger.info(
                    f"[PRReview] Validation retry {attempt}/{MAX_VALIDATION_RETRIES}"
                )
                safe_print(
                    f"[FindingValidator] Retry attempt {attempt}/{MAX_VALIDATION_RETRIES}"
                )

            # Create validator client (inherits worktree filesystem access)
            try:
                # Get betas from model shorthand (before resolution to full ID)
                betas = get_model_betas(self.config.model or "sonnet")
                thinking_kwargs = get_thinking_kwargs_for_model(model, "medium")
                validator_client = create_client(
                    project_dir=worktree_path,
                    spec_dir=self.github_dir,
                    model=model,
                    agent_type="pr_finding_validator",
                    betas=betas,
                    fast_mode=self.config.fast_mode,
                    output_format={
                        "type": "json_schema",
                        "schema": FindingValidationResponse.model_json_schema(),
                    },
                    **thinking_kwargs,
                )
            except Exception as e:
                logger.error(f"[PRReview] Failed to create validator client: {e}")
                last_error = e
                continue  # Try again

            # Run validation
            try:
                async with validator_client:
                    await validator_client.query(prompt)

                    stream_result = await process_sdk_stream(
                        client=validator_client,
                        context_name="FindingValidator",
                        model=model,
                        system_prompt=prompt,
                        max_messages=VALIDATOR_MAX_MESSAGES,
                    )

                    error = stream_result.get("error")
                    if error:
                        # Check for specific error types that warrant retry
                        error_str = str(error).lower()
                        is_retryable = (
                            "400" in error_str
                            or "concurrency" in error_str
                            or "circuit breaker" in error_str
                            or "tool_use" in error_str
                            or "structured_output" in error_str
                        )

                        if is_retryable and attempt < MAX_VALIDATION_RETRIES:
                            logger.warning(
                                f"[PRReview] Retryable validation error: {error}"
                            )
                            last_error = Exception(error)
                            continue  # Retry

                        logger.error(f"[PRReview] Validation failed: {error}")
                        # Fail-safe: return original findings
                        return findings

                    structured_output = stream_result.get("structured_output")

                    # Success - break out of retry loop
                    if structured_output:
                        break

            except Exception as e:
                # Part of retry loop structure - handles retryable errors
                error_str = str(e).lower()
                is_retryable = (
                    "400" in error_str
                    or "concurrency" in error_str
                    or "rate" in error_str
                )

                if is_retryable and attempt < MAX_VALIDATION_RETRIES:
                    logger.warning(f"[PRReview] Retryable stream error: {e}")
                    last_error = e
                    continue  # Retry

                logger.error(f"[PRReview] Validation stream error: {e}")
                # Fail-safe: return original findings
                return findings
        else:
            # All retries exhausted
            logger.error(
                f"[PRReview] Validation failed after {MAX_VALIDATION_RETRIES} retries. "
                f"Last error: {last_error}"
            )
            safe_print(
                f"[FindingValidator] ERROR: Validation failed after {MAX_VALIDATION_RETRIES} retries"
            )
            # Fail-safe: return original findings
            return findings

        if not structured_output:
            logger.warning(
                "[PRReview] No structured validation output, keeping original findings"
            )
            return findings

        # Parse validation results
        try:
            response = FindingValidationResponse.model_validate(structured_output)
        except Exception as e:
            logger.error(f"[PRReview] Failed to parse validation response: {e}")
            return findings

        # Build map of validation results
        validation_map = {v.finding_id: v for v in response.validations}

        # Filter findings based on validation
        validated_findings = []
        dismissed_count = 0
        needs_human_count = 0

        for finding in findings:
            validation = validation_map.get(finding.id)

            if not validation:
                # No validation result - keep finding (conservative)
                validated_findings.append(finding)
                continue

            if validation.validation_status == "confirmed_valid":
                # Add validation evidence to finding
                finding.validation_status = "confirmed_valid"
                finding.validation_evidence = validation.code_evidence
                finding.validation_explanation = validation.explanation
                validated_findings.append(finding)

            elif validation.validation_status == "dismissed_false_positive":
                # Protect cross-validated findings from dismissal —
                # if multiple specialists independently found the same issue,
                # a single validator should not override that consensus
                if finding.cross_validated:
                    finding.validation_status = "confirmed_valid"
                    finding.validation_evidence = validation.code_evidence
                    finding.validation_explanation = (
                        f"[Auto-kept: cross-validated by {len(finding.source_agents)} agents] "
                        f"{validation.explanation}"
                    )
                    validated_findings.append(finding)
                    safe_print(
                        f"[FindingValidator] Kept cross-validated finding '{finding.title}' "
                        f"despite dismissal (agents={finding.source_agents})",
                        flush=True,
                    )
                else:
                    # Keep finding but mark as dismissed (user can see it in UI)
                    finding.validation_status = "dismissed_false_positive"
                    finding.validation_evidence = validation.code_evidence
                    finding.validation_explanation = validation.explanation
                    validated_findings.append(finding)
                    dismissed_count += 1
                    safe_print(
                        f"[FindingValidator] Disputed '{finding.title}': "
                        f"{validation.explanation} (file={finding.file}:{finding.line})",
                        flush=True,
                    )
                    logger.info(
                        f"[PRReview] Disputed {finding.id}: "
                        f"{validation.explanation[:200]}"
                    )

            elif validation.validation_status == "needs_human_review":
                # Keep but flag
                finding.validation_status = "needs_human_review"
                finding.validation_evidence = validation.code_evidence
                finding.validation_explanation = validation.explanation
                finding.title = f"[NEEDS REVIEW] {finding.title}"
                validated_findings.append(finding)
                needs_human_count += 1

        logger.info(
            f"[PRReview] Validation complete: {len(validated_findings)} valid, "
            f"{dismissed_count} dismissed, {needs_human_count} need human review"
        )

        return validated_findings

    def _generate_verdict(
        self,
        findings: list[PRReviewFinding],
        has_merge_conflicts: bool = False,
        merge_state_status: str = "",
        ci_status: dict | None = None,
    ) -> tuple[MergeVerdict, str, list[str]]:
        """Generate merge verdict based on findings, merge conflict status, branch state, and CI."""
        blockers = []
        is_branch_behind = merge_state_status == "BEHIND"

        # Extract CI status
        ci_status = ci_status or {}
        ci_failing = ci_status.get("failing", 0)
        ci_pending = ci_status.get("pending", 0)
        ci_passing = ci_status.get("passing", 0)
        ci_awaiting = ci_status.get("awaiting_approval", 0)
        failed_checks = ci_status.get("failed_checks", [])

        # Build CI status string for reasoning
        ci_summary = ""
        if ci_failing > 0:
            ci_summary = f"CI: {ci_failing} failing ({', '.join(failed_checks[:3])})"
            if len(failed_checks) > 3:
                ci_summary += f" +{len(failed_checks) - 3} more"
        elif ci_awaiting > 0:
            ci_summary = f"CI: {ci_awaiting} workflow(s) awaiting approval"
        elif ci_pending > 0:
            ci_summary = f"CI: {ci_pending} check(s) pending"
        elif ci_passing > 0:
            ci_summary = f"CI: {ci_passing} check(s) passing"

        # CRITICAL: CI failures block merging (highest priority after merge conflicts)
        if ci_failing > 0:
            blockers.append(f"CI Failing: {', '.join(failed_checks)}")
        elif ci_awaiting > 0:
            blockers.append(
                f"CI Awaiting Approval: {ci_awaiting} workflow(s) need maintainer approval"
            )

        # CRITICAL: Merge conflicts block merging - check first
        if has_merge_conflicts:
            blockers.append(
                "Merge Conflicts: PR has conflicts with base branch that must be resolved"
            )
        # Branch behind base is a warning, not a hard blocker
        elif is_branch_behind:
            blockers.append(BRANCH_BEHIND_BLOCKER_MSG)

        critical = [f for f in findings if f.severity == ReviewSeverity.CRITICAL]
        high = [f for f in findings if f.severity == ReviewSeverity.HIGH]
        medium = [f for f in findings if f.severity == ReviewSeverity.MEDIUM]
        low = [f for f in findings if f.severity == ReviewSeverity.LOW]

        for f in critical:
            blockers.append(f"Critical: {f.title} ({f.file}:{f.line})")

        # Determine verdict and reasoning
        if ci_failing > 0:
            # Failing CI always blocks
            verdict = MergeVerdict.BLOCKED
            reasoning = f"BLOCKED: {ci_summary}. Fix CI before merge."
            if critical:
                reasoning += f" Also {len(critical)} critical code issue(s)."
            elif high or medium:
                reasoning += (
                    f" Also {len(high) + len(medium)} code issue(s) to address."
                )
        elif ci_awaiting > 0:
            # Awaiting approval blocks
            verdict = MergeVerdict.BLOCKED
            reasoning = f"BLOCKED: {ci_summary}. Maintainer must approve workflow runs for fork PRs."
        elif has_merge_conflicts:
            verdict = MergeVerdict.BLOCKED
            reasoning = (
                f"BLOCKED: PR has merge conflicts with base branch. "
                f"Resolve conflicts before merge. {ci_summary}"
            )
        elif critical:
            verdict = MergeVerdict.BLOCKED
            reasoning = f"BLOCKED: {len(critical)} critical code issue(s). {ci_summary}"
        elif ci_pending > 0:
            # Pending CI prevents ready-to-merge but doesn't block
            if high or medium:
                verdict = MergeVerdict.NEEDS_REVISION
                total = len(high) + len(medium)
                reasoning = f"NEEDS_REVISION: {total} code issue(s) + {ci_summary}"
            else:
                verdict = MergeVerdict.NEEDS_REVISION
                reasoning = f"NEEDS_REVISION: {ci_summary}. Wait for CI to complete."
        elif is_branch_behind:
            verdict = MergeVerdict.NEEDS_REVISION
            if high or medium:
                total = len(high) + len(medium)
                reasoning = (
                    f"NEEDS_REVISION: {BRANCH_BEHIND_REASONING} "
                    f"{total} code issue(s). {ci_summary}"
                )
            else:
                reasoning = f"NEEDS_REVISION: {BRANCH_BEHIND_REASONING} {ci_summary}"
            if low:
                reasoning += f" {len(low)} suggestion(s)."
        elif high or medium:
            verdict = MergeVerdict.NEEDS_REVISION
            total = len(high) + len(medium)
            reasoning = f"NEEDS_REVISION: {total} code issue(s) ({len(high)} high, {len(medium)} medium). {ci_summary}"
            if low:
                reasoning += f" {len(low)} suggestion(s)."
        elif low:
            verdict = MergeVerdict.READY_TO_MERGE
            reasoning = f"READY_TO_MERGE: No blocking issues. {len(low)} suggestion(s). {ci_summary}"
        else:
            verdict = MergeVerdict.READY_TO_MERGE
            reasoning = f"READY_TO_MERGE: No blocking issues. {ci_summary}"

        return verdict, reasoning, blockers

    def _generate_summary(
        self,
        verdict: MergeVerdict,
        verdict_reasoning: str,
        blockers: list[str],
        findings: list[PRReviewFinding],
        agents_invoked: list[str],
    ) -> str:
        """Generate PR review summary with per-finding evidence details."""
        verdict_emoji = {
            MergeVerdict.READY_TO_MERGE: "✅",
            MergeVerdict.MERGE_WITH_CHANGES: "🟡",
            MergeVerdict.NEEDS_REVISION: "🟠",
            MergeVerdict.BLOCKED: "🔴",
        }

        lines = [
            f"### Merge Verdict: {verdict_emoji.get(verdict, '⚪')} {verdict.value.upper().replace('_', ' ')}",
            verdict_reasoning,
            "",
        ]

        # Agents used
        if agents_invoked:
            lines.append(f"**Specialist Agents Invoked:** {', '.join(agents_invoked)}")
            lines.append("")

        # Blockers
        if blockers:
            lines.append("### 🚨 Blocking Issues")
            for blocker in blockers:
                lines.append(f"- {blocker}")
            lines.append("")

        # Detailed findings with evidence
        if findings:
            severity_emoji = {
                "critical": "🔴",
                "high": "🟠",
                "medium": "🟡",
                "low": "🔵",
            }

            lines.append("### Findings")
            lines.append("")

            for f in findings:
                sev = f.severity.value
                emoji = severity_emoji.get(sev, "⚪")

                is_disputed = f.validation_status == "dismissed_false_positive"

                # Finding header with location
                line_range = f"L{f.line}"
                if f.end_line and f.end_line != f.line:
                    line_range = f"L{f.line}-L{f.end_line}"
                if is_disputed:
                    lines.append(f"#### ⚪ [DISPUTED] ~~{f.title}~~")
                else:
                    lines.append(f"#### {emoji} [{sev.upper()}] {f.title}")
                lines.append(f"**File:** `{f.file}` ({line_range})")

                # Cross-validation badge
                if f.cross_validated and f.source_agents:
                    agents_str = ", ".join(f.source_agents)
                    lines.append(
                        f"**Cross-validated** by {len(f.source_agents)} agents: {agents_str}"
                    )

                # Description
                lines.append("")
                lines.append(f"{f.description}")

                # Evidence from the finding itself
                if f.evidence:
                    lines.append("")
                    lines.append("<details>")
                    lines.append("<summary>Code evidence</summary>")
                    lines.append("")
                    lines.append("```")
                    lines.append(f.evidence)
                    lines.append("```")
                    lines.append("</details>")

                # Validation details (what the validator verified)
                if f.validation_status:
                    status_label = {
                        "confirmed_valid": "Confirmed",
                        "needs_human_review": "Needs human review",
                        "dismissed_false_positive": "Disputed by validator",
                    }.get(f.validation_status, f.validation_status)
                    lines.append("")
                    lines.append(f"**Validation:** {status_label}")
                    if f.validation_evidence:
                        lines.append("")
                        lines.append("<details>")
                        lines.append("<summary>Verification details</summary>")
                        lines.append("")
                        lines.append(f"{f.validation_evidence}")
                        if f.validation_explanation:
                            lines.append("")
                            lines.append(f"**Reasoning:** {f.validation_explanation}")
                        lines.append("</details>")

                # Suggested fix
                if f.suggested_fix:
                    lines.append("")
                    lines.append(f"**Suggested fix:** {f.suggested_fix}")

                lines.append("")

            # Findings count summary (exclude dismissed from active count)
            active_count = 0
            dismissed_count = 0
            by_severity: dict[str, int] = {}
            for f in findings:
                if f.validation_status == "dismissed_false_positive":
                    dismissed_count += 1
                    continue
                active_count += 1
                sev = f.severity.value
                by_severity[sev] = by_severity.get(sev, 0) + 1
            summary_parts = []
            for sev in ["critical", "high", "medium", "low"]:
                if sev in by_severity:
                    summary_parts.append(f"{by_severity[sev]} {sev}")
            count_text = (
                f"**Total:** {active_count} finding(s) ({', '.join(summary_parts)})"
            )
            if dismissed_count > 0:
                count_text += f" + {dismissed_count} disputed"
            lines.append(count_text)
            lines.append("")

        lines.append("---")
        lines.append("_Generated by Auto Claude Parallel Orchestrator (SDK Subagents)_")

        return "\n".join(lines)

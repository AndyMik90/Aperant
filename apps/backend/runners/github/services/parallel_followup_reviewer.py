"""
Parallel Follow-up PR Reviewer
===============================

PR follow-up reviewer using Claude Agent SDK subagents for parallel specialist analysis.

The orchestrator analyzes incremental changes and delegates to specialized agents:
- resolution-verifier: Verifies previous findings are addressed
- new-code-reviewer: Reviews new code for issues
- comment-analyzer: Processes contributor and AI feedback

Key Design:
- AI decides which agents to invoke (NOT programmatic rules)
- Subagents defined via SDK `agents={}` parameter
- SDK handles parallel execution automatically
- User-configured model from frontend settings (no hardcoding)
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..models import FollowupReviewContext

from claude_agent_sdk import AgentDefinition

try:
    from ...core.client import create_client
    from ...phase_config import (
        get_model_betas,
        get_thinking_kwargs_for_model,
        resolve_model_id,
    )
    from ..context_gatherer import _validate_git_ref
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
    from .pydantic_models import FollowupExtractionResponse, ParallelFollowupResponse
    from .recovery_utils import create_finding_from_summary
    from .sdk_utils import process_sdk_stream
except (ImportError, ValueError, SystemError):
    from context_gatherer import _validate_git_ref
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
        get_thinking_kwargs_for_model,
        resolve_model_id,
    )
    from services.agent_utils import create_working_dir_injector
    from services.category_utils import map_category
    from services.io_utils import safe_print
    from services.pr_worktree_manager import PRWorktreeManager
    from services.pydantic_models import (
        FollowupExtractionResponse,
        ParallelFollowupResponse,
    )
    from services.recovery_utils import create_finding_from_summary
    from services.sdk_utils import process_sdk_stream


logger = logging.getLogger(__name__)

# Check if debug mode is enabled
DEBUG_MODE = os.environ.get("DEBUG", "").lower() in ("true", "1", "yes")

# Directory for PR review worktrees (shared with initial reviewer)
PR_WORKTREE_DIR = ".auto-claude/github/pr/worktrees"

# Severity mapping for AI responses
_SEVERITY_MAPPING = {
    "critical": ReviewSeverity.CRITICAL,
    "high": ReviewSeverity.HIGH,
    "medium": ReviewSeverity.MEDIUM,
    "low": ReviewSeverity.LOW,
}


def _map_severity(severity_str: str) -> ReviewSeverity:
    """Map severity string to ReviewSeverity enum."""
    return _SEVERITY_MAPPING.get(severity_str.lower(), ReviewSeverity.MEDIUM)


class ParallelFollowupReviewer:
    """
    Follow-up PR reviewer using SDK subagents for parallel specialist analysis.

    The orchestrator:
    1. Analyzes incremental changes since last review
    2. Delegates to appropriate specialist agents (SDK handles parallel execution)
    3. Synthesizes findings into a final merge verdict

    Specialist Agents:
    - resolution-verifier: Verifies previous findings are addressed
    - new-code-reviewer: Reviews new code for issues
    - comment-analyzer: Processes contributor and AI feedback

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

    def _define_specialist_agents(
        self, project_root: Path | None = None
    ) -> dict[str, AgentDefinition]:
        """
        Define specialist agents for follow-up review.

        Each agent has:
        - description: When the orchestrator should invoke this agent
        - prompt: System prompt for the agent (includes working directory)
        - tools: Tools the agent can use (read-only for PR review)
        - model: "inherit" = use same model as orchestrator (user's choice)

        Args:
            project_root: Working directory for the agents (worktree path).
                         If None, falls back to self.project_dir.
        """
        # Use provided project_root or fall back to default
        working_dir = project_root or self.project_dir

        # Load agent prompts from files
        resolution_prompt = self._load_prompt("pr_followup_resolution_agent.md")
        newcode_prompt = self._load_prompt("pr_followup_newcode_agent.md")
        comment_prompt = self._load_prompt("pr_followup_comment_agent.md")
        validator_prompt = self._load_prompt("pr_finding_validator.md")

        # CRITICAL: Inject working directory into all prompts
        # Subagents don't inherit cwd from parent, so they need explicit path info
        with_working_dir = create_working_dir_injector(working_dir)

        return {
            "resolution-verifier": AgentDefinition(
                description=(
                    "Resolution verification specialist. Use to verify whether previous "
                    "findings have been addressed. Analyzes diffs to determine if issues "
                    "are truly fixed, partially fixed, or still unresolved. "
                    "Invoke when: There are previous findings to verify."
                ),
                prompt=with_working_dir(
                    resolution_prompt,
                    "You verify whether previous findings are resolved.",
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
            "new-code-reviewer": AgentDefinition(
                description=(
                    "New code analysis specialist. Reviews code added since last review "
                    "for security, logic, quality issues, and regressions. "
                    "Invoke when: There are substantial code changes (>50 lines diff) or "
                    "changes to security-sensitive areas."
                ),
                prompt=with_working_dir(
                    newcode_prompt, "You review new code for issues."
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
            "comment-analyzer": AgentDefinition(
                description=(
                    "Comment and feedback analyst. Processes contributor comments and "
                    "AI tool reviews (CodeRabbit, Cursor, Gemini, etc.) to identify "
                    "unanswered questions and valid concerns. "
                    "Invoke when: There are comments or formal reviews since last review."
                ),
                prompt=with_working_dir(
                    comment_prompt, "You analyze comments and feedback."
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
            "finding-validator": AgentDefinition(
                description=(
                    "Finding re-investigation specialist. Re-investigates unresolved findings "
                    "to validate they are actually real issues, not false positives. "
                    "Actively reads the code at the finding location with fresh eyes. "
                    "Can confirm findings as valid OR dismiss them as false positives. "
                    "CRITICAL: Invoke for ALL unresolved findings after resolution-verifier runs. "
                    "Invoke when: There are findings marked as unresolved that need validation."
                ),
                prompt=with_working_dir(
                    validator_prompt,
                    "You validate whether unresolved findings are real issues.",
                ),
                tools=["Read", "Grep", "Glob"],
                model="inherit",
            ),
        }

    def _format_previous_findings(self, context: FollowupReviewContext) -> str:
        """Format previous findings for the prompt."""
        previous_findings = context.previous_review.findings
        if not previous_findings:
            return "No previous findings to verify."

        lines = []
        for f in previous_findings:
            lines.append(
                f"- **{f.id}** [{f.severity.value}] {f.title}\n"
                f"  File: {f.file}:{f.line}\n"
                f"  {f.description[:200]}..."
            )
        return "\n".join(lines)

    def _format_commits(self, context: FollowupReviewContext) -> str:
        """Format new commits for the prompt."""
        if not context.commits_since_review:
            return "No new commits."

        lines = []
        for commit in context.commits_since_review[:20]:  # Limit to 20 commits
            sha = commit.get("sha", "")[:7]
            message = commit.get("commit", {}).get("message", "").split("\n")[0]
            author = commit.get("commit", {}).get("author", {}).get("name", "unknown")
            lines.append(f"- `{sha}` by {author}: {message}")
        return "\n".join(lines)

    def _format_comments(self, context: FollowupReviewContext) -> str:
        """Format contributor comments for the prompt."""
        if not context.contributor_comments_since_review:
            return "No contributor comments since last review."

        lines = []
        for comment in context.contributor_comments_since_review[:15]:
            author = comment.get("user", {}).get("login", "unknown")
            body = comment.get("body", "")[:300]
            lines.append(f"**@{author}**: {body}")
        return "\n\n".join(lines)

    def _format_ai_reviews(self, context: FollowupReviewContext) -> str:
        """Format AI bot reviews and comments for the prompt."""
        ai_content = []

        # AI bot comments
        for comment in context.ai_bot_comments_since_review[:10]:
            author = comment.get("user", {}).get("login", "unknown")
            body = comment.get("body", "")[:500]
            ai_content.append(f"**{author}** (comment):\n{body}")

        # Formal PR reviews from AI tools
        for review in context.pr_reviews_since_review[:5]:
            author = review.get("user", {}).get("login", "unknown")
            body = review.get("body", "")[:1000]
            state = review.get("state", "unknown")
            ai_content.append(f"**{author}** ({state}):\n{body}")

        if not ai_content:
            return "No AI tool feedback since last review."

        return "\n\n---\n\n".join(ai_content)

    def _format_ci_status(self, context: FollowupReviewContext) -> str:
        """Format CI status for the prompt."""
        ci_status = context.ci_status
        if not ci_status:
            return "CI status not available."

        passing = ci_status.get("passing", 0)
        failing = ci_status.get("failing", 0)
        pending = ci_status.get("pending", 0)
        failed_checks = ci_status.get("failed_checks", [])
        awaiting_approval = ci_status.get("awaiting_approval", 0)

        lines = []

        # Overall status
        if failing > 0:
            lines.append(f"⚠️ **{failing} CI check(s) FAILING** - PR cannot be merged")
        elif pending > 0:
            lines.append(f"⏳ **{pending} CI check(s) pending** - Wait for completion")
        elif passing > 0:
            lines.append(f"✅ **All {passing} CI check(s) passing**")
        else:
            lines.append("No CI checks configured")

        # List failed checks
        if failed_checks:
            lines.append("\n**Failed checks:**")
            for check in failed_checks:
                lines.append(f"  - ❌ {check}")

        # Awaiting approval (fork PRs)
        if awaiting_approval > 0:
            lines.append(
                f"\n⏸️ **{awaiting_approval} workflow(s) awaiting maintainer approval** (fork PR)"
            )

        return "\n".join(lines)

    def _build_orchestrator_prompt(self, context: FollowupReviewContext) -> str:
        """Build full prompt for orchestrator with follow-up context."""
        # Load orchestrator prompt
        base_prompt = self._load_prompt("pr_followup_orchestrator.md")
        if not base_prompt:
            base_prompt = "You are a follow-up PR reviewer. Verify resolutions and find new issues."

        # Build context sections
        previous_findings = self._format_previous_findings(context)
        commits = self._format_commits(context)
        contributor_comments = self._format_comments(context)
        ai_reviews = self._format_ai_reviews(context)
        ci_status = self._format_ci_status(context)

        # Truncate diff if too long
        MAX_DIFF_CHARS = 100_000
        diff_content = context.diff_since_review
        if len(diff_content) > MAX_DIFF_CHARS:
            diff_content = diff_content[:MAX_DIFF_CHARS] + "\n\n... (diff truncated)"

        followup_context = f"""
---

## Follow-up Review Context

**PR Number:** {context.pr_number}
**Previous Review Commit:** {context.previous_commit_sha[:8]}
**Current HEAD:** {context.current_commit_sha[:8]}
**New Commits:** {len(context.commits_since_review)}
**Files Changed:** {len(context.files_changed_since_review)}

### CI Status (CRITICAL - Must Factor Into Verdict)
{ci_status}

### Previous Review Summary
{context.previous_review.summary[:500] if context.previous_review.summary else "No summary available."}

### Previous Findings to Verify
{previous_findings}

### New Commits Since Last Review
{commits}

### Files Changed Since Last Review
{chr(10).join(f"- {f}" for f in context.files_changed_since_review[:30])}

### Contributor Comments Since Last Review
{contributor_comments}

### AI Tool Feedback Since Last Review
{ai_reviews}

### Diff Since Last Review
```diff
{diff_content}
```

---

Now analyze this follow-up and delegate to the appropriate specialist agents.
Remember: YOU decide which agents to invoke based on YOUR analysis.
The SDK will run invoked agents in parallel automatically.
**CRITICAL: Your verdict MUST account for CI status. Failing CI = BLOCKED verdict.**
"""

        return base_prompt + followup_context

    async def review(self, context: FollowupReviewContext) -> PRReviewResult:
        """
        Main follow-up review entry point.

        Args:
            context: Follow-up context with incremental changes

        Returns:
            PRReviewResult with findings and verdict
        """
        logger.info(
            f"[ParallelFollowup] Starting follow-up review for PR #{context.pr_number}"
        )

        # Track worktree for cleanup
        worktree_path: Path | None = None

        try:
            self._report_progress(
                "orchestrating",
                35,
                "Parallel orchestrator analyzing follow-up...",
                pr_number=context.pr_number,
            )

            # Build orchestrator prompt
            prompt = self._build_orchestrator_prompt(context)

            # Get project root - default to local checkout
            project_root = (
                self.project_dir.parent.parent
                if self.project_dir.name == "backend"
                else self.project_dir
            )

            # Create temporary worktree at PR head commit for isolated review
            # This ensures agents read from the correct PR state, not the current checkout
            head_sha = context.current_commit_sha
            if head_sha and _validate_git_ref(head_sha):
                try:
                    if DEBUG_MODE:
                        safe_print(
                            f"[Followup] DEBUG: Creating worktree for head_sha={head_sha}",
                            flush=True,
                        )
                    worktree_path = self._create_pr_worktree(
                        head_sha, context.pr_number
                    )
                    project_root = worktree_path
                    safe_print(
                        f"[Followup] Using worktree at {worktree_path.name} for PR review",
                        flush=True,
                    )
                except Exception as e:
                    if DEBUG_MODE:
                        safe_print(
                            f"[Followup] DEBUG: Worktree creation FAILED: {e}",
                            flush=True,
                        )
                    logger.warning(
                        f"[ParallelFollowup] Worktree creation failed, "
                        f"falling back to local checkout: {e}"
                    )
                    # Fallback to original behavior if worktree creation fails
            else:
                logger.warning(
                    f"[ParallelFollowup] Invalid or missing head_sha '{head_sha}', "
                    "using local checkout"
                )

            # Capture agent definitions for debug logging (AFTER worktree creation)
            agent_defs = self._define_specialist_agents(project_root)

            # Use model and thinking level from config (user settings)
            # Resolve model shorthand via environment variable override if configured
            model_shorthand = self.config.model or "sonnet"
            model = resolve_model_id(model_shorthand)
            betas = get_model_betas(model_shorthand)
            thinking_level = self.config.thinking_level or "medium"
            thinking_kwargs = get_thinking_kwargs_for_model(model, thinking_level)

            logger.info(
                f"[ParallelFollowup] Using model={model}, "
                f"thinking_level={thinking_level}, thinking_kwargs={thinking_kwargs}"
            )

            # Create client with subagents defined (using worktree path)
            client = create_client(
                project_dir=project_root,
                spec_dir=self.github_dir,
                model=model,
                agent_type="pr_followup_parallel",
                betas=betas,
                fast_mode=self.config.fast_mode,
                agents=self._define_specialist_agents(project_root),
                output_format={
                    "type": "json_schema",
                    "schema": ParallelFollowupResponse.model_json_schema(),
                },
                **thinking_kwargs,
            )

            self._report_progress(
                "orchestrating",
                40,
                "Orchestrator delegating to specialist agents...",
                pr_number=context.pr_number,
            )

            # Run orchestrator session using shared SDK stream processor
            async with client:
                await client.query(prompt)

                safe_print(
                    f"[ParallelFollowup] Running orchestrator ({model})...",
                    flush=True,
                )

                # Process SDK stream with shared utility
                stream_result = await process_sdk_stream(
                    client=client,
                    context_name="ParallelFollowup",
                    model=model,
                    system_prompt=prompt,
                    agent_definitions=agent_defs,
                )

                # Check for stream processing errors
                stream_error = stream_result.get("error")
                if stream_error:
                    if stream_result.get("error_recoverable"):
                        # Recoverable error — attempt extraction call fallback
                        logger.warning(
                            f"[ParallelFollowup] Recoverable error: {stream_error}. "
                            f"Attempting extraction call fallback."
                        )
                        safe_print(
                            f"[ParallelFollowup] WARNING: {stream_error} — "
                            f"attempting recovery with minimal extraction...",
                            flush=True,
                        )
                    else:
                        # Fatal error — raise as before
                        logger.error(
                            f"[ParallelFollowup] SDK stream failed: {stream_error}"
                        )
                        raise RuntimeError(
                            f"SDK stream processing failed: {stream_error}"
                        )

                result_text = stream_result["result_text"]
                last_assistant_text = stream_result.get("last_assistant_text", "")
                # Nullify structured output on recoverable errors to force Tier 2 fallback
                structured_output = (
                    None
                    if (stream_error and stream_result.get("error_recoverable"))
                    else stream_result["structured_output"]
                )
                agents_invoked = stream_result["agents_invoked"]
                msg_count = stream_result["msg_count"]

            self._report_progress(
                "finalizing",
                50,
                "Synthesizing follow-up findings...",
                pr_number=context.pr_number,
            )

            # Parse findings from output (three-tier recovery cascade)
            if structured_output:
                result_data = self._parse_structured_output(structured_output, context)
            else:
                # Structured output missing or validation failed.
                # Tier 2: Attempt extraction call with minimal schema
                logger.warning(
                    "[ParallelFollowup] No structured output — attempting extraction call"
                )
                # Use last_assistant_text (cleaner) if available, fall back to full transcript
                fallback_text = last_assistant_text or result_text
                result_data = await self._attempt_extraction_call(
                    fallback_text, context
                )
                if result_data is None:
                    # Tier 3: Fall back to basic text parsing
                    safe_print(
                        "[ParallelFollowup] WARNING: Extraction call failed, "
                        "using text fallback (resolution tracking may be incomplete)",
                        flush=True,
                    )
                    result_data = self._parse_text_output(result_text, context)

            # Extract data
            findings = result_data.get("findings", [])
            resolved_ids = result_data.get("resolved_ids", [])
            unresolved_ids = result_data.get("unresolved_ids", [])
            new_finding_ids = result_data.get("new_finding_ids", [])
            verdict = result_data.get("verdict", MergeVerdict.NEEDS_REVISION)
            verdict_reasoning = result_data.get("verdict_reasoning", "")

            # Use agents from structured output (more reliable than streaming detection)
            agents_from_result = result_data.get("agents_invoked", [])
            final_agents = agents_from_result if agents_from_result else agents_invoked
            logger.info(
                f"[ParallelFollowup] Session complete. Agents invoked: {final_agents}"
            )
            safe_print(
                f"[ParallelFollowup] Complete. Agents invoked: {final_agents}",
                flush=True,
            )

            # Deduplicate findings
            unique_findings = self._deduplicate_findings(findings)

            logger.info(
                f"[ParallelFollowup] Review complete: {len(unique_findings)} findings, "
                f"{len(resolved_ids)} resolved, {len(unresolved_ids)} unresolved"
            )

            # Generate blockers from critical/high/medium severity findings
            # (Medium also blocks merge in our strict quality gates approach)
            blockers = []

            # CRITICAL: Merge conflicts block merging - check FIRST before summary generation
            # This must happen before _generate_summary so the summary reflects merge conflict status
            if context.has_merge_conflicts:
                blockers.append(
                    "Merge Conflicts: PR has conflicts with base branch that must be resolved"
                )
                # Override verdict to BLOCKED if merge conflicts exist
                verdict = MergeVerdict.BLOCKED
                verdict_reasoning = (
                    "Blocked: PR has merge conflicts with base branch. "
                    "Resolve conflicts before merge."
                )
                safe_print(
                    "[ParallelFollowup] ⚠️ PR has merge conflicts - blocking merge",
                    flush=True,
                )
            # Check if branch is behind base (out of date) - warning, not hard blocker
            elif context.merge_state_status == "BEHIND":
                blockers.append(BRANCH_BEHIND_BLOCKER_MSG)
                # Use NEEDS_REVISION since potential conflicts are unknown until branch is updated
                # Must handle both READY_TO_MERGE and MERGE_WITH_CHANGES verdicts
                if verdict in (
                    MergeVerdict.READY_TO_MERGE,
                    MergeVerdict.MERGE_WITH_CHANGES,
                ):
                    verdict = MergeVerdict.NEEDS_REVISION
                    verdict_reasoning = BRANCH_BEHIND_REASONING
                safe_print(
                    "[ParallelFollowup] ⚠️ PR branch is behind base - needs update",
                    flush=True,
                )

            # CRITICAL: Enforce CI pending status - cannot approve with pending checks
            # This ensures AI compliance with the rule: "Pending CI = NEEDS_REVISION"
            ci_status = context.ci_status or {}
            pending_ci = ci_status.get("pending", 0)
            failing_ci = ci_status.get("failing", 0)

            if failing_ci > 0:
                # Failing CI blocks merge
                if verdict in (
                    MergeVerdict.READY_TO_MERGE,
                    MergeVerdict.MERGE_WITH_CHANGES,
                ):
                    failed_checks = ci_status.get("failed_checks", [])
                    checks_str = (
                        ", ".join(failed_checks[:3]) if failed_checks else "unknown"
                    )
                    blockers.append(
                        f"CI Failing: {failing_ci} check(s) failing ({checks_str})"
                    )
                    verdict = MergeVerdict.BLOCKED
                    verdict_reasoning = (
                        f"Blocked: {failing_ci} CI check(s) failing. "
                        f"Fix CI issues before merge."
                    )
                    safe_print(
                        f"[ParallelFollowup] ⚠️ CI failing ({failing_ci} checks) - blocking merge",
                        flush=True,
                    )
            elif pending_ci > 0:
                # Pending CI prevents merge-ready verdicts
                if verdict in (
                    MergeVerdict.READY_TO_MERGE,
                    MergeVerdict.MERGE_WITH_CHANGES,
                ):
                    verdict = MergeVerdict.NEEDS_REVISION
                    verdict_reasoning = (
                        f"Ready once CI passes: {pending_ci} check(s) still pending. "
                        f"All code issues addressed, waiting for CI completion."
                    )
                    safe_print(
                        f"[ParallelFollowup] ⏳ CI pending ({pending_ci} checks) - "
                        f"downgrading verdict to NEEDS_REVISION",
                        flush=True,
                    )

            for finding in unique_findings:
                if finding.severity in (
                    ReviewSeverity.CRITICAL,
                    ReviewSeverity.HIGH,
                    ReviewSeverity.MEDIUM,
                ):
                    blockers.append(f"{finding.category.value}: {finding.title}")

            # Extract validation counts
            dismissed_count = len(
                result_data.get("dismissed_false_positive_ids", [])
            ) or result_data.get("dismissed_finding_count", 0)
            confirmed_count = result_data.get("confirmed_valid_count", 0)
            needs_human_count = result_data.get("needs_human_review_count", 0)

            # Generate summary (AFTER merge conflict check so it reflects correct verdict)
            summary = self._generate_summary(
                verdict=verdict,
                verdict_reasoning=verdict_reasoning,
                blockers=blockers,
                resolved_count=len(resolved_ids),
                unresolved_count=len(unresolved_ids),
                new_count=len(new_finding_ids),
                agents_invoked=final_agents,
                dismissed_false_positive_count=dismissed_count,
                confirmed_valid_count=confirmed_count,
                needs_human_review_count=needs_human_count,
                ci_status=context.ci_status,
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
                findings=unique_findings,
                summary=summary,
                overall_status=overall_status,
                verdict=verdict,
                verdict_reasoning=verdict_reasoning,
                blockers=blockers,
                reviewed_commit_sha=context.current_commit_sha,
                reviewed_file_blobs=file_blobs,
                is_followup_review=True,
                previous_review_id=context.previous_review.review_id
                or context.previous_review.pr_number,
                resolved_findings=resolved_ids,
                unresolved_findings=unresolved_ids,
                new_findings_since_last_review=new_finding_ids,
            )

            self._report_progress(
                "analyzed",
                60,
                "Follow-up analysis complete",
                pr_number=context.pr_number,
            )

            return result

        except Exception as e:
            logger.error(f"[ParallelFollowup] Review failed: {e}", exc_info=True)
            safe_print(f"[ParallelFollowup] Error: {e}")

            return PRReviewResult(
                pr_number=context.pr_number,
                repo=self.config.repo,
                success=False,
                findings=[],
                summary=f"Follow-up review failed: {e}",
                overall_status="comment",
                verdict=MergeVerdict.NEEDS_REVISION,
                verdict_reasoning=f"Review failed: {e}",
                blockers=[str(e)],
                is_followup_review=True,
                reviewed_commit_sha=context.current_commit_sha,
            )
        finally:
            # Always cleanup worktree, even on error
            if worktree_path:
                self._cleanup_pr_worktree(worktree_path)

    def _parse_structured_output(
        self, data: dict, context: FollowupReviewContext
    ) -> dict:
        """Parse structured output from ParallelFollowupResponse."""
        try:
            # Validate with Pydantic
            response = ParallelFollowupResponse.model_validate(data)

            # Log agents from structured output
            agents_from_output = response.agents_invoked or []
            if agents_from_output:
                safe_print(
                    f"[ParallelFollowup] Specialist agents invoked: {', '.join(agents_from_output)}",
                    flush=True,
                )
                for agent in agents_from_output:
                    safe_print(f"[Agent:{agent}] Analysis complete")

            findings = []
            resolved_ids = []
            unresolved_ids = []
            new_finding_ids = []

            # Process resolution verifications
            # First, build a map of finding validations (from finding-validator agent)
            validation_map = {}
            dismissed_ids = []
            for fv in response.finding_validations:
                validation_map[fv.finding_id] = fv
                if fv.validation_status == "dismissed_false_positive":
                    dismissed_ids.append(fv.finding_id)
                    safe_print(
                        f"[ParallelFollowup] Finding {fv.finding_id} DISMISSED as false positive: {fv.explanation[:100]}",
                        flush=True,
                    )

            for rv in response.resolution_verifications:
                if rv.status == "resolved":
                    resolved_ids.append(rv.finding_id)
                elif rv.status in ("unresolved", "partially_resolved", "cant_verify"):
                    # Check if finding was validated and dismissed as false positive
                    if rv.finding_id in dismissed_ids:
                        # Finding-validator determined this was a false positive - skip it
                        safe_print(
                            f"[ParallelFollowup] Skipping {rv.finding_id} - dismissed as false positive by finding-validator",
                            flush=True,
                        )
                        resolved_ids.append(
                            rv.finding_id
                        )  # Count as resolved (false positive)
                        continue

                    # Include "cant_verify" as unresolved - if we can't verify, assume not fixed
                    unresolved_ids.append(rv.finding_id)
                    # Add unresolved as a finding
                    if rv.status in ("unresolved", "cant_verify"):
                        # Find original finding
                        original = next(
                            (
                                f
                                for f in context.previous_review.findings
                                if f.id == rv.finding_id
                            ),
                            None,
                        )
                        if original:
                            # Check if we have validation evidence
                            validation = validation_map.get(rv.finding_id)
                            validation_status = None
                            validation_evidence = None
                            validation_explanation = None

                            if validation:
                                validation_status = validation.validation_status
                                validation_evidence = validation.code_evidence
                                validation_explanation = validation.explanation

                            findings.append(
                                PRReviewFinding(
                                    id=rv.finding_id,
                                    severity=original.severity,
                                    category=original.category,
                                    title=f"[UNRESOLVED] {original.title}",
                                    description=f"{original.description}\n\nResolution note: {rv.evidence}",
                                    file=original.file,
                                    line=original.line,
                                    suggested_fix=original.suggested_fix,
                                    fixable=original.fixable,
                                    validation_status=validation_status,
                                    validation_evidence=validation_evidence,
                                    validation_explanation=validation_explanation,
                                    is_impact_finding=original.is_impact_finding,
                                )
                            )

            # Process new findings
            for nf in response.new_findings:
                finding_id = nf.id or self._generate_finding_id(
                    nf.file, nf.line, nf.title
                )
                new_finding_ids.append(finding_id)
                findings.append(
                    PRReviewFinding(
                        id=finding_id,
                        severity=_map_severity(nf.severity),
                        category=map_category(nf.category),
                        title=nf.title,
                        description=nf.description,
                        file=nf.file,
                        line=nf.line,
                        suggested_fix=nf.suggested_fix,
                        fixable=nf.fixable,
                        is_impact_finding=getattr(nf, "is_impact_finding", False),
                    )
                )

            # Process comment findings
            for cf in response.comment_findings:
                finding_id = cf.id or self._generate_finding_id(
                    cf.file, cf.line, cf.title
                )
                new_finding_ids.append(finding_id)
                findings.append(
                    PRReviewFinding(
                        id=finding_id,
                        severity=_map_severity(cf.severity),
                        category=map_category(cf.category),
                        title=f"[FROM COMMENTS] {cf.title}",
                        description=cf.description,
                        file=cf.file,
                        line=cf.line,
                        suggested_fix=cf.suggested_fix,
                        fixable=cf.fixable,
                    )
                )

            # Map verdict
            verdict_map = {
                "READY_TO_MERGE": MergeVerdict.READY_TO_MERGE,
                "MERGE_WITH_CHANGES": MergeVerdict.MERGE_WITH_CHANGES,
                "NEEDS_REVISION": MergeVerdict.NEEDS_REVISION,
                "BLOCKED": MergeVerdict.BLOCKED,
            }
            verdict = verdict_map.get(response.verdict, MergeVerdict.NEEDS_REVISION)

            # Count validation results
            confirmed_valid_count = sum(
                1
                for fv in response.finding_validations
                if fv.validation_status == "confirmed_valid"
            )
            needs_human_count = sum(
                1
                for fv in response.finding_validations
                if fv.validation_status == "needs_human_review"
            )

            # Log findings summary for verification
            safe_print(
                f"[ParallelFollowup] Parsed {len(findings)} findings, "
                f"{len(resolved_ids)} resolved, {len(unresolved_ids)} unresolved, "
                f"{len(new_finding_ids)} new",
                flush=True,
            )
            if dismissed_ids:
                safe_print(
                    f"[ParallelFollowup] Validation: {len(dismissed_ids)} findings dismissed as false positives, "
                    f"{confirmed_valid_count} confirmed valid, {needs_human_count} need human review",
                    flush=True,
                )
            if findings:
                safe_print("[ParallelFollowup] Findings summary:")
                for i, f in enumerate(findings, 1):
                    validation_note = ""
                    if f.validation_status == "confirmed_valid":
                        validation_note = " [VALIDATED]"
                    elif f.validation_status == "needs_human_review":
                        validation_note = " [NEEDS HUMAN REVIEW]"
                    safe_print(
                        f"  [{f.severity.value.upper()}] {i}. {f.title} ({f.file}:{f.line}){validation_note}",
                        flush=True,
                    )

            return {
                "findings": findings,
                "resolved_ids": resolved_ids,
                "unresolved_ids": unresolved_ids,
                "new_finding_ids": new_finding_ids,
                "dismissed_false_positive_ids": dismissed_ids,
                "confirmed_valid_count": confirmed_valid_count,
                "needs_human_review_count": needs_human_count,
                "verdict": verdict,
                "verdict_reasoning": response.verdict_reasoning,
                "agents_invoked": agents_from_output,
            }

        except Exception as e:
            # Log error visibly so users know structured output parsing failed
            logger.warning(f"[ParallelFollowup] Failed to parse structured output: {e}")
            safe_print(
                f"[ParallelFollowup] ERROR: Structured output parsing failed: {e}",
                flush=True,
            )
            safe_print(
                "[ParallelFollowup] Attempting to extract partial data from raw output...",
                flush=True,
            )

            # Try to extract what we can from the raw dict before giving up
            # This handles cases where Pydantic validation fails but data is present
            try:
                partial_result = self._extract_partial_data(data)
                if partial_result:
                    safe_print(
                        f"[ParallelFollowup] Recovered partial data: "
                        f"{len(partial_result.get('resolved_ids', []))} resolved, "
                        f"{len(partial_result.get('unresolved_ids', []))} unresolved",
                        flush=True,
                    )
                    return partial_result
            except Exception as extract_error:
                logger.warning(
                    f"[ParallelFollowup] Partial extraction also failed: {extract_error}"
                )

            return self._create_empty_result()

    def _parse_text_output(self, text: str, context: FollowupReviewContext) -> dict:
        """Parse text output when structured output fails."""
        logger.warning("[ParallelFollowup] Falling back to text parsing")

        # Simple heuristic parsing
        findings = []

        # Look for verdict keywords
        text_lower = text.lower()
        if "ready to merge" in text_lower or "approve" in text_lower:
            verdict = MergeVerdict.READY_TO_MERGE
        elif "blocked" in text_lower or "critical" in text_lower:
            verdict = MergeVerdict.BLOCKED
        elif "needs revision" in text_lower or "request changes" in text_lower:
            verdict = MergeVerdict.NEEDS_REVISION
        else:
            verdict = MergeVerdict.NEEDS_REVISION

        return {
            "findings": findings,
            "resolved_ids": [],
            "unresolved_ids": [],
            "new_finding_ids": [],
            "dismissed_false_positive_ids": [],
            "confirmed_valid_count": 0,
            "dismissed_finding_count": 0,
            "needs_human_review_count": 0,
            "verdict": verdict,
            "verdict_reasoning": text[:500] if text else "Unable to parse response",
            "agents_invoked": [],
        }

    async def _attempt_extraction_call(
        self, text: str, context: FollowupReviewContext
    ) -> dict | None:
        """Attempt a short SDK call with a minimal schema to recover review data.

        This is the Tier 2 recovery step when full structured output validation fails.
        Uses FollowupExtractionResponse (small schema with ExtractedFindingSummary nesting)
        which has near-100% success rate.

        Returns parsed result dict on success, None on failure.
        """
        if not text or not text.strip():
            logger.warning("[ParallelFollowup] No text available for extraction call")
            return None

        try:
            safe_print(
                "[ParallelFollowup] Attempting recovery with minimal extraction schema...",
                flush=True,
            )

            extraction_prompt = (
                "Extract the key review data from the following AI analysis output. "
                "Return the verdict, reasoning, resolved finding IDs, unresolved finding IDs, "
                "structured summaries of any new findings (including severity, description, file path, and line number), "
                "and counts of confirmed/dismissed findings.\n\n"
                f"--- AI ANALYSIS OUTPUT ---\n{text[:8000]}\n--- END ---"
            )

            model_shorthand = self.config.model or "sonnet"
            model = resolve_model_id(model_shorthand)

            extraction_client = create_client(
                project_dir=self.project_dir,
                spec_dir=self.github_dir,
                model=model,
                agent_type="pr_followup_extraction",
                fast_mode=self.config.fast_mode,
                output_format={
                    "type": "json_schema",
                    "schema": FollowupExtractionResponse.model_json_schema(),
                },
            )

            async with extraction_client:
                await extraction_client.query(extraction_prompt)

                stream_result = await process_sdk_stream(
                    client=extraction_client,
                    context_name="FollowupExtraction",
                    model=model,
                    system_prompt=extraction_prompt,
                    max_messages=20,
                )

            if stream_result.get("error"):
                logger.warning(
                    f"[ParallelFollowup] Extraction call also failed: {stream_result['error']}"
                )
                return None

            extraction_output = stream_result.get("structured_output")
            if not extraction_output:
                logger.warning(
                    "[ParallelFollowup] Extraction call returned no structured output"
                )
                return None

            # Parse the minimal extraction response
            extracted = FollowupExtractionResponse.model_validate(extraction_output)

            # Map verdict string to MergeVerdict enum
            verdict_map = {
                "READY_TO_MERGE": MergeVerdict.READY_TO_MERGE,
                "MERGE_WITH_CHANGES": MergeVerdict.MERGE_WITH_CHANGES,
                "NEEDS_REVISION": MergeVerdict.NEEDS_REVISION,
                "BLOCKED": MergeVerdict.BLOCKED,
            }
            verdict = verdict_map.get(extracted.verdict, MergeVerdict.NEEDS_REVISION)

            # Reconstruct findings from extraction data
            findings = []
            new_finding_ids = []

            # 1. Convert new_finding_summaries to PRReviewFinding objects
            # ExtractedFindingSummary objects carry file/line from extraction
            for i, summary_obj in enumerate(extracted.new_finding_summaries):
                finding = create_finding_from_summary(
                    summary=summary_obj.description,
                    index=i,
                    id_prefix="FU",
                    severity_override=summary_obj.severity,
                    file=summary_obj.file,
                    line=summary_obj.line,
                )
                new_finding_ids.append(finding.id)
                findings.append(finding)

            # 2. Reconstruct unresolved findings from previous review context
            if extracted.unresolved_finding_ids and context.previous_review.findings:
                previous_map = {f.id: f for f in context.previous_review.findings}
                for uid in extracted.unresolved_finding_ids:
                    original = previous_map.get(uid)
                    if original:
                        findings.append(
                            PRReviewFinding(
                                id=original.id,
                                severity=original.severity,
                                category=original.category,
                                title=f"[UNRESOLVED] {original.title}",
                                description=original.description,
                                file=original.file,
                                line=original.line,
                                suggested_fix=original.suggested_fix,
                                fixable=original.fixable,
                                is_impact_finding=original.is_impact_finding,
                            )
                        )

            safe_print(
                f"[ParallelFollowup] Extraction recovered: verdict={extracted.verdict}, "
                f"{len(extracted.resolved_finding_ids)} resolved, "
                f"{len(extracted.unresolved_finding_ids)} unresolved, "
                f"{len(new_finding_ids)} new findings, "
                f"{len(findings)} total findings reconstructed",
                flush=True,
            )

            return {
                "findings": findings,
                "resolved_ids": extracted.resolved_finding_ids,
                "unresolved_ids": extracted.unresolved_finding_ids,
                "new_finding_ids": new_finding_ids,
                "dismissed_false_positive_ids": [],
                "confirmed_valid_count": extracted.confirmed_finding_count,
                "dismissed_finding_count": extracted.dismissed_finding_count,
                "needs_human_review_count": 0,
                "verdict": verdict,
                "verdict_reasoning": f"[Recovered via extraction] {extracted.verdict_reasoning}",
                "agents_invoked": [],
            }

        except Exception as e:
            logger.warning(f"[ParallelFollowup] Extraction call failed: {e}")
            safe_print(
                f"[ParallelFollowup] Extraction call failed: {e}",
                flush=True,
            )
            return None

    def _create_empty_result(self) -> dict:
        """Create empty result structure."""
        return {
            "findings": [],
            "resolved_ids": [],
            "unresolved_ids": [],
            "new_finding_ids": [],
            "dismissed_false_positive_ids": [],
            "confirmed_valid_count": 0,
            "dismissed_finding_count": 0,
            "needs_human_review_count": 0,
            "verdict": MergeVerdict.NEEDS_REVISION,
            "verdict_reasoning": "Unable to parse review results",
            "agents_invoked": [],
        }

    def _extract_partial_data(self, data: dict) -> dict | None:
        """
        Extract what data we can from raw output when Pydantic validation fails.

        This handles cases where the AI produced valid data but it doesn't exactly
        match the expected schema (missing optional fields, type mismatches, etc.).
        Defensively extracts findings from the raw dict so partial results are preserved.
        """
        if not isinstance(data, dict):
            return None

        resolved_ids = []
        unresolved_ids = []
        new_finding_ids = []
        findings = []

        # Try to extract resolution verifications
        resolution_verifications = data.get("resolution_verifications", [])
        if isinstance(resolution_verifications, list):
            for rv in resolution_verifications:
                if isinstance(rv, dict):
                    finding_id = rv.get("finding_id", "")
                    status = rv.get("status", "")
                    if finding_id:
                        if status == "resolved":
                            resolved_ids.append(finding_id)
                        elif status in (
                            "unresolved",
                            "partially_resolved",
                            "cant_verify",
                        ):
                            unresolved_ids.append(finding_id)

        # Try to extract new findings as PRReviewFinding objects
        new_findings_raw = data.get("new_findings", [])
        if isinstance(new_findings_raw, list):
            for nf in new_findings_raw:
                if not isinstance(nf, dict):
                    continue
                try:
                    finding_id = nf.get("id", "") or self._generate_finding_id(
                        nf.get("file", "unknown"),
                        nf.get("line", 0),
                        nf.get("title", "unknown"),
                    )
                    new_finding_ids.append(finding_id)
                    findings.append(
                        PRReviewFinding(
                            id=finding_id,
                            severity=_map_severity(nf.get("severity", "medium")),
                            category=map_category(nf.get("category", "quality")),
                            title=nf.get("title", "Unknown issue"),
                            description=nf.get("description", ""),
                            file=nf.get("file", "unknown"),
                            line=nf.get("line", 0) or 0,
                            suggested_fix=nf.get("suggested_fix"),
                            fixable=bool(nf.get("fixable", False)),
                            is_impact_finding=bool(nf.get("is_impact_finding", False)),
                        )
                    )
                except Exception as e:
                    logger.debug(
                        f"[ParallelFollowup] Skipping malformed new finding: {e}"
                    )

        # Try to extract comment findings as PRReviewFinding objects
        comment_findings_raw = data.get("comment_findings", [])
        if isinstance(comment_findings_raw, list):
            for cf in comment_findings_raw:
                if not isinstance(cf, dict):
                    continue
                try:
                    finding_id = cf.get("id", "") or self._generate_finding_id(
                        cf.get("file", "unknown"),
                        cf.get("line", 0),
                        cf.get("title", "unknown"),
                    )
                    new_finding_ids.append(finding_id)
                    findings.append(
                        PRReviewFinding(
                            id=finding_id,
                            severity=_map_severity(cf.get("severity", "medium")),
                            category=map_category(cf.get("category", "quality")),
                            title=f"[FROM COMMENTS] {cf.get('title', 'Unknown issue')}",
                            description=cf.get("description", ""),
                            file=cf.get("file", "unknown"),
                            line=cf.get("line", 0) or 0,
                            suggested_fix=cf.get("suggested_fix"),
                            fixable=bool(cf.get("fixable", False)),
                        )
                    )
                except Exception as e:
                    logger.debug(
                        f"[ParallelFollowup] Skipping malformed comment finding: {e}"
                    )

        # Try to extract verdict
        verdict_str = data.get("verdict", "NEEDS_REVISION")
        verdict_map = {
            "READY_TO_MERGE": MergeVerdict.READY_TO_MERGE,
            "MERGE_WITH_CHANGES": MergeVerdict.MERGE_WITH_CHANGES,
            "NEEDS_REVISION": MergeVerdict.NEEDS_REVISION,
            "BLOCKED": MergeVerdict.BLOCKED,
        }
        verdict = verdict_map.get(verdict_str, MergeVerdict.NEEDS_REVISION)

        verdict_reasoning = data.get("verdict_reasoning", "Extracted from partial data")

        # Only return if we got any useful data
        if resolved_ids or unresolved_ids or new_finding_ids or findings:
            return {
                "findings": findings,
                "resolved_ids": resolved_ids,
                "unresolved_ids": unresolved_ids,
                "new_finding_ids": new_finding_ids,
                "dismissed_false_positive_ids": [],
                "confirmed_valid_count": 0,
                "dismissed_finding_count": 0,
                "needs_human_review_count": 0,
                "verdict": verdict,
                "verdict_reasoning": f"[Partial extraction] {verdict_reasoning}",
                "agents_invoked": data.get("agents_invoked", []),
            }

        return None

    def _generate_finding_id(self, file: str, line: int, title: str) -> str:
        """Generate a unique finding ID."""
        content = f"{file}:{line}:{title}"
        return f"FU-{hashlib.md5(content.encode(), usedforsecurity=False).hexdigest()[:8].upper()}"

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

    def _generate_summary(
        self,
        verdict: MergeVerdict,
        verdict_reasoning: str,
        blockers: list[str],
        resolved_count: int,
        unresolved_count: int,
        new_count: int,
        agents_invoked: list[str],
        dismissed_false_positive_count: int = 0,
        confirmed_valid_count: int = 0,
        needs_human_review_count: int = 0,
        ci_status: dict | None = None,
    ) -> str:
        """Generate a human-readable summary of the follow-up review."""
        # Use same emojis as orchestrator.py for consistency
        status_emoji = {
            MergeVerdict.READY_TO_MERGE: "✅",
            MergeVerdict.MERGE_WITH_CHANGES: "🟡",
            MergeVerdict.NEEDS_REVISION: "🟠",
            MergeVerdict.BLOCKED: "🔴",
        }

        emoji = status_emoji.get(verdict, "📝")
        agents_str = (
            ", ".join(agents_invoked) if agents_invoked else "orchestrator only"
        )

        # Generate a prominent bottom-line summary for quick scanning
        bottom_line = self._generate_bottom_line(
            verdict=verdict,
            ci_status=ci_status,
            unresolved_count=unresolved_count,
            new_count=new_count,
            blockers=blockers,
        )

        # Build validation section if there are validation results
        validation_section = ""
        if (
            dismissed_false_positive_count > 0
            or confirmed_valid_count > 0
            or needs_human_review_count > 0
        ):
            validation_section = f"""
### Finding Validation
- 🔍 **Dismissed as False Positives**: {dismissed_false_positive_count} findings were re-investigated and found to be incorrect
- ✓ **Confirmed Valid**: {confirmed_valid_count} findings verified as genuine issues
- 👤 **Needs Human Review**: {needs_human_review_count} findings require manual verification
"""

        # Build blockers section if there are any blockers
        blockers_section = ""
        if blockers:
            blockers_list = "\n".join(f"- {b}" for b in blockers)
            blockers_section = f"""
### 🚨 Blocking Issues
{blockers_list}
"""

        summary = f"""## {emoji} Follow-up Review: {verdict.value.replace("_", " ").title()}

> {bottom_line}

### Resolution Status
- ✅ **Resolved**: {resolved_count} previous findings addressed
- ❌ **Unresolved**: {unresolved_count} previous findings remain
- 🆕 **New Issues**: {new_count} new findings in recent changes
{validation_section}{blockers_section}
### Verdict
{verdict_reasoning}

### Review Process
Agents invoked: {agents_str}

---
*This is an AI-generated follow-up review using parallel specialist analysis with finding validation.*
"""
        return summary

    def _generate_bottom_line(
        self,
        verdict: MergeVerdict,
        ci_status: dict | None,
        unresolved_count: int,
        new_count: int,
        blockers: list[str],
    ) -> str:
        """Generate a one-line summary for quick scanning at the top of the review."""
        # Check CI status
        ci = ci_status or {}
        pending_ci = ci.get("pending", 0)
        failing_ci = ci.get("failing", 0)
        awaiting_approval = ci.get("awaiting_approval", 0)

        # Count blocking issues (excluding CI-related ones)
        code_blockers = [
            b for b in blockers if "CI" not in b and "Merge Conflict" not in b
        ]
        has_merge_conflicts = any("Merge Conflict" in b for b in blockers)

        # Determine the bottom line based on verdict and context
        if verdict == MergeVerdict.READY_TO_MERGE:
            return "**✅ Ready to merge** - All checks passing and findings addressed."

        elif verdict == MergeVerdict.BLOCKED:
            if has_merge_conflicts:
                return "**🔴 Blocked** - Merge conflicts must be resolved before merge."
            elif failing_ci > 0:
                return f"**🔴 Blocked** - {failing_ci} CI check(s) failing. Fix CI before merge."
            elif awaiting_approval > 0:
                return "**🔴 Blocked** - Awaiting maintainer approval for fork PR workflow."
            elif code_blockers:
                return f"**🔴 Blocked** - {len(code_blockers)} blocking issue(s) require fixes."
            else:
                return "**🔴 Blocked** - Critical issues must be resolved before merge."

        elif verdict == MergeVerdict.NEEDS_REVISION:
            # Key insight: distinguish "waiting on CI" from "needs code fixes"
            # Check code issues FIRST before checking pending CI
            if unresolved_count > 0:
                return f"**🟠 Needs revision** - {unresolved_count} unresolved finding(s) from previous review."
            elif code_blockers:
                return f"**🟠 Needs revision** - {len(code_blockers)} blocking issue(s) require fixes."
            elif new_count > 0:
                return f"**🟠 Needs revision** - {new_count} new issue(s) found in recent changes."
            elif pending_ci > 0:
                # Only show "Ready once CI passes" when no code issues exist
                return f"**⏳ Ready once CI passes** - {pending_ci} check(s) pending, all findings addressed."
            else:
                return "**🟠 Needs revision** - See details below."

        elif verdict == MergeVerdict.MERGE_WITH_CHANGES:
            if pending_ci > 0:
                return (
                    "**🟡 Can merge once CI passes** - Minor suggestions, no blockers."
                )
            else:
                return "**🟡 Can merge** - Minor suggestions noted, no blockers."

        return "**📝 Review complete** - See details below."

"""
PR Review Tools
===============

Tool implementations for the orchestrating PR review agent.
Provides subagent spawning, test execution, and verification tools.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path

try:
    from ...core.client import create_client
    from ..context_gatherer import PRContext
    from ..models import PRReviewFinding, ReviewSeverity
    from .category_utils import map_category
except (ImportError, ValueError, SystemError):
    from category_utils import map_category
    from context_gatherer import PRContext
    from core.client import create_client
    from models import PRReviewFinding, ReviewSeverity

# TestDiscovery was removed - tests are now co-located in their respective modules

logger = logging.getLogger(__name__)


# Use shared category mapping from category_utils
_map_category = map_category


@dataclass
class TestResult:
    """Result from test execution."""

    executed: bool
    passed: bool
    failed_count: int = 0
    total_count: int = 0
    coverage: float | None = None
    error: str | None = None


@dataclass
class CoverageResult:
    """Result from coverage check."""

    new_lines_covered: int
    total_new_lines: int
    percentage: float


@dataclass
class PathCheckResult:
    """Result from path existence check."""

    exists: bool
    path: str


# ============================================================================
# Subagent Spawning Tools
# ============================================================================


async def spawn_security_review(
    files: list[str],
    focus_areas: list[str],
    pr_context: PRContext,
    project_dir: Path,
    github_dir: Path,
    model: str = "claude-sonnet-4-5-20250929",
    betas: list[str] | None = None,
    fast_mode: bool = False,
) -> list[PRReviewFinding]:
    """
    Spawn a focused security review subagent for specific files.

    Args:
        files: List of file paths to review
        focus_areas: Security focus areas (e.g., ["authentication", "sql_injection"])
        pr_context: Full PR context
        project_dir: Project root directory
        github_dir: GitHub state directory
        model: Model to use for subagent (default: Sonnet 4.5)

    Returns:
        List of security findings
    """
    logger.info(
        f"[Orchestrator] Spawning security review for {len(files)} files: {focus_areas}"
    )

    try:
        # Build focused context with only specified files
        focused_patches = _build_focused_patches(files, pr_context)

        # Load security agent prompt
        prompt_file = (
            Path(__file__).parent.parent.parent.parent
            / "prompts"
            / "github"
            / "pr_security_agent.md"
        )
        if prompt_file.exists():
            base_prompt = prompt_file.read_text(encoding="utf-8")
        else:
            logger.warning("Security agent prompt not found, using fallback")
            base_prompt = _get_fallback_security_prompt()

        # Build full prompt with focused context
        full_prompt = _build_subagent_prompt(
            base_prompt=base_prompt,
            pr_context=pr_context,
            focused_patches=focused_patches,
            focus_areas=focus_areas,
        )

        # Spawn security review agent
        project_root = (
            project_dir.parent.parent if project_dir.name == "backend" else project_dir
        )

        client = create_client(
            project_dir=project_root,
            spec_dir=github_dir,
            model=model,
            agent_type="pr_reviewer",  # Read-only - no bash, no edits
            betas=betas or [],
            fast_mode=fast_mode,
        )

        # Run review session
        result_text = ""
        async with client:
            await client.query(full_prompt)

            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        # Must check block type - only TextBlock has .text attribute
                        block_type = type(block).__name__
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            result_text += block.text

        # Parse findings
        findings = _parse_findings_from_response(result_text, source="security_agent")
        logger.info(
            f"[Orchestrator] Security review complete: {len(findings)} findings"
        )
        return findings

    except Exception as e:
        logger.error(f"[Orchestrator] Security review failed: {e}")
        return []


async def spawn_quality_review(
    files: list[str],
    focus_areas: list[str],
    pr_context: PRContext,
    project_dir: Path,
    github_dir: Path,
    model: str = "claude-sonnet-4-5-20250929",
    betas: list[str] | None = None,
    fast_mode: bool = False,
) -> list[PRReviewFinding]:
    """
    Spawn a focused code quality review subagent for specific files.

    Args:
        files: List of file paths to review
        focus_areas: Quality focus areas (e.g., ["complexity", "error_handling"])
        pr_context: Full PR context
        project_dir: Project root directory
        github_dir: GitHub state directory
        model: Model to use for subagent

    Returns:
        List of quality findings
    """
    logger.info(
        f"[Orchestrator] Spawning quality review for {len(files)} files: {focus_areas}"
    )

    try:
        focused_patches = _build_focused_patches(files, pr_context)

        # Load quality agent prompt
        prompt_file = (
            Path(__file__).parent.parent.parent.parent
            / "prompts"
            / "github"
            / "pr_quality_agent.md"
        )
        if prompt_file.exists():
            base_prompt = prompt_file.read_text(encoding="utf-8")
        else:
            logger.warning("Quality agent prompt not found, using fallback")
            base_prompt = _get_fallback_quality_prompt()

        full_prompt = _build_subagent_prompt(
            base_prompt=base_prompt,
            pr_context=pr_context,
            focused_patches=focused_patches,
            focus_areas=focus_areas,
        )

        project_root = (
            project_dir.parent.parent if project_dir.name == "backend" else project_dir
        )

        client = create_client(
            project_dir=project_root,
            spec_dir=github_dir,
            model=model,
            agent_type="pr_reviewer",  # Read-only - no bash, no edits
            betas=betas or [],
            fast_mode=fast_mode,
        )

        result_text = ""
        async with client:
            await client.query(full_prompt)

            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        # Must check block type - only TextBlock has .text attribute
                        block_type = type(block).__name__
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            result_text += block.text

        findings = _parse_findings_from_response(result_text, source="quality_agent")
        logger.info(f"[Orchestrator] Quality review complete: {len(findings)} findings")
        return findings

    except Exception as e:
        logger.error(f"[Orchestrator] Quality review failed: {e}")
        return []


async def spawn_deep_analysis(
    files: list[str],
    focus_question: str,
    pr_context: PRContext,
    project_dir: Path,
    github_dir: Path,
    model: str = "claude-sonnet-4-5-20250929",
    betas: list[str] | None = None,
    fast_mode: bool = False,
) -> list[PRReviewFinding]:
    """
    Spawn a deep analysis subagent to investigate a specific concern.

    Args:
        files: List of file paths to analyze
        focus_question: Specific question to investigate
        pr_context: Full PR context
        project_dir: Project root directory
        github_dir: GitHub state directory
        model: Model to use for subagent

    Returns:
        List of findings from deep analysis
    """
    logger.info(f"[Orchestrator] Spawning deep analysis for: {focus_question}")

    try:
        focused_patches = _build_focused_patches(files, pr_context)

        # Build deep analysis prompt
        base_prompt = f"""# Deep Analysis Request

**Question to Investigate:**
{focus_question}

**Focus Files:**
{", ".join(files)}

Your task is to perform a deep analysis to answer this question. Review the provided code changes carefully and provide specific findings if issues are discovered.

Output findings in JSON format:
```json
[
  {{
    "file": "path/to/file",
    "line": 123,
    "title": "Brief issue title",
    "description": "Detailed explanation",
    "category": "quality",
    "severity": "medium",
    "suggestion": "How to fix",
    "confidence": 85
  }}
]
```
"""

        full_prompt = _build_subagent_prompt(
            base_prompt=base_prompt,
            pr_context=pr_context,
            focused_patches=focused_patches,
            focus_areas=[],
        )

        project_root = (
            project_dir.parent.parent if project_dir.name == "backend" else project_dir
        )

        client = create_client(
            project_dir=project_root,
            spec_dir=github_dir,
            model=model,
            agent_type="pr_reviewer",  # Read-only - no bash, no edits
            betas=betas or [],
            fast_mode=fast_mode,
        )

        result_text = ""
        async with client:
            await client.query(full_prompt)

            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        # Must check block type - only TextBlock has .text attribute
                        block_type = type(block).__name__
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            result_text += block.text

        findings = _parse_findings_from_response(result_text, source="deep_analysis")
        logger.info(f"[Orchestrator] Deep analysis complete: {len(findings)} findings")
        return findings

    except Exception as e:
        logger.error(f"[Orchestrator] Deep analysis failed: {e}")
        return []


# ============================================================================
# Verification Tools
# ============================================================================


async def run_tests(
    project_dir: Path,
    test_paths: list[str] | None = None,
) -> TestResult:
    """
    Run project test suite.

    Args:
        project_dir: Project root directory
        test_paths: Specific test paths to run (optional)

    Returns:
        TestResult with execution status and results
    """
    logger.info("[Orchestrator] Running tests...")

    # Determine test command based on project configuration
    # Try common test commands in order of preference
    test_commands = [
        "pytest --cov=.",  # Python with coverage
        "pytest",  # Python
        "npm test",  # Node.js
        "npm run test",  # Node.js (script form)
        "python -m pytest",  # Python alternative
    ]

    try:
        # Execute tests with timeout - try common commands
        for test_cmd in test_commands:
            logger.info(f"[Orchestrator] Attempting: {test_cmd}")
            proc = await asyncio.create_subprocess_shell(
                test_cmd,
                cwd=project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=300.0,  # 5 min max
                )
                # If command not found (127) or not executable (126), try next command
                # For any other exit code (including test failures), the test framework exists
                if proc.returncode in (126, 127):
                    # Command not found or not executable - try next one
                    continue
                # Test ran (may have passed or failed) - return result
                passed = proc.returncode == 0
                logger.info(f"[Orchestrator] Tests {'passed' if passed else 'failed'}")
                return TestResult(
                    executed=True,
                    passed=passed,
                    error=None if passed else stderr.decode("utf-8")[:500],
                )
            except asyncio.TimeoutError:
                # Command timed out - kill it and try next command
                proc.kill()
                await proc.wait()  # Ensure process is fully terminated
                continue
            except FileNotFoundError:
                # Command not found - try next one
                continue

        # If no test command worked
        logger.warning("[Orchestrator] No test command could be executed")
        return TestResult(
            executed=False, passed=False, error="No test command available"
        )

    except Exception as e:
        logger.error(f"[Orchestrator] Test execution failed: {e}")
        return TestResult(executed=False, passed=False, error=str(e))


async def check_coverage(
    project_dir: Path,
    changed_files: list[str],
) -> CoverageResult | None:
    """
    Check test coverage for changed lines.

    Args:
        project_dir: Project root directory
        changed_files: List of changed file paths

    Returns:
        CoverageResult or None if coverage unavailable
    """
    logger.info("[Orchestrator] Checking test coverage...")

    try:
        # This is a simplified version - real implementation would parse coverage reports
        # For now, return None to indicate coverage check not implemented
        logger.warning("[Orchestrator] Coverage check not yet implemented")
        return None

    except Exception as e:
        logger.error(f"[Orchestrator] Coverage check failed: {e}")
        return None


async def verify_path_exists(
    project_dir: Path,
    path: str,
) -> PathCheckResult:
    """
    Verify if a file path exists in the repository.

    Args:
        project_dir: Project root directory
        path: Path to check (can be absolute or relative)

    Returns:
        PathCheckResult with exists status
    """
    try:
        # Try as absolute path
        abs_path = Path(path)
        if abs_path.is_absolute() and abs_path.exists():
            return PathCheckResult(exists=True, path=str(abs_path))

        # Try as relative to project
        rel_path = project_dir / path
        if rel_path.exists():
            return PathCheckResult(exists=True, path=str(rel_path))

        return PathCheckResult(exists=False, path=path)

    except Exception as e:
        logger.error(f"[Orchestrator] Path check failed: {e}")
        return PathCheckResult(exists=False, path=path)


async def get_file_content(
    project_dir: Path,
    file_path: str,
) -> str:
    """
    Get content of a specific file.

    Args:
        project_dir: Project root directory
        file_path: Path to file

    Returns:
        File content as string, or empty if not found
    """
    try:
        full_path = project_dir / file_path
        if full_path.exists():
            return full_path.read_text(encoding="utf-8")
        return ""
    except Exception as e:
        logger.error(f"[Orchestrator] Failed to read {file_path}: {e}")
        return ""


# ============================================================================
# Helper Functions
# ============================================================================


def _build_focused_patches(files: list[str], pr_context: PRContext) -> str:
    """Build diff containing only specified files."""
    patches = []
    for changed_file in pr_context.changed_files:
        if changed_file.path in files and changed_file.patch:
            patches.append(changed_file.patch)

    return "\n".join(patches) if patches else ""


def _build_subagent_prompt(
    base_prompt: str,
    pr_context: PRContext,
    focused_patches: str,
    focus_areas: list[str],
) -> str:
    """Build full prompt for subagent with PR context."""
    focus_str = ", ".join(focus_areas) if focus_areas else "general review"

    context = f"""
## Pull Request #{pr_context.pr_number}

**Title:** {pr_context.title}
**Author:** {pr_context.author}
**Base:** {pr_context.base_branch} ← **Head:** {pr_context.head_branch}

### Description
{pr_context.description}

### Focus Areas
{focus_str}

### Code Changes
```diff
{focused_patches[:50000]}
```
"""

    return base_prompt + "\n\n---\n\n" + context


def _parse_findings_from_response(
    response_text: str, source: str
) -> list[PRReviewFinding]:
    """
    Parse PRReviewFinding objects from agent response.

    Looks for JSON array in response and converts to PRReviewFinding objects.
    """
    findings = []

    try:
        # Find JSON array in response
        start_idx = response_text.find("[")
        end_idx = response_text.rfind("]")

        if start_idx != -1 and end_idx != -1:
            json_str = response_text[start_idx : end_idx + 1]
            findings_data = json.loads(json_str)

            for data in findings_data:
                # Map category using flexible mapping
                category = _map_category(data.get("category", "quality"))

                # Map severity with fallback
                try:
                    severity = ReviewSeverity(data.get("severity", "medium").lower())
                except ValueError:
                    severity = ReviewSeverity.MEDIUM

                finding = PRReviewFinding(
                    file=data.get("file", "unknown"),
                    line=data.get("line", 0),
                    title=data.get("title", "Untitled finding"),
                    description=data.get("description", ""),
                    category=category,
                    severity=severity,
                    suggestion=data.get("suggestion", ""),
                    confidence=data.get("confidence", 80),
                    source=source,
                )
                findings.append(finding)

    except Exception as e:
        logger.error(f"[Orchestrator] Failed to parse findings: {e}")

    return findings


def _get_fallback_security_prompt() -> str:
    """Fallback security prompt if file not found."""
    return """# Security Review

Perform a focused security review of the provided code changes.

Focus on:
- SQL injection, XSS, command injection
- Authentication/authorization flaws
- Hardcoded secrets
- Insecure cryptography
- Input validation issues

Output findings in JSON format with evidence from the actual code.
"""


def _get_fallback_quality_prompt() -> str:
    """Fallback quality prompt if file not found."""
    return """# Quality Review

Perform a focused code quality review of the provided code changes.

Focus on:
- Code complexity
- Error handling
- Code duplication
- Pattern adherence
- Maintainability

Output findings in JSON format with evidence from the actual code.
"""

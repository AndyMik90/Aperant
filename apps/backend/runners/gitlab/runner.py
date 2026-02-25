#!/usr/bin/env python3
"""
GitLab Automation Runner
========================

CLI interface for GitLab automation features:
- MR Review: AI-powered merge request review
- Follow-up Review: Review changes since last review

Usage:
    # Review a specific MR
    python runner.py review-mr 123

    # Follow-up review after new commits
    python runner.py followup-review-mr 123
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Validate platform-specific dependencies BEFORE any imports that might
# trigger graphiti_core -> real_ladybug -> pywintypes import chain (ACS-253)
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file with centralized error handling
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

# Add gitlab runner directory to path for direct imports
sys.path.insert(0, str(Path(__file__).parent))

from core.io_utils import safe_print
from models import GitLabRunnerConfig
from orchestrator import GitLabOrchestrator, ProgressCallback
from phase_config import sanitize_thinking_level


def print_progress(callback: ProgressCallback) -> None:
    """Print progress updates to console."""
    prefix = ""
    if callback.mr_iid:
        prefix = f"[MR !{callback.mr_iid}] "

    safe_print(f"{prefix}[{callback.progress:3d}%] {callback.message}")


def get_config(args) -> GitLabRunnerConfig:
    """Build config from CLI args and environment."""
    token = args.token or os.environ.get("GITLAB_TOKEN", "")
    instance_url = args.instance or os.environ.get(
        "GITLAB_INSTANCE_URL", "https://gitlab.com"
    )

    # Project detection priority:
    # 1. Explicit --project flag (highest priority)
    # 2. Auto-detect from .auto-claude/gitlab/config.json (primary for multi-project setups)
    # 3. GITLAB_PROJECT env var (fallback only)
    project = args.project  # Only use explicit CLI flag initially

    if not token:
        # Try to get from glab CLI
        import subprocess

        try:
            result = subprocess.run(
                ["glab", "auth", "status", "-t"],
                capture_output=True,
                text=True,
            )
        except FileNotFoundError:
            result = None

        if result and result.returncode == 0:
            # Parse token from output
            for line in result.stdout.split("\n"):
                if "Token:" in line:
                    token = line.split("Token:")[-1].strip()
                    break

    # Auto-detect from project config (takes priority over env var)
    if not project:
        config_path = Path(args.project_dir) / ".auto-claude" / "gitlab" / "config.json"
        if config_path.exists():
            try:
                with open(config_path, encoding="utf-8") as f:
                    data = json.load(f)
                    project = data.get("project", "")
                    instance_url = data.get("instance_url", instance_url)
                    if not token:
                        token = data.get("token", "")
            except Exception as exc:
                print(f"Warning: Failed to read GitLab config: {exc}", file=sys.stderr)

    # Fall back to environment variable only if auto-detection failed
    if not project:
        project = os.environ.get("GITLAB_PROJECT", "")

    if not token:
        print(
            "Error: No GitLab token found. Set GITLAB_TOKEN or configure in project settings."
        )
        sys.exit(1)

    if not project:
        print(
            "Error: No GitLab project found. Set GITLAB_PROJECT or configure in project settings."
        )
        sys.exit(1)

    return GitLabRunnerConfig(
        token=token,
        project=project,
        instance_url=instance_url,
        model=args.model,
        thinking_level=args.thinking_level,
    )


async def cmd_review_mr(args) -> int:
    """Review a merge request."""
    import sys

    # Force unbuffered output so Electron sees it in real-time
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    safe_print(f"[DEBUG] Starting MR review for MR !{args.mr_iid}")
    safe_print(f"[DEBUG] Project directory: {args.project_dir}")

    safe_print("[DEBUG] Building config...")
    config = get_config(args)
    safe_print(f"[DEBUG] Config built: project={config.project}, model={config.model}")

    safe_print("[DEBUG] Creating orchestrator...")
    orchestrator = GitLabOrchestrator(
        project_dir=args.project_dir,
        config=config,
        progress_callback=print_progress,
    )
    safe_print("[DEBUG] Orchestrator created")

    safe_print(f"[DEBUG] Calling orchestrator.review_mr({args.mr_iid})...")
    result = await orchestrator.review_mr(args.mr_iid)
    safe_print(f"[DEBUG] review_mr returned, success={result.success}")

    if result.success:
        print(f"\n{'=' * 60}")
        print(f"MR !{result.mr_iid} Review Complete")
        print(f"{'=' * 60}")
        print(f"Status: {result.overall_status}")
        print(f"Verdict: {result.verdict.value}")
        print(f"Findings: {len(result.findings)}")

        if result.findings:
            print("\nFindings by severity:")
            for f in result.findings:
                emoji = {"critical": "!", "high": "*", "medium": "-", "low": "."}
                print(
                    f"  {emoji.get(f.severity.value, '?')} [{f.severity.value.upper()}] {f.title}"
                )
                print(f"    File: {f.file}:{f.line}")
        return 0
    else:
        print(f"\nReview failed: {result.error}")
        return 1


async def cmd_followup_review_mr(args) -> int:
    """Perform a follow-up review of a merge request."""
    import sys

    # Force unbuffered output
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    safe_print(f"[DEBUG] Starting follow-up review for MR !{args.mr_iid}")
    safe_print(f"[DEBUG] Project directory: {args.project_dir}")

    safe_print("[DEBUG] Building config...")
    config = get_config(args)
    safe_print(f"[DEBUG] Config built: project={config.project}, model={config.model}")

    safe_print("[DEBUG] Creating orchestrator...")
    orchestrator = GitLabOrchestrator(
        project_dir=args.project_dir,
        config=config,
        progress_callback=print_progress,
    )
    safe_print("[DEBUG] Orchestrator created")

    safe_print(f"[DEBUG] Calling orchestrator.followup_review_mr({args.mr_iid})...")

    try:
        result = await orchestrator.followup_review_mr(args.mr_iid)
    except ValueError as e:
        print(f"\nFollow-up review failed: {e}")
        return 1

    safe_print(f"[DEBUG] followup_review_mr returned, success={result.success}")

    if result.success:
        print(f"\n{'=' * 60}")
        print(f"MR !{result.mr_iid} Follow-up Review Complete")
        print(f"{'=' * 60}")
        print(f"Status: {result.overall_status}")
        print(f"Is Follow-up: {result.is_followup_review}")

        if result.resolved_findings:
            print(f"Resolved: {len(result.resolved_findings)} finding(s)")
        if result.unresolved_findings:
            print(f"Still Open: {len(result.unresolved_findings)} finding(s)")
        if result.new_findings_since_last_review:
            print(
                f"New Issues: {len(result.new_findings_since_last_review)} finding(s)"
            )

        print(f"\nSummary:\n{result.summary[:500]}...")

        if result.findings:
            print("\nRemaining Findings:")
            for f in result.findings:
                emoji = {"critical": "!", "high": "*", "medium": "-", "low": "."}
                print(
                    f"  {emoji.get(f.severity.value, '?')} [{f.severity.value.upper()}] {f.title}"
                )
                print(f"    File: {f.file}:{f.line}")
        return 0
    else:
        print(f"\nFollow-up review failed: {result.error}")
        return 1


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="GitLab automation CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Global options
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Project directory (default: current)",
    )
    parser.add_argument(
        "--token",
        type=str,
        help="GitLab token (or set GITLAB_TOKEN)",
    )
    parser.add_argument(
        "--project",
        type=str,
        help="GitLab project (namespace/name) or auto-detect",
    )
    parser.add_argument(
        "--instance",
        type=str,
        default="https://gitlab.com",
        help="GitLab instance URL (default: https://gitlab.com)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="claude-sonnet-4-5-20250929",
        help="AI model to use",
    )
    parser.add_argument(
        "--thinking-level",
        type=str,
        default="medium",
        help="Thinking level for extended reasoning (low, medium, high)",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # review-mr command
    review_parser = subparsers.add_parser("review-mr", help="Review a merge request")
    review_parser.add_argument("mr_iid", type=int, help="MR IID to review")

    # followup-review-mr command
    followup_parser = subparsers.add_parser(
        "followup-review-mr",
        help="Follow-up review of an MR (after new commits)",
    )
    followup_parser.add_argument("mr_iid", type=int, help="MR IID to review")

    args = parser.parse_args()

    # Validate and sanitize thinking level (handles legacy values like 'ultrathink')
    args.thinking_level = sanitize_thinking_level(args.thinking_level)

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Route to command handler
    commands = {
        "review-mr": cmd_review_mr,
        "followup-review-mr": cmd_followup_review_mr,
    }

    handler = commands.get(args.command)
    if not handler:
        print(f"Unknown command: {args.command}")
        sys.exit(1)

    try:
        exit_code = asyncio.run(handler(args))
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(1)
    except Exception as e:
        import traceback

        print(f"Error: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

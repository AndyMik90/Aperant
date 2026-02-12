#!/usr/bin/env python3
"""
GitLab Automation Runner
========================

CLI interface for GitLab automation features:
- MR Review: AI-powered merge request review
- Follow-up Review: Review changes since last review
- Triage: Classify and organize issues
- Auto-fix: Automatically create specs from issues
- Batch: Group and analyze similar issues

Usage:
    # Review a specific MR
    python runner.py review-mr 123

    # Follow-up review after new commits
    python runner.py followup-review-mr 123

    # Triage issues
    python runner.py triage --state opened --limit 50

    # Auto-fix an issue
    python runner.py auto-fix 42

    # Batch similar issues
    python runner.py batch-issues --label "bug" --min 3
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


async def cmd_triage(args) -> int:
    """
    Triage and classify GitLab issues.

    Categorizes issues into: duplicates, spam, feature creep, actionable.
    """
    from glab_client import GitLabClient, GitLabConfig

    config = get_config(args)
    gitlab_config = GitLabConfig(
        token=config.token,
        project=config.project,
        instance_url=config.instance_url,
    )

    client = GitLabClient(
        project_dir=args.project_dir,
        config=gitlab_config,
    )

    safe_print(f"[Triage] Fetching issues (state={args.state}, limit={args.limit})...")

    # Fetch issues (parse comma-separated labels into list)
    label_list = args.labels.split(",") if args.labels else None
    issues = client.list_issues(
        state=args.state,
        labels=label_list,
        per_page=args.limit,
    )

    if not issues:
        safe_print("[Triage] No issues found matching criteria")
        return 0

    safe_print(f"[Triage] Found {len(issues)} issues to triage")

    # Basic triage logic
    actionable = []
    duplicates = []
    spam = []
    feature_creep = []

    for issue in issues:
        title = issue.get("title", "").lower()

        # Check for spam
        if any(word in title for word in ["test", "spam", "xxx"]):
            spam.append(issue)
            continue

        # Check for duplicates (simple heuristic)
        if any(word in title for word in ["duplicate", "already", "same"]):
            duplicates.append(issue)
            continue

        # Check for feature creep
        if any(word in title for word in ["also", "while", "additionally", "btw"]):
            feature_creep.append(issue)
            continue

        actionable.append(issue)

    # Print results
    print(f"\n{'=' * 60}")
    print("Issue Triage Results")
    print(f"{'=' * 60}")
    print(f"Total Issues: {len(issues)}")
    print(f"  Actionable: {len(actionable)}")
    print(f"  Duplicates: {len(duplicates)}")
    print(f"  Spam: {len(spam)}")
    print(f"  Feature Creep: {len(feature_creep)}")

    if args.verbose and actionable[:10]:
        print("\nActionable Issues (showing first 10):")
        for issue in actionable[:10]:
            iid = issue.get("iid")
            title = issue.get("title", "No title")
            labels = issue.get("labels", [])
            print(f"  !{iid}: {title}")
            print(f"      Labels: {', '.join(labels)}")

    return 0


async def cmd_auto_fix(args) -> int:
    """
    Auto-fix an issue by creating a spec.

    Analyzes the issue and creates a spec for implementation.
    """
    from glab_client import GitLabClient, GitLabConfig

    config = get_config(args)
    gitlab_config = GitLabConfig(
        token=config.token,
        project=config.project,
        instance_url=config.instance_url,
    )

    client = GitLabClient(
        project_dir=args.project_dir,
        config=gitlab_config,
    )

    safe_print(f"[Auto-fix] Fetching issue !{args.issue_iid}...")

    # Fetch issue
    issue = client.get_issue(args.issue_iid)

    if not issue:
        safe_print(f"[Auto-fix] Issue !{args.issue_iid} not found")
        return 1

    title = issue.get("title", "")
    description = issue.get("description", "")
    raw_labels = issue.get("labels", [])
    author = issue.get("author", {}).get("username", "")

    # Extract label names - GitLab API returns list of dicts with 'name' key or strings
    label_names = [
        lbl.get("name") if isinstance(lbl, dict) else lbl for lbl in raw_labels
    ]

    print(f"\n{'=' * 60}")
    print(f"Auto-fix for Issue !{args.issue_iid}")
    print(f"{'=' * 60}")
    print(f"Title: {title}")
    print(f"Author: {author}")
    print(f"Labels: {', '.join(label_names)}")
    print(f"\nDescription:\n{description[:500]}...")

    # Check if already auto-fixable
    if any(label in label_names for label in ["auto-fix", "spec-created"]):
        safe_print("[Auto-fix] Issue already marked for auto-fix or has spec")
        return 0

    # Add auto-fix label
    if not args.dry_run:
        try:
            client.update_issue(
                args.issue_iid, labels=list(set(label_names + ["auto-fix"]))
            )
            safe_print(f"[Auto-fix] Added 'auto-fix' label to issue !{args.issue_iid}")
        except Exception as e:
            safe_print(f"[Auto-fix] Failed to update issue: {e}")
            return 1
    else:
        safe_print("[Auto-fix] Dry run - would add 'auto-fix' label")

    # Note: In a full implementation, this would:
    # 1. Analyze the issue with AI
    # 2. Create a spec in .auto-claude/specs/
    # 3. Run the spec creation pipeline

    safe_print("[Auto-fix] Issue marked for auto-fix (spec creation not implemented)")
    safe_print(
        "[Auto-fix] Run 'python spec_runner.py --task \"<issue description>\"' to create spec"
    )

    return 0


async def cmd_batch_issues(args) -> int:
    """
    Batch similar issues together for analysis.

    Groups issues by labels, keywords, or patterns.
    """
    from collections import defaultdict

    from glab_client import GitLabClient, GitLabConfig

    config = get_config(args)
    gitlab_config = GitLabConfig(
        token=config.token,
        project=config.project,
        instance_url=config.instance_url,
    )

    client = GitLabClient(
        project_dir=args.project_dir,
        config=gitlab_config,
    )

    safe_print(f"[Batch] Fetching issues (label={args.label}, limit={args.limit})...")

    # Fetch issues
    issues = client.list_issues(
        state=args.state,
        labels=[args.label] if args.label else None,
        per_page=args.limit,
    )

    if not issues:
        safe_print("[Batch] No issues found matching criteria")
        return 0

    safe_print(f"[Batch] Found {len(issues)} issues")

    # Group issues by keywords
    groups = defaultdict(list)
    keywords = [
        "bug",
        "error",
        "crash",
        "fix",
        "feature",
        "enhancement",
        "add",
        "implement",
        "refactor",
        "cleanup",
        "improve",
        "docs",
        "documentation",
        "readme",
        "test",
        "testing",
        "coverage",
        "performance",
        "slow",
        "optimize",
    ]

    for issue in issues:
        title = issue.get("title", "").lower()
        description = issue.get("description", "").lower()
        combined = f"{title} {description}"

        matched = False
        for keyword in keywords:
            if keyword in combined:
                groups[keyword].append(issue)
                matched = True
                break

        if not matched:
            groups["other"].append(issue)

    # Filter groups by minimum size
    filtered_groups = {k: v for k, v in groups.items() if len(v) >= args.min}

    # Print results
    print(f"\n{'=' * 60}")
    print("Batch Analysis Results")
    print(f"{'=' * 60}")
    print(f"Total Issues: {len(issues)}")
    print(f"Groups Found: {len(filtered_groups)}")

    # Sort by group size
    sorted_groups = sorted(
        filtered_groups.items(), key=lambda x: len(x[1]), reverse=True
    )

    for keyword, group_issues in sorted_groups:
        print(f"\n[{keyword.upper()}] - {len(group_issues)} issues:")
        for issue in group_issues[:5]:  # Show first 5
            iid = issue.get("iid")
            title = issue.get("title", "No title")
            print(f"  !{iid}: {title[:60]}...")
        if len(group_issues) > 5:
            print(f"  ... and {len(group_issues) - 5} more")

    # Suggest batch actions
    if len(sorted_groups) > 0:
        largest_group, largest_issues = sorted_groups[0]
        if len(largest_issues) >= args.min:
            print("\nSuggested batch action:")
            print(f"  Group: {largest_group}")
            print(f"  Size: {len(largest_issues)} issues")
            label_arg = f"--labels {args.label}" if args.label else ""
            limit_arg = f"--limit {len(largest_issues)}"
            print(f"  Command: python runner.py triage {label_arg} {limit_arg}")

    return 0


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

    # triage command
    triage_parser = subparsers.add_parser("triage", help="Triage and classify issues")
    triage_parser.add_argument(
        "--state", type=str, default="opened", help="Issue state to filter"
    )
    triage_parser.add_argument(
        "--labels", type=str, help="Comma-separated labels to filter"
    )
    triage_parser.add_argument(
        "--limit", type=int, default=50, help="Maximum issues to process"
    )
    triage_parser.add_argument(
        "-v", "--verbose", action="store_true", help="Show detailed output"
    )

    # auto-fix command
    autofix_parser = subparsers.add_parser(
        "auto-fix", help="Auto-fix an issue by creating a spec"
    )
    autofix_parser.add_argument("issue_iid", type=int, help="Issue IID to auto-fix")
    autofix_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes",
    )

    # batch-issues command
    batch_parser = subparsers.add_parser(
        "batch-issues", help="Batch and analyze similar issues"
    )
    batch_parser.add_argument("--label", type=str, help="Label to filter issues")
    batch_parser.add_argument(
        "--state", type=str, default="opened", help="Issue state to filter"
    )
    batch_parser.add_argument(
        "--limit", type=int, default=100, help="Maximum issues to process"
    )
    batch_parser.add_argument(
        "--min", type=int, default=3, help="Minimum group size to report"
    )

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
        "triage": cmd_triage,
        "auto-fix": cmd_auto_fix,
        "batch-issues": cmd_batch_issues,
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

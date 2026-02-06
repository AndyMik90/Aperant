"""
Auto Claude CLI - Main Entry Point
===================================

Command-line interface for the Auto Claude autonomous coding framework.
"""

import argparse
import os
import sys
from pathlib import Path

# Ensure parent directory is in path for imports (before other imports)
_PARENT_DIR = Path(__file__).parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


from .batch_commands import (
    handle_batch_cleanup_command,
    handle_batch_create_command,
    handle_batch_status_command,
)
from .build_commands import handle_build_command
from .followup_commands import handle_followup_command
from .qa_commands import (
    handle_qa_command,
    handle_qa_status_command,
    handle_review_status_command,
)
from .spec_commands import print_specs_list
from .utils import (
    DEFAULT_MODEL,
    find_spec,
    get_project_dir,
    print_banner,
    setup_environment,
)
from .workspace_commands import (
    handle_cleanup_worktrees_command,
    handle_create_pr_command,
    handle_discard_command,
    handle_list_worktrees_command,
    handle_merge_command,
    handle_review_command,
)


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Auto Claude Framework - Autonomous multi-session coding agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List all specs
  python auto-claude/run.py --list

  # Run a specific spec (by number or full name)
  python auto-claude/run.py --spec 001
  python auto-claude/run.py --spec 001-initial-app

  # Workspace management (after build completes)
  python auto-claude/run.py --spec 001 --merge     # Add build to your project
  python auto-claude/run.py --spec 001 --review    # See what was built
  python auto-claude/run.py --spec 001 --discard   # Delete build (with confirmation)

  # Advanced options
  python auto-claude/run.py --spec 001 --direct       # Skip workspace isolation
  python auto-claude/run.py --spec 001 --isolated     # Force workspace isolation

  # Status checks
  python auto-claude/run.py --spec 001 --review-status  # Check human review status
  python auto-claude/run.py --spec 001 --qa-status      # Check QA validation status

Prerequisites:
  1. Authenticate: Run 'claude' and type '/login'
  2. Create a spec first: claude /spec

Environment Variables:
  CLAUDE_CODE_OAUTH_TOKEN  Your Claude Code OAuth token (auto-detected from Keychain)
                           Or authenticate via: claude → /login
  AUTO_BUILD_MODEL         Override default model (optional)
        """,
    )

    parser.add_argument(
        "--list",
        action="store_true",
        help="List all available specs and their status",
    )

    parser.add_argument(
        "--spec",
        type=str,
        default=None,
        help="Spec to run (e.g., '001' or '001-feature-name')",
    )

    parser.add_argument(
        "--project-dir",
        type=Path,
        default=None,
        help="Project directory (default: current working directory)",
    )

    parser.add_argument(
        "--max-iterations",
        type=int,
        default=None,
        help="Maximum number of agent sessions (default: unlimited)",
    )

    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help=f"Claude model to use (default: {DEFAULT_MODEL})",
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output",
    )

    # Workspace options
    workspace_group = parser.add_mutually_exclusive_group()
    workspace_group.add_argument(
        "--isolated",
        action="store_true",
        help="Force building in isolated workspace (safer)",
    )
    workspace_group.add_argument(
        "--direct",
        action="store_true",
        help="Build directly in your project (no isolation)",
    )

    # Build management commands
    build_group = parser.add_mutually_exclusive_group()
    build_group.add_argument(
        "--merge",
        action="store_true",
        help="Merge an existing build into your project",
    )
    build_group.add_argument(
        "--review",
        action="store_true",
        help="Review what an existing build contains",
    )
    build_group.add_argument(
        "--discard",
        action="store_true",
        help="Discard an existing build (requires confirmation)",
    )
    build_group.add_argument(
        "--create-pr",
        action="store_true",
        help="Push branch and create a GitHub Pull Request",
    )

    # PR options
    parser.add_argument(
        "--pr-target",
        type=str,
        metavar="BRANCH",
        help="With --create-pr: target branch for PR (default: auto-detect)",
    )
    parser.add_argument(
        "--pr-title",
        type=str,
        metavar="TITLE",
        help="With --create-pr: custom PR title (default: generated from spec name)",
    )
    parser.add_argument(
        "--pr-draft",
        action="store_true",
        help="With --create-pr: create as draft PR",
    )

    # Merge options
    parser.add_argument(
        "--no-commit",
        action="store_true",
        help="With --merge: stage changes but don't commit (review in IDE first)",
    )
    parser.add_argument(
        "--merge-preview",
        action="store_true",
        help="Preview merge conflicts without actually merging (returns JSON)",
    )

    # QA options
    parser.add_argument(
        "--qa",
        action="store_true",
        help="Run QA validation loop on a completed build",
    )
    parser.add_argument(
        "--qa-status",
        action="store_true",
        help="Show QA validation status for a spec",
    )
    parser.add_argument(
        "--skip-qa",
        action="store_true",
        help="Skip automatic QA validation after build completes",
    )

    # Follow-up options
    parser.add_argument(
        "--followup",
        action="store_true",
        help="Add follow-up tasks to a completed spec (extends existing implementation plan)",
    )

    # Review options
    parser.add_argument(
        "--review-status",
        action="store_true",
        help="Show human review/approval status for a spec",
    )

    # Non-interactive mode (for UI/automation)
    parser.add_argument(
        "--auto-continue",
        action="store_true",
        help="Non-interactive mode: auto-continue existing builds, skip prompts (for UI integration)",
    )

    # Worktree management
    parser.add_argument(
        "--list-worktrees",
        action="store_true",
        help="List all spec worktrees and their status",
    )
    parser.add_argument(
        "--cleanup-worktrees",
        action="store_true",
        help="Remove all spec worktrees and their branches (with confirmation)",
    )

    # Force bypass
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip approval check and start build anyway (for debugging)",
    )

    # Base branch for worktree creation
    parser.add_argument(
        "--base-branch",
        type=str,
        default=None,
        help="Base branch for creating worktrees (default: auto-detect or current branch)",
    )

    # Batch task management
    parser.add_argument(
        "--batch-create",
        type=str,
        default=None,
        metavar="FILE",
        help="Create multiple tasks from a batch JSON file",
    )
    parser.add_argument(
        "--batch-status",
        action="store_true",
        help="Show status of all specs in the project",
    )
    parser.add_argument(
        "--batch-cleanup",
        action="store_true",
        help="Clean up completed specs (dry-run by default)",
    )
    parser.add_argument(
        "--no-dry-run",
        action="store_true",
        help="Actually delete files in cleanup (not just preview)",
    )

    return parser.parse_args()


def main() -> None:
    """Main CLI entry point."""
    # Set up environment first
    setup_environment()

    # Initialize Sentry early to capture any startup errors
    from core.sentry import capture_exception, init_sentry

    init_sentry(component="cli")

    try:
        _run_cli()
    except KeyboardInterrupt:
        # Clean exit on Ctrl+C
        sys.exit(130)
    except Exception as e:
        # Capture unexpected errors to Sentry
        capture_exception(e)
        print(f"\nUnexpected error: {e}")
        sys.exit(1)


def _run_cli() -> None:
    """Run the CLI logic (extracted for error handling)."""
    # Import here to avoid import errors during startup
    from core.sentry import set_context

    # Parse arguments
    args = parse_args()

    # Import debug functions after environment setup
    from debug import debug, debug_error, debug_section, debug_success

    debug_section("run.py", "Starting Auto-Build Framework")
    debug("run.py", "Arguments parsed", args=vars(args))

    # Determine project directory
    project_dir = get_project_dir(args.project_dir)
    debug("run.py", f"Using project directory: {project_dir}")

    # Get model from CLI arg or env var (None if not explicitly set)
    # This allows get_phase_model() to fall back to task_metadata.json
    model = args.model or os.environ.get("AUTO_BUILD_MODEL")

    # Handle --list command
    if args.list:
        print_banner()
        print_specs_list(project_dir)
        return

    # Handle --list-worktrees command
    if args.list_worktrees:
        handle_list_worktrees_command(project_dir)
        return

    # Handle --cleanup-worktrees command
    if args.cleanup_worktrees:
        handle_cleanup_worktrees_command(project_dir)
        return

    # Handle batch commands
    if args.batch_create:
        handle_batch_create_command(args.batch_create, str(project_dir))
        return

    if args.batch_status:
        handle_batch_status_command(str(project_dir))
        return

    if args.batch_cleanup:
        handle_batch_cleanup_command(str(project_dir), dry_run=not args.no_dry_run)
        return

    # Require --spec if not listing
    if not args.spec:
        print_banner()
        print("\nError: --spec is required")
        print("\nUsage:")
        print("  python auto-claude/run.py --list           # See all specs")
        print("  python auto-claude/run.py --spec 001       # Run a spec")
        print("\nCreate a new spec with:")
        print("  claude /spec")
        sys.exit(1)

    # Find the spec
    debug("run.py", "Finding spec", spec_identifier=args.spec)
    spec_dir = find_spec(project_dir, args.spec)
    if not spec_dir:
        debug_error("run.py", "Spec not found", spec=args.spec)
        print_banner()
        print(f"\nError: Spec '{args.spec}' not found")
        print("\nAvailable specs:")
        print_specs_list(project_dir)
        sys.exit(1)

    debug_success("run.py", "Spec found", spec_dir=str(spec_dir))

    # Set Sentry context for error tracking
    set_context(
        "spec",
        {
            "name": spec_dir.name,
            "project": str(project_dir),
        },
    )

    # Handle build management commands
    if args.merge_preview:
        from cli.workspace_commands import handle_merge_preview_command

        result = handle_merge_preview_command(
            project_dir, spec_dir.name, base_branch=args.base_branch
        )
        # Output as JSON for the UI to parse
        import json

        print(json.dumps(result))
        return

    if args.merge:
        success = handle_merge_command(
            project_dir,
            spec_dir.name,
            no_commit=args.no_commit,
            base_branch=args.base_branch,
        )
        if not success:
            sys.exit(1)
        return

    if args.review:
        handle_review_command(project_dir, spec_dir.name)
        return

    if args.discard:
        handle_discard_command(project_dir, spec_dir.name)
        return

    if args.create_pr:
        # Pass args.pr_target directly - WorktreeManager._detect_base_branch
        # handles base branch detection internally when target_branch is None
        result = handle_create_pr_command(
            project_dir=project_dir,
            spec_name=spec_dir.name,
            target_branch=args.pr_target,
            title=args.pr_title,
            draft=args.pr_draft,
        )
        # JSON output is already printed by handle_create_pr_command
        if not result.get("success"):
            sys.exit(1)
        return

    # Handle QA commands
    if args.qa_status:
        handle_qa_status_command(spec_dir)
        return

    if args.review_status:
        handle_review_status_command(spec_dir)
        return

    if args.qa:
        handle_qa_command(
            project_dir=project_dir,
            spec_dir=spec_dir,
            model=model,
            verbose=args.verbose,
        )
        return

    # Handle --followup command
    if args.followup:
        handle_followup_command(
            project_dir=project_dir,
            spec_dir=spec_dir,
            model=model,
            verbose=args.verbose,
        )
        return

    # Normal build flow
    handle_build_command(
        project_dir=project_dir,
        spec_dir=spec_dir,
        model=model,
        max_iterations=args.max_iterations,
        verbose=args.verbose,
        force_isolated=args.isolated,
        force_direct=args.direct,
        auto_continue=args.auto_continue,
        skip_qa=args.skip_qa,
        force_bypass_approval=args.force,
        base_branch=args.base_branch,
    )


if __name__ == "__main__":
    main()

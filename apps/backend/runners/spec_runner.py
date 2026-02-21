#!/usr/bin/env python3
"""
Spec Creation Orchestrator
==========================

Dynamic spec creation with complexity-based phase selection.
The orchestrator uses AI to evaluate task complexity and adapts its process accordingly.

Complexity Assessment:
- By default, uses AI (complexity_assessor.md prompt) to analyze the task
- AI considers: scope, integrations, infrastructure, knowledge requirements, risk
- Falls back to heuristic analysis if AI assessment fails
- Use --no-ai-assessment to skip AI and use heuristics only

Complexity Tiers:
- SIMPLE (1-2 files): Discovery → Quick Spec → Validate (3 phases)
- STANDARD (3-10 files): Discovery → Requirements → Context → Spec → Plan → Validate (6 phases)
- STANDARD + Research: Same as above but with research phase for external dependencies (7 phases)
- COMPLEX (10+ files/integrations): Full 8-phase pipeline with research and self-critique

The AI considers:
- Number of files/services involved
- External integrations and research requirements
- Infrastructure changes (Docker, databases, etc.)
- Whether codebase has existing patterns to follow
- Risk factors and edge cases

Usage:
    python runners/spec_runner.py --task "Add user authentication"
    python runners/spec_runner.py --interactive
    python runners/spec_runner.py --continue 001-feature
    python runners/spec_runner.py --task "Fix button color" --complexity simple
    python runners/spec_runner.py --task "Simple fix" --no-ai-assessment
"""

import sys

# Python version check - must be before any imports using 3.10+ syntax
if sys.version_info < (3, 10):  # noqa: UP036
    sys.exit(
        f"Error: Auto Claude requires Python 3.10 or higher.\n"
        f"You are running Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}\n"
        f"\n"
        f"Please upgrade Python: https://www.python.org/downloads/"
    )

import asyncio
import io
import json
import os
import subprocess
from pathlib import Path

# Configure safe encoding on Windows BEFORE any imports that might print
# This handles both TTY and piped output (e.g., from Electron)
if sys.platform == "win32":
    for _stream_name in ("stdout", "stderr"):
        _stream = getattr(sys, _stream_name)
        # Method 1: Try reconfigure (works for TTY)
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
                continue
            except (AttributeError, io.UnsupportedOperation, OSError):
                pass
        # Method 2: Wrap with TextIOWrapper for piped output
        try:
            if hasattr(_stream, "buffer"):
                _new_stream = io.TextIOWrapper(
                    _stream.buffer,
                    encoding="utf-8",
                    errors="replace",
                    line_buffering=True,
                )
                setattr(sys, _stream_name, _new_stream)
        except (AttributeError, io.UnsupportedOperation, OSError):
            pass
    # Clean up temporary variables
    del _stream_name, _stream
    if "_new_stream" in dir():
        del _new_stream

# Add auto-claude to path (parent of runners/)
sys.path.insert(0, str(Path(__file__).parent.parent))

# Validate platform-specific dependencies BEFORE any imports that might
# trigger graphiti_core -> real_ladybug -> pywintypes import chain (ACS-253)
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file with centralized error handling
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent / ".env"
dev_env_file = Path(__file__).parent.parent.parent / "dev" / "auto-claude" / ".env"
if env_file.exists():
    load_dotenv(env_file)
elif dev_env_file.exists():
    load_dotenv(dev_env_file)

# Initialize Sentry early to capture any startup errors
from core.sentry import capture_exception, init_sentry

init_sentry(component="spec-runner")

from core.platform import is_windows
from debug import debug, debug_error, debug_section, debug_success
from phase_config import resolve_model_id, sanitize_thinking_level
from review import ReviewState
from spec import SpecOrchestrator
from ui import Icons, highlight, muted, print_section, print_status


def main():
    """CLI entry point."""
    debug_section("spec_runner", "Spec Runner CLI")
    import argparse

    parser = argparse.ArgumentParser(
        description="Dynamic spec creation with complexity-based phase selection",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Complexity Tiers:
  simple    - 3 phases: Discovery → Quick Spec → Validate (1-2 files)
  standard  - 6 phases: Discovery → Requirements → Context → Spec → Plan → Validate
  complex   - 8 phases: Full pipeline with research and self-critique

Examples:
  # Simple UI fix (auto-detected as simple)
  python spec_runner.py --task "Fix button color in Header component"

  # Force simple mode
  python spec_runner.py --task "Update text" --complexity simple

  # Complex integration (auto-detected)
  python spec_runner.py --task "Add Graphiti memory integration with LadybugDB"

  # Interactive mode
  python spec_runner.py --interactive
        """,
    )
    parser.add_argument(
        "--task",
        type=str,
        help="Task description (what to build). For very long descriptions, use --task-file instead.",
    )
    parser.add_argument(
        "--task-file",
        type=Path,
        help="Read task description from a file (useful for long specs)",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Run in interactive mode (gather requirements from user)",
    )
    parser.add_argument(
        "--continue",
        dest="continue_spec",
        type=str,
        help="Continue an existing spec",
    )
    parser.add_argument(
        "--complexity",
        type=str,
        choices=["simple", "standard", "complex"],
        help="Override automatic complexity detection",
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Project directory (default: current directory)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="sonnet",
        help="Model to use for agent phases (haiku, sonnet, opus, or full model ID)",
    )
    parser.add_argument(
        "--thinking-level",
        type=str,
        default="medium",
        help="Thinking level for extended thinking (low, medium, high)",
    )
    parser.add_argument(
        "--no-ai-assessment",
        action="store_true",
        help="Use heuristic complexity assessment instead of AI (faster but less accurate)",
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="Don't automatically start the build after spec creation (default: auto-start build)",
    )
    parser.add_argument(
        "--spec-dir",
        type=Path,
        help="Use existing spec directory instead of creating a new one (for UI integration)",
    )
    parser.add_argument(
        "--auto-approve",
        action="store_true",
        help="Skip human review checkpoint and automatically approve spec for building",
    )
    parser.add_argument(
        "--base-branch",
        type=str,
        default=None,
        help="Base branch for creating worktrees (default: auto-detect or current branch)",
    )
    parser.add_argument(
        "--direct",
        action="store_true",
        help="Build directly in project without worktree isolation (default: use isolated worktree)",
    )

    args = parser.parse_args()

    # Validate and sanitize thinking level (handles legacy values like 'ultrathink')
    args.thinking_level = sanitize_thinking_level(args.thinking_level)

    # Warn user about direct mode risks
    if args.direct:
        print_status(
            "Direct mode: Building in project directory without worktree isolation",
            "warning",
        )

    # Handle task from file if provided
    task_description = args.task
    if args.task_file:
        if not args.task_file.exists():
            print(f"Error: Task file not found: {args.task_file}")
            sys.exit(1)
        task_description = args.task_file.read_text(encoding="utf-8").strip()
        if not task_description:
            print(f"Error: Task file is empty: {args.task_file}")
            sys.exit(1)

    # Validate task description isn't problematic
    if task_description:
        # Warn about very long descriptions but don't block
        if len(task_description) > 5000:
            print(
                f"Warning: Task description is very long ({len(task_description)} chars). Consider breaking into subtasks."
            )
        # Sanitize null bytes which could cause issues
        task_description = task_description.replace("\x00", "")

    # Find project root (look for auto-claude folder)
    project_dir = args.project_dir

    # Auto-detect if running from within auto-claude/apps/backend/ source directory.
    # This must be specific: check for run.py FILE (not dir) AND core/client.py to confirm
    # we're in the actual backend source tree, not just a project named "auto-claude".
    run_py_path = project_dir / "run.py"
    if (
        project_dir.name == "auto-claude"
        and run_py_path.exists()
        and run_py_path.is_file()
        and (project_dir / "core" / "client.py").exists()
    ):
        # Running from within auto-claude/apps/backend/ source directory, go up 1 level
        project_dir = project_dir.parent
    elif not (project_dir / ".auto-claude").exists():
        # No .auto-claude folder found - try to find project root
        # First check for .auto-claude (installed instance)
        for parent in project_dir.parents:
            if (parent / ".auto-claude").exists():
                project_dir = parent
                break

    # Resolve model shorthand to full model ID
    resolved_model = resolve_model_id(args.model)

    debug(
        "spec_runner",
        "Creating spec orchestrator",
        project_dir=str(project_dir),
        task_description=task_description[:200] if task_description else None,
        model=resolved_model,
        thinking_level=args.thinking_level,
        complexity_override=args.complexity,
        use_ai_assessment=not args.no_ai_assessment,
        interactive=args.interactive or not task_description,
        auto_approve=args.auto_approve,
    )

    orchestrator = SpecOrchestrator(
        project_dir=project_dir,
        task_description=task_description,
        spec_name=args.continue_spec,
        spec_dir=args.spec_dir,
        model=resolved_model,
        thinking_level=args.thinking_level,
        complexity_override=args.complexity,
        use_ai_assessment=not args.no_ai_assessment,
    )

    try:
        debug("spec_runner", "Starting spec orchestrator run...")
        success = asyncio.run(
            orchestrator.run(
                interactive=args.interactive or not task_description,
                auto_approve=args.auto_approve,
            )
        )

        if not success:
            debug_error("spec_runner", "Spec creation failed")
            sys.exit(1)

        debug_success(
            "spec_runner",
            "Spec creation succeeded",
            spec_dir=str(orchestrator.spec_dir),
        )

        # Auto-start build unless --no-build is specified
        if not args.no_build:
            debug("spec_runner", "Checking if spec is approved for build...")
            # Verify spec is approved before starting build (defensive check)
            review_state = ReviewState.load(orchestrator.spec_dir)
            if not review_state.is_approved():
                debug_error("spec_runner", "Spec not approved - cannot start build")
                print()
                print_status("Build cannot start: spec not approved.", "error")
                print()
                print(f"  {muted('To approve the spec, run:')}")
                print(
                    f"  {highlight(f'python auto-claude/review.py --spec-dir {orchestrator.spec_dir}')}"
                )
                print()
                print(
                    f"  {muted('Or re-run spec_runner with --auto-approve to skip review:')}"
                )
                example_cmd = (
                    'python auto-claude/spec_runner.py --task "..." --auto-approve'
                )
                print(f"  {highlight(example_cmd)}")
                sys.exit(1)

            debug_success("spec_runner", "Spec approved - starting build")
            print()
            print_section("STARTING BUILD", Icons.LIGHTNING)
            print()

            # Build the run.py command
            run_script = Path(__file__).parent.parent / "run.py"
            run_cmd = [
                sys.executable,
                str(run_script),
                "--spec",
                orchestrator.spec_dir.name,
                "--project-dir",
                str(orchestrator.project_dir),
                "--auto-continue",  # Non-interactive mode for chained execution
            ]

            # Bypass approval re-validation when all conditions are met:
            # 1. Spec was auto-approved (no human review required)
            # 2. Spec creation succeeded (we're past the success check above)
            # 3. No review-before-coding gate was requested
            # This prevents hash mismatch failures when spec files are
            # touched between auto-approval and run.py startup.
            if args.auto_approve:
                # Default to requiring review (fail-closed) - only skip if explicitly disabled
                require_review = True
                task_meta_path = orchestrator.spec_dir / "task_metadata.json"
                if task_meta_path.exists():
                    try:
                        with open(task_meta_path, encoding="utf-8") as f:
                            task_meta = json.load(f)
                        require_review = task_meta.get(
                            "requireReviewBeforeCoding", False
                        )
                    except (json.JSONDecodeError, OSError) as e:
                        # On parse error, keep require_review=True (fail-closed)
                        debug(
                            "spec_runner",
                            f"Failed to parse task_metadata.json, not adding --force: {e}",
                        )
                if not require_review:
                    run_cmd.append("--force")
                    debug(
                        "spec_runner",
                        "Adding --force: auto-approved, no review required, spec completed",
                    )

            # Pass base branch if specified (for worktree creation)
            if args.base_branch:
                run_cmd.extend(["--base-branch", args.base_branch])

            # Pass --direct flag if specified (skip worktree isolation)
            if args.direct:
                run_cmd.append("--direct")

            # Note: Model configuration for subsequent phases (planning, coding, qa)
            # is read from task_metadata.json by run.py, so we don't pass it here.
            # This allows per-phase configuration when using Auto profile.

            debug(
                "spec_runner",
                "Executing run.py for build",
                command=" ".join(run_cmd),
            )
            print(f"  {muted('Running:')} {' '.join(run_cmd)}")
            print()

            # Execute run.py - use subprocess on Windows to maintain connection with Electron
            # Fix for issue #609: os.execv() breaks connection on Windows
            if is_windows():
                try:
                    result = subprocess.run(run_cmd)
                    sys.exit(result.returncode)
                except FileNotFoundError:
                    debug_error(
                        "spec_runner",
                        "Could not start coding phase - executable not found",
                    )
                    print_status(
                        "Could not start coding phase - executable not found", "error"
                    )
                    sys.exit(1)
                except OSError as e:
                    debug_error("spec_runner", f"Error starting coding phase: {e}")
                    print_status(f"Error starting coding phase: {e}", "error")
                    sys.exit(1)
                except KeyboardInterrupt:
                    debug_error("spec_runner", "Coding phase interrupted by user")
                    print("\n\nCoding phase interrupted.")
                    sys.exit(1)
            else:
                # On Unix/macOS, os.execv() works correctly - replaces current process
                os.execv(sys.executable, run_cmd)

        sys.exit(0)

    except KeyboardInterrupt:
        debug_error("spec_runner", "Spec creation interrupted by user")
        print("\n\nSpec creation interrupted.")
        print(
            f"To continue: python auto-claude/spec_runner.py --continue {orchestrator.spec_dir.name}"
        )
        sys.exit(1)
    except Exception as e:
        # Capture unexpected errors to Sentry
        capture_exception(
            e, spec_dir=str(orchestrator.spec_dir) if orchestrator else None
        )
        debug_error("spec_runner", f"Unexpected error: {e}")
        print(f"\n\nUnexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

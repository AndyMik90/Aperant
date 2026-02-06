#!/usr/bin/env python3
"""
Companion Agent Runner
======================

CLI entry point for the companion agent that provides read-only conversational
interface between task phases.

Usage:
    python runners/companion_runner.py --spec-dir .auto-claude/specs/001-feature \\
                                       --project-dir . \\
                                       --task-title "Add authentication" \\
                                       --current-phase coding_complete \\
                                       --task-id 001
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
import logging
import os
import signal
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

# Validate platform-specific dependencies
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent / ".env"
dev_env_file = Path(__file__).parent.parent.parent / "dev" / "auto-claude" / ".env"
if env_file.exists():
    load_dotenv(env_file)
elif dev_env_file.exists():
    load_dotenv(dev_env_file)

# Initialize Sentry
from core.sentry import capture_exception, init_sentry

init_sentry(component="companion-runner")

from agents.companion_agent import CompanionAgent
from phase_config import resolve_model_id

logger = logging.getLogger(__name__)

# Global flag for graceful shutdown
shutdown_requested = False


def signal_handler(signum, frame):
    """Handle SIGTERM for graceful shutdown."""
    global shutdown_requested
    shutdown_requested = True
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    print("\n__COMPANION_SHUTDOWN__\n", flush=True)
    sys.exit(0)


def main():
    """CLI entry point for companion agent."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Run companion agent for conversational task context",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Phase Options:
  spec_complete    - After spec is created, before planning
  planning         - During or after planning phase
  coding_complete  - After coding is done, before QA
  qa_complete      - After QA is done, before human review
  human_review     - During human review before merge

Examples:
  # Start companion after spec creation
  python companion_runner.py --spec-dir .auto-claude/specs/001-feature \\
                             --project-dir . \\
                             --task-title "Add authentication" \\
                             --current-phase spec_complete \\
                             --task-id 001

  # Start companion after coding
  python companion_runner.py --spec-dir .auto-claude/specs/002-bugfix \\
                             --project-dir . \\
                             --task-title "Fix login bug" \\
                             --current-phase coding_complete \\
                             --task-id 002 \\
                             --model opus
        """,
    )
    parser.add_argument(
        "--spec-dir",
        type=Path,
        required=True,
        help="Spec directory containing task files",
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        required=True,
        help="Project root directory",
    )
    parser.add_argument(
        "--task-title",
        type=str,
        required=True,
        help="Title of the task",
    )
    parser.add_argument(
        "--current-phase",
        type=str,
        required=True,
        choices=["spec_complete", "planning", "coding_complete", "qa_complete", "human_review"],
        help="Current phase of the task",
    )
    parser.add_argument(
        "--task-id",
        type=str,
        required=True,
        help="Task ID for tracking",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="sonnet",
        help="Model to use (haiku, sonnet, opus, or full model ID)",
    )

    args = parser.parse_args()

    # Resolve model ID
    model_id = resolve_model_id(args.model)

    # Setup signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    logger.info(f"Starting companion agent for task {args.task_id}")
    logger.info(f"Spec dir: {args.spec_dir}")
    logger.info(f"Phase: {args.current_phase}")
    logger.info(f"Model: {model_id}")

    try:
        # Create companion agent
        agent = CompanionAgent(
            spec_dir=args.spec_dir,
            project_dir=args.project_dir,
            task_title=args.task_title,
            current_phase=args.current_phase,
        )

        # Run agent (async)
        asyncio.run(agent.run())

    except KeyboardInterrupt:
        logger.info("Companion agent interrupted by user")
        print("\n__COMPANION_SHUTDOWN__\n", flush=True)
        sys.exit(0)
    except Exception as e:
        logger.error(f"Companion agent failed: {e}")
        capture_exception(e)
        print(f"\n__COMPANION_ERROR__: {e}\n", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

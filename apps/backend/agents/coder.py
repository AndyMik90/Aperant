"""
Coder Agent Module
==================

Main autonomous agent loop that runs the coder agent to implement subtasks.
"""

import asyncio
import logging
import os
from pathlib import Path

from core.client import create_client
from linear_updater import (
    LinearTaskState,
    is_linear_enabled,
    linear_build_complete,
    linear_task_started,
    linear_task_stuck,
)
from phase_config import get_phase_model, get_phase_thinking_budget, get_iteration_config, is_ralph_wiggum_mode
from phase_event import ExecutionPhase, emit_phase
from progress import (
    count_subtasks,
    count_subtasks_detailed,
    get_current_phase,
    get_next_subtask,
    is_build_complete,
    print_build_complete_banner,
    print_progress_summary,
    print_session_header,
)
from prompt_generator import (
    format_context_for_prompt,
    generate_planner_prompt,
    generate_subtask_prompt,
    load_subtask_context,
)
from prompts import is_first_run
from recovery import RecoveryManager
from security.constants import PROJECT_DIR_ENV_VAR
from task_logger import (
    LogPhase,
    get_task_logger,
)
from ui import (
    BuildState,
    Icons,
    StatusManager,
    bold,
    box,
    highlight,
    icon,
    muted,
    print_key_value,
    print_status,
)

from .base import AUTO_CONTINUE_DELAY_SECONDS, HUMAN_INTERVENTION_FILE
from .memory_manager import debug_memory_system_status, get_graphiti_context
from .session import emit_sdk_msg, post_session_processing, run_agent_session
from .user_message_queue import get_message_queue
from .utils import (
    find_phase_for_subtask,
    get_commit_count,
    get_latest_commit,
    load_implementation_plan,
    sync_spec_to_source,
)

# Agent Drift monitoring (optional)
try:
    from drift import AgentMonitor
    DRIFT_AVAILABLE = True
except ImportError:
    DRIFT_AVAILABLE = False
    AgentMonitor = None

logger = logging.getLogger(__name__)


async def run_autonomous_agent(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    max_iterations: int | None = None,
    verbose: bool = False,
    source_spec_dir: Path | None = None,
) -> None:
    """
    Run the autonomous agent loop with automatic memory management.

    The agent can use subagents (via Task tool) for parallel execution if needed.
    This is decided by the agent itself based on the task complexity.

    Args:
        project_dir: Root directory for the project
        spec_dir: Directory containing the spec (auto-claude/specs/001-name/)
        model: Claude model to use
        max_iterations: Maximum number of iterations (None for unlimited)
        verbose: Whether to show detailed output
        source_spec_dir: Original spec directory in main project (for syncing from worktree)
    """
    # Set environment variable for security hooks to find the correct project directory
    # This is needed because os.getcwd() may return the wrong directory in worktree mode
    os.environ[PROJECT_DIR_ENV_VAR] = str(project_dir.resolve())

    # Initialize recovery manager (handles memory persistence)
    recovery_manager = RecoveryManager(spec_dir, project_dir)

    # Initialize status manager for ccstatusline
    status_manager = StatusManager(project_dir)
    status_manager.set_active(spec_dir.name, BuildState.BUILDING)

    # Initialize task logger for persistent logging
    task_logger = get_task_logger(spec_dir)

    # Initialize drift monitor (if available)
    drift_monitor = None
    if DRIFT_AVAILABLE:
        try:
            drift_dir = spec_dir / "drift"
            drift_monitor = AgentMonitor(storage_dir=str(drift_dir))
            drift_monitor.start_session(run_id=f"spec-{spec_dir.name}")
            print_status("Agent drift monitoring: ENABLED", "info")
        except Exception as e:
            logger.warning("Could not initialize drift monitor: %s", e)
            drift_monitor = None

    # Debug: Print memory system status at startup
    debug_memory_system_status()

    # Update initial subtask counts
    subtasks = count_subtasks_detailed(spec_dir)
    status_manager.update_subtasks(
        completed=subtasks["completed"],
        total=subtasks["total"],
        in_progress=subtasks["in_progress"],
    )

    # Check Linear integration status
    linear_task = None
    if is_linear_enabled():
        linear_task = LinearTaskState.load(spec_dir)
        if linear_task and linear_task.task_id:
            print_status("Linear integration: ENABLED", "success")
            print_key_value("Task", linear_task.task_id)
            print_key_value("Status", linear_task.status)
            print()
        else:
            print_status("Linear enabled but no task created for this spec", "warning")
            print()

    # Check if this is a fresh start or continuation
    first_run = is_first_run(spec_dir)

    # Load iteration configuration (Ralph Wiggum mode or normal)
    iteration_config = get_iteration_config(spec_dir)
    if is_ralph_wiggum_mode(spec_dir):
        print_status("Ralph Wiggum Mode: ENABLED (\"I'm helping!\")", "info")
        print_key_value("Max subtask attempts", iteration_config["subtask_attempts_before_stuck"])
        print()

    # Track which phase we're in for logging
    current_log_phase = LogPhase.CODING
    is_planning_phase = False
    planning_retry_context: str | None = None
    planning_validation_failures = 0
    max_planning_validation_retries = 3

    def _validate_and_fix_implementation_plan() -> tuple[bool, list[str]]:
        from spec.validate_pkg import SpecValidator, auto_fix_plan

        spec_validator = SpecValidator(spec_dir)
        result = spec_validator.validate_implementation_plan()
        if result.valid:
            return True, []

        fixed = auto_fix_plan(spec_dir)
        if fixed:
            result = spec_validator.validate_implementation_plan()
            if result.valid:
                return True, []

        return False, result.errors

    if first_run:
        print_status(
            "Fresh start - will use Planner Agent to create implementation plan", "info"
        )
        content = [
            bold(f"{icon(Icons.GEAR)} PLANNER SESSION"),
            "",
            f"Spec: {highlight(spec_dir.name)}",
            muted("The agent will analyze your spec and create a subtask-based plan."),
        ]
        print()
        print(box(content, width=70, style="heavy"))
        print()

        # Update status for planning phase
        status_manager.update(state=BuildState.PLANNING)
        emit_phase(ExecutionPhase.PLANNING, "Creating implementation plan")
        is_planning_phase = True
        current_log_phase = LogPhase.PLANNING

        # Emit SDK marker for planning phase
        emit_sdk_msg("phase_start", {
            "phase": "planning",
            "message": "Creating implementation plan from spec",
        })

        # Start planning phase in task logger
        if task_logger:
            task_logger.start_phase(
                LogPhase.PLANNING, "Starting implementation planning..."
            )

        # Update Linear to "In Progress" when build starts
        if linear_task and linear_task.task_id:
            print_status("Updating Linear task to In Progress...", "progress")
            await linear_task_started(spec_dir)
    else:
        print(f"Continuing build: {highlight(spec_dir.name)}")
        print_progress_summary(spec_dir)

        # Check if already complete
        if is_build_complete(spec_dir):
            print_build_complete_banner(spec_dir)
            status_manager.update(state=BuildState.COMPLETE)
            return

        # Start/continue coding phase in task logger
        if task_logger:
            task_logger.start_phase(LogPhase.CODING, "Continuing implementation...")

        # Emit phase event when continuing build
        emit_phase(ExecutionPhase.CODING, "Continuing implementation")

    # Show human intervention hint
    content = [
        bold("INTERACTIVE CONTROLS"),
        "",
        f"Press {highlight('Ctrl+C')} once  {icon(Icons.ARROW_RIGHT)} Pause and optionally add instructions",
        f"Press {highlight('Ctrl+C')} twice {icon(Icons.ARROW_RIGHT)} Exit immediately",
    ]
    print(box(content, width=70, style="light"))
    print()

    # Initialize user message queue for real-time chat from frontend
    # This allows users to send guidance/feedback while the agent is running
    message_queue = None
    try:
        message_queue = get_message_queue()
        message_queue.start(asyncio.get_event_loop())
    except Exception as e:
        logger.warning("Could not initialize message queue: %s", e, exc_info=True)
        print_status(f"Warning: Could not initialize message queue: {e}", "warning")
        message_queue = None

    # Main loop
    iteration = 0
    user_feedback_for_prompt = ""  # Accumulated user feedback to inject into next prompt

    try:
        while True:
            iteration += 1

            # Check for pending user messages from frontend chat
            # Messages are non-blocking and processed at iteration boundaries
            user_messages = []
            if message_queue:
                try:
                    user_messages = await message_queue.get_all_messages()
                except Exception as e:
                    logger.warning("Error reading user messages: %s", e, exc_info=True)
                    print_status(f"Warning: Error reading user messages: {e}", "warning")
            if user_messages:
                user_feedback_for_prompt = "\n\n## User Feedback\n"
                user_feedback_for_prompt += "The user has sent the following message(s) via the chat interface. "
                user_feedback_for_prompt += "Please acknowledge and address their input before continuing:\n\n"
                for msg in user_messages:
                    user_feedback_for_prompt += f"**User** ({msg.timestamp.strftime('%H:%M:%S')}): {msg.content}\n\n"
                user_feedback_for_prompt += "Please respond to this feedback, then continue with your current task."
                print_status(f"Received {len(user_messages)} message(s) from user", "info")

            # Check for human intervention (PAUSE file)
            pause_file = spec_dir / HUMAN_INTERVENTION_FILE
            if pause_file.exists():
                print("\n" + "=" * 70)
                print("  PAUSED BY HUMAN")
                print("=" * 70)

                pause_content = pause_file.read_text().strip()
                if pause_content:
                    print(f"\nMessage: {pause_content}")

                print("\nTo resume, delete the PAUSE file:")
                print(f"  rm {pause_file}")
                print("\nThen run again:")
                print(f"  python auto-claude/run.py --spec {spec_dir.name}")
                return

            # Check max iterations
            if max_iterations and iteration > max_iterations:
                print(f"\nReached max iterations ({max_iterations})")
                print("To continue, run the script again without --max-iterations")
                break

            # Get the next subtask to work on (planner sessions shouldn't bind to a subtask)
            next_subtask = None if first_run else get_next_subtask(spec_dir)
            subtask_id = next_subtask.get("id") if next_subtask else None
            phase_name = next_subtask.get("phase_name") if next_subtask else None

            # Update status for this session
            status_manager.update_session(iteration)
            if phase_name:
                current_phase = get_current_phase(spec_dir)
                if current_phase:
                    status_manager.update_phase(
                        current_phase.get("name", ""),
                        current_phase.get("phase", 0),
                        current_phase.get("total", 0),
                    )
            status_manager.update_subtasks(in_progress=1)

            # Print session header
            print_session_header(
                session_num=iteration,
                is_planner=first_run,
                subtask_id=subtask_id,
                subtask_desc=next_subtask.get("description") if next_subtask else None,
                phase_name=phase_name,
                attempt=recovery_manager.get_attempt_count(subtask_id) + 1
                if subtask_id
                else 1,
            )

            # Capture state before session for post-processing
            commit_before = get_latest_commit(project_dir)
            commit_count_before = get_commit_count(project_dir)

            # Get the phase-specific model and thinking level (respects task_metadata.json configuration)
            # first_run means we're in planning phase, otherwise coding phase
            current_phase = "planning" if first_run else "coding"
            phase_model = get_phase_model(spec_dir, current_phase, model)
            phase_thinking_budget = get_phase_thinking_budget(spec_dir, current_phase)

            # Create client (fresh context) with phase-specific model and thinking
            # Use appropriate agent_type for correct tool permissions and thinking budget
            client = create_client(
                project_dir,
                spec_dir,
                phase_model,
                agent_type="planner" if first_run else "coder",
                max_thinking_tokens=phase_thinking_budget,
            )

            # Generate appropriate prompt
            if first_run:
                prompt = generate_planner_prompt(spec_dir, project_dir)
                if planning_retry_context:
                    prompt += "\n\n" + planning_retry_context

                # Retrieve Graphiti memory context for planning phase
                # This gives the planner knowledge of previous patterns, gotchas, and insights
                planner_context = await get_graphiti_context(
                    spec_dir,
                    project_dir,
                    {
                        "description": "Planning implementation for new feature",
                        "id": "planner",
                    },
                )
                if planner_context:
                    prompt += "\n\n" + planner_context
                    print_status("Graphiti memory context loaded for planner", "success")

                first_run = False
                current_log_phase = LogPhase.PLANNING

                # Set session info in logger
                if task_logger:
                    task_logger.set_session(iteration)
            else:
                # Switch to coding phase after planning
                just_transitioned_from_planning = False
                if is_planning_phase:
                    just_transitioned_from_planning = True
                    is_planning_phase = False
                    current_log_phase = LogPhase.CODING
                    emit_phase(ExecutionPhase.CODING, "Starting implementation")
                    if task_logger:
                        task_logger.end_phase(
                            LogPhase.PLANNING,
                            success=True,
                            message="Implementation plan created",
                        )
                        task_logger.start_phase(
                            LogPhase.CODING, "Starting implementation..."
                        )
                    # In worktree mode, the UI prefers planning logs from the main spec dir.
                    # Ensure the planning->coding transition is immediately reflected there.
                    if sync_spec_to_source(spec_dir, source_spec_dir):
                        print_status("Phase transition synced to main project", "success")

                if not next_subtask:
                    # FIX for Issue #495: Race condition after planning phase
                    # The implementation_plan.json may not be fully flushed to disk yet,
                    # or there may be a brief delay before subtasks become available.
                    # Retry with exponential backoff before giving up.
                    if just_transitioned_from_planning:
                        print_status(
                            "Waiting for implementation plan to be ready...", "progress"
                        )
                        for retry_attempt in range(3):
                            delay = (retry_attempt + 1) * 2  # 2s, 4s, 6s
                            await asyncio.sleep(delay)
                            next_subtask = get_next_subtask(spec_dir)
                            if next_subtask:
                                # Update subtask_id and phase_name after successful retry
                                subtask_id = next_subtask.get("id")
                                phase_name = next_subtask.get("phase_name")
                                print_status(
                                    f"Found subtask {subtask_id} after {delay}s delay",
                                    "success",
                                )
                                break
                            print_status(
                                f"Retry {retry_attempt + 1}/3: No subtask found yet...",
                                "warning",
                            )

                    if not next_subtask:
                        print("No pending subtasks found - build may be complete!")
                        break

                # Get attempt count for recovery context
                attempt_count = recovery_manager.get_attempt_count(subtask_id)
                recovery_hints = (
                    recovery_manager.get_recovery_hints(subtask_id)
                    if attempt_count > 0
                    else None
                )

                # Find the phase for this subtask
                plan = load_implementation_plan(spec_dir)
                phase = find_phase_for_subtask(plan, subtask_id) if plan else {}

                # Generate focused, minimal prompt for this subtask
                prompt = generate_subtask_prompt(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    subtask=next_subtask,
                    phase=phase or {},
                    attempt_count=attempt_count,
                    recovery_hints=recovery_hints,
                )

                # Load and append relevant file context
                context = load_subtask_context(spec_dir, project_dir, next_subtask)
                if context.get("patterns") or context.get("files_to_modify"):
                    prompt += "\n\n" + format_context_for_prompt(context)

                # Retrieve and append Graphiti memory context (if enabled)
                graphiti_context = await get_graphiti_context(
                    spec_dir, project_dir, next_subtask
                )
                if graphiti_context:
                    prompt += "\n\n" + graphiti_context
                    print_status("Graphiti memory context loaded", "success")

                # Show what we're working on
                print(f"Working on: {highlight(subtask_id)}")
                print(f"Description: {next_subtask.get('description', 'No description')}")
                if attempt_count > 0:
                    print_status(f"Previous attempts: {attempt_count}", "warning")
                print()

                # Emit SDK marker for subtask start
                emit_sdk_msg("phase_start", {
                    "phase": "coding",
                    "message": f"Working on subtask: {subtask_id}",
                })
                emit_sdk_msg("text", {
                    "content": f"🔧 Subtask: {next_subtask.get('description', 'No description')}"
                })

            # Set subtask info in logger
            if task_logger and subtask_id:
                task_logger.set_subtask(subtask_id)
                task_logger.set_session(iteration)

            # Inject user feedback into prompt if any messages were received
            if user_feedback_for_prompt:
                prompt += user_feedback_for_prompt
                # Clear feedback after injecting (will check for new messages next iteration)
                user_feedback_for_prompt = ""

            # Run session with async context manager
            # Pass message_queue for interruptible execution (Phase 5)
            # Pass drift_monitor for behavioral tracking
            async with client:
                status, response = await run_agent_session(
                    client, prompt, spec_dir, verbose, phase=current_log_phase,
                    message_queue=message_queue,
                    drift_monitor=drift_monitor
                )

            plan_validated = False
            if is_planning_phase and status != "error":
                valid, errors = _validate_and_fix_implementation_plan()
                if valid:
                    plan_validated = True
                    planning_retry_context = None
                else:
                    planning_validation_failures += 1
                    if planning_validation_failures >= max_planning_validation_retries:
                        print_status(
                            "implementation_plan.json validation failed too many times",
                            "error",
                        )
                        for err in errors:
                            print(f"  - {err}")
                        status_manager.update(state=BuildState.ERROR)
                        return

                    print_status(
                        "implementation_plan.json invalid - retrying planner", "warning"
                    )
                    for err in errors:
                        print(f"  - {err}")

                    planning_retry_context = (
                        "## IMPLEMENTATION PLAN VALIDATION ERRORS\n\n"
                        "The previous `implementation_plan.json` is INVALID.\n"
                        "You MUST rewrite it to match the required schema:\n"
                        "- Top-level: `feature`, `workflow_type`, `phases`\n"
                        "- Each phase: `id` (or `phase`) and `name`, and `subtasks`\n"
                        "- Each subtask: `id`, `description`, `status` (use `pending` for not started)\n\n"
                        "Validation errors:\n" + "\n".join(f"- {e}" for e in errors)
                    )
                    # Stay in planning mode for the next iteration
                    first_run = True
                    status = "continue"

            # === POST-SESSION PROCESSING (100% reliable) ===
            # Only run post-session processing for coding sessions.
            if subtask_id and current_log_phase == LogPhase.CODING:
                linear_is_enabled = (
                    linear_task is not None and linear_task.task_id is not None
                )
                success = await post_session_processing(
                    spec_dir=spec_dir,
                    project_dir=project_dir,
                    subtask_id=subtask_id,
                    session_num=iteration,
                    commit_before=commit_before,
                    commit_count_before=commit_count_before,
                    recovery_manager=recovery_manager,
                    linear_enabled=linear_is_enabled,
                    status_manager=status_manager,
                    source_spec_dir=source_spec_dir,
                )

                # Check for stuck subtasks (use iteration config for threshold)
                attempt_count = recovery_manager.get_attempt_count(subtask_id)
                max_attempts = iteration_config["subtask_attempts_before_stuck"]
                if not success and attempt_count >= max_attempts:
                    recovery_manager.mark_subtask_stuck(
                        subtask_id, f"Failed after {attempt_count} attempts"
                    )
                    print()
                    print_status(
                        f"Subtask {subtask_id} marked as STUCK after {attempt_count} attempts",
                        "error",
                    )
                    print(muted("Consider: manual intervention or skipping this subtask"))

                    # Record stuck subtask in Linear (if enabled)
                    if linear_is_enabled:
                        await linear_task_stuck(
                            spec_dir=spec_dir,
                            subtask_id=subtask_id,
                            attempt_count=attempt_count,
                        )
                        print_status("Linear notified of stuck subtask", "info")
            elif plan_validated and source_spec_dir:
                # After planning phase, sync the newly created implementation plan back to source
                if sync_spec_to_source(spec_dir, source_spec_dir):
                    print_status("Implementation plan synced to main project", "success")

            # Handle session status
            if status == "complete":
                # Don't emit COMPLETE here - subtasks are done but QA hasn't run yet
                # QA loop will emit COMPLETE after actual approval
                print_build_complete_banner(spec_dir)
                status_manager.update(state=BuildState.COMPLETE)

                # Emit SDK markers for build completion
                emit_sdk_msg("text", {"content": "✅ All subtasks completed!"})
                emit_sdk_msg("phase_end", {
                    "phase": "coding",
                    "success": True,
                    "message": "All subtasks completed, ready for QA",
                })

                if task_logger:
                    task_logger.end_phase(
                        LogPhase.CODING,
                        success=True,
                        message="All subtasks completed successfully",
                    )

                if linear_task and linear_task.task_id:
                    await linear_build_complete(spec_dir)
                    print_status("Linear notified: build complete, ready for QA", "success")

                break

            elif status == "continue":
                print(
                    muted(
                        f"\nAgent will auto-continue in {AUTO_CONTINUE_DELAY_SECONDS}s..."
                    )
                )
                print_progress_summary(spec_dir)

                # Emit SDK marker for subtask completion (moving to next)
                emit_sdk_msg("phase_end", {
                    "phase": "coding",
                    "success": True,
                    "message": f"Subtask completed, continuing to next...",
                })

                # Update state back to building
                status_manager.update(
                    state=BuildState.PLANNING if is_planning_phase else BuildState.BUILDING
                )

                # Show next subtask info
                next_subtask = get_next_subtask(spec_dir)
                if next_subtask:
                    subtask_id = next_subtask.get("id")
                    print(
                        f"\nNext: {highlight(subtask_id)} - {next_subtask.get('description')}"
                    )

                    attempt_count = recovery_manager.get_attempt_count(subtask_id)
                    if attempt_count > 0:
                        print_status(
                            f"WARNING: {attempt_count} previous attempt(s)", "warning"
                        )

                await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)

            elif status == "error":
                emit_phase(ExecutionPhase.FAILED, "Session encountered an error")
                print_status("Session encountered an error", "error")
                print(muted("Will retry with a fresh session..."))
                status_manager.update(state=BuildState.ERROR)

                # Emit SDK error marker
                emit_sdk_msg("error", {
                    "content": "Session encountered an error - will retry",
                    "phase": "coding",
                })

                await asyncio.sleep(AUTO_CONTINUE_DELAY_SECONDS)

            elif status == "stopped":
                # Phase 5: User requested immediate stop
                emit_phase(ExecutionPhase.IDLE, "User requested stop")
                print_status("Execution stopped by user request", "warning")
                status_manager.update(state=BuildState.PAUSED)
                print()
                print(muted("To resume, run the agent again."))
                break

            elif status == "paused":
                # Phase 5: User requested pause - wait for resume command
                emit_phase(ExecutionPhase.IDLE, "User requested pause")
                print_status("Execution paused by user request", "info")
                status_manager.update(state=BuildState.PAUSED)
                print()
                print(muted("Waiting for 'continue' command..."))
                print(muted("Send 'continue' or 'resume' to resume execution."))
                print(muted("Send 'stop' or 'abort' to stop completely."))

                # Wait for resume or stop command
                resume_cmd: str | None = None
                stop_requested = False
                while True:
                    if message_queue:
                        user_msgs = await message_queue.get_all_messages()
                        for msg in user_msgs:
                            resume_cmd = msg.content.strip().lower()
                            if resume_cmd in ("continue", "resume", "go", "proceed"):
                                print_status("Resuming execution...", "success")
                                status_manager.update(state=BuildState.BUILDING)
                                break
                            elif resume_cmd in ("stop", "halt", "cancel", "abort"):
                                print_status("Stopping execution...", "warning")
                                stop_requested = True
                                break
                        else:
                            # No resume or stop command found, keep waiting
                            await asyncio.sleep(0.5)
                            continue
                        # Got a valid command, exit the wait loop
                        break
                    else:
                        # No message queue, can't wait for resume
                        print_status("No message queue available, stopping", "warning")
                        stop_requested = True
                        break
                # If stop was requested during pause, break the main loop
                if stop_requested:
                    break

            # Small delay between sessions
            if max_iterations is None or iteration < max_iterations:
                print("\nPreparing next session...\n")
                await asyncio.sleep(1)

        # Final summary
        content = [
            bold(f"{icon(Icons.SESSION)} SESSION SUMMARY"),
            "",
            f"Project: {project_dir}",
            f"Spec: {highlight(spec_dir.name)}",
            f"Sessions completed: {iteration}",
        ]
        print()
        print(box(content, width=70, style="heavy"))
        print_progress_summary(spec_dir)

        # Show stuck subtasks if any
        stuck_subtasks = recovery_manager.get_stuck_subtasks()
        if stuck_subtasks:
            print()
            print_status("STUCK SUBTASKS (need manual intervention):", "error")
            for stuck in stuck_subtasks:
                print(f"  {icon(Icons.ERROR)} {stuck['subtask_id']}: {stuck['reason']}")

        # Instructions
        completed, total = count_subtasks(spec_dir)
        if completed < total:
            content = [
                bold(f"{icon(Icons.PLAY)} NEXT STEPS"),
                "",
                f"{total - completed} subtasks remaining.",
                f"Run again: {highlight(f'python auto-claude/run.py --spec {spec_dir.name}')}",
            ]
        else:
            content = [
                bold(f"{icon(Icons.SUCCESS)} NEXT STEPS"),
                "",
                "All subtasks completed!",
                "  1. Review the auto-claude/* branch",
                "  2. Run manual tests",
                "  3. Merge to main",
            ]

        print()
        print(box(content, width=70, style="light"))
        print()

        # Set final status
        if completed == total:
            status_manager.update(state=BuildState.COMPLETE)
        else:
            status_manager.update(state=BuildState.PAUSED)
    except asyncio.CancelledError:
        # Handle graceful cancellation (e.g., from SIGINT or task cancellation)
        logger.info("Coder agent cancelled, performing graceful shutdown")
        print_status("Agent cancelled - shutting down gracefully", "warning")
        status_manager.update(state=BuildState.PAUSED)
        raise  # Re-raise to propagate cancellation
    finally:
        # Clean up user message queue
        if message_queue:
            message_queue.stop()

        # End drift monitoring session and get final report
        if drift_monitor:
            try:
                report = drift_monitor.end_session()
                if report:
                    from phase_event import emit_drift_report
                    emit_drift_report(report.to_dict())
                    if report.alert_level == "critical":
                        print_status(f"Drift CRITICAL: {report.overall_drift_score:.3f}", "error")
                    elif report.alert_level == "warning":
                        print_status(f"Drift WARNING: {report.overall_drift_score:.3f}", "warning")
                    else:
                        print_status(f"Drift score: {report.overall_drift_score:.3f}", "success")
            except Exception as e:
                logger.warning("Could not finalize drift report: %s", e)

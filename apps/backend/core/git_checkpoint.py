"""
Git Checkpoint & Rollback System
=================================

Creates lightweight git tags at key build lifecycle moments so users can
roll back when autonomous agents go off-rails.

Checkpoints:
    build-start     — Before the coder agent begins (safety baseline)
    subtask-{id}    — After each subtask completes successfully
    build-complete  — After QA validation passes
    build-failed    — When a build fails (preserves error state for debugging)

Tag format:
    ac-jerry/{spec_name}/{type}-{YYYYMMDD-HHMMSS}

Usage:
    from core.git_checkpoint import create_checkpoint, list_checkpoints, rollback_to

    create_checkpoint(project_dir, spec_name, "build-start")
    create_checkpoint(project_dir, spec_name, "subtask", subtask_id="1.1")
    checkpoints = list_checkpoints(project_dir, spec_name)
    rollback_to(project_dir, checkpoints[0].tag)
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from core.git_executable import run_git

logger = logging.getLogger(__name__)

TAG_PREFIX = "ac-jerry"


@dataclass
class CheckpointInfo:
    """A single git checkpoint."""

    tag: str
    checkpoint_type: str
    subtask_id: str | None
    created_at: str
    commit_hash: str
    message: str


def _get_head_commit(project_dir: Path) -> str | None:
    """Get the current HEAD commit hash."""
    result = run_git(["rev-parse", "HEAD"], cwd=project_dir)
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def create_checkpoint(
    project_dir: Path,
    spec_name: str,
    checkpoint_type: str,
    subtask_id: str | None = None,
    message: str = "",
) -> str | None:
    """
    Create a lightweight git tag as a checkpoint.

    Args:
        project_dir: Project root or worktree path
        spec_name: Spec identifier (e.g., "001-add-login")
        checkpoint_type: One of "build-start", "subtask", "build-complete", "build-failed"
        subtask_id: Subtask ID (required when checkpoint_type is "subtask")
        message: Optional description

    Returns:
        Tag name if created, None on failure
    """
    commit = _get_head_commit(project_dir)
    if not commit:
        logger.warning("Cannot create checkpoint: no HEAD commit")
        return None

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    if checkpoint_type == "subtask" and subtask_id:
        tag_name = f"{TAG_PREFIX}/{spec_name}/subtask-{subtask_id}-{timestamp}"
    else:
        tag_name = f"{TAG_PREFIX}/{spec_name}/{checkpoint_type}-{timestamp}"

    if not message:
        message = f"AC Jerry checkpoint: {checkpoint_type}"
        if subtask_id:
            message += f" (subtask {subtask_id})"

    result = run_git(
        ["tag", "-a", tag_name, "-m", message, commit],
        cwd=project_dir,
    )

    if result.returncode != 0:
        logger.warning("Failed to create checkpoint tag %s: %s", tag_name, result.stderr)
        return None

    logger.info("Checkpoint created: %s", tag_name)
    return tag_name


def list_checkpoints(
    project_dir: Path,
    spec_name: str | None = None,
) -> list[CheckpointInfo]:
    """
    List all checkpoints, optionally filtered by spec.

    Args:
        project_dir: Project root or worktree path
        spec_name: If provided, only return checkpoints for this spec

    Returns:
        List of CheckpointInfo sorted by creation time (newest first)
    """
    pattern = f"{TAG_PREFIX}/{spec_name}/*" if spec_name else f"{TAG_PREFIX}/*"

    result = run_git(
        ["tag", "-l", pattern, "--sort=-creatordate",
         "--format=%(refname:short)\t%(creatordate:iso-strict)\t%(objectname:short)\t%(subject)"],
        cwd=project_dir,
    )

    if result.returncode != 0 or not result.stdout.strip():
        return []

    checkpoints = []
    for line in result.stdout.strip().split("\n"):
        parts = line.split("\t", 3)
        if len(parts) < 4:
            continue

        tag, created_at, commit_hash, msg = parts
        # Parse type from tag: ac-jerry/{spec}/{type}-{timestamp}
        tag_suffix = tag.split("/", 2)[-1] if "/" in tag else tag
        # Remove timestamp suffix to get type
        checkpoint_type = tag_suffix.rsplit("-", 2)[0] if "-" in tag_suffix else tag_suffix
        # Detect subtask type
        subtask_id = None
        if checkpoint_type.startswith("subtask-"):
            subtask_id = checkpoint_type[len("subtask-"):]
            checkpoint_type = "subtask"

        checkpoints.append(CheckpointInfo(
            tag=tag,
            checkpoint_type=checkpoint_type,
            subtask_id=subtask_id,
            created_at=created_at,
            commit_hash=commit_hash,
            message=msg,
        ))

    return checkpoints


def rollback_to(project_dir: Path, tag: str) -> bool:
    """
    Reset the working tree to a checkpoint.

    Uses `git checkout <tag> -- .` to restore files without moving HEAD,
    then stages the changes. This is safer than `git reset --hard` because
    it preserves the commit history and creates a clear rollback point.

    Args:
        project_dir: Project root or worktree path
        tag: The checkpoint tag to roll back to

    Returns:
        True if rollback succeeded
    """
    # Verify tag exists
    verify = run_git(["rev-parse", "--verify", f"refs/tags/{tag}"], cwd=project_dir)
    if verify.returncode != 0:
        logger.error("Checkpoint tag not found: %s", tag)
        return False

    # Restore files from the tag
    result = run_git(["checkout", tag, "--", "."], cwd=project_dir)
    if result.returncode != 0:
        logger.error("Rollback failed: %s", result.stderr)
        return False

    logger.info("Rolled back to checkpoint: %s", tag)
    return True


def delete_checkpoints(
    project_dir: Path,
    spec_name: str,
) -> int:
    """
    Delete all checkpoints for a spec (cleanup after merge/archive).

    Args:
        project_dir: Project root or worktree path
        spec_name: Spec to clean up

    Returns:
        Number of tags deleted
    """
    checkpoints = list_checkpoints(project_dir, spec_name)
    deleted = 0

    for cp in checkpoints:
        result = run_git(["tag", "-d", cp.tag], cwd=project_dir)
        if result.returncode == 0:
            deleted += 1

    if deleted:
        logger.info("Deleted %d checkpoint(s) for spec %s", deleted, spec_name)

    return deleted

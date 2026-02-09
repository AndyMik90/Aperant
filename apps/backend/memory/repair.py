"""
Memory Integrity Repair
========================

7-check repair pipeline for file-based memory integrity. Each check
validates a specific aspect and optionally fixes problems.

Checks:
    1. Memory directory structure
    2. Session insight JSON validity
    3. Session insight numbering (detect gaps)
    4. Codebase map JSON validity + schema
    5. Lessons learned JSON validity + schema
    6. Patterns/gotchas file integrity
    7. Stale lock file cleanup

Integration:
    Called manually via CLI: python -m memory --action repair
    Can also be called programmatically from health-check endpoints.
"""

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)


class RepairResult:
    """Accumulates results from repair checks."""

    def __init__(self) -> None:
        self.checks_run: int = 0
        self.issues_found: int = 0
        self.issues_fixed: int = 0
        self.details: list[dict[str, str]] = []

    def add(self, check: str, status: str, message: str) -> None:
        self.checks_run += 1
        if status == "fixed":
            self.issues_found += 1
            self.issues_fixed += 1
        elif status == "error":
            self.issues_found += 1
        self.details.append({"check": check, "status": status, "message": message})

    def to_dict(self) -> dict:
        return {
            "checks_run": self.checks_run,
            "issues_found": self.issues_found,
            "issues_fixed": self.issues_fixed,
            "details": self.details,
        }


def _check_directory_structure(spec_dir: Path, result: RepairResult) -> None:
    """Check 1: Verify memory directory structure exists and is valid."""
    memory_dir = spec_dir / "memory"

    if not memory_dir.exists():
        result.add("directory_structure", "ok", "No memory directory (nothing to repair)")
        return

    if not memory_dir.is_dir():
        result.add(
            "directory_structure",
            "error",
            f"{memory_dir} exists but is not a directory",
        )
        return

    # Check session_insights subdir
    insights_dir = memory_dir / "session_insights"
    if insights_dir.exists() and not insights_dir.is_dir():
        result.add(
            "directory_structure",
            "error",
            f"{insights_dir} exists but is not a directory",
        )
        return

    result.add("directory_structure", "ok", "Directory structure valid")


def _check_session_json(spec_dir: Path, result: RepairResult, fix: bool) -> None:
    """Check 2: Validate all session insight JSON files."""
    insights_dir = spec_dir / "memory" / "session_insights"
    if not insights_dir.exists():
        result.add("session_json", "ok", "No session insights directory")
        return

    session_files = sorted(insights_dir.glob("session_*.json"))
    if not session_files:
        result.add("session_json", "ok", "No session files found")
        return

    corrupt = []
    for sf in session_files:
        try:
            with open(sf) as f:
                data = json.load(f)
            if not isinstance(data, dict):
                corrupt.append(sf)
        except (json.JSONDecodeError, OSError):
            corrupt.append(sf)

    if not corrupt:
        result.add("session_json", "ok", f"All {len(session_files)} session files valid")
        return

    if fix:
        for sf in corrupt:
            try:
                sf.unlink()
            except OSError:
                pass
        result.add(
            "session_json",
            "fixed",
            f"Deleted {len(corrupt)} corrupt session files: "
            + ", ".join(f.name for f in corrupt),
        )
    else:
        result.add(
            "session_json",
            "error",
            f"{len(corrupt)} corrupt session files: "
            + ", ".join(f.name for f in corrupt),
        )


def _check_session_numbering(spec_dir: Path, result: RepairResult, fix: bool) -> None:
    """Check 3: Detect gaps in session numbering and optionally renumber."""
    insights_dir = spec_dir / "memory" / "session_insights"
    if not insights_dir.exists():
        result.add("session_numbering", "ok", "No session insights directory")
        return

    session_files = sorted(insights_dir.glob("session_*.json"))
    if not session_files:
        result.add("session_numbering", "ok", "No session files")
        return

    # Extract numbers
    numbers = []
    for sf in session_files:
        stem = sf.stem  # e.g., "session_001"
        try:
            num = int(stem.split("_")[1])
            numbers.append((num, sf))
        except (IndexError, ValueError):
            continue

    if not numbers:
        result.add("session_numbering", "ok", "No numbered sessions found")
        return

    # Check for gaps
    expected = list(range(1, len(numbers) + 1))
    actual = [n for n, _ in numbers]

    if actual == expected:
        result.add("session_numbering", "ok", f"Session numbering 1-{len(numbers)} is contiguous")
        return

    if fix:
        # Renumber to close gaps
        renamed = 0
        for new_num, (_, old_path) in enumerate(numbers, start=1):
            new_name = f"session_{new_num:03d}.json"
            new_path = old_path.parent / new_name
            if old_path != new_path:
                # Update session_number inside the JSON too
                try:
                    with open(old_path) as f:
                        data = json.load(f)
                    data["session_number"] = new_num
                    with open(new_path, "w") as f:
                        json.dump(data, f, indent=2)
                    if old_path != new_path:
                        old_path.unlink()
                    renamed += 1
                except (OSError, json.JSONDecodeError):
                    pass
        result.add(
            "session_numbering",
            "fixed",
            f"Renumbered {renamed} session files to close gaps",
        )
    else:
        gaps = set(expected) - set(actual)
        result.add(
            "session_numbering",
            "error",
            f"Gaps in session numbering: missing {sorted(gaps)}",
        )


def _check_codebase_map(spec_dir: Path, result: RepairResult, fix: bool) -> None:
    """Check 4: Validate codebase_map.json structure."""
    map_file = spec_dir / "memory" / "codebase_map.json"
    if not map_file.exists():
        result.add("codebase_map", "ok", "No codebase map file")
        return

    try:
        with open(map_file) as f:
            data = json.load(f)
    except json.JSONDecodeError:
        if fix:
            map_file.unlink()
            result.add("codebase_map", "fixed", "Deleted corrupt codebase_map.json")
        else:
            result.add("codebase_map", "error", "codebase_map.json contains invalid JSON")
        return
    except OSError as e:
        result.add("codebase_map", "error", f"Cannot read codebase_map.json: {e}")
        return

    if not isinstance(data, dict):
        if fix:
            map_file.unlink()
            result.add("codebase_map", "fixed", "Deleted codebase_map.json (not a dict)")
        else:
            result.add("codebase_map", "error", "codebase_map.json is not a JSON object")
        return

    # Check for non-string values (skip _metadata)
    bad_keys = [
        k for k, v in data.items() if k != "_metadata" and not isinstance(v, str)
    ]
    if bad_keys and fix:
        for k in bad_keys:
            del data[k]
        with open(map_file, "w") as f:
            json.dump(data, f, indent=2, sort_keys=True)
        result.add(
            "codebase_map",
            "fixed",
            f"Removed {len(bad_keys)} non-string entries from codebase map",
        )
    elif bad_keys:
        result.add(
            "codebase_map",
            "error",
            f"{len(bad_keys)} entries have non-string values",
        )
    else:
        entry_count = len([k for k in data if k != "_metadata"])
        result.add("codebase_map", "ok", f"Codebase map valid ({entry_count} entries)")


def _check_lessons(spec_dir: Path, result: RepairResult, fix: bool) -> None:
    """Check 5: Validate lessons_learned.json structure."""
    lessons_file = spec_dir / "memory" / "lessons_learned.json"
    if not lessons_file.exists():
        result.add("lessons", "ok", "No lessons file")
        return

    try:
        with open(lessons_file) as f:
            data = json.load(f)
    except json.JSONDecodeError:
        if fix:
            lessons_file.unlink()
            result.add("lessons", "fixed", "Deleted corrupt lessons_learned.json")
        else:
            result.add("lessons", "error", "lessons_learned.json contains invalid JSON")
        return
    except OSError as e:
        result.add("lessons", "error", f"Cannot read lessons_learned.json: {e}")
        return

    if not isinstance(data, list):
        if fix:
            # Wrap single dict in array
            if isinstance(data, dict):
                with open(lessons_file, "w") as f:
                    json.dump([data], f, indent=2)
                result.add("lessons", "fixed", "Wrapped single lesson dict in array")
            else:
                lessons_file.unlink()
                result.add("lessons", "fixed", "Deleted lessons_learned.json (invalid type)")
        else:
            result.add("lessons", "error", "lessons_learned.json is not a JSON array")
        return

    result.add("lessons", "ok", f"Lessons file valid ({len(data)} entries)")


def _check_markdown_files(spec_dir: Path, result: RepairResult, fix: bool) -> None:
    """Check 6: Validate patterns.md and gotchas.md aren't corrupt."""
    memory_dir = spec_dir / "memory"
    if not memory_dir.exists():
        result.add("markdown_files", "ok", "No memory directory")
        return

    issues = []
    for fname in ("patterns.md", "gotchas.md"):
        fpath = memory_dir / fname
        if not fpath.exists():
            continue

        try:
            content = fpath.read_text(encoding="utf-8")
            # Check for null bytes (corruption indicator)
            if "\x00" in content:
                if fix:
                    cleaned = content.replace("\x00", "")
                    fpath.write_text(cleaned, encoding="utf-8")
                    issues.append(f"Cleaned null bytes from {fname}")
                else:
                    issues.append(f"{fname} contains null bytes")
        except UnicodeDecodeError:
            if fix:
                # Try to read as binary and decode with errors='replace'
                raw = fpath.read_bytes()
                cleaned = raw.decode("utf-8", errors="replace")
                fpath.write_text(cleaned, encoding="utf-8")
                issues.append(f"Fixed encoding errors in {fname}")
            else:
                issues.append(f"{fname} has encoding errors")
        except OSError as e:
            issues.append(f"Cannot read {fname}: {e}")

    if issues:
        status = "fixed" if fix else "error"
        result.add("markdown_files", status, "; ".join(issues))
    else:
        result.add("markdown_files", "ok", "Markdown files valid")


def _check_stale_locks(spec_dir: Path, result: RepairResult, fix: bool) -> None:
    """Check 7: Clean up stale .lock files older than 5 minutes."""
    memory_dir = spec_dir / "memory"
    if not memory_dir.exists():
        result.add("stale_locks", "ok", "No memory directory")
        return

    # Also check project-level locks
    lock_files = list(memory_dir.rglob("*.lock"))

    # Check parent for PROJECT_MEMORY.md.lock
    project_lock = spec_dir.parent.parent / "PROJECT_MEMORY.md.lock"
    if project_lock.exists():
        lock_files.append(project_lock)

    if not lock_files:
        result.add("stale_locks", "ok", "No lock files found")
        return

    stale_threshold = time.time() - 300  # 5 minutes
    stale = []
    for lf in lock_files:
        try:
            if lf.stat().st_mtime < stale_threshold:
                stale.append(lf)
        except OSError:
            continue

    if not stale:
        result.add("stale_locks", "ok", f"{len(lock_files)} lock files are fresh")
        return

    if fix:
        cleaned = 0
        for lf in stale:
            try:
                lf.unlink()
                cleaned += 1
            except OSError:
                pass
        result.add(
            "stale_locks",
            "fixed",
            f"Removed {cleaned} stale lock files",
        )
    else:
        result.add(
            "stale_locks",
            "error",
            f"{len(stale)} stale lock files (>5 min old)",
        )


def repair_memory(spec_dir: Path, fix: bool = True) -> dict:
    """
    Run the 7-check memory integrity repair pipeline.

    Args:
        spec_dir: Path to spec directory
        fix: If True, automatically fix issues. If False, report only.

    Returns:
        Dict with repair results:
            - checks_run: total checks executed
            - issues_found: total issues detected
            - issues_fixed: total issues auto-fixed (0 if fix=False)
            - details: list of per-check results
    """
    result = RepairResult()

    _check_directory_structure(spec_dir, result)
    _check_session_json(spec_dir, result, fix)
    _check_session_numbering(spec_dir, result, fix)
    _check_codebase_map(spec_dir, result, fix)
    _check_lessons(spec_dir, result, fix)
    _check_markdown_files(spec_dir, result, fix)
    _check_stale_locks(spec_dir, result, fix)

    mode = "repair" if fix else "check"
    logger.info(
        "Memory %s complete: %d checks, %d issues found, %d fixed",
        mode,
        result.checks_run,
        result.issues_found,
        result.issues_fixed,
    )

    return result.to_dict()

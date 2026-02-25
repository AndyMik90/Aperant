#!/usr/bin/env python3
"""
Tests for File Path Self-Healing in the Coder Pipeline
=======================================================

Tests cover:
- _find_correct_path: fuzzy file path matching (basename, index.{ext} pattern)
- _find_correct_path_indexed: same logic using pre-built index
- _build_file_index: file indexing with directory pruning
- _auto_correct_subtask_files: end-to-end correction with plan persistence
- _validate_plan_file_paths: post-planning validation of all file paths
- Phase dependency fix: stuck subtasks unblock downstream phases
"""

import json
import sys
from pathlib import Path

import pytest

# Ensure backend is on path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from agents.coder import (
    _auto_correct_subtask_files,
    _build_file_index,
    _find_correct_path,
    _find_correct_path_indexed,
    _validate_plan_file_paths,
    validate_subtask_files,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def project_tree(tmp_path):
    """
    Create a realistic project structure for path matching tests.

    Structure:
        src/
            renderer/
                components/
                    Button.tsx
                    Modal.tsx
                stores/
                    task-store.ts
            preload/
                api/
                    index.ts        <- the index.{ext} pattern
                bridge/
                    index.ts
            shared/
                utils/
                    helpers.ts
                    format.ts
                types/
                    common.ts
        apps/
            frontend/
                src/
                    main/
                        agent/
                            agent-queue.ts
        tests/
            helpers.ts              <- duplicate basename of shared/utils/helpers.ts
        node_modules/
            react/
                index.ts            <- should be excluded
        .git/
            config                  <- should be excluded
    """
    # Source files
    (tmp_path / "src/renderer/components").mkdir(parents=True)
    (tmp_path / "src/renderer/components/Button.tsx").write_text("export {}")
    (tmp_path / "src/renderer/components/Modal.tsx").write_text("export {}")

    (tmp_path / "src/renderer/stores").mkdir(parents=True)
    (tmp_path / "src/renderer/stores/task-store.ts").write_text("export {}")

    (tmp_path / "src/preload/api").mkdir(parents=True)
    (tmp_path / "src/preload/api/index.ts").write_text("export {}")

    (tmp_path / "src/preload/bridge").mkdir(parents=True)
    (tmp_path / "src/preload/bridge/index.ts").write_text("export {}")

    (tmp_path / "src/shared/utils").mkdir(parents=True)
    (tmp_path / "src/shared/utils/helpers.ts").write_text("export {}")
    (tmp_path / "src/shared/utils/format.ts").write_text("export {}")

    (tmp_path / "src/shared/types").mkdir(parents=True)
    (tmp_path / "src/shared/types/common.ts").write_text("export {}")

    (tmp_path / "apps/frontend/src/main/agent").mkdir(parents=True)
    (tmp_path / "apps/frontend/src/main/agent/agent-queue.ts").write_text("export {}")

    (tmp_path / "tests").mkdir(parents=True)
    (tmp_path / "tests/helpers.ts").write_text("export {}")

    # Excluded directories (should never match)
    (tmp_path / "node_modules/react").mkdir(parents=True)
    (tmp_path / "node_modules/react/index.ts").write_text("export {}")

    (tmp_path / ".git").mkdir(parents=True)
    (tmp_path / ".git/config").write_text("[core]")

    return tmp_path


@pytest.fixture
def spec_dir_with_plan(tmp_path):
    """Create a spec directory with an implementation plan containing wrong paths."""
    spec_dir = tmp_path / "spec"
    spec_dir.mkdir()

    plan = {
        "feature": "test feature",
        "phases": [
            {
                "id": "phase-1",
                "name": "Phase 1",
                "subtasks": [
                    {
                        "id": "task-1",
                        "description": "Fix the API",
                        "status": "pending",
                        "files_to_modify": [
                            "src/preload/api.ts",  # Wrong: should be src/preload/api/index.ts
                            "src/renderer/components/Button.tsx",  # Correct
                        ],
                    },
                    {
                        "id": "task-2",
                        "description": "Update store",
                        "status": "pending",
                        "files_to_modify": [
                            "src/renderer/stores/task-store.ts",  # Correct
                        ],
                    },
                ],
            }
        ],
    }

    (spec_dir / "implementation_plan.json").write_text(json.dumps(plan, indent=2))
    return spec_dir


# =============================================================================
# _find_correct_path TESTS
# =============================================================================


class TestFindCorrectPath:
    """Tests for the _find_correct_path fuzzy file matcher."""

    def test_index_pattern_match(self, project_tree):
        """preload/api.ts -> preload/api/index.ts (the core spec-232 scenario)."""
        result = _find_correct_path("src/preload/api.ts", project_tree)
        assert result is not None
        assert Path(result) == Path("src/preload/api/index.ts")

    def test_index_pattern_with_different_dir(self, project_tree):
        """preload/bridge.ts -> preload/bridge/index.ts."""
        result = _find_correct_path("src/preload/bridge.ts", project_tree)
        assert result is not None
        assert Path(result) == Path("src/preload/bridge/index.ts")

    def test_basename_match_in_different_dir(self, project_tree):
        """When file exists but in wrong directory, finds it by basename."""
        result = _find_correct_path("src/utils/format.ts", project_tree)
        assert result is not None
        assert Path(result) == Path("src/shared/utils/format.ts")

    def test_exact_basename_with_shared_parents_wins(self, project_tree):
        """Score prefers candidates sharing more parent directory segments."""
        result = _find_correct_path("src/renderer/components/Modal.tsx", project_tree)
        # File exists at the exact path, but _find_correct_path is only called
        # for missing paths. Let's test a wrong parent instead.
        result = _find_correct_path("src/components/Modal.tsx", project_tree)
        assert result is not None
        assert Path(result) == Path("src/renderer/components/Modal.tsx")

    def test_no_match_for_nonexistent_file(self, project_tree):
        """Returns None when no file with matching basename or index pattern exists."""
        result = _find_correct_path("src/does-not-exist.ts", project_tree)
        assert result is None

    def test_no_match_without_extension(self, project_tree):
        """Returns None for paths without file extension."""
        result = _find_correct_path("src/preload/api", project_tree)
        assert result is None

    def test_excluded_dirs_not_matched(self, project_tree):
        """Files in node_modules/.git are never returned as matches."""
        # The only index.ts files are in src/preload/api/ and src/preload/bridge/
        # and node_modules/react/. A search for "react.ts" should not match
        # node_modules/react/index.ts because node_modules is excluded.
        result = _find_correct_path("react.ts", project_tree)
        assert result is None

    def test_ambiguous_match_returns_none(self, project_tree):
        """When two candidates have similar scores, returns None (ambiguous)."""
        # "helpers.ts" exists at both:
        #   src/shared/utils/helpers.ts
        #   tests/helpers.ts
        # With parent "foo/" (no shared segments), both score 10.0 with slight
        # depth differences. The gap should be < 3.0 so it's ambiguous.
        result = _find_correct_path("foo/helpers.ts", project_tree)
        assert result is None

    def test_unambiguous_basename_match_with_shared_parents(self, project_tree):
        """When one candidate clearly shares more parent path, it wins."""
        # "helpers.ts" at src/shared/utils/helpers.ts vs tests/helpers.ts
        # Searching for "src/shared/helpers.ts":
        #   src/shared/utils/helpers.ts: 10.0 + 3.0(src) + 3.0(shared) - 0.5 = 15.5
        #   tests/helpers.ts: 10.0 + 0 - 1.0 = 9.0
        # Gap = 6.5 >= 3.0, so src/shared/utils/helpers.ts wins
        result = _find_correct_path("src/shared/helpers.ts", project_tree)
        assert result is not None
        assert Path(result) == Path("src/shared/utils/helpers.ts")

    def test_deeply_nested_path_still_matches(self, project_tree):
        """Files deep in the tree can be found when path is partially wrong."""
        result = _find_correct_path(
            "apps/frontend/src/main/agent-queue.ts", project_tree
        )
        assert result is not None
        assert "agent-queue.ts" in result


# =============================================================================
# _build_file_index + _find_correct_path_indexed TESTS
# =============================================================================


class TestBuildFileIndex:
    """Tests for the file index builder."""

    def test_indexes_files_by_basename(self, project_tree):
        index = _build_file_index(project_tree, {".ts"})
        assert "format.ts" in index
        assert len(index["format.ts"]) == 1

    def test_indexes_index_files_by_dir_stem(self, project_tree):
        index = _build_file_index(project_tree, {".ts"})
        # api/index.ts should be indexed under __dir_stem__:api.ts
        key = "__dir_stem__:api.ts"
        assert key in index
        assert len(index[key]) == 1
        assert "api/index.ts" in index[key][0][0]

    def test_excludes_node_modules(self, project_tree):
        index = _build_file_index(project_tree, {".ts"})
        # node_modules/react/index.ts should NOT appear
        for entries in index.values():
            for rel_str, _ in entries:
                assert "node_modules" not in rel_str

    def test_excludes_git_dir(self, project_tree):
        index = _build_file_index(project_tree, {".ts", ""})
        for entries in index.values():
            for rel_str, _ in entries:
                assert ".git" not in rel_str

    def test_multiple_suffixes(self, project_tree):
        index = _build_file_index(project_tree, {".ts", ".tsx"})
        assert "Button.tsx" in index
        assert "format.ts" in index

    def test_only_requested_suffixes(self, project_tree):
        index = _build_file_index(project_tree, {".tsx"})
        # .ts files should not be in the index
        assert "format.ts" not in index
        assert "Button.tsx" in index


class TestFindCorrectPathIndexed:
    """Tests for the indexed path finder (same logic, uses pre-built index)."""

    def test_index_pattern_match(self, project_tree):
        """Same as _find_correct_path but using indexed version."""
        index = _build_file_index(project_tree, {".ts"})
        result = _find_correct_path_indexed(
            "src/preload/api.ts", ("src", "preload"), index
        )
        assert result is not None
        assert Path(result) == Path("src/preload/api/index.ts")

    def test_basename_match(self, project_tree):
        index = _build_file_index(project_tree, {".ts"})
        result = _find_correct_path_indexed(
            "src/shared/format.ts", ("src", "shared"), index
        )
        assert result is not None
        assert Path(result) == Path("src/shared/utils/format.ts")

    def test_no_match(self, project_tree):
        index = _build_file_index(project_tree, {".ts"})
        result = _find_correct_path_indexed(
            "nonexistent.ts", (), index
        )
        assert result is None

    def test_ambiguous_returns_none(self, project_tree):
        index = _build_file_index(project_tree, {".ts"})
        # "helpers.ts" has two matches with no shared parent context
        result = _find_correct_path_indexed(
            "foo/helpers.ts", ("foo",), index
        )
        assert result is None


# =============================================================================
# _auto_correct_subtask_files TESTS
# =============================================================================


class TestAutoCorrectSubtaskFiles:
    """Tests for auto-correcting file paths in a subtask."""

    def test_corrects_index_pattern_and_persists(self, project_tree, tmp_path):
        """Corrects api.ts -> api/index.ts and writes to plan file."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "id": "p1",
                    "subtasks": [
                        {
                            "id": "t1",
                            "status": "pending",
                            "files_to_modify": [
                                "src/preload/api.ts",
                                "src/renderer/components/Button.tsx",
                            ],
                        }
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        subtask = {
            "id": "t1",
            "files_to_modify": [
                "src/preload/api.ts",
                "src/renderer/components/Button.tsx",
            ],
        }

        still_missing = _auto_correct_subtask_files(
            subtask, ["src/preload/api.ts"], project_tree, spec_dir
        )

        # No files should remain missing
        assert still_missing == []

        # In-memory subtask should be updated
        assert "src/preload/api/index.ts" in subtask["files_to_modify"]
        assert "src/preload/api.ts" not in subtask["files_to_modify"]

        # Plan file should be persisted with correction
        saved_plan = json.loads(
            (spec_dir / "implementation_plan.json").read_text()
        )
        saved_files = saved_plan["phases"][0]["subtasks"][0]["files_to_modify"]
        assert "src/preload/api/index.ts" in saved_files
        assert "src/preload/api.ts" not in saved_files

    def test_uncorrectable_files_returned(self, project_tree, tmp_path):
        """Files with no match are returned as still missing."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        plan = {"phases": [{"id": "p1", "subtasks": [{"id": "t1", "status": "pending", "files_to_modify": ["nonexistent.ts"]}]}]}
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        subtask = {"id": "t1", "files_to_modify": ["nonexistent.ts"]}
        still_missing = _auto_correct_subtask_files(
            subtask, ["nonexistent.ts"], project_tree, spec_dir
        )

        assert still_missing == ["nonexistent.ts"]

    def test_no_corrections_skips_write(self, project_tree, tmp_path):
        """When nothing can be corrected, plan file is not rewritten."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        original_content = json.dumps({"phases": [{"id": "p1", "subtasks": [{"id": "t1", "status": "pending", "files_to_modify": ["gone.ts"]}]}]})
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text(original_content)
        mtime_before = plan_file.stat().st_mtime

        subtask = {"id": "t1", "files_to_modify": ["gone.ts"]}
        _auto_correct_subtask_files(subtask, ["gone.ts"], project_tree, spec_dir)

        # File should not have been rewritten (mtime unchanged)
        assert plan_file.stat().st_mtime == mtime_before

    def test_corrects_in_memory_without_plan_file(self, project_tree, tmp_path):
        """When implementation_plan.json does not exist, corrections still apply in-memory."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        # Deliberately do NOT create implementation_plan.json

        subtask = {
            "id": "t1",
            "files_to_modify": [
                "src/preload/api.ts",
                "src/renderer/components/Button.tsx",
            ],
        }

        still_missing = _auto_correct_subtask_files(
            subtask, ["src/preload/api.ts"], project_tree, spec_dir
        )

        # All correctable files should be resolved
        assert still_missing == []

        # In-memory subtask should be updated with corrected path
        assert "src/preload/api/index.ts" in subtask["files_to_modify"]
        assert "src/preload/api.ts" not in subtask["files_to_modify"]
        # Uncorrected file should remain unchanged
        assert "src/renderer/components/Button.tsx" in subtask["files_to_modify"]

        # Plan file should still not exist (no side-effect creation)
        assert not (spec_dir / "implementation_plan.json").exists()

    def test_corrects_in_memory_with_corrupt_plan_file(self, project_tree, tmp_path):
        """When implementation_plan.json contains invalid JSON, corrections still apply in-memory."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        # Write corrupt plan file
        plan_file = spec_dir / "implementation_plan.json"
        plan_file.write_text("not valid json")

        subtask = {
            "id": "t1",
            "files_to_modify": [
                "src/preload/api.ts",
                "src/renderer/components/Button.tsx",
            ],
        }

        still_missing = _auto_correct_subtask_files(
            subtask, ["src/preload/api.ts"], project_tree, spec_dir
        )

        # All correctable files should be resolved
        assert still_missing == []

        # In-memory subtask should be updated with corrected path
        assert "src/preload/api/index.ts" in subtask["files_to_modify"]
        assert "src/preload/api.ts" not in subtask["files_to_modify"]

        # Corrupt plan file should be left unchanged (not overwritten or deleted)
        assert plan_file.read_text() == "not valid json"


# =============================================================================
# validate_subtask_files (with auto-correction integration) TESTS
# =============================================================================


class TestValidateSubtaskFilesWithCorrection:
    """Tests for validate_subtask_files with auto-correction enabled."""

    def test_passes_when_all_files_exist(self, project_tree):
        subtask = {
            "files_to_modify": [
                "src/renderer/components/Button.tsx",
                "src/shared/utils/format.ts",
            ]
        }
        result = validate_subtask_files(subtask, project_tree)
        assert result["success"] is True

    def test_fails_without_spec_dir(self, project_tree):
        """Without spec_dir, auto-correction is skipped and validation fails."""
        subtask = {"files_to_modify": ["src/preload/api.ts"]}
        result = validate_subtask_files(subtask, project_tree)
        assert result["success"] is False
        assert "src/preload/api.ts" in result["missing_files"]

    def test_auto_corrects_with_spec_dir(self, project_tree, tmp_path):
        """With spec_dir, auto-correction fixes the path and passes."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        plan = {
            "phases": [
                {
                    "id": "p1",
                    "subtasks": [
                        {"id": "t1", "status": "pending", "files_to_modify": ["src/preload/api.ts"]}
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        subtask = {"id": "t1", "files_to_modify": ["src/preload/api.ts"]}
        result = validate_subtask_files(subtask, project_tree, spec_dir)
        assert result["success"] is True

    def test_rejects_path_traversal(self, project_tree):
        """Paths that resolve outside project are rejected."""
        subtask = {"files_to_modify": ["../../etc/passwd"]}
        result = validate_subtask_files(subtask, project_tree)
        assert result["success"] is False
        assert len(result["invalid_paths"]) > 0


# =============================================================================
# _validate_plan_file_paths TESTS
# =============================================================================


class TestValidatePlanFilePaths:
    """Tests for post-planning file path validation."""

    def test_all_paths_valid_returns_none(self, project_tree, tmp_path):
        """When all paths exist, returns None (no issues)."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        plan = {
            "phases": [
                {
                    "id": "p1",
                    "subtasks": [
                        {
                            "id": "t1",
                            "status": "pending",
                            "files_to_modify": [
                                "src/renderer/components/Button.tsx",
                                "src/shared/utils/format.ts",
                            ],
                        }
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = _validate_plan_file_paths(spec_dir, project_tree)
        assert result is None

    def test_auto_corrects_and_returns_none(self, project_tree, tmp_path):
        """Correctable paths are fixed, plan persisted, returns None."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        plan = {
            "phases": [
                {
                    "id": "p1",
                    "subtasks": [
                        {
                            "id": "t1",
                            "status": "pending",
                            "files_to_modify": ["src/preload/api.ts"],
                        }
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = _validate_plan_file_paths(spec_dir, project_tree)
        assert result is None

        # Verify plan was updated on disk
        saved = json.loads((spec_dir / "implementation_plan.json").read_text())
        assert saved["phases"][0]["subtasks"][0]["files_to_modify"] == [
            "src/preload/api/index.ts"
        ]

    def test_uncorrectable_returns_retry_context(self, project_tree, tmp_path):
        """Returns retry context string when paths can't be corrected."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        plan = {
            "phases": [
                {
                    "id": "p1",
                    "subtasks": [
                        {
                            "id": "t1",
                            "status": "pending",
                            "files_to_modify": ["totally/fake/path.ts"],
                        }
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = _validate_plan_file_paths(spec_dir, project_tree)
        assert result is not None
        assert "FILE PATH VALIDATION ERRORS" in result
        assert "totally/fake/path.ts" in result

    def test_mixed_valid_invalid_correctable(self, project_tree, tmp_path):
        """Mix of correct, correctable, and uncorrectable paths across subtasks."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        plan = {
            "phases": [
                {
                    "id": "p1",
                    "subtasks": [
                        {
                            "id": "t1",
                            "status": "pending",
                            "files_to_modify": [
                                "src/renderer/components/Button.tsx",  # valid
                                "src/preload/api.ts",  # correctable
                            ],
                        },
                        {
                            "id": "t2",
                            "status": "pending",
                            "files_to_modify": [
                                "nonexistent/file.xyz",  # uncorrectable
                            ],
                        },
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = _validate_plan_file_paths(spec_dir, project_tree)
        assert result is not None
        assert "nonexistent/file.xyz" in result
        # api.ts should have been corrected
        assert "api.ts" not in result

    def test_no_plan_file_returns_none(self, tmp_path):
        """Returns None if implementation_plan.json doesn't exist."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        result = _validate_plan_file_paths(spec_dir, tmp_path)
        assert result is None

    def test_subtask_without_files_to_modify(self, project_tree, tmp_path):
        """Subtasks with no files_to_modify are gracefully skipped."""
        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()
        plan = {
            "phases": [
                {
                    "id": "p1",
                    "subtasks": [
                        {"id": "t1", "status": "pending", "description": "No files"},
                    ],
                }
            ]
        }
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

        result = _validate_plan_file_paths(spec_dir, project_tree)
        assert result is None


# =============================================================================
# PHASE DEPENDENCY FIX (progress.py get_next_subtask) TESTS
# =============================================================================


class TestStuckSubtasksUnblockPhases:
    """Tests that stuck subtasks in a phase allow downstream phases to proceed."""

    def _write_plan(self, spec_dir, plan):
        (spec_dir / "implementation_plan.json").write_text(json.dumps(plan))

    def _write_stuck(self, spec_dir, stuck_ids):
        memory_dir = spec_dir / "memory"
        memory_dir.mkdir(parents=True, exist_ok=True)
        history = {
            "subtasks": {},
            "stuck_subtasks": [
                {"subtask_id": sid, "reason": "test"} for sid in stuck_ids
            ],
            "metadata": {"created_at": "2025-01-01", "last_updated": "2025-01-01"},
        }
        (memory_dir / "attempt_history.json").write_text(json.dumps(history))

    def test_stuck_in_phase1_unblocks_phase2(self, tmp_path):
        """When all non-completed subtasks in phase 1 are stuck, phase 2 proceeds."""
        from progress import get_next_subtask

        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "id": "1",
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1.1", "status": "completed"},
                        {"id": "1.2", "status": "pending"},  # This one is stuck
                    ],
                },
                {
                    "id": "2",
                    "name": "Phase 2",
                    "depends_on": ["1"],
                    "subtasks": [
                        {"id": "2.1", "status": "pending"},
                    ],
                },
            ]
        }

        self._write_plan(spec_dir, plan)
        self._write_stuck(spec_dir, ["1.2"])

        result = get_next_subtask(spec_dir)
        assert result is not None
        assert result["id"] == "2.1", "Phase 2 should be unblocked since 1.2 is stuck"

    def test_completed_plus_stuck_unblocks(self, tmp_path):
        """Phase with mix of completed and stuck subtasks counts as resolved."""
        from progress import get_next_subtask

        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "id": "1",
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1.1", "status": "completed"},
                        {"id": "1.2", "status": "completed"},
                        {"id": "1.3", "status": "pending"},  # stuck
                    ],
                },
                {
                    "id": "2",
                    "name": "Phase 2",
                    "depends_on": ["1"],
                    "subtasks": [
                        {"id": "2.1", "status": "pending"},
                    ],
                },
            ]
        }

        self._write_plan(spec_dir, plan)
        self._write_stuck(spec_dir, ["1.3"])

        result = get_next_subtask(spec_dir)
        assert result is not None
        assert result["id"] == "2.1"

    def test_pending_non_stuck_blocks_phase(self, tmp_path):
        """Phase with a pending (non-stuck) subtask still blocks dependents."""
        from progress import get_next_subtask

        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "id": "1",
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1.1", "status": "completed"},
                        {"id": "1.2", "status": "pending"},  # stuck
                        {"id": "1.3", "status": "pending"},  # NOT stuck
                    ],
                },
                {
                    "id": "2",
                    "name": "Phase 2",
                    "depends_on": ["1"],
                    "subtasks": [
                        {"id": "2.1", "status": "pending"},
                    ],
                },
            ]
        }

        self._write_plan(spec_dir, plan)
        self._write_stuck(spec_dir, ["1.2"])

        result = get_next_subtask(spec_dir)
        assert result is not None
        # Should pick 1.3 (pending, not stuck) from phase 1, NOT 2.1
        assert result["id"] == "1.3"

    def test_all_phases_stuck_returns_none(self, tmp_path):
        """When every pending subtask across all phases is stuck, returns None."""
        from progress import get_next_subtask

        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "id": "1",
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1.1", "status": "pending"},
                    ],
                },
                {
                    "id": "2",
                    "name": "Phase 2",
                    "depends_on": ["1"],
                    "subtasks": [
                        {"id": "2.1", "status": "pending"},
                    ],
                },
            ]
        }

        self._write_plan(spec_dir, plan)
        self._write_stuck(spec_dir, ["1.1", "2.1"])

        result = get_next_subtask(spec_dir)
        assert result is None

    def test_chain_of_three_phases_with_stuck(self, tmp_path):
        """Phase 1 stuck -> phase 2 stuck -> phase 3 can still run."""
        from progress import get_next_subtask

        spec_dir = tmp_path / "spec"
        spec_dir.mkdir()

        plan = {
            "phases": [
                {
                    "id": "1",
                    "name": "Phase 1",
                    "subtasks": [
                        {"id": "1.1", "status": "pending"},
                    ],
                },
                {
                    "id": "2",
                    "name": "Phase 2",
                    "depends_on": ["1"],
                    "subtasks": [
                        {"id": "2.1", "status": "pending"},
                    ],
                },
                {
                    "id": "3",
                    "name": "Phase 3",
                    "depends_on": ["2"],
                    "subtasks": [
                        {"id": "3.1", "status": "pending"},
                    ],
                },
            ]
        }

        self._write_plan(spec_dir, plan)
        self._write_stuck(spec_dir, ["1.1", "2.1"])

        result = get_next_subtask(spec_dir)
        assert result is not None
        assert result["id"] == "3.1"

#!/usr/bin/env python3
"""
End-to-End Testing Script for GitLab Support
=============================================

This script performs end-to-end testing of the GitLab MR creation functionality.
It tests provider detection, CLI availability, WorktreeManager integration,
and error handling.

Usage:
    # Run as pytest
    cd apps/backend && uv run pytest ../../tests/test_gitlab_e2e.py -v

    # Run as standalone script
    python tests/test_gitlab_e2e.py

Requirements:
    - glab CLI installed and authenticated (for full test)
    - Git repository with proper remotes configured
"""

import inspect
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

# Add apps/backend directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from core.git_provider import detect_git_provider
from core.glab_executable import get_glab_executable


def print_header(title: str) -> None:
    """Print a test section header."""
    print("\n" + "=" * 70)
    print(f" {title}")
    print("=" * 70)


def print_test(name: str) -> None:
    """Print a test name."""
    print(f"\n→ Test: {name}")


def print_result(success: bool, message: str) -> None:
    """Print test result."""
    status = "✓ PASS" if success else "✗ FAIL"
    print(f"  {status}: {message}")


def _check_glab_detection() -> bool:
    """Helper: Verify glab CLI detection."""
    print_test("Detect glab CLI installation")

    glab_path = get_glab_executable()

    if glab_path:
        print_result(True, f"glab CLI found at: {glab_path}")

        # Verify version
        try:
            result = subprocess.run(
                [glab_path, "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                version = result.stdout.strip()
                print(f"  Version: {version}")
                return True
            else:
                print_result(False, "glab version check failed")
                return False
        except Exception as e:
            print_result(False, f"Error checking glab version: {e}")
            return False
    else:
        print_result(False, "glab CLI not found - some tests will be skipped")
        print("  Install glab from: https://gitlab.com/gitlab-org/cli")
        return False


def create_test_git_repo(repo_path: Path, remote_url: str) -> bool:
    """Create a test git repository with a remote.

    Args:
        repo_path: Path where to create the repo
        remote_url: Git remote URL to set

    Returns:
        True if successful, False otherwise
    """
    try:
        repo_path.mkdir(parents=True, exist_ok=True)

        # Clear GIT_* environment variables to prevent worktree interference
        env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}

        # Initialize git repo
        subprocess.run(
            ["git", "init"],
            cwd=repo_path,
            capture_output=True,
            check=True,
            env=env,
        )

        # Configure git user for commits
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=repo_path,
            capture_output=True,
            check=True,
            env=env,
        )
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=repo_path,
            capture_output=True,
            check=True,
            env=env,
        )

        # Disable GPG signing to prevent hangs in CI
        subprocess.run(
            ["git", "config", "commit.gpgsign", "false"],
            cwd=repo_path,
            capture_output=True,
            check=True,
            env=env,
        )

        # Add remote
        subprocess.run(
            ["git", "remote", "add", "origin", remote_url],
            cwd=repo_path,
            capture_output=True,
            check=True,
            env=env,
        )

        # Create initial commit
        (repo_path / "README.md").write_text("# Test Repository\n")
        subprocess.run(
            ["git", "add", "README.md"],
            cwd=repo_path,
            capture_output=True,
            check=True,
            env=env,
        )
        subprocess.run(
            ["git", "commit", "-m", "Initial commit"],
            cwd=repo_path,
            capture_output=True,
            check=True,
            env=env,
        )

        return True
    except subprocess.CalledProcessError as e:
        print_result(False, f"Failed to create test repo: {e}")
        return False


def _check_provider_detection() -> bool:
    """Helper: Provider detection for various URL patterns."""
    print_test("Detect provider from various remote URL patterns")

    test_cases = [
        ("GitHub HTTPS", "https://github.com/user/repo.git", "github"),
        ("GitHub SSH", "git@github.com:user/repo.git", "github"),
        ("GitHub Enterprise", "https://github.company.com/user/repo.git", "github"),
        ("GitLab Cloud HTTPS", "https://gitlab.com/user/repo.git", "gitlab"),
        ("GitLab Cloud SSH", "git@gitlab.com:user/repo.git", "gitlab"),
        (
            "Self-hosted GitLab HTTPS",
            "https://gitlab.company.com/user/repo.git",
            "gitlab",
        ),
        ("Self-hosted GitLab SSH", "git@gitlab.company.com:user/repo.git", "gitlab"),
        (
            "Self-hosted GitLab Subdomain",
            "https://gitlab.example.org/user/repo.git",
            "gitlab",
        ),
    ]

    all_passed = True

    with tempfile.TemporaryDirectory() as tmpdir:
        for name, remote_url, expected_provider in test_cases:
            repo_path = Path(tmpdir) / name.replace(" ", "_")
            if not create_test_git_repo(repo_path, remote_url):
                print_result(False, f"{name}: Could not create test repo")
                all_passed = False
                continue

            detected = detect_git_provider(str(repo_path))

            if detected == expected_provider:
                print_result(True, f"{name}: Detected '{detected}' for {remote_url}")
            else:
                print_result(
                    False, f"{name}: Expected '{expected_provider}', got '{detected}'"
                )
                all_passed = False

    return all_passed


def _check_method_signatures() -> bool:
    """Helper: WorktreeManager has correct method signatures."""
    print_test("Verify WorktreeManager method signatures")

    try:
        from core.worktree import WorktreeManager

        # Check push_and_create_pr signature
        sig = inspect.signature(WorktreeManager.push_and_create_pr)
        params = list(sig.parameters.keys())
        expected_params = [
            "self",
            "spec_name",
            "target_branch",
            "title",
            "draft",
            "force_push",
        ]

        if all(p in params for p in expected_params):
            print_result(True, f"push_and_create_pr has correct parameters: {params}")
        else:
            print_result(
                False, f"Missing parameters. Expected {expected_params}, got {params}"
            )
            return False

        # Verify create_merge_request method exists
        if hasattr(WorktreeManager, "create_merge_request"):
            print_result(True, "create_merge_request method exists")
        else:
            print_result(False, "create_merge_request method not found")
            return False

        # Verify create_pull_request method still exists (GitHub regression check)
        if hasattr(WorktreeManager, "create_pull_request"):
            print_result(
                True, "create_pull_request method exists (no GitHub regression)"
            )
        else:
            print_result(
                False, "create_pull_request method missing (GitHub regression!)"
            )
            return False

        return True

    except Exception as e:
        print_result(False, f"Error checking method signatures: {e}")
        return False


def _check_error_message_missing_glab() -> bool:
    """Helper: Error message when glab is not installed."""
    print_test("Error handling for missing glab CLI")

    try:
        # Mock get_glab_executable to return None (simulate missing glab)
        with patch("core.glab_executable.get_glab_executable", return_value=None):
            from core.glab_executable import run_glab

            result = run_glab(["mr", "create", "--help"])

        expected_error = "GitLab CLI (glab) not found. Install from https://gitlab.com/gitlab-org/cli"

        if result.returncode != 0 and expected_error in result.stderr:
            print_result(True, "Correct error message when glab missing")
            return True
        elif result.returncode != 0 and "glab" in result.stderr.lower():
            # Partial match - error mentions glab
            print_result(True, f"Error message mentions glab: {result.stderr}")
            return True
        else:
            print_result(
                False,
                f"Unexpected result: returncode={result.returncode}, stderr={result.stderr}",
            )
            return False

    except Exception as e:
        print_result(False, f"Unexpected exception: {e}")
        return False


def _check_worktree_integration() -> bool:
    """Helper: Integration test with WorktreeManager."""
    print_test("WorktreeManager integration with GitLab remote")

    try:
        from core.worktree import WorktreeManager

        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir) / "test-project"

            # Create test repo with GitLab remote
            if not create_test_git_repo(
                repo_path, "https://gitlab.com/test-user/test-repo.git"
            ):
                print_result(False, "Could not create test repository")
                return False

            print_result(True, "Created test repository with GitLab remote")

            # Detect provider
            provider = detect_git_provider(str(repo_path))
            if provider != "gitlab":
                print_result(False, f"Expected 'gitlab', got '{provider}'")
                return False
            print_result(True, f"Provider correctly detected: {provider}")

            # Create WorktreeManager instance (verifies constructor doesn't raise)
            _ = WorktreeManager(project_dir=repo_path, base_branch="main")
            print_result(True, "WorktreeManager instance created successfully")

            return True

    except Exception as e:
        print_result(False, f"Error during test: {e}")
        return False


# =============================================================================
# Pytest Test Functions
# =============================================================================


def test_glab_detection():
    """Pytest: Verify glab CLI detection works when glab is installed."""
    from core.glab_executable import get_glab_executable

    glab_path = get_glab_executable()
    if not glab_path:
        pytest.skip("glab CLI not installed - skipping glab detection test")

    assert _check_glab_detection(), "glab CLI detection failed"


def test_provider_detection():
    """Pytest: Provider detection for various URL patterns."""
    assert _check_provider_detection(), (
        "Provider detection failed for one or more URL patterns"
    )


def test_worktree_manager_method_signatures():
    """Pytest: WorktreeManager has correct method signatures."""
    assert _check_method_signatures(), "WorktreeManager method signature check failed"


def test_error_message_missing_glab():
    """Pytest: Error message when glab is not installed."""
    assert _check_error_message_missing_glab(), (
        "Missing glab error message check failed"
    )


def test_worktree_integration():
    """Pytest: Integration test with WorktreeManager."""
    assert _check_worktree_integration(), "WorktreeManager integration test failed"


def run_all_tests() -> int:
    """Run all end-to-end tests."""
    print_header("GitLab Support - End-to-End Testing")

    print("\nThis script tests the GitLab MR creation functionality:")
    print("  1. glab CLI detection")
    print("  2. Provider detection (GitHub, GitLab cloud, self-hosted)")
    print("  3. WorktreeManager method signatures")
    print("  4. Error handling for missing glab CLI")
    print("  5. WorktreeManager integration")

    results = {}

    # Run all tests
    print_header("Running Tests")

    results["glab_detection"] = _check_glab_detection()
    results["provider_detection"] = _check_provider_detection()
    results["method_signatures"] = _check_method_signatures()
    results["missing_glab_error"] = _check_error_message_missing_glab()
    results["worktree_integration"] = _check_worktree_integration()

    # Print summary
    print_header("Test Summary")

    total = len(results)
    passed = sum(1 for r in results.values() if r)
    failed = total - passed

    print(f"\nTotal Tests: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")

    if failed > 0:
        print("\nFailed tests:")
        for test_name, result in results.items():
            if not result:
                print(f"  ✗ {test_name}")

    print("\n" + "=" * 70)

    if failed == 0:
        print("✓ All tests passed!")
        return 0
    else:
        print(f"✗ {failed} test(s) failed")
        return 1


if __name__ == "__main__":
    try:
        exit_code = run_all_tests()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n\nTests interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)

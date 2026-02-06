#!/usr/bin/env python3
"""
Memory Save Verification Script
================================

Tests the memory save functionality with Graphiti enabled.
Run with DEBUG=true SENTRY_DEV=true to verify Sentry events.

Usage:
    cd apps/backend
    DEBUG=true python scripts/test_memory_save.py

    # With Sentry enabled (for Sentry event verification):
    DEBUG=true SENTRY_DEV=true python scripts/test_memory_save.py
"""

import asyncio
import logging
import os
import sys
import tempfile
from pathlib import Path

# Add the backend directory to the path so we can import modules
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if os.environ.get("DEBUG") else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def test_memory_imports():
    """Test that all memory-related imports work correctly."""
    print("\n=== Testing Memory System Imports ===")

    errors = []

    # Test memory_manager imports
    try:
        from agents.memory_manager import (
            debug_memory_system_status,
            get_graphiti_context,
            save_session_memory,
        )

        print("[OK] agents.memory_manager imports successful")
    except ImportError as e:
        errors.append(f"agents.memory_manager: {e}")
        print(f"[FAIL] agents.memory_manager: {e}")

    # Test graphiti_helpers imports
    try:
        from memory.graphiti_helpers import (
            get_graphiti_memory,
            is_graphiti_memory_enabled,
            save_to_graphiti_async,
        )

        print("[OK] memory.graphiti_helpers imports successful")
    except ImportError as e:
        errors.append(f"memory.graphiti_helpers: {e}")
        print(f"[FAIL] memory.graphiti_helpers: {e}")

    # Test graphiti_config imports
    try:
        from graphiti_config import (
            get_graphiti_status,
            is_graphiti_enabled,
        )

        print("[OK] graphiti_config imports successful")
    except ImportError as e:
        errors.append(f"graphiti_config: {e}")
        print(f"[FAIL] graphiti_config: {e}")

    # Test sentry imports
    try:
        from core.sentry import (
            capture_exception,
            capture_message,
            init_sentry,
        )
        from core.sentry import (
            is_enabled as sentry_is_enabled,
        )

        print("[OK] core.sentry imports successful")
    except ImportError as e:
        errors.append(f"core.sentry: {e}")
        print(f"[FAIL] core.sentry: {e}")

    # Test graphiti queries_pkg imports
    try:
        from integrations.graphiti.queries_pkg.client import GraphitiClient
        from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory
        from integrations.graphiti.queries_pkg.queries import GraphitiQueries
        from integrations.graphiti.queries_pkg.search import GraphitiSearch

        print("[OK] integrations.graphiti.queries_pkg imports successful")
    except ImportError as e:
        errors.append(f"integrations.graphiti.queries_pkg: {e}")
        print(f"[FAIL] integrations.graphiti.queries_pkg: {e}")

    if errors:
        print(f"\n[FAIL] {len(errors)} import error(s) found")
        return False
    else:
        print("\n[OK] All imports successful")
        return True


async def test_graphiti_status():
    """Test Graphiti configuration status."""
    print("\n=== Testing Graphiti Status ===")

    try:
        from graphiti_config import get_graphiti_status, is_graphiti_enabled

        enabled = is_graphiti_enabled()
        status = get_graphiti_status()

        print(f"Graphiti Enabled: {enabled}")
        print(f"Graphiti Available: {status.get('available')}")
        print(f"  Host: {status.get('host')}")
        print(f"  Port: {status.get('port')}")
        print(f"  Database: {status.get('database')}")
        print(f"  LLM Provider: {status.get('llm_provider')}")
        print(f"  Embedder Provider: {status.get('embedder_provider')}")

        if not status.get("available"):
            print(f"  Reason: {status.get('reason')}")
            print(f"  Errors: {status.get('errors')}")

        return enabled
    except Exception as e:
        print(f"[FAIL] Error checking Graphiti status: {e}")
        return False


async def test_sentry_status():
    """Test Sentry configuration status.

    Returns True if:
    - Sentry is enabled and ready, OR
    - Sentry is properly disabled due to configuration (no DSN, not dev mode, SDK not installed)

    Only returns False if there's an unexpected error.
    """
    print("\n=== Testing Sentry Status ===")

    try:
        from core.sentry import init_sentry, is_enabled, is_initialized

        # Check if SENTRY_DEV is set
        sentry_dev = os.environ.get("SENTRY_DEV", "").lower() in ("true", "1", "yes")
        sentry_dsn = os.environ.get("SENTRY_DSN", "")

        print(f"SENTRY_DSN set: {bool(sentry_dsn)}")
        print(f"SENTRY_DEV: {sentry_dev}")

        # Initialize Sentry
        init_sentry(component="memory-test")

        print(f"Sentry Initialized: {is_initialized()}")
        print(f"Sentry Enabled: {is_enabled()}")

        if is_enabled():
            print("[OK] Sentry is enabled and ready to capture events")
        else:
            # Sentry being disabled is OK - it just means configuration requires it
            if not sentry_dsn:
                print("[INFO] Sentry disabled - no SENTRY_DSN configured (expected)")
            elif not sentry_dev:
                print(
                    "[INFO] Sentry disabled in dev mode - set SENTRY_DEV=true to enable"
                )
            else:
                print("[INFO] Sentry disabled - sentry-sdk may not be installed")
            print(
                "[OK] Sentry integration configured correctly (disabled by configuration)"
            )

        # Return True even if disabled - we're testing that the integration works,
        # not that Sentry is necessarily enabled
        return True
    except Exception as e:
        print(f"[FAIL] Error checking Sentry status: {e}")
        return False


async def test_memory_save_flow():
    """Test the memory save flow end-to-end."""
    print("\n=== Testing Memory Save Flow ===")

    # Create temporary directories for testing
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        spec_dir = tmp_path / "test_spec"
        spec_dir.mkdir(parents=True)
        project_dir = tmp_path / "project"
        project_dir.mkdir(parents=True)

        print(f"Test spec_dir: {spec_dir}")
        print(f"Test project_dir: {project_dir}")

        try:
            from agents.memory_manager import save_session_memory

            # Test memory save with sample data
            subtask_id = "test-subtask-1"
            session_num = 1
            success = True
            subtasks_completed = ["test-subtask-1"]
            discoveries = {
                "files_understood": {"test.py": "Test file for memory verification"},
                "patterns_found": ["Test pattern: Always verify imports"],
                "gotchas_encountered": ["Test gotcha: Check async/await usage"],
            }

            print("\nSaving test session memory...")
            print(f"  subtask_id: {subtask_id}")
            print(f"  session_num: {session_num}")
            print(f"  success: {success}")

            result, storage_type = await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                success=success,
                subtasks_completed=subtasks_completed,
                discoveries=discoveries,
            )

            print("\nMemory Save Result:")
            print(f"  Success: {result}")
            print(f"  Storage Type: {storage_type}")

            if result:
                print(f"[OK] Memory save succeeded using {storage_type} storage")

                # Verify file was created if file-based
                if storage_type == "file":
                    memory_file = (
                        spec_dir
                        / "memory"
                        / "session_insights"
                        / f"session_{session_num:03d}.json"
                    )
                    if memory_file.exists():
                        print(f"[OK] Memory file created: {memory_file}")
                    else:
                        print(f"[WARN] Memory file not found: {memory_file}")

                return True
            else:
                print("[FAIL] Memory save failed")
                return False

        except Exception as e:
            print(f"[FAIL] Error during memory save test: {e}")
            import traceback

            traceback.print_exc()

            # Test Sentry capture
            try:
                from core.sentry import capture_exception, is_enabled

                if is_enabled():
                    capture_exception(
                        e,
                        operation="test_memory_save",
                        context="verification_script",
                    )
                    print("[INFO] Exception captured to Sentry")
            except Exception:
                pass

            return False


async def test_sentry_capture():
    """Test that Sentry capture works (only if Sentry is enabled)."""
    print("\n=== Testing Sentry Capture ===")

    try:
        from core.sentry import (
            capture_exception,
            capture_message,
            is_enabled,
        )

        if not is_enabled():
            print("[SKIP] Sentry not enabled - skipping capture test")
            print("       Set SENTRY_DSN and SENTRY_DEV=true to test Sentry capture")
            return True

        # Test capture_message
        print("Sending test message to Sentry...")
        capture_message(
            "Memory save verification script test message",
            level="info",
            test_type="verification",
            component="memory-test",
        )
        print("[OK] Test message sent to Sentry")

        # Test capture_exception
        print("Sending test exception to Sentry...")
        try:
            raise ValueError("Test exception for memory save verification")
        except Exception as e:
            capture_exception(
                e,
                operation="test_exception",
                context="verification_script",
            )
        print("[OK] Test exception sent to Sentry")

        print("\n[INFO] Check your Sentry dashboard for the test events")
        return True

    except Exception as e:
        print(f"[FAIL] Error testing Sentry capture: {e}")
        return False


async def main():
    """Run all memory save verification tests."""
    print("=" * 60)
    print("Memory Save Verification Script")
    print("=" * 60)
    print(f"DEBUG: {os.environ.get('DEBUG', 'not set')}")
    print(f"SENTRY_DEV: {os.environ.get('SENTRY_DEV', 'not set')}")
    print(f"GRAPHITI_ENABLED: {os.environ.get('GRAPHITI_ENABLED', 'not set')}")

    results = {}

    # Run tests
    results["imports"] = await test_memory_imports()
    results["graphiti_status"] = await test_graphiti_status()
    results["sentry_status"] = await test_sentry_status()
    results["memory_save"] = await test_memory_save_flow()
    results["sentry_capture"] = await test_sentry_capture()

    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)

    passed = 0
    failed = 0
    for test_name, result in results.items():
        status = "[OK]" if result else "[FAIL]"
        print(f"  {status} {test_name}")
        if result:
            passed += 1
        else:
            failed += 1

    print(f"\nTotal: {passed} passed, {failed} failed")

    if failed > 0:
        print("\n[FAIL] Some tests failed")
        sys.exit(1)
    else:
        print("\n[OK] All tests passed")
        sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())

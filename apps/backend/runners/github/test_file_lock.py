"""
Test File Locking for Concurrent Operations
===========================================

Demonstrates file locking preventing data corruption in concurrent scenarios.
"""

import asyncio
import json
import tempfile
import time
from pathlib import Path

from file_lock import (
    FileLock,
    FileLockTimeout,
    locked_json_read,
    locked_json_update,
    locked_json_write,
    locked_read,
    locked_write,
)


async def test_basic_file_lock():
    """Test basic file locking mechanism."""
    print("\n=== Test 1: Basic File Lock ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "test.txt"
        test_file.write_text("initial content", encoding="utf-8")

        # Acquire lock and hold it
        async with FileLock(test_file, timeout=5.0):
            print("✓ Lock acquired successfully")
            # Do work while holding lock
            await asyncio.sleep(0.1)
            print("✓ Lock held during work")

        print("✓ Lock released automatically")


async def test_locked_write():
    """Test atomic locked write operations."""
    print("\n=== Test 2: Locked Write ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "data.json"

        # Write data with locking
        data = {"count": 0, "items": ["a", "b", "c"]}
        async with locked_write(test_file, timeout=5.0) as f:
            json.dump(data, f, indent=2)

        print(f"✓ Written to {test_file.name}")

        # Verify data was written correctly
        with open(test_file, encoding="utf-8") as f:
            loaded = json.load(f)
            assert loaded == data
            print(f"✓ Data verified: {loaded}")


async def test_locked_json_helpers():
    """Test JSON helper functions."""
    print("\n=== Test 3: JSON Helpers ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "data.json"

        # Write JSON
        data = {"users": [], "total": 0}
        await locked_json_write(test_file, data, timeout=5.0)
        print(f"✓ JSON written: {data}")

        # Read JSON
        loaded = await locked_json_read(test_file, timeout=5.0)
        assert loaded == data
        print(f"✓ JSON read: {loaded}")


async def test_locked_json_update():
    """Test atomic read-modify-write updates."""
    print("\n=== Test 4: Atomic Updates ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "counter.json"

        # Initialize counter
        await locked_json_write(test_file, {"count": 0}, timeout=5.0)
        print("✓ Counter initialized to 0")

        # Define update function
        def increment_counter(data):
            data["count"] += 1
            return data

        # Perform 5 atomic updates
        for i in range(5):
            await locked_json_update(test_file, increment_counter, timeout=5.0)

        # Verify final count
        final = await locked_json_read(test_file, timeout=5.0)
        assert final["count"] == 5
        print(f"✓ Counter incremented 5 times: {final}")


async def test_concurrent_updates_without_lock():
    """Demonstrate data corruption WITHOUT file locking."""
    print("\n=== Test 5: Concurrent Updates WITHOUT Locking (UNSAFE) ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "unsafe.json"

        # Initialize counter
        test_file.write_text(json.dumps({"count": 0}), encoding="utf-8")

        async def unsafe_increment():
            """Increment without locking - RACE CONDITION!"""
            # Read
            with open(test_file, encoding="utf-8") as f:
                data = json.load(f)

            # Simulate some processing
            await asyncio.sleep(0.01)

            # Write
            data["count"] += 1
            with open(test_file, "w", encoding="utf-8") as f:
                json.dump(data, f)

        # Run 10 concurrent increments
        await asyncio.gather(*[unsafe_increment() for _ in range(10)])

        # Check final count
        with open(test_file, encoding="utf-8") as f:
            final = json.load(f)

        print("✗ Expected count: 10")
        print(f"✗ Actual count: {final['count']} (CORRUPTED due to race condition)")
        print(
            f"✗ Lost updates: {10 - final['count']} (multiple processes overwrote each other)"
        )


async def test_concurrent_updates_with_lock():
    """Demonstrate data integrity WITH file locking."""
    print("\n=== Test 6: Concurrent Updates WITH Locking (SAFE) ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "safe.json"

        # Initialize counter
        await locked_json_write(test_file, {"count": 0}, timeout=5.0)

        async def safe_increment():
            """Increment with locking - NO RACE CONDITION!"""

            def increment(data):
                # Simulate some processing
                time.sleep(0.01)
                data["count"] += 1
                return data

            await locked_json_update(test_file, increment, timeout=5.0)

        # Run 10 concurrent increments
        await asyncio.gather(*[safe_increment() for _ in range(10)])

        # Check final count
        final = await locked_json_read(test_file, timeout=5.0)

        assert final["count"] == 10
        print("✓ Expected count: 10")
        print(f"✓ Actual count: {final['count']} (CORRECT with file locking)")
        print("✓ No data corruption - all updates applied successfully")


async def test_lock_timeout():
    """Test lock timeout behavior."""
    print("\n=== Test 7: Lock Timeout ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "timeout.json"
        test_file.write_text(json.dumps({"data": "test"}), encoding="utf-8")

        # Acquire lock and hold it
        lock1 = FileLock(test_file, timeout=1.0)
        await lock1.__aenter__()
        print("✓ First lock acquired")

        try:
            # Try to acquire second lock with short timeout
            lock2 = FileLock(test_file, timeout=0.5)
            await lock2.__aenter__()
            print("✗ Second lock acquired (should have timed out!)")
        except FileLockTimeout as e:
            print(f"✓ Second lock timed out as expected: {e}")
        finally:
            await lock1.__aexit__(None, None, None)
            print("✓ First lock released")


async def test_index_update_pattern():
    """Test the index update pattern used in models.py."""
    print("\n=== Test 8: Index Update Pattern (Production Pattern) ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        index_file = Path(tmpdir) / "index.json"

        # Simulate multiple PR reviews updating the index concurrently
        async def add_review(pr_number: int, status: str):
            """Add or update a PR review in the index."""

            def update_index(current_data):
                if current_data is None:
                    current_data = {"reviews": [], "last_updated": None}

                reviews = current_data.get("reviews", [])
                existing = next(
                    (r for r in reviews if r["pr_number"] == pr_number), None
                )

                entry = {
                    "pr_number": pr_number,
                    "status": status,
                    "timestamp": time.time(),
                }

                if existing:
                    reviews = [
                        entry if r["pr_number"] == pr_number else r for r in reviews
                    ]
                else:
                    reviews.append(entry)

                current_data["reviews"] = reviews
                current_data["last_updated"] = time.time()

                return current_data

            await locked_json_update(index_file, update_index, timeout=5.0)

        # Simulate 5 concurrent review updates
        print("Simulating 5 concurrent PR review updates...")
        await asyncio.gather(
            add_review(101, "approved"),
            add_review(102, "changes_requested"),
            add_review(103, "commented"),
            add_review(104, "approved"),
            add_review(105, "approved"),
        )

        # Verify all reviews were recorded
        final_index = await locked_json_read(index_file, timeout=5.0)
        assert len(final_index["reviews"]) == 5
        print("✓ All 5 reviews recorded correctly")
        print(f"✓ Index state: {len(final_index['reviews'])} reviews")

        # Update an existing review
        await add_review(102, "approved")  # Change status
        updated_index = await locked_json_read(index_file, timeout=5.0)
        assert len(updated_index["reviews"]) == 5  # Still 5, not 6
        review_102 = next(r for r in updated_index["reviews"] if r["pr_number"] == 102)
        assert review_102["status"] == "approved"
        print("✓ Review #102 updated from 'changes_requested' to 'approved'")
        print("✓ No duplicate entries created")


async def test_atomic_write_failure():
    """Test that failed writes don't corrupt existing files."""
    print("\n=== Test 9: Atomic Write Failure Handling ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "important.json"

        # Write initial data
        initial_data = {"important": "data", "version": 1}
        await locked_json_write(test_file, initial_data, timeout=5.0)
        print(f"✓ Initial data written: {initial_data}")

        # Try to write invalid data that will fail
        try:
            async with locked_write(test_file, timeout=5.0) as f:
                f.write("{invalid json")
                # Simulate an error during write
                raise Exception("Simulated write failure")
        except Exception as e:
            print(f"✓ Write failed as expected: {e}")

        # Verify original data is intact (atomic write rolled back)
        current_data = await locked_json_read(test_file, timeout=5.0)
        assert current_data == initial_data
        print(f"✓ Original data intact after failed write: {current_data}")
        print(
            "✓ Atomic write prevented corruption (temp file discarded, original preserved)"
        )


async def main():
    """Run all tests."""
    print("=" * 70)
    print("File Locking Tests - Preventing Concurrent Operation Corruption")
    print("=" * 70)

    tests = [
        test_basic_file_lock,
        test_locked_write,
        test_locked_json_helpers,
        test_locked_json_update,
        test_concurrent_updates_without_lock,
        test_concurrent_updates_with_lock,
        test_lock_timeout,
        test_index_update_pattern,
        test_atomic_write_failure,
    ]

    for test in tests:
        try:
            await test()
        except Exception as e:
            print(f"✗ Test failed: {e}")
            import traceback

            traceback.print_exc()

    print("\n" + "=" * 70)
    print("All Tests Completed!")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())

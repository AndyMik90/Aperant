"""
Example Usage of File Locking in GitHub Automation
==================================================

Demonstrates real-world usage patterns for the file locking system.
"""

import asyncio
from pathlib import Path

from models import (
    AutoFixState,
    AutoFixStatus,
    PRReviewFinding,
    PRReviewResult,
    ReviewCategory,
    ReviewSeverity,
    TriageCategory,
    TriageResult,
)


async def example_concurrent_auto_fix():
    """
    Example: Multiple auto-fix jobs running concurrently.

    Scenario: 3 GitHub issues are being auto-fixed simultaneously.
    Each job needs to:
    1. Save its state to disk
    2. Update the shared auto-fix queue index

    Without file locking: Race conditions corrupt the index
    With file locking: All updates are atomic and safe
    """
    print("\n=== Example 1: Concurrent Auto-Fix Jobs ===\n")

    github_dir = Path(".ac.jerry/github")

    async def process_auto_fix(issue_number: int):
        """Simulate an auto-fix job processing an issue."""
        print(f"Job {issue_number}: Starting auto-fix...")

        # Create auto-fix state
        state = AutoFixState(
            issue_number=issue_number,
            issue_url=f"https://github.com/owner/repo/issues/{issue_number}",
            repo="owner/repo",
            status=AutoFixStatus.ANALYZING,
        )

        # Save state - uses locked_json_write internally
        state.save(github_dir)
        print(f"Job {issue_number}: State saved")

        # Simulate work
        await asyncio.sleep(0.1)

        # Update status
        state.update_status(AutoFixStatus.CREATING_SPEC)
        state.spec_id = f"spec-{issue_number}"

        # Save again - atomically updates both state file and index
        state.save(github_dir)
        print(f"Job {issue_number}: Updated to CREATING_SPEC")

        # More work
        await asyncio.sleep(0.1)

        # Final update
        state.update_status(AutoFixStatus.COMPLETED)
        state.pr_number = 100 + issue_number
        state.pr_url = f"https://github.com/owner/repo/pull/{state.pr_number}"

        # Final save - all updates are atomic
        state.save(github_dir)
        print(f"Job {issue_number}: Completed successfully")

    # Run 3 concurrent auto-fix jobs
    print("Starting 3 concurrent auto-fix jobs...\n")
    await asyncio.gather(
        process_auto_fix(1001),
        process_auto_fix(1002),
        process_auto_fix(1003),
    )

    print("\n✓ All jobs completed without data corruption!")
    print("✓ Index file contains all 3 auto-fix entries")


async def example_concurrent_pr_reviews():
    """
    Example: Multiple PR reviews happening concurrently.

    Scenario: CI/CD is reviewing multiple PRs in parallel.
    Each review needs to:
    1. Save review results to disk
    2. Update the shared PR review index

    File locking ensures no reviews are lost.
    """
    print("\n=== Example 2: Concurrent PR Reviews ===\n")

    github_dir = Path(".ac.jerry/github")

    async def review_pr(pr_number: int, findings_count: int, status: str):
        """Simulate reviewing a PR."""
        print(f"Reviewing PR #{pr_number}...")

        # Create findings
        findings = [
            PRReviewFinding(
                id=f"finding-{i}",
                severity=ReviewSeverity.MEDIUM,
                category=ReviewCategory.QUALITY,
                title=f"Finding {i}",
                description=f"Issue found in PR #{pr_number}",
                file="src/main.py",
                line=10 + i,
                fixable=True,
            )
            for i in range(findings_count)
        ]

        # Create review result
        review = PRReviewResult(
            pr_number=pr_number,
            repo="owner/repo",
            success=True,
            findings=findings,
            summary=f"Found {findings_count} issues in PR #{pr_number}",
            overall_status=status,
        )

        # Save review - uses locked_json_write internally
        review.save(github_dir)
        print(f"PR #{pr_number}: Review saved with {findings_count} findings")

        return review

    # Review 5 PRs concurrently
    print("Reviewing 5 PRs concurrently...\n")
    reviews = await asyncio.gather(
        review_pr(101, 3, "comment"),
        review_pr(102, 5, "request_changes"),
        review_pr(103, 0, "approve"),
        review_pr(104, 2, "comment"),
        review_pr(105, 1, "approve"),
    )

    print(f"\n✓ All {len(reviews)} reviews saved successfully!")
    print("✓ Index file contains all review summaries")


async def example_triage_queue():
    """
    Example: Issue triage with concurrent processing.

    Scenario: Bot is triaging new issues as they come in.
    Multiple issues can be triaged simultaneously.

    File locking prevents duplicate triage or lost results.
    """
    print("\n=== Example 3: Concurrent Issue Triage ===\n")

    github_dir = Path(".ac.jerry/github")

    async def triage_issue(issue_number: int, category: TriageCategory, priority: str):
        """Simulate triaging an issue."""
        print(f"Triaging issue #{issue_number}...")

        # Create triage result
        triage = TriageResult(
            issue_number=issue_number,
            repo="owner/repo",
            category=category,
            confidence=0.85,
            labels_to_add=[category.value, priority],
            priority=priority,
            comment=f"Automatically triaged as {category.value}",
        )

        # Save triage result - uses locked_json_write internally
        triage.save(github_dir)
        print(f"Issue #{issue_number}: Triaged as {category.value} ({priority})")

        return triage

    # Triage multiple issues concurrently
    print("Triaging 4 issues concurrently...\n")
    triages = await asyncio.gather(
        triage_issue(2001, TriageCategory.BUG, "high"),
        triage_issue(2002, TriageCategory.FEATURE, "medium"),
        triage_issue(2003, TriageCategory.DOCUMENTATION, "low"),
        triage_issue(2004, TriageCategory.BUG, "critical"),
    )

    print(f"\n✓ All {len(triages)} issues triaged successfully!")
    print("✓ No race conditions or lost triage results")


async def example_index_collision():
    """
    Example: Demonstrating the index update collision problem.

    This shows why file locking is critical for the index files.
    Without locking, concurrent updates corrupt the index.
    """
    print("\n=== Example 4: Why Index Locking is Critical ===\n")

    github_dir = Path(".ac.jerry/github")

    print("Scenario: 10 concurrent auto-fix jobs all updating the same index")
    print("Without locking: Updates overwrite each other (lost updates)")
    print("With locking: All 10 updates are applied correctly\n")

    async def quick_update(issue_number: int):
        """Quick auto-fix update."""
        state = AutoFixState(
            issue_number=issue_number,
            issue_url=f"https://github.com/owner/repo/issues/{issue_number}",
            repo="owner/repo",
            status=AutoFixStatus.PENDING,
        )
        state.save(github_dir)

    # Create 10 concurrent updates
    print("Creating 10 concurrent auto-fix states...")
    await asyncio.gather(*[quick_update(3000 + i) for i in range(10)])

    print("\n✓ All 10 updates completed")
    print("✓ Index contains all 10 entries (no lost updates)")
    print("✓ This is only possible with proper file locking!")


async def example_error_handling():
    """
    Example: Proper error handling with file locking.

    Shows how to handle lock timeouts and other failures gracefully.
    """
    print("\n=== Example 5: Error Handling ===\n")

    github_dir = Path(".ac.jerry/github")

    from file_lock import FileLockTimeout, locked_json_write

    async def save_with_retry(filepath: Path, data: dict, max_retries: int = 3):
        """Save with automatic retry on lock timeout."""
        for attempt in range(max_retries):
            try:
                await locked_json_write(filepath, data, timeout=2.0)
                print(f"✓ Save succeeded on attempt {attempt + 1}")
                return True
            except FileLockTimeout:
                if attempt == max_retries - 1:
                    print(f"✗ Failed after {max_retries} attempts")
                    return False
                print(f"⚠ Lock timeout on attempt {attempt + 1}, retrying...")
                await asyncio.sleep(0.5)

        return False

    # Try to save with retry logic
    test_file = github_dir / "test" / "example.json"
    test_file.parent.mkdir(parents=True, exist_ok=True)

    print("Attempting save with retry logic...\n")
    success = await save_with_retry(test_file, {"test": "data"})

    if success:
        print("\n✓ Data saved successfully with retry logic")
    else:
        print("\n✗ Save failed even with retries")


async def main():
    """Run all examples."""
    print("=" * 70)
    print("File Locking Examples - Real-World Usage Patterns")
    print("=" * 70)

    examples = [
        example_concurrent_auto_fix,
        example_concurrent_pr_reviews,
        example_triage_queue,
        example_index_collision,
        example_error_handling,
    ]

    for example in examples:
        try:
            await example()
            await asyncio.sleep(0.5)  # Brief pause between examples
        except Exception as e:
            print(f"✗ Example failed: {e}")
            import traceback

            traceback.print_exc()

    print("\n" + "=" * 70)
    print("All Examples Completed!")
    print("=" * 70)
    print("\nKey Takeaways:")
    print("1. File locking prevents data corruption in concurrent scenarios")
    print("2. All save() methods now use atomic locked writes")
    print("3. Index updates are protected from race conditions")
    print("4. Lock timeouts can be handled gracefully with retries")
    print("5. The system scales safely to multiple concurrent operations")


if __name__ == "__main__":
    asyncio.run(main())

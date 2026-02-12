"""
GitHub CLI Client with Timeout and Retry Logic
==============================================

Wrapper for gh CLI commands that prevents hung processes through:
- Configurable timeouts (default 30s)
- Exponential backoff retry (3 attempts: 1s, 2s, 4s)
- Structured logging for monitoring
- Async subprocess execution for non-blocking operations

This eliminates the risk of indefinite hangs in GitHub automation workflows.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from core.gh_executable import get_gh_executable

try:
    from .rate_limiter import RateLimiter, RateLimitExceeded
except (ImportError, ValueError, SystemError):
    from rate_limiter import RateLimiter, RateLimitExceeded

# Configure logger
logger = logging.getLogger(__name__)


class GHTimeoutError(Exception):
    """Raised when gh CLI command times out after all retry attempts."""

    pass


class GHCommandError(Exception):
    """Raised when gh CLI command fails with non-zero exit code."""

    pass


class PRTooLargeError(Exception):
    """Raised when PR diff exceeds GitHub's 20,000 line limit."""

    pass


@dataclass
class GHCommandResult:
    """Result of a gh CLI command execution."""

    stdout: str
    stderr: str
    returncode: int
    command: list[str]
    attempts: int
    total_time: float


class GHClient:
    """
    Async client for GitHub CLI with timeout and retry protection.

    Usage:
        client = GHClient(project_dir=Path("/path/to/project"))

        # Simple command
        result = await client.run(["pr", "list"])

        # With custom timeout
        result = await client.run(["pr", "diff", "123"], timeout=60.0)

        # Convenience methods
        pr_data = await client.pr_get(123)
        diff = await client.pr_diff(123)
        await client.pr_review(123, body="LGTM", event="approve")
    """

    def __init__(
        self,
        project_dir: Path,
        default_timeout: float = 30.0,
        max_retries: int = 3,
        enable_rate_limiting: bool = True,
        repo: str | None = None,
    ):
        """
        Initialize GitHub CLI client.

        Args:
            project_dir: Project directory for gh commands
            default_timeout: Default timeout in seconds for commands
            max_retries: Maximum number of retry attempts
            enable_rate_limiting: Whether to enforce rate limiting (default: True)
            repo: Repository in 'owner/repo' format. If provided, uses -R flag
                  instead of inferring from git remotes.
        """
        self.project_dir = Path(project_dir)
        self.default_timeout = default_timeout
        self.max_retries = max_retries
        self.enable_rate_limiting = enable_rate_limiting
        self.repo = repo

        # Initialize rate limiter singleton
        if enable_rate_limiting:
            self._rate_limiter = RateLimiter.get_instance()

    async def run(
        self,
        args: list[str],
        timeout: float | None = None,
        raise_on_error: bool = True,
    ) -> GHCommandResult:
        """
        Execute a gh CLI command with timeout and retry logic.

        Args:
            args: Command arguments (e.g., ["pr", "list"])
            timeout: Timeout in seconds (uses default if None)
            raise_on_error: Raise GHCommandError on non-zero exit

        Returns:
            GHCommandResult with command output and metadata

        Raises:
            GHTimeoutError: If command times out after all retries
            GHCommandError: If command fails and raise_on_error is True
        """
        timeout = timeout or self.default_timeout
        gh_exec = get_gh_executable()
        if not gh_exec:
            raise GHCommandError(
                "GitHub CLI (gh) not found. Install from https://cli.github.com/"
            )
        cmd = [gh_exec] + args
        start_time = asyncio.get_event_loop().time()

        # Pre-flight rate limit check
        if self.enable_rate_limiting:
            available, msg = self._rate_limiter.check_github_available()
            if not available:
                # Try to acquire (will wait if needed)
                logger.info(f"Rate limited, waiting for token: {msg}")
                if not await self._rate_limiter.acquire_github(timeout=30.0):
                    raise RateLimitExceeded(f"GitHub API rate limit exceeded: {msg}")
            else:
                # Consume a token for this request
                await self._rate_limiter.acquire_github(timeout=1.0)

        for attempt in range(1, self.max_retries + 1):
            try:
                logger.debug(
                    f"Executing gh command (attempt {attempt}/{self.max_retries}): {' '.join(cmd)}"
                )

                # Create subprocess
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=self.project_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                # Wait for completion with timeout
                try:
                    stdout, stderr = await asyncio.wait_for(
                        proc.communicate(), timeout=timeout
                    )
                except asyncio.TimeoutError:
                    # Kill the hung process
                    try:
                        proc.kill()
                        await proc.wait()
                    except Exception as e:
                        logger.warning(f"Failed to kill hung process: {e}")

                    # Calculate backoff delay
                    backoff_delay = 2 ** (attempt - 1)

                    logger.warning(
                        f"gh {args[0]} timed out after {timeout}s "
                        f"(attempt {attempt}/{self.max_retries})"
                    )

                    # Retry if attempts remain
                    if attempt < self.max_retries:
                        logger.info(f"Retrying in {backoff_delay}s...")
                        await asyncio.sleep(backoff_delay)
                        continue
                    else:
                        # All retries exhausted
                        total_time = asyncio.get_event_loop().time() - start_time
                        logger.error(
                            f"gh {args[0]} timed out after {self.max_retries} attempts "
                            f"({total_time:.1f}s total)"
                        )
                        raise GHTimeoutError(
                            f"gh {args[0]} timed out after {self.max_retries} attempts "
                            f"({timeout}s each, {total_time:.1f}s total)"
                        )

                # Successful execution (no timeout)
                total_time = asyncio.get_event_loop().time() - start_time
                stdout_str = stdout.decode("utf-8")
                stderr_str = stderr.decode("utf-8")

                result = GHCommandResult(
                    stdout=stdout_str,
                    stderr=stderr_str,
                    returncode=proc.returncode or 0,
                    command=cmd,
                    attempts=attempt,
                    total_time=total_time,
                )

                if result.returncode != 0:
                    logger.warning(
                        f"gh {args[0]} failed with exit code {result.returncode}: {stderr_str}"
                    )

                    # Check for rate limit errors (403/429)
                    error_lower = stderr_str.lower()
                    if (
                        "403" in stderr_str
                        or "429" in stderr_str
                        or "rate limit" in error_lower
                    ):
                        if self.enable_rate_limiting:
                            self._rate_limiter.record_github_error()
                        raise RateLimitExceeded(
                            f"GitHub API rate limit (HTTP 403/429): {stderr_str}"
                        )

                    if raise_on_error:
                        raise GHCommandError(
                            f"gh {args[0]} failed: {stderr_str or 'Unknown error'}"
                        )
                else:
                    logger.debug(
                        f"gh {args[0]} completed successfully "
                        f"(attempt {attempt}, {total_time:.2f}s)"
                    )

                return result

            except (GHTimeoutError, GHCommandError, RateLimitExceeded):
                # Re-raise our custom exceptions
                raise
            except Exception as e:
                # Unexpected error
                logger.error(f"Unexpected error in gh command: {e}")
                if attempt == self.max_retries:
                    raise GHCommandError(f"gh {args[0]} failed: {str(e)}")
                else:
                    # Retry on unexpected errors too
                    backoff_delay = 2 ** (attempt - 1)
                    logger.info(f"Retrying in {backoff_delay}s after error...")
                    await asyncio.sleep(backoff_delay)
                    continue

        # Should never reach here, but for type safety
        raise GHCommandError(f"gh {args[0]} failed after {self.max_retries} attempts")

    # =========================================================================
    # Helper methods
    # =========================================================================

    def _add_repo_flag(self, args: list[str]) -> list[str]:
        """
        Add -R flag to command args if repo is configured.

        This ensures gh CLI uses the correct repository instead of
        inferring from git remotes, which can fail with multiple remotes
        or when working in worktrees.

        Args:
            args: Command arguments list

        Returns:
            Modified args list with -R flag if repo is set
        """
        if self.repo:
            return args + ["-R", self.repo]
        return args

    # =========================================================================
    # Convenience methods for common gh commands
    # =========================================================================

    async def pr_list(
        self,
        state: str = "open",
        limit: int = 100,
        json_fields: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        List pull requests.

        Args:
            state: PR state (open, closed, merged, all)
            limit: Maximum number of PRs to return
            json_fields: Fields to include in JSON output

        Returns:
            List of PR data dictionaries
        """
        if json_fields is None:
            json_fields = [
                "number",
                "title",
                "state",
                "author",
                "headRefName",
                "baseRefName",
            ]

        args = [
            "pr",
            "list",
            "--state",
            state,
            "--limit",
            str(limit),
            "--json",
            ",".join(json_fields),
        ]
        args = self._add_repo_flag(args)

        result = await self.run(args)
        return json.loads(result.stdout)

    async def pr_get(
        self, pr_number: int, json_fields: list[str] | None = None
    ) -> dict[str, Any]:
        """
        Get PR data by number.

        Args:
            pr_number: PR number
            json_fields: Fields to include in JSON output

        Returns:
            PR data dictionary
        """
        if json_fields is None:
            json_fields = [
                "number",
                "title",
                "body",
                "state",
                "headRefName",
                "baseRefName",
                "author",
                "files",
                "additions",
                "deletions",
                "changedFiles",
            ]

        args = [
            "pr",
            "view",
            str(pr_number),
            "--json",
            ",".join(json_fields),
        ]
        args = self._add_repo_flag(args)

        result = await self.run(args)
        return json.loads(result.stdout)

    async def pr_diff(self, pr_number: int) -> str:
        """
        Get PR diff.

        Args:
            pr_number: PR number

        Returns:
            Unified diff string

        Raises:
            PRTooLargeError: If PR exceeds GitHub's 20,000 line diff limit
        """
        args = ["pr", "diff", str(pr_number)]
        args = self._add_repo_flag(args)
        try:
            result = await self.run(args)
            return result.stdout
        except GHCommandError as e:
            # Check if error is due to PR being too large
            error_msg = str(e)
            if (
                "diff exceeded the maximum number of lines" in error_msg
                or "HTTP 406" in error_msg
            ):
                raise PRTooLargeError(
                    f"PR #{pr_number} exceeds GitHub's 20,000 line diff limit. "
                    "Consider splitting into smaller PRs or review files individually."
                ) from e
            # Re-raise other command errors
            raise

    async def pr_review(
        self,
        pr_number: int,
        body: str,
        event: str = "comment",
    ) -> int:
        """
        Post a review to a PR.

        Args:
            pr_number: PR number
            body: Review comment body
            event: Review event (approve, request-changes, comment)

        Returns:
            Review ID (currently 0, as gh CLI doesn't return ID)
        """
        args = ["pr", "review", str(pr_number)]

        if event.lower() == "approve":
            args.append("--approve")
        elif event.lower() in ["request-changes", "request_changes"]:
            args.append("--request-changes")
        else:
            args.append("--comment")

        args.extend(["--body", body])
        args = self._add_repo_flag(args)

        await self.run(args)
        return 0  # gh CLI doesn't return review ID

    async def issue_list(
        self,
        state: str = "open",
        limit: int = 100,
        json_fields: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        List issues.

        Args:
            state: Issue state (open, closed, all)
            limit: Maximum number of issues to return
            json_fields: Fields to include in JSON output

        Returns:
            List of issue data dictionaries
        """
        if json_fields is None:
            json_fields = [
                "number",
                "title",
                "body",
                "labels",
                "author",
                "createdAt",
                "updatedAt",
                "comments",
            ]

        args = [
            "issue",
            "list",
            "--state",
            state,
            "--limit",
            str(limit),
            "--json",
            ",".join(json_fields),
        ]

        result = await self.run(args)
        return json.loads(result.stdout)

    async def issue_get(
        self, issue_number: int, json_fields: list[str] | None = None
    ) -> dict[str, Any]:
        """
        Get issue data by number.

        Args:
            issue_number: Issue number
            json_fields: Fields to include in JSON output

        Returns:
            Issue data dictionary
        """
        if json_fields is None:
            json_fields = [
                "number",
                "title",
                "body",
                "state",
                "labels",
                "author",
                "comments",
                "createdAt",
                "updatedAt",
            ]

        args = [
            "issue",
            "view",
            str(issue_number),
            "--json",
            ",".join(json_fields),
        ]

        result = await self.run(args)
        return json.loads(result.stdout)

    async def issue_comment(self, issue_number: int, body: str) -> None:
        """
        Post a comment to an issue.

        Args:
            issue_number: Issue number
            body: Comment body
        """
        args = ["issue", "comment", str(issue_number), "--body", body]
        await self.run(args)

    async def issue_add_labels(self, issue_number: int, labels: list[str]) -> None:
        """
        Add labels to an issue.

        Args:
            issue_number: Issue number
            labels: List of label names to add
        """
        if not labels:
            return

        args = [
            "issue",
            "edit",
            str(issue_number),
            "--add-label",
            ",".join(labels),
        ]
        await self.run(args)

    async def issue_remove_labels(self, issue_number: int, labels: list[str]) -> None:
        """
        Remove labels from an issue.

        Args:
            issue_number: Issue number
            labels: List of label names to remove
        """
        if not labels:
            return

        args = [
            "issue",
            "edit",
            str(issue_number),
            "--remove-label",
            ",".join(labels),
        ]
        # Don't raise on error - labels might not exist
        await self.run(args, raise_on_error=False)

    async def api_get(self, endpoint: str, params: dict[str, str] | None = None) -> Any:
        """
        Make a GET request to GitHub API.

        Args:
            endpoint: API endpoint (e.g., "/repos/owner/repo/contents/path")
            params: Query parameters

        Returns:
            JSON response
        """
        args = ["api", endpoint]

        if params:
            for key, value in params.items():
                args.extend(["-f", f"{key}={value}"])

        result = await self.run(args)
        return json.loads(result.stdout)

    async def pr_merge(
        self,
        pr_number: int,
        merge_method: str = "squash",
        commit_title: str | None = None,
        commit_message: str | None = None,
    ) -> None:
        """
        Merge a pull request.

        Args:
            pr_number: PR number to merge
            merge_method: Merge method - "merge", "squash", or "rebase" (default: "squash")
            commit_title: Custom commit title (optional)
            commit_message: Custom commit message (optional)
        """
        args = ["pr", "merge", str(pr_number), f"--{merge_method}"]

        if commit_title:
            args.extend(["--subject", commit_title])
        if commit_message:
            args.extend(["--body", commit_message])
        args = self._add_repo_flag(args)

        await self.run(args)

    async def pr_comment(self, pr_number: int, body: str) -> None:
        """
        Post a comment on a pull request.

        Args:
            pr_number: PR number
            body: Comment body
        """
        args = ["pr", "comment", str(pr_number), "--body", body]
        args = self._add_repo_flag(args)
        await self.run(args)

    async def pr_get_assignees(self, pr_number: int) -> list[str]:
        """
        Get assignees for a pull request.

        Args:
            pr_number: PR number

        Returns:
            List of assignee logins
        """
        data = await self.pr_get(pr_number, json_fields=["assignees"])
        assignees = data.get("assignees", [])
        return [a["login"] for a in assignees]

    async def pr_assign(self, pr_number: int, assignees: list[str]) -> None:
        """
        Assign users to a pull request.

        Args:
            pr_number: PR number
            assignees: List of GitHub usernames to assign
        """
        if not assignees:
            return

        # Use gh api to add assignees
        endpoint = f"/repos/{{owner}}/{{repo}}/issues/{pr_number}/assignees"
        args = [
            "api",
            endpoint,
            "-X",
            "POST",
            "-f",
            f"assignees={','.join(assignees)}",
        ]
        await self.run(args)

    async def compare_commits(self, base_sha: str, head_sha: str) -> dict[str, Any]:
        """
        Compare two commits to get changes between them.

        Uses: GET /repos/{owner}/{repo}/compare/{base}...{head}

        Args:
            base_sha: Base commit SHA (e.g., last reviewed commit)
            head_sha: Head commit SHA (e.g., current PR HEAD)

        Returns:
            Dict with:
            - commits: List of commits between base and head
            - files: List of changed files with patches
            - ahead_by: Number of commits head is ahead of base
            - behind_by: Number of commits head is behind base
            - total_commits: Total number of commits in comparison
        """
        endpoint = f"repos/{{owner}}/{{repo}}/compare/{base_sha}...{head_sha}"
        args = ["api", endpoint]

        result = await self.run(args, timeout=60.0)  # Longer timeout for large diffs
        return json.loads(result.stdout)

    async def get_comments_since(
        self, pr_number: int, since_timestamp: str
    ) -> dict[str, list[dict]]:
        """
        Get all comments (review + issue) since a timestamp.

        Args:
            pr_number: PR number
            since_timestamp: ISO timestamp to filter from (e.g., "2025-12-25T10:30:00Z")

        Returns:
            Dict with:
            - review_comments: Inline review comments on files
            - issue_comments: General PR discussion comments
        """
        # Fetch inline review comments
        # Use query string syntax - the -f flag sends POST body fields, not query params
        review_endpoint = f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/comments?since={since_timestamp}"
        review_args = ["api", "--method", "GET", review_endpoint]
        review_result = await self.run(review_args, raise_on_error=False)

        review_comments = []
        if review_result.returncode == 0:
            try:
                review_comments = json.loads(review_result.stdout)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse review comments for PR #{pr_number}")

        # Fetch general issue comments
        # Use query string syntax - the -f flag sends POST body fields, not query params
        issue_endpoint = f"repos/{{owner}}/{{repo}}/issues/{pr_number}/comments?since={since_timestamp}"
        issue_args = ["api", "--method", "GET", issue_endpoint]
        issue_result = await self.run(issue_args, raise_on_error=False)

        issue_comments = []
        if issue_result.returncode == 0:
            try:
                issue_comments = json.loads(issue_result.stdout)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse issue comments for PR #{pr_number}")

        return {
            "review_comments": review_comments,
            "issue_comments": issue_comments,
        }

    async def get_reviews_since(
        self, pr_number: int, since_timestamp: str
    ) -> list[dict]:
        """
        Get all PR reviews (formal review submissions) since a timestamp.

        This fetches formal reviews submitted via the GitHub review mechanism,
        which is different from review comments (inline comments on files).

        Reviews from AI tools like Cursor, CodeRabbit, Greptile etc. are
        submitted as formal reviews with body text containing their findings.

        Args:
            pr_number: PR number
            since_timestamp: ISO timestamp to filter from (e.g., "2025-12-25T10:30:00Z")

        Returns:
            List of review objects with fields:
            - id: Review ID
            - user: User who submitted the review
            - body: Review body text (contains AI findings)
            - state: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
            - submitted_at: When the review was submitted
            - commit_id: Commit SHA the review was made on
        """
        # Fetch all reviews for the PR
        # Note: The reviews endpoint doesn't support 'since' parameter,
        # so we fetch all and filter client-side
        reviews_endpoint = f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/reviews"
        reviews_args = ["api", "--method", "GET", reviews_endpoint]
        reviews_result = await self.run(reviews_args, raise_on_error=False)

        reviews = []
        if reviews_result.returncode == 0:
            try:
                all_reviews = json.loads(reviews_result.stdout)
                # Filter reviews submitted after the timestamp
                from datetime import datetime, timezone

                # Parse since_timestamp, handling both naive and aware formats
                since_dt = datetime.fromisoformat(
                    since_timestamp.replace("Z", "+00:00")
                )
                # Ensure since_dt is timezone-aware (assume UTC if naive)
                if since_dt.tzinfo is None:
                    since_dt = since_dt.replace(tzinfo=timezone.utc)

                for review in all_reviews:
                    submitted_at = review.get("submitted_at", "")
                    if submitted_at:
                        try:
                            review_dt = datetime.fromisoformat(
                                submitted_at.replace("Z", "+00:00")
                            )
                            # Ensure review_dt is also timezone-aware
                            if review_dt.tzinfo is None:
                                review_dt = review_dt.replace(tzinfo=timezone.utc)
                            if review_dt > since_dt:
                                reviews.append(review)
                        except ValueError:
                            # If we can't parse the date, include the review
                            reviews.append(review)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse reviews for PR #{pr_number}")

        return reviews

    async def get_pr_head_sha(self, pr_number: int) -> str | None:
        """
        Get the current HEAD SHA of a PR.

        Args:
            pr_number: PR number

        Returns:
            HEAD commit SHA or None if not found
        """
        data = await self.pr_get(pr_number, json_fields=["commits"])
        commits = data.get("commits", [])
        if commits:
            # Last commit is the HEAD
            return commits[-1].get("oid")
        return None

    async def get_pr_checks(self, pr_number: int) -> dict[str, Any]:
        """
        Get CI check runs status for a PR.

        Uses `gh pr checks` to get the status of all check runs.

        Args:
            pr_number: PR number

        Returns:
            Dict with:
            - checks: List of check runs with name, state
            - passing: Number of passing checks
            - failing: Number of failing checks
            - pending: Number of pending checks
            - failed_checks: List of failed check names
        """
        try:
            # Note: gh pr checks --json only supports: bucket, completedAt, description,
            # event, link, name, startedAt, state, workflow
            # The 'state' field directly contains the result (SUCCESS, FAILURE, PENDING, etc.)
            args = ["pr", "checks", str(pr_number), "--json", "name,state"]
            args = self._add_repo_flag(args)

            result = await self.run(args, timeout=30.0)
            checks = json.loads(result.stdout) if result.stdout.strip() else []

            passing = 0
            failing = 0
            pending = 0
            failed_checks = []

            for check in checks:
                state = check.get("state", "").upper()
                name = check.get("name", "Unknown")

                # gh pr checks 'state' directly contains: SUCCESS, FAILURE, PENDING, NEUTRAL, etc.
                if state in ("SUCCESS", "NEUTRAL", "SKIPPED"):
                    passing += 1
                elif state in ("FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE"):
                    failing += 1
                    failed_checks.append(name)
                else:
                    # PENDING, QUEUED, IN_PROGRESS, etc.
                    pending += 1

            return {
                "checks": checks,
                "passing": passing,
                "failing": failing,
                "pending": pending,
                "failed_checks": failed_checks,
            }
        except (GHCommandError, GHTimeoutError, json.JSONDecodeError) as e:
            logger.warning(f"Failed to get PR checks for #{pr_number}: {e}")
            return {
                "checks": [],
                "passing": 0,
                "failing": 0,
                "pending": 0,
                "failed_checks": [],
                "error": str(e),
            }

    async def get_workflows_awaiting_approval(self, pr_number: int) -> dict[str, Any]:
        """
        Get workflow runs awaiting approval for a PR from a fork.

        Workflows from forked repositories require manual approval before running.
        These are NOT included in `gh pr checks` and must be queried separately.

        Args:
            pr_number: PR number

        Returns:
            Dict with:
            - awaiting_approval: Number of workflows waiting for approval
            - workflow_runs: List of workflow runs with id, name, html_url
            - can_approve: Whether this token can approve workflows
        """
        try:
            # First, get the PR's head SHA to filter workflow runs
            pr_args = ["pr", "view", str(pr_number), "--json", "headRefOid"]
            pr_args = self._add_repo_flag(pr_args)
            pr_result = await self.run(pr_args, timeout=30.0)
            pr_data = json.loads(pr_result.stdout) if pr_result.stdout.strip() else {}
            head_sha = pr_data.get("headRefOid", "")

            if not head_sha:
                return {
                    "awaiting_approval": 0,
                    "workflow_runs": [],
                    "can_approve": False,
                }

            # Query workflow runs with action_required status
            # Note: We need to use the API endpoint as gh CLI doesn't have direct support
            endpoint = (
                "repos/{owner}/{repo}/actions/runs?status=action_required&per_page=100"
            )
            args = ["api", "--method", "GET", endpoint]

            result = await self.run(args, timeout=30.0)
            data = json.loads(result.stdout) if result.stdout.strip() else {}
            all_runs = data.get("workflow_runs", [])

            # Filter to only runs for this PR's head SHA
            pr_runs = [
                {
                    "id": run.get("id"),
                    "name": run.get("name"),
                    "html_url": run.get("html_url"),
                    "workflow_name": run.get("workflow", {}).get("name", "Unknown"),
                }
                for run in all_runs
                if run.get("head_sha") == head_sha
            ]

            return {
                "awaiting_approval": len(pr_runs),
                "workflow_runs": pr_runs,
                "can_approve": True,  # Assume token has permission, will fail if not
            }
        except (GHCommandError, GHTimeoutError, json.JSONDecodeError) as e:
            logger.warning(
                f"Failed to get workflows awaiting approval for #{pr_number}: {e}"
            )
            return {
                "awaiting_approval": 0,
                "workflow_runs": [],
                "can_approve": False,
                "error": str(e),
            }

    async def approve_workflow_run(self, run_id: int) -> bool:
        """
        Approve a workflow run that's waiting for approval (from a fork).

        Args:
            run_id: The workflow run ID to approve

        Returns:
            True if approval succeeded, False otherwise
        """
        try:
            endpoint = f"repos/{{owner}}/{{repo}}/actions/runs/{run_id}/approve"
            args = ["api", "--method", "POST", endpoint]

            await self.run(args, timeout=30.0)
            logger.info(f"Approved workflow run {run_id}")
            return True
        except (GHCommandError, GHTimeoutError) as e:
            logger.warning(f"Failed to approve workflow run {run_id}: {e}")
            return False

    async def get_pr_checks_comprehensive(self, pr_number: int) -> dict[str, Any]:
        """
        Get comprehensive CI status including workflows awaiting approval.

        This combines:
        - Standard check runs from `gh pr checks`
        - Workflows awaiting approval (for fork PRs)

        Args:
            pr_number: PR number

        Returns:
            Dict with all check information including awaiting_approval count
        """
        # Get standard checks
        checks = await self.get_pr_checks(pr_number)

        # Get workflows awaiting approval
        awaiting = await self.get_workflows_awaiting_approval(pr_number)

        # Merge the results
        checks["awaiting_approval"] = awaiting.get("awaiting_approval", 0)
        checks["awaiting_workflow_runs"] = awaiting.get("workflow_runs", [])

        # Update pending count to include awaiting approval
        checks["pending"] = checks.get("pending", 0) + awaiting.get(
            "awaiting_approval", 0
        )

        return checks

    async def get_pr_files(self, pr_number: int) -> list[dict[str, Any]]:
        """
        Get files changed by a PR using the PR files endpoint.

        IMPORTANT: This returns only files that are part of the PR's actual changes,
        NOT files that came in from merging another branch (e.g., develop).
        This is crucial for follow-up reviews to avoid reviewing code from other PRs.

        Uses: GET /repos/{owner}/{repo}/pulls/{pr_number}/files

        Args:
            pr_number: PR number

        Returns:
            List of file objects with:
            - filename: Path to the file
            - status: added, removed, modified, renamed, copied, changed
            - additions: Number of lines added
            - deletions: Number of lines deleted
            - changes: Total number of line changes
            - patch: The unified diff patch for this file (may be absent for large files)
        """
        files = []
        page = 1
        per_page = 100

        while True:
            endpoint = f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/files?page={page}&per_page={per_page}"
            args = ["api", "--method", "GET", endpoint]

            result = await self.run(args, timeout=60.0)
            page_files = json.loads(result.stdout) if result.stdout.strip() else []

            if not page_files:
                break

            files.extend(page_files)

            # Check if we got a full page (more pages might exist)
            if len(page_files) < per_page:
                break

            page += 1

            # Safety limit to prevent infinite loops
            if page > 50:
                logger.warning(
                    f"PR #{pr_number} has more than 5000 files, stopping pagination"
                )
                break

        return files

    async def get_pr_commits(self, pr_number: int) -> list[dict[str, Any]]:
        """
        Get commits that are part of a PR using the PR commits endpoint.

        IMPORTANT: This returns only commits that are part of the PR's branch,
        NOT commits that came in from merging another branch (e.g., develop).
        This is crucial for follow-up reviews to avoid reviewing commits from other PRs.

        Uses: GET /repos/{owner}/{repo}/pulls/{pr_number}/commits

        Args:
            pr_number: PR number

        Returns:
            List of commit objects with:
            - sha: Commit SHA
            - commit: Object with message, author, committer info
            - author: GitHub user who authored the commit
            - committer: GitHub user who committed
            - parents: List of parent commit SHAs
        """
        commits = []
        page = 1
        per_page = 100

        while True:
            endpoint = f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/commits?page={page}&per_page={per_page}"
            args = ["api", "--method", "GET", endpoint]

            result = await self.run(args, timeout=60.0)
            page_commits = json.loads(result.stdout) if result.stdout.strip() else []

            if not page_commits:
                break

            commits.extend(page_commits)

            # Check if we got a full page (more pages might exist)
            if len(page_commits) < per_page:
                break

            page += 1

            # Safety limit
            if page > 10:
                logger.warning(
                    f"PR #{pr_number} has more than 1000 commits, stopping pagination"
                )
                break

        return commits

    async def get_pr_files_changed_since(
        self,
        pr_number: int,
        base_sha: str,
        reviewed_file_blobs: dict[str, str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """
        Get files and commits that are part of the PR and changed since a specific commit.

        This method solves the "merge introduced commits" problem by:
        1. Getting the canonical list of PR files (excludes files from merged branches)
        2. Getting the canonical list of PR commits (excludes commits from merged branches)
        3. Filtering to only include commits after base_sha

        When a rebase/force-push is detected (base_sha not found in commits), and
        reviewed_file_blobs is provided, uses blob SHA comparison to identify which
        files actually changed content. This prevents re-reviewing unchanged files.

        Args:
            pr_number: PR number
            base_sha: The commit SHA to compare from (e.g., last reviewed commit)
            reviewed_file_blobs: Optional dict mapping filename -> blob SHA from the
                previous review. Used as fallback when base_sha is not found (rebase).

        Returns:
            Tuple of:
            - List of file objects that are part of the PR (filtered if blob comparison used)
            - List of commit objects that are part of the PR and after base_sha.
              NOTE: Returns empty list if rebase/force-push detected, since commit SHAs
              are rewritten and we cannot determine which commits are truly "new".
        """
        # Get PR's canonical files (these are the actual PR changes)
        pr_files = await self.get_pr_files(pr_number)

        # Get PR's canonical commits
        pr_commits = await self.get_pr_commits(pr_number)

        # Find the position of base_sha in PR commits
        # Use minimum 7-char prefix comparison (git's default short SHA length)
        base_index = -1
        min_prefix_len = 7
        base_prefix = (
            base_sha[:min_prefix_len] if len(base_sha) >= min_prefix_len else base_sha
        )
        for i, commit in enumerate(pr_commits):
            commit_prefix = commit["sha"][:min_prefix_len]
            if commit_prefix == base_prefix:
                base_index = i
                break

        # Commits after base_sha (these are the new commits to review)
        if base_index >= 0:
            new_commits = pr_commits[base_index + 1 :]
            return pr_files, new_commits

        # base_sha not found in PR commits - this happens when:
        # 1. The base_sha was from a merge commit (not a direct PR commit)
        # 2. The PR was rebased/force-pushed
        logger.warning(
            f"base_sha {base_sha[:8]} not found in PR #{pr_number} commits. "
            "PR was likely rebased or force-pushed."
        )

        # If we have blob SHAs from the previous review, use them to filter files
        # Blob SHAs persist across rebases - same content = same blob SHA
        if reviewed_file_blobs:  # Only use blob comparison if we have actual blob data
            changed_files = []
            unchanged_count = 0
            for file in pr_files:
                filename = file.get("filename", "")
                current_blob_sha = file.get("sha", "")
                file_status = file.get("status", "")
                previous_blob_sha = reviewed_file_blobs.get(filename, "")

                # Always include files that were added, removed, or renamed
                # These are significant changes regardless of blob SHA
                if file_status in ("added", "removed", "renamed"):
                    changed_files.append(file)
                elif not previous_blob_sha:
                    # File wasn't in previous review - include it
                    changed_files.append(file)
                elif current_blob_sha != previous_blob_sha:
                    # File content changed - include it
                    changed_files.append(file)
                else:
                    # Same blob SHA = same content - skip it
                    unchanged_count += 1

            if unchanged_count > 0:
                logger.info(
                    f"Blob comparison: {len(changed_files)} files changed, "
                    f"{unchanged_count} unchanged (skipped)"
                )

            # Return filtered files but empty commits list (can't determine "new" commits after rebase)
            # After a rebase, all commit SHAs are rewritten so we can't identify which are truly new.
            # The file changes via blob comparison are the reliable source of what changed.
            return changed_files, []

        # No blob data available - return all files but empty commits (can't determine new commits)
        logger.warning(
            "No reviewed_file_blobs available for blob comparison after rebase. "
            "Returning all PR files with empty commits list."
        )
        return pr_files, []

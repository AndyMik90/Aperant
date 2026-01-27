"""
GitLab API Client
=================

Client for GitLab API operations.
Uses direct API calls with PRIVATE-TOKEN authentication.

Supports both synchronous and asynchronous methods for compatibility
with provider-agnostic interfaces.
"""

from __future__ import annotations

import asyncio
import functools
import json
import logging
import socket
import ssl
import time
import urllib.error

logger = logging.getLogger(__name__)
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

# Retry configuration for enhanced error handling
RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
RETRYABLE_EXCEPTIONS = (
    urllib.error.URLError,
    socket.timeout,
    ConnectionResetError,
    ConnectionRefusedError,
)
MAX_RESPONSE_SIZE = 10 * 1024 * 1024  # 10MB

# Idempotent HTTP methods that are safe to retry on server/network errors
# Non-idempotent methods (POST, PUT, DELETE, PATCH) should only retry on rate limit (429)
IDEMPOTENT_METHODS = {"GET", "HEAD", "OPTIONS"}


def _async_method(func):
    """
    Decorator to create async wrapper for sync methods.

    This creates an async version of a sync method that runs in an executor.
    Usage: Apply this decorator to sync methods that need async variants.

    The async version will be named with the "_async" suffix.
    """

    @functools.wraps(func)
    def async_wrapper(self, *args, **kwargs):
        async def runner():
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None, functools.partial(func, self, *args, **kwargs)
            )

        return runner()

    return async_wrapper


@dataclass
class GitLabConfig:
    """GitLab configuration loaded from project."""

    token: str
    project: str
    instance_url: str


def encode_project_path(project: str) -> str:
    """URL-encode a project path for API calls."""
    return urllib.parse.quote(project, safe="")


# Valid GitLab API endpoint patterns
VALID_ENDPOINT_PATTERNS = (
    "/projects/",
    "/user",
    "/users/",
    "/groups/",
    "/merge_requests/",
    "/issues/",
    "/namespaces/",
)


def validate_endpoint(endpoint: str) -> None:
    """
    Validate that an endpoint is a legitimate GitLab API path.
    Raises ValueError if the endpoint is suspicious.
    """
    if not endpoint:
        raise ValueError("Endpoint cannot be empty")

    # Must start with /
    if not endpoint.startswith("/"):
        raise ValueError("Endpoint must start with /")

    # Check for path traversal attempts
    if ".." in endpoint:
        raise ValueError("Endpoint contains path traversal sequence")

    # Check for null bytes
    if "\x00" in endpoint:
        raise ValueError("Endpoint contains null byte")

    # Validate against known patterns
    if not any(endpoint.startswith(pattern) for pattern in VALID_ENDPOINT_PATTERNS):
        raise ValueError(
            f"Endpoint does not match known GitLab API patterns: {endpoint}"
        )


class GitLabClient:
    """Client for GitLab API operations."""

    def __init__(
        self,
        project_dir: Path,
        config: GitLabConfig,
        default_timeout: float = 30.0,
    ):
        self.project_dir = Path(project_dir)
        self.config = config
        self.default_timeout = default_timeout

    def _api_url(self, endpoint: str) -> str:
        """Build full API URL."""
        base = self.config.instance_url.rstrip("/")
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        return f"{base}/api/v4{endpoint}"

    def _fetch(
        self,
        endpoint: str,
        method: str = "GET",
        data: dict | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
        max_retries: int = 3,
    ) -> Any:
        """
        Make an API request to GitLab with enhanced retry logic.

        Retry behavior differs by HTTP method to prevent unintended side effects:

        Idempotent methods (GET, HEAD, OPTIONS):
        - HTTP 429 (rate limit) with exponential backoff and Retry-After header
        - HTTP 500, 502, 503, 504 (server errors)
        - Network timeouts and connection errors
        - SSL/TLS errors

        Non-idempotent methods (POST, PUT, DELETE, PATCH):
        - HTTP 429 (rate limit) only
        - No retry on server errors, network errors, or SSL errors to avoid
          unintended side effects (e.g., duplicate resource creation)

        Args:
            endpoint: API endpoint path
            method: HTTP method
            data: Request body
            params: Query parameters
            timeout: Request timeout
            max_retries: Maximum retry attempts

        Returns:
            Parsed JSON response

        Raises:
            ValueError: If endpoint is invalid
            Exception: For API errors after retries
        """
        validate_endpoint(endpoint)

        url = self._api_url(endpoint)

        # Add query parameters if provided
        if params:
            from urllib.parse import urlencode

            query_string = urlencode(params, doseq=True)
            url = f"{url}?{query_string}"

        headers = {"PRIVATE-TOKEN": self.config.token}

        if data:
            headers["Content-Type"] = "application/json"
            body = json.dumps(data).encode("utf-8")
        else:
            body = None

        last_error = None
        timeout = timeout or self.default_timeout

        for attempt in range(max_retries):
            try:
                with urllib.request.urlopen(
                    urllib.request.Request(
                        url, data=body, headers=headers, method=method
                    ),
                    timeout=timeout,
                ) as response:
                    # Handle 204 No Content
                    if response.status == 204:
                        return None

                    # Validate Content-Type for JSON responses
                    content_type = response.headers.get("Content-Type", "")
                    if "application/json" not in content_type and response.status < 400:
                        # Non-JSON response on success - return as text
                        return response.read().decode("utf-8")

                    # Check response size limit
                    content_length = response.headers.get("Content-Length")
                    if content_length and int(content_length) > MAX_RESPONSE_SIZE:
                        raise ValueError(f"Response too large: {content_length} bytes")

                    response_body = response.read().decode("utf-8")

                    # Try to parse JSON for better error messages
                    try:
                        return json.loads(response_body)
                    except json.JSONDecodeError:
                        # Return raw response if not JSON
                        return response_body

            except urllib.error.HTTPError as e:
                last_error = e
                error_body = e.read().decode("utf-8") if e.fp else ""

                # Parse GitLab error message
                gitlab_message = ""
                try:
                    error_json = json.loads(error_body)
                    gitlab_message = error_json.get("message", "")
                except json.JSONDecodeError:
                    pass

                # Handle rate limit (429)
                if e.code == 429:
                    # Check for Retry-After header
                    retry_after = e.headers.get("Retry-After")
                    if retry_after:
                        try:
                            wait_time = int(retry_after)
                        except ValueError:
                            # HTTP-date format - parse it
                            try:
                                retry_date = parsedate_to_datetime(retry_after)
                                wait_time = max(
                                    0,
                                    (
                                        retry_date - datetime.now(timezone.utc)
                                    ).total_seconds(),
                                )
                            except Exception:
                                wait_time = 2**attempt
                    else:
                        wait_time = 2**attempt

                    if attempt < max_retries - 1:
                        logger.warning(
                            f"Rate limited. Waiting {wait_time}s before retry..."
                        )
                        time.sleep(wait_time)
                        continue

                # Retry on server errors (only for idempotent methods)
                # Non-idempotent methods (POST, PUT, DELETE, PATCH) should not be
                # retried on server errors as they may cause unintended side effects
                is_idempotent = method.upper() in IDEMPOTENT_METHODS
                is_retryable = e.code in RETRYABLE_STATUS_CODES
                should_retry = (
                    is_idempotent and is_retryable and attempt < max_retries - 1
                )

                if should_retry:
                    wait_time = 2**attempt
                    logger.warning(
                        f"Server error {e.code}. Retrying in {wait_time}s..."
                    )
                    time.sleep(wait_time)
                    continue

                # Build detailed error message
                if gitlab_message:
                    error_msg = f"GitLab API error {e.code}: {gitlab_message}"
                else:
                    error_msg = f"GitLab API error {e.code}: {error_body[:200] if error_body else 'No details'}"

                raise Exception(error_msg) from e

            except RETRYABLE_EXCEPTIONS as e:
                last_error = e
                # Only retry network errors for idempotent methods
                is_idempotent = method.upper() in IDEMPOTENT_METHODS
                if is_idempotent and attempt < max_retries - 1:
                    wait_time = 2**attempt
                    logger.warning(f"Network error: {e}. Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                raise Exception(f"GitLab API network error: {e}") from e

            except ssl.SSLError as e:
                last_error = e
                # Only retry SSL errors for idempotent methods
                is_idempotent = method.upper() in IDEMPOTENT_METHODS
                if is_idempotent and attempt < max_retries - 1:
                    wait_time = 2**attempt
                    logger.warning(f"SSL error: {e}. Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                raise Exception(f"GitLab API SSL/TLS error: {e}") from e

        # Should not reach here, but just in case
        raise Exception(f"GitLab API error after {max_retries} retries") from last_error

    def get_mr(self, mr_iid: int) -> dict:
        """Get MR details."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(f"/projects/{encoded_project}/merge_requests/{mr_iid}")

    def get_mr_changes(self, mr_iid: int) -> dict:
        """Get MR changes (diff)."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/changes"
        )

    def get_mr_diff(self, mr_iid: int) -> str:
        """Get the full diff for an MR."""
        changes = self.get_mr_changes(mr_iid)
        diffs = []
        for change in changes.get("changes", []):
            diff = change.get("diff", "")
            if diff:
                diffs.append(diff)
        return "\n".join(diffs)

    def get_mr_commits(self, mr_iid: int) -> list[dict]:
        """Get commits for an MR."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/commits"
        )

    def get_current_user(self) -> dict:
        """Get current authenticated user."""
        return self._fetch("/user")

    def post_mr_note(self, mr_iid: int, body: str) -> dict:
        """Post a note (comment) to an MR."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/notes",
            method="POST",
            data={"body": body},
        )

    def approve_mr(self, mr_iid: int) -> dict:
        """Approve an MR."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/approve",
            method="POST",
        )

    def merge_mr(self, mr_iid: int, squash: bool = False) -> dict:
        """Merge an MR."""
        encoded_project = encode_project_path(self.config.project)
        data = {}
        if squash:
            data["squash"] = True
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/merge",
            method="PUT",
            data=data if data else None,
        )

    def assign_mr(self, mr_iid: int, user_ids: list[int]) -> dict:
        """Assign users to an MR."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}",
            method="PUT",
            data={"assignee_ids": user_ids},
        )

    def create_mr(
        self,
        source_branch: str,
        target_branch: str,
        title: str,
        description: str | None = None,
        assignee_ids: list[int] | None = None,
        reviewer_ids: list[int] | None = None,
        labels: list[str] | None = None,
        remove_source_branch: bool = False,
        squash: bool = False,
    ) -> dict:
        """
        Create a new merge request.

        Args:
            source_branch: Name of the source branch
            target_branch: Name of the target branch
            title: MR title
            description: MR description
            assignee_ids: List of user IDs to assign
            reviewer_ids: List of user IDs to request review from
            labels: List of labels to apply
            remove_source_branch: Whether to remove source branch after merge
            squash: Whether to squash commits on merge

        Returns:
            Created MR data as dict
        """
        encoded_project = encode_project_path(self.config.project)
        data = {
            "source_branch": source_branch,
            "target_branch": target_branch,
            "title": title,
            "remove_source_branch": remove_source_branch,
            "squash": squash,
        }

        if description:
            data["description"] = description
        if assignee_ids:
            data["assignee_ids"] = assignee_ids
        if reviewer_ids:
            data["reviewer_ids"] = reviewer_ids
        if labels:
            data["labels"] = ",".join(labels)

        return self._fetch(
            f"/projects/{encoded_project}/merge_requests",
            method="POST",
            data=data,
        )

    def list_mrs(
        self,
        state: str | None = None,
        labels: list[str] | None = None,
        author: str | None = None,
        assignee: str | None = None,
        search: str | None = None,
        per_page: int = 100,
        page: int = 1,
    ) -> list[dict]:
        """
        List merge requests with filters.

        Args:
            state: Filter by state (opened, closed, merged, all)
            labels: Filter by labels
            author: Filter by author username
            assignee: Filter by assignee username
            search: Search string
            per_page: Results per page
            page: Page number

        Returns:
            List of MR data dicts
        """
        encoded_project = encode_project_path(self.config.project)
        params = {"per_page": per_page, "page": page}

        if state:
            params["state"] = state
        if labels:
            params["labels"] = ",".join(labels)
        if author:
            params["author_username"] = author
        if assignee:
            params["assignee_username"] = assignee
        if search:
            params["search"] = search

        return self._fetch(f"/projects/{encoded_project}/merge_requests", params=params)

    def update_mr(
        self,
        mr_iid: int,
        title: str | None = None,
        description: str | None = None,
        labels: dict[str, bool] | None = None,
        state_event: str | None = None,
    ) -> dict:
        """
        Update a merge request.

        Args:
            mr_iid: MR internal ID
            title: New title
            description: New description
            labels: Labels to add/remove (e.g., {"bug": True, "feature": False})
            state_event: State change ("close" or "reopen")

        Returns:
            Updated MR data
        """
        encoded_project = encode_project_path(self.config.project)
        data = {}

        if title:
            data["title"] = title
        if description:
            data["description"] = description
        if labels:
            # GitLab uses add_labels and remove_labels
            to_add = [k for k, v in labels.items() if v]
            to_remove = [k for k, v in labels.items() if not v]
            if to_add:
                data["add_labels"] = ",".join(to_add)
            if to_remove:
                data["remove_labels"] = ",".join(to_remove)
        if state_event:
            data["state_event"] = state_event

        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}",
            method="PUT",
            data=data if data else None,
        )

    # -------------------------------------------------------------------------
    # Issue Operations
    # -------------------------------------------------------------------------

    def get_issue(self, issue_iid: int) -> dict:
        """Get issue details."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(f"/projects/{encoded_project}/issues/{issue_iid}")

    def list_issues(
        self,
        state: str | None = None,
        labels: list[str] | None = None,
        author: str | None = None,
        assignee: str | None = None,
        per_page: int = 100,
    ) -> list[dict]:
        """List issues with optional filters."""
        encoded_project = encode_project_path(self.config.project)
        params = {"per_page": per_page}

        if state:
            params["state"] = state
        if labels:
            params["labels"] = ",".join(labels)
        if author:
            params["author_username"] = author
        if assignee:
            params["assignee_username"] = assignee

        return self._fetch(f"/projects/{encoded_project}/issues", params=params)

    def create_issue(
        self,
        title: str,
        description: str,
        labels: list[str] | None = None,
        assignee_ids: list[int] | None = None,
    ) -> dict:
        """Create a new issue."""
        encoded_project = encode_project_path(self.config.project)
        data = {
            "title": title,
            "description": description,
        }

        if labels:
            data["labels"] = ",".join(labels)
        if assignee_ids:
            data["assignee_ids"] = assignee_ids

        return self._fetch(
            f"/projects/{encoded_project}/issues",
            method="POST",
            data=data,
        )

    def update_issue(
        self,
        issue_iid: int,
        state_event: str | None = None,
        labels: list[str] | None = None,
    ) -> dict:
        """Update an issue."""
        encoded_project = encode_project_path(self.config.project)
        data = {}

        if state_event:
            data["state_event"] = state_event  # "close" or "reopen"
        if labels:
            data["labels"] = ",".join(labels)

        return self._fetch(
            f"/projects/{encoded_project}/issues/{issue_iid}",
            method="PUT",
            data=data if data else None,
        )

    def post_issue_note(self, issue_iid: int, body: str) -> dict:
        """Post a note (comment) to an issue."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/issues/{issue_iid}/notes",
            method="POST",
            data={"body": body},
        )

    def get_issue_notes(self, issue_iid: int) -> list[dict]:
        """Get all notes (comments) for an issue."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/issues/{issue_iid}/notes",
            params={"per_page": 100},
        )

    # -------------------------------------------------------------------------
    # MR Discussion and Comment Operations
    # -------------------------------------------------------------------------

    def get_mr_discussions(self, mr_iid: int) -> list[dict]:
        """Get all discussions for an MR."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/discussions",
            params={"per_page": 100},
        )

    def get_mr_notes(self, mr_iid: int) -> list[dict]:
        """Get all notes (comments) for an MR."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/notes",
            params={"per_page": 100},
        )

    def post_mr_discussion_note(
        self,
        mr_iid: int,
        discussion_id: str,
        body: str,
    ) -> dict:
        """Post a note to an existing discussion."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/discussions/{discussion_id}/notes",
            method="POST",
            data={"body": body},
        )

    def resolve_mr_discussion(self, mr_iid: int, discussion_id: str) -> dict:
        """Resolve a discussion thread."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/discussions/{discussion_id}",
            method="PUT",
            data={"resolved": True},
        )

    # -------------------------------------------------------------------------
    # Pipeline and CI Operations
    # -------------------------------------------------------------------------

    def get_mr_pipelines(self, mr_iid: int) -> list[dict]:
        """Get all pipelines for an MR."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/pipelines",
            params={"per_page": 50},
        )

    def get_pipeline_status(self, pipeline_id: int) -> dict:
        """Get detailed status for a specific pipeline."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(f"/projects/{encoded_project}/pipelines/{pipeline_id}")

    def get_pipeline_jobs(self, pipeline_id: int) -> list[dict]:
        """Get all jobs for a pipeline."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/pipelines/{pipeline_id}/jobs",
            params={"per_page": 100},
        )

    def get_mr_pipeline(self, mr_iid: int) -> dict | None:
        """Get the latest pipeline for an MR."""
        pipelines = self.get_mr_pipelines(mr_iid)
        return pipelines[0] if pipelines else None

    async def get_mr_pipeline_async(self, mr_iid: int) -> dict | None:
        """Async version of get_mr_pipeline."""
        pipelines = await self.get_mr_pipelines_async(mr_iid)
        return pipelines[0] if pipelines else None

    async def get_mr_notes_async(self, mr_iid: int) -> list[dict]:
        """Async version of get_mr_notes."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/notes",
            params={"per_page": 100},
        )

    async def get_pipeline_jobs_async(self, pipeline_id: int) -> list[dict]:
        """Async version of get_pipeline_jobs."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/pipelines/{pipeline_id}/jobs",
            params={"per_page": 100},
        )

    def get_project_pipelines(
        self,
        ref: str | None = None,
        status: str | None = None,
        per_page: int = 50,
    ) -> list[dict]:
        """Get pipelines for the project."""
        encoded_project = encode_project_path(self.config.project)
        params = {"per_page": per_page}

        if ref:
            params["ref"] = ref
        if status:
            params["status"] = status

        return self._fetch(
            f"/projects/{encoded_project}/pipelines",
            params=params,
        )

    # -------------------------------------------------------------------------
    # Commit Operations
    # -------------------------------------------------------------------------

    def get_commit(self, sha: str) -> dict:
        """Get details for a specific commit."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(f"/projects/{encoded_project}/repository/commits/{sha}")

    def get_commit_diff(self, sha: str) -> list[dict]:
        """Get diff for a specific commit."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(f"/projects/{encoded_project}/repository/commits/{sha}/diff")

    # -------------------------------------------------------------------------
    # User and Permission Operations
    # -------------------------------------------------------------------------

    def get_user_by_username(self, username: str) -> dict | None:
        """Get user details by username."""
        users = self._fetch("/users", params={"username": username})
        return users[0] if users else None

    def get_project_members(self, query: str | None = None) -> list[dict]:
        """Get members of the project."""
        encoded_project = encode_project_path(self.config.project)
        params = {"per_page": 100}

        if query:
            params["query"] = query

        return self._fetch(
            f"/projects/{encoded_project}/members/all",
            params=params,
        )

    async def get_project_members_async(self, query: str | None = None) -> list[dict]:
        """Async version of get_project_members."""
        encoded_project = encode_project_path(self.config.project)
        params = {"per_page": 100}

        if query:
            params["query"] = query

        return await self._fetch_async(
            f"/projects/{encoded_project}/members/all",
            params=params,
        )

    # -------------------------------------------------------------------------
    # Branch Operations
    # -------------------------------------------------------------------------

    def list_branches(
        self,
        search: str | None = None,
        per_page: int = 100,
    ) -> list[dict]:
        """List repository branches."""
        encoded_project = encode_project_path(self.config.project)
        params = {"per_page": per_page}
        if search:
            params["search"] = search
        return self._fetch(
            f"/projects/{encoded_project}/repository/branches", params=params
        )

    def get_branch(self, branch_name: str) -> dict:
        """Get branch details."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/repository/branches/{urllib.parse.quote(branch_name)}"
        )

    def create_branch(
        self,
        branch_name: str,
        ref: str,
    ) -> dict:
        """
        Create a new branch.

        Args:
            branch_name: Name for the new branch
            ref: Branch name or commit SHA to create from

        Returns:
            Created branch data
        """
        encoded_project = encode_project_path(self.config.project)
        data = {
            "branch": branch_name,
            "ref": ref,
        }
        return self._fetch(
            f"/projects/{encoded_project}/repository/branches",
            method="POST",
            data=data,
        )

    def delete_branch(self, branch_name: str) -> None:
        """Delete a branch."""
        encoded_project = encode_project_path(self.config.project)
        self._fetch(
            f"/projects/{encoded_project}/repository/branches/{urllib.parse.quote(branch_name)}",
            method="DELETE",
        )

    def compare_branches(
        self,
        from_branch: str,
        to_branch: str,
    ) -> dict:
        """Compare two branches."""
        encoded_project = encode_project_path(self.config.project)
        params = {
            "from": from_branch,
            "to": to_branch,
        }
        return self._fetch(
            f"/projects/{encoded_project}/repository/compare", params=params
        )

    # -------------------------------------------------------------------------
    # File Operations
    # -------------------------------------------------------------------------

    def get_file_contents(
        self,
        file_path: str,
        ref: str | None = None,
    ) -> dict:
        """
        Get file contents and metadata.

        Args:
            file_path: Path to file in repo
            ref: Branch, tag, or commit SHA

        Returns:
            File data with content, size, encoding, etc.
        """
        encoded_project = encode_project_path(self.config.project)
        encoded_path = urllib.parse.quote(file_path, safe="/")
        params = {}
        if ref:
            params["ref"] = ref
        return self._fetch(
            f"/projects/{encoded_project}/repository/files/{encoded_path}",
            params=params,
        )

    def create_file(
        self,
        file_path: str,
        content: str,
        commit_message: str,
        branch: str,
        author_email: str | None = None,
        author_name: str | None = None,
    ) -> dict:
        """
        Create a new file in the repository.

        Args:
            file_path: Path for the new file
            content: File content
            commit_message: Commit message
            branch: Target branch
            author_email: Committer email
            author_name: Committer name

        Returns:
            Commit data
        """
        encoded_project = encode_project_path(self.config.project)
        encoded_path = urllib.parse.quote(file_path, safe="/")
        data = {
            "file_path": file_path,
            "branch": branch,
            "content": content,
            "commit_message": commit_message,
        }
        if author_email:
            data["author_email"] = author_email
        if author_name:
            data["author_name"] = author_name

        return self._fetch(
            f"/projects/{encoded_project}/repository/files/{encoded_path}",
            method="POST",
            data=data,
        )

    def update_file(
        self,
        file_path: str,
        content: str,
        commit_message: str,
        branch: str,
        author_email: str | None = None,
        author_name: str | None = None,
    ) -> dict:
        """Update an existing file."""
        encoded_project = encode_project_path(self.config.project)
        encoded_path = urllib.parse.quote(file_path, safe="/")
        data = {
            "file_path": file_path,
            "branch": branch,
            "content": content,
            "commit_message": commit_message,
        }
        if author_email:
            data["author_email"] = author_email
        if author_name:
            data["author_name"] = author_name

        return self._fetch(
            f"/projects/{encoded_project}/repository/files/{encoded_path}",
            method="PUT",
            data=data,
        )

    def delete_file(
        self,
        file_path: str,
        commit_message: str,
        branch: str,
        author_email: str | None = None,
        author_name: str | None = None,
    ) -> dict:
        """Delete a file."""
        encoded_project = encode_project_path(self.config.project)
        encoded_path = urllib.parse.quote(file_path, safe="/")
        data = {
            "file_path": file_path,
            "branch": branch,
            "commit_message": commit_message,
        }
        if author_email:
            data["author_email"] = author_email
        if author_name:
            data["author_name"] = author_name

        return self._fetch(
            f"/projects/{encoded_project}/repository/files/{encoded_path}",
            method="DELETE",
            data=data,
        )

    # -------------------------------------------------------------------------
    # Webhook Operations
    # -------------------------------------------------------------------------

    def list_webhooks(self) -> list[dict]:
        """List all project webhooks."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(f"/projects/{encoded_project}/hooks")

    def get_webhook(self, hook_id: int) -> dict:
        """Get a specific webhook."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(f"/projects/{encoded_project}/hooks/{hook_id}")

    def create_webhook(
        self,
        url: str,
        push_events: bool = False,
        merge_request_events: bool = False,
        issues_events: bool = False,
        note_events: bool = False,
        job_events: bool = False,
        pipeline_events: bool = False,
        wiki_page_events: bool = False,
        deployment_events: bool = False,
        release_events: bool = False,
        tag_push_events: bool = False,
        confidential_note_events: bool = False,
        custom_webhook_url: str | None = None,
    ) -> dict:
        """
        Create a project webhook.

        Args:
            url: Webhook URL
            push_events: Trigger on push events
            merge_request_events: Trigger on MR events
            issues_events: Trigger on issue events
            note_events: Trigger on comment events
            job_events: Trigger on job events
            pipeline_events: Trigger on pipeline events
            wiki_page_events: Trigger on wiki events
            deployment_events: Trigger on deployment events
            release_events: Trigger on release events
            tag_push_events: Trigger on tag pushes
            confidential_note_events: Trigger on confidential note events
            custom_webhook_url: Custom webhook URL

        Returns:
            Created webhook data
        """
        encoded_project = encode_project_path(self.config.project)
        data = {
            "url": url,
            "push_events": push_events,
            "merge_request_events": merge_request_events,
            "issues_events": issues_events,
            "note_events": note_events,
            "job_events": job_events,
            "pipeline_events": pipeline_events,
            "wiki_page_events": wiki_page_events,
            "deployment_events": deployment_events,
            "release_events": release_events,
            "tag_push_events": tag_push_events,
            "confidential_note_events": confidential_note_events,
        }
        if custom_webhook_url:
            data["custom_webhook_url"] = custom_webhook_url

        return self._fetch(
            f"/projects/{encoded_project}/hooks",
            method="POST",
            data=data,
        )

    def update_webhook(self, hook_id: int, **kwargs) -> dict:
        """Update a webhook."""
        encoded_project = encode_project_path(self.config.project)
        return self._fetch(
            f"/projects/{encoded_project}/hooks/{hook_id}",
            method="PUT",
            data=kwargs,
        )

    def delete_webhook(self, hook_id: int) -> None:
        """Delete a webhook."""
        encoded_project = encode_project_path(self.config.project)
        self._fetch(
            f"/projects/{encoded_project}/hooks/{hook_id}",
            method="DELETE",
        )

    # -------------------------------------------------------------------------
    # Async Methods
    # -------------------------------------------------------------------------

    async def _fetch_async(
        self,
        endpoint: str,
        method: str = "GET",
        data: dict | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        """Async wrapper around _fetch that runs in thread pool."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._fetch(
                endpoint,
                method=method,
                data=data,
                params=params,
                timeout=timeout,
            ),
        )

    async def get_mr_async(self, mr_iid: int) -> dict:
        """Async version of get_mr."""
        return await self._fetch_async(
            f"/projects/{encode_project_path(self.config.project)}/merge_requests/{mr_iid}"
        )

    async def get_mr_changes_async(self, mr_iid: int) -> dict:
        """Async version of get_mr_changes."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/changes"
        )

    async def get_mr_diff_async(self, mr_iid: int) -> str:
        """Async version of get_mr_diff."""
        changes = await self.get_mr_changes_async(mr_iid)
        diffs = []
        for change in changes.get("changes", []):
            diff = change.get("diff", "")
            if diff:
                diffs.append(diff)
        return "\n".join(diffs)

    async def get_mr_commits_async(self, mr_iid: int) -> list[dict]:
        """Async version of get_mr_commits."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/commits"
        )

    async def post_mr_note_async(self, mr_iid: int, body: str) -> dict:
        """Async version of post_mr_note."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/notes",
            method="POST",
            data={"body": body},
        )

    async def approve_mr_async(self, mr_iid: int) -> dict:
        """Async version of approve_mr."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/approve",
            method="POST",
        )

    async def merge_mr_async(self, mr_iid: int, squash: bool = False) -> dict:
        """Async version of merge_mr."""
        encoded_project = encode_project_path(self.config.project)
        data = {}
        if squash:
            data["squash"] = True
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/merge",
            method="PUT",
            data=data if data else None,
        )

    async def get_issue_async(self, issue_iid: int) -> dict:
        """Async version of get_issue."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/issues/{issue_iid}"
        )

    async def get_mr_discussions_async(self, mr_iid: int) -> list[dict]:
        """Async version of get_mr_discussions."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/discussions",
            params={"per_page": 100},
        )

    async def get_mr_pipelines_async(self, mr_iid: int) -> list[dict]:
        """Async version of get_mr_pipelines."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}/pipelines",
            params={"per_page": 50},
        )

    async def get_pipeline_status_async(self, pipeline_id: int) -> dict:
        """Async version of get_pipeline_status."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/pipelines/{pipeline_id}"
        )

    # -------------------------------------------------------------------------
    # Async methods for new Phase 1.1 endpoints
    # -------------------------------------------------------------------------

    async def create_mr_async(
        self,
        source_branch: str,
        target_branch: str,
        title: str,
        description: str | None = None,
        assignee_ids: list[int] | None = None,
        reviewer_ids: list[int] | None = None,
        labels: list[str] | None = None,
        remove_source_branch: bool = False,
        squash: bool = False,
    ) -> dict:
        """Async version of create_mr."""
        encoded_project = encode_project_path(self.config.project)
        data = {
            "source_branch": source_branch,
            "target_branch": target_branch,
            "title": title,
            "remove_source_branch": remove_source_branch,
            "squash": squash,
        }
        if description:
            data["description"] = description
        if assignee_ids:
            data["assignee_ids"] = assignee_ids
        if reviewer_ids:
            data["reviewer_ids"] = reviewer_ids
        if labels:
            data["labels"] = ",".join(labels)
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests",
            method="POST",
            data=data,
        )

    async def list_mrs_async(
        self,
        state: str | None = None,
        labels: list[str] | None = None,
        author: str | None = None,
        assignee: str | None = None,
        search: str | None = None,
        per_page: int = 100,
        page: int = 1,
    ) -> list[dict]:
        """Async version of list_mrs."""
        encoded_project = encode_project_path(self.config.project)
        params = {"per_page": per_page, "page": page}
        if state:
            params["state"] = state
        if labels:
            params["labels"] = ",".join(labels)
        if author:
            params["author_username"] = author
        if assignee:
            params["assignee_username"] = assignee
        if search:
            params["search"] = search
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests",
            params=params,
        )

    async def update_mr_async(
        self,
        mr_iid: int,
        title: str | None = None,
        description: str | None = None,
        labels: dict[str, bool] | None = None,
        state_event: str | None = None,
    ) -> dict:
        """Async version of update_mr."""
        encoded_project = encode_project_path(self.config.project)
        data = {}
        if title:
            data["title"] = title
        if description:
            data["description"] = description
        if labels:
            to_add = [k for k, v in labels.items() if v]
            to_remove = [k for k, v in labels.items() if not v]
            if to_add:
                data["add_labels"] = ",".join(to_add)
            if to_remove:
                data["remove_labels"] = ",".join(to_remove)
        if state_event:
            data["state_event"] = state_event
        return await self._fetch_async(
            f"/projects/{encoded_project}/merge_requests/{mr_iid}",
            method="PUT",
            data=data if data else None,
        )

    # -------------------------------------------------------------------------
    # Async methods for new Phase 1.2 branch operations
    # -------------------------------------------------------------------------

    async def list_branches_async(
        self,
        search: str | None = None,
        per_page: int = 100,
    ) -> list[dict]:
        """Async version of list_branches."""
        encoded_project = encode_project_path(self.config.project)
        params = {"per_page": per_page}
        if search:
            params["search"] = search
        return await self._fetch_async(
            f"/projects/{encoded_project}/repository/branches",
            params=params,
        )

    async def get_branch_async(self, branch_name: str) -> dict:
        """Async version of get_branch."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/repository/branches/{urllib.parse.quote(branch_name)}"
        )

    async def create_branch_async(
        self,
        branch_name: str,
        ref: str,
    ) -> dict:
        """Async version of create_branch."""
        encoded_project = encode_project_path(self.config.project)
        data = {
            "branch": branch_name,
            "ref": ref,
        }
        return await self._fetch_async(
            f"/projects/{encoded_project}/repository/branches",
            method="POST",
            data=data,
        )

    async def delete_branch_async(self, branch_name: str) -> None:
        """Async version of delete_branch."""
        encoded_project = encode_project_path(self.config.project)
        await self._fetch_async(
            f"/projects/{encoded_project}/repository/branches/{urllib.parse.quote(branch_name)}",
            method="DELETE",
        )

    async def compare_branches_async(
        self,
        from_branch: str,
        to_branch: str,
    ) -> dict:
        """Async version of compare_branches."""
        encoded_project = encode_project_path(self.config.project)
        params = {
            "from": from_branch,
            "to": to_branch,
        }
        return await self._fetch_async(
            f"/projects/{encoded_project}/repository/compare",
            params=params,
        )

    # -------------------------------------------------------------------------
    # Async methods for new Phase 1.3 file operations
    # -------------------------------------------------------------------------

    async def get_file_contents_async(
        self,
        file_path: str,
        ref: str | None = None,
    ) -> dict:
        """Async version of get_file_contents."""
        encoded_project = encode_project_path(self.config.project)
        encoded_path = urllib.parse.quote(file_path, safe="/")
        params = {}
        if ref:
            params["ref"] = ref
        return await self._fetch_async(
            f"/projects/{encoded_project}/repository/files/{encoded_path}",
            params=params,
        )

    async def create_file_async(
        self,
        file_path: str,
        content: str,
        commit_message: str,
        branch: str,
        author_email: str | None = None,
        author_name: str | None = None,
    ) -> dict:
        """Async version of create_file."""
        encoded_project = encode_project_path(self.config.project)
        encoded_path = urllib.parse.quote(file_path, safe="/")
        data = {
            "file_path": file_path,
            "branch": branch,
            "content": content,
            "commit_message": commit_message,
        }
        if author_email:
            data["author_email"] = author_email
        if author_name:
            data["author_name"] = author_name
        return await self._fetch_async(
            f"/projects/{encoded_project}/repository/files/{encoded_path}",
            method="POST",
            data=data,
        )

    async def update_file_async(
        self,
        file_path: str,
        content: str,
        commit_message: str,
        branch: str,
        author_email: str | None = None,
        author_name: str | None = None,
    ) -> dict:
        """Async version of update_file."""
        encoded_project = encode_project_path(self.config.project)
        encoded_path = urllib.parse.quote(file_path, safe="/")
        data = {
            "file_path": file_path,
            "branch": branch,
            "content": content,
            "commit_message": commit_message,
        }
        if author_email:
            data["author_email"] = author_email
        if author_name:
            data["author_name"] = author_name
        return await self._fetch_async(
            f"/projects/{encoded_project}/repository/files/{encoded_path}",
            method="PUT",
            data=data,
        )

    async def delete_file_async(
        self,
        file_path: str,
        commit_message: str,
        branch: str,
        author_email: str | None = None,
        author_name: str | None = None,
    ) -> dict:
        """Async version of delete_file."""
        encoded_project = encode_project_path(self.config.project)
        encoded_path = urllib.parse.quote(file_path, safe="/")
        data = {
            "file_path": file_path,
            "branch": branch,
            "commit_message": commit_message,
        }
        if author_email:
            data["author_email"] = author_email
        if author_name:
            data["author_name"] = author_name
        return await self._fetch_async(
            f"/projects/{encoded_project}/repository/files/{encoded_path}",
            method="DELETE",
            data=data,
        )

    # -------------------------------------------------------------------------
    # Async methods for new Phase 1.4 webhook operations
    # -------------------------------------------------------------------------

    async def list_webhooks_async(self) -> list[dict]:
        """Async version of list_webhooks."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(f"/projects/{encoded_project}/hooks")

    async def get_webhook_async(self, hook_id: int) -> dict:
        """Async version of get_webhook."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(f"/projects/{encoded_project}/hooks/{hook_id}")

    async def create_webhook_async(
        self,
        url: str,
        push_events: bool = False,
        merge_request_events: bool = False,
        issues_events: bool = False,
        note_events: bool = False,
        job_events: bool = False,
        pipeline_events: bool = False,
        wiki_page_events: bool = False,
        deployment_events: bool = False,
        release_events: bool = False,
        tag_push_events: bool = False,
        confidential_note_events: bool = False,
        custom_webhook_url: str | None = None,
    ) -> dict:
        """Async version of create_webhook."""
        encoded_project = encode_project_path(self.config.project)
        data = {
            "url": url,
            "push_events": push_events,
            "merge_request_events": merge_request_events,
            "issues_events": issues_events,
            "note_events": note_events,
            "job_events": job_events,
            "pipeline_events": pipeline_events,
            "wiki_page_events": wiki_page_events,
            "deployment_events": deployment_events,
            "release_events": release_events,
            "tag_push_events": tag_push_events,
            "confidential_note_events": confidential_note_events,
        }
        if custom_webhook_url:
            data["custom_webhook_url"] = custom_webhook_url
        return await self._fetch_async(
            f"/projects/{encoded_project}/hooks",
            method="POST",
            data=data,
        )

    async def update_webhook_async(self, hook_id: int, **kwargs) -> dict:
        """Async version of update_webhook."""
        encoded_project = encode_project_path(self.config.project)
        return await self._fetch_async(
            f"/projects/{encoded_project}/hooks/{hook_id}",
            method="PUT",
            data=kwargs,
        )

    async def delete_webhook_async(self, hook_id: int) -> None:
        """Async version of delete_webhook."""
        encoded_project = encode_project_path(self.config.project)
        await self._fetch_async(
            f"/projects/{encoded_project}/hooks/{hook_id}",
            method="DELETE",
        )


def load_gitlab_config(project_dir: Path) -> GitLabConfig | None:
    """Load GitLab config from project's .auto-claude/gitlab/config.json."""
    config_path = project_dir / ".auto-claude" / "gitlab" / "config.json"

    if not config_path.exists():
        return None

    try:
        with open(config_path, encoding="utf-8") as f:
            data = json.load(f)

        token = data.get("token")
        project = data.get("project")
        instance_url = data.get("instance_url", "https://gitlab.com")

        if not token or not project:
            return None

        return GitLabConfig(
            token=token,
            project=project,
            instance_url=instance_url,
        )
    except Exception:
        return None

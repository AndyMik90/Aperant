"""
GitLab API Client
=================

Client for GitLab API operations.
Uses direct API calls with PRIVATE-TOKEN authentication.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any


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
        timeout: float | None = None,
        max_retries: int = 3,
    ) -> Any:
        """Make an API request to GitLab with rate limit handling."""
        validate_endpoint(endpoint)
        url = self._api_url(endpoint)
        headers = {
            "PRIVATE-TOKEN": self.config.token,
            "Content-Type": "application/json",
        }

        request_data = None
        if data:
            request_data = json.dumps(data).encode("utf-8")

        last_error = None
        for attempt in range(max_retries):
            req = urllib.request.Request(
                url,
                data=request_data,
                headers=headers,
                method=method,
            )

            try:
                with urllib.request.urlopen(
                    req, timeout=timeout or self.default_timeout
                ) as response:
                    if response.status == 204:
                        return None
                    response_body = response.read().decode("utf-8")
                    try:
                        return json.loads(response_body)
                    except json.JSONDecodeError as e:
                        raise Exception(
                            f"Invalid JSON response from GitLab: {e}"
                        ) from e
            except urllib.error.HTTPError as e:
                error_body = e.read().decode("utf-8") if e.fp else ""
                last_error = e

                # Handle rate limit (429) with exponential backoff
                if e.code == 429:
                    # Default to exponential backoff: 1s, 2s, 4s
                    wait_time = 2**attempt

                    # Check for Retry-After header (can be integer seconds or HTTP-date)
                    retry_after = e.headers.get("Retry-After")
                    if retry_after:
                        try:
                            # Try parsing as integer seconds first
                            wait_time = int(retry_after)
                        except ValueError:
                            # Try parsing as HTTP-date (e.g., "Wed, 21 Oct 2015 07:28:00 GMT")
                            try:
                                retry_date = parsedate_to_datetime(retry_after)
                                now = datetime.now(timezone.utc)
                                delta = (retry_date - now).total_seconds()
                                wait_time = max(1, int(delta))  # At least 1 second
                            except (ValueError, TypeError):
                                # Parsing failed, keep exponential backoff default
                                pass

                    if attempt < max_retries - 1:
                        print(
                            f"[GitLab] Rate limited (429). Retrying in {wait_time}s "
                            f"(attempt {attempt + 1}/{max_retries})...",
                            flush=True,
                        )
                        time.sleep(wait_time)
                        continue

                raise Exception(f"GitLab API error {e.code}: {error_body}") from e

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

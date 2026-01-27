"""
GitLab Provider Implementation
==============================

Implements the GitProvider protocol for GitLab using the GitLab REST API.
Wraps the existing GitLabClient functionality and converts to provider-agnostic models.
"""

from __future__ import annotations

import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Import from parent package or direct import
try:
    from ..glab_client import GitLabClient, GitLabConfig, encode_project_path
except (ImportError, ValueError, SystemError):
    from glab_client import GitLabClient, GitLabConfig, encode_project_path

# Import the protocol and data models from GitHub's protocol definition
# This ensures compatibility across providers
# If GitHub runners aren't available, define the types locally
try:
    from ...github.providers.protocol import (
        IssueData,
        IssueFilters,
        LabelData,
        PRData,
        PRFilters,
        ProviderType,
        ReviewData,
    )
except (ImportError, ValueError, SystemError):
    try:
        from runners.github.providers.protocol import (
            IssueData,
            IssueFilters,
            LabelData,
            PRData,
            PRFilters,
            ProviderType,
            ReviewData,
        )
    except ImportError:
        # GitHub runners not available - define protocol types locally
        from dataclasses import dataclass as _dataclass
        from enum import Enum
        from typing import Any as _Any

        class ProviderType(Enum):
            """Git provider type."""

            GITHUB = "GITHUB"
            GITLAB = "GITLAB"

        @_dataclass
        class LabelData:
            """Label data."""

            name: str
            color: str | None = None
            description: str | None = None

        @_dataclass
        class IssueData:
            """Issue data."""

            number: int
            title: str
            body: str
            state: str
            author: str
            labels: list[LabelData]
            created_at: str
            updated_at: str
            assignees: list[str] | None = None
            url: str = ""
            milestone: str | None = None
            provider: ProviderType = ProviderType.GITLAB
            raw_data: dict[str, _Any] | None = None

        @_dataclass
        class PRData:
            """Pull request/MR data."""

            number: int
            title: str
            body: str
            state: str
            author: str
            source_branch: str
            target_branch: str
            labels: list[LabelData]
            created_at: str
            updated_at: str
            provider: ProviderType
            diff: str | None = None
            assignees: list[str] | None = None
            additions: int = 0
            deletions: int = 0
            changed_files: int = 0
            files: list[_Any] | None = None
            url: str = ""
            reviewers: list[str] | None = None
            is_draft: bool = False
            mergeable: bool = True
            raw_data: dict[str, _Any] | None = None

        @_dataclass
        class ReviewData:
            """Review data."""

            body: str
            event: str
            comments: list[_Any] | None = None

        @_dataclass
        class IssueFilters:
            """Issue filters."""

            state: str | None = None
            labels: list[str] | None = None
            limit: int | None = None
            author: str | None = None
            include_prs: bool = True

        @_dataclass
        class PRFilters:
            """PR filters."""

            state: str = "open"
            labels: list[str] | None = None
            limit: int | None = None
            author: str | None = None
            base_branch: str | None = None
            head_branch: str | None = None


@dataclass
class GitLabProvider:
    """
    GitLab implementation of the GitProvider protocol.

    Uses the GitLab REST API for all operations.

    Usage:
        provider = GitLabProvider(
            repo="group/project",
            token="glpat-...",
            instance_url="https://gitlab.com"
        )
        mr = await provider.fetch_pr(123)
        await provider.post_review(123, review)
    """

    _repo: str
    _token: str
    _instance_url: str = "https://gitlab.com"
    _project_dir: Path | None = None
    _glab_client: GitLabClient | None = None
    enable_rate_limiting: bool = True

    def __post_init__(self):
        if self._glab_client is None:
            project_dir = Path(self._project_dir) if self._project_dir else Path.cwd()
            config = GitLabConfig(
                token=self._token,
                project=self._repo,
                instance_url=self._instance_url,
            )
            self._glab_client = GitLabClient(
                project_dir=project_dir,
                config=config,
            )

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.GITLAB

    @property
    def repo(self) -> str:
        return self._repo

    @property
    def glab_client(self) -> GitLabClient:
        """Get the underlying GitLabClient."""
        return self._glab_client

    # -------------------------------------------------------------------------
    # Pull Request Operations (GitLab calls them Merge Requests)
    # -------------------------------------------------------------------------

    async def fetch_pr(self, number: int) -> PRData:
        """
        Fetch a merge request by IID.

        Args:
            number: MR IID (GitLab uses IID, not global ID)

        Returns:
            PRData with full MR details including diff
        """
        # Get MR details
        mr_data = self._glab_client.get_mr(number)

        # Get MR changes (includes diff)
        changes_data = self._glab_client.get_mr_changes(number)

        # Build diff from changes
        diffs = []
        for change in changes_data.get("changes", []):
            diff = change.get("diff", "")
            if diff:
                diffs.append(diff)
        diff = "\n".join(diffs)

        return self._parse_mr_data(mr_data, diff, changes_data)

    async def fetch_prs(self, filters: PRFilters | None = None) -> list[PRData]:
        """
        Fetch merge requests with optional filters.

        Args:
            filters: Optional filters (state, labels, etc.)

        Returns:
            List of PRData
        """
        filters = filters or PRFilters()

        # Build query parameters for GitLab API
        params = {}
        if filters.state == "open":
            params["state"] = "opened"
        elif filters.state == "closed":
            params["state"] = "closed"
        elif filters.state == "merged":
            params["state"] = "merged"

        if filters.labels:
            params["labels"] = ",".join(filters.labels)

        if filters.limit:
            params["per_page"] = min(filters.limit, 100)  # GitLab max is 100

        # Use direct API call for listing MRs
        encoded_project = encode_project_path(self._repo)
        endpoint = f"/projects/{encoded_project}/merge_requests"

        mrs_data = self._glab_client._fetch(endpoint, params=params)

        result = []
        for mr_data in mrs_data:
            # Apply additional filters that aren't supported by GitLab API
            if filters.author:
                mr_author = mr_data.get("author", {}).get("username")
                if mr_author != filters.author:
                    continue

            if filters.base_branch:
                if mr_data.get("target_branch") != filters.base_branch:
                    continue

            if filters.head_branch:
                if mr_data.get("source_branch") != filters.head_branch:
                    continue

            # Parse to PRData (lightweight, no diff)
            result.append(self._parse_mr_data(mr_data, "", {}))

        return result

    async def fetch_pr_diff(self, number: int) -> str:
        """
        Fetch the diff for a merge request.

        Args:
            number: MR IID

        Returns:
            Unified diff string
        """
        return self._glab_client.get_mr_diff(number)

    async def post_review(self, pr_number: int, review: ReviewData) -> int:
        """
        Post a review to a merge request.

        GitLab doesn't have the same review concept as GitHub.
        We implement this as:
        - approve → Approve MR + post note
        - request_changes → Post note with request changes
        - comment → Post note only

        Args:
            pr_number: MR IID
            review: Review data with findings and comments

        Returns:
            Note ID (or 0 if not available)
        """
        # Post the review body as a note
        note_data = self._glab_client.post_mr_note(pr_number, review.body)

        # If approving, also approve the MR
        if review.event == "approve":
            self._glab_client.approve_mr(pr_number)

        # Return note ID
        return note_data.get("id", 0)

    async def merge_pr(
        self,
        pr_number: int,
        merge_method: str = "merge",
        commit_title: str | None = None,
    ) -> bool:
        """
        Merge a merge request.

        Args:
            pr_number: MR IID
            merge_method: merge, squash, or rebase (GitLab supports merge and squash)
            commit_title: Optional commit title

        Returns:
            True if merged successfully
        """
        # Map merge method to GitLab parameters
        squash = merge_method == "squash"

        try:
            result = self._glab_client.merge_mr(pr_number, squash=squash)
            # Check if merge was successful
            return result.get("status") != "failed"
        except Exception:
            return False

    async def close_pr(
        self,
        pr_number: int,
        comment: str | None = None,
    ) -> bool:
        """
        Close a merge request without merging.

        Args:
            pr_number: MR IID
            comment: Optional closing comment

        Returns:
            True if closed successfully
        """
        try:
            # Post closing comment if provided
            if comment:
                self._glab_client.post_mr_note(pr_number, comment)

            # GitLab doesn't have a direct "close" endpoint for MRs
            # We need to use the API to set the state event to close
            encoded_project = encode_project_path(self._repo)
            data = {"state_event": "close"}
            self._glab_client._fetch(
                f"/projects/{encoded_project}/merge_requests/{pr_number}",
                method="PUT",
                data=data,
            )
            return True
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # Issue Operations
    # -------------------------------------------------------------------------

    async def fetch_issue(self, number: int) -> IssueData:
        """
        Fetch an issue by IID.

        Args:
            number: Issue IID

        Returns:
            IssueData with full issue details
        """
        encoded_project = encode_project_path(self._repo)
        issue_data = self._glab_client._fetch(
            f"/projects/{encoded_project}/issues/{number}"
        )
        return self._parse_issue_data(issue_data)

    async def fetch_issues(
        self, filters: IssueFilters | None = None
    ) -> list[IssueData]:
        """
        Fetch issues with optional filters.

        Args:
            filters: Optional filters

        Returns:
            List of IssueData
        """
        filters = filters or IssueFilters()

        # Build query parameters
        params = {}
        if filters.state:
            params["state"] = filters.state
        if filters.labels:
            params["labels"] = ",".join(filters.labels)
        if filters.limit:
            params["per_page"] = min(filters.limit, 100)

        encoded_project = encode_project_path(self._repo)
        endpoint = f"/projects/{encoded_project}/issues"

        issues_data = self._glab_client._fetch(endpoint, params=params)

        result = []
        for issue_data in issues_data:
            # Filter out MRs if requested
            # In GitLab, MRs are separate from issues, so this check is less relevant
            # But we check for the "merge_request" label or type
            if not filters.include_prs:
                # GitLab doesn't mix MRs with issues in the issues endpoint
                pass

            # Apply author filter
            if filters.author:
                author = issue_data.get("author", {}).get("username")
                if author != filters.author:
                    continue

            result.append(self._parse_issue_data(issue_data))

        return result

    async def create_issue(
        self,
        title: str,
        body: str,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> IssueData:
        """
        Create a new issue.

        Args:
            title: Issue title
            body: Issue body
            labels: Optional labels
            assignees: Optional assignees (usernames)

        Returns:
            Created IssueData
        """
        encoded_project = encode_project_path(self._repo)

        data = {
            "title": title,
            "description": body,
        }

        if labels:
            data["labels"] = ",".join(labels)

        # GitLab uses assignee IDs, not usernames
        # We need to look up user IDs first
        if assignees:
            assignee_ids = []
            for username in assignees:
                try:
                    user_data = self._glab_client._fetch(f"/users?username={username}")
                    if user_data:
                        assignee_ids.append(user_data[0]["id"])
                except Exception:
                    pass  # Skip invalid users
            if assignee_ids:
                data["assignee_ids"] = assignee_ids

        result = self._glab_client._fetch(
            f"/projects/{encoded_project}/issues",
            method="POST",
            data=data,
        )

        # Return the created issue
        return await self.fetch_issue(result["iid"])

    async def close_issue(
        self,
        number: int,
        comment: str | None = None,
    ) -> bool:
        """
        Close an issue.

        Args:
            number: Issue IID
            comment: Optional closing comment

        Returns:
            True if closed successfully
        """
        try:
            # Post closing comment if provided
            if comment:
                encoded_project = encode_project_path(self._repo)
                self._glab_client._fetch(
                    f"/projects/{encoded_project}/issues/{number}/notes",
                    method="POST",
                    data={"body": comment},
                )

            # Close the issue
            encoded_project = encode_project_path(self._repo)
            self._glab_client._fetch(
                f"/projects/{encoded_project}/issues/{number}",
                method="PUT",
                data={"state_event": "close"},
            )
            return True
        except Exception:
            return False

    async def add_comment(
        self,
        issue_or_pr_number: int,
        body: str,
    ) -> int:
        """
        Add a comment to an issue or MR.

        Args:
            issue_or_pr_number: Issue/MR IID
            body: Comment body

        Returns:
            Note ID
        """
        # Try MR first, then issue
        try:
            note_data = self._glab_client.post_mr_note(issue_or_pr_number, body)
            return note_data.get("id", 0)
        except Exception:
            try:
                encoded_project = encode_project_path(self._repo)
                note_data = self._glab_client._fetch(
                    f"/projects/{encoded_project}/issues/{issue_or_pr_number}/notes",
                    method="POST",
                    data={"body": body},
                )
                return note_data.get("id", 0)
            except Exception:
                return 0

    # -------------------------------------------------------------------------
    # Label Operations
    # -------------------------------------------------------------------------

    async def apply_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """
        Apply labels to an issue or MR.

        Args:
            issue_or_pr_number: Issue/MR IID
            labels: Labels to apply
        """
        encoded_project = encode_project_path(self._repo)

        # Try MR first
        try:
            current_data = self._glab_client._fetch(
                f"/projects/{encoded_project}/merge_requests/{issue_or_pr_number}"
            )
            current_labels = current_data.get("labels", [])
            new_labels = list(set(current_labels + labels))

            self._glab_client._fetch(
                f"/projects/{encoded_project}/merge_requests/{issue_or_pr_number}",
                method="PUT",
                data={"labels": ",".join(new_labels)},
            )
            return
        except Exception:
            pass

        # Try issue
        try:
            current_data = self._glab_client._fetch(
                f"/projects/{encoded_project}/issues/{issue_or_pr_number}"
            )
            current_labels = current_data.get("labels", [])
            new_labels = list(set(current_labels + labels))

            self._glab_client._fetch(
                f"/projects/{encoded_project}/issues/{issue_or_pr_number}",
                method="PUT",
                data={"labels": ",".join(new_labels)},
            )
        except Exception:
            pass

    async def remove_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """
        Remove labels from an issue or MR.

        Args:
            issue_or_pr_number: Issue/MR IID
            labels: Labels to remove
        """
        encoded_project = encode_project_path(self._repo)

        # Try MR first
        try:
            current_data = self._glab_client._fetch(
                f"/projects/{encoded_project}/merge_requests/{issue_or_pr_number}"
            )
            current_labels = current_data.get("labels", [])
            new_labels = [label for label in current_labels if label not in labels]

            self._glab_client._fetch(
                f"/projects/{encoded_project}/merge_requests/{issue_or_pr_number}",
                method="PUT",
                data={"labels": ",".join(new_labels)},
            )
            return
        except Exception:
            pass

        # Try issue
        try:
            current_data = self._glab_client._fetch(
                f"/projects/{encoded_project}/issues/{issue_or_pr_number}"
            )
            current_labels = current_data.get("labels", [])
            new_labels = [label for label in current_labels if label not in labels]

            self._glab_client._fetch(
                f"/projects/{encoded_project}/issues/{issue_or_pr_number}",
                method="PUT",
                data={"labels": ",".join(new_labels)},
            )
        except Exception:
            pass

    async def create_label(self, label: LabelData) -> None:
        """
        Create a label in the repository.

        Args:
            label: Label data
        """
        encoded_project = encode_project_path(self._repo)

        data = {
            "name": label.name,
            "color": label.color.lstrip("#") if label.color else None,
        }

        if label.description:
            data["description"] = label.description

        try:
            self._glab_client._fetch(
                f"/projects/{encoded_project}/labels",
                method="POST",
                data=data,
            )
        except Exception:
            # Label might already exist, try to update
            try:
                self._glab_client._fetch(
                    f"/projects/{encoded_project}/labels/{urllib.parse.quote(label.name)}",
                    method="PUT",
                    data=data,
                )
            except Exception:
                pass

    async def list_labels(self) -> list[LabelData]:
        """
        List all labels in the repository.

        Returns:
            List of LabelData
        """
        encoded_project = encode_project_path(self._repo)

        labels_data = self._glab_client._fetch(
            f"/projects/{encoded_project}/labels",
            params={"per_page": 100},
        )

        return [
            LabelData(
                name=label["name"],
                color=f"#{label['color']}",  # Add # prefix for consistency
                description=label.get("description", ""),
            )
            for label in labels_data
        ]

    # -------------------------------------------------------------------------
    # Repository Operations
    # -------------------------------------------------------------------------

    async def get_repository_info(self) -> dict[str, Any]:
        """
        Get repository information.

        Returns:
            Repository metadata
        """
        encoded_project = encode_project_path(self._repo)
        return self._glab_client._fetch(f"/projects/{encoded_project}")

    async def get_default_branch(self) -> str:
        """
        Get the default branch name.

        Returns:
            Default branch name (e.g., "main", "master")
        """
        repo_info = await self.get_repository_info()
        return repo_info.get("default_branch", "main")

    async def check_permissions(self, username: str) -> str:
        """
        Check a user's permission level on the repository.

        Args:
            username: GitLab username

        Returns:
            Permission level (admin, maintain, developer, reporter, guest, none)
        """
        try:
            encoded_project = encode_project_path(self._repo)
            result = self._glab_client._fetch(
                f"/projects/{encoded_project}/members/all",
                params={"query": username},
            )

            if result:
                # GitLab access levels: 10=guest, 20=reporter, 30=developer, 40=maintainer, 50=owner
                access_level = result[0].get("access_level", 0)

                level_map = {
                    50: "admin",
                    40: "maintain",
                    30: "developer",
                    20: "reporter",
                    10: "guest",
                }

                return level_map.get(access_level, "none")

            return "none"
        except Exception:
            return "none"

    # -------------------------------------------------------------------------
    # API Operations (Low-level)
    # -------------------------------------------------------------------------

    async def api_get(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """
        Make a GET request to the GitLab API.

        Args:
            endpoint: API endpoint
            params: Query parameters

        Returns:
            API response data
        """
        return self._glab_client._fetch(endpoint, params=params)

    async def api_post(
        self,
        endpoint: str,
        data: dict[str, Any] | None = None,
    ) -> Any:
        """
        Make a POST request to the GitLab API.

        Args:
            endpoint: API endpoint
            data: Request body

        Returns:
            API response data
        """
        return self._glab_client._fetch(endpoint, method="POST", data=data)

    # -------------------------------------------------------------------------
    # Helper Methods
    # -------------------------------------------------------------------------

    def _parse_mr_data(
        self, data: dict[str, Any], diff: str, changes_data: dict[str, Any]
    ) -> PRData:
        """Parse GitLab MR data into PRData."""
        author_data = data.get("author", {})
        author = author_data.get("username", "unknown") if author_data else "unknown"

        labels = data.get("labels", [])

        # Extract files from changes data
        files = []
        if changes_data.get("changes"):
            for change in changes_data["changes"]:
                new_path = change.get("new_path")
                old_path = change.get("old_path")
                files.append(
                    {
                        "path": new_path or old_path,
                        "new_path": new_path,
                        "old_path": old_path,
                        "status": change.get("new_file")
                        and "added"
                        or change.get("deleted_file")
                        and "deleted"
                        or change.get("renamed_file")
                        and "renamed"
                        or "modified",
                    }
                )

        return PRData(
            number=data.get("iid", 0),
            title=data.get("title", ""),
            body=data.get("description", "") or "",
            author=author,
            state=data.get("state", "opened"),
            source_branch=data.get("source_branch", ""),
            target_branch=data.get("target_branch", ""),
            additions=changes_data.get("additions", 0),
            deletions=changes_data.get("deletions", 0),
            changed_files=changes_data.get("changed_files_count", len(files)),
            files=files,
            diff=diff,
            url=data.get("web_url", ""),
            created_at=self._parse_datetime(data.get("created_at")),
            updated_at=self._parse_datetime(data.get("updated_at")),
            labels=labels,
            reviewers=[],  # GitLab uses "assignees" not reviewers
            is_draft=data.get("draft", False),
            mergeable=data.get("merge_status") != "cannot_be_merged",
            provider=ProviderType.GITLAB,
            raw_data=data,
        )

    def _parse_issue_data(self, data: dict[str, Any]) -> IssueData:
        """Parse GitLab issue data into IssueData."""
        author_data = data.get("author", {})
        author = author_data.get("username", "unknown") if author_data else "unknown"

        labels = data.get("labels", [])

        assignees = []
        for assignee in data.get("assignees", []):
            if isinstance(assignee, dict):
                assignees.append(assignee.get("username", ""))

        milestone = data.get("milestone")
        if isinstance(milestone, dict):
            milestone = milestone.get("title")

        return IssueData(
            number=data.get("iid", 0),
            title=data.get("title", ""),
            body=data.get("description", "") or "",
            author=author,
            state=data.get("state", "opened"),
            labels=labels,
            created_at=self._parse_datetime(data.get("created_at")),
            updated_at=self._parse_datetime(data.get("updated_at")),
            url=data.get("web_url", ""),
            assignees=assignees,
            milestone=milestone,
            provider=ProviderType.GITLAB,
            raw_data=data,
        )

    def _parse_datetime(self, dt_str: str | None) -> datetime:
        """Parse ISO datetime string."""
        if not dt_str:
            return datetime.now(timezone.utc)
        try:
            return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return datetime.now(timezone.utc)

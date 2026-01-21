"""
Type definitions for GitLab API responses.

This module provides TypedDict classes for type-safe access to GitLab API data.
All TypedDicts use total=False to allow partial responses from the API.
"""

from __future__ import annotations

from typing import TypedDict


class GitLabMR(TypedDict, total=False):
    """Merge request data from GitLab API."""

    iid: int
    id: int
    title: str
    description: str
    state: str  # opened, closed, locked, merged
    created_at: str
    updated_at: str
    merged_at: str | None
    author: GitLabUser
    assignees: list[GitLabUser]
    reviewers: list[GitLabUser]
    source_branch: str
    target_branch: str
    web_url: str
    merge_status: str | None
    detailed_merge_status: GitLabMergeStatus | None
    diff_refs: GitLabDiffRefs
    labels: list[GitLabLabel]
    has_conflicts: bool
    squash: bool
    work_in_progress: bool
    merge_when_pipeline_succeeds: bool
    sha: str
    merge_commit_sha: str | None
    user_notes_count: int
    discussion_locked: bool
    should_remove_source_branch: bool
    force_remove_source_branch: bool
    references: dict[str, str]
    time_stats: dict[str, int]
    task_completion_status: dict[str, int]


class GitLabUser(TypedDict, total=False):
    """User data from GitLab API."""

    id: int
    username: str
    name: str
    email: str
    avatar_url: str
    web_url: str
    created_at: str
    bio: str | None
    location: str | None
    public_email: str | None
    skype: str | None
    linkedin: str | None
    twitter: str | None
    website_url: str | None
    organization: str | None
    job_title: str | None
    pronouns: str | None
    bot: bool
    work_in_progress: bool | None


class GitLabLabel(TypedDict, total=False):
    """Label data from GitLab API."""

    id: int
    name: str
    color: str
    description: str
    text_color: str
    priority: int | None
    is_project_label: bool
    subscribed: bool


class GitLabMergeStatus(TypedDict, total=False):
    """Detailed merge status."""

    iid: int
    project_id: int
    merge_status: str
    merged_by: GitLabUser | None
    detailed_merge_status: str
    merge_error: str | None
    merge_jid: str | None


class GitLabDiffRefs(TypedDict, total=False):
    """Diff references for rebase resistance."""

    base_sha: str
    head_sha: str
    start_sha: str
    head_commit: GitLabCommit


class GitLabCommit(TypedDict, total=False):
    """Commit data."""

    id: str
    short_id: str
    title: str
    message: str
    author_name: str
    author_email: str
    authored_date: str
    committer_name: str
    committer_email: str
    committed_date: str
    web_url: str
    stats: dict[str, int]


class GitLabIssue(TypedDict, total=False):
    """Issue data from GitLab API."""

    iid: int
    id: int
    title: str
    description: str
    state: str
    created_at: str
    updated_at: str
    closed_at: str | None
    author: GitLabUser
    assignees: list[GitLabUser]
    labels: list[GitLabLabel]
    web_url: str
    project_id: int
    milestone: GitLabMilestone | None
    type: str  # issue, incident, or test_case
    confidential: bool
    duplicated_to: dict | None
    weight: int | None
    discussion_locked: bool
    time_stats: dict[str, int]
    task_completion_status: dict[str, int]
    has_tasks: bool
    task_status: str


class GitLabMilestone(TypedDict, total=False):
    """Milestone data."""

    id: int
    iid: int
    project_id: int
    title: str
    description: str
    state: str
    created_at: str
    updated_at: str
    due_date: str | None
    start_date: str | None
    expired: bool


class GitLabPipeline(TypedDict, total=False):
    """Pipeline data."""

    id: int
    iid: int
    project_id: int
    sha: str
    ref: str
    status: str
    created_at: str
    updated_at: str
    finished_at: str | None
    duration: int | None
    web_url: str
    user: GitLabUser | None
    name: str | None
    queue_duration: int | None
    variables: list[dict[str, str]]


class GitLabJob(TypedDict, total=False):
    """Pipeline job data."""

    id: int
    project_id: int
    pipeline_id: int
    status: str
    stage: str
    name: str
    ref: str
    created_at: str
    started_at: str | None
    finished_at: str | None
    duration: float | None
    user: GitLabUser | None
    failure_reason: str | None
    retry_count: int
    artifacts: list[dict]
    runner: dict | None


class GitLabBranch(TypedDict, total=False):
    """Branch data."""

    name: str
    merged: bool
    protected: bool
    default: bool
    can_push: bool
    web_url: str
    commit: GitLabCommit
    developers_can_push: bool
    developers_can_merge: bool
    commit_short_id: str


class GitLabFile(TypedDict, total=False):
    """File data from repository."""

    file_name: str
    file_path: str
    size: int
    encoding: str
    content: str
    content_sha256: str
    ref: str
    blob_id: str
    commit_id: str
    last_commit_id: str


class GitLabWebhook(TypedDict, total=False):
    """Webhook data."""

    id: int
    url: str
    project_id: int
    push_events: bool
    issues_events: bool
    merge_request_events: bool
    wiki_page_events: bool
    deployment_events: bool
    job_events: bool
    pipeline_events: bool
    releases_events: bool
    tag_push_events: bool
    note_events: bool
    confidential_note_events: bool
    wiki_page_events: bool
    custom_webhook_url: str
    enable_ssl_verification: bool


class GitLabDiscussion(TypedDict, total=False):
    """Discussion data."""

    id: str
    individual_note: bool
    notes: list[GitLabNote]


class GitLabNote(TypedDict, total=False):
    """Note (comment) data."""

    id: int
    type: str | None
    author: GitLabUser
    created_at: str
    updated_at: str
    system: bool
    body: str
    resolvable: bool
    resolved: bool
    position: dict | None


class GitLabProject(TypedDict, total=False):
    """Project data."""

    id: int
    name: str
    name_with_namespace: str
    path: str
    path_with_namespace: str
    description: str
    default_branch: str
    created_at: str
    last_activity_at: str
    web_url: str
    avatar_url: str | None
    visibility: str
    archived: bool
    repository: GitLabRepository


class GitLabRepository(TypedDict, total=False):
    """Repository data."""

    type: str
    name: str
    url: str
    description: str


class GitLabChange(TypedDict, total=False):
    """Diff change data."""

    old_path: str
    new_path: str
    diff: str
    new_file: bool
    renamed_file: bool
    deleted_file: bool
    mode: str | None
    index: str | None

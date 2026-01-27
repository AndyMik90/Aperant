"""
GitLab Test Fixtures
====================

Mock data and fixtures for GitLab integration tests.
"""

# Sample GitLab MR data
SAMPLE_MR_DATA = {
    "iid": 123,
    "id": 12345,
    "title": "Add user authentication feature",
    "description": "Implement OAuth2 login with Google and GitHub providers",
    "author": {
        "id": 1,
        "username": "john_doe",
        "name": "John Doe",
        "email": "john@example.com",
    },
    "source_branch": "feature/oauth-auth",
    "target_branch": "main",
    "state": "opened",
    "draft": False,
    "merge_status": "can_be_merged",
    "web_url": "https://gitlab.com/group/project/-/merge_requests/123",
    "created_at": "2025-01-14T10:00:00.000Z",
    "updated_at": "2025-01-14T12:00:00.000Z",
    "labels": ["feature", "authentication"],
    "assignees": [],
}

SAMPLE_MR_CHANGES = {
    "id": 12345,
    "iid": 123,
    "project_id": 1,
    "title": "Add user authentication feature",
    "description": "Implement OAuth2 login",
    "state": "opened",
    "created_at": "2025-01-14T10:00:00.000Z",
    "updated_at": "2025-01-14T12:00:00.000Z",
    "merge_status": "can_be_merged",
    "additions": 150,
    "deletions": 20,
    "changed_files_count": 5,
    "changes": [
        {
            "old_path": "src/auth/__init__.py",
            "new_path": "src/auth/__init__.py",
            "diff": "@@ -0,0 +1,5 @@\n+from .oauth import OAuthHandler\n+from .providers import GoogleProvider, GitHubProvider",
            "new_file": False,
            "renamed_file": False,
            "deleted_file": False,
        },
        {
            "old_path": "src/auth/oauth.py",
            "new_path": "src/auth/oauth.py",
            "diff": "@@ -0,0 +1,50 @@\n+class OAuthHandler:\n+    def handle_callback(self, request):\n+        pass",
            "new_file": True,
            "renamed_file": False,
            "deleted_file": False,
        },
    ],
}

SAMPLE_MR_COMMITS = [
    {
        "id": "abc123def456",
        "short_id": "abc123de",
        "title": "Add OAuth handler",
        "message": "Add OAuth handler",
        "author_name": "John Doe",
        "author_email": "john@example.com",
        "authored_date": "2025-01-14T10:00:00.000Z",
        "created_at": "2025-01-14T10:00:00.000Z",
    },
    {
        "id": "def456ghi789",
        "short_id": "def456gh",
        "title": "Add Google provider",
        "message": "Add Google provider",
        "author_name": "John Doe",
        "author_email": "john@example.com",
        "authored_date": "2025-01-14T11:00:00.000Z",
        "created_at": "2025-01-14T11:00:00.000Z",
    },
]

# Sample GitLab issue data
SAMPLE_ISSUE_DATA = {
    "iid": 42,
    "id": 42,
    "title": "Bug: Login button not working",
    "description": "Clicking the login button does nothing",
    "author": {
        "id": 2,
        "username": "jane_smith",
        "name": "Jane Smith",
        "email": "jane@example.com",
    },
    "state": "opened",
    "labels": ["bug", "urgent"],
    "assignees": [],
    "milestone": None,
    "web_url": "https://gitlab.com/group/project/-/issues/42",
    "created_at": "2025-01-14T09:00:00.000Z",
    "updated_at": "2025-01-14T09:30:00.000Z",
}

# Sample GitLab pipeline data
SAMPLE_PIPELINE_DATA = {
    "id": 1001,
    "iid": 1,
    "project_id": 1,
    "ref": "feature/oauth-auth",
    "sha": "abc123def456",
    "status": "success",
    "source": "merge_request_event",
    "created_at": "2025-01-14T10:30:00.000Z",
    "updated_at": "2025-01-14T10:35:00.000Z",
    "finished_at": "2025-01-14T10:35:00.000Z",
    "duration": 300,
    "web_url": "https://gitlab.com/group/project/-/pipelines/1001",
}

SAMPLE_PIPELINE_JOBS = [
    {
        "id": 5001,
        "name": "test",
        "stage": "test",
        "status": "success",
        "started_at": "2025-01-14T10:31:00.000Z",
        "finished_at": "2025-01-14T10:34:00.000Z",
        "duration": 180,
        "allow_failure": False,
    },
    {
        "id": 5002,
        "name": "lint",
        "stage": "test",
        "status": "success",
        "started_at": "2025-01-14T10:31:00.000Z",
        "finished_at": "2025-01-14T10:32:00.000Z",
        "duration": 60,
        "allow_failure": False,
    },
]

# Sample GitLab discussion/note data
SAMPLE_MR_DISCUSSIONS = [
    {
        "id": "d1",
        "notes": [
            {
                "id": 1001,
                "type": "DiscussionNote",
                "author": {"username": "coderabbit[bot]"},
                "body": "Consider adding error handling for OAuth failures",
                "created_at": "2025-01-14T11:00:00.000Z",
                "system": False,
                "resolvable": True,
            }
        ],
    }
]

SAMPLE_MR_NOTES = [
    {
        "id": 2001,
        "type": "DiscussionNote",
        "author": {"username": "reviewer_user"},
        "body": "LGTM, just one comment",
        "created_at": "2025-01-14T12:00:00.000Z",
        "system": False,
    }
]

# Mock GitLab config
MOCK_GITLAB_CONFIG = {
    "token": "glpat-test-token-12345",
    "project": "group/project",
    "instance_url": "https://gitlab.example.com",
}


def create_mock_client(project_dir=None):
    """Create a mock GitLab client for testing.

    Args:
        project_dir: Optional project directory path (uses temp dir if None)

    Returns:
        Configured GitLabClient instance
    """
    import tempfile
    from pathlib import Path

    from runners.gitlab.glab_client import GitLabClient, GitLabConfig

    if project_dir is None:
        project_dir = Path(tempfile.mkdtemp())
    else:
        project_dir = Path(project_dir)

    config = GitLabConfig(**MOCK_GITLAB_CONFIG)
    return GitLabClient(project_dir=project_dir, config=config)


def mock_mr_data(**overrides):
    """Create mock MR data with optional overrides."""
    import copy

    data = copy.deepcopy(SAMPLE_MR_DATA)

    # Handle special case for author override
    if "author" in overrides:
        author_value = overrides.pop("author")
        if isinstance(author_value, str):
            # If author is a string, update the username field
            data["author"]["username"] = author_value
        else:
            # Otherwise, merge the author dict
            data["author"].update(author_value)

    data.update(overrides)
    return data


def mock_mr_changes(**overrides):
    """Create mock MR changes with optional overrides."""
    data = SAMPLE_MR_CHANGES.copy()
    data.update(overrides)
    return data


def mock_issue_data(**overrides):
    """Create mock issue data with optional overrides."""
    data = SAMPLE_ISSUE_DATA.copy()
    data.update(overrides)
    return data


def mock_pipeline_data(**overrides):
    """Create mock pipeline data with optional overrides."""
    data = SAMPLE_PIPELINE_DATA.copy()
    data.update(overrides)
    return data


def mock_pipeline_jobs(**overrides):
    """Create mock pipeline jobs with optional overrides."""
    import copy

    data = copy.deepcopy(SAMPLE_PIPELINE_JOBS)
    if overrides and data:
        data[0].update(overrides)
    return data


def mock_mr_commits(**overrides):
    """Create mock MR commits with optional overrides."""
    import copy

    data = copy.deepcopy(SAMPLE_MR_COMMITS)
    if overrides and data:
        data[0].update(overrides)
    return data


def get_mock_diff() -> str:
    """Get a mock diff string for testing."""
    return """diff --git a/src/auth/oauth.py b/src/auth/oauth.py
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/auth/oauth.py
@@ -0,0 +1,50 @@
+class OAuthHandler:
+    def handle_callback(self, request):
+        pass
diff --git a/src/auth/providers.py b/src/auth/providers.py
new file mode 100644
index 0000000..def5678
--- /dev/null
+++ b/src/auth/providers.py
@@ -0,0 +1,30 @@
+class GoogleProvider:
+    pass
+
+class GitHubProvider:
+    pass
"""

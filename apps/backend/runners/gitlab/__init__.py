"""
GitLab Automation Runner
=========================

CLI interface for GitLab automation features:
- MR Review: AI-powered merge request review
- Follow-up Review: Review changes since last review

Note: The main() function is intentionally not imported here to avoid
path conflicts when importing submodules. Import directly from runner:
    from runners.gitlab.runner import main
"""

__all__ = ["main"]

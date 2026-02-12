"""
Git Provider Abstraction
========================

Abstracts git hosting providers (GitHub, GitLab, Bitbucket) behind a common interface.

Usage:
    from providers import GitProvider, get_provider

    # Get provider based on config
    provider = get_provider(config)

    # Fetch PR data
    pr = await provider.fetch_pr(123)

    # Post review
    await provider.post_review(123, review)
"""

from runners.shared.protocol import (
    GitProvider,
    IssueData,
    IssueFilters,
    PRData,
    PRFilters,
    ProviderType,
    ReviewData,
    ReviewFinding,
)

from .factory import get_provider, register_provider
from .github_provider import GitHubProvider

__all__ = [
    # Protocol
    "GitProvider",
    "PRData",
    "IssueData",
    "ReviewData",
    "ReviewFinding",
    "IssueFilters",
    "PRFilters",
    "ProviderType",
    # Implementations
    "GitHubProvider",
    # Factory
    "get_provider",
    "register_provider",
]

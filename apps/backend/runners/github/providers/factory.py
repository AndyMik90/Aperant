"""
Provider Factory
================

Factory functions for creating git provider instances.
Supports dynamic provider registration for extensibility.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from runners.shared.protocol import GitProvider, ProviderType

from .github_provider import GitHubProvider

# Provider registry for dynamic registration
_PROVIDER_REGISTRY: dict[ProviderType, Callable[..., GitProvider]] = {}


def register_provider(
    provider_type: ProviderType,
    factory: Callable[..., GitProvider],
) -> None:
    """
    Register a provider factory.

    Args:
        provider_type: The provider type to register
        factory: Factory function that creates provider instances

    Example:
        def create_gitlab(repo: str, **kwargs) -> GitLabProvider:
            return GitLabProvider(repo=repo, **kwargs)

        register_provider(ProviderType.GITLAB, create_gitlab)
    """
    _PROVIDER_REGISTRY[provider_type] = factory


def get_provider(
    provider_type: ProviderType | str,
    repo: str,
    **kwargs: Any,
) -> GitProvider:
    """
    Get a provider instance by type.

    Args:
        provider_type: The provider type (github, gitlab, etc.)
        repo: Repository in owner/repo format
        **kwargs: Additional provider-specific arguments

    Returns:
        GitProvider instance

    Raises:
        ValueError: If provider type is not supported

    Example:
        provider = get_provider("github", "owner/repo")
        pr = await provider.fetch_pr(123)
    """
    # Convert string to enum if needed
    if isinstance(provider_type, str):
        try:
            provider_type = ProviderType(provider_type.lower())
        except ValueError:
            raise ValueError(
                f"Unknown provider type: {provider_type}. "
                f"Supported: {[p.value for p in ProviderType]}"
            )

    # Check registry first
    if provider_type in _PROVIDER_REGISTRY:
        return _PROVIDER_REGISTRY[provider_type](repo=repo, **kwargs)

    # Built-in providers
    if provider_type == ProviderType.GITHUB:
        return GitHubProvider(_repo=repo, **kwargs)

    # Non-GitHub providers should use their respective factories
    # (e.g., runners.gitlab.providers.factory for GitLab)
    if provider_type == ProviderType.GITLAB:
        raise ValueError(
            "GitLab provider requested from GitHub factory. "
            "Use 'from runners.gitlab.providers.factory import get_provider' instead."
        )

    if provider_type == ProviderType.BITBUCKET:
        raise NotImplementedError(
            "Bitbucket provider not yet implemented. "
            "See providers/bitbucket_provider.py.stub for interface."
        )

    if provider_type == ProviderType.GITEA:
        raise NotImplementedError(
            "Gitea provider not yet implemented. "
            "See providers/gitea_provider.py.stub for interface."
        )

    if provider_type == ProviderType.AZURE_DEVOPS:
        raise NotImplementedError(
            "Azure DevOps provider not yet implemented. "
            "See providers/azure_devops_provider.py.stub for interface."
        )

    raise ValueError(f"Unsupported provider type: {provider_type}")


def list_available_providers() -> list[ProviderType]:
    """
    List all available provider types.

    Returns:
        List of available ProviderType values
    """
    available = [ProviderType.GITHUB]  # Built-in

    # Add registered providers
    for provider_type in _PROVIDER_REGISTRY:
        if provider_type not in available:
            available.append(provider_type)

    return available


def is_provider_available(provider_type: ProviderType | str) -> bool:
    """
    Check if a provider is available.

    Args:
        provider_type: The provider type to check

    Returns:
        True if the provider is available
    """
    if isinstance(provider_type, str):
        try:
            provider_type = ProviderType(provider_type.lower())
        except ValueError:
            return False

    # GitHub is always available
    if provider_type == ProviderType.GITHUB:
        return True

    # Check registry
    return provider_type in _PROVIDER_REGISTRY


# Register default providers
# (Future implementations can be registered here or by external packages)

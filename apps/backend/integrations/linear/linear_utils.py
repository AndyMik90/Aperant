"""
Linear Utility Functions
=========================

Shared utility functions for Linear integration.
"""


def get_linear_authorization_header(api_key: str) -> str:
    """
    Get the correct Authorization header for Linear API.

    Linear personal API keys (starting with 'lin_api_') should be used directly.
    OAuth tokens should use 'Bearer' prefix.

    Args:
        api_key: The Linear API key or OAuth token

    Returns:
        The properly formatted Authorization header value

    Raises:
        ValueError: If api_key is empty or whitespace-only

    Examples:
        >>> get_linear_authorization_header("lin_api_1234")
        'lin_api_1234'
        >>> get_linear_authorization_header("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...")
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    """
    stripped_key = api_key.strip() if api_key else ""
    if not stripped_key:
        raise ValueError("api_key cannot be empty")
    return (
        stripped_key
        if stripped_key.startswith("lin_api_")
        else f"Bearer {stripped_key}"
    )

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

    Examples:
        >>> get_linear_authorization_header("lin_api_1234")
        'lin_api_1234'
        >>> get_linear_authorization_header("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...")
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    """
    return api_key if api_key.startswith("lin_api_") else f"Bearer {api_key}"

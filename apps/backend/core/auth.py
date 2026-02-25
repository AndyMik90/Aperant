"""
Authentication helpers for Auto Claude.

Provides centralized authentication token resolution with fallback support
for multiple environment variables, and SDK environment variable passthrough
for custom API endpoints.
"""

import hashlib
import json
import logging
import os
import shutil
import subprocess
from typing import TYPE_CHECKING

from core.platform import (
    get_where_exe_path,
    is_linux,
    is_macos,
    is_windows,
)

logger = logging.getLogger(__name__)

# Optional import for Linux secret-service support
# secretstorage provides access to the Freedesktop.org Secret Service API via DBus
if TYPE_CHECKING:
    import secretstorage
else:
    try:
        import secretstorage  # type: ignore[import-untyped]
    except ImportError:
        secretstorage = None  # type: ignore[assignment]

# Priority order for auth token resolution
# NOTE: We intentionally do NOT fall back to ANTHROPIC_API_KEY.
# Auto Claude is designed to use Claude Code OAuth tokens only.
# This prevents silent billing to user's API credits when OAuth fails.
AUTH_TOKEN_ENV_VARS = [
    "CLAUDE_CODE_OAUTH_TOKEN",  # OAuth token from Claude Code CLI
    "ANTHROPIC_AUTH_TOKEN",  # CCR/proxy token (for enterprise setups)
]

# Environment variables to pass through to SDK subprocess
# NOTE: ANTHROPIC_API_KEY is intentionally excluded to prevent silent API billing
SDK_ENV_VARS = [
    # API endpoint configuration
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    # Model overrides (from API Profile custom model mappings)
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    # SDK behavior configuration
    "NO_PROXY",
    "DISABLE_TELEMETRY",
    "DISABLE_COST_WARNINGS",
    "API_TIMEOUT_MS",
    # Windows-specific: Git Bash path for Claude Code CLI
    "CLAUDE_CODE_GIT_BASH_PATH",
    # Claude CLI path override (allows frontend to pass detected CLI path to SDK)
    "CLAUDE_CLI_PATH",
    # Profile's custom config directory (for multi-profile token storage)
    "CLAUDE_CONFIG_DIR",
]


def _calculate_config_dir_hash(config_dir: str) -> str:
    """
    Calculate hash of config directory path for Keychain service name.

    This MUST match the frontend's calculateConfigDirHash() in credential-utils.ts.
    The frontend uses SHA256 hash of the config dir path, taking first 8 hex chars.

    Args:
        config_dir: Path to the config directory (should be absolute/expanded)

    Returns:
        8-character hex hash string (e.g., "d74c9506")
    """
    return hashlib.sha256(config_dir.encode()).hexdigest()[:8]


def _get_keychain_service_name(config_dir: str | None = None) -> str:
    """
    Get the Keychain service name for credential storage.

    This MUST match the frontend's getKeychainServiceName() in credential-utils.ts.
    All profiles use hash-based keychain entries for isolation:
    - Profile with configDir: "Claude Code-credentials-{hash}"
    - No configDir (legacy/default): "Claude Code-credentials"

    Args:
        config_dir: Optional CLAUDE_CONFIG_DIR path. If provided, uses hash-based name.

    Returns:
        Keychain service name (e.g., "Claude Code-credentials-d74c9506")
    """
    if not config_dir:
        return "Claude Code-credentials"

    # Expand ~ to home directory (matching frontend normalization)
    expanded_dir = os.path.expanduser(config_dir)

    # Calculate hash and return hash-based service name
    hash_suffix = _calculate_config_dir_hash(expanded_dir)
    return f"Claude Code-credentials-{hash_suffix}"


def is_encrypted_token(token: str | None) -> bool:
    """
    Check if a token is encrypted (has "enc:" prefix).

    Args:
        token: Token string to check (can be None)

    Returns:
        True if token starts with "enc:", False otherwise
    """
    return bool(token and token.startswith("enc:"))


def validate_token_not_encrypted(token: str) -> None:
    """
    Validate that a token is not in encrypted format.

    This function should be called before passing a token to the Claude Agent SDK
    to ensure proper error messages when decryption has failed.

    Args:
        token: Token string to validate

    Raises:
        ValueError: If token is in encrypted format (enc:...)
    """
    if is_encrypted_token(token):
        raise ValueError(
            "Authentication token is in encrypted format and cannot be used.\n\n"
            "The token decryption process failed or was not attempted.\n\n"
            "To fix this issue:\n"
            "  1. Re-authenticate with Claude Code CLI: claude setup-token\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file\n\n"
            "Note: Encrypted tokens require the Claude Code CLI to be installed\n"
            "and properly configured with system keychain access."
        )


def decrypt_token(encrypted_token: str) -> str:
    """
    Decrypt Claude Code encrypted token.

    NOTE: This implementation currently relies on the system keychain (macOS Keychain,
    Linux Secret Service, Windows Credential Manager) to provide already-decrypted tokens.
    Encrypted tokens in the CLAUDE_CODE_OAUTH_TOKEN environment variable are NOT supported
    and will fail with NotImplementedError.

    For encrypted token support, users should:
    1. Run: claude setup-token (stores decrypted token in system keychain)
    2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in .env file

    Claude Code CLI stores OAuth tokens in encrypted format with "enc:" prefix.
    This function attempts to decrypt the token using platform-specific methods.

    Cross-platform token decryption approaches:
    - macOS: Token stored in Keychain with encryption key
    - Linux: Token stored in Secret Service API with encryption key
    - Windows: Token stored in Credential Manager or .credentials.json

    Args:
        encrypted_token: Token with 'enc:' prefix from Claude Code CLI

    Returns:
        Decrypted token in format 'sk-ant-oat01-...'

    Raises:
        ValueError: If token format is invalid or decryption fails
    """
    # Validate encrypted token format
    if not isinstance(encrypted_token, str):
        raise ValueError(
            f"Invalid token type. Expected string, got: {type(encrypted_token).__name__}"
        )

    if not encrypted_token.startswith("enc:"):
        raise ValueError(
            "Invalid encrypted token format. Token must start with 'enc:' prefix."
        )

    # Remove 'enc:' prefix to get encrypted data
    encrypted_data = encrypted_token[4:]

    if not encrypted_data:
        raise ValueError("Empty encrypted token data after 'enc:' prefix")

    # Basic validation of encrypted data format
    # Encrypted data should be a reasonable length (at least 10 chars)
    if len(encrypted_data) < 10:
        raise ValueError(
            "Encrypted token data is too short. The token may be corrupted."
        )

    # Check for obviously invalid characters that suggest corruption
    # Accepts both standard base64 (+/) and URL-safe base64 (-_) to be permissive
    if not all(c.isalnum() or c in "+-_/=" for c in encrypted_data):
        raise ValueError(
            "Encrypted token contains invalid characters. "
            "Expected base64-encoded data. The token may be corrupted."
        )

    # Attempt platform-specific decryption
    try:
        if is_macos():
            return _decrypt_token_macos(encrypted_data)
        elif is_linux():
            return _decrypt_token_linux(encrypted_data)
        elif is_windows():
            return _decrypt_token_windows(encrypted_data)
        else:
            raise ValueError("Unsupported platform for token decryption")

    except NotImplementedError as e:
        # Decryption not implemented - log warning and provide guidance
        logger.warning(
            "Token decryption failed: %s. Users must use plaintext tokens.", str(e)
        )
        raise ValueError(
            f"Encrypted token decryption is not yet implemented: {str(e)}\n\n"
            "To fix this issue:\n"
            "  1. Set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token (without 'enc:' prefix)\n"
            "  2. Or re-authenticate with: claude setup-token"
        )
    except ValueError:
        # Re-raise ValueError as-is (already has good error message)
        raise
    except FileNotFoundError as e:
        # File-related errors (missing credentials file, missing binary)
        raise ValueError(
            f"Failed to decrypt token - required file not found: {str(e)}\n\n"
            "To fix this issue:\n"
            "  1. Re-authenticate with Claude Code CLI: claude setup-token\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file"
        )
    except PermissionError as e:
        # Permission errors (can't access keychain, credential manager, etc.)
        raise ValueError(
            f"Failed to decrypt token - permission denied: {str(e)}\n\n"
            "To fix this issue:\n"
            "  1. Grant keychain/credential manager access to this application\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file"
        )
    except subprocess.TimeoutExpired:
        # Timeout during decryption process
        raise ValueError(
            "Failed to decrypt token - operation timed out.\n\n"
            "This may indicate a problem with system keychain access.\n\n"
            "To fix this issue:\n"
            "  1. Re-authenticate with Claude Code CLI: claude setup-token\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file"
        )
    except Exception as e:
        # Catch-all for other errors - provide helpful error message
        error_type = type(e).__name__
        raise ValueError(
            f"Failed to decrypt token ({error_type}): {str(e)}\n\n"
            "To fix this issue:\n"
            "  1. Re-authenticate with Claude Code CLI: claude setup-token\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file\n\n"
            "Note: Encrypted tokens (enc:...) require the Claude Code CLI to be installed\n"
            "and properly configured with system keychain access."
        )


def _decrypt_token_macos(encrypted_data: str) -> str:
    """
    Decrypt token on macOS using Keychain.

    Args:
        encrypted_data: Encrypted token data (without 'enc:' prefix)

    Returns:
        Decrypted token

    Raises:
        ValueError: If decryption fails or Claude CLI not available
    """
    # Verify Claude CLI is installed (required for future decryption implementation)
    if not shutil.which("claude"):
        raise ValueError(
            "Claude Code CLI not found. Please install it from https://code.claude.com"
        )

    # The Claude Code CLI handles token decryption internally when it runs
    # We can trigger this by running a simple command that requires authentication
    # and capturing the decrypted token from the environment it sets up
    #
    # However, there's no direct CLI command to decrypt tokens.
    # The SDK should handle this automatically when it receives encrypted tokens.
    raise NotImplementedError(
        "Encrypted tokens in environment variables are not supported. "
        "Please use one of these options:\n"
        "  1. Run 'claude setup-token' to store token in system keychain\n"
        "  2. Set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in .env file\n\n"
        "Note: This requires Claude Agent SDK >= 0.1.19"
    )


def _decrypt_token_linux(encrypted_data: str) -> str:
    """
    Decrypt token on Linux using Secret Service API.

    Args:
        encrypted_data: Encrypted token data (without 'enc:' prefix)

    Returns:
        Decrypted token

    Raises:
        ValueError: If decryption fails or dependencies not available
    """
    # Linux token decryption requires secretstorage library
    if secretstorage is None:
        raise ValueError(
            "secretstorage library not found. Install it with: pip install secretstorage"
        )

    # Similar to macOS, the actual decryption mechanism isn't publicly documented
    # The Claude Agent SDK should handle this automatically
    raise NotImplementedError(
        "Encrypted tokens in environment variables are not supported. "
        "Please use one of these options:\n"
        "  1. Run 'claude setup-token' to store token in system keychain\n"
        "  2. Set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in .env file\n\n"
        "Note: This requires Claude Agent SDK >= 0.1.19"
    )


def _decrypt_token_windows(encrypted_data: str) -> str:
    """
    Decrypt token on Windows using Credential Manager.

    Args:
        encrypted_data: Encrypted token data (without 'enc:' prefix)

    Returns:
        Decrypted token

    Raises:
        ValueError: If decryption fails
    """
    # Windows token decryption from Credential Manager or .credentials.json
    # The Claude Agent SDK should handle this automatically
    raise NotImplementedError(
        "Encrypted tokens in environment variables are not supported. "
        "Please use one of these options:\n"
        "  1. Run 'claude setup-token' to store token in system keychain\n"
        "  2. Set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in .env file\n\n"
        "Note: This requires Claude Agent SDK >= 0.1.19"
    )


def _try_decrypt_token(token: str | None) -> str | None:
    """
    Attempt to decrypt an encrypted token, returning original if decryption fails.

    This helper centralizes the decrypt-or-return-as-is logic used when resolving
    tokens from various sources (env vars, config dir, keychain).

    Args:
        token: Token string (may be encrypted with "enc:" prefix, plaintext, or None)

    Returns:
        - Decrypted token if successfully decrypted
        - Original token if decryption fails (allows client validation to report error)
        - Original token if not encrypted
        - None if token is None
    """
    if not token:
        return None

    if is_encrypted_token(token):
        try:
            return decrypt_token(token)
        except ValueError:
            # Decryption failed - return encrypted token so client validation
            # (validate_token_not_encrypted) can provide specific error message.
            return token

    return token


def get_token_from_keychain(config_dir: str | None = None) -> str | None:
    """
    Get authentication token from system credential store.

    Reads Claude Code credentials from:
    - macOS: Keychain (uses hash-based service name if config_dir provided)
    - Windows: Credential Manager
    - Linux: Secret Service API (via dbus/secretstorage)

    Args:
        config_dir: Optional CLAUDE_CONFIG_DIR path for profile-specific credentials.
                   When provided, reads from hash-based keychain entry matching
                   the frontend's storage location.

    Returns:
        Token string if found, None otherwise
    """
    if is_macos():
        return _get_token_from_macos_keychain(config_dir)
    elif is_windows():
        return _get_token_from_windows_credential_files(config_dir)
    else:
        # Linux: use secret-service API via DBus
        return _get_token_from_linux_secret_service(config_dir)


def _get_token_from_macos_keychain(config_dir: str | None = None) -> str | None:
    """Get token from macOS Keychain.

    Args:
        config_dir: Optional CLAUDE_CONFIG_DIR path. When provided, uses hash-based
                   service name (e.g., "Claude Code-credentials-d74c9506") matching
                   the frontend's credential storage location.
    """
    # Get the correct service name (hash-based if config_dir provided)
    service_name = _get_keychain_service_name(config_dir)

    try:
        result = subprocess.run(
            [
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                service_name,
                "-w",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode != 0:
            # If hash-based lookup fails and we have a config_dir, DON'T fall back
            # to default service name - that would return the wrong profile's token.
            # The config_dir was provided explicitly, so we should only use that.
            if config_dir:
                logger.debug(
                    f"No keychain entry found for service '{service_name}' "
                    f"(config_dir: {config_dir})"
                )
            return None

        credentials_json = result.stdout.strip()
        if not credentials_json:
            return None

        data = json.loads(credentials_json)
        token = data.get("claudeAiOauth", {}).get("accessToken")

        if not token:
            return None

        # Validate token format (Claude OAuth tokens start with sk-ant-oat01-)
        # Also accept encrypted tokens (enc:) which will be decrypted later
        if not (token.startswith("sk-ant-oat01-") or token.startswith("enc:")):
            return None

        logger.debug(f"Found token in keychain service '{service_name}'")
        return token

    except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError, Exception):
        return None


def _get_token_from_windows_credential_files(
    config_dir: str | None = None,
) -> str | None:
    """Get token from Windows credential files.

    Claude Code on Windows stores credentials in ~/.claude/.credentials.json
    For custom profiles, uses the config_dir's .credentials.json file.

    Args:
        config_dir: Optional CLAUDE_CONFIG_DIR path for profile-specific credentials.
    """
    try:
        # If config_dir is provided, read from that directory first
        if config_dir:
            expanded_dir = os.path.expanduser(config_dir)
            profile_cred_paths = [
                os.path.join(expanded_dir, ".credentials.json"),
                os.path.join(expanded_dir, "credentials.json"),
            ]
            for cred_path in profile_cred_paths:
                if os.path.exists(cred_path):
                    with open(cred_path, encoding="utf-8") as f:
                        data = json.load(f)
                        token = data.get("claudeAiOauth", {}).get("accessToken")
                        if token and (
                            token.startswith("sk-ant-oat01-")
                            or token.startswith("enc:")
                        ):
                            logger.debug(f"Found token in {cred_path}")
                            return token
            # If config_dir provided but no token found, don't fall back to default
            return None

        # Default Claude Code credential paths (no profile specified)
        cred_paths = [
            os.path.expandvars(r"%USERPROFILE%\.claude\.credentials.json"),
            os.path.expandvars(r"%USERPROFILE%\.claude\credentials.json"),
            os.path.expandvars(r"%LOCALAPPDATA%\Claude\credentials.json"),
            os.path.expandvars(r"%APPDATA%\Claude\credentials.json"),
        ]

        for cred_path in cred_paths:
            if os.path.exists(cred_path):
                with open(cred_path, encoding="utf-8") as f:
                    data = json.load(f)
                    token = data.get("claudeAiOauth", {}).get("accessToken")
                    if token and (
                        token.startswith("sk-ant-oat01-") or token.startswith("enc:")
                    ):
                        return token

        return None

    except (json.JSONDecodeError, KeyError, FileNotFoundError, Exception):
        return None


def _get_token_from_linux_secret_service(config_dir: str | None = None) -> str | None:
    """Get token from Linux Secret Service API via DBus.

    Claude Code on Linux stores credentials in the Secret Service API
    using the 'org.freedesktop.secrets' collection. This implementation
    uses the secretstorage library which communicates via DBus.

    The credential is stored with:
    - Label: "Claude Code-credentials" or "Claude Code-credentials-{hash}" for profiles
    - Attributes: {application: "claude-code"}

    Args:
        config_dir: Optional CLAUDE_CONFIG_DIR path for profile-specific credentials.

    Returns:
        Token string if found, None otherwise
    """
    if secretstorage is None:
        # secretstorage not installed, fall back to env var
        return None

    # Get the correct service name (hash-based if config_dir provided)
    target_label = _get_keychain_service_name(config_dir)

    try:
        # Get the default collection (typically "login" keyring)
        # secretstorage handles DBus communication internally
        try:
            collection = secretstorage.get_default_collection(None)
        except (
            AttributeError,
            secretstorage.exceptions.SecretServiceNotAvailableException,
        ):
            # DBus not available or secret-service not running
            return None

        if collection.is_locked():
            # Try to unlock the collection (may prompt user for password)
            try:
                collection.unlock()
            except secretstorage.exceptions.SecretStorageException:
                # User cancelled or unlock failed
                return None

        # Search for items with our application attribute
        items = collection.search_items({"application": "claude-code"})

        for item in items:
            # Check if this is the correct Claude Code credentials item
            label = item.get_label()
            # Use exact match for target label (profile-specific or default)
            if label == target_label:
                # Get the secret (stored as JSON string)
                secret = item.get_secret()
                if not secret:
                    continue

                try:
                    # Explicitly decode bytes to string if needed
                    if isinstance(secret, bytes):
                        secret = secret.decode("utf-8")
                    data = json.loads(secret)
                    token = data.get("claudeAiOauth", {}).get("accessToken")

                    if token and (
                        token.startswith("sk-ant-oat01-") or token.startswith("enc:")
                    ):
                        logger.debug(
                            f"Found token in secret service with label '{target_label}'"
                        )
                        return token
                except json.JSONDecodeError:
                    continue

        # If config_dir was provided but no token found, don't fall back
        if config_dir:
            logger.debug(
                f"No secret service entry found with label '{target_label}' "
                f"(config_dir: {config_dir})"
            )

        return None

    except (
        secretstorage.exceptions.SecretStorageException,
        json.JSONDecodeError,
        KeyError,
        AttributeError,
        TypeError,
    ):
        # Any error with secret-service, fall back to env var
        return None


def _get_token_from_config_dir(config_dir: str) -> str | None:
    """
    Read token from a custom config directory's credentials file.

    Claude Code stores credentials in .credentials.json within the config directory.
    This function reads from a profile's custom configDir instead of the default location.

    Args:
        config_dir: Path to the config directory (e.g., ~/.auto-claude/profiles/work)

    Returns:
        Token string if found, None otherwise
    """
    # Expand ~ if present
    expanded_dir = os.path.expanduser(config_dir)

    # Claude stores credentials in these files within the config dir
    cred_files = [
        os.path.join(expanded_dir, ".credentials.json"),
        os.path.join(expanded_dir, "credentials.json"),
    ]

    for cred_path in cred_files:
        if os.path.exists(cred_path):
            try:
                with open(cred_path, encoding="utf-8") as f:
                    data = json.load(f)

                # Try both credential structures
                oauth_data = data.get("claudeAiOauth") or data.get("oauthAccount") or {}
                token = oauth_data.get("accessToken")

                # Accept both plaintext tokens (sk-ant-oat01-) and encrypted tokens (enc:)
                if token and (
                    token.startswith("sk-ant-oat01-") or token.startswith("enc:")
                ):
                    logger.debug(f"Found token in {cred_path}")
                    return token
            except (json.JSONDecodeError, KeyError, Exception) as e:
                logger.debug(f"Failed to read {cred_path}: {e}")
                continue

    return None


def get_auth_token(config_dir: str | None = None) -> str | None:
    """
    Get authentication token from environment variables or credential store.

    Args:
        config_dir: Optional custom config directory (profile's configDir).
                   If provided, reads credentials from this directory.
                   If None, checks CLAUDE_CONFIG_DIR env var, then uses default locations.

    Checks multiple sources in priority order:
    1. CLAUDE_CODE_OAUTH_TOKEN (env var)
    2. ANTHROPIC_AUTH_TOKEN (CCR/proxy env var for enterprise setups)
    3. Custom config directory (config_dir param or CLAUDE_CONFIG_DIR env var)
    4. System credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service)

    NOTE: ANTHROPIC_API_KEY is intentionally NOT supported to prevent
    silent billing to user's API credits when OAuth is misconfigured.

    If the token has an "enc:" prefix (encrypted format), it will be automatically
    decrypted before being returned.

    Returns:
        Token string if found, None otherwise
    """
    _debug = os.environ.get("DEBUG", "").lower() in ("true", "1")

    if _debug:
        # Log which auth env vars are set (presence only, never values)
        set_vars = [v for v in AUTH_TOKEN_ENV_VARS if os.environ.get(v)]
        logger.info(
            "[Auth] get_auth_token() called — config_dir param=%s, "
            "env vars present: %s, CLAUDE_CONFIG_DIR env=%s",
            repr(config_dir),
            set_vars or "(none)",
            "set" if os.environ.get("CLAUDE_CONFIG_DIR") else "unset",
        )

    # First check environment variables (highest priority)
    for var in AUTH_TOKEN_ENV_VARS:
        token = os.environ.get(var)
        if token:
            if _debug:
                logger.info("[Auth] Token resolved from env var: %s", var)
            return _try_decrypt_token(token)

    # Check CLAUDE_CONFIG_DIR environment variable (profile's custom config directory)
    env_config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    effective_config_dir = config_dir or env_config_dir

    # Debug: Log which config_dir is being used for credential resolution
    if _debug and effective_config_dir:
        service_name = _get_keychain_service_name(effective_config_dir)
        logger.info(
            "[Auth] Resolving credentials for profile config_dir: %s "
            "(Keychain service: %s)",
            effective_config_dir,
            service_name,
        )

    # If a custom config directory is specified, read from there first
    if effective_config_dir:
        # Try reading from .credentials.json file in the config directory
        token = _get_token_from_config_dir(effective_config_dir)
        if token:
            if _debug:
                logger.info(
                    "[Auth] Token resolved from config dir file: %s",
                    effective_config_dir,
                )
            return _try_decrypt_token(token)

        # Also try the system credential store with hash-based service name
        # This is needed because macOS stores credentials in Keychain, not files
        token = get_token_from_keychain(effective_config_dir)
        if token:
            if _debug:
                logger.info("[Auth] Token resolved from Keychain (profile-specific)")
            return _try_decrypt_token(token)

        # If config_dir was explicitly provided, DON'T fall back to default keychain
        # - that would return the wrong profile's token
        logger.debug(
            "No credentials found for config_dir '%s' in file or keychain",
            effective_config_dir,
        )
        return None

    # No config_dir specified - use default system credential store
    keychain_token = get_token_from_keychain()
    if _debug:
        logger.info(
            "[Auth] Token resolved from default Keychain: %s",
            "found" if keychain_token else "not found",
        )
    return _try_decrypt_token(keychain_token)


def get_auth_token_source(config_dir: str | None = None) -> str | None:
    """
    Get the name of the source that provided the auth token.

    Args:
        config_dir: Optional custom config directory (profile's configDir).
                   If provided, checks this directory for credentials.
                   If None, checks CLAUDE_CONFIG_DIR env var.
    """
    # Check environment variables first
    for var in AUTH_TOKEN_ENV_VARS:
        if os.environ.get(var):
            return var

    # Check if token came from custom config directory (profile's configDir)
    env_config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    effective_config_dir = config_dir or env_config_dir
    if effective_config_dir:
        # Check file-based storage
        if _get_token_from_config_dir(effective_config_dir):
            return "CLAUDE_CONFIG_DIR"
        # Check hash-based keychain entry for this profile
        if get_token_from_keychain(effective_config_dir):
            if is_macos():
                return "macOS Keychain (profile)"
            elif is_windows():
                return "Windows Credential Files (profile)"
            else:
                return "Linux Secret Service (profile)"

    # Check if token came from default system credential store
    if get_token_from_keychain():
        if is_macos():
            return "macOS Keychain"
        elif is_windows():
            return "Windows Credential Files"
        else:
            return "Linux Secret Service"

    return None


def require_auth_token(config_dir: str | None = None) -> str:
    """
    Get authentication token or raise ValueError.

    Args:
        config_dir: Optional custom config directory (profile's configDir).
                   If provided, reads credentials from this directory.
                   If None, checks CLAUDE_CONFIG_DIR env var, then uses default locations.

    Raises:
        ValueError: If no auth token is found in any supported source
    """
    token = get_auth_token(config_dir)
    if not token:
        error_msg = (
            "No OAuth token found.\n\n"
            "Auto Claude requires Claude Code OAuth authentication.\n"
            "Direct API keys (ANTHROPIC_API_KEY) are not supported.\n\n"
        )
        # Provide platform-specific guidance
        if is_macos():
            error_msg += (
                "To authenticate:\n"
                "  1. Run: claude\n"
                "  2. Type: /login\n"
                "  3. Press Enter to open browser\n"
                "  4. Complete OAuth login in browser\n\n"
                "The token will be saved to macOS Keychain automatically."
            )
        elif is_windows():
            error_msg += (
                "To authenticate:\n"
                "  1. Run: claude\n"
                "  2. Type: /login\n"
                "  3. Press Enter to open browser\n"
                "  4. Complete OAuth login in browser\n\n"
                "The token will be saved to Windows Credential Manager."
            )
        else:
            # Linux
            error_msg += (
                "To authenticate:\n"
                "  1. Run: claude\n"
                "  2. Type: /login\n"
                "  3. Press Enter to open browser\n"
                "  4. Complete OAuth login in browser\n\n"
                "Or set CLAUDE_CODE_OAUTH_TOKEN in your .env file."
            )
        raise ValueError(error_msg)
    return token


def _find_git_bash_path() -> str | None:
    """
    Find git-bash (bash.exe) path on Windows.

    Uses 'where git' to find git.exe, then derives bash.exe location from it.
    Git for Windows installs bash.exe in the 'bin' directory alongside git.exe
    or in the parent 'bin' directory when git.exe is in 'cmd'.

    Returns:
        Full path to bash.exe if found, None otherwise
    """
    if not is_windows():
        return None

    # If already set in environment, use that
    existing = os.environ.get("CLAUDE_CODE_GIT_BASH_PATH")
    if existing and os.path.exists(existing):
        return existing

    git_path = None

    # Method 1: Use 'where' command to find git.exe
    try:
        # Use full path to where.exe for reliability (works even when System32 isn't in PATH)
        result = subprocess.run(
            [get_where_exe_path(), "git"],
            capture_output=True,
            text=True,
            timeout=5,
            shell=False,
        )

        if result.returncode == 0 and result.stdout.strip():
            git_paths = result.stdout.strip().splitlines()
            if git_paths:
                git_path = git_paths[0].strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
        # Intentionally suppress errors - best-effort detection with fallback to common paths
        pass

    # Method 2: Check common installation paths if 'where' didn't work
    if not git_path:
        common_git_paths = [
            os.path.expandvars(r"%PROGRAMFILES%\Git\cmd\git.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\Git\bin\git.exe"),
            os.path.expandvars(r"%PROGRAMFILES(X86)%\Git\cmd\git.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\cmd\git.exe"),
        ]
        for path in common_git_paths:
            if os.path.exists(path):
                git_path = path
                break

    if not git_path:
        return None

    # Derive bash.exe location from git.exe location
    # Git for Windows structure:
    #   C:\...\Git\cmd\git.exe     -> bash.exe is at C:\...\Git\bin\bash.exe
    #   C:\...\Git\bin\git.exe     -> bash.exe is at C:\...\Git\bin\bash.exe
    #   C:\...\Git\mingw64\bin\git.exe -> bash.exe is at C:\...\Git\bin\bash.exe
    git_dir = os.path.dirname(git_path)
    git_parent = os.path.dirname(git_dir)
    git_grandparent = os.path.dirname(git_parent)

    # Check common bash.exe locations relative to git installation
    possible_bash_paths = [
        os.path.join(git_parent, "bin", "bash.exe"),  # cmd -> bin
        os.path.join(git_dir, "bash.exe"),  # If git.exe is in bin
        os.path.join(git_grandparent, "bin", "bash.exe"),  # mingw64/bin -> bin
    ]

    for bash_path in possible_bash_paths:
        if os.path.exists(bash_path):
            return bash_path

    return None


def get_sdk_env_vars() -> dict[str, str]:
    """
    Get environment variables to pass to SDK.

    Collects relevant env vars (ANTHROPIC_BASE_URL, etc.) that should
    be passed through to the claude-agent-sdk subprocess.

    On Windows, auto-detects CLAUDE_CODE_GIT_BASH_PATH if not already set.

    Returns:
        Dict of env var name -> value for non-empty vars
    """
    env = {}
    for var in SDK_ENV_VARS:
        value = os.environ.get(var)
        if value:
            env[var] = value

    # On Windows, auto-detect git-bash path if not already set
    # Claude Code CLI requires bash.exe to run on Windows
    if is_windows() and "CLAUDE_CODE_GIT_BASH_PATH" not in env:
        bash_path = _find_git_bash_path()
        if bash_path:
            env["CLAUDE_CODE_GIT_BASH_PATH"] = bash_path

    # Explicitly unset PYTHONPATH in SDK subprocess environment to prevent
    # pollution of agent subprocess environments. This fixes ACS-251 where
    # external projects with different Python versions would fail due to
    # inheriting Auto-Claude's PYTHONPATH (which points to Python 3.12 packages).
    #
    # The SDK merges os.environ with the env dict we provide, so setting
    # PYTHONPATH to an empty string here overrides any inherited value.
    # The empty string ensures Python doesn't add any extra paths to sys.path.
    env["PYTHONPATH"] = ""

    return env


def configure_sdk_authentication(config_dir: str | None = None) -> None:
    """
    Configure SDK authentication based on environment variables.

    Supports two authentication modes:
    - API Profile mode (ANTHROPIC_BASE_URL set): uses ANTHROPIC_AUTH_TOKEN
    - OAuth mode (default): uses CLAUDE_CODE_OAUTH_TOKEN

    In API profile mode, explicitly removes CLAUDE_CODE_OAUTH_TOKEN from the
    environment because the SDK gives OAuth priority over API keys when both
    are present.

    Args:
        config_dir: Optional profile config directory for per-profile Keychain
                    lookup. When set, enables multi-profile token storage.

    Raises:
        ValueError: If required tokens are missing for the active mode.
                   - API profile mode: requires ANTHROPIC_AUTH_TOKEN
                   - OAuth mode: requires CLAUDE_CODE_OAUTH_TOKEN (from Keychain or env)
    """
    _debug = os.environ.get("DEBUG", "").lower() in ("true", "1")
    api_profile_mode = bool(os.environ.get("ANTHROPIC_BASE_URL", "").strip())

    if _debug:
        logger.info(
            "[Auth] configure_sdk_authentication() — mode=%s, config_dir=%s, "
            "CLAUDE_CONFIG_DIR env=%s",
            "api_profile" if api_profile_mode else "oauth",
            repr(config_dir),
            "set" if os.environ.get("CLAUDE_CONFIG_DIR") else "unset",
        )

    if api_profile_mode:
        # API profile mode: ensure ANTHROPIC_AUTH_TOKEN is present
        if not os.environ.get("ANTHROPIC_AUTH_TOKEN"):
            raise ValueError(
                "API profile mode active (ANTHROPIC_BASE_URL is set) "
                "but ANTHROPIC_AUTH_TOKEN is not set"
            )
        # Explicitly remove CLAUDE_CODE_OAUTH_TOKEN so SDK uses ANTHROPIC_AUTH_TOKEN
        # SDK gives OAuth priority over API keys when both are present
        os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
        logger.info("Using API profile authentication")
    else:
        # OAuth mode: require and validate OAuth token
        # Get OAuth token - uses profile-specific Keychain lookup when config_dir is set
        # This correctly reads from "Claude Code-credentials-{hash}" for non-default profiles
        oauth_token = require_auth_token(config_dir)

        # Validate token is not encrypted before passing to SDK
        # Encrypted tokens (enc:...) should have been decrypted by require_auth_token()
        # If we still have an encrypted token here, it means decryption failed or was skipped
        validate_token_not_encrypted(oauth_token)

        # Ensure SDK can access it via its expected env var
        # This is required because the SDK doesn't know about per-profile Keychain naming
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = oauth_token
        logger.info("Using OAuth authentication")

        if _debug:
            logger.info(
                "[Auth] SDK env check — CLAUDE_CONFIG_DIR=%s, "
                "CLAUDE_CODE_OAUTH_TOKEN=%s",
                "set" if os.environ.get("CLAUDE_CONFIG_DIR") else "unset",
                "set" if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") else "unset",
            )


def ensure_claude_code_oauth_token() -> None:
    """
    Ensure CLAUDE_CODE_OAUTH_TOKEN is set (for SDK compatibility).

    If not set but other auth tokens are available, copies the value
    to CLAUDE_CODE_OAUTH_TOKEN so the underlying SDK can use it.
    """
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return

    token = get_auth_token()
    if token:
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token


def trigger_login() -> bool:
    """
    Trigger Claude Code OAuth login flow.

    Opens the Claude Code CLI and sends /login command to initiate
    browser-based OAuth authentication. The token is automatically
    saved to the system credential store (macOS Keychain, Windows
    Credential Manager).

    Returns:
        True if login was successful, False otherwise
    """
    if is_macos():
        return _trigger_login_macos()
    elif is_windows():
        return _trigger_login_windows()
    else:
        # Linux: fall back to manual instructions
        print("\nTo authenticate, run 'claude' and type '/login'")
        return False


def _trigger_login_macos() -> bool:
    """Trigger login on macOS using expect."""
    import shutil
    import tempfile

    # Check if expect is available
    if not shutil.which("expect"):
        print("\nTo authenticate, run 'claude' and type '/login'")
        return False

    # Create expect script
    expect_script = """#!/usr/bin/expect -f
set timeout 120
spawn claude
expect {
    -re ".*" {
        send "/login\\r"
        expect {
            "Press Enter" {
                send "\\r"
            }
            -re ".*login.*" {
                send "\\r"
            }
            timeout {
                send "\\r"
            }
        }
    }
}
# Keep running until user completes login or exits
interact
"""

    # Use TemporaryDirectory context manager for automatic cleanup
    # This prevents information leakage about authentication activity
    # Directory created with mode 0o700 (owner read/write/execute only)
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            # Ensure directory has owner-only permissions
            os.chmod(temp_dir, 0o700)

            # Write expect script to temp file in our private directory
            script_path = os.path.join(temp_dir, "login.exp")
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(expect_script)

            # Set script permissions to owner-only (0o700)
            os.chmod(script_path, 0o700)

            print("\n" + "=" * 60)
            print("CLAUDE CODE LOGIN")
            print("=" * 60)
            print("\nOpening Claude Code for authentication...")
            print("A browser window will open for OAuth login.")
            print("After completing login in the browser, press Ctrl+C to exit.\n")

            # Run expect script
            subprocess.run(
                ["expect", script_path],
                timeout=300,  # 5 minute timeout
            )

            # Verify token was saved
            token = get_token_from_keychain()
            if token:
                print("\n✓ Login successful! Token saved to macOS Keychain.")
                return True
            else:
                print(
                    "\n✗ Login may not have completed. Try running 'claude' and type '/login'"
                )
                return False

    except subprocess.TimeoutExpired:
        print("\nLogin timed out. Try running 'claude' manually and type '/login'")
        return False
    except KeyboardInterrupt:
        # User pressed Ctrl+C - check if login completed
        token = get_token_from_keychain()
        if token:
            print("\n✓ Login successful! Token saved to macOS Keychain.")
            return True
        return False
    except Exception as e:
        print(f"\nLogin failed: {e}")
        print("Try running 'claude' manually and type '/login'")
        return False


def _trigger_login_windows() -> bool:
    """Trigger login on Windows."""
    # Windows doesn't have expect by default, so we use a simpler approach
    # that just launches claude and tells the user what to type
    print("\n" + "=" * 60)
    print("CLAUDE CODE LOGIN")
    print("=" * 60)
    print("\nLaunching Claude Code...")
    print("Please type '/login' and press Enter.")
    print("A browser window will open for OAuth login.\n")

    try:
        # Launch claude interactively
        subprocess.run(["claude"], timeout=300)

        # Verify token was saved
        token = _get_token_from_windows_credential_files()
        if token:
            print("\n✓ Login successful!")
            return True
        else:
            print("\n✗ Login may not have completed.")
            return False

    except Exception as e:
        print(f"\nLogin failed: {e}")
        return False


def ensure_authenticated() -> str:
    """
    Ensure the user is authenticated, prompting for login if needed.

    Checks for existing token and triggers login flow if not found.

    Returns:
        The authentication token

    Raises:
        ValueError: If authentication fails after login attempt
    """
    # First check if already authenticated
    token = get_auth_token()
    if token:
        return token

    # No token found - trigger login
    print("\nNo OAuth token found. Starting login flow...")

    if trigger_login():
        # Re-check for token after login
        token = get_auth_token()
        if token:
            return token

    # Login failed or was cancelled
    raise ValueError(
        "Authentication required.\n\n"
        "To authenticate:\n"
        "  1. Run: claude\n"
        "  2. Type: /login\n"
        "  3. Press Enter to open browser\n"
        "  4. Complete OAuth login in browser"
    )

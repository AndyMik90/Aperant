#!/usr/bin/env python3
"""
Tests for Authentication System
================================

Tests the auth.py module functionality including:
- Environment variable token resolution
- System credential store integration (macOS, Windows, Linux)
- Token source detection
- Token validation and format checking
"""

import json
import os
import platform
from unittest.mock import MagicMock, Mock

import pytest
from core.auth import (
    AUTH_TOKEN_ENV_VARS,
    ensure_claude_code_oauth_token,
    get_auth_token,
    get_auth_token_source,
    get_sdk_env_vars,
    get_token_from_keychain,
    require_auth_token,
)


class TestEnvVarTokenResolution:
    """Tests for environment variable token resolution."""

    @pytest.fixture(autouse=True)
    def clear_env(self):
        """Clear auth environment variables before each test."""
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)
        yield
        # Cleanup after test
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)

    def test_claude_oauth_token_from_env(self):
        """Reads CLAUDE_CODE_OAUTH_TOKEN from environment."""
        test_token = "sk-ant-oat01-test-token"
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = test_token

        token = get_auth_token()
        assert token == test_token

    def test_anthropic_auth_token_from_env(self):
        """Reads ANTHROPIC_AUTH_TOKEN from environment."""
        test_token = "sk-ant-oat01-test-enterprise-token"
        os.environ["ANTHROPIC_AUTH_TOKEN"] = test_token

        token = get_auth_token()
        assert token == test_token

    def test_claude_oauth_takes_precedence(self):
        """CLAUDE_CODE_OAUTH_TOKEN takes precedence over ANTHROPIC_AUTH_TOKEN."""
        claude_token = "sk-ant-oat01-claude-token"
        anthropic_token = "sk-ant-oat01-anthropic-token"

        os.environ["ANTHROPIC_AUTH_TOKEN"] = anthropic_token
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = claude_token

        token = get_auth_token()
        assert token == claude_token

    def test_no_token_returns_none(self, monkeypatch):
        """Returns None when no auth token is configured."""
        # Mock keychain to return None (env vars already cleared by fixture)
        monkeypatch.setattr("core.auth.get_token_from_keychain", lambda _config_dir=None: None)
        token = get_auth_token()
        assert token is None

    def test_token_source_from_env(self):
        """Identifies environment variable as token source."""
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "sk-ant-oat01-test-token"

        source = get_auth_token_source()
        assert source == "CLAUDE_CODE_OAUTH_TOKEN"

    def test_empty_token_ignored(self):
        """Empty string tokens are ignored."""
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = ""
        os.environ["ANTHROPIC_AUTH_TOKEN"] = "sk-ant-oat01-test-token"

        token = get_auth_token()
        # Should get ANTHROPIC_AUTH_TOKEN since CLAUDE_CODE_OAUTH_TOKEN is empty
        assert token == "sk-ant-oat01-test-token"


class TestMacOSKeychain:
    """Tests for macOS keychain token retrieval."""

    def test_macos_keychain_success(self, monkeypatch):
        """Successfully retrieves token from macOS keychain."""
        test_token = "sk-ant-oat01-macos-token"
        credentials = json.dumps({"claudeAiOauth": {"accessToken": test_token}})

        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = credentials

        monkeypatch.setattr(platform, "system", lambda: "Darwin")
        monkeypatch.setattr("subprocess.run", Mock(return_value=mock_result))

        token = get_token_from_keychain()
        assert token == test_token

    def test_macos_keychain_command_failure(self, monkeypatch):
        """Returns None when security command fails."""
        mock_result = Mock()
        mock_result.returncode = 1

        monkeypatch.setattr(platform, "system", lambda: "Darwin")
        monkeypatch.setattr("subprocess.run", Mock(return_value=mock_result))

        token = get_token_from_keychain()
        assert token is None

    def test_macos_keychain_invalid_json(self, monkeypatch):
        """Returns None when keychain returns invalid JSON."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "invalid json"

        monkeypatch.setattr(platform, "system", lambda: "Darwin")
        monkeypatch.setattr("subprocess.run", Mock(return_value=mock_result))

        token = get_token_from_keychain()
        assert token is None

    def test_macos_keychain_invalid_token_format(self, monkeypatch):
        """Returns None when token doesn't start with sk-ant-oat01-."""
        credentials = json.dumps({"claudeAiOauth": {"accessToken": "invalid-token"}})

        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = credentials

        monkeypatch.setattr(platform, "system", lambda: "Darwin")
        monkeypatch.setattr("subprocess.run", Mock(return_value=mock_result))

        token = get_token_from_keychain()
        assert token is None


class TestWindowsCredentialFiles:
    """Tests for Windows credential file token retrieval."""

    def test_windows_credential_file_success(self, monkeypatch, tmp_path):
        """Successfully retrieves token from Windows credential file."""
        test_token = "sk-ant-oat01-windows-token"
        credentials = json.dumps({"claudeAiOauth": {"accessToken": test_token}})

        # Create a temporary credential file
        cred_file = tmp_path / ".credentials.json"
        cred_file.write_text(credentials)

        monkeypatch.setattr(platform, "system", lambda: "Windows")
        monkeypatch.setattr(
            os.path, "expandvars", lambda p: str(cred_file).replace("\\", "/")
        )

        token = get_token_from_keychain()
        assert token == test_token

    def test_windows_credential_file_not_found(self, monkeypatch):
        """Returns None when credential file doesn't exist."""
        monkeypatch.setattr(platform, "system", lambda: "Windows")
        monkeypatch.setattr(os.path, "exists", lambda x: False)

        token = get_token_from_keychain()
        assert token is None

    def test_windows_credential_file_invalid_json(self, monkeypatch, tmp_path):
        """Returns None when credential file contains invalid JSON."""
        cred_file = tmp_path / ".credentials.json"
        cred_file.write_text("invalid json")

        monkeypatch.setattr(platform, "system", lambda: "Windows")
        monkeypatch.setattr(
            os.path, "expandvars", lambda p: str(cred_file).replace("\\", "/")
        )
        monkeypatch.setattr(os.path, "exists", lambda x: str(x).endswith(".json"))

        token = get_token_from_keychain()
        assert token is None


class TestLinuxSecretService:
    """Tests for Linux Secret Service token retrieval."""

    def test_linux_secret_service_not_installed(self, monkeypatch):
        """Returns None when secretstorage is not installed."""
        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", None)

        token = get_token_from_keychain()
        assert token is None

    def test_linux_secret_service_dbus_not_available(self, monkeypatch):
        """Returns None when DBus is not available."""
        mock_ss = MagicMock()
        mock_ss.exceptions = MagicMock()
        mock_ss.exceptions.SecretServiceNotAvailableException = Exception

        # Make get_default_collection raise exception
        mock_ss.get_default_collection.side_effect = Exception("DBus not available")

        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        token = get_token_from_keychain()
        assert token is None

    def test_linux_secret_service_success(self, monkeypatch):
        """Successfully retrieves token from Linux secret service."""
        test_token = "sk-ant-oat01-linux-token"
        credentials = json.dumps({"claudeAiOauth": {"accessToken": test_token}})

        # Mock secretstorage
        mock_ss = MagicMock()
        mock_ss.exceptions = MagicMock()
        mock_ss.exceptions.SecretServiceNotAvailableException = Exception
        mock_ss.exceptions.SecretStorageException = Exception

        # Mock collection
        mock_collection = MagicMock()
        mock_collection.is_locked.return_value = False
        mock_collection.unlock.return_value = None

        # Mock item
        mock_item = MagicMock()
        mock_item.get_label.return_value = "Claude Code-credentials"
        mock_item.get_secret.return_value = credentials
        mock_item.is_locked.return_value = False

        mock_collection.search_items.return_value = [mock_item]
        mock_ss.get_default_collection.return_value = mock_collection

        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        token = get_token_from_keychain()
        assert token == test_token

    def test_linux_secret_service_exact_label_match_only(self, monkeypatch):
        """Only matches exact 'Claude Code-credentials' label."""
        test_token = "sk-ant-oat01-linux-token"
        credentials = json.dumps({"claudeAiOauth": {"accessToken": test_token}})

        mock_ss = MagicMock()
        mock_ss.exceptions = MagicMock()
        mock_ss.exceptions.SecretServiceNotAvailableException = Exception
        mock_ss.exceptions.SecretStorageException = Exception

        mock_collection = MagicMock()
        mock_collection.is_locked.return_value = False

        # Mock item with similar but not exact label
        mock_item = MagicMock()
        mock_item.get_label.return_value = (
            "Some-Claude-Code-Thing"  # Similar but not exact
        )
        mock_item.get_secret.return_value = credentials

        mock_collection.search_items.return_value = [mock_item]
        mock_ss.get_default_collection.return_value = mock_collection

        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        token = get_token_from_keychain()
        # Should return None because label doesn't match exactly
        assert token is None

    def test_linux_secret_service_locked_collection_unlock_fails(self, monkeypatch):
        """Returns None when collection is locked and unlock fails."""

        mock_ss = MagicMock()
        mock_ss.exceptions = MagicMock()
        mock_ss.exceptions.SecretServiceNotAvailableException = Exception
        mock_ss.exceptions.SecretStorageException = Exception

        mock_collection = MagicMock()
        mock_collection.is_locked.return_value = True
        mock_collection.unlock.side_effect = Exception("Unlock failed")

        mock_ss.get_default_collection.return_value = mock_collection

        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        token = get_token_from_keychain()
        assert token is None

    def test_linux_secret_service_no_matching_item(self, monkeypatch):
        """Returns None when no matching credential found."""
        mock_ss = MagicMock()
        mock_ss.exceptions = MagicMock()
        mock_ss.exceptions.SecretServiceNotAvailableException = Exception
        mock_ss.exceptions.SecretStorageException = Exception

        mock_collection = MagicMock()
        mock_collection.is_locked.return_value = False
        mock_collection.search_items.return_value = []  # No items found

        mock_ss.get_default_collection.return_value = mock_collection

        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        token = get_token_from_keychain()
        assert token is None

    def test_linux_secret_service_invalid_json(self, monkeypatch):
        """Returns None when stored secret contains invalid JSON."""
        mock_ss = MagicMock()
        mock_ss.exceptions = MagicMock()
        mock_ss.exceptions.SecretServiceNotAvailableException = Exception
        mock_ss.exceptions.SecretStorageException = Exception

        mock_collection = MagicMock()
        mock_collection.is_locked.return_value = False

        mock_item = MagicMock()
        mock_item.get_label.return_value = "Claude Code-credentials"
        mock_item.get_secret.return_value = "invalid json"

        mock_collection.search_items.return_value = [mock_item]
        mock_ss.get_default_collection.return_value = mock_collection

        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        token = get_token_from_keychain()
        assert token is None

    def test_linux_secret_service_invalid_token_format(self, monkeypatch):
        """Returns None when token doesn't start with sk-ant-oat01-."""
        credentials = json.dumps({"claudeAiOauth": {"accessToken": "invalid-token"}})

        mock_ss = MagicMock()
        mock_ss.exceptions = MagicMock()
        mock_ss.exceptions.SecretServiceNotAvailableException = Exception
        mock_ss.exceptions.SecretStorageException = Exception

        mock_collection = MagicMock()
        mock_collection.is_locked.return_value = False

        mock_item = MagicMock()
        mock_item.get_label.return_value = "Claude Code-credentials"
        mock_item.get_secret.return_value = credentials

        mock_collection.search_items.return_value = [mock_item]
        mock_ss.get_default_collection.return_value = mock_collection

        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        token = get_token_from_keychain()
        assert token is None


class TestRequireAuthToken:
    """Tests for require_auth_token function."""

    @pytest.fixture(autouse=True)
    def clear_env(self, monkeypatch):
        """Clear auth environment variables and mock keychain before each test."""
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)
        # Mock keychain to return None (tests that need a token will set env var)
        monkeypatch.setattr("core.auth.get_token_from_keychain", lambda _config_dir=None: None)
        yield
        # Cleanup after test
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)

    def test_require_token_returns_valid_token(self):
        """Returns token when valid token exists."""
        test_token = "sk-ant-oat01-test-token"
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = test_token

        token = require_auth_token()
        assert token == test_token

    def test_require_token_raises_when_missing(self):
        """Raises ValueError when no token is configured."""
        with pytest.raises(ValueError, match="No OAuth token found"):
            require_auth_token()

    def test_error_message_includes_macos_instructions(self, monkeypatch):
        """Error message includes macOS setup instructions."""
        monkeypatch.setattr(platform, "system", lambda: "Darwin")

        with pytest.raises(ValueError) as exc_info:
            require_auth_token()

        error_msg = str(exc_info.value)
        assert "macOS Keychain" in error_msg
        assert "/login" in error_msg

    def test_error_message_includes_windows_instructions(self, monkeypatch):
        """Error message includes Windows setup instructions."""
        monkeypatch.setattr(platform, "system", lambda: "Windows")

        with pytest.raises(ValueError) as exc_info:
            require_auth_token()

        error_msg = str(exc_info.value)
        assert "Windows Credential Manager" in error_msg
        assert "/login" in error_msg

    def test_error_message_includes_linux_instructions(self, monkeypatch):
        """Error message includes Linux setup instructions."""
        monkeypatch.setattr(platform, "system", lambda: "Linux")

        with pytest.raises(ValueError) as exc_info:
            require_auth_token()

        error_msg = str(exc_info.value)
        # Linux error message uses /login and mentions .env file as alternative
        assert "/login" in error_msg
        assert "CLAUDE_CODE_OAUTH_TOKEN" in error_msg


class TestEnsureClaudeCodeOAuthToken:
    """Tests for ensure_claude_code_oauth_token function."""

    @pytest.fixture(autouse=True)
    def clear_env(self):
        """Clear auth environment variables before each test."""
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)
        os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
        yield
        # Cleanup after test
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)
        os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)

    def test_does_nothing_when_already_set(self):
        """Doesn't modify env var when CLAUDE_CODE_OAUTH_TOKEN is already set."""
        existing_token = "sk-ant-oat01-existing-token"
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = existing_token

        ensure_claude_code_oauth_token()

        assert os.environ["CLAUDE_CODE_OAUTH_TOKEN"] == existing_token

    def test_copies_from_anthropic_auth_token(self):
        """Copies ANTHROPIC_AUTH_TOKEN to CLAUDE_CODE_OAUTH_TOKEN."""
        anthropic_token = "sk-ant-oat01-anthropic-token"
        os.environ["ANTHROPIC_AUTH_TOKEN"] = anthropic_token

        ensure_claude_code_oauth_token()

        assert os.environ["CLAUDE_CODE_OAUTH_TOKEN"] == anthropic_token

    def test_does_nothing_when_no_token_available(self, monkeypatch):
        """Doesn't set env var when no auth token is available."""
        monkeypatch.setattr(platform, "system", lambda: "Linux")
        # Ensure keychain returns None
        monkeypatch.setattr("core.auth.get_token_from_keychain", lambda _config_dir=None: None)

        ensure_claude_code_oauth_token()

        assert "CLAUDE_CODE_OAUTH_TOKEN" not in os.environ


class TestTokenSourceDetection:
    """Tests for get_auth_token_source function."""

    @pytest.fixture(autouse=True)
    def clear_env(self):
        """Clear auth environment variables before each test."""
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)
        yield
        # Cleanup after test
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)

    def test_source_env_var_claude_oauth(self):
        """Identifies CLAUDE_CODE_OAUTH_TOKEN as source."""
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "sk-ant-oat01-test-token"

        source = get_auth_token_source()
        assert source == "CLAUDE_CODE_OAUTH_TOKEN"

    def test_source_env_var_anthropic_auth(self):
        """Identifies ANTHROPIC_AUTH_TOKEN as source."""
        os.environ["ANTHROPIC_AUTH_TOKEN"] = "sk-ant-oat01-test-token"

        source = get_auth_token_source()
        assert source == "ANTHROPIC_AUTH_TOKEN"

    def test_source_macos_keychain(self, monkeypatch):
        """Identifies macOS Keychain as source."""
        test_token = "sk-ant-oat01-macos-token"
        credentials = json.dumps({"claudeAiOauth": {"accessToken": test_token}})

        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = credentials

        monkeypatch.setattr(platform, "system", lambda: "Darwin")
        monkeypatch.setattr("subprocess.run", Mock(return_value=mock_result))

        source = get_auth_token_source()
        # Source can be "macOS Keychain" or "macOS Keychain (profile)" depending on profile settings
        assert source is not None and source.startswith("macOS Keychain")

    def test_source_windows_credential_files(self, monkeypatch, tmp_path):
        """Identifies Windows Credential Files as source."""
        test_token = "sk-ant-oat01-windows-token"
        credentials = json.dumps({"claudeAiOauth": {"accessToken": test_token}})

        cred_file = tmp_path / ".credentials.json"
        cred_file.write_text(credentials)

        monkeypatch.setattr(platform, "system", lambda: "Windows")
        monkeypatch.setattr(
            os.path, "expandvars", lambda p: str(cred_file).replace("\\", "/")
        )

        source = get_auth_token_source()
        # Source can have "(profile)" suffix depending on profile settings
        assert source is not None and source.startswith("Windows Credential Files")

    def test_source_linux_secret_service(self, monkeypatch):
        """Identifies Linux Secret Service as source."""
        test_token = "sk-ant-oat01-linux-token"
        credentials = json.dumps({"claudeAiOauth": {"accessToken": test_token}})

        mock_ss = MagicMock()
        mock_ss.exceptions = MagicMock()
        mock_ss.exceptions.SecretServiceNotAvailableException = Exception
        mock_ss.exceptions.SecretStorageException = Exception

        mock_collection = MagicMock()
        mock_collection.is_locked.return_value = False

        mock_item = MagicMock()
        mock_item.get_label.return_value = "Claude Code-credentials"
        mock_item.get_secret.return_value = credentials

        mock_collection.search_items.return_value = [mock_item]
        mock_ss.get_default_collection.return_value = mock_collection

        monkeypatch.setattr(platform, "system", lambda: "Linux")
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        source = get_auth_token_source()
        # Source can have "(profile)" suffix depending on profile settings
        assert source is not None and source.startswith("Linux Secret Service")

    def test_source_none_when_not_found(self, monkeypatch):
        """Returns None when no token source is found."""
        # Mock keychain to return None (env vars already cleared by fixture)
        monkeypatch.setattr("core.auth.get_token_from_keychain", lambda _config_dir=None: None)
        source = get_auth_token_source()
        assert source is None


class TestSdkEnvVars:
    """Tests for get_sdk_env_vars function."""

    def test_returns_non_empty_vars(self, monkeypatch):
        """Only returns non-empty environment variables."""
        monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
        monkeypatch.setenv("ANTHROPIC_MODEL", "")  # Empty, should be excluded
        monkeypatch.setenv("DISABLE_TELEMETRY", "1")

        env = get_sdk_env_vars()

        assert "ANTHROPIC_BASE_URL" in env
        assert env["ANTHROPIC_BASE_URL"] == "https://api.anthropic.com"
        assert "ANTHROPIC_MODEL" not in env  # Empty value excluded
        assert "DISABLE_TELEMETRY" in env
        assert env["DISABLE_TELEMETRY"] == "1"

    def test_includes_claude_git_bash_on_windows(self, monkeypatch):
        """Auto-detects git-bash path on Windows."""
        monkeypatch.setattr(platform, "system", lambda: "Windows")
        monkeypatch.setattr(
            "core.auth._find_git_bash_path",
            lambda: "C:\\Program Files\\Git\\bin\\bash.exe",
        )

        env = get_sdk_env_vars()

        assert "CLAUDE_CODE_GIT_BASH_PATH" in env
        assert "Git\\bin\\bash.exe" in env["CLAUDE_CODE_GIT_BASH_PATH"]

    def test_does_not_include_git_bash_on_non_windows(self, monkeypatch):
        """Doesn't include git-bash path on non-Windows platforms."""
        monkeypatch.setattr(platform, "system", lambda: "Darwin")

        env = get_sdk_env_vars()

        assert "CLAUDE_CODE_GIT_BASH_PATH" not in env

    def test_does_not_overwrite_existing_git_bash_path(self, monkeypatch):
        """Respects existing CLAUDE_CODE_GIT_BASH_PATH environment variable."""
        existing_path = "/custom/bash.exe"
        monkeypatch.setenv("CLAUDE_CODE_GIT_BASH_PATH", existing_path)

        monkeypatch.setattr(platform, "system", lambda: "Windows")

        env = get_sdk_env_vars()

        assert env["CLAUDE_CODE_GIT_BASH_PATH"] == existing_path


class TestTokenDecryption:
    """Tests for token decryption functionality."""

    def test_is_encrypted_token_detects_prefix(self):
        """Verify is_encrypted_token() detects enc: prefix."""
        from core.auth import is_encrypted_token

        assert is_encrypted_token("enc:test123")
        assert is_encrypted_token("enc:djEwtxMGISt3tQ")
        assert not is_encrypted_token("sk-ant-oat01-test")
        assert not is_encrypted_token("")
        assert not is_encrypted_token(None)

    def test_decrypt_token_validates_format(self):
        """Verify decrypt_token() validates token format."""
        from core.auth import decrypt_token

        with pytest.raises(ValueError, match="Invalid encrypted token format"):
            decrypt_token("sk-ant-oat01-test")

    def test_decrypt_token_handles_short_data(self):
        """Verify decrypt_token() rejects short encrypted data."""
        from core.auth import decrypt_token

        with pytest.raises(ValueError, match="too short"):
            decrypt_token("enc:abc")

    def test_get_auth_token_decrypts_encrypted_env_token(self, monkeypatch):
        """Verify get_auth_token() attempts to decrypt encrypted tokens from env."""
        from unittest.mock import patch

        monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "enc:testtoken123456789")
        monkeypatch.setattr("core.auth.get_token_from_keychain", lambda _config_dir=None: None)

        with patch("core.auth.decrypt_token") as mock_decrypt:
            # Simulate decryption failure
            mock_decrypt.side_effect = ValueError("Decryption not implemented")

            from core.auth import get_auth_token

            result = get_auth_token()

            # Verify decrypt_token was called with the encrypted token
            mock_decrypt.assert_called_once_with("enc:testtoken123456789")
            # Verify the encrypted token is returned on decryption failure
            assert result == "enc:testtoken123456789"

    def test_get_auth_token_returns_decrypted_token_on_success(self, monkeypatch):
        """Verify get_auth_token() returns decrypted token when decryption succeeds."""
        from unittest.mock import patch

        encrypted_token = "enc:testtoken123456789"
        decrypted_token = "sk-ant-oat01-decrypted-token"

        monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", encrypted_token)
        monkeypatch.setattr("core.auth.get_token_from_keychain", lambda _config_dir=None: None)

        with patch("core.auth.decrypt_token") as mock_decrypt:
            mock_decrypt.return_value = decrypted_token

            from core.auth import get_auth_token

            result = get_auth_token()

            # Verify decrypt_token was called
            mock_decrypt.assert_called_once_with(encrypted_token)
            # Verify the decrypted token is returned
            assert result == decrypted_token

    def test_backward_compatibility_plaintext_tokens(self, monkeypatch):
        """Verify plaintext tokens continue to work unchanged."""
        token = "sk-ant-oat01-test"
        monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", token)
        monkeypatch.setattr("core.auth.get_token_from_keychain", lambda _config_dir=None: None)

        from core.auth import get_auth_token

        result = get_auth_token()
        assert result == token


class TestTokenDecryptionPlatformRouting:
    """Tests for decrypt_token() platform-specific routing."""

    def test_decrypt_token_routes_to_macos(self, monkeypatch):
        """Verify decrypt_token routes to macOS implementation on Darwin."""
        from unittest.mock import patch

        monkeypatch.setattr("core.auth.is_macos", lambda: True)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)

        with patch("core.auth._decrypt_token_macos") as mock_macos:
            mock_macos.side_effect = NotImplementedError("macOS test")

            from core.auth import decrypt_token

            with pytest.raises(ValueError, match="not yet implemented"):
                decrypt_token("enc:validbase64data")

            mock_macos.assert_called_once_with("validbase64data")

    def test_decrypt_token_routes_to_linux(self, monkeypatch):
        """Verify decrypt_token routes to Linux implementation."""
        from unittest.mock import patch

        monkeypatch.setattr("core.auth.is_macos", lambda: False)
        monkeypatch.setattr("core.auth.is_linux", lambda: True)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)

        with patch("core.auth._decrypt_token_linux") as mock_linux:
            mock_linux.side_effect = NotImplementedError("Linux test")

            from core.auth import decrypt_token

            with pytest.raises(ValueError, match="not yet implemented"):
                decrypt_token("enc:validbase64data")

            mock_linux.assert_called_once_with("validbase64data")

    def test_decrypt_token_routes_to_windows(self, monkeypatch):
        """Verify decrypt_token routes to Windows implementation."""
        from unittest.mock import patch

        monkeypatch.setattr("core.auth.is_macos", lambda: False)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: True)

        with patch("core.auth._decrypt_token_windows") as mock_windows:
            mock_windows.side_effect = NotImplementedError("Windows test")

            from core.auth import decrypt_token

            with pytest.raises(ValueError, match="not yet implemented"):
                decrypt_token("enc:validbase64data")

            mock_windows.assert_called_once_with("validbase64data")

    def test_decrypt_token_unsupported_platform(self, monkeypatch):
        """Verify decrypt_token raises error on unsupported platform."""
        monkeypatch.setattr("core.auth.is_macos", lambda: False)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)

        from core.auth import decrypt_token

        with pytest.raises(ValueError, match="Unsupported platform"):
            decrypt_token("enc:validbase64data")


class TestTokenDecryptionMacOS:
    """Tests for macOS-specific token decryption."""

    def test_macos_decrypt_no_claude_cli(self, monkeypatch):
        """Verify macOS decryption fails when Claude CLI is not found."""
        monkeypatch.setattr("core.auth.is_macos", lambda: True)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)
        # Mock shutil.which to return None (CLI not found)
        monkeypatch.setattr("shutil.which", lambda name: None)

        from core.auth import decrypt_token

        with pytest.raises(ValueError, match="Claude Code CLI not found"):
            decrypt_token("enc:validbase64data")

    def test_macos_decrypt_raises_not_implemented(self, monkeypatch):
        """Verify macOS decryption raises ValueError (wrapping NotImplementedError) with helpful message."""
        monkeypatch.setattr("core.auth.is_macos", lambda: True)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)
        # Mock shutil.which to return a path (CLI found)
        monkeypatch.setattr("shutil.which", lambda name: "/usr/local/bin/claude")

        from core.auth import decrypt_token

        # NotImplementedError is wrapped in ValueError at the decrypt_token level
        with pytest.raises(ValueError) as exc_info:
            decrypt_token("enc:validbase64data")

        error_msg = str(exc_info.value)
        # Should mention alternatives
        assert "setup-token" in error_msg or "plaintext" in error_msg


class TestTokenDecryptionLinux:
    """Tests for Linux-specific token decryption."""

    def test_linux_decrypt_no_secretstorage(self, monkeypatch):
        """Verify Linux decryption fails when secretstorage is not installed."""
        monkeypatch.setattr("core.auth.is_macos", lambda: False)
        monkeypatch.setattr("core.auth.is_linux", lambda: True)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)
        monkeypatch.setattr("core.auth.secretstorage", None)

        from core.auth import decrypt_token

        with pytest.raises(ValueError, match="secretstorage"):
            decrypt_token("enc:validbase64data")

    def test_linux_decrypt_raises_not_implemented(self, monkeypatch):
        """Verify Linux decryption raises NotImplementedError with helpful message."""
        mock_ss = MagicMock()

        monkeypatch.setattr("core.auth.is_macos", lambda: False)
        monkeypatch.setattr("core.auth.is_linux", lambda: True)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)
        monkeypatch.setattr("core.auth.secretstorage", mock_ss)

        from core.auth import decrypt_token

        with pytest.raises(ValueError) as exc_info:
            decrypt_token("enc:validbase64data")

        error_msg = str(exc_info.value)
        # Should mention alternatives
        assert "setup-token" in error_msg or "plaintext" in error_msg


class TestTokenDecryptionWindows:
    """Tests for Windows-specific token decryption."""

    def test_windows_decrypt_raises_not_implemented(self, monkeypatch):
        """Verify Windows decryption raises NotImplementedError with helpful message."""
        monkeypatch.setattr("core.auth.is_macos", lambda: False)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: True)

        from core.auth import decrypt_token

        with pytest.raises(ValueError) as exc_info:
            decrypt_token("enc:validbase64data")

        error_msg = str(exc_info.value)
        # Should mention alternatives
        assert "setup-token" in error_msg or "plaintext" in error_msg


class TestTokenDecryptionErrorHandling:
    """Tests for error handling in token decryption."""

    def test_decrypt_token_invalid_type(self):
        """Verify decrypt_token rejects non-string input."""
        from core.auth import decrypt_token

        with pytest.raises(ValueError, match="Invalid token type"):
            decrypt_token(12345)  # type: ignore

        with pytest.raises(ValueError, match="Invalid token type"):
            decrypt_token(["enc:test"])  # type: ignore

    def test_decrypt_token_empty_after_prefix(self):
        """Verify decrypt_token rejects empty data after prefix."""
        from core.auth import decrypt_token

        with pytest.raises(ValueError, match="Empty encrypted token data"):
            decrypt_token("enc:")

    def test_decrypt_token_invalid_characters(self):
        """Verify decrypt_token rejects invalid base64 characters."""
        from core.auth import decrypt_token

        with pytest.raises(ValueError, match="invalid characters"):
            decrypt_token("enc:test!@#$%^&*()")

    def test_decrypt_token_valid_base64_characters_accepted(self):
        """Verify decrypt_token accepts standard and URL-safe base64 characters."""
        from core.auth import decrypt_token
        from unittest.mock import patch

        # Standard base64 includes +/=
        # URL-safe base64 includes -_
        valid_tokens = [
            "enc:testABCabc123+/=",
            "enc:testABCabc123-_==",
            "enc:abcdefghij",
        ]

        # These should pass character validation but fail at platform-specific
        # decryption (which raises NotImplementedError)
        for token in valid_tokens:
            with patch("core.auth.is_macos", return_value=False):
                with patch("core.auth.is_linux", return_value=False):
                    with patch("core.auth.is_windows", return_value=False):
                        with pytest.raises(ValueError, match="Unsupported platform"):
                            decrypt_token(token)

    def test_decrypt_token_file_not_found_error(self, monkeypatch):
        """Verify decrypt_token handles FileNotFoundError gracefully."""
        from unittest.mock import patch

        monkeypatch.setattr("core.auth.is_macos", lambda: True)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)

        with patch("core.auth._decrypt_token_macos") as mock_macos:
            mock_macos.side_effect = FileNotFoundError("Credentials file not found")

            from core.auth import decrypt_token

            with pytest.raises(ValueError, match="required file not found"):
                decrypt_token("enc:validbase64data")

    def test_decrypt_token_permission_error(self, monkeypatch):
        """Verify decrypt_token handles PermissionError gracefully."""
        from unittest.mock import patch

        monkeypatch.setattr("core.auth.is_macos", lambda: True)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)

        with patch("core.auth._decrypt_token_macos") as mock_macos:
            mock_macos.side_effect = PermissionError("Access denied")

            from core.auth import decrypt_token

            with pytest.raises(ValueError, match="permission denied"):
                decrypt_token("enc:validbase64data")

    def test_decrypt_token_timeout_error(self, monkeypatch):
        """Verify decrypt_token handles subprocess timeout gracefully."""
        import subprocess
        from unittest.mock import patch

        monkeypatch.setattr("core.auth.is_macos", lambda: True)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)

        with patch("core.auth._decrypt_token_macos") as mock_macos:
            mock_macos.side_effect = subprocess.TimeoutExpired("cmd", 5)

            from core.auth import decrypt_token

            with pytest.raises(ValueError, match="timed out"):
                decrypt_token("enc:validbase64data")

    def test_decrypt_token_generic_error(self, monkeypatch):
        """Verify decrypt_token handles unexpected errors gracefully."""
        from unittest.mock import patch

        monkeypatch.setattr("core.auth.is_macos", lambda: True)
        monkeypatch.setattr("core.auth.is_linux", lambda: False)
        monkeypatch.setattr("core.auth.is_windows", lambda: False)

        with patch("core.auth._decrypt_token_macos") as mock_macos:
            mock_macos.side_effect = RuntimeError("Unexpected error")

            from core.auth import decrypt_token

            with pytest.raises(ValueError) as exc_info:
                decrypt_token("enc:validbase64data")

            error_msg = str(exc_info.value)
            assert "RuntimeError" in error_msg
            assert "setup-token" in error_msg


class TestTokenDecryptionKeychain:
    """Tests for encrypted token handling from keychain sources."""

    @pytest.fixture(autouse=True)
    def clear_env(self):
        """Clear auth environment variables before each test."""
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)
        yield
        # Cleanup after test
        for var in AUTH_TOKEN_ENV_VARS:
            os.environ.pop(var, None)

    def test_keychain_encrypted_token_decryption_attempted(self, monkeypatch):
        """Verify encrypted tokens from keychain trigger decryption."""
        from unittest.mock import patch

        encrypted_token = "enc:keychaintoken1234"
        monkeypatch.setattr(
            "core.auth.get_token_from_keychain", lambda _config_dir=None: encrypted_token
        )

        with patch("core.auth.decrypt_token") as mock_decrypt:
            mock_decrypt.side_effect = ValueError("Decryption failed")

            from core.auth import get_auth_token

            result = get_auth_token()

            mock_decrypt.assert_called_once_with(encrypted_token)
            # On failure, encrypted token is returned for client validation
            assert result == encrypted_token

    def test_keychain_encrypted_token_decryption_success(self, monkeypatch):
        """Verify successful decryption of keychain token."""
        from unittest.mock import patch

        encrypted_token = "enc:keychaintoken1234"
        decrypted_token = "sk-ant-oat01-from-keychain"

        monkeypatch.setattr(
            "core.auth.get_token_from_keychain", lambda _config_dir=None: encrypted_token
        )

        with patch("core.auth.decrypt_token") as mock_decrypt:
            mock_decrypt.return_value = decrypted_token

            from core.auth import get_auth_token

            result = get_auth_token()

            mock_decrypt.assert_called_once_with(encrypted_token)
            assert result == decrypted_token

    def test_plaintext_keychain_token_not_decrypted(self, monkeypatch):
        """Verify plaintext tokens from keychain are not passed to decrypt."""
        from unittest.mock import patch

        plaintext_token = "sk-ant-oat01-keychain-plaintext"
        monkeypatch.setattr(
            "core.auth.get_token_from_keychain", lambda _config_dir=None: plaintext_token
        )

        with patch("core.auth.decrypt_token") as mock_decrypt:
            from core.auth import get_auth_token

            result = get_auth_token()

            mock_decrypt.assert_not_called()
            assert result == plaintext_token

    def test_env_var_takes_precedence_over_keychain(self, monkeypatch):
        """Verify environment variable token takes precedence over keychain."""
        env_token = "sk-ant-oat01-from-env"
        keychain_token = "sk-ant-oat01-from-keychain"

        monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", env_token)
        monkeypatch.setattr(
            "core.auth.get_token_from_keychain", lambda _config_dir=None: keychain_token
        )

        from core.auth import get_auth_token

        result = get_auth_token()
        assert result == env_token

    def test_encrypted_env_var_precedence_over_plaintext_keychain(self, monkeypatch):
        """Verify encrypted env var is preferred over plaintext keychain token."""
        from unittest.mock import patch

        encrypted_env = "enc:encryptedfromenv"
        decrypted_env = "sk-ant-oat01-decrypted-env"
        keychain_token = "sk-ant-oat01-from-keychain"

        monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", encrypted_env)
        monkeypatch.setattr(
            "core.auth.get_token_from_keychain", lambda _config_dir=None: keychain_token
        )

        with patch("core.auth.decrypt_token") as mock_decrypt:
            mock_decrypt.return_value = decrypted_env

            from core.auth import get_auth_token

            result = get_auth_token()

            mock_decrypt.assert_called_once_with(encrypted_env)
            assert result == decrypted_env


class TestValidateTokenNotEncrypted:
    """Tests for validate_token_not_encrypted function."""

    def test_validate_token_not_encrypted_raises_for_encrypted(self):
        """Verify validate_token_not_encrypted() raises ValueError for encrypted tokens."""
        from core.auth import validate_token_not_encrypted

        with pytest.raises(ValueError, match="encrypted format"):
            validate_token_not_encrypted("enc:test123456789012")

    def test_validate_token_not_encrypted_raises_with_helpful_message(self):
        """Verify validate_token_not_encrypted() provides helpful error message."""
        from core.auth import validate_token_not_encrypted

        with pytest.raises(ValueError) as exc_info:
            validate_token_not_encrypted("enc:test123456789012")

        error_msg = str(exc_info.value)
        assert "claude setup-token" in error_msg
        assert "CLAUDE_CODE_OAUTH_TOKEN" in error_msg
        assert "plaintext token" in error_msg

    def test_validate_token_not_encrypted_accepts_plaintext(self):
        """Verify validate_token_not_encrypted() accepts plaintext tokens without raising."""
        from core.auth import validate_token_not_encrypted

        # Should not raise for valid plaintext tokens
        validate_token_not_encrypted("sk-ant-oat01-test-token")
        validate_token_not_encrypted("sk-ant-api01-test-token")
        validate_token_not_encrypted("any-other-plaintext-token")

    def test_validate_token_not_encrypted_accepts_empty_prefix(self):
        """Verify validate_token_not_encrypted() accepts tokens without enc: prefix."""
        from core.auth import validate_token_not_encrypted

        # Token that starts with 'enc' but not 'enc:' should be accepted
        validate_token_not_encrypted("encrypted-looking-but-not")
        validate_token_not_encrypted("enctest")

# Token Encryption Investigation

## Issue Summary

Jerry users are experiencing API 401 errors ("Invalid bearer token") because the Python backend is passing encrypted tokens (with `enc:` prefix) directly to the Claude Agent SDK without decryption. Standalone Claude Code terminals work correctly because they decrypt these tokens before use.

**Key insight from user thehaffk:** "python cant unencrypt claude token and it launches session with CLAUDE_CODE_OAUTH_TOKEN=enc:djEwtxMGISt3tQ..."

## Token Storage Format

### Encrypted Token Format

Claude Code CLI stores OAuth tokens in an encrypted format with the prefix `enc:`:

```text
enc:djEwtxMGISt3tQ...
```

This format is used when tokens are stored in:
- **macOS**: Keychain (service: "Claude Code-credentials")
- **Linux**: Secret Service API (DBus, via secretstorage library)
- **Windows**: Credential Manager / .credentials.json files

### Decrypted Token Format

Valid Claude OAuth tokens have the format:
```text
sk-ant-oat01-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

## Current Token Flow (BROKEN)

1. **Token Storage**: Claude Code CLI stores encrypted token with `enc:` prefix in system keychain
2. **Token Retrieval**: `apps/backend/core/auth.py::get_auth_token()` retrieves token from:
   - Environment variable `CLAUDE_CODE_OAUTH_TOKEN`
   - OR system keychain via `get_token_from_keychain()`
3. **❌ NO DECRYPTION**: Token is returned as-is with `enc:` prefix intact
4. **SDK Initialization**: Encrypted token passed to Claude Agent SDK
5. **API Call Fails**: SDK sends encrypted token to API → 401 error

### Proof of Broken Flow

Test in `apps/backend`:
```python
import os
os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = 'enc:test123'

from core.auth import get_auth_token
token = get_auth_token()
print(f"Token: {token}")  # Output: "enc:test123"
print(f"Encrypted: {token.startswith('enc:')}")  # Output: True
```

## How Standalone Claude Code CLI Handles Tokens

### Current Understanding

1. **Token Detection**: CLI checks if token starts with `enc:` prefix
2. **Decryption**: If encrypted, CLI decrypts using platform-specific keyring access
3. **Authentication**: Decrypted `sk-ant-oat01-` token is used for API calls

### Missing Documentation

Web search for "Claude Code CLI encrypted token enc: prefix decryption" found:
- Token storage formats (JSON with accessToken, refreshToken, expiresAt)
- Security issues (tokens exposed in debug logs before v2.1.0)
- Keychain access patterns for macOS/Linux/Windows

**❌ NOT FOUND**: Specific documentation on how Claude Code CLI decrypts `enc:` tokens

Sources:
- [Claude Code CLI over SSH on macOS: Fixing Keychain Access](https://phoenixtrap.com/2025/10/26/claude-code-cli-over-ssh-on-macos-fixing-keychain-access/)
- [Identity and Access Management - Claude Code Docs](https://code.claude.com/docs/en/iam)
- [Claude Code sessions should be encrypted | yoav.blog](https://yoav.blog/2026/01/09/claude-code-sessions-should-be-encrypted/)

## Decryption Approach Options

### Option 1: Claude Agent SDK Built-in Decryption

**Status**: NEEDS VERIFICATION

The Claude Agent SDK (`claude-agent-sdk>=0.1.19`) may handle decryption internally if:
- Token is passed to SDK still encrypted
- SDK detects `enc:` prefix
- SDK has access to system keyring for decryption

**Action Required**: Check if SDK has decryption capabilities by examining:
- SDK source code or documentation
- Whether SDK expects encrypted vs decrypted tokens
- If SDK requires specific environment variables for decryption

### Option 2: Python Backend Decryption (Recommended)

**Approach**: Implement decryption in `apps/backend/core/auth.py` before passing to SDK

**Implementation Pattern**:
```python
def get_auth_token() -> str | None:
    """Get authentication token (decrypted if necessary)."""
    token = _retrieve_token_from_sources()  # From env or keychain

    if token and token.startswith("enc:"):
        # Decrypt the token
        token = decrypt_token(token)

    return token

def decrypt_token(encrypted_token: str) -> str:
    """
    Decrypt Claude Code encrypted token.

    Args:
        encrypted_token: Token with 'enc:' prefix

    Returns:
        Decrypted token in format 'sk-ant-oat01-...'
    """
    # Remove 'enc:' prefix
    encrypted_data = encrypted_token[4:]

    # TODO: Implement decryption logic
    # Questions to answer:
    # 1. What encryption algorithm does Claude Code use?
    # 2. Where is the decryption key stored?
    # 3. Is the decryption key platform-specific (per-user)?
    # 4. Can we reuse Claude Code's decryption mechanism?

    raise NotImplementedError("Token decryption not yet implemented")
```

### Option 3: Call Claude Code CLI for Decryption

**Approach**: Use the Claude Code CLI binary to decrypt tokens

```python
def decrypt_token(encrypted_token: str) -> str:
    """Decrypt token by invoking Claude Code CLI."""
    # Find claude binary
    claude_path = shutil.which("claude") or "~/.local/bin/claude"

    # Use CLI command to get decrypted token
    # (if such a command exists - needs research)
    result = subprocess.run(
        [claude_path, "auth", "decrypt", encrypted_token],
        capture_output=True,
        text=True
    )

    return result.stdout.strip()
```

**Issues**:
- Requires Claude Code CLI to be installed
- No documented CLI command for token decryption
- Adds external dependency

## Required Investigation Steps

### 1. Verify SDK Decryption Capabilities

**Task**: Check if `claude-agent-sdk` handles `enc:` tokens automatically

**Method**:
```bash
# In environment with SDK installed
python3 << 'EOF'
import os
os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = 'enc:...'  # Real encrypted token

from claude_agent_sdk import Client
# Try creating client - does it decrypt internally?
client = Client()
# Check if authentication works
EOF
```

### 2. Reverse Engineer Claude Code CLI Decryption

**Task**: Understand how Claude CLI decrypts tokens

**Method**:
- Examine Claude CLI binary (if possible)
- Trace system calls when CLI runs (strace on Linux, dtruss on macOS)
- Check if CLI accesses specific keychain entries for decryption keys
- Look for encryption/decryption libraries used by CLI

### 3. Find Decryption Key Storage

**Task**: Locate where decryption keys are stored

**Hypothesis**: Decryption key stored in:
- macOS: Keychain (separate entry from encrypted token)
- Linux: Secret Service API
- Windows: Credential Manager

**Verification**:
```bash
# macOS: List all keychain entries
security find-generic-password -a "$(whoami)" | grep -i claude

# Linux: Use secretstorage to list all items
python3 -c "import secretstorage; ..."
```

## Recommended Decryption Approach for Python Backend

Based on investigation so far, the recommended approach is:

1. **Detect encrypted tokens**: Check for `enc:` prefix in `get_auth_token()`
2. **Decrypt before use**: Implement `decrypt_token()` function
3. **Platform-specific decryption**: Use appropriate keyring library:
   - macOS: Use `subprocess` with `/usr/bin/security` to access decryption key
   - Linux: Use `secretstorage` library to access Secret Service API
   - Windows: Access Credential Manager or credentials.json
4. **Backward compatibility**: Support both encrypted and plaintext tokens
5. **Error handling**: Provide clear error messages if decryption fails

## Complete Token Flow Trace (Frontend → Backend)

### 1. Token Retrieval (Frontend)

**File**: `apps/frontend/src/main/services/profile-service.ts`

The frontend retrieves the OAuth token from the system keychain but **does not decrypt it**. When no API profile is active (OAuth mode), the frontend returns an empty environment object, which means it relies on:
- The token already being in the environment as `CLAUDE_CODE_OAUTH_TOKEN`
- OR the Python backend retrieving it from the keychain

**Key Code**:
```typescript
// Line 223: Returns empty object in OAuth mode, allowing
// CLAUDE_CODE_OAUTH_TOKEN to be used from system keychain
```

### 2. Environment Variable Passing (Frontend → PTY)

**File**: `apps/frontend/src/main/terminal/pty-manager.ts`

The PTY manager spawns the terminal shell with environment variables, including `CLAUDE_CODE_OAUTH_TOKEN`:

**Key Code** (Lines 149-152):
```typescript
// Remove ANTHROPIC_API_KEY to ensure Claude Code uses OAuth tokens
// (CLAUDE_CODE_OAUTH_TOKEN from profileEnv) instead of API keys
const { DEBUG: _DEBUG, ANTHROPIC_API_KEY: _ANTHROPIC_API_KEY, ...cleanEnv } = process.env;
```

**Important**: The frontend passes through whatever token value exists in the environment - it does NOT check for `enc:` prefix or decrypt it.

### 3. Token Retrieval (Backend)

**File**: `apps/backend/core/auth.py`

#### 3.1. get_auth_token()

This function retrieves the token from multiple sources:

```python
def get_auth_token() -> str | None:
    # First check environment variables
    for var in AUTH_TOKEN_ENV_VARS:  # CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_AUTH_TOKEN
        token = os.environ.get(var)
        if token:
            return token  # ❌ Returns immediately without checking for enc: prefix

    # Fallback to system credential store
    return get_token_from_keychain()  # ❌ Also returns without decryption
```

**Issue**: Returns token as-is with `enc:` prefix intact.

#### 3.2. require_auth_token()

This function calls `get_auth_token()` and raises an error if no token is found:

```python
def require_auth_token() -> str:
    token = get_auth_token()  # ❌ Gets encrypted token
    if not token:
        raise ValueError("No OAuth token found...")
    return token  # ❌ Returns encrypted token
```

**Issue**: No decryption step between retrieval and return.

#### 3.3. ensure_claude_code_oauth_token()

This function ensures the environment variable is set:

```python
def ensure_claude_code_oauth_token() -> None:
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return

    token = get_auth_token()  # ❌ Gets encrypted token
    if token:
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token  # ❌ Sets encrypted token
```

**Issue**: Propagates encrypted token to environment variable.

### 4. Token Usage in SDK Client Creation (Backend)

#### 4.1. Full Client Creation

**File**: `apps/backend/core/client.py` (see `create_client()` function)

```python
def create_client(...):
    oauth_token = require_auth_token()  # ❌ Gets encrypted token
    # Ensure SDK can access it via its expected env var
    os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = oauth_token  # ❌ Sets encrypted token
```

**Issue**: Encrypted token is passed to the Claude Agent SDK, which expects a decrypted `sk-ant-oat01-` token.

#### 4.2. Simple Client Creation

**File**: `apps/backend/core/simple_client.py` (see `create_simple_client()` function)

```python
def create_simple_client(...):
    # Get authentication
    oauth_token = require_auth_token()  # ❌ Gets encrypted token
    import os
    os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = oauth_token  # ❌ Sets encrypted token
```

**Issue**: Same problem - encrypted token passed to SDK.

#### 4.3. Other Usages

**Files**:
- `apps/backend/core/workspace.py` (Line 1966) - AI merge operations
- `apps/backend/runners/insights_runner.py` - Insights analysis
- `apps/backend/runners/github/batch_issues.py` - GitHub batch operations
- `apps/backend/integrations/linear/updater.py` - Linear integration
- `apps/backend/commit_message.py` - Commit message generation
- `apps/backend/analysis/insight_extractor.py` - Code insights
- `apps/backend/merge/ai_resolver/claude_client.py` - Merge resolution

**All follow the same pattern**: Call `ensure_claude_code_oauth_token()` → encrypted token in environment → SDK receives encrypted token → API 401 error.

### 5. Where Decryption Should Be Inserted

Based on the flow analysis, decryption should be added at **the earliest point of token retrieval** to avoid duplicating decryption logic:

**RECOMMENDED INSERTION POINT**: `apps/backend/core/auth.py::get_auth_token()`

```python
def get_auth_token() -> str | None:
    # First check environment variables
    for var in AUTH_TOKEN_ENV_VARS:
        token = os.environ.get(var)
        if token:
            # ✅ INSERT DECRYPTION HERE
            if token.startswith("enc:"):
                token = decrypt_token(token)
            return token

    # Fallback to system credential store
    token = get_token_from_keychain()
    # ✅ ALSO DECRYPT KEYCHAIN TOKENS
    if token and token.startswith("enc:"):
        token = decrypt_token(token)
    return token
```

**Benefits of this approach**:
1. Single location for decryption logic
2. All downstream functions automatically get decrypted tokens
3. Backward compatible (plaintext tokens pass through unchanged)
4. Consistent behavior across all token sources (env vars and keychain)

**Alternative insertion points** (NOT recommended):
- `require_auth_token()` - Would need similar logic in `get_auth_token()` for non-required usage
- `create_client()` - Would need duplication in `create_simple_client()` and all other clients
- `ensure_claude_code_oauth_token()` - Would miss direct `get_auth_token()` calls

## Next Steps

1. ✅ Document current token flow and identify issue (THIS FILE - COMPLETED)
2. ✅ Trace token flow from frontend to backend (THIS FILE - COMPLETED)
3. ✅ Identify where decryption should be inserted (THIS FILE - COMPLETED)
4. ⏳ Verify if Claude Agent SDK handles decryption internally
5. ⏳ Reverse engineer or document Claude Code CLI decryption mechanism
6. ⏳ Implement `decrypt_token()` function in `apps/backend/core/auth.py`
7. ⏳ Add encryption detection and auto-decryption to `get_auth_token()`
8. ⏳ Test with real encrypted tokens on macOS and Linux
9. ⏳ Add comprehensive error handling for decryption failures

## Open Questions

1. **What encryption algorithm does Claude Code use for `enc:` tokens?**
   - Possible: AES-256, ChaCha20, or similar
   - Key derivation method?

2. **Where is the decryption key stored?**
   - Same keychain entry as encrypted token?
   - Separate keychain entry?
   - Derived from system/user credentials?

3. **Does Claude Agent SDK expect encrypted or decrypted tokens?**
   - If it expects decrypted: we must decrypt before passing
   - If it handles encryption: we may be missing SDK configuration

4. **Is there a Claude Code CLI command to decrypt tokens?**
   - `claude auth decrypt <token>`?
   - `claude auth get-token`?
   - No documented command found in research

5. **Can we reuse Claude Code's decryption mechanism?**
   - Import decryption functions from CLI?
   - Call CLI as subprocess?
   - Implement decryption ourselves?

## References

- Issue: [GitHub #1223: API Error 401](https://github.com/AndyMik90/Auto-Claude/issues/1223)
- Current auth implementation: `apps/backend/core/auth.py`
- SDK client initialization: `apps/backend/core/client.py`
- Requirements: `apps/backend/requirements.txt` (includes `secretstorage>=3.3.3` for Linux)

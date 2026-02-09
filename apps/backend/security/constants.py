"""
Security Constants
==================

Shared constants for the security module.
"""

# Environment variable name for the project directory
# Set by agents (coder.py, loop.py) at startup to ensure security hooks
# can find the correct project directory even in worktree mode.
PROJECT_DIR_ENV_VAR = "AC_JERRY_PROJECT_DIR"

# Security configuration filenames
# These are the files that control which commands are allowed to run.
ALLOWLIST_FILENAME = ".ac-jerry-allowlist"
PROFILE_FILENAME = ".ac-jerry-security.json"

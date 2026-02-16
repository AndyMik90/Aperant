#!/usr/bin/env python3
"""
Fast Mode Diagnostic Test
=========================

Tests different approaches to enable fast mode when using the Claude Agent SDK.

The Claude Code CLI supports fast mode via:
  - `/fast` toggle in interactive mode
  - `"fastMode": true` in user settings (~/.claude/settings.json)

The challenge: The Agent SDK passes `--setting-sources ""` by default,
which disables loading of user/project/local settings. This means even
if fastMode is in ~/.claude/settings.json, the CLI subprocess won't read it.

This script tests different invocation methods to find one that works:
  1. --settings file with fastMode (current approach)
  2. --setting-sources user (load user settings where fastMode lives)
  3. --setting-sources user,project + project .claude/settings.json
  4. CLAUDE_CONFIG_DIR/settings.json with setting-sources user
  5. Direct CLI invocation with various flags

Usage:
    cd apps/backend
    .venv/bin/python ../../tests/test_fast_mode_invocations.py

Requirements:
    - Claude Code CLI installed
    - Active Claude subscription with extra usage enabled
    - Opus 4.6 model access
"""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_extra_usage(token: str | None = None) -> dict | None:
    """Fetch current extra_usage from the Anthropic OAuth usage API."""
    try:
        import urllib.request
        import urllib.error

        # If no token provided, try to get from Claude CLI credentials
        if not token:
            token = _get_oauth_token()
        if not token:
            print("  [SKIP] No OAuth token available")
            return None

        req = urllib.request.Request(
            "https://api.anthropic.com/api/oauth/usage",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            return data.get("extra_usage")
    except Exception as e:
        print(f"  [ERROR] Failed to fetch usage: {e}")
        return None


def _get_oauth_token() -> str | None:
    """Try to get OAuth token from Claude CLI keychain."""
    try:
        # Use the claude CLI to check auth status
        result = subprocess.run(
            ["claude", "--version"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return None

        # Try reading from the default profile's credential store
        # Check common profile directories
        config_dir = os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude"))
        cred_file = Path(config_dir) / "credentials.json"
        if cred_file.exists():
            creds = json.loads(cred_file.read_text())
            return creds.get("token") or creds.get("oauthToken")

        return None
    except Exception:
        return None


def run_claude_cli(extra_args: list[str], env_overrides: dict | None = None,
                   label: str = "test") -> tuple[int, str, str]:
    """Run claude CLI with -p flag and capture output."""
    cmd = [
        "claude", "-p",
        "Reply with exactly: HELLO_FAST_TEST",
        "--model", "claude-opus-4-6",
        "--max-budget-usd", "0.50",
        *extra_args,
    ]

    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)

    print(f"  CMD: {' '.join(cmd)}")
    if env_overrides:
        for k, v in env_overrides.items():
            print(f"  ENV: {k}={v}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
            cwd=str(Path.home()),  # Use home dir to avoid project settings
        )
        return result.returncode, result.stdout[:500], result.stderr[:1000]
    except subprocess.TimeoutExpired:
        return -1, "", "TIMEOUT"
    except Exception as e:
        return -1, "", str(e)


def check_usage_delta(before: dict | None, after: dict | None) -> str:
    """Compare extra_usage before and after a test."""
    if not before or not after:
        return "UNKNOWN (couldn't fetch usage)"

    before_credits = before.get("used_credits") or 0
    after_credits = after.get("used_credits") or 0
    delta = after_credits - before_credits

    if delta > 0:
        return f"EXTRA USAGE INCREASED by ${delta:.2f} (${before_credits:.2f} -> ${after_credits:.2f}) — FAST MODE IS WORKING"
    else:
        return f"NO CHANGE in extra usage (${before_credits:.2f} -> ${after_credits:.2f}) — fast mode NOT active"


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

def test_1_settings_file_with_fast_mode():
    """Test: Pass fastMode via --settings JSON file."""
    print("\n" + "=" * 70)
    print("TEST 1: --settings file with fastMode=true")
    print("=" * 70)
    print("  Strategy: Write fastMode to a temp settings.json, pass via --settings")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump({"fastMode": True}, f)
        settings_path = f.name

    try:
        usage_before = get_extra_usage()
        returncode, stdout, stderr = run_claude_cli(
            ["--settings", settings_path],
            label="settings-file",
        )
        # Small delay for usage to propagate
        time.sleep(3)
        usage_after = get_extra_usage()

        print(f"  Exit code: {returncode}")
        print(f"  Output: {stdout[:200]}")
        if "error" in stderr.lower() or "fast" in stderr.lower():
            print(f"  Stderr (relevant): {stderr[:300]}")
        print(f"  Result: {check_usage_delta(usage_before, usage_after)}")
    finally:
        os.unlink(settings_path)


def test_2_settings_json_inline():
    """Test: Pass fastMode via --settings inline JSON string."""
    print("\n" + "=" * 70)
    print("TEST 2: --settings inline JSON with fastMode=true")
    print("=" * 70)
    print("  Strategy: Pass JSON string directly to --settings")

    usage_before = get_extra_usage()
    returncode, stdout, stderr = run_claude_cli(
        ["--settings", '{"fastMode": true}'],
        label="settings-inline",
    )
    time.sleep(3)
    usage_after = get_extra_usage()

    print(f"  Exit code: {returncode}")
    print(f"  Output: {stdout[:200]}")
    if "error" in stderr.lower() or "fast" in stderr.lower():
        print(f"  Stderr (relevant): {stderr[:300]}")
    print(f"  Result: {check_usage_delta(usage_before, usage_after)}")


def test_3_setting_sources_user():
    """Test: Enable user setting sources so CLI reads ~/.claude/settings.json."""
    print("\n" + "=" * 70)
    print("TEST 3: --setting-sources user (loads ~/.claude/settings.json)")
    print("=" * 70)
    print("  Strategy: Tell CLI to load user settings (where /fast toggle saves)")
    print("  NOTE: Requires fastMode=true in ~/.claude/settings.json")

    # Check if fastMode is in user settings
    user_settings_path = Path.home() / ".claude" / "settings.json"
    has_fast_mode = False
    if user_settings_path.exists():
        try:
            settings = json.loads(user_settings_path.read_text())
            has_fast_mode = settings.get("fastMode", False)
            print(f"  ~/.claude/settings.json fastMode: {has_fast_mode}")
        except Exception:
            print(f"  Could not read {user_settings_path}")

    if not has_fast_mode:
        print("  [ACTION NEEDED] fastMode not in user settings.")
        print("  Run `/fast` in Claude Code CLI first, then re-run this test.")
        print("  Or manually add '\"fastMode\": true' to ~/.claude/settings.json")
        print("  SKIPPING (won't produce meaningful result)")
        return

    usage_before = get_extra_usage()
    returncode, stdout, stderr = run_claude_cli(
        ["--setting-sources", "user"],
        label="setting-sources-user",
    )
    time.sleep(3)
    usage_after = get_extra_usage()

    print(f"  Exit code: {returncode}")
    print(f"  Output: {stdout[:200]}")
    if "error" in stderr.lower() or "fast" in stderr.lower():
        print(f"  Stderr (relevant): {stderr[:300]}")
    print(f"  Result: {check_usage_delta(usage_before, usage_after)}")


def test_4_settings_file_plus_setting_sources():
    """Test: --settings with fastMode + --setting-sources user."""
    print("\n" + "=" * 70)
    print("TEST 4: --settings fastMode + --setting-sources user")
    print("=" * 70)
    print("  Strategy: Both --settings with fastMode AND enable user sources")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump({"fastMode": True}, f)
        settings_path = f.name

    try:
        usage_before = get_extra_usage()
        returncode, stdout, stderr = run_claude_cli(
            ["--settings", settings_path, "--setting-sources", "user"],
            label="settings-plus-sources",
        )
        time.sleep(3)
        usage_after = get_extra_usage()

        print(f"  Exit code: {returncode}")
        print(f"  Output: {stdout[:200]}")
        if "error" in stderr.lower() or "fast" in stderr.lower():
            print(f"  Stderr (relevant): {stderr[:300]}")
        print(f"  Result: {check_usage_delta(usage_before, usage_after)}")
    finally:
        os.unlink(settings_path)


def test_5_project_settings():
    """Test: Write fastMode to project .claude/settings.json + setting-sources project."""
    print("\n" + "=" * 70)
    print("TEST 5: Project .claude/settings.json with fastMode=true")
    print("=" * 70)
    print("  Strategy: Create project settings in temp dir with fastMode")

    # Create a temp project dir with .claude/settings.json
    with tempfile.TemporaryDirectory() as tmpdir:
        claude_dir = Path(tmpdir) / ".claude"
        claude_dir.mkdir()
        settings_file = claude_dir / "settings.json"
        settings_file.write_text(json.dumps({"fastMode": True}))
        print(f"  Project dir: {tmpdir}")
        print(f"  Settings: {settings_file}")

        cmd = [
            "claude", "-p",
            "Reply with exactly: HELLO_FAST_TEST",
            "--model", "claude-opus-4-6",
            "--max-budget-usd", "0.50",
            "--setting-sources", "project",
            "--dangerously-skip-permissions",
        ]

        print(f"  CMD: {' '.join(cmd)}")

        usage_before = get_extra_usage()
        try:
            result = subprocess.run(
                cmd,
                capture_output=True, text=True, timeout=120,
                cwd=tmpdir,  # Run from the temp project dir
            )
            returncode, stdout, stderr = result.returncode, result.stdout[:500], result.stderr[:1000]
        except Exception as e:
            returncode, stdout, stderr = -1, "", str(e)

        time.sleep(3)
        usage_after = get_extra_usage()

        print(f"  Exit code: {returncode}")
        print(f"  Output: {stdout[:200]}")
        if "error" in stderr.lower() or "fast" in stderr.lower():
            print(f"  Stderr (relevant): {stderr[:300]}")
        print(f"  Result: {check_usage_delta(usage_before, usage_after)}")


def test_6_config_dir_settings():
    """Test: Write fastMode to CLAUDE_CONFIG_DIR/settings.json."""
    print("\n" + "=" * 70)
    print("TEST 6: CLAUDE_CONFIG_DIR/settings.json with fastMode=true")
    print("=" * 70)
    print("  Strategy: Create temp config dir with fastMode in settings.json")

    with tempfile.TemporaryDirectory() as config_dir:
        settings_file = Path(config_dir) / "settings.json"
        settings_file.write_text(json.dumps({"fastMode": True}))
        print(f"  Config dir: {config_dir}")

        usage_before = get_extra_usage()
        returncode, stdout, stderr = run_claude_cli(
            ["--setting-sources", "user"],
            env_overrides={"CLAUDE_CONFIG_DIR": config_dir},
            label="config-dir-settings",
        )
        time.sleep(3)
        usage_after = get_extra_usage()

        print(f"  Exit code: {returncode}")
        print(f"  Output: {stdout[:200]}")
        if "error" in stderr.lower() or "fast" in stderr.lower():
            print(f"  Stderr (relevant): {stderr[:300]}")
        print(f"  Result: {check_usage_delta(usage_before, usage_after)}")


def test_7_env_var():
    """Test: CLAUDE_CODE_FAST_MODE env var (known not to work, baseline)."""
    print("\n" + "=" * 70)
    print("TEST 7: CLAUDE_CODE_FAST_MODE=true env var (control/baseline)")
    print("=" * 70)
    print("  Strategy: Pass env var (expected NOT to work)")

    usage_before = get_extra_usage()
    returncode, stdout, stderr = run_claude_cli(
        [],
        env_overrides={"CLAUDE_CODE_FAST_MODE": "true"},
        label="env-var",
    )
    time.sleep(3)
    usage_after = get_extra_usage()

    print(f"  Exit code: {returncode}")
    print(f"  Output: {stdout[:200]}")
    print(f"  Result: {check_usage_delta(usage_before, usage_after)}")


def test_0_check_where_fast_saves():
    """Discovery: Check where /fast toggle saves its state."""
    print("\n" + "=" * 70)
    print("TEST 0: DISCOVERY — Where does /fast save its setting?")
    print("=" * 70)

    locations = [
        Path.home() / ".claude" / "settings.json",
        Path.home() / ".claude" / "settings.local.json",
        Path.home() / ".claude" / "preferences.json",
        Path.home() / ".claude" / "config.json",
        Path.home() / ".claude" / "state.json",
    ]

    # Also check CLAUDE_CONFIG_DIR if set
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    if config_dir:
        config_path = Path(config_dir)
        locations.extend([
            config_path / "settings.json",
            config_path / "settings.local.json",
            config_path / "config.json",
        ])

    # Check all profile dirs
    profiles_dir = Path.home() / ".claude-profiles"
    if profiles_dir.exists():
        for profile_dir in profiles_dir.iterdir():
            if profile_dir.is_dir():
                locations.extend([
                    profile_dir / "settings.json",
                    profile_dir / "settings.local.json",
                    profile_dir / "config.json",
                ])

    print("\n  Scanning for 'fast' references in Claude config files:\n")
    found_any = False
    for loc in locations:
        if loc.exists():
            try:
                content = loc.read_text()
                if "fast" in content.lower():
                    found_any = True
                    print(f"  FOUND in {loc}:")
                    # Parse and show just the relevant part
                    try:
                        data = json.loads(content)
                        for key, value in data.items():
                            if "fast" in key.lower():
                                print(f"    {key}: {value}")
                    except json.JSONDecodeError:
                        # Show lines containing "fast"
                        for line in content.split("\n"):
                            if "fast" in line.lower():
                                print(f"    {line.strip()}")
                else:
                    print(f"  {loc}: exists, no 'fast' references")
            except Exception as e:
                print(f"  {loc}: error reading: {e}")
        else:
            pass  # Skip non-existent files silently

    if not found_any:
        print("\n  No 'fast' references found in any config files.")
        print("  Try running `/fast` in the Claude Code CLI first,")
        print("  then re-run this test to see where it saves.")

    # Also scan ~/.claude/ for any files we missed
    claude_dir = Path.home() / ".claude"
    if claude_dir.exists():
        print(f"\n  All files in {claude_dir}:")
        for item in sorted(claude_dir.iterdir()):
            if item.is_file():
                size = item.stat().st_size
                print(f"    {item.name} ({size} bytes)")
                if item.suffix == ".json" and size < 50000:
                    try:
                        content = item.read_text()
                        if "fast" in content.lower():
                            print(f"      ^ CONTAINS 'fast' reference!")
                    except Exception:
                        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 70)
    print("FAST MODE DIAGNOSTIC TEST")
    print("=" * 70)
    print(f"Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Claude CLI: ", end="")
    sys.stdout.flush()

    try:
        result = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=5)
        print(result.stdout.strip())
    except Exception as e:
        print(f"ERROR: {e}")
        print("Claude CLI not found! Install it first.")
        sys.exit(1)

    # Initial usage check
    print("\nInitial extra_usage:")
    usage = get_extra_usage()
    if usage:
        print(f"  enabled: {usage.get('is_enabled')}")
        print(f"  used_credits: ${usage.get('used_credits', 0):.2f}")
        print(f"  monthly_limit: ${usage.get('monthly_limit', 0)}")
    else:
        print("  Could not fetch (tests will show UNKNOWN results)")

    # Run discovery first
    test_0_check_where_fast_saves()

    # Ask user which tests to run
    print("\n" + "=" * 70)
    print("AVAILABLE TESTS:")
    print("=" * 70)
    print("  1. --settings file with fastMode=true")
    print("  2. --settings inline JSON with fastMode=true")
    print("  3. --setting-sources user (requires fastMode in ~/.claude/settings.json)")
    print("  4. --settings fastMode + --setting-sources user")
    print("  5. Project .claude/settings.json with --setting-sources project")
    print("  6. CLAUDE_CONFIG_DIR/settings.json with --setting-sources user")
    print("  7. CLAUDE_CODE_FAST_MODE env var (control/baseline)")
    print("  a. Run ALL tests")
    print("  q. Quit")

    tests = {
        "1": test_1_settings_file_with_fast_mode,
        "2": test_2_settings_json_inline,
        "3": test_3_setting_sources_user,
        "4": test_4_settings_file_plus_setting_sources,
        "5": test_5_project_settings,
        "6": test_6_config_dir_settings,
        "7": test_7_env_var,
    }

    while True:
        choice = input("\nRun which test(s)? [1-7, a=all, q=quit]: ").strip().lower()
        if choice == "q":
            break
        elif choice == "a":
            for test_fn in tests.values():
                test_fn()
            break
        elif choice in tests:
            tests[choice]()
        else:
            print(f"Invalid choice: {choice}")

    print("\n" + "=" * 70)
    print("DONE")
    print("=" * 70)


if __name__ == "__main__":
    main()

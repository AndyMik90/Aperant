# Security Commands Configuration

AC Jerry uses a dynamic security system that controls which shell commands the AI agent can execute. This prevents potentially dangerous operations while allowing legitimate development commands.

## How It Works

```text
┌─────────────────────────────────────────────────────────────┐
│                    Command Validation                        │
├─────────────────────────────────────────────────────────────┤
│  1. Base Commands (always allowed)                          │
│     └── ls, cat, grep, git, echo, etc.                      │
│                                                              │
│  2. Auto-Detected Stack Commands                            │
│     └── Analyzer detects Cargo.toml → adds cargo, rustc     │
│     └── Analyzer detects package.json → adds npm, node      │
│                                                              │
│  3. Custom Allowlist (manual additions)                     │
│     └── .ac-jerry-allowlist file                         │
└─────────────────────────────────────────────────────────────┘
```

## Automatic Detection

When you start a task, AC Jerry analyzes your project and automatically allows commands based on detected technologies:

| Detected File | Commands Added |
|---------------|----------------|
| `Cargo.toml` | `cargo`, `rustc`, `rustup`, `rustfmt`, `cargo-clippy`, etc. |
| `package.json` | `npm`, `node`, `npx` |
| `yarn.lock` | `yarn` |
| `pnpm-lock.yaml` | `pnpm` |
| `pyproject.toml` | `python`, `pip`, `poetry`, `uv` |
| `go.mod` | `go` |
| `*.csproj` / `*.sln` | `dotnet` |
| `pubspec.yaml` | `dart`, `flutter`, `pub` |
| `Dockerfile` | `docker` |
| `docker-compose.yml` | `docker-compose` |
| `Makefile` | `make` |

The full detection logic is in `apps/backend/project/stack_detector.py`.

### Generated Profile

The analyzer saves its results to `.ac-jerry-security.json` in your project root:

```json
{
  "base_commands": ["ls", "cat", "grep", "..."],
  "stack_commands": ["cargo", "rustc", "rustup"],
  "detected_stack": {
    "languages": ["rust"],
    "package_managers": ["cargo"],
    "frameworks": [],
    "databases": []
  },
  "project_hash": "abc123...",
  "created_at": "2024-01-15T10:30:00"
}
```

This file is auto-generated. Don't edit it manually - it will be overwritten.

## Custom Allowlist

For commands that aren't auto-detected, create a `.ac-jerry-allowlist` file in your project root:

```text
# .ac-jerry-allowlist
# One command per line, no comments on same line

# Custom build tools
bazel
buck

# Project-specific scripts
./scripts/deploy.sh

# Additional tools
ansible
terraform
```

### When to Use the Allowlist

Use `.ac-jerry-allowlist` when:

- Your project uses uncommon build tools (Bazel, Buck, Pants, etc.)
- You have custom scripts that need to be executable
- Auto-detection doesn't recognize your stack
- You're using bleeding-edge tools not yet in the detection system

### Format

- One command per line
- Lines starting with `#` are ignored
- Empty lines are ignored
- Use the base command name only (e.g., `cargo`, not `cargo build`)

## Troubleshooting

### "Command X is not allowed"

1. **Check if it should be auto-detected:**
   - Does your project have the expected config file? (e.g., `Cargo.toml` for Rust)
   - Run in project root, not a subdirectory

2. **Add to allowlist:**

   ```bash
   echo "your-command" >> .ac-jerry-allowlist
   ```

3. **Force re-analysis** (if detection seems wrong):
   - Delete `.ac-jerry-security.json`
   - Restart the task

### Allowlist Changes Not Taking Effect

The security profile cache updates automatically when:
- `.ac-jerry-allowlist` is modified (mtime changes)
- `.ac-jerry-security.json` is modified

No restart required - changes apply on the next command.

### Worktree Mode

When using isolated worktrees, security files are automatically copied from your main project on each worktree setup.

**Important:** Unlike environment files (which are only copied if missing), security files **always overwrite** existing files in the worktree. This ensures the worktree uses the same security rules as the main project, preventing security bypasses through stale configurations.

This means:
- Changes to allowlist in the main project are reflected in new worktrees
- You cannot have different security rules per worktree (by design)
- If you need to test with different commands, modify the main project's allowlist

## Security Considerations

The allowlist system exists to prevent:
- Accidental `rm -rf /` or similar destructive commands
- Execution of unknown binaries
- Network operations with unrestricted tools

Only add commands you trust and understand.

## Adding Support for New Technologies

If you're using a technology that should be auto-detected, consider contributing:

1. Add detection logic to `apps/backend/project/stack_detector.py`
2. Add commands to `apps/backend/project/command_registry/languages.py`
3. Submit a PR!

See existing detectors for examples.

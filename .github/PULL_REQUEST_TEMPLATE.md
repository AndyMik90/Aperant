## Base Branch

- [ ] This PR targets the `develop` branch (required for all feature/fix PRs)
- [ ] This PR targets `main` (hotfix only - maintainers)

## Description

<!-- What does this PR do? 2-3 sentences -->

## Related Issue

Closes #

## Type of Change

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 📚 Documentation
- [ ] ♻️ Refactor
- [ ] 🧪 Test

## Area

- [ ] Frontend
- [ ] Backend
- [ ] Fullstack

## Commit Message Format

Follow conventional commits: `<type>: <subject>`

**Types:** feat, fix, docs, style, refactor, test, chore

**Example:** `feat: add user authentication system`

## AI Disclosure

<!-- Check the box below if any part of this PR was written with AI assistance. -->

- [ ] This PR includes AI-generated code (Claude, Codex, Copilot, etc.)

<!-- If checked, please also fill in: -->
**Tool(s) used:** <!-- e.g., Claude Code, GitHub Copilot, ChatGPT -->
**Testing level:**
- [ ] Untested -- AI output not yet verified
- [ ] Lightly tested -- ran the app / spot-checked key paths
- [ ] Fully tested -- all tests pass, manually verified behavior

- [ ] I understand what this PR does and how the underlying code works

## Checklist

- [ ] I've synced with `develop` branch
- [ ] I've tested my changes locally
- [ ] I've followed the code principles (SOLID, DRY, KISS)
- [ ] My PR is small and focused (< 400 lines ideally)

## Platform Testing Checklist

**CRITICAL:** This project supports Windows, macOS, and Linux. Platform-specific bugs are a common source of breakage.

- [ ] **Windows tested** (either on Windows or via CI)
- [ ] **macOS tested** (either on macOS or via CI)
- [ ] **Linux tested** (CI covers this)
- [ ] Used centralized `platform/` module instead of direct `process.platform` checks
- [ ] No hardcoded paths (used `findExecutable()` or platform abstractions)

**If you only have access to one OS:** CI now tests on all platforms. Ensure all checks pass before submitting.

## CI/Testing Requirements

- [ ] All CI checks pass on **all platforms** (Windows, macOS, Linux)
- [ ] All existing tests pass
- [ ] New features include test coverage
- [ ] Bug fixes include regression tests

## Screenshots

<!-- Required for UI changes. Delete if not applicable. -->

| Before | After |
|--------|-------|
|        |       |

## Feature Toggle

<!-- If feature is incomplete or experimental, how is it hidden from users? -->
<!-- This ensures incomplete work can be merged without affecting production. -->

- [ ] Behind localStorage flag: `use_feature_name`
- [ ] Behind settings toggle
- [ ] Behind environment variable/config
- [ ] N/A - Feature is complete and ready for all users

## Breaking Changes

<!-- Does this PR introduce breaking changes? If yes, describe what breaks and migration steps. -->
<!-- Delete this section if not applicable. -->

**Breaking:** Yes / No

**Details:**
<!-- What breaks? What do users/developers need to change? -->

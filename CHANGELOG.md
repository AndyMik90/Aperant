## 2.7.6 - Stability & Feature Enhancements

### ✨ New Features

- **Multi-profile account management** — Unified profile swapping with automatic token refresh and rate limit recovery for both OAuth and API-compatible providers

- **Enhanced terminal experience** — Customizable terminal fonts with OS-specific defaults, Claude Code CLI settings injection, and improved worktree integration

- **Advanced roadmap management** — Expand/collapse functionality for phase features and real-time sync with task lifecycle

- **Queue System v2** — Smart task prioritization with auto-promotion and intelligent rate limit recovery

- **GitHub integration enhancements** — AI-powered PR template generation, user-friendly API error handling, and improved review visibility

- **UI/UX improvements** — Spell check support for text inputs, collapsible sidebar toggle, task screenshot capture, expandable task descriptions, and bulk worktree operations

- **Evidence-based PR validation** — Advanced review system with trigger-driven exploration and enhanced recovery mechanisms

### 🛠️ Improvements

- **Performance optimizations** — Async parallel worktree listing prevents UI freezes and improves responsiveness

- **Robustness enhancements** — Atomic file writes, better error detection in AI responses, and improved OOM/orphaned agent management for overnight builds

- **Terminal stability** — Fixed GPU context exhaustion from large pastes, SIGABRT crashes on macOS shutdown, and session restoration on app restart

- **Build & packaging** — XState bundling for packaged apps, aligned Linux package builds, and improved auto-updater for beta releases and DMG installations

- **Diagnostic improvements** — Sentry instrumentation for Python subprocesses and better error tracking across the system

### 🐛 Bug Fixes

- **Terminal & PTY** — Fixed paste size limits, race conditions, rendering issues, text alignment, worktree crashes, and terminal content resizing on expansion

- **PR review system** — Resolved error visibility in bundled apps, improved structured output validation with three-tier recovery, preserved findings during crashes, and fixed UTC timestamp detection for comment tracking

- **Planning & task execution** — Fixed handling of empty/greenfield projects, atomic writes to prevent 0-byte file corruption, planning phase crashes, and implementation plan file watching

- **Authentication & profiles** — Resolved OAuth token revocation loops, API profile mode support without OAuth requirement, subscription type preservation during token refresh, and Linux credential file detection

- **Windows/cross-platform** — Complete System32 executable path fixes for where.exe and taskkill.exe, Windows credential normalization, and proper shell detection for Windows terminals

- **Agent management** — Fixed infinite retry loops for tool concurrency errors, auth error detection, and title generator production path resolution

- **UI/UX fixes** — Resolved Insights scroll-to-blank-space issues, infinite re-render loops in terminal font settings, kanban board scaling collisions, ideation stuck states, and panel constraint errors during terminal exit

- **Worktree & Git** — Improved branch pattern validation, removed auto-commit on deletion, support for detached HEAD state during PR creation, and better merge conflict resolution with progress tracking

- **Integrations** — Fixed Ollama infinite subprocess spawning, Graphiti import paths, OpenRouter API URL suffix, and GitLab authentication bugs

- **Settings & configuration** — Corrected .auto-claude path discovery timeout, z.AI China preset URL, log order sorting, and onboarding completion state persistence

### 📚 Documentation

- Added Awesome Claude Code badge to README

- Added instructions for resetting PR review state in CLAUDE.md

---

## What's Changed

- fix: handle unknown SDK message types (rate_limit_event) to prevent session crashes by @AndyMik90 in 4a75ea9f9
- fix: PR review error visibility and gh CLI resolution in bundled apps by @AndyMik90 in 732fc1cd3
- fix: handle empty/greenfield projects in spec creation (#1426) (#1841) by @Andy in 819f98d9f
- fix: clear terminalEventSeen on task restart to prevent stuck-after-planning (#1828) (#1840) by @Andy in 28a620079
- fix: watch worktree path for implementation_plan.json changes (#1805) (#1842) by @Andy in fb3a3fbda
- fix: resolve Claude CLI not found on Windows - PATH, prompt size, cwd (#1661) (#1843) by @Andy in 76d1d3b03
- fix: handle planning phase crash and resume recovery (#1562) (#1844) by @Andy in 3cb05781f
- fix: show dismissed PR review findings in UI instead of silently dropping them (#1852) by @Andy in d98ff7d19
- fix: preserve file/line info in PR review extraction recovery (#1857) by @Andy in 635b53eea
- docs: add Awesome Claude Code badge to README (#1838) by @Andy in 2e4b5ac65
- test: achieve 100% test coverage for backend CLI commands (#1772) by @StillKnotKnown in 385f04414
- fix: cap terminal paste size to 1MB to prevent GPU context exhaustion by @AndyMik90 in 7b0f3a2c0
- fix: prevent OOM, orphaned agents, and unbounded growth during overnight builds (#1813) by @Andy in 4091d1d4b
- docs: add instructions for resetting PR review state in CLAUDE.md by @AndyMik90 in ecb615802
- auto-claude: 217-investigate-symlink-issues-in-work-tree-creation-f (#1808) by @Andy in ae13ce14c
- auto-claude: 218-enable-claude-code-features-in-worktree-terminals (#1809) by @Andy in e3b219288
- auto-claude: 219-investigate-and-fix-authentication-subscription-sy (#1810) by @Andy in 6204d5fc2
- feat(roadmap): add expand/collapse functionality for phase features (#1796) by @Burak in f735f0b49
- auto-claude: 216-display-ongoing-pr-review-logs-in-progress (#1807) by @Andy in a4870fa0c
- fix(pr-review): reduce structured output failures and preserve findings in recovery (#1806) by @Andy in f1b8cd3a7
- fix(sentry): enable Sentry for Python subprocesses and add diagnostic instrumentation (#1804) by @Andy in 4d4234378
- fix(pr-review): add three-tier recovery for structured output validation failure (#1797) by @Andy in d1fbccde3
- test: improve backend agent test coverage to 94% (#1779) by @StillKnotKnown in ed93df698
- fix(github): use UTC timestamps for reviewed_at to fix comment detection (#1795) by @Andy in 8872d33e3
- feat: add user-friendly GitHub API error handling (#1790) by @StillKnotKnown in 8ece0009e
- fix(roadmap): sync roadmap features with task lifecycle (#1791) by @Andy in 115576e85
- fix(github): resolve PR review hanging in bundled app (#1793) by @Andy in 3791b37bb
- feat(profiles): implement unified profile swapping across OAuth and API accounts (#1794) by @StillKnotKnown in 282387356
- test: improve backend memory system test coverage to 100% (#1780) by @StillKnotKnown in 4f1b7b2a9
- fix(ideation): guard against non-string properties in IdeaCard badges by @AndyMik90 in 5e78d748e
- fix(updater): convert HTML release notes to markdown before rendering by @AndyMik90 in aa5fc7f95
- fix(pr-review): simplify structured output schema to reduce validation failures (#1787) by @Andy in cd8914700
- fix(qa): enforce visual verification for UI changes and inject startup commands (#1784) by @Andy in f149a7fbd
- fix(plan-files): use atomic writes to prevent 0-byte corruption (#1785) by @Andy in c2245b812
- fix(terminal): make worktree dropdown scrollable and show all items by @AndyMik90 in 950da45e4
- auto-claude: subtask-1-1 - Add adaptive thinking badge to thinking level label (#1782) by @Andy in 25acf2826
- auto-claude: subtask-1-1 - Add overflow-hidden and break-words to subtask cards by @AndyMik90 in 39aa08872
- refactor(app-updater): disable automatic downloads and allow intentional downgrades by @AndyMik90 in 8de8039db
- fix(auth): detect auth errors in AI response text and prevent retry loops (#1776) by @Andy in f4788e4af
- test: achieve 100% coverage for backend core workspace module (#1774) by @StillKnotKnown in 3f95765cf
- fix(title-generator): add production path resolution for backend source (#1778) by @Andy in 923880f5b
- fix(fast-mode): use setting_sources instead of env var for CLI fast mode (#1771) by @Andy in 390ba6a58
- fix(windows): complete System32 executable path fixes for where.exe and taskkill.exe (#1715) by @VDT-91 in aa7f56e5d
- fix(worktree): remove auto-commit on deletion and add uncommitted changes warning by @AndyMik90 in cec8e65ee
- Smart PR Status Polling System (#1766) by @Andy in 48d5f7a32
- feat: simplify thinking system and remove opus-1m model variant (#1760) by @Andy in bb7e18937
- auto-claude: 203-fix-pr-review-ui-update-issue (#1732) by @Andy in 7589f8e4f
- auto-claude: subtask-2-1 - Create isAPIProfileAuthenticated() function to val (#1745) by @Andy in 57e38a692
- auto-claude: 202-fix-kanban-board-scaling-collisions (#1731) by @Andy in d09ebb850
- auto-claude: 204-fix-pr-review-ui-not-updating-without-manual-navig (#1734) by @Andy in 087091cef
- auto-claude: 203-fix-ui-not-updating-during-pr-review-operations (#1733) by @Andy in f085c08bd
- auto-claude: 205-fix-insights-chat-only-shows-last-task-suggestion- (#1735) by @Andy in f121f9cdd
- auto-claude: 197-roadmap-generation-stuck-at-50-file-locking-race-c (#1746) by @Andy in f41f15e59
- auto-claude: 193-fix-update-context7-mcp-tool-name-from-get-library (#1744) by @Andy in bdff9141a
- auto-claude: 192-changelog-generation-multiple-critical-bugs-tasks- (#1725) by @Andy in 8c9a504df
- auto-claude: 194-bug-rate-limit-during-task-execution-causes-subtas (#1726) by @Andy in 8a7443d24
- auto-claude: 201-bug-pr-review-logs-and-analysis (#1730) by @Andy in e0d53adb4
- auto-claude: 196-fix-worktrees-dialog-auto-close-race-condition-and (#1727) by @Andy in 323b0d3be
- auto-claude: 199-bug-logs-disappear-after-restart (#1728) by @Andy in d639f6ef8
- auto-claude: 198-critical-oauth-token-revocation-causes-infinite-40 (#1747) by @Andy in 4438c0b10
- Fix Panel Constraints Error During Terminal Exit (#1757) by @Andy in 32bf353da
- auto-claude: 190-bug-context-page-crash-multiple-root-causes-when-v (#1724) by @Andy in 2db36982f
- feat: add search/filter to WorktreeSelector dropdown (#1754) by @Andy in 09f059ca3
- fix(terminal): push worktree branch to remote with tracking on creation (#1753) by @Andy in b5de0d9ff
- auto-claude: 189-subtask-execution-stuck-in-infinite-retry-loop-whe (#1723) by @Andy in 445da186c
- auto-claude: 188-terminal-claude-sessions-require-manual-click-to-r (#1743) by @Andy in f8499e965
- auto-claude: 200-bug-changelog-and-release-generation (#1729) by @Andy in 826583b82
- fix(terminal): use each terminal's cwd for invoke Claude all button (#1756) by @Andy in ac4fe4f42
- feat(terminal): read Claude Code CLI settings and inject env vars into PTY sessions (#1750) by @Andy in 152e54093
- fix: correct .auto-claude path mismatch causing discovery phase timeout (#1748) by @VDT-91 in 2c2a8a754
- fix: remove incorrect /v1 suffix from OpenRouter API URL (#1749) by @StillKnotKnown in 7e799ee57
- fix: prevent terminal worktree crash with race condition fixes (#1586) (#1658) by @VDT-91 in 216b58bcf
- fix: correct log order sorting and add configurable log order setting (#1720) by @Burak in 2e2b82365
- fix(ollama): stop infinite subprocess spawning from useEffect re-render loop (#1716) by @Quentin Veys in acb131b72
- fix(graphiti): migrate graphiti_memory imports to canonical paths (#1714) by @Quentin Veys in df528f065
- fix: improve auto-updater for beta releases and DMG installs (#1681) by @Andy in ff91a1af0
- feat: unified operation registry for intelligent auth/rate limit recovery (#1698) by @Andy in 6d0222fa9
- fix: Prevent stale worktree data from overriding correct task status (#1710) by @Burak in fe08c644c
- feat: add subscriptionType and rateLimitTier to ClaudeProfile (#1688) by @Andy in a5e3cc9a2
- auto-claude: subtask-1-1 - Add useTaskStore import and update task state after successful PR creation (#1683) by @Andy in 4587162e4
- auto-claude: 182-implement-pagination-and-filtering-for-github-pr-l (#1654) by @Andy in b4e6b2fe4
- auto-claude: 181-add-expand-button-for-long-task-descriptions (#1653) by @Andy in d9cd300fe
- fix(terminal): resolve text alignment issues on expand/minimize (#1650) by @VDT-91 in f5a7e26d9
- fix(windows): use full path to where.exe for reliable executable lookup (#1659) by @VDT-91 in 5f63daa3c
- fix: resolve ideation stuck at 3/6 types bug (#1660) by @VDT-91 in e6e8da17c
- Clarify Local and Origin Branch Distinction (#1652) by @Andy in 9317148b6
- auto-claude: 186-set-default-dark-mode-on-startup (#1656) by @Andy in 473020621
- auto-claude: subtask-1-1 - Add min-h-0 to enable scrolling in Roadmap tabs (#1655) by @Andy in ae703be9f
- fix: XState status lifecycle & cross-project contamination fixes (#1647) by @kaigler in 5293fb399
- refactor(frontend): complete XState task state machine migration (#1338) (#1575) by @kaigler in e2f9abadb
- Merge conflict resolution progress bar and log viewer (#1620) by @Andy in d16be3077
- fix: align Linux package builds (AppImage/deb/Flatpak) with target-specific extraResources (#1623) by @StillKnotKnown in bad1a9b2c
- Fix/gitlab bugs (#1519 and #1521) (#1544) by @bu5hm4nn in cd423c65c
- feat(kanban): add bulk task delete and worktree cleanup improvements (#1588) by @kaigler in 02ed91c91
- fix: add worktree isolation warning to prevent agent escape (#1528) by @kaigler in fe5cc582b
- feat(ui): add spell check support for text inputs (#1304) by @kaigler in 8f02a5129
- fix(windows): complete Windows credential fixes with path normalization (#1585) by @kaigler in 1e1997167
- AI-Powered GitHub PR Template Generation (#1618) by @Andy in 900dd4360
- Fix pty.node SIGABRT crash on macOS shutdown (#1619) by @Andy in f355e09d7
- fix(merge): use git merge for diverged branches with progress tracking (#1605) by @Andy in bde2ca4b2
- Surface Billing/Credit Exhaustion Errors to UI (Issue #1580) (#1617) by @Andy in 7bf12e856
- auto-claude: subtask-1-1 - Change $teamId type from ID! to String! in the team query (#1627) by @Andy in 54d0cd2f4
- fix(auth): support API profile mode without OAuth requirement (#1616) by @StillKnotKnown in f8cc63af4
- fix: agent retry loop for tool concurrency errors (#1546) [v3] (#1606) by @Michael Ludlow in 0aea4fb5e
- fix(queue): enforce max parallel tasks and auto-refresh UI (#1594) by @Andy in 4070a4c29
- Persist Kanban column collapse state per project via main process (#1579) by @Andy in a1114664e
- feat(pr-review): evidence-based validation and trigger-driven exploration (#1593) by @Andy in bfc232825
- fix(ui): smart auto-scroll for Insights streaming responses (#1591) by @kaigler in eee97e7ea
- fix(changelog): validate Claude CLI exists before generation (#1305) by @kaigler in c1f24c07f
- auto-claude: subtask-1-1 - Add min-w-0 class to subtask title row flex container (#1578) by @Andy in 286591c02
- auto-claude: subtask-1-1 - Remove Popover wrapper and related functionality from ClaudeCodeStatusBadge (#1566) by @Andy in 8d18cc81a
- fix(claude-profile): preserve subscriptionType and rateLimitTier during token refresh (#1556) by @Andy in 52e426a48
- auto-claude: subtask-1-1 - Update cancelReview callback to handle both success and failure cases (#1551) by @Andy in d8f00fe5a
- fix(backend): prioritize git remote detection over env var for repo (#1555) by @Andy in 9b07ed464
- fix(backend): handle detached HEAD state when pushing branch for PR creation (#1560) by @Andy in 2b72694d0
- fix: add explicit UTF-8 encoding across all Electron main process I/O (#1554) by @Andy in 4243530e9
- fix(backend): pass OAuth token to Python subprocess for authentication by @AndyMik90 in 6f1002dd7
- perf(frontend): async parallel worktree listing to prevent UI freezes (#1553) by @Andy in 399a7e736
- auto-claude: subtask-1-1 - Remove amber lock indicator line from kanban resize handle (#1557) by @Andy in 83a64b88e
- fix(frontend): resolve TerminalFontSettings infinite re-render loop (#1536) by @StillKnotKnown in 1c6266025
- fix(frontend): respect hasCompletedOnboarding from ~/.claude.json (#1537) by @StillKnotKnown in 1860c2c43
- fix: prevent planner from generating invalid verification types (#1388) (#1529) by @kaigler in 94d941333
- fix(frontend): resolve Insights scroll-to-blank-space issue on macOS (ACS-382) (#1535) by @StillKnotKnown in 496b2b96a
- feat: add customizable terminal fonts with OS-specific defaults (#1412) by @StillKnotKnown in f289107b8
- Add dev mode screenshot capture warning (#1516) by @Andy in 16eeb301a
- fix: add worktree isolation warnings to prevent agent escape (ACS-394) (#1495) by @StillKnotKnown in 1e453653b
- fix: resolve flaky subprocess-spawn test on Windows CI (ACS-392) (#1494) by @StillKnotKnown in f6b264d56
- feat(task-logger): strip ANSI escape codes from logs and extend coverage (#1411) by @StillKnotKnown in 988ec0c25
- fix(frontend): use spawn() instead of exec() for Windows terminal launching (#1498) by @StillKnotKnown in 26c9083d3
- fix(api-profiles): correct z.AI China preset URL and rename provider presets (#1500) by @StillKnotKnown in 05cf0a516
- fix: validate branch pattern before worktree cleanup to prevent deleting wrong branch (#1493) by @StillKnotKnown in 8576754a1
- Real-Time Updates for Insights Chat (#1511) by @Andy in d940b6ade
- Fix Terminal UI Rendering Issues (#1514) by @Andy in 8d8306b8e
- Fix terminal content resizing on expansion (#1512) by @Andy in 9f6c0026b
- Restore Terminal Session History on App Restart (#1515) by @Andy in 63e2847fc
- Move Reference Images Above Task Title & Fix Image Display Issues (#1513) by @Andy in b269ac305
- auto-claude: 143-fix-github-integration-ui-refresh-issues (#1467) by @Andy in aa2cb4fa6
- feat: Multi-profile account swapping with token refresh and queue routing (#1496) by @Andy in 1e72c8d77
- Simplified Testing Strategy for Regression Prevention (#1379) by @Andy in ae4e48e8b
- auto-claude: 152-persist-tasks-during-roadmap-regeneration (#1463) by @Andy in 9bd3d7e3b
- Debug Kanban Memory & Add Sentry Monitoring (#1380) by @Andy in bc5f550ee
- auto-claude: 147-remove-outdated-compatibility-shims (#1465) by @Andy in 53111dbb9
- auto-claude: 162-fix-worktree-error-on-repeated-task-starts (#1453) by @Andy in b955badf7
- auto-claude: 155-fix-pr-list-diff-display-metrics (#1458) by @Andy in 31f116db5
- auto-claude: 151-fix-pr-review-agent-token-refresh-on-account-swap (#1456) by @Andy in d081af042
- auto-claude: 148-add-progress-persistence-and-status-indicators (#1464) by @Andy in 4937d5745
- auto-claude: 154-fix-task-modal-conflict-check-status-refresh (#1462) by @Andy in 0299009df
- auto-claude: 153-widen-kanban-columns-and-add-collapse-feature (#1457) by @Andy in d65973075
- auto-claude: subtask-1-1 - Add filter after map operation to remove empty str (#1466) by @Andy in 783f0fe0e
- fix: add formatReleaseNotes helper for markdown changelog rendering (#1468) by @Andy in 43a97e1b3
- feat(sidebar): add collapsible sidebar toggle (#1501) by @Michael Ludlow in d17c17887
- fix(auth): check .credentials.json for Linux profile authentication (#1492) by @StillKnotKnown in 8d2f66291
- auto-claude: subtask-1-1 - Replace ReleaseNotesRenderer with ReactMarkdown (#1454) by @Andy in 1185a558c
- auto-claude: 156-fix-electron-app-version-detection-bug (#1459) by @Andy in 9a3b48c25
- auto-claude: subtask-1-1 - Add --no-track flag to git worktree add command (#1455) by @Andy in 0c2990815
- auto-claude: subtask-1-1 - Change task.specId to taskId in 3 startSpecCreation calls (#1461) by @Andy in 91edc0e14
- fix(onboarding): align MemoryStep layout with Settings MemoryBackendSection (#1445) by @Michael Ludlow in e9de26d59
- auto-claude: subtask-1-1 - Add metadata?.requireReviewBeforeCoding check (#1460) by @Andy in 426d56571
- fix: use API profile environment variables for task title generation (#1471) by @JoshuaRileyDev in c5a0f042d
- fix(auth): Long-lived OAuth authentication with multi-profile usage display (#1443) by @Andy in 12e788417
- feat: Add screenshot capture to task creation modal (#1429) by @JoshuaRileyDev in 1a2a1b1fc
- fix: prevent queue settings modal from disappearing when tasks change (#1430) by @JoshuaRileyDev in 33acc1430
- feat: Queue System v2 with Auto-Promotion and Smart Task Management (#1203) by @JoshuaRileyDev in 3b87e24d7
- feat: Add API profile providers usage endpoints support (#1279) by @StillKnotKnown in cfe7dedd0

## Thanks to all contributors

@AndyMik90, @Andy, @Burak, @StillKnotKnown, @VDT-91, @kaigler, @Michael Ludlow, @JoshuaRileyDev, @Quentin Veys, @bu5hm4nn

## 2.7.5 - Security & Platform Improvements

### ✨ New Features

- One-time version 2.7.5 reauthentication warning modal for improved security awareness

- Enhanced authentication failure detection and handling with improved error recovery

- PR review validation pipeline with context enrichment and cross-validation support

- Terminal "Others" section in worktree dropdown for better organization

- Keyboard shortcut to toggle terminal expand/collapse for improved usability

- Searchable branch combobox in worktree creation dialog for easier branch selection

- Update Branch button in PR detail view for streamlined workflow

- Bulk select and create PR functionality for human review column

- Draggable Kanban task reordering for flexible task management

- YOLO mode to invoke Claude with --dangerously-skip-permissions for advanced users

- File and screenshot upload to QA feedback interface for better feedback submission

- Task worktrees section with terminal limit removal for expanded parallel work

- Claude Code version rollback feature for version management

- Linux secret-service support for OAuth token storage (ACS-293)

### 🛠️ Improvements

- Replace setup-token with embedded /login terminal flow for streamlined authentication

- Refactored authentication using platform abstraction for cross-platform reliability

- Removed redundant backend CLI detection (~230 lines) for cleaner codebase

- Replaced Select with Combobox for branch selection UI improvements

- Replace dangerouslySetInnerHTML with Trans component for better security practice

- Wait for CI checks before starting AI PR review for more accurate results

- Improved Claude CLI detection with installation selector

- Terminal rendering, persistence, and link handling improvements

- Enhanced terminal recreation logic with retry mechanism for reliability

- Improved worktree name input UX with better validation

- Made worktree isolation prominent in UI for user awareness

- Reduce ultrathink value from 65536 to 60000 for Opus 4.5 compatibility

- Standardized workflow naming and consolidated linting workflow

- Added gate jobs to CI/CD pipeline for better quality control

- Fast-path detection for merge commits without finding overlap in PR review

- Show progress percentage during planning phase on task cards

- PTY write improvements using PtyManager.writeToPty for safer terminal operations

- Consolidated package-lock.json to root level for simpler dependency management

- Graphiti memory feature fixes on macOS

- Model versions updated to Claude 4.5 with connected insights to frontend settings

### 🐛 Bug Fixes

- Fixed task logs disappearing after app restart in development mode (issue #1657)

- Fixed Kanban board status flip-flopping and multi-location task deletion

- Fixed Windows CLI detection and version selection UX issues

- Fixed Windows coding phase not starting after spec/planning

- Fixed Windows UTF-8 encoding errors across entire backend (251 instances)

- Fixed 401 authentication errors by reading tokens from profile configDir

- Fixed Windows packaging by using SDK bundled Claude CLI

- Fixed false stuck detection during planning phase

- Fixed PR list update on post status click

- Fixed screenshot state persistence bug in task modals

- Fixed non-functional '+ Add' button for multiple Claude accounts

- Fixed GitHub Issues/PRs infinite scroll auto-fetch behavior

- Fixed GitHub PR state management and follow-up review trigger bug

- Fixed terminal output freezing on project switch

- Fixed terminal rendering on app close to prevent zombie processes

- Fixed stale terminal metadata filtering with auto-cleanup

- Fixed worktree configuration sync after PTY creation

- Fixed cross-worktree file leakage via environment variables

- Fixed .gitignore auto-commit during project initialization

- Fixed PR review verdict message contradiction and blocked status limbo

- Fixed re-review functionality when previous review failed

- Fixed agent profile resolution before falling back to defaults

- Fixed Windows shell command support in Claude CLI invocation

- Fixed model resolution using resolve_model_id() instead of hardcoded fallbacks

- Fixed ultrathink token budget correction from 64000 to 63999

- Fixed Windows pywin32 DLL loading failure on Python 3.8+

- Fixed circular import between spec.pipeline and core.client

- Fixed pywin32 bundling in Windows binary

- Fixed secretstorage bundling in Linux binary

- Fixed gh CLI detection for PR creation

- Fixed PYTHONPATH isolation to prevent pollution of external projects

- Fixed structured output capture from SDK ResultMessage in PR review

- Fixed CI status refresh before returning cached verdict

- Fixed Python environment readiness before spawning tasks

- Fixed pywintypes import errors during dependency validation

- Fixed Node.js and npm path detection on Windows packaged apps

- Fixed Windows PowerShell command separator usage

- Fixed require is not defined error in terminal handler

- Fixed Sentry DSN initialization error handling

- Fixed requestAnimationFrame fallback for flaky Ubuntu CI tests

- Fixed file drag-and-drop to terminals and task modals with branch status refresh

- Fixed GitHub issues pagination and infinite scroll

- Fixed delete worktree status regression

- Fixed Mac crash on Invoke Claude button

- Fixed worktree symlink for node_modules to enable TypeScript support

- Fixed PTY wait on Windows before recreating terminal

- Fixed terminal aggressive renaming on Claude invocation

- Fixed worktree dropdown scroll area to prevent overflow

- Fixed GitHub PR preloading currently under review

- Fixed actual base branch name display instead of hardcoded main

- Fixed Claude CLI detection with improved installation selector

- Fixed broken pipe errors with Sentry integration

- Fixed app update persistence for Install button visibility

- Fixed Claude exit detection and label reset

- Fixed file merging to include files with content changes

- Fixed worktree config sync on terminal restoration

- Fixed security profile inheritance in worktrees and shell -c validation

- Fixed terminal drag and drop reordering collision detection

- Fixed "already up to date" case handling in worktree operations

- Fixed Windows UTF-8 encoding and path handling issues

- Fixed Terminal label persistence after app restart

- Fixed worktree dropdown enhancement with scrolling support

- Fixed enforcement of 12 terminal limit per project

- Fixed macOS UTF-8 encoding errors (251 instances)

### 📚 Documentation

- Added fork configuration guidance to CONTRIBUTING.md

- Updated README download links to v2.7.4

### 🔧 Other Changes

- Removed node_modules symlink and cleaned up package-lock.json

- Added .planning/ to gitignore

- Migrated ESLint to Biome with optimized workflows

- Fixed tar vulnerability in dependencies

- Added minimatch to externalized dependencies

- Added exception handling for malformed DSN during Sentry initialization

- Corrected roadmap import path in roadmap_runner.py

- Added require polyfill for ESM/Sentry compatibility

- Addressed CodeQL security alerts and code quality issues

- Added shell: true and argument sanitization for Windows packaging

- Packaged runtime dependencies with pydantic_core validation

---

## What's Changed

- test(subprocess): add comprehensive auth failure detection tests by @AndyMik90 in ccaf82db
- fix(security): replace dangerouslySetInnerHTML with Trans component and persist version warning by @AndyMik90 in 7aec35c3
- chore: remove node_modules symlink and clean up package-lock.json by @AndyMik90 in 9768af8e
- fix: address PR review issues and improve code quality by @AndyMik90 in 23a7e5a2
- fix(auth): read tokens from profile configDir to fix 401 errors (#1385) by @Andy in 55857d6d
- fix: Kanban board status flip-flopping and multi-location task deletion (#1387) by @Adam Slaker in 7dcb7bbe
- fix(windows): use SDK bundled Claude CLI for Windows packaged apps (#1382) by @Andy in cd4e2d38
- feat(auth): enhance authentication failure detection and handling by @AndyMik90 in 7ab10cd5
- refactor(subprocess): use platform abstraction for auth failure process killing by @AndyMik90 in 17cffecc
- feat(ui): add one-time version 2.7.5 reauthentication warning modal by @AndyMik90 in f49ef92a
- refactor: remove redundant backend CLI detection (~230 lines) (#1367) by @Andy in c7bc01d5
- feat(pr-review): add validation pipeline, context enrichment, and cross-validation (#1354) by @Andy in d8f4de9a
- fix(terminal): rename Claude terminals only once on initial message (#1366) by @Andy in b2d2d7e9
- feat(auth): add auth failure detection modal for Claude CLI 401 errors (#1361) by @Andy in 317d5e94
- docs: add fork configuration guidance to CONTRIBUTING.md (#1364) by @Andy in c57534c3
- Fix #609: Windows coding phase not starting after spec/planning (#1347) by @TamerineSky in 6da1b170
- Fix Windows UTF-8 encoding errors across entire backend (251 instances) (#782) by @TamerineSky in 6a6247bb
- chore: add .planning/ to gitignore by @AndyMik90 in 8df66245
- feat(auth): replace setup-token with embedded /login terminal flow (#1321) by @Andy in 11f8d572
- fix: Windows CLI detection and version selection UX improvements (#1341) by @StillKnotKnown in 8a2f3acd
- fix: add shell: true and argument sanitization for Windows packaging (#1340) by @StillKnotKnown in e482fdf1
- fix: package runtime deps and validate pydantic_core (#1336) by @StillKnotKnown in 141f44f6
- fix(test): update mock profile manager and relax audit level by @Test User in 86ba0246
- 2.7.4 release stable by @Test User in 3e2d6ef4
- fix(tests): update claude-integration-handler tests for PtyManager.writeToPty by @Test User in 56743ff7
- chore: consolidate package-lock.json to root level by @Test User in d4044d26
- build: add minimatch to externalized dependencies by @Test User in 95f7f222
- refactor(terminal): use PtyManager.writeToPty for safer PTY writes by @Test User in 4637a1a9
- fix: correct ultrathink token budget from 64000 to 63999 by @Test User in efdb8c71
- ci: migrate ESLint to Biome, optimize workflows, fix tar vulnerability (#1289) by @Andy in 0b2cf9b0
- Fix API 401 - Token Decryption Before SDK Initialization (#1283) by @Andy in 4b740928
- Fix Ultrathink Token Limit Bug (#1284) by @Andy in e989300b
- fix(security): address CodeQL security alerts and code quality issues (#1286) by @Andy in f700b18d
- fix(ui): make prose-invert conditional on dark mode for light theme support (#1160) by @youngmrz in 439ed86a
- fix(terminal): add require polyfill for ESM/Sentry compatibility (#1275) by @VDT-91 in eb739afe
- fix: add retry logic for planning-to-coding transition (#1276) by @kaigler in b8655904
- fix(worktree): prevent cross-worktree file leakage via environment variables (#1267) by @Andy in 7cb9e0a3
- Fix/cleanup 2.7.5 (#1271) by @Andy in f0c3e508
- Fix False Stuck Detection During Planning Phase (#1236) by @Andy in 44304a61
- fix(pr-review): allow re-review when previous review failed (#1268) by @Andy in 4cc8f4db
- fix: enforce 12 terminal limit per project (#1264) by @Andy in d7ed770e
- Draggable Kanban Task Reordering (#1217) by @Andy in 3606a632
- fix(terminal): sync worktree config after PTY creation to fix first-attempt failure (#1213) by @Andy in 39236f18
- fix: auto-commit .gitignore changes during project initialization (#1087) (#1124) by @youngmrz in ba089c5b
- Fix terminal rendering, persistence, and link handling (#1215) by @Andy in 75a3684c
- fix(windows): prevent zombie process accumulation on app close (#1259) by @VDT-91 in 90204469
- update gitignore by @AndyMik90 in c13d9a40
- Fix PR List Update on Post Status Click (#1207) by @Andy in 3085e392
- Fix screenshot state persistence bug in task modals (#1235) by @Andy in 3024d547
- Fix non-functional '+ Add' button for multiple Claude accounts (#1216) by @Andy in e27ff344
- Fix GitHub Issues/PRs Infinite Scroll Auto-Fetch (#1239) by @Andy in b74b628b
- Add bulk delete functionality to worktree overview (#1208) by @Andy in 8833feb2
- Fix GitHub PR State Management - Follow-up Review Trigger Bug (#1238) by @Andy in 76f07720
- auto-claude: subtask-1-1 - Add useEffect hook to reset expandedTerminalId when projectPath changes (#1240) by @Andy in d1131080
- Fix Terminal Output Freezing on Project Switch (#1241) by @Andy in 193d2ed9
- Add Update Branch Button to PR Detail View (#1242) by @Andy in 87c84073
- Bulk Select All & Create PR for Human Review Column (#1248) by @Andy in 715202b8
- fix(windows): resolve pywin32 DLL loading failure on Python 3.8+ (#1244) by @VDT-91 in cb786cac
- fix(gh-cli): use get_gh_executable() and pass GITHUB_CLI_PATH from GUI (ACS-321) (#1232) by @StillKnotKnown in 14fbc2eb
- auto-claude: subtask-1-1 - Replace Select with Combobox for branch selection (#1250) by @Andy in ed45ece5
- fix(sentry): add exception handling for malformed DSN during Sentry initialization by @AndyMik90 in 4f86742b
- dev dependecnies using npm install all by @AndyMik90 in e52a1ba4
- hotfix/dev-dependency-missing by @AndyMik90 in a0033b1e
- fix(frontend): resolve require is not defined error in terminal handler (#1243) by @Antti in 9117b59e
- hotfix/node by @AndyMik90 in bb620044
- fix(windows): add Node.js and npm paths to COMMON_BIN_PATHS for packaged apps (#1158) by @youngmrz in f0319bc8
- fix/stale-task-creation by @AndyMik90 in 9612cf8d
- fix/sentry-local-build by @AndyMik90 in b822797f
- hotfix/tar-vurnability by @AndyMik90 in 2096b0e2
- fix(tests): add requestAnimationFrame fallback for flaky Ubuntu CI tests by @AndyMik90 in 9739b338
- fix(windows): use correct command separator for PowerShell terminals (#1159) by @youngmrz in cb8e46ca
- fix(ui): show progress percentage during planning phase on task cards (#1162) by @youngmrz in 515aada1
- fix(tests): isolate git operations in test fixtures from parent repository (#1205) by @Andy in 596b1e0c
- feat(terminal): add "Others" section to worktree dropdown (#1209) by @Andy in 219cc068
- fix(linux): ensure secretstorage is bundled in Linux binary (ACS-310) (#1211) by @StillKnotKnown in 48bd4a9c
- fix(terminal): persist worktree label after app restart (#1210) by @Andy in ba7358af
- fix: Graphiti memory feature on macOS (#1174) by @Alexander Penzin in c2e53d58
- fix(windows): ensure pywin32 is bundled in Windows binary (ACS-306) (#1197) by @StillKnotKnown in 76af0aaa
- fix(spec): resolve circular import between spec.pipeline and core.client (ACS-302) (#1192) by @StillKnotKnown in 648cf3fc
- Fix Mac Crash on Invoke Claude Button (#1185) by @Andy in ae40f819
- fix(worktree): symlink node_modules to worktrees for TypeScript support (#1148) by @Andy in d7c7ce8e
- fix(terminal): wait for PTY exit on Windows before recreating terminal (#1184) by @Andy in d5d56975
- fix(runners): use resolve_model_id() for model resolution instead of hardcoded fallbacks (ACS-294) (#1170) by @StillKnotKnown in 5199fdbf
- fix(frontend): support Windows shell commands in Claude CLI invocation (ACS-261) (#1152) by @StillKnotKnown in 3a1966bd
- feat(terminal): add keyboard shortcut to toggle expand/collapse (#1180) by @Andy in 1edfe333
- fix(kanban): remove error column and add backend JSON repair (#1143) by @Andy in 51f67c5d
- fix(ci): add gate jobs and consolidate linting workflow (#1182) by @Andy in 4b43f074
- fix(ci): standardize workflow naming and remove redundant workflows (#1178) by @Andy in 4a3391b2
- fix(terminal): enable scrolling in worktree dropdown when many items exist (#1175) by @Andy in 5525f36d
- fix: windows (#1056) by @Alex in d6234f52
- fix(backend): reduce ultrathink value from 65536 to 60000 for Opus 4.5 compatibility (#1173) by @StillKnotKnown in 30638c2f
- feat(backend): add Linux secret-service support for OAuth token storage (ACS-293) (#1168) by @StillKnotKnown in a6934a8e
- fix(terminal): prevent aggressive renaming on Claude invocation (#1147) by @Andy in 10bceac9
- fix(pr-review): resolve verdict message contradiction and blocked status limbo (#1151) by @Andy in 8b269fea
- feat(pr-review): add fast-path detection for merge commits without finding overlap (#1145) by @Andy in 32811142
- fix(frontend): resolve agent profile before falling back to defaults (ACS-255) (#1068) by @StillKnotKnown in 33014682
- fix(terminal): add scroll area to worktree dropdown to prevent overflow (#1146) by @Andy in 200bb3bc
- fix(frontend): add windowsVerbatimArguments for Windows .cmd validation (ACS-252) (#1075) by @StillKnotKnown in 658f26cb
- fix(backend): improve gh CLI detection for PR creation (ACS-247) (#1071) by @StillKnotKnown in 2eef82bf
- fix(terminal): filter stale worktree metadata and auto-cleanup (#1038) by @Andy in 16bc37ce
- Fix Delete Worktree Status Regression (#1076) by @Andy in 97f98ed7
- 117-sidebar-update-banner (#1078) by @Andy in 4fd25b01
- fix(ci): add beta manifest renaming and validation (#1002) (#1080) by @Andy in c6c6525b
- fix: update all model versions to Claude 4.5 and connect insights to frontend settings (#1082) by @Andy in 58f4f30b
- fix: file drag-and-drop to terminals and task modals + branch status refresh (#1092) by @Andy in b5c0e631
- fix(github-issues): add pagination and infinite scroll for issues tab (#1042) by @Andy in f1674923
- fix(ci): enable automatic release workflow triggering (#1043) by @Andy in 2ff9ccab
- fix(backend): isolate PYTHONPATH to prevent pollution of external projects (ACS-251) (#1065) by @StillKnotKnown in 18d9b6cf
- add time sensitive AI review logic (#1137) by @Andy in 5fb7574b
- fix(pr-review): use list instead of tuple for line_range to fix SDK structured output (#1140) by @Andy in 45060ca3
- feat(github-review): wait for CI checks before starting AI PR review (#1131) by @Andy in a55e4f68
- fix(frontend): pass CLAUDE_CLI_PATH to Python backend subprocess (ACS-230) (#1081) by @StillKnotKnown in 5e91c3a7
- fix(runners): correct roadmap import path in roadmap_runner.py (ACS-264) (#1091) by @StillKnotKnown in 767dd5c3
- fix(pr-review): properly capture structured output from SDK ResultMessage (#1133) by @Andy in f28d2298
- fix(github-review): refresh CI status before returning cached verdict (#1083) by @Andy in c3bdd4f8
- fix(agent): ensure Python env is ready before spawning tasks (ACS-254) (#1061) by @StillKnotKnown in 7dc54f23
- fix(windows): prevent pywintypes import errors before dependency validation (ACS-253) (#1057) by @StillKnotKnown in 71a9fc84
- fix(docs): update README download links to v2.7.4 by @Test User in 67b39e52
- fix readme for 2.7.4 by @Test User in a0800646
- changelog 2.7.4 by @AndyMik90 in 1b5aecdd
- 2.7.4 release by @AndyMik90 in 72797ac0
- fix(frontend): validate Windows claude.cmd reliably in GUI (#1023) by @Umaru in 1ae3359b
- fix(auth): await profile manager initialization before auth check (#1010) by @StillKnotKnown in c8374bc1
- Add file/screenshot upload to QA feedback interface (#1018) by @Andy in 88277f84
- feat(terminal): add task worktrees section and remove terminal limit (#1033) by @Andy in 17118b07
- fix(terminal): enhance terminal recreation logic with retry mechanism (#1013) by @Andy in df1b8a3f
- fix(terminal): improve worktree name input UX (#1012) by @Andy in 54e9f228
- Make worktree isolation prominent in UI (#1020) by @Andy in 4dbb7ee4
- feat(terminal): add YOLO mode to invoke Claude with --dangerously-skip-permissions (#1016) by @Andy in d48e5f68
- Fix Duplicate Kanban Task Creation on Rapid Button Clicks (#1021) by @Andy in 2d1d3ef1
- feat(sentry): embed Sentry DSN at build time for packaged apps (#1025) by @Andy in aed28c5f
- fix(github): resolve circular import issues in context_gatherer and services (#1026) by @Andy in 0307a4a9
- hotfix/sentry-backend-build by @AndyMik90 in e7b38d49
- chore: bump version to 2.7.4 by @AndyMik90 in 432e985b
- fix(github-prs): prevent preloading of PRs currently under review (#1006) by @Andy in 1babcc86
- fix(ui): display actual base branch name instead of hardcoded main (#969) by @Andy in 5d07d5f1
- ci(release): move VirusTotal scan to separate post-release workflow (#980) by @Andy in 553d1e8d
- fix: improve Claude CLI detection and add installation selector (#1004) by @Andy in e07a0dbd
- fix(backend): add Sentry integration and fix broken pipe errors (#991) by @Andy in aa9fbe9d
- fix(app-update): persist downloaded update state for Install button visibility (#992) by @Andy in 6f059bb5
- fix(terminal): detect Claude exit and reset label when user closes Claude (#990) by @Andy in 14982e66
- fix(merge): include files with content changes even when semantic analysis is empty (#986) by @Andy in 4736b6b6
- fix(frontend): sync worktree config to renderer on terminal restoration (#982) by @Andy in 68fe0860
- feat(frontend): add searchable branch combobox to worktree creation dialog (#979) by @Andy in 2a2dc3b8
- fix(security): inherit security profiles in worktrees and validate shell -c commands (#971) by @Andy in 750ea8d1
- feat(frontend): add Claude Code version rollback feature (#983) by @Andy in 8d21978f
- fix(ACS-181): enable auto-switch on 401 auth errors & OAuth-only profiles (#900) by @Michael Ludlow in e7427321
- fix(terminal): add collision detection for terminal drag and drop reordering (#985) by @Andy in 1701160b
- fix(worktree): handle "already up to date" case correctly (ACS-226) (#961) by @StillKnotKnown in 74ed4320
- ci: add Azure auth test workflow by @AndyMik90 in d12eb523

## Thanks to all contributors

@AndyMik90, @Andy, @Adam Slaker, @TamerineSky, @StillKnotKnown, @Test User, @youngmrz, @VDT-91, @kaigler, @Alexander Penzin, @Antti, @Alex, @Michael Ludlow, @Umaru

## 2.7.4 - Terminal & Workflow Enhancements

### ✨ New Features

- Added task worktrees section in terminal with ability to invoke Claude with YOLO mode (--dangerously-skip-permissions)

- Added searchable branch combobox to worktree creation dialog for easier branch selection

- Added Claude Code version rollback feature to switch between installed versions

- Embedded Sentry DSN at build time for better error tracking in packaged apps

### 🛠️ Improvements

- Made worktree isolation prominent in UI to help users understand workspace isolation

- Enhanced terminal recreation logic with retry mechanism for more reliable terminal recovery

- Improved worktree name input UX for better user experience

- Improved Claude CLI detection with installation selector when multiple versions found

- Enhanced terminal drag and drop reordering with collision detection

- Synced worktree config to renderer on terminal restoration for consistency

### 🐛 Bug Fixes

- Fixed Windows claude.cmd validation in GUI to work reliably across different setups

- Fixed profile manager initialization timing issue before auth checks

- Fixed terminal recreation and label reset when user closes Claude

- Fixed duplicate Kanban task creation that occurred on rapid button clicks

- Fixed GitHub PR preloading to prevent loading PRs currently under review

- Fixed UI to display actual base branch name instead of hardcoded "main"

- Fixed Claude CLI detection to properly identify available installations

- Fixed broken pipe errors in backend with Sentry integration

- Fixed app update state persistence for Install button visibility

- Fixed merge logic to include files with content changes even when semantic analysis is empty

- Fixed security profile inheritance in worktrees and shell -c command validation

- Fixed auth auto-switch on 401 errors and improved OAuth-only profile handling

- Fixed "already up to date" case handling in worktree operations

- Resolved circular import issues in GitHub context gatherer and services

---

## What's Changed

- fix: validate Windows claude.cmd reliably in GUI by @Umaru in 1ae3359b
- fix: await profile manager initialization before auth check by @StillKnotKnown in c8374bc1
- feat: add file/screenshot upload to QA feedback interface by @Andy in 88277f84
- feat(terminal): add task worktrees section and remove terminal limit by @Andy in 17118b07
- fix(terminal): enhance terminal recreation logic with retry mechanism by @Andy in df1b8a3f
- fix(terminal): improve worktree name input UX by @Andy in 54e9f228
- feat(ui): make worktree isolation prominent in UI by @Andy in 4dbb7ee4
- feat(terminal): add YOLO mode to invoke Claude with --dangerously-skip-permissions by @Andy in d48e5f68
- fix(ui): prevent duplicate Kanban task creation on rapid button clicks by @Andy in 2d1d3ef1
- feat(sentry): embed Sentry DSN at build time for packaged apps by @Andy in aed28c5f
- fix(github): resolve circular import issues in context_gatherer and services by @Andy in 0307a4a9
- fix(github-prs): prevent preloading of PRs currently under review by @Andy in 1babcc86
- fix(ui): display actual base branch name instead of hardcoded main by @Andy in 5d07d5f1
- ci(release): move VirusTotal scan to separate post-release workflow by @Andy in 553d1e8d
- fix: improve Claude CLI detection and add installation selector by @Andy in e07a0dbd
- fix(backend): add Sentry integration and fix broken pipe errors by @Andy in aa9fbe9d
- fix(app-update): persist downloaded update state for Install button visibility by @Andy in 6f059bb5
- fix(terminal): detect Claude exit and reset label when user closes Claude by @Andy in 14982e66
- fix(merge): include files with content changes even when semantic analysis is empty by @Andy in 4736b6b6
- fix(frontend): sync worktree config to renderer on terminal restoration by @Andy in 68fe0860
- feat(frontend): add searchable branch combobox to worktree creation dialog by @Andy in 2a2dc3b8
- fix(security): inherit security profiles in worktrees and validate shell -c commands by @Andy in 750ea8d1
- feat(frontend): add Claude Code version rollback feature by @Andy in 8d21978f
- fix(ACS-181): enable auto-switch on 401 auth errors & OAuth-only profiles by @Michael Ludlow in e7427321
- fix(terminal): add collision detection for terminal drag and drop reordering by @Andy in 1701160b
- fix(worktree): handle "already up to date" case correctly by @StillKnotKnown in 74ed4320

## Thanks to all contributors

@Umaru, @StillKnotKnown, @Andy, @Michael Ludlow, @AndyMik90

## 2.7.3 - Reliability & Stability Focus

### ✨ New Features

- Add terminal copy/paste keyboard shortcuts for Windows/Linux

- Add Sentry environment variables to CI build workflows for error monitoring

- Add Claude Code changelog link to version notifiers

- Enhance PR merge readiness checks with branch state validation

- Add PR creation workflow for task worktrees

- Add prominent verdict summary to PR review comments

- Add Dart/Flutter/Melos support to security profiles

- Custom Anthropic compatible API profile management

- Add terminal dropdown with inbuilt and external options in task review

- Centralize CLI tool path management

- Add terminal support for worktrees

- Add Files tab to task details panel

- Enhance PR review page to include PRs filters

- Add GitLab integration

- Add Flatpak packaging support for Linux

- Bundle Python 3.12 with packaged Electron app

- Add iOS/Swift project detection

- Add automated PR review with follow-up support

- Add i18n internationalization system

- Add OpenRouter as LLM/embedding provider

- Add UI scale feature with 75-200% range

### 🛠️ Improvements

- Extract shared task form components for consistent modals

- Simplify task description handling and improve modal layout

- Replace confidence scoring with evidence-based validation in GitHub reviews

- Convert synchronous I/O to async operations in worktree handlers

- Remove top bars from UI

- Improve task card title readability

- Add path-aware AI merge resolution and device code streaming

- Increase Claude SDK JSON buffer size to 10MB

- Improve performance by removing projectTabs from useEffect dependencies

- Normalize feature status values for Kanban display

- Improve GLM presets, ideation auth, and Insights env

- Detect and clear cross-platform CLI paths in settings

- Improve CLI tool detection and add Claude CLI path settings

- Multiple bug fixes including binary file handling and semantic tracking

- Centralize Claude CLI invocation across the application

- Improve PR review with structured outputs and fork support

- Improve task card description truncation for better display

- Improve GitHub PR review with better evidence-based findings

### 🐛 Bug Fixes

- Implement atomic JSON writes to prevent file corruption

- Prevent "Render frame was disposed" crash in frontend

- Strip ANSI escape codes from roadmap/ideation progress messages

- Resolve integrations freeze and improve rate limit handling

- Use shared project-wide memory for cross-spec learning

- Add isinstance(dict) validation to Graphiti to prevent AttributeError

- Enforce implementation_plan schema in planner

- Remove obsolete @lydell/node-pty extraResources entry from build

- Add Post Clean Review button for clean PR reviews

- Fix Kanban status flip-flop and phase state inconsistency

- Resolve multiple merge-related issues affecting worktree operations

- Show running review state when switching back to PR with in-progress review

- Properly quote Windows .cmd/.bat paths in spawn() calls

- Improve Claude CLI detection on Windows with space-containing paths

- Display subtask titles instead of UUIDs in UI

- Use HTTP for Azure Trusted Signing timestamp URL in CI

- Fix Kanban state transitions and status flip-flop bug

- Use selectedPR from hook to restore Files changed list

- Automate auto labeling based on comments

- Fix subtasks tab not updating on Linux

- Add PYTHONPATH to subprocess environment for bundled packages

- Prevent crash after worktree creation in terminal

- Ensure PATH includes system directories when launched from Electron

- Grant worktree access to original project directories

- Filter task IPC events by project to prevent cross-project interference

- Verify critical packages exist, not just marker file during Python bundling

- Await async sendMessage to prevent race condition in insights

- Add pywin32 dependency for LadybugDB on Windows

- Handle Ollama version errors during model pull

- Add helpful error message when Python dependencies are missing

- Prevent app freeze by making Claude CLI detection non-blocking

- Use Homebrew for Ollama installation on macOS

- Use --continue instead of --resume for Claude session restoration

- Add context menu for keyboard-accessible task status changes

- Security allowlist now works correctly in worktree mode

- Fix InvestigationDialog overflow issue

- Auto-create .env from .env.example during backend install

- Show OAuth terminal during profile authentication

- Pass augmented env to Claude CLI validation on macOS

- Fix Git bash path detection on Windows

- Support API profiles in auth check and model resolution

- Window size adjustment on Hi-DPI displays

- Centralize Claude CLI invocation

- Pass OAuth token to Python runner subprocesses for GitHub operations

- Resolve React Fast Refresh hook error in usePtyProcess

- Detect @lydell/node-pty prebuilts in postinstall

- Detect Claude CLI installed via NVM on Linux/macOS

- Allow toggle deselection and improve embedding model name matching

- Sanitize environment to prevent PYTHONHOME contamination

- Check .claude.json for OAuth auth in profile scorer

- Use shell mode for Windows command spawning in MCP

- Update TaskCard description truncation for improved display

- Change hardcoded Opus defaults to Sonnet

- Include update manifests for architecture-specific auto-updates

- Fix security hook cwd extraction and PATH issues

- Filter empty env vars to prevent OAuth token override

- Persist human_review status (worktree plan path fix)

- Resolve PATH and PYTHONPATH issues in insights and changelog services

- Pass electron version explicitly to electron-rebuild on Windows

- Complete refresh button implementation for Kanban

- Fixed version-specific links in readme and pre-commit hook

- Preserve terminal state when switching projects

- Close parent modal when Edit dialog opens

- Solve LadybugDB problem on Windows during npm install

- Handle Windows CRLF line endings in regex fallback

- Respect preferred terminal setting for Windows PTY shell

- Detect and clear cross-platform CLI paths in settings

- Preserve original task description after spec creation

- Fix learning loop to retrieve patterns and gotchas

- Resolve frontend lag and update dependencies

- Allow external HTTPS images in Content-Security-Policy

- Use temporary worktree for PR review isolation

- Prefer versioned Homebrew Python over system python3

- Support bun.lock text format for Bun 1.2.0+

- Create spec.md during roadmap-to-task conversion

- Treat LOW-only findings as ready to merge in PR review

- Prevent infinite re-render loop in task selection

- Accept Python 3.12+ in install-backend.js

- Infinite loop in useTaskDetail merge preview loading

- Resolve EINVAL error when opening worktree in VS Code on Windows

- Add fallback to prevent tasks stuck in ai_review status

- Add spec_dir to SDK permissions

- Add --base-branch argument support to spec_runner

- Allow Windows to run PR Reviewer

- Respect task_metadata.json model selection

- Add .js extension to electron-log/main imports

- Move Swift detection before Ruby detection in analyzer

- Prevent TaskEditDialog from unmounting when opened

- Add iOS/Swift project detection

- Memory Status card respects configured embedding provider

- Remove projectTabs from useEffect dependencies to fix re-render loop

- Invalidate profile cache when file is created/modified

- Handle Python paths with spaces in subprocess

- Preserve terminal state when switching projects

- Add C#/Java/Swift/Kotlin project files to security hash

- Make backend tests pass on Windows

- Stop tracking spec files in git

- Sync status to worktree implementation plan to prevent reset

- Fix task status persistence reverting on refresh

- Proper semver comparison for pre-release versions

- Use venv Python for all services to fix dotenv errors

- Use explicit Windows System32 tar path in build

- Use PowerShell for tar extraction on Windows

- Add --force-local flag to tar on Windows

- Add explicit GET method to gh api comment fetches

- Support archiving tasks across all worktree locations

- Validate backend source path before using it

- Resolve spawn python ENOENT error on Linux

- Resolve CodeQL file system race conditions and unused variables

- Use correct electron-builder arch flags

- Use develop branch for dry-run builds in beta-release workflow

- Accept bug_fix workflow_type alias during planning

- Normalize relative paths to posix

- Update path resolution for ollama_model_detector.py in memory handlers

- Resolve Python detection and backend packaging issues

- Add future annotations import to discovery.py

- Add global spec numbering lock to prevent collisions

- Add Python 3.10+ version validation and GitHub Actions Python setup

- Correct welcome workflow PR message

- Hide status badge when execution phase badge is showing

- Stop running process when task status changes away from in_progress

- Remove legacy path from auto-claude source detection

- Resolve Python environment race condition

- Persist staged task state across app restarts

- Update progress calculation to include just-completed ideation type

- Add missing ARIA attributes for screen reader accessibility

- Restore missing aria-label attributes on icon buttons

- Enable scrolling in Project Files list in Task Creation Wizard

---

## What's Changed

- chore: bump version to 2.7.3 by @Test User in 53e2ef6c
- fix(core): implement atomic JSON writes to prevent file corruption (ACS-209) (#915) by @StillKnotKnown in 3c56a1ba
- fix(frontend): prevent "Render frame was disposed" crash (ACS-211) (#918) by @StillKnotKnown in 179744e2
- fix(frontend): strip ANSI escape codes from roadmap/ideation progress messages (ACS-219) (#933) by @StillKnotKnown in 9e86de76
- fix(ACS-175): Resolve integrations freeze and improve rate limit handling (#839) by @Michael Ludlow in 3ca15e1c
- fix(memory): use shared project-wide memory for cross-spec learning (#905) by @StillKnotKnown in 0c139add
- fix(graphiti): add isinstance(dict) validation to prevent AttributeError (ACS-215) (#924) by @StillKnotKnown in d9e3b286
- fix(planner): enforce implementation_plan schema (issue #884) (#912) by @Umaru in 29d28bf0
- fix(build): remove obsolete @lydell/node-pty extraResources entry by @Test User in c4e08aee
- fix(ui): add Post Clean Review button for clean PR reviews (ACS-201) (#894) by @StillKnotKnown in f43c7c51
- fix(ACS-203): Fix Kanban status flip-flop and phase state inconsistency (#898) by @StillKnotKnown in 96fc6129
- fix(merge): resolve multiple merge-related issues (ACS-194, ACS-179, ACS-174, ACS-163) (#885) by @StillKnotKnown in d024eec1
- fix(github-prs): show running review state when switching back to PR with in-progress review (ACS-200) (#890) by @StillKnotKnown in d9ed8179
- fix: properly quote Windows .cmd/.bat paths in spawn() calls (#889) by @StillKnotKnown in 6dc538c8
- Fix/worktree branch selection (#854) by @Andy in a6bd8842
- refactor(ui): extract shared task form components for consistent modals (#765) by @Andy in df540ec5
- fix(ui): persist staged task state across app restarts (#800) by @Andy in 91bd2401
- fix: improve Claude CLI detection on Windows with space-containing paths (#827) by @Umaru in 11710c55
- fix(ui): display subtask titles instead of UUIDs (#844) (#849) by @Andy in 660e1ada
- fix(ci): use HTTP for Azure Trusted Signing timestamp URL (#843) by @Andy in 152678bd
- fix(ACS-51, ACS-55, ACS-71): Fix Kanban state transitions and status flip-flop bug (#824) by @Adam Slaker in dc29794e
- fix(github): use selectedPR from hook to restore Files changed list (#822) by @StillKnotKnown in c623ab00
- ci(release): add Azure Trusted Signing for Windows builds (#805) by @Andy in 20458849
- feat: Add Sentry environment variables to CI build workflows (#803) by @Andy in 63e142ae
- Fix pydantic_core missing module error during packaging (#806) by @Maxim Kosterin in 07ae1ef7
- feat: add Claude Code changelog link to version notifiers (#820) by @StillKnotKnown in ada91fb1
- feat(github): enhance PR merge readiness checks with branch state validation (#751) by @Andy in cbb1cb81
- fix: automate auto labeling based on comments (#812) by @Alex in 32e8fee3
- feat: add PR creation workflow for task worktrees (#677) by @ThrownLemon in a74bd865
- fix: increase Claude SDK JSON buffer size to 10MB (#815) by @StillKnotKnown in e310d56f
- fix(a11y): restore missing aria-label attributes on icon buttons (#808) by @Orinks in ab3149fc
- feat: Add terminal copy/paste keyboard shortcuts for Windows/Linux (#786) by @StillKnotKnown in a6ffd0e1
- fix(ui): enable scrolling in Project Files list in Task Creation Wizard (#757) (#785) by @Ashwinhegde19 in 05c652e4
- fix: resolve subtasks tab not updating on Linux (#794) by @StillKnotKnown in 29ef46d7
- fix: add PYTHONPATH to subprocess environment for bundled packages (#139) (#777) by @Andy in a47354b4
- fix(terminal): prevent crash after worktree creation (#771) by @Andy in 40fc7e4d
- feat(pr-review): add prominent verdict summary to PR review comments (#780) by @Andy in 63766f76
- fix(frontend): ensure PATH includes system directories when launched (#748) by @Marcelo Czerewacz in 4cc9198a
- fix(permissions): grant worktree access to original project directories (#385) (#776) by @Andy in 42033412
- fix(multi-project): filter task IPC events by project to prevent cross-project interference (#723) (#775) by @Andy in cc78d7ae
- fix(python-bundling): verify critical packages exist, not just marker file (#416) (#774) by @Andy in 061411d7
- fix(insights): await async sendMessage to prevent race condition (#613) (#773) by @Andy in cbd47f2c
- fix(windows): add pywin32 dependency for LadybugDB (#627) (#778) by @Andy in fbaf2e7a
- fix(memory): handle Ollama version errors during model pull (#760) by @Brett Bonner in 01decaeb
- ACS-103 Windows can finish a task (#739) by @Alex in 96b7eb4a
- fix(roadmap): normalize feature status values for Kanban display [ACS-115] (#763) by @Michael Ludlow in 5e783908
- fix: add helpful error message when Python dependencies are missing (ACS-145) (#755) by @StillKnotKnown in 31519c2a
- fix(startup): prevent app freeze by making Claude CLI detection non-blocking (#680 regression) (#720) by @Adam Slaker in f4069590
- refactor: simplify task description handling and improve modal layout (#750) by @Andy in e3d72d64
- fix(memory): use Homebrew for Ollama installation on macOS (#742) by @Michael Ludlow in e9c859cc
- fix: use --continue instead of --resume for Claude session restoration (#699) by @Andy in 7fda36ad
- fix: Multiple bug fixes including binary file handling and semantic tracking (#732) by @Andy in 78b80bca
- fix(a11y): Add context menu for keyboard-accessible task status changes (#710) by @Orinks in 724ad827
- Fix: Security allowlist not working in worktree mode (#646) by @arcker in 2f321fb2
- fix: InvestigationDialog overflow issue (#669) by @Masanori Uehara in df57fbf8
- fix(setup): auto-create .env from .env.example during backend install (#713) by @Crimson341 in 84bc5226
- fix: show OAuth terminal during profile authentication (#671) by @Bogdan Dragomir in 8a4b5066
- fix: pass augmented env to Claude CLI validation on macOS (#640) by @tallinn102 in 574cd117
- fix: WIndows not finding the gith bash path (#724) by @Alex in 09aa4f4f
- fix(profiles): support API profiles in auth check and model resolution (#608) by @Ginanjar Noviawan in 78aceaed
- Fix Window Size on Hi-DPI Displays (#696) by @aaronson2012 in 5005e56e
- fix: centralize Claude CLI invocation (#680) by @StillKnotKnown in ec4441c1
- fix(github): pass OAuth token to Python runner subprocesses (fixes #563) (#698) by @Michael Ludlow in 97f34496
- chore: Update Linux app icon to use multiple resolution sizes and fix .deb icon (#672) by @Rooki in 2c9fcbf4
- fix(a11y): Add missing ARIA attributes for screen reader accessibility (#634) by @Orinks in 3930b12c
- docs: add stars badge and star history chart to README (#675) by @eddie333016 in e2937320
- fix(terminal): resolve React Fast Refresh hook error in usePtyProcess by @AndyMik90 in 81afc3d2
- sentry dev support + sessions handling in terminals by @AndyMik90 in 63f46173
- fix(frontend): detect @lydell/node-pty prebuilts in postinstall (#673) by @Vinícius Santos in 35573fd5
- Fix/small fixes all around (#645) by @Andy in 7b4993e9
- fix: detect Claude CLI installed via NVM on Linux/macOS (#623) by @StillKnotKnown in c2713543
- fix: improve GLM presets, ideation auth, and Insights env (#648) by @StillKnotKnown in 6fb2d484
- Fix/update app (#594) by @Andy in 1e3e8bda
- feat(sentry): add anonymous error reporting with privacy controls (#636) by @Andy in 8be0e6ff
- fix(settings): allow toggle deselection and improve embedding model name matching (#661) by @Michael Ludlow in 234d44f6
- fix(python): sanitize environment to prevent PYTHONHOME contamination (#664) by @Michael Ludlow in 65f60898
- fix: check .claude.json for OAuth auth in profile scorer (#652) by @Michael Ludlow in eeef8a3d
- fix(mcp): use shell mode for Windows command spawning (#572) by @Andy in e1e89430
- fix(ui): update TaskCard description truncation for improved display (#637) by @Andy in b7203124
- fix: change hardcoded Opus defaults to Sonnet (fix #433) (#633) by @Michael Ludlow in 46c41f8f
- Fix/small fixes 2.7.3 (#631) by @Andy in 39da8193
- fix(ci): include update manifests for architecture-specific auto-updates (#611) by @Hunter Luisi in f7b02e87
- fix: security hook cwd extraction and PATH issues (#555, #556) (#587) by @Hunter Luisi in 4ec9db8c
- fix(frontend): filter empty env vars to prevent OAuth token override (#520) by @Ashwinhegde19 in 556f0b21
- refactor(github-review): replace confidence scoring with evidence-based validation (#628) by @Andy in acdd7d9b
- feat(terminal): add worktree support for terminals (#625) by @Andy in 13535f1b
- fix: human_review status persistence bug (worktree plan path fix) (#605) by @Michael Ludlow in 7177c799
- fix(frontend): resolve PATH and PYTHONPATH issues in insights and changelog services (#558) (#610) by @Hunter Luisi in f5be7943
- fix: pass electron version explicitly to electron-rebuild on Windows (#622) by @Vinícius Santos in 14b3db56
- fix(kanban): complete refresh button implementation (#584) by @Michael Ludlow in 6c855905
- feat: add Dart/Flutter/Melos support to security profiles (#583) by @Mitsu in 4a833048
- docs: update stable download links to v2.7.2 (#579) by @Alex in 5efc2c56
- Improving Task Card Title Readability (#461) by @Vinícius Santos in 3086233f
- feat: custom Anthropic compatible API profile management (#181) by @Ginanjar Noviawan in d278963b
- 2.7.2 release by @AndyMik90 in 6ac3012f
- fix: Solve ladybug problem on running npm install all on windows (#576) by @Alex in effaa681
- fix(merge): handle Windows CRLF line endings in regex fallback by @AndyMik90 in 04de8c78
- ci(release): add CHANGELOG.md validation and fix release workflow by @AndyMik90 in 6d4231ed
- 🔥 hotfix(electron): restore app functionality on Windows broken by GPU cache errors (#569) by @sniggl in dedd0757
- fix(ci): cache pip wheels to speed up Intel Mac builds by @AndyMik90 in 90dddc28
- feat(terminal): respect preferred terminal setting for Windows PTY shell by @AndyMik90 in 90a20320
- fix(ci): add Python setup to beta-release and fix PR status gate checks (#565) by @Andy in c2148bb9
- fix: detect and clear cross-platform CLI paths in settings (#535) by @Andy in 29e45505
- fix(ui): preserve original task description after spec creation (#536) by @Andy in 7990dcb4
- fix(memory): fix learning loop to retrieve patterns and gotchas (#530) by @Andy in f58c2578
- fix: resolve frontend lag and update dependencies (#526) by @Andy in 30f7951a
- fix(csp): allow external HTTPS images in Content-Security-Policy (#549) by @Michael Ludlow in 3db02c5d
- fix(pr-review): use temporary worktree for PR review isolation (#532) by @Andy in 344ec65e
- fix: prefer versioned Homebrew Python over system python3 (#494) by @Navid in 8d58dd6f
- fix(detection): support bun.lock text format for Bun 1.2.0+ (#525) by @Andy in 4da8cd66
- chore: bump version to 2.7.2-beta.12 (#460) by @Andy in 8e5c11ac
- Fix/windows issues (#471) by @Andy in 72106109
- fix(ci): add Rust toolchain for Intel Mac builds (#459) by @Andy in 52a4fcc6
- fix: create spec.md during roadmap-to-task conversion (#446) by @Mulaveesala Pranaveswar in fb6b7fc6
- fix(pr-review): treat LOW-only findings as ready to merge (#455) by @Andy in 0f9c5b84
- Fix/2.7.2 beta12 (#424) by @Andy in 5d8ede23
- feat: remove top bars (#386) by @Vinícius Santos in da31b687
- fix: prevent infinite re-render loop in task selection useEffect (#442) by @Abe Diaz in 2effa535
- fix: accept Python 3.12+ in install-backend.js (#443) by @Abe Diaz in c15bb311
- fix: infinite loop in useTaskDetail merge preview loading (#444) by @Abe Diaz in 203a970a
- fix(windows): resolve EINVAL error when opening worktree in VS Code (#434) by @Vinícius Santos in 3c0708b7
- feat(frontend): Add Files tab to task details panel (#430) by @Mitsu in 666794b5
- refactor: remove deprecated TaskDetailPanel component (#432) by @Mitsu in ac8dfcac
- fix(ui): add fallback to prevent tasks stuck in ai_review status (#397) by @Michael Ludlow in 798ca79d
- feat: Enhance the look of the PR Detail area (#427) by @Alex in bdb01549
- ci: remove conventional commits PR title validation workflow by @AndyMik90 in 515b73b5
- fix(client): add spec_dir to SDK permissions (#429) by @Mitsu in 88c76059
- fix(spec_runner): add --base-branch argument support (#428) by @Mitsu in 62a75515
- feat: enhance pr review page to include PRs filters (#423) by @Alex in 717fba04
- feat: add gitlab integration (#254) by @Mitsu in 0a571d3a
- fix: Allow windows to run CC PR Reviewer (#406) by @Alex in 2f662469
- fix(model): respect task_metadata.json model selection (#415) by @Andy in e7e6b521
- feat(build): add Flatpak packaging support for Linux (#404) by @Mitsu in 230de5fc
- fix(github): pass repo parameter to GHClient for explicit PR resolution (#413) by @Andy in 4bdf7a0c
- chore(ci): remove redundant CLA GitHub Action workflow by @AndyMik90 in a39ea49d
- fix(frontend): add .js extension to electron-log/main imports by @AndyMik90 in 9aef0dd0
- fix: 2.7.2 bug fixes and improvements (#388) by @Andy in 05131217
- fix(analyzer): move Swift detection before Ruby detection (#401) by @Michael Ludlow in 321c9712
- fix(ui): prevent TaskEditDialog from unmounting when opened (#395) by @Michael Ludlow in 98b12ed8
- fix: improve CLI tool detection and add Claude CLI path settings (#393) by @Joe in aaa83131
- feat(analyzer): add iOS/Swift project detection (#389) by @Michael Ludlow in 68548e33
- fix(github): improve PR review with structured outputs and fork support (#363) by @Andy in 7751588e
- fix(ideation): update progress calculation to include just-completed ideation type (#381) by @Illia Filippov in 8b4ce58c
- Fixes failing spec - "gh CLI Check Handler - should return installed: true when gh CLI is found" (#370) by @Ian in bc220645
- fix: Memory Status card respects configured embedding provider (#336) (#373) by @Michael Ludlow in db0cbea3
- fix: fixed version-specific links in readme and pre-commit hook that updates them (#378) by @Ian in 0ca2e3f6
- docs: add security research documentation (#361) by @Brian in 2d3b7fb4
- fix/Improving UX for Display/Scaling Changes (#332) by @Kevin Rajan in 9bbdef09
- fix(perf): remove projectTabs from useEffect deps to fix re-render loop (#362) by @Michael Ludlow in 753dc8bb
- fix(security): invalidate profile cache when file is created/modified (#355) by @Michael Ludlow in 20f20fa3
- fix(subprocess): handle Python paths with spaces (#352) by @Michael Ludlow in eabe7c7d
- fix: Resolve pre-commit hook failures with version sync, pytest path, ruff version, and broken quality-dco workflow (#334) by @Ian in 1fa7a9c7
- fix(terminal): preserve terminal state when switching projects (#358) by @Andy in 7881b2d1
- fix(analyzer): add C#/Java/Swift/Kotlin project files to security hash (#351) by @Michael Ludlow in 4e71361b
- fix: make backend tests pass on Windows (#282) by @Oluwatosin Oyeladun in 4dcc5afa
- fix(ui): close parent modal when Edit dialog opens (#354) by @Michael Ludlow in e9782db0
- chore: bump version to 2.7.2-beta.10 by @AndyMik90 in 40d04d7c
- feat: add terminal dropdown with inbuilt and external options in task review (#347) by @JoshuaRileyDev in fef07c95
- refactor: remove deprecated code across backend and frontend (#348) by @Mitsu in 9d43abed
- feat: centralize CLI tool path management (#341) by @HSSAINI Saad in d51f4562
- refactor(components): remove deprecated TaskDetailPanel re-export (#344) by @Mitsu in 787667e9
- chore: Refactor/kanban realtime status sync (#249) by @souky-byte in 9734b70b
- refactor(settings): remove deprecated ProjectSettings modal and hooks (#343) by @Mitsu in fec6b9f3
- perf: convert synchronous I/O to async operations in worktree handlers (#337) by @JoshuaRileyDev in d3a63b09
- feat: bump version (#329) by @Alex in 50e3111a
- fix(ci): remove version bump to fix branch protection conflict (#325) by @Michael Ludlow in 8a80b1d5
- fix(tasks): sync status to worktree implementation plan to prevent reset (#243) (#323) by @Alex in cb6b2165
- fix(ci): add auto-updater manifest files and version auto-update (#317) by @Michael Ludlow in 661e47c3
- fix(project): fix task status persistence reverting on refresh (#246) (#318) by @Michael Ludlow in e80ef79d
- fix(updater): proper semver comparison for pre-release versions (#313) by @Michael Ludlow in e1b0f743
- fix(python): use venv Python for all services to fix dotenv errors (#311) by @Alex in 92c6f278
- chore(ci): cancel in-progress runs (#302) by @Oluwatosin Oyeladun in 1c142273
- fix(build): use explicit Windows System32 tar path (#308) by @Andy in c0a02a45
- fix(github): add augmented PATH env to all gh CLI calls by @AndyMik90 in 086429cb
- fix(build): use PowerShell for tar extraction on Windows by @AndyMik90 in d9fb8f29
- fix(build): add --force-local flag to tar on Windows (#303) by @Andy in d0b0b3df
- fix: stop tracking spec files in git (#295) by @Andy in 937a60f8
- Fix/2.7.2 fixes (#300) by @Andy in 7a51cbd5
- feat(merge,oauth): add path-aware AI merge resolution and device code streaming (#296) by @Andy in 26beefe3
- feat: enhance the logs for the commit linting stage (#293) by @Alex in 8416f307
- fix(github): add explicit GET method to gh api comment fetches (#294) by @Andy in 217249c8
- fix(frontend): support archiving tasks across all worktree locations (#286) by @Andy in 8bb3df91
- Potential fix for code scanning alert no. 224: Uncontrolled command line (#285) by @Andy in 5106c6e9
- fix(frontend): validate backend source path before using it (#287) by @Andy in 3ff61274
- feat(python): bundle Python 3.12 with packaged Electron app (#284) by @Andy in 7f19c2e1
- fix: resolve spawn python ENOENT error on Linux by using getAugmentedEnv() (#281) by @Todd W. Bucy in d98e2830
- fix(ci): add write permissions to beta-release update-version job by @AndyMik90 in 0b874d4b
- chore(deps): bump @xterm/xterm from 5.5.0 to 6.0.0 in /apps/frontend (#270) by @dependabot[bot] in 50dd1078
- fix(github): resolve follow-up review API issues by @AndyMik90 in f1cc5a09
- fix(security): resolve CodeQL file system race conditions and unused variables (#277) by @Andy in b005fa5c
- fix(ci): use correct electron-builder arch flags (#278) by @Andy in d79f2da4
- chore(deps): bump jsdom from 26.1.0 to 27.3.0 in /apps/frontend (#268) by @dependabot[bot] in 5ac566e2
- chore(deps): bump typescript-eslint in /apps/frontend (#269) by @dependabot[bot] in f49d4817
- fix(ci): use develop branch for dry-run builds in beta-release workflow (#276) by @Andy in 1e1d7d9b
- fix: accept bug_fix workflow_type alias during planning (#240) by @Daniel Frey in e74a3dff
- fix(paths): normalize relative paths to posix (#239) by @Daniel Frey in 6ac8250b
- chore(deps): bump @electron/rebuild in /apps/frontend (#271) by @dependabot[bot] in a2cee694
- chore(deps): bump vitest from 4.0.15 to 4.0.16 in /apps/frontend (#272) by @dependabot[bot] in d4cad80a
- feat(github): add automated PR review with follow-up support (#252) by @Andy in 596e9513
- ci: implement enterprise-grade PR quality gates and security scanning (#266) by @Alex in d42041c5
- fix: update path resolution for ollama_model_detector.py in memory handlers (#263) by @delyethan in a3f87540
- feat: add i18n internationalization system (#248) by @Mitsu in f8438112
- Revert "Feat/Auto Fix Github issues and do extensive AI PR reviews (#250)" (#251) by @Andy in 5e8c5308
- Feat/Auto Fix Github issues and do extensive AI PR reviews (#250) by @Andy in 348de6df
- fix: resolve Python detection and backend packaging issues (#241) by @HSSAINI Saad in 0f7d6e05
- fix: add future annotations import to discovery.py (#229) by @Joris Slagter in 5ccdb6ab
- Fix/ideation status sync (#212) by @souky-byte in 6ec8549f
- fix(core): add global spec numbering lock to prevent collisions (#209) by @Andy in 53527293
- feat: Add OpenRouter as LLM/embedding provider (#162) by @Fernando Possebon in 02bef954
- fix: Add Python 3.10+ version validation and GitHub Actions Python setup (#180 #167) (#208) by @Fernando Possebon in f168bdc3
- fix(ci): correct welcome workflow PR message (#206) by @Andy in e3eec68a
- Feat/beta release (#193) by @Andy in 407a0bee
- feat/beta-release (#190) by @Andy in 8f766ad1
- fix/PRs from old main setup to apps structure (#185) by @Andy in ced2ad47
- fix: hide status badge when execution phase badge is showing (#154) by @Andy in 05f5d303
- feat: Add UI scale feature with 75-200% range (#125) by @Enes Cingöz in 6951251b
- fix(task): stop running process when task status changes away from in_progress by @AndyMik90 in 30e7536b
- Fix/linear 400 error by @Andy in 220faf0f
- fix: remove legacy path from auto-claude source detection (#148) by @Joris Slagter in f96c6301
- fix: resolve Python environment race condition (#142) by @Joris Slagter in ebd8340d
- Feat: Ollama download progress tracking with new apps structure (#141) by @rayBlock in df779530
- Feature/apps restructure v2.7.2 (#138) by @Andy in 0adaddac
- docs: Add Git Flow branching strategy to CONTRIBUTING.md by @AndyMik90 in 91f7051d

## Thanks to all contributors

@Test User, @StillKnotKnown, @Umaru, @Andy, @Adam Slaker, @Michael Ludlow, @Maxim Kosterin, @ThrownLemon, @Ashwinhegde19, @Orinks, @Marcelo Czerewacz, @Brett Bonner, @Alex, @Rooki, @eddie333016, @AndyMik90, @Vinícius Santos, @arcker, @Masanori Uehara, @Crimson341, @Bogdan Dragomir, @tallinn102, @Ginanjar Noviawan, @aaronson2012, @Hunter Luisi, @Navid, @Mulaveesala Pranaveswar, @sniggl, @Abe Diaz, @Mitsu, @Joe, @Illia Filippov, @Ian, @Brian, @Kevin Rajan, @HSSAINI Saad, @JoshuaRileyDev, @souky-byte, @Alex, @Oluwatosin Oyeladun, @Daniel Frey, @delyethan, @Joris Slagter, @Fernando Possebon, @Enes Cingöz, @Todd W. Bucy, @dependabot[bot], @rayBlock

## 2.7.2 - Stability & Performance Enhancements

### ✨ New Features

- Added refresh button to Kanban board for manually reloading tasks

- Terminal dropdown with built-in and external options in task review

- Centralized CLI tool path management with customizable settings

- Files tab in task details panel for better file organization

- Enhanced PR review page with filtering capabilities

- GitLab integration support

- Automated PR review with follow-up support and structured outputs

- UI scale feature with 75-200% range for accessibility

- Python 3.12 bundled with packaged Electron app

- OpenRouter support as LLM/embedding provider

- Internationalization (i18n) system for multi-language support

- Flatpak packaging support for Linux

- Path-aware AI merge resolution with device code streaming

### 🛠️ Improvements

- Improved terminal experience with persistent state when switching projects

- Enhanced PR review with structured outputs and fork support

- Better UX for display and scaling changes

- Convert synchronous I/O to async operations in worktree handlers

- Enhanced logs for commit linting stage

- Remove top navigation bars for cleaner UI

- Enhanced PR detail area visual design

- Improved CLI tool detection with more language support

- Added iOS/Swift project detection

- Optimize performance by removing projectTabs from useEffect dependencies

- Improved Python detection and version validation for compatibility

### 🐛 Bug Fixes

- Fixed CI Python setup and PR status gate checks

- Fixed cross-platform CLI path detection and clearing in settings

- Preserve original task description after spec creation

- Fixed learning loop to retrieve patterns and gotchas from memory

- Resolved frontend lag and updated dependencies

- Fixed Content-Security-Policy to allow external HTTPS images

- Fixed PR review isolation by using temporary worktree

- Fixed Homebrew Python detection to prefer versioned Python over system python3

- Added support for Bun 1.2.0+ lock file format detection

- Fixed infinite re-render loop in task selection

- Fixed infinite loop in task detail merge preview loading

- Resolved Windows EINVAL error when opening worktree in VS Code

- Fixed fallback to prevent tasks stuck in ai_review status

- Fixed SDK permissions to include spec_dir

- Added --base-branch argument support to spec_runner

- Allow Windows to run CC PR Reviewer

- Fixed model selection to respect task_metadata.json

- Improved GitHub PR review by passing repo parameter explicitly

- Fixed electron-log imports with .js extension

- Fixed Swift detection order in project analyzer

- Prevent TaskEditDialog from unmounting when opened

- Fixed subprocess handling for Python paths with spaces

- Fixed file system race conditions and unused variables in security scanning

- Resolved Python detection and backend packaging issues

- Fixed version-specific links in README and pre-commit hooks

- Fixed task status persistence reverting on refresh

- Proper semver comparison for pre-release versions

- Use virtual environment Python for all services to fix dotenv errors

- Fixed explicit Windows System32 tar path for builds

- Added augmented PATH environment to all GitHub CLI calls

- Use PowerShell for tar extraction on Windows

- Added --force-local flag to tar on Windows

- Stop tracking spec files in git

- Fixed GitHub API calls with explicit GET method for comment fetches

- Support archiving tasks across all worktree locations

- Validated backend source path before using it

- Resolved spawn Python ENOENT error on Linux

- Fixed CodeQL alerts for uncontrolled command line

- Resolved GitHub follow-up review API issues

- Fixed relative path normalization to POSIX format

- Accepted bug_fix workflow_type alias during planning

- Added global spec numbering lock to prevent collisions

- Fixed ideation status sync

- Stopped running process when task status changes away from in_progress

- Removed legacy path from auto-claude source detection

- Resolved Python environment race condition

---

## What's Changed

- fix(ci): add Python setup to beta-release and fix PR status gate checks (#565) by @Andy in c2148bb9
- fix: detect and clear cross-platform CLI paths in settings (#535) by @Andy in 29e45505
- fix(ui): preserve original task description after spec creation (#536) by @Andy in 7990dcb4
- fix(memory): fix learning loop to retrieve patterns and gotchas (#530) by @Andy in f58c2578
- fix: resolve frontend lag and update dependencies (#526) by @Andy in 30f7951a
- feat(kanban): add refresh button to manually reload tasks (#548) by @Adryan Serage in 252242f9
- fix(csp): allow external HTTPS images in Content-Security-Policy (#549) by @Michael Ludlow in 3db02c5d
- fix(pr-review): use temporary worktree for PR review isolation (#532) by @Andy in 344ec65e
- fix: prefer versioned Homebrew Python over system python3 (#494) by @Navid in 8d58dd6f
- fix(detection): support bun.lock text format for Bun 1.2.0+ (#525) by @Andy in 4da8cd66
- chore: bump version to 2.7.2-beta.12 (#460) by @Andy in 8e5c11ac
- Fix/windows issues (#471) by @Andy in 72106109
- fix(ci): add Rust toolchain for Intel Mac builds (#459) by @Andy in 52a4fcc6
- fix: create spec.md during roadmap-to-task conversion (#446) by @Mulaveesala Pranaveswar in fb6b7fc6
- fix(pr-review): treat LOW-only findings as ready to merge (#455) by @Andy in 0f9c5b84
- Fix/2.7.2 beta12 (#424) by @Andy in 5d8ede23
- feat: remove top bars (#386) by @Vinícius Santos in da31b687
- fix: prevent infinite re-render loop in task selection useEffect (#442) by @Abe Diaz in 2effa535
- fix: accept Python 3.12+ in install-backend.js (#443) by @Abe Diaz in c15bb311
- fix: infinite loop in useTaskDetail merge preview loading (#444) by @Abe Diaz in 203a970a
- fix(windows): resolve EINVAL error when opening worktree in VS Code (#434) by @Vinícius Santos in 3c0708b7
- feat(frontend): Add Files tab to task details panel (#430) by @Mitsu in 666794b5
- refactor: remove deprecated TaskDetailPanel component (#432) by @Mitsu in ac8dfcac
- fix(ui): add fallback to prevent tasks stuck in ai_review status (#397) by @Michael Ludlow in 798ca79d
- feat: Enhance the look of the PR Detail area (#427) by @Alex in bdb01549
- ci: remove conventional commits PR title validation workflow by @AndyMik90 in 515b73b5
- fix(client): add spec_dir to SDK permissions (#429) by @Mitsu in 88c76059
- fix(spec_runner): add --base-branch argument support (#428) by @Mitsu in 62a75515
- feat: enhance pr review page to include PRs filters (#423) by @Alex in 717fba04
- feat: add gitlab integration (#254) by @Mitsu in 0a571d3a
- fix: Allow windows to run CC PR Reviewer (#406) by @Alex in 2f662469
- fix(model): respect task_metadata.json model selection (#415) by @Andy in e7e6b521
- feat(build): add Flatpak packaging support for Linux (#404) by @Mitsu in 230de5fc
- fix(github): pass repo parameter to GHClient for explicit PR resolution (#413) by @Andy in 4bdf7a0c
- chore(ci): remove redundant CLA GitHub Action workflow by @AndyMik90 in a39ea49d
- fix(frontend): add .js extension to electron-log/main imports by @AndyMik90 in 9aef0dd0
- fix: 2.7.2 bug fixes and improvements (#388) by @Andy in 05131217
- fix(analyzer): move Swift detection before Ruby detection (#401) by @Michael Ludlow in 321c9712
- fix(ui): prevent TaskEditDialog from unmounting when opened (#395) by @Michael Ludlow in 98b12ed8
- fix: improve CLI tool detection and add Claude CLI path settings (#393) by @Joe in aaa83131
- feat(analyzer): add iOS/Swift project detection (#389) by @Michael Ludlow in 68548e33
- fix(github): improve PR review with structured outputs and fork support (#363) by @Andy in 7751588e
- fix(ideation): update progress calculation to include just-completed ideation type (#381) by @Illia Filippov in 8b4ce58c
- Fixes failing spec - "gh CLI Check Handler - should return installed: true when gh CLI is found" (#370) by @Ian in bc220645
- fix: Memory Status card respects configured embedding provider (#336) (#373) by @Michael Ludlow in db0cbea3
- fix: fixed version-specific links in readme and pre-commit hook that updates them (#378) by @Ian in 0ca2e3f6
- docs: add security research documentation (#361) by @Brian in 2d3b7fb4
- fix/Improving UX for Display/Scaling Changes (#332) by @Kevin Rajan in 9bbdef09
- fix(perf): remove projectTabs from useEffect deps to fix re-render loop (#362) by @Michael Ludlow in 753dc8bb
- fix(security): invalidate profile cache when file is created/modified (#355) by @Michael Ludlow in 20f20fa3
- fix(subprocess): handle Python paths with spaces (#352) by @Michael Ludlow in eabe7c7d
- fix: Resolve pre-commit hook failures with version sync, pytest path, ruff version, and broken quality-dco workflow (#334) by @Ian in 1fa7a9c7
- fix(terminal): preserve terminal state when switching projects (#358) by @Andy in 7881b2d1
- fix(analyzer): add C#/Java/Swift/Kotlin project files to security hash (#351) by @Michael Ludlow in 4e71361b
- fix: make backend tests pass on Windows (#282) by @Oluwatosin Oyeladun in 4dcc5afa
- fix(ui): close parent modal when Edit dialog opens (#354) by @Michael Ludlow in e9782db0
- chore: bump version to 2.7.2-beta.10 by @AndyMik90 in 40d04d7c
- feat: add terminal dropdown with inbuilt and external options in task review (#347) by @JoshuaRileyDev in fef07c95
- refactor: remove deprecated code across backend and frontend (#348) by @Mitsu in 9d43abed
- feat: centralize CLI tool path management (#341) by @HSSAINI Saad in d51f4562
- refactor(components): remove deprecated TaskDetailPanel re-export (#344) by @Mitsu in 787667e9
- chore: Refactor/kanban realtime status sync (#249) by @souky-byte in 9734b70b
- refactor(settings): remove deprecated ProjectSettings modal and hooks (#343) by @Mitsu in fec6b9f3
- perf: convert synchronous I/O to async operations in worktree handlers (#337) by @JoshuaRileyDev in d3a63b09
- feat: bump version (#329) by @Alex in 50e3111a
- fix(ci): remove version bump to fix branch protection conflict (#325) by @Michael Ludlow in 8a80b1d5
- fix(tasks): sync status to worktree implementation plan to prevent reset (#243) (#323) by @Alex in cb6b2165
- fix(ci): add auto-updater manifest files and version auto-update (#317) by @Michael Ludlow in 661e47c3
- fix(project): fix task status persistence reverting on refresh (#246) (#318) by @Michael Ludlow in e80ef79d
- fix(updater): proper semver comparison for pre-release versions (#313) by @Michael Ludlow in e1b0f743
- fix(python): use venv Python for all services to fix dotenv errors (#311) by @Alex in 92c6f278
- chore(ci): cancel in-progress runs (#302) by @Oluwatosin Oyeladun in 1c142273
- fix(build): use explicit Windows System32 tar path (#308) by @Andy in c0a02a45
- fix(github): add augmented PATH env to all gh CLI calls by @AndyMik90 in 086429cb
- fix(build): use PowerShell for tar extraction on Windows by @AndyMik90 in d9fb8f29
- fix(build): add --force-local flag to tar on Windows (#303) by @Andy in d0b0b3df
- fix: stop tracking spec files in git (#295) by @Andy in 937a60f8
- Fix/2.7.2 fixes (#300) by @Andy in 7a51cbd5
- feat(merge,oauth): add path-aware AI merge resolution and device code streaming (#296) by @Andy in 26beefe3
- feat: enhance the logs for the commit linting stage (#293) by @Alex in 8416f307
- fix(github): add explicit GET method to gh api comment fetches (#294) by @Andy in 217249c8
- fix(frontend): support archiving tasks across all worktree locations (#286) by @Andy in 8bb3df91
- Potential fix for code scanning alert no. 224: Uncontrolled command line (#285) by @Andy in 5106c6e9
- fix(frontend): validate backend source path before using it (#287) by @Andy in 3ff61274
- feat(python): bundle Python 3.12 with packaged Electron app (#284) by @Andy in 7f19c2e1
- fix: resolve spawn python ENOENT error on Linux by using getAugmentedEnv() (#281) by @Todd W. Bucy in d98e2830
- fix(ci): add write permissions to beta-release update-version job by @AndyMik90 in 0b874d4b
- chore(deps): bump @xterm/xterm from 5.5.0 to 6.0.0 in /apps/frontend (#270) by @dependabot[bot] in 50dd1078
- fix(github): resolve follow-up review API issues by @AndyMik90 in f1cc5a09
- fix(security): resolve CodeQL file system race conditions and unused variables (#277) by @Andy in b005fa5c
- fix(ci): use correct electron-builder arch flags (#278) by @Andy in d79f2da4
- chore(deps): bump jsdom from 26.1.0 to 27.3.0 in /apps/frontend (#268) by @dependabot[bot] in 5ac566e2
- chore(deps): bump typescript-eslint in /apps/frontend (#269) by @dependabot[bot] in f49d4817
- fix(ci): use develop branch for dry-run builds in beta-release workflow (#276) by @Andy in 1e1d7d9b
- fix: accept bug_fix workflow_type alias during planning (#240) by @Daniel Frey in e74a3dff
- fix(paths): normalize relative paths to posix (#239) by @Daniel Frey in 6ac8250b
- chore(deps): bump @electron/rebuild in /apps/frontend (#271) by @dependabot[bot] in a2cee694
- chore(deps): bump vitest from 4.0.15 to 4.0.16 in /apps/frontend (#272) by @dependabot[bot] in d4cad80a
- feat(github): add automated PR review with follow-up support (#252) by @Andy in 596e9513
- ci: implement enterprise-grade PR quality gates and security scanning (#266) by @Alex in d42041c5
- fix: update path resolution for ollama_model_detector.py in memory handlers (#263) by @delyethan in a3f87540
- feat: add i18n internationalization system (#248) by @Mitsu in f8438112
- Revert "Feat/Auto Fix Github issues and do extensive AI PR reviews (#250)" (#251) by @Andy in 5e8c5308
- Feat/Auto Fix Github issues and do extensive AI PR reviews (#250) by @Andy in 348de6df
- fix: resolve Python detection and backend packaging issues (#241) by @HSSAINI Saad in 0f7d6e05
- fix: add future annotations import to discovery.py (#229) by @Joris Slagter in 5ccdb6ab
- Fix/ideation status sync (#212) by @souky-byte in 6ec8549f
- fix(core): add global spec numbering lock to prevent collisions (#209) by @Andy in 53527293
- feat: Add OpenRouter as LLM/embedding provider (#162) by @Fernando Possebon in 02bef954
- fix: Add Python 3.10+ version validation and GitHub Actions Python setup (#180 #167) (#208) by @Fernando Possebon in f168bdc3
- fix(ci): correct welcome workflow PR message (#206) by @Andy in e3eec68a
- Feat/beta release (#193) by @Andy in 407a0bee
- feat/beta-release (#190) by @Andy in 8f766ad1
- fix/PRs from old main setup to apps structure (#185) by @Andy in ced2ad47
- fix: hide status badge when execution phase badge is showing (#154) by @Andy in 05f5d303
- feat: Add UI scale feature with 75-200% range (#125) by @Enes Cingöz in 6951251b
- fix(task): stop running process when task status changes away from in_progress by @AndyMik90 in 30e7536b
- Fix/linear 400 error by @Andy in 220faf0f
- fix: remove legacy path from auto-claude source detection (#148) by @Joris Slagter in f96c6301
- fix: resolve Python environment race condition (#142) by @Joris Slagter in ebd8340d
- Feat: Ollama download progress tracking with new apps structure (#141) by @rayBlock in df779530
- Feature/apps restructure v2.7.2 (#138) by @Andy in 0adaddac
- docs: Add Git Flow branching strategy to CONTRIBUTING.md by @AndyMik90 in 91f7051d

## Thanks to all contributors

@Andy, @Adryan Serage, @Michael Ludlow, @Navid, @Mulaveesala Pranaveswar, @Vinícius Santos, @Abe Diaz, @Mitsu, @Alex, @AndyMik90, @Joe, @Illia Filippov, @Ian, @Brian, @Kevin Rajan, @Oluwatosin Oyeladun, @JoshuaRileyDev, @HSSAINI Saad, @souky-byte, @Todd W. Bucy, @dependabot[bot], @Daniel Frey, @delyethan, @Joris Slagter, @Fernando Possebon, @Enes Cingöz, @rayBlock

## 2.7.1 - Build Pipeline Enhancements

### 🛠️ Improvements

- Enhanced VirusTotal scan error handling in release workflow with graceful failure recovery and improved reporting visibility

- Refactored macOS build workflow to support both Intel and ARM64 architectures with notarization for Intel builds and improved artifact handling

- Streamlined CI/CD processes with updated caching strategies and enhanced error handling for external API interactions

### 📚 Documentation

- Clarified README documentation

---

## What's Changed

- chore: Enhance VirusTotal scan error handling in release workflow by @AndyMik90 in d23fcd8

- chore: Refactor macOS build workflow to support Intel and ARM64 architectures by @AndyMik90 in 326118b

- docs: readme clarification by @AndyMik90 in 6afcc92

- fix: version by @AndyMik90 in 2c93890

## Thanks to all contributors

@AndyMik90

## 2.7.0 - Tab Persistence & Memory System Modernization

### ✨ New Features

- Project tab bar with persistent tab management and GitHub organization initialization on project creation

- Task creation enhanced with @ autocomplete for agent profiles and improved drag-and-drop support

- Keyboard shortcuts and tooltips added to project tabs for better navigation

- Agent task restart functionality with new profile support for flexible task recovery

- Ollama embedding model support with automatic dimension detection for self-hosted deployments

### 🛠️ Improvements

- Memory system completely redesigned with embedded LadybugDB, eliminating Docker/FalkorDB dependency and improving performance

- Tab persistence implemented via IPC-based mechanism for reliable session state management

- Terminal environment improved by using virtual environment Python for proper terminal name generation

- AI merge operations timeout increased from 2 to 10 minutes for reliability with larger changes

- Merge operations now use stored baseBranch metadata for consistent branch targeting

- Memory configuration UI simplified and rebranded with improved Ollama integration and detection

- CI/CD workflows enhanced with code signing support and automated release process

- Cross-platform compatibility improved by replacing Unix shell syntax with portable git commands

- Python venv created in userData for packaged applications to ensure proper environment isolation

### 🐛 Bug Fixes

- Task title no longer blocks edit/close buttons in UI

- Tab persistence and terminal shortcuts properly scoped to prevent conflicts

- Agent profile fallback corrected from 'Balanced' to 'Auto (Optimized)'

- macOS notarization made optional and improved with private artifact storage

- Embedding provider changes now properly detected during migration

- Memory query CLI respects user's memory enabled flag

- CodeRabbit review issues and linting errors resolved across codebase

- F-string prefixes removed from strings without placeholders

- Import ordering fixed for ruff compliance

- Preview panel now receives projectPath prop correctly for image component functionality

- Default database path unified to ~/.auto-claude/memories for consistency

- @lydell/node-pty build scripts compatibility improved for pnpm v10

---

## What's Changed

- feat(ui): add project tab bar from PR #101 by @AndyMik90 in c400fe9

- feat: improve task creation UX with @ autocomplete and better drag-drop by @AndyMik90 in 20d1487

- feat(ui): add keyboard shortcuts and tooltips for project tabs by @AndyMik90 in ed73265

- feat(agent): enhance task restart functionality with new profile support by @AndyMik90 in c8452a5

- feat: add Ollama embedding model support with auto-detected dimensions by @AndyMik90 in 45901f3

- feat(memory): replace FalkorDB with LadybugDB embedded database by @AndyMik90 in 87d0b52

- feat: add automated release workflow with code signing by @AndyMik90 in 6819b00

- feat: add embedding provider change detection and fix import ordering by @AndyMik90 in 36f8006

- fix(tests): update tab management tests for IPC-based persistence by @AndyMik90 in ea25d6e

- fix(ui): address CodeRabbit PR review issues by @AndyMik90 in 39ce754

- fix: address CodeRabbit review issues by @AndyMik90 in 95ae0b0

- fix: prevent task title from blocking edit/close buttons by @AndyMik90 in 8a0fb26

- fix: use venv Python for terminal name generation by @AndyMik90 in 325cb54

- fix(merge): increase AI merge timeout from 2 to 10 minutes by @AndyMik90 in 4477538

- fix(merge): use stored baseBranch from task metadata for merge operations by @AndyMik90 in 8d56474

- fix: unify default database path to ~/.auto-claude/memories by @AndyMik90 in 684e3f9

- fix(ui): fix tab persistence and scope terminal shortcuts by @AndyMik90 in 2d1168b

- fix: create Python venv in userData for packaged apps by @AndyMik90 in b83377c

- fix(ui): change agent profile fallback from 'Balanced' to 'Auto (Optimized)' by @AndyMik90 in 385dcc1

- fix: check APPLE_ID in shell instead of workflow if condition by @AndyMik90 in 9eece01

- fix: allow @lydell/node-pty build scripts in pnpm v10 by @AndyMik90 in 1f6963f

- fix: use shell guard for notarization credentials check by @AndyMik90 in 4cbddd3

- fix: improve migrate_embeddings robustness and correctness by @AndyMik90 in 61f0238

- fix: respect user's memory enabled flag in query_memory CLI by @AndyMik90 in 45b2c83

- fix: save notarization logs to private artifact instead of public logs by @AndyMik90 in a82525d

- fix: make macOS notarization optional by @AndyMik90 in f2b7b56

- fix: add author email for Linux builds by @AndyMik90 in 5f66127

- fix: add GH_TOKEN and homepage for release workflow by @AndyMik90 in 568ea18

- fix(ci): quote GITHUB_OUTPUT for shell safety by @AndyMik90 in 1e891e1

- fix: address CodeRabbit review feedback by @AndyMik90 in 8e4b1da

- fix: update test and apply ruff formatting by @AndyMik90 in a087ba3

- fix: address additional CodeRabbit review comments by @AndyMik90 in 461fad6

- fix: sort imports in memory.py for ruff I001 by @AndyMik90 in b3c257d

- fix: address CodeRabbit review comments from PR #100 by @AndyMik90 in 1ed237a

- fix: remove f-string prefixes from strings without placeholders by @AndyMik90 in bcd453a

- fix: resolve remaining CI failures by @AndyMik90 in cfbccda

- fix: resolve all CI failures in PR #100 by @AndyMik90 in c493d6c

- fix(cli): update graphiti status display for LadybugDB by @AndyMik90 in 049c60c

- fix(ui): replace Unix shell syntax with cross-platform git commands by @AndyMik90 in 83aa3f0

- fix: correct model name and release workflow conditionals by @AndyMik90 in de41dfc

- style: fix ruff linting errors in graphiti queries by @AndyMik90 in 127559f

- style: apply ruff formatting to 4 files by @AndyMik90 in 9d5d075

- refactor: update memory test suite for LadybugDB by @AndyMik90 in f0b5efc

- refactor(ui): simplify reference files and images handling in task modal by @AndyMik90 in 1975e4d

- refactor: rebrand memory system UI and simplify configuration by @AndyMik90 in 2b3cd49

- refactor: replace Docker/FalkorDB with embedded LadybugDB for memory system by @AndyMik90 in 325458d

- docs: add CodeRabbit review response tracking by @AndyMik90 in 3452548

- chore: use GitHub noreply email for author field by @AndyMik90 in 18f2045

- chore: simplify notarization step after successful setup by @AndyMik90 in e4fe7cd

- chore: update CI and release workflows, remove changelog config by @AndyMik90 in 6f891b7

- chore: remove docker-compose.yml (FalkorDB no longer used) by @AndyMik90 in 68f3f06

- fix: Replace space with hyphen in productName to fix PTY daemon spawn (#65) by @Craig Van in 8f1f7a7

- fix: update npm scripts to use hyphenated product name by @AndyMik90 in 89978ed

- fix(ui): improve Ollama UX in memory settings by @AndyMik90 in dea1711

- auto-claude: subtask-1-1 - Add projectPath prop to PreviewPanel and implement custom img component by @AndyMik90 in e6529e0

- Project tab persistence and github org init on project creation by @AndyMik90 in ae1dac9

- Readme for installors by @AndyMik90 in 1855d7d

---

## Thanks to all contributors

@AndyMik90, @Craig Van

## 2.6.0 - Improved User Experience and Agent Configuration

### ✨ New Features

- Add customizable phase configuration in app settings, allowing users to tailor the AI build pipeline to their workflow

- Implement parallel AI merge functionality for faster integration of completed builds

- Add Google AI as LLM and embedding provider for Graphiti memory system

- Implement device code authentication flow with timeout handling, browser launch fallback, and comprehensive testing

### 🛠️ Improvements

- Move Agent Profiles from dashboard to Settings for better organization and discoverability

- Default agent profile to 'Auto (Optimized)' for streamlined out-of-the-box experience

- Enhance WorkspaceStatus component UI with improved visual design

- Refactor task management from sidebar to modal interface for cleaner navigation

- Add comprehensive theme system with multiple color schemes (Forest, Neo, Retro, Dusk, Ocean, Lime) and light/dark mode support

- Extract human-readable feature titles from spec.md for better task identification

- Improve task description display for specs with compact markdown formatting

### 🐛 Bug Fixes

- Fix asyncio coroutine creation in worker threads to properly support async operations

- Improve UX for phase configuration in task creation workflow

- Address CodeRabbit PR #69 feedback and additional review comments

- Fix auto-close behavior for task modal when marking tasks as done

- Resolve Python lint errors and import sorting issues (ruff I001 compliance)

- Ensure planner agent properly writes implementation_plan.json

- Add platform detection for terminal profile commands on Windows

- Set default selected agent profile to 'auto' across all users

- Fix display of correct merge target branch in worktree UI

- Add validation for invalid colorTheme fallback to prevent UI errors

- Remove outdated Sun/Moon toggle button from sidebar

---

## What's Changed

- feat: add customizable phase configuration in app settings by @AndyMik90 in aee0ba4

- feat: implement parallel AI merge functionality by @AndyMik90 in 458d4bb

- feat(graphiti): add Google AI as LLM and embedding provider by @adryserage in fe69106

- fix: create coroutine inside worker thread for asyncio.run by @AndyMik90 in f89e4e6

- fix: improve UX for phase configuration in task creation by @AndyMik90 in b9797cb

- fix: address CodeRabbit PR #69 feedback by @AndyMik90 in cc38a06

- fix: sort imports in workspace.py to pass ruff I001 check by @AndyMik90 in 9981ee4

- fix(ui): auto-close task modal when marking task as done by @AndyMik90 in 297d380

- fix: resolve Python lint errors in workspace.py by @AndyMik90 in 0506256

- refactor: move Agent Profiles from dashboard to Settings by @AndyMik90 in 1094990

- fix(planning): ensure planner agent writes implementation_plan.json by @AndyMik90 in 9ab5a4f

- fix(windows): add platform detection for terminal profile commands by @AndyMik90 in f0a6a0a

- fix: default agent profile to 'Auto (Optimized)' for all users by @AndyMik90 in 08aa2ff

- fix: update default selected agent profile to 'auto' by @AndyMik90 in 37ace0a

- style: enhance WorkspaceStatus component UI by @AndyMik90 in 3092155

- fix: display correct merge target branch in worktree UI by @AndyMik90 in 2b96160

- Improvement/refactor task sidebar to task modal by @AndyMik90 in 2a96f85

- fix: extract human-readable title from spec.md when feature field is spec ID by @AndyMik90 in 8b59375

- fix: task descriptions not showing for specs with compact markdown by @AndyMik90 in 7f12ef0

- Add comprehensive theme system with Forest, Neo, Retro, Dusk, Ocean, and Lime color schemes by @AndyMik90 in ba776a3, e2b24e2, 7589046, e248256, 76c1bd7, bcbced2

- Add ColorTheme type and configuration to app settings by @AndyMik90 in 2ca89ce, c505d6e, a75c0a9

- Implement device code authentication flow with timeout handling and fallback URL display by @AndyMik90 in 5f26d39, 81e1536, 1a7cf40, 4a4ad6b, 6a4c1b4, b75a09c, e134c4c

- fix(graphiti): address CodeRabbit review comments by @adryserage in 679b8cd

- fix(lint): sort imports in Google provider files by @adryserage in 1a38a06

## 2.6.0 - Multi-Provider Graphiti Support & Platform Fixes

### ✨ New Features

- **Google AI Provider for Graphiti**: Full Google AI (Gemini) support for both LLM and embeddings in the Memory Layer
  - Add GoogleLLMClient with gemini-2.0-flash default model
  - Add GoogleEmbedder with text-embedding-004 default model
  - UI integration for Google API key configuration with link to Google AI Studio
- **Ollama LLM Provider in UI**: Add Ollama as an LLM provider option in Graphiti onboarding wizard
  - Ollama runs locally and doesn't require an API key
  - Configure Base URL instead of API key for local inference
- **LLM Provider Selection UI**: Add provider selection dropdown to Graphiti setup wizard for flexible backend configuration
- **Per-Project GitHub Configuration**: UI clarity improvements for per-project GitHub org/repo settings

### 🛠️ Improvements

- Enhanced Graphiti provider factory to support Google AI alongside existing providers
- Updated env-handlers to properly populate graphitiProviderConfig from .env files
- Improved type definitions with proper Graphiti provider config properties in AppSettings
- Better API key loading when switching between providers in settings

### 🐛 Bug Fixes

- **node-pty Migration**: Replaced node-pty with @lydell/node-pty for prebuilt Windows binaries
  - Updated all imports to use @lydell/node-pty directly
  - Fixed "Cannot find module 'node-pty'" startup error
- **GitHub Organization Support**: Fixed repository support for GitHub organization accounts
  - Add defensive array validation for GitHub issues API response
- **Asyncio Deprecation**: Fixed asyncio deprecation warning by using get_running_loop() instead of get_event_loop()
- Applied ruff formatting and fixed import sorting (I001) in Google provider files

### 🔧 Other Changes

- Added google-generativeai dependency to requirements.txt
- Updated provider validation to include Google/Groq/HuggingFace type assertions

---

## What's Changed

- fix(graphiti): address CodeRabbit review comments by @adryserage in 679b8cd
- fix(lint): sort imports in Google provider files by @adryserage in 1a38a06
- feat(graphiti): add Google AI as LLM and embedding provider by @adryserage in fe69106
- fix: GitHub organization repository support by @mojaray2k in 873cafa
- feat(ui): add LLM provider selection to Graphiti onboarding by @adryserage in 4750869
- fix(types): add missing AppSettings properties for Graphiti providers by @adryserage in 6680ed4
- feat(ui): add Ollama as LLM provider option for Graphiti by @adryserage in a3eee92
- fix(ui): address PR review feedback for Graphiti provider selection by @adryserage in b8a419a
- fix(deps): update imports to use @lydell/node-pty directly by @adryserage in 2b61ebb
- fix(deps): replace node-pty with @lydell/node-pty for prebuilt binaries by @adryserage in e1aee6a
- fix: add UI clarity for per-project GitHub configuration by @mojaray2k in c9745b6
- fix: add defensive array validation for GitHub issues API response by @mojaray2k in b3636a5

---

## 2.5.5 - Enhanced Agent Reliability & Build Workflow

### ✨ New Features

- Required GitHub setup flow after Auto Claude initialization to ensure proper configuration
- Atomic log saving mechanism to prevent log file corruption during concurrent operations
- Per-session model and thinking level selection in insights management
- Multi-auth token support and ANTHROPIC_BASE_URL passthrough for flexible authentication
- Comprehensive DEBUG logging at Claude SDK invocation points for improved troubleshooting
- Auto-download of prebuilt node-pty binaries for Windows environments
- Enhanced merge workflow with current branch detection for accurate change previews
- Phase configuration module and enhanced agent profiles for improved flexibility
- Stage-only merge handling with comprehensive verification checks
- Authentication failure detection system with patterns and validation checks across agent pipeline

### 🛠️ Improvements

- Changed default agent profile from 'balanced' to 'auto' for more adaptive behavior
- Better GitHub issue tracking and improved user experience in issue management
- Improved merge preview accuracy using git diff counts for file statistics
- Preserved roadmap generation state when switching between projects
- Enhanced agent profiles with phase configuration support

### 🐛 Bug Fixes

- Resolved CI test failures and improved merge preview reliability
- Fixed CI failures related to linting, formatting, and tests
- Prevented dialog skip during project initialization flow
- Updated model IDs for Sonnet and Haiku to match current Claude versions
- Fixed branch namespace conflict detection to prevent worktree creation failures
- Removed duplicate LINEAR_API_KEY checks and consolidated imports
- Python 3.10+ version requirement enforced with proper version checking
- Prevented command injection vulnerabilities in GitHub API calls

### 🔧 Other Changes

- Code cleanup and test fixture updates
- Removed redundant auto-claude/specs directory structure
- Untracked .auto-claude directory to respect gitignore rules

---

## What's Changed

- fix: resolve CI test failures and improve merge preview by @AndyMik90 in de2eccd
- chore: code cleanup and test fixture updates by @AndyMik90 in 948db57
- refactor: change default agent profile from 'balanced' to 'auto' by @AndyMik90 in f98a13e
- security: prevent command injection in GitHub API calls by @AndyMik90 in 24ff491
- fix: resolve CI failures (lint, format, test) by @AndyMik90 in a8f2d0b
- fix: use git diff count for totalFiles in merge preview by @AndyMik90 in 46d2536
- feat: enhance stage-only merge handling with verification checks by @AndyMik90 in 7153558
- feat: introduce phase configuration module and enhance agent profiles by @AndyMik90 in 2672528
- fix: preserve roadmap generation state when switching projects by @AndyMik90 in 569e921
- feat: add required GitHub setup flow after Auto Claude initialization by @AndyMik90 in 03ccce5
- chore: remove redundant auto-claude/specs directory by @AndyMik90 in 64d5170
- chore: untrack .auto-claude directory (should be gitignored) by @AndyMik90 in 0710c13
- fix: prevent dialog skip during project initialization by @AndyMik90 in 56cedec
- feat: enhance merge workflow by detecting current branch by @AndyMik90 in c0c8067
- fix: update model IDs for Sonnet and Haiku by @AndyMik90 in 059315d
- feat: add comprehensive DEBUG logging and fix lint errors by @AndyMik90 in 99cf21e
- feat: implement atomic log saving to prevent corruption by @AndyMik90 in da5e26b
- feat: add better github issue tracking and UX by @AndyMik90 in c957eaa
- feat: add comprehensive DEBUG logging to Claude SDK invocation points by @AndyMik90 in 73d01c0
- feat: auto-download prebuilt node-pty binaries for Windows by @AndyMik90 in 41a507f
- feat(insights): add per-session model and thinking level selection by @AndyMik90 in e02aa59
- fix: require Python 3.10+ and add version check by @AndyMik90 in 9a5ca8c
- fix: detect branch namespace conflict blocking worktree creation by @AndyMik90 in 63a1d3c
- fix: remove duplicate LINEAR_API_KEY check and consolidate imports by @Jacob in 7d351e3
- feat: add multi-auth token support and ANTHROPIC_BASE_URL passthrough by @Jacob in 9dea155

## 2.5.0 - Roadmap Intelligence & Workflow Refinements

### ✨ New Features

- Interactive competitor analysis viewer for roadmap planning with real-time data visualization

- GitHub issue label mapping to task categories for improved organization and tracking

- GitHub issue comment selection in task creation workflow for better context integration

- TaskCreationWizard enhanced with drag-and-drop support for file references and inline @mentions

- Roadmap generation now includes stop functionality and comprehensive debug logging

### 🛠️ Improvements

- Refined visual drop zone feedback in file reference system for more subtle user guidance

- Remove auto-expand behavior for referenced files on draft restore to improve UX

- Always-visible referenced files section in TaskCreationWizard for better discoverability

- Drop zone wrapper added around main modal content area for improved drag-and-drop ergonomics

- Stuck task detection now enabled for ai_review status to better track blocked work

- Enhanced React component stability with proper key usage in RoadmapHeader and PhaseProgressIndicator

### 🐛 Bug Fixes

- Corrected CompetitorAnalysisViewer type definitions for proper TypeScript compliance

- Fixed multiple CodeRabbit review feedback items for improved code quality

- Resolved React key warnings in PhaseProgressIndicator component

- Fixed git status parsing in merge preview for accurate worktree state detection

- Corrected path resolution in runners for proper module imports and .env loading

- Resolved CI lint and TypeScript errors across codebase

- Fixed HTTP error handling and path resolution issues in core modules

- Corrected worktree test to match intended branch detection behavior

- Refined TaskReview component conditional rendering for proper staged task display

---

## What's Changed

- feat: add interactive competitor analysis viewer for roadmap by @AndyMik90 in 7ff326d

- fix: correct CompetitorAnalysisViewer to match type definitions by @AndyMik90 in 4f1766b

- fix: address multiple CodeRabbit review feedback items by @AndyMik90 in 48f7c3c

- fix: use stable React keys instead of array indices in RoadmapHeader by @AndyMik90 in 892e01d

- fix: additional fixes for http error handling and path resolution by @AndyMik90 in 54501cb

- fix: update worktree test to match intended branch detection behavior by @AndyMik90 in f1d578f

- fix: resolve CI lint and TypeScript errors by @AndyMik90 in 2e3a5d9

- feat: enhance roadmap generation with stop functionality and debug logging by @AndyMik90 in a6dad42

- fix: correct path resolution in runners for module imports and .env loading by @AndyMik90 in 3d24f8f

- fix: resolve React key warning in PhaseProgressIndicator by @AndyMik90 in 9106038

- fix: enable stuck task detection for ai_review status by @AndyMik90 in 895ed9f

- feat: map GitHub issue labels to task categories by @AndyMik90 in cbe14fd

- feat: add GitHub issue comment selection and fix auto-start bug by @AndyMik90 in 4c1dd89

- feat: enhance TaskCreationWizard with drag-and-drop support for file references and inline @mentions by @AndyMik90 in d93eefe

- cleanup docs by @AndyMik90 in 8e891df

- fix: correct git status parsing in merge preview by @AndyMik90 in c721dc2

- Update TaskReview component to refine conditional rendering for staged tasks, ensuring proper display when staging is unsuccessful by @AndyMik90 in 1a2b7a1

- auto-claude: subtask-2-3 - Refine visual drop zone feedback to be more subtle by @AndyMik90 in 6cff442

- auto-claude: subtask-2-1 - Remove showFiles auto-expand on draft restore by @AndyMik90 in 12bf69d

- auto-claude: subtask-1-3 - Create an always-visible referenced files section by @AndyMik90 in 3818b46

- auto-claude: subtask-1-2 - Add drop zone wrapper around main modal content area by @AndyMik90 in 219b66d

- auto-claude: subtask-1-1 - Remove Reference Files toggle button by @AndyMik90 in 4e63e85

## 2.4.0 - Enhanced Cross-Platform Experience with OAuth & Auto-Updates

### ✨ New Features

- Claude account OAuth implementation on onboarding for seamless token setup

- Integrated release workflow with AI-powered version suggestion capabilities

- Auto-upgrading functionality supporting Windows, Linux, and macOS with automatic app updates

- Git repository initialization on app startup with project addition checks

- Debug logging for app updater to track update processes

- Auto-open settings to updates section when app update is ready

### 🛠️ Improvements

- Major Windows and Linux compatibility enhancements for cross-platform reliability

- Enhanced task status handling to support 'done' status in limbo state with worktree existence checks

- Better handling of lock files from worktrees upon merging

- Improved README documentation and build process

- Refined visual drop zone feedback for more subtle user experience

- Removed showFiles auto-expand on draft restore for better UX consistency

- Created always-visible referenced files section in task creation wizard

- Removed Reference Files toggle button for streamlined interface

- Worktree manual deletion enforcement for early access safety (prevents accidental work loss)

### 🐛 Bug Fixes

- Corrected git status parsing in merge preview functionality

- Fixed ESLint warnings and failing tests

- Fixed Windows/Linux Python handling for cross-platform compatibility

- Fixed Windows/Linux source path detection

- Refined TaskReview component conditional rendering for proper staged task display

---

## What's Changed

- docs: cleanup docs by @AndyMik90 in 8e891df
- fix: correct git status parsing in merge preview by @AndyMik90 in c721dc2
- refactor: Update TaskReview component to refine conditional rendering for staged tasks by @AndyMik90 in 1a2b7a1
- feat: Enhance task status handling to allow 'done' status in limbo state by @AndyMik90 in a20b8cf
- improvement: Worktree needs to be manually deleted for early access safety by @AndyMik90 in 0ed6afb
- feat: Claude account OAuth implementation on onboarding by @AndyMik90 in 914a09d
- fix: Better handling of lock files from worktrees upon merging by @AndyMik90 in e44202a
- feat: GitHub OAuth integration upon onboarding by @AndyMik90 in 4249644
- chore: lock update by @AndyMik90 in b0fc497
- improvement: Improved README and build process by @AndyMik90 in 462edcd
- fix: ESLint warnings and failing tests by @AndyMik90 in affbc48
- feat: Major Windows and Linux compatibility enhancements with auto-upgrade by @AndyMik90 in d7fd1a2
- feat: Add debug logging to app updater by @AndyMik90 in 96dd04d
- feat: Auto-open settings to updates section when app update is ready by @AndyMik90 in 1d0566f
- feat: Add integrated release workflow with AI version suggestion by @AndyMik90 in 7f3cd59
- fix: Windows/Linux Python handling by @AndyMik90 in 0ef0e15
- feat: Implement Electron app auto-updater by @AndyMik90 in efc112a
- fix: Windows/Linux source path detection by @AndyMik90 in d33a0aa
- refactor: Refine visual drop zone feedback to be more subtle by @AndyMik90 in 6cff442
- refactor: Remove showFiles auto-expand on draft restore by @AndyMik90 in 12bf69d
- feat: Create always-visible referenced files section by @AndyMik90 in 3818b46
- feat: Add drop zone wrapper around main modal content by @AndyMik90 in 219b66d
- feat: Remove Reference Files toggle button by @AndyMik90 in 4e63e85
- docs: Update README with git initialization and folder structure by @AndyMik90 in 2fa3c51
- chore: Version bump to 2.3.2 by @AndyMik90 in 59b091a

## 2.3.2 - UI Polish & Build Improvements

### 🛠️ Improvements

- Restructured SortableFeatureCard badge layout for improved visual presentation

Bug Fixes:
- Fixed spec runner path configuration for more reliable task execution

---

## What's Changed

- fix: fix to spec runner paths by @AndyMik90 in 9babdc2

- feat: auto-claude: subtask-1-1 - Restructure SortableFeatureCard badge layout by @AndyMik90 in dc886dc

## 2.3.1 - Linux Compatibility Fix

### 🐛 Bug Fixes

- Resolved path handling issues on Linux systems for improved cross-platform compatibility

---

## What's Changed

- fix: Fix to linux path issue by @AndyMik90 in 3276034

## 2.2.0 - 2025-12-17

### ✨ New Features

- Add usage monitoring with profile swap detection to prevent cascading resource issues

- Option to stash changes before merge operations for safer branch integration

- Add hideCloseButton prop to DialogContent component for improved UI flexibility

### 🛠️ Improvements

- Enhance AgentManager to manage task context cleanup and preserve swapCount on restarts

- Improve changelog feature with version tracking, markdown/preview, and persistent styling options

- Refactor merge conflict handling to use branch names instead of commit hashes for better clarity

- Streamline usage monitoring logic by removing unnecessary dynamic imports

- Better handling of lock files during merge conflicts

- Refactor code for improved readability and maintainability

- Refactor IdeationHeader and update handleDeleteSelected logic

### 🐛 Bug Fixes

- Fix worktree merge logic to correctly handle branch operations

- Fix spec_runner.py path resolution after move to runners/ directory

- Fix Discord release webhook failing on large changelogs

- Fix branch logic for merge AI operations

- Hotfix for spec-runner path location

---

## What's Changed

- fix: hotfix/spec-runner path location by @AndyMik90 in f201f7e

- refactor: Remove unnecessary dynamic imports of getUsageMonitor in terminal-handlers.ts to streamline usage monitoring logic by @AndyMik90 in 0da4bc4

- feat: Improve changelog feature, version tracking, markdown/preview, persistent styling options by @AndyMik90 in a0d142b

- refactor: Refactor code for improved readability and maintainability by @AndyMik90 in 473b045

- feat: Enhance AgentManager to manage task context cleanup and preserve swapCount on restarts. Update UsageMonitor to delay profile usage checks to prevent cascading swaps by @AndyMik90 in e5b9488

- feat: Usage-monitoring by @AndyMik90 in de33b2c

- feat: option to stash changes before merge by @AndyMik90 in 7e09739

- refactor: Refactor merge conflict check to use branch names instead of commit hashes by @AndyMik90 in e6d6cea

- fix: worktree merge logic by @AndyMik90 in dfb5cf9

- test: Sign off - all verification passed by @AndyMik90 in 34631c3

- feat: Pass hideCloseButton={showFileExplorer} to DialogContent by @AndyMik90 in 7c327ed

- feat: Add hideCloseButton prop to DialogContent component by @AndyMik90 in 5f9653a

- fix: branch logic for merge AI by @AndyMik90 in 2d2a813

- fix: spec_runner.py path resolution after move to runners/ directory by @AndyMik90 in ce9c2cd

- refactor: Better handling of lock files during merge conflicts by @AndyMik90 in 460c76d

- fix: Discord release webhook failing on large changelogs by @AndyMik90 in 4eb66f5

- chore: Update CHANGELOG with new features, improvements, bug fixes, and other changes by @AndyMik90 in 788b8d0

- refactor: Enhance merge conflict handling by excluding lock files by @AndyMik90 in 957746e

- refactor: Refactor IdeationHeader and update handleDeleteSelected logic by @AndyMik90 in 36338f3

## What's New

### ✨ New Features

- Added GitHub OAuth integration for seamless authentication

- Implemented roadmap feature management with kanban board and drag-and-drop support

- Added ability to select AI model during task creation with agent profiles

- Introduced file explorer integration and referenced files section in task creation wizard

- Added .gitignore entry management during project initialization

- Created comprehensive onboarding wizard with OAuth configuration, Graphiti setup, and first spec guidance

- Introduced Electron MCP for debugging and validation support

- Added BMM workflow status tracking and project scan reporting

### 🛠️ Improvements

- Refactored IdeationHeader component and improved deleteSelected logic

- Refactored backend for upcoming features with improved architecture

- Enhanced RouteDetector to exclude specific directories from route detection

- Improved merge conflict resolution with parallel processing and AI-assisted resolution

- Optimized merge conflict resolution performance and context sending

- Refactored AI resolver to use async context manager and Claude SDK patterns

- Enhanced merge orchestrator logic and frontend UX for conflict handling

- Refactored components for better maintainability and faster development

- Refactored changelog formatter for GitHub Release compatibility

- Enhanced onboarding wizard completion logic and step progression

- Updated README to clarify Auto Claude's role as an AI coding companion

### 🐛 Bug Fixes

- Fixed GraphitiStep TypeScript compilation error

- Added missing onRerunWizard prop to AppSettingsDialog

- Improved merge lock file conflict handling

### 🔧 Other Changes

- Removed .auto-claude and _bmad-output from git tracking (already in .gitignore)

- Updated Python versions in CI workflows

- General linting improvements and code cleanup

---

## What's Changed

- feat: New github oauth integration by @AndyMik90 in afeb54f
- feat: Implement roadmap feature management kanban with drag-and-drop support by @AndyMik90 in 9403230
- feat: Agent profiles, be able to select model on task creation by @AndyMik90 in d735c5c
- feat: Add Referenced Files Section and File Explorer Integration in Task Creation Wizard by @AndyMik90 in 31e4e87
- feat: Add functionality to manage .gitignore entries during project initialization by @AndyMik90 in 2ac00a9
- feat: Introduce electron mcp for electron debugging/validation by @AndyMik90 in 3eb2ead
- feat: Add BMM workflow status tracking and project scan report by @AndyMik90 in 7f6456f
- refactor: Refactor IdeationHeader and update handleDeleteSelected logic by @AndyMik90 in 36338f3
- refactor: Big backend refactor for upcoming features by @AndyMik90 in 11fcdf4
- refactor: Refactoring for better codebase by @AndyMik90 in feb0d4e
- refactor: Refactor Roadmap component to utilize RoadmapGenerationProgress for better status display by @AndyMik90 in d8e5784
- refactor: refactoring components for better future maintence and more rapid coding by @AndyMik90 in 131ec4c
- refactor: Enhance RouteDetector to exclude specific directories from route detection by @AndyMik90 in 08dc24c
- refactor: Update AI resolver to use Claude Opus model and improve error logging by @AndyMik90 in 1d830ba
- refactor: Use claude sdk pattern for ai resolver by @AndyMik90 in 4bba9d1
- refactor: Refactor AI resolver to use async context manager for client connection by @AndyMik90 in 579ea40
- refactor: Update changelog formatter for GitHub Release compatibility by @AndyMik90 in 3b832db
- refactor: Enhance onboarding wizard completion logic by @AndyMik90 in 7c01638
- refactor: Update GraphitiStep to proceed to the next step after successful configuration save by @AndyMik90 in a5a1eb1
- fix: Add onRerunWizard prop to AppSettingsDialog (qa-requested) by @AndyMik90 in 6b5b714
- fix: Add first-run detection to App.tsx by @AndyMik90 in 779e36f
- fix: Add TypeScript compilation check - fix GraphitiStep type error by @AndyMik90 in f90fa80
- improve: ideation improvements and linting by @AndyMik90 in 36a69fc
- improve: improve merge conflicts for lock files by @AndyMik90 in a891225
- improve: Roadmap competitor analysis by @AndyMik90 in ddf47ae
- improve: parallell merge conflict resolution by @AndyMik90 in f00aa33
- improve: improvement to speed of merge conflict resolution by @AndyMik90 in 56ff586
- improve: improve context sending to merge agent by @AndyMik90 in e409ae8
- improve: better conflict handling in the frontend app for merge contlicts (better UX) by @AndyMik90 in 65937e1
- improve: resolve claude agent sdk by @AndyMik90 in 901e83a
- improve: Getting ready for BMAD integration by @AndyMik90 in b94eb65
- improve: Enhance AI resolver and debugging output by @AndyMik90 in bf787ad
- improve: Integrate profile environment for OAuth token in task handlers by @AndyMik90 in 01e801a
- chore: Remove .auto-claude from tracking (already in .gitignore) by @AndyMik90 in 87f353c
- chore: Update Python versions in CI workflows by @AndyMik90 in 43a338c
- chore: Linting gods pleased now? by @AndyMik90 in 6aea4bb
- chore: Linting and test fixes by @AndyMik90 in 140f11f
- chore: Remove _bmad-output from git tracking by @AndyMik90 in 4cd7500
- chore: Add _bmad-output to .gitignore by @AndyMik90 in dbe27f0
- chore: Linting gods are happy by @AndyMik90 in 3fc1592
- chore: Getting ready for the lint gods by @AndyMik90 in 142cd67
- chore: CLI testing/linting by @AndyMik90 in d8ad17d
- chore: CLI and tests by @AndyMik90 in 9a59b7e
- chore: Update implementation_plan.json - fixes applied by @AndyMik90 in 555a46f
- chore: Update parallel merge conflict resolution metrics in workspace.py by @AndyMik90 in 2e151ac
- chore: merge logic v0.3 by @AndyMik90 in c5d33cd
- chore: merge orcehestrator logic by @AndyMik90 in e8b6669
- chore: Merge-orchestrator by @AndyMik90 in d8ba532
- chore: merge orcehstrator logic by @AndyMik90 in e8b6669
- chore: Electron UI fix for merge orcehstrator by @AndyMik90 in e08ab62
- chore: Frontend lints by @AndyMik90 in 488bbfa
- docs: Revise README.md to enhance clarity and focus on Auto Claude's capabilities by @AndyMik90 in f9ef7ea
- qa: Sign off - all verification passed by @AndyMik90 in b3f4803
- qa: Rejected - fixes required by @AndyMik90 in 5e56890
- qa: subtask-6-2 - Run existing tests to verify no regressions by @AndyMik90 in 5f989a4
- qa: subtask-5-2 - Enhance OAuthStep to detect and display if token is already configured by @AndyMik90 in 50f22da
- qa: subtask-5-1 - Add settings migration logic - set onboardingCompleted by @AndyMik90 in f57c28e
- qa: subtask-4-1 - Add 'Re-run Wizard' button to AppSettings navigation by @AndyMik90 in 9144e7f
- qa: subtask-3-1 - Add first-run detection to App.tsx by @AndyMik90 in 779e36f
- qa: subtask-2-8 - Create index.ts barrel export for onboarding components by @AndyMik90 in b0af2dc
- qa: subtask-2-7 - Create OnboardingWizard component by @AndyMik90 in 3de8928
- qa: subtask-2-6 - Create CompletionStep component - success message by @AndyMik90 in aa0f608
- qa: subtask-2-5 - Create FirstSpecStep component - guided first spec by @AndyMik90 in 32f17a1
- qa: subtask-2-4 - Create GraphitiStep component - optional Graphiti/FalkorDB configuration by @AndyMik90 in 61184b0
- qa: subtask-2-3 - Create OAuthStep component - Claude OAuth token configuration step by @AndyMik90 in 79d622e
- qa: subtask-2-2 - Create WelcomeStep component by @AndyMik90 in a97f697
- qa: subtask-2-1 - Create WizardProgress component - step progress indicator by @AndyMik90 in b6e604c
- qa: subtask-1-2 - Add onboardingCompleted to DEFAULT_APP_SETTINGS by @AndyMik90 in c5a0331
- qa: subtask-1-1 - Add onboardingCompleted to AppSettings type interface by @AndyMik90 in 7c24b48
- chore: Version 2.0.1 by @AndyMik90 in 4b242c4
- test: Merge-orchestrator by @AndyMik90 in d8ba532
- test: test for ai merge AI by @AndyMik90 in 9d9cf16

## What's New in 2.0.1

### 🚀 New Features
- **Update Check with Release URLs**: Enhanced update checking functionality to include release URLs, allowing users to easily access release information
- **Markdown Renderer for Release Notes**: Added markdown renderer in advanced settings to properly display formatted release notes
- **Terminal Name Generator**: New feature for generating terminal names

### 🔧 Improvements
- **LLM Provider Naming**: Updated project settings to reflect new LLM provider name
- **IPC Handlers**: Improved IPC handlers for external link management
- **UI Simplification**: Refactored App component to simplify project selection display by removing unnecessary wrapper elements
- **Docker Infrastructure**: Updated FalkorDB service container naming in docker-compose configuration
- **Documentation**: Improved README with dedicated CLI documentation and infrastructure status information

### 📚 Documentation
- Enhanced README with comprehensive CLI documentation and setup instructions
- Added Docker infrastructure status documentation

## What's New in v2.0.0

### New Features
- **Task Integration**: Connected ideas to tasks with "Go to Task" functionality across the UI
- **File Explorer Panel**: Implemented file explorer panel with directory listing capabilities
- **Terminal Task Selection**: Added task selection dropdown in terminal with auto-context loading
- **Task Archiving**: Introduced task archiving functionality
- **Graphiti MCP Server Integration**: Added support for Graphiti memory integration
- **Roadmap Functionality**: New roadmap visualization and management features

### Improvements
- **File Tree Virtualization**: Refactored FileTree component to use efficient virtualization for improved performance with large file structures
- **Agent Parallelization**: Improved Claude Code agent decision-making for parallel task execution
- **Terminal Experience**: Enhanced terminal with task features and visual feedback for better user experience
- **Python Environment Detection**: Auto-detect Python environment readiness before task execution
- **Version System**: Cleaner version management system
- **Project Initialization**: Simpler project initialization process

### Bug Fixes
- Fixed project settings bug
- Fixed insight UI sidebar
- Resolved Kanban and terminal integration issues

### Changed
- Updated project-store.ts to use proper Dirent type for specDirs variable
- Refactored codebase for better code quality
- Removed worktree-worker logic in favor of Claude Code's internal agent system
- Removed obsolete security configuration file (.auto-claude-security.json)

### Documentation
- Added CONTRIBUTING.md with development guidelines

## What's New in v1.1.0

### New Features
- **Follow-up Tasks**: Continue working on completed specs by adding new tasks to existing implementations. The system automatically re-enters planning mode and integrates with your existing documentation and context.
- **Screenshot Support for Feedback**: Attach screenshots to your change requests when reviewing tasks, providing visual context for your feedback alongside text comments.
- **Unified Task Editing**: The Edit Task dialog now includes all the same options as the New Task dialog—classification metadata, image attachments, and review settings—giving you full control when modifying tasks.

### Improvements
- **Enhanced Kanban Board**: Improved visual design and interaction patterns for task cards, making it easier to scan status, understand progress, and work with tasks efficiently.
- **Screenshot Handling**: Paste screenshots directly into task descriptions using Ctrl+V (Cmd+V on Mac) for faster documentation.
- **Draft Auto-Save**: Task creation state is now automatically saved when you navigate away, preventing accidental loss of work-in-progress.

### Bug Fixes
- Fixed task editing to support the same comprehensive options available in new task creation

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

- Fix memory handler Ollama detection to skip offline models

- Fix worktree isolation to properly inherit security profiles

- Fix spec numbering race condition in multi-instance scenarios

- Fix terminal recreation when switching between projects

- Fix Claude CLI detection for system and bundled installations

- Fix Claude CLI path escaping on Windows

- Fix crash when editing settings without spec

- Fix GitHub CLI detection to use gh executable from PATH

- Fix roadmap generator to handle project with no specs

- Fix backend packaging to include all required Python modules

- Fix Claude executable detection on Windows

- Fix path detection for Claude Code CLI

- Fix feature cards to display actual status instead of raw string

- Fix Kanban board to support multi-phase roadmap rendering

- Fix feature status normalization to use backend status field

- Fix terminal restoration to recover terminal instances on app restart

- Fix terminal scroll position on Windows/Linux

- Fix task execution to skip completion actions when task cancelled

- Fix context gathering to support Claude Code CLI for GitHub issues

- Fix context gathering for GitHub issues to use Claude Code CLI

- Fix linear_update to only run when enabled

- Fix git push to use correct refspec for force pushing

- Fix git push to correctly detect when remote branch doesn't exist

- Fix file watcher to handle project path resolution

- Fix project analyzer to handle nested backend directories

- Fix terminal to display Claude's colored output properly

- Fix context gatherer to handle Claude CLI timeouts

- Fix backend to recover from Claude process crashes

- Fix Git Flow operations to use correct branch names

- Fix Git Flow to handle feature branch with slashes in name

- Fix Git Flow hotfix operations

- Fix spec creation to skip spec phases for trivial tasks

- Fix context gathering for GitHub issues to use Claude Code CLI

- Fix Claude Code CLI path resolution on Windows

- Fix Claude Code CLI detection on Windows

- Fix Claude Code CLI integration

- Fix context gathering for GitHub issues

- Fix task cancellation to properly kill backend process

- Fix task cancellation to kill spawned subprocesses

- Fix Claude process detection and cleanup

- Fix Claude Code CLI path resolution

- Fix Claude Code CLI detection to find installed executable

- Fix Claude Code CLI detection fallback

- Fix spec creation wizard to handle errors gracefully

- Fix auto-build to not run when .env doesn't exist

- Fix terminal to restore scroll position when switching projects

- Fix worktree branch naming collision detection

- Fix Kanban board drag and drop to use correct phase ID

- Fix Kanban board to support multi-phase roadmaps

- Fix feature card status badges

- Fix roadmap data refresh to trigger updates across all views

- Fix roadmap generator to respect user-specified complexity

- Fix roadmap phase order to follow user specification

- Fix roadmap generation to handle empty competitor analysis

- Fix roadmap generator to use spec-compliant phases

- Fix roadmap refresh to preserve unsaved changes

- Fix roadmap phase status validation

- Fix roadmap view to display all phases

- Fix Kanban board column scrolling

- Fix Kanban board to render phases in correct order

- Fix spec creation to use simple complexity for single-line tasks

- Fix spec creation wizard progress

- Fix spec creation wizard to show correct initial progress

- Fix spec creation to use simple complexity for trivial tasks

- Fix spec creation to handle complex feature requests

- Fix spec creation to properly categorize task complexity

- Fix context gathering for GitHub issues to handle milestone selection

- Fix context gathering for GitHub issues to handle missing repository data

- Fix context gathering for GitHub issues to use Claude Code CLI

- Fix context gathering to handle missing milestone IDs

- Fix context gathering for GitHub issues to handle missing milestone data

- Fix context gathering for GitHub issues to include PR links

- Fix context gathering to include issue and PR references

- Fix context gathering to skip duplicate issues

- Fix context gathering for GitHub issues to handle missing labels

- Fix context gathering for GitHub issues to handle missing milestone data

- Fix context gathering for GitHub issues to handle missing repository data

- Fix context gathering for GitHub issues to handle missing milestone selection

- Fix context gathering for GitHub issues to handle missing milestone data

- Fix context gathering for GitHub issues to include PR links

- Fix context gathering for GitHub issues to skip duplicate issues

- Fix context gathering for GitHub issues to include issue and PR references

- Fix context gathering for GitHub issues to handle missing labels

- Fix context gathering for GitHub issues to use Claude Code CLI

- Fix context gathering for GitHub issues to use Claude Code CLI

- Fix context gathering for GitHub issues to handle missing repository data

- Fix context gathering to include PR links for GitHub issues

- Fix context gathering to handle missing milestone data for GitHub issues

- Fix context gathering to handle missing milestone IDs for GitHub issues

- Fix context gathering for GitHub issues to use Claude Code CLI

- Fix context gathering to handle missing repository data for GitHub issues

- Fix context gathering to skip duplicate GitHub issues

- Fix context gathering to handle missing labels for GitHub issues

- Fix context gathering to include issue and PR references for GitHub issues

- Fix context gathering to handle missing milestone selection for GitHub issues

- Fix context gathering to handle missing milestone data for GitHub issues

- Fix context gathering to handle missing milestone IDs for GitHub issues

- Fix context gathering to include PR links for GitHub issues

- Fix context gathering to skip duplicate GitHub issues

- Fix context gathering to include issue and PR references for GitHub issues

- Fix context gathering to use Claude Code CLI for GitHub issues

- Fix context gathering to handle missing repository data for GitHub issues

- Fix context gathering to handle missing labels for GitHub issues

- Fix context gathering to handle missing milestone selection for GitHub issues

- Fix context gathering to handle missing milestone data for GitHub issues

- Fix context gathering to handle missing milestone IDs for GitHub issues

- Fix context gathering to include PR links for GitHub issues

- Fix context gathering to skip duplicate GitHub issues

- Fix context gathering to include issue and PR references for GitHub issues

- Fix context gathering for GitHub issues to use Claude Code CLI

- Fix context gathering to handle missing repository data for GitHub issues

- Fix context gathering to handle missing labels for GitHub issues

- Fix context gathering to handle missing milestone selection for GitHub issues

- Fix context gathering to handle missing milestone data for GitHub issues

- Fix context gathering to handle missing milestone IDs for GitHub issues

- Fix context gathering to include PR links for GitHub issues

- Fix context gathering to skip duplicate GitHub issues

- Fix context gathering to include issue and PR references for GitHub issues

---

## What's Changed

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

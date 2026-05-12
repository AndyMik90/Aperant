# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

Auto Claude is an autonomous multi-agent coding framework that plans, builds, and validates software for you. It's a TypeScript-first Electron desktop application with a self-contained AI agent layer (Vercel AI SDK v6). A lightweight Python sidecar provides the optional Graphiti memory system.

> **Deep-dive reference:** [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md) | **Frontend contributing:** [apps/desktop/CONTRIBUTING.md](apps/desktop/CONTRIBUTING.md)

## Product Overview

Auto Claude is a desktop application (+ CLI) where users describe a goal and AI agents autonomously handle planning, implementation, and QA validation. All work happens in isolated git worktrees so the main branch stays safe.

**Core workflow:** User creates a task → Spec creation pipeline assesses complexity and writes a specification → Planner agent breaks it into subtasks → Coder agent implements (can spawn parallel subagents) → QA reviewer validates → QA fixer resolves issues → User reviews and merges.

**Main features:**

- **Autonomous Tasks** — Multi-agent pipeline (planner, coder, QA) that builds features end-to-end
- **Kanban Board** — Visual task management from planning through completion
- **Agent Terminals** — Up to 12 parallel AI-powered terminals with task context injection
- **Insights** — AI chat interface for exploring and understanding your codebase
- **Roadmap** — AI-assisted feature planning with strategic roadmap generation
- **Ideation** — Discover improvements, performance issues, and security vulnerabilities
- **GitHub/GitLab Integration** — Import issues, AI-powered investigation, PR/MR review and creation
- **Changelog** — Generate release notes from completed tasks
- **Memory System** — Graphiti-based knowledge graph retains insights across sessions
- **Isolated Workspaces** — Git worktree isolation for every build; AI-powered semantic merge
- **Flexible Authentication** — Use a Claude Code subscription (OAuth) or API profiles with any Anthropic-compatible endpoint (e.g., Anthropic API, z.ai for GLM models)
- **Multi-Account Swapping** — Register multiple Claude accounts; when one hits a rate limit, Auto Claude automatically switches to an available account
- **Cross-Platform** — Native desktop app for Windows, macOS, and Linux with auto-updates

## Critical Rules

**Vercel AI SDK only** — All AI interactions use the Vercel AI SDK v6 (`ai` package) via the TypeScript agent layer in `apps/desktop/src/main/ai/`. NEVER use `@anthropic-ai/sdk` or `anthropic.Anthropic()` directly. Use `createProvider()` from `ai/providers/factory.ts` and `streamText()`/`generateText()` from the `ai` package. Provider-specific adapters (e.g., `@ai-sdk/anthropic`, `@ai-sdk/openai`) are managed through the provider registry. **Exception (INV-005 / UNK-005):** `apps/desktop/src/main/services/profile/profile-service.ts` imports `@anthropic-ai/sdk` solely for API-key validation when a user adds a new profile — it consumes the SDK's typed exceptions (`AuthenticationError`, `NotFoundError`, `APIConnectionError`, `APIConnectionTimeoutError`) to produce precise user-facing error messages. New code outside this file MUST NOT add `@anthropic-ai/sdk` imports.

**i18n required** — All frontend user-facing text uses `react-i18next` translation keys. Hardcoded strings in JSX/TSX break localization for non-English users. Add keys to both `en/*.json` and `fr/*.json`.

**Platform abstraction (INV-007 / UNK-008)** — Never use `process.platform` directly. Two complementary layers exist by design: `apps/desktop/src/main/platform/` for main-process path/executable abstractions (paths, executable lookup, OS-specific shell handling); `apps/desktop/src/shared/platform.ts` for the typed `Platform` detection (`getCurrentPlatform`, `isWindows`, `isMacOS`, `isLinux`, `isUnix`) usable cross-process; `apps/desktop/src/shared/platform.cjs` for the same detection from build scripts that cannot import TypeScript. CI tests all three platforms.

**No time estimates** — Provide priority-based ordering instead of duration predictions.

**PR target** — Always target the `develop` branch for PRs, not `main`. Main is reserved for releases.

**No console.log in production code** — `console.log` output is invisible in bundled Electron apps. Use Sentry for error tracking in production; reserve `console.log` for development only.

## Work Approach: Orchestrator-First

You are an orchestrator. Your primary role is to understand what needs to be done, break it into workstreams, and delegate execution to agent teams. This keeps your context window focused on coordination and decision-making rather than filling up with implementation details.

<orchestrator_pattern>
When given a task, follow this pattern:

1. **Investigate first** — Read the actual code before forming any hypothesis. Use targeted searches (Glob, Grep, Read) for simple lookups. For broader exploration, spawn an Explore agent.

2. **Plan the approach** — Identify what needs to change, which files are involved, and whether work can be parallelized. For multi-step tasks, create a task list to track workstreams.

3. **Delegate execution** — Spawn agent teams to do the implementation work. Each agent gets a clear, self-contained assignment with all the context it needs: relevant file paths, the specific change to make, and acceptance criteria. Run independent workstreams in parallel.

4. **Verify and integrate** — Review agent outputs, run tests, and ensure changes work together. Fix integration issues or spawn follow-up agents as needed.
</orchestrator_pattern>

**When to delegate vs. do directly:**
- Delegate: multi-file changes, research across the codebase, independent parallel workstreams, tasks that would consume significant context
- Do directly: single-file edits, simple bug fixes, quick lookups, tasks where you already have the context

**Giving agents good assignments** — Each agent works with a fresh context. Include: the specific goal, relevant file paths, code patterns to follow, and what "done" looks like. Agents perform better with explicit, complete instructions than with vague references to "the current task."

**Minimal changes only** — Prefer the simplest approach (e.g., prompt-only changes, single guard clause) before suggesting multi-component solutions. If the user asks for X, implement X — don't bundle additional fixes they didn't request.

**Default to action** — When the user's intent implies making changes, implement them rather than only suggesting. If something is unclear, read the relevant code to fill in the gaps rather than asking. Only ask when genuine ambiguity remains about what the user wants.

## Context Management

Your context window will be automatically compacted as it approaches its limit, allowing you to continue working indefinitely. Do not stop tasks early due to context concerns — instead, persist progress and keep going.

**For long-running tasks:** Use git commits, task lists, and structured notes to track state. When context compacts, review git log and any progress files to re-orient. Focus on incremental progress — complete one component before moving to the next, and commit working states along the way.

**Parallel tool calls** — When reading multiple files, running independent searches, or executing unrelated commands, make all calls in parallel rather than sequentially. This significantly speeds up investigation and implementation.

## Known Gotchas

**Electron path resolution** — For bug fixes in the Electron app, check path resolution differences between dev and production builds (`app.isPackaged`, `process.resourcesPath`). Paths that work in dev often break when Electron is bundled for production — verify both contexts.

### Resetting PR Review State

To fully clear all PR review data so reviews run fresh, delete/reset these three things in `.auto-claude/github/`:

1. `rm .auto-claude/github/pr/logs_*.json` — review log files
2. `rm .auto-claude/github/pr/review_*.json` — review result files
3. Reset `pr/index.json` to `{"reviews": [], "last_updated": null}`
4. Reset `bot_detection_state.json` to `{"reviewed_commits": {}}` — this is the gatekeeper; without clearing it, the bot detector skips already-seen commits

## Project Structure

```
autonomous-coding/
├── apps/
│   └── desktop/                 # Electron desktop application (sole app)
│       ├── prompts/             # Agent system prompts (.md)
│       └── src/
│           ├── main/            # Electron main process
│           │   ├── ai/          # TypeScript AI agent layer (Vercel AI SDK v6)
│           │   │   ├── providers/   # Multi-provider registry + factory (9+ providers)
│           │   │   ├── tools/       # Builtin tools (Read, Write, Edit, Bash, Glob, Grep, etc.)
│           │   │   ├── security/    # Bash validator, command parser, path containment
│           │   │   ├── config/      # Agent configs (25+ types), phase config, model resolution
│           │   │   ├── session/     # streamText() agent loop, error classification, progress
│           │   │   ├── agent/       # Worker thread executor + bridge
│           │   │   ├── orchestration/ # Build pipeline (planner → coder → QA)
│           │   │   ├── runners/     # Utility runners (insights, roadmap, PR review, etc.)
│           │   │   ├── mcp/         # MCP client integration
│           │   │   ├── client/      # Client factory convenience constructors
│           │   │   └── auth/        # Token resolution (reuses claude-profile/)
│           │   ├── agent/       # Agent queue, process, state, events
│           │   ├── claude-profile/ # Multi-profile credentials, token refresh, usage
│           │   ├── terminal/    # PTY daemon, lifecycle, Claude integration
│           │   ├── platform/    # Cross-platform abstraction
│           │   ├── ipc-handlers/# 40+ handler modules by domain
│           │   ├── services/    # Session recovery, profile service
│           │   └── changelog/   # Changelog generation and formatting
│           ├── preload/         # Electron preload scripts (electronAPI bridge)
│           ├── renderer/        # React UI
│           │   ├── components/  # UI components (onboarding, settings, task, terminal, github, etc.)
│           │   ├── stores/      # 24+ Zustand state stores
│           │   ├── contexts/    # React contexts (ViewStateContext)
│           │   ├── hooks/       # Custom hooks (useIpc, useTerminal, etc.)
│           │   ├── styles/      # CSS / Tailwind styles
│           │   └── App.tsx      # Root component
│           ├── shared/          # Shared types, i18n, constants, utils
│           │   ├── i18n/locales/# en/*.json, fr/*.json
│           │   ├── constants/   # themes.ts, etc.
│           │   ├── types/       # 19+ type definition files
│           │   └── utils/       # ANSI sanitizer, shell escape, provider detection
│           └── types/           # TypeScript type definitions
├── guides/                      # Documentation
└── scripts/                     # Build and utility scripts
```

## Commands Quick Reference

### Setup
```bash
npm run install:all              # Install all dependencies from root
# Or separately:
cd apps/desktop && npm install
```

### Testing

| Stack | Command | Tool |
|-------|---------|------|
| Frontend unit | `cd apps/desktop && npm test` | Vitest |
| Frontend E2E | `cd apps/desktop && npm run test:e2e` | Playwright |

### Releases
```bash
node scripts/bump-version.js patch|minor|major  # Bump version
git push && gh pr create --base main             # PR to main triggers release
```

See [RELEASE.md](RELEASE.md) for full release process.

## AI Agent Layer (`apps/desktop/src/main/ai/`)

All AI agent logic lives in TypeScript using the Vercel AI SDK v6. This replaces the previous Python `claude-agent-sdk` integration.

### Architecture Overview

- **Provider Layer** (`providers/`) — Multi-provider support via `createProviderRegistry()`. Supports Anthropic, OpenAI, Google, Bedrock, Azure, Mistral, Groq, xAI, and Ollama. Provider-specific transforms handle thinking token normalization and prompt caching.
- **Session Runtime** (`session/`) — `runAgentSession()` uses `streamText()` with `stopWhen: stepCountIs(N)` for agentic tool-use loops. Includes error classification (429/401/400) and progress tracking.
- **Worker Threads** (`agent/`) — Agent sessions run in `worker_threads` to avoid blocking the Electron main process. The `WorkerBridge` relays `postMessage()` events to the existing `AgentManagerEvents` interface.
- **Build Orchestration** (`orchestration/`) — Full planner → coder → QA pipeline. Parallel subagent execution via `Promise.allSettled()`.
- **Tools** (`tools/`) — 8 builtin tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch) defined with Zod schemas via AI SDK `tool()`.
- **Security** (`security/`) — Bash validator, command parser, and path containment ported from Python with identical allowlist behavior.
- **Config** (`config/`) — `AGENT_CONFIGS` registry (25+ agent types), phase-aware model resolution, thinking budgets.

### Key Patterns

```typescript
// Agent session using streamText()
import { streamText, stepCountIs } from 'ai';

const result = streamText({
  model: provider,
  system: systemPrompt,
  messages: conversationHistory,
  tools: toolRegistry.getToolsForAgent(agentType),
  stopWhen: stepCountIs(1000),
  onStepFinish: ({ toolCalls, text, usage }) => {
    progressTracker.update(toolCalls, text);
  },
});

// Tool definition with Zod schema
import { tool } from 'ai';
import { z } from 'zod';

const readTool = tool({
  description: 'Read a file from the filesystem',
  inputSchema: z.object({
    file_path: z.string(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  execute: async ({ file_path, offset, limit }) => { /* ... */ },
});
```

### Agent Prompts (`apps/desktop/prompts/`)

| Prompt | Purpose |
|--------|---------|
| planner.md | Implementation plan with subtasks |
| coder.md / coder_recovery.md | Subtask implementation / recovery |
| qa_reviewer.md / qa_fixer.md | Acceptance validation / issue fixes |
| spec_gatherer/researcher/writer/critic.md | Spec creation pipeline |
| complexity_assessor.md | AI-based complexity assessment |

### Spec Directory Structure

Each spec in `.auto-claude/specs/XXX-name/` contains: `spec.md`, `requirements.json`, `context.json`, `implementation_plan.json`, `qa_report.md`, `QA_FIX_REQUEST.md`

### Memory System (Graphiti)

Graph-based semantic memory accessed via a Python MCP sidecar (lives outside `apps/desktop/`). The AI layer connects to it via `createMCPClient` from `@ai-sdk/mcp`. Configured through the Electron app's onboarding/settings UI. See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#memory-system) for details.

## Frontend Development

### Tech Stack

React 19, TypeScript (strict), Electron 39, Vercel AI SDK v6, Zustand 5, Tailwind CSS v4, Radix UI, xterm.js 6, Vite 7, Vitest 4, Biome 2, Motion (Framer Motion)

### Path Aliases (tsconfig.json)

| Alias | Maps to |
|-------|---------|
| `@/*` | `src/renderer/*` |
| `@shared/*` | `src/shared/*` |
| `@preload/*` | `src/preload/*` |
| `@features/*` | `src/renderer/features/*` |
| `@components/*` | `src/renderer/shared/components/*` |
| `@hooks/*` | `src/renderer/shared/hooks/*` |
| `@lib/*` | `src/renderer/shared/lib/*` |

### State Management (Zustand)

All state lives in `src/renderer/stores/`. Key stores:

- `project-store.ts` — Active project, project list
- `task-store.ts` — Tasks/specs management
- `terminal-store.ts` — Terminal sessions and state
- `settings-store.ts` — User preferences
- `github/issues-store.ts`, `github/pr-review-store.ts` — GitHub integration
- `insights-store.ts`, `roadmap-store.ts`, `kanban-settings-store.ts`

Main process also has stores: `src/main/project-store.ts`, `src/main/terminal-session-store.ts`

### Styling

- **Tailwind CSS v4** with `@tailwindcss/postcss` plugin
- **7 color themes** (Default, Dusk, Lime, Ocean, Retro, Neo + more) defined in `src/shared/constants/themes.ts`
- Each theme has light/dark mode variants via CSS custom properties
- Utility: `clsx` + `tailwind-merge` via `cn()` helper
- Component variants: `class-variance-authority` (CVA)

### IPC Communication

Main ↔ Renderer communication via Electron IPC:
- **Handlers:** `src/main/ipc-handlers/` — organized by domain (github, gitlab, ideation, context, etc.)
- **Preload:** `src/preload/` — exposes safe APIs to renderer
- Pattern: renderer calls via `window.electronAPI.*`, main handles in IPC handler modules

### Agent Management (`src/main/agent/`)

The frontend manages agent lifecycle end-to-end:
- **`agent-queue.ts`** — Queue routing, prioritization, spec number locking
- **`agent-process.ts`** — Spawns worker threads via `WorkerBridge` for agent execution
- **`agent-state.ts`** — Tracks running agent state and status
- **`agent-events.ts`** — Agent lifecycle events and state transitions (structured events from worker threads)

### Claude Profile System (`src/main/claude-profile/`)

Multi-profile credential management for switching between Claude accounts:
- **`credential-utils.ts`** — OS credential storage (Keychain/Windows Credential Manager)
- **`token-refresh.ts`** — OAuth token lifecycle and automatic refresh
- **`usage-monitor.ts`** — API usage tracking and rate limiting per profile
- **`profile-scorer.ts`** — Scores profiles by usage and availability

### Terminal System (`src/main/terminal/`)

Full PTY-based terminal integration:
- **`pty-daemon.ts`** / **`pty-manager.ts`** — Background PTY process management
- **`terminal-lifecycle.ts`** — Session creation, cleanup, event handling
- **`claude-integration-handler.ts`** — Claude SDK integration within terminals
- Renderer: xterm.js 6 with WebGL, fit, web-links, serialize addons. Store: `terminal-store.ts`

## Code Quality

### Frontend
- **Linting:** Biome (`npm run lint` / `npm run lint:fix`)
- **Type checking:** `npm run typecheck` (strict mode)
- **Pre-commit:** Husky + lint-staged runs Biome on staged `.ts/.tsx/.js/.jsx/.json`
- **Testing:** Vitest + React Testing Library + jsdom


## i18n Guidelines

All frontend UI text uses `react-i18next`. Translation files: `apps/desktop/src/shared/i18n/locales/{en,fr}/*.json`

**Namespaces:** `common`, `navigation`, `settings`, `dialogs`, `tasks`, `errors`, `onboarding`, `welcome`

```tsx
import { useTranslation } from 'react-i18next';
const { t } = useTranslation(['navigation', 'common']);

<span>{t('navigation:items.githubPRs')}</span>     // CORRECT
<span>GitHub PRs</span>                             // WRONG

// With interpolation:
<span>{t('errors:task.parseError', { error })}</span>
```

When adding new UI text: add keys to ALL language files, use `namespace:section.key` format.

## Cross-Platform

Supports Windows, macOS, Linux. CI tests all three.

**Platform modules:** `apps/desktop/src/main/platform/`

| Function | Purpose |
|----------|---------|
| `isWindows()` / `isMacOS()` / `isLinux()` | OS detection |
| `getPathDelimiter()` | `;` (Win) or `:` (Unix) |
| `findExecutable(name)` | Cross-platform executable lookup |
| `requiresShell(command)` | `.cmd/.bat` shell detection (Win) |

Use `findExecutable()` and `joinPaths()` instead of hardcoded paths. See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#cross-platform-development) for extended guide.

## E2E Testing (Electron MCP)

QA agents can interact with the running Electron app via Chrome DevTools Protocol:

1. Start app: `npm run dev:debug` (debug mode for AI self-validation via Electron MCP)
2. Enable Electron MCP in settings
3. QA runs automatically through the TypeScript agent pipeline

Tools: `take_screenshot`, `click_by_text`, `fill_input`, `get_page_structure`, `send_keyboard_shortcut`, `eval`. See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#end-to-end-testing) for full capabilities.

## Running the Application

```bash
# Desktop app
npm start          # Production build + run
npm run dev        # Development mode with HMR
npm run dev:debug  # Debug mode with verbose output
npm run dev:mcp    # Electron MCP server for AI debugging

# Project data: .auto-claude/specs/ (gitignored)
```

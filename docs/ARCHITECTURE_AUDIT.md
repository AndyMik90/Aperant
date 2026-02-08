# Jerry (ac.jerry) - Complete Architecture Audit Document

> Generated: 2026-02-08
> Purpose: Ground truth reference for architecture auditing and bug hunting

---

## TABLE OF CONTENTS

1. [System Overview](#1-system-overview)
2. [Backend Core Infrastructure](#2-backend-core-infrastructure)
3. [Agent System](#3-agent-system)
4. [Spec Creation Pipeline](#4-spec-creation-pipeline)
5. [QA Validation System](#5-qa-validation-system)
6. [Frontend Electron App](#6-frontend-electron-app)
7. [Integration Systems](#7-integration-systems)
8. [CLI & Orchestration](#8-cli--orchestration)
9. [Security Model](#9-security-model)
10. [Test Suite](#10-test-suite)
11. [Environment Variables Master List](#11-environment-variables-master-list)
12. [Key Data Flows](#12-key-data-flows)
13. [File Manifest](#13-file-manifest)

---

## 1. SYSTEM OVERVIEW

Jerry is a multi-agent autonomous coding framework that builds software through coordinated AI agent sessions. It uses the **Claude Agent SDK** (`claude-agent-sdk`) for ALL AI interactions - never the Anthropic API directly.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.12+, Claude Agent SDK |
| **Frontend** | Electron 39.2.7, React 19.2.3, TypeScript 5.9.3 |
| **UI Framework** | Tailwind CSS 4.1.17 + Radix UI (Shadcn) |
| **State Management** | Zustand 5.0.9 |
| **Build Tool** | electron-vite 5.0.0 (Vite 7.2.7) |
| **Terminal** | xterm.js 6.0.0 + node-pty 1.1.0 |
| **Testing** | pytest (backend), Vitest + Playwright (frontend) |
| **Memory** | Graphiti (LadybugDB embedded, no Docker) |
| **Linting** | Ruff (Python), Biome 2.3.11 (TypeScript) |
| **Error Tracking** | Sentry 7.5.0 |

### Project Structure

```
ac.jerry/
├── apps/
│   ├── backend/           # Python backend/CLI - ALL agent logic
│   │   ├── agents/        # Agent implementations + tools
│   │   ├── analysis/      # Project analysis (security profiles)
│   │   ├── cli/           # CLI command modules
│   │   ├── core/          # Infrastructure (client, auth, workspace, platform)
│   │   ├── integrations/  # Graphiti, Linear
│   │   ├── memory/        # Memory systems
│   │   ├── prompts/       # 51 agent system prompts
│   │   ├── qa/            # QA validation agents
│   │   ├── runners/       # Specialized runners (GitHub, GitLab, roadmap)
│   │   ├── security/      # Security modules
│   │   └── spec/          # Spec management pipeline
│   └── frontend/          # Electron desktop UI
│       ├── src/main/      # Electron main process
│       ├── src/preload/   # IPC bridge
│       ├── src/renderer/  # React app
│       └── src/shared/    # Types, i18n, constants
├── scripts/               # Build and utility scripts
├── tests/                 # Test suite (69 test files)
├── docs/                  # Documentation
├── guides/                # User guides
├── shared_docs/           # Shared documentation
└── .github/workflows/     # CI/CD (8 workflow files)
```

### Core Pipeline

```
Spec Creation (spec_runner.py)           Implementation (run.py)
┌───────────────────────────────┐        ┌─────────────────────────┐
│ Actual phase counts            │        │ 1. Planner Agent        │
│ (from complexity.phases_to_run)│        │    → implementation_plan │
│                                │        │                         │
│ SIMPLE (5 phases):             │   ──►  │ 2. Coder Agent          │
│   discovery → hist_context →   │        │    → subtask loop       │
│   quick_spec → planning →      │        │                         │
│   validation                   │        │ 3. QA Reviewer          │
│                                │        │    → qa_report.md       │
│ STANDARD (7-8 phases):         │        │                         │
│   discovery → hist_context →   │        │ 4. QA Fixer (if needed) │
│   requirements → [research] →  │        │    → fix loop           │
│   context → spec_writing →     │        └─────────────────────────┘
│   planning → validation        │
│                                │
│ COMPLEX (9 phases):            │
│   discovery → hist_context →   │
│   requirements → research →    │
│   context → spec_writing →     │
│   self_critique → planning →   │
│   validation                   │
└────────────────────────────────┘
```

---

## 2. BACKEND CORE INFRASTRUCTURE

### 2.1 Client Factory (`core/client.py` - 1066 lines)

**CRITICAL**: This is the central piece that creates configured Claude SDK clients.

```python
def create_client(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    agent_type: str = "coder",
    max_thinking_tokens: int | None = None,
    output_format: dict | None = None,
    agents: dict | None = None,
    max_turns: int = 100,
) -> ClaudeSDKClient
```

**What it does:**
1. OAuth token validation via `require_auth_token()`
2. SDK environment variables setup
3. Project index + capability detection (cached, TTL=300s)
4. Project MCP configuration loading from `.auto-claude/.env`
5. Phase-aware tool filtering from `AGENT_CONFIGS`
6. MCP server configuration (only starts required servers)
7. Three-layer security setup (sandbox, filesystem permissions, bash hooks)
8. Worktree detection and permission granting
9. System prompt composition (base + optional CLAUDE.md)
10. 10MB buffer size (default is 1MB)

**MCP Servers Managed:**
- `context7`: `npx -y @upstash/context7-mcp`
- `electron`: `npm exec electron-mcp-server`
- `puppeteer`: `npx puppeteer-mcp-server`
- `linear`: HTTP server with auth header
- `graphiti-memory`: HTTP server at GRAPHITI_MCP_URL
- `auto-claude`: Custom tools from `agents/tools_pkg`

**Key Helper Functions:**
- `find_claude_cli() -> str | None` - Detects CLI binary (env → PATH → Homebrew → NVM → platform paths)
- `_validate_custom_mcp_server(server) -> bool` - Security validation (whitelist/blocklist)
- `load_project_mcp_config(project_dir) -> dict` - Parses CONTEXT7/LINEAR/ELECTRON/PUPPETEER/CUSTOM_MCP_SERVERS
- `is_graphiti_mcp_enabled() / is_electron_mcp_enabled()` - Feature checks
- `load_claude_md(project_dir) -> str | None` - Optional CLAUDE.md

**Simple Client (`core/simple_client.py`):**
```python
def create_simple_client(
    agent_type: str = "merge_resolver",
    model: str = "claude-haiku-4-5-20251001",
    ...
) -> ClaudeSDKClient
```
- Lightweight, single-turn, no MCP servers, no security hooks
- Agent types: merge_resolver, commit_message, insights, batch_analysis, batch_validation

### 2.2 Authentication (`core/auth.py`)

**Token Resolution Priority:**
1. `CLAUDE_CODE_OAUTH_TOKEN` env var
2. `ANTHROPIC_AUTH_TOKEN` env var (CCR/proxy)
3. System keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service)

**Key Functions:**
- `get_auth_token() -> str | None` - Primary resolution
- `require_auth_token() -> str` - Raises ValueError if missing
- `validate_token_not_encrypted(token)` - Rejects "enc:" prefix tokens
- `get_sdk_env_vars() -> dict` - Collects env vars for SDK subprocess (excludes ANTHROPIC_API_KEY)
- `ensure_claude_code_oauth_token()` - Sets env var for SDK

**SDK Environment Variables Forwarded:**
- `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `NO_PROXY`, `DISABLE_TELEMETRY`, `DISABLE_COST_WARNINGS`, `API_TIMEOUT_MS`
- `CLAUDE_CODE_GIT_BASH_PATH` (Windows)

### 2.3 Workspace Management (`core/workspace/` - 1000+ lines total)

**Models (`workspace/models.py`):**
```python
class WorkspaceMode(Enum):
    ISOLATED = "isolated"   # Separate worktree (safe)
    DIRECT = "direct"       # Work directly in project

class WorkspaceChoice(Enum):
    MERGE = "merge"    # Add to project
    REVIEW = "review"  # Show changes
    TEST = "test"      # Test in worktree
    LATER = "later"    # Decide later

@dataclass
class ParallelMergeTask: file_path, main_content, worktree_content, base_content, spec_name, project_dir
@dataclass
class ParallelMergeResult: file_path, merged_content, success, error, was_auto_merged

class MergeLock:  # Context manager for exclusive merge locking
class SpecNumberLock:  # Prevents spec number race conditions
```

**Setup (`workspace/setup.py`):**
- `choose_workspace()` - Auto-detects unsaved work, forces ISOLATED for safety
- `setup_workspace()` - Creates worktree or returns project_dir
- `copy_env_files_to_worktree()` - Copies .env, .env.local
- `copy_spec_to_worktree()` - Copies spec dir to worktree
- `ensure_timeline_hook_installed()` - Git hook for timeline tracking

**Finalization (`workspace/finalization.py`):**
- `finalize_workspace()` - Post-build user choice (TEST default, then MERGE/REVIEW/LATER)
- `handle_workspace_choice()` - Executes user's choice
- `discard_existing_build()` - Delete worktree + branch
- `list_all_worktrees()` - List all specs' worktrees
- `cleanup_all_worktrees(older_than_days=7)` - Delete stale worktrees

**Git Utils (`workspace/git_utils.py`):**
- `MAX_FILE_LINES_FOR_AI = 5000` - Skip AI merge for large files
- `MAX_PARALLEL_AI_MERGES = 5` - Concurrent AI merge limit
- `LOCK_FILES` set: 12 lock file patterns (package-lock.json, poetry.lock, etc.)
- `BINARY_EXTENSIONS` set: 100+ binary file extensions
- `detect_file_renames()` - Git rename detection (-M flag)
- `validate_merged_syntax()` - Validates Python/JS/TS/JSON/YAML/XML/HTML/CSS/Java/Rust/Go
- `create_conflict_file_with_git()` - Creates files with conflict markers

**Merge (`core/workspace.py` - main merge logic):**
```python
def merge_existing_build(
    project_dir, spec_name, no_commit=False,
    use_smart_merge=True, base_branch=None
) -> bool
```
Flow: detect worktree → detect branch → prevent self-merge → smart merge → fallback to git merge → handle conflicts

### 2.4 Worktree Manager (`core/worktree.py`)

```python
class WorktreeManager:
    def __init__(self, project_dir, base_branch=None)
```

**Timeouts:**
- `GIT_PUSH_TIMEOUT = 120s` (network)
- `GH_CLI_TIMEOUT = 60s` (commands)
- `GH_QUERY_TIMEOUT = 30s` (queries)

**Key Methods:**
- `create_worktree(spec_name) -> WorktreeInfo`
- `merge_worktree(spec_name, delete=True) -> bool`
- `push_branch(spec_name, force=False) -> PushBranchResult`
- `create_pull_request(spec_name, title, body) -> PullRequestResult`
- `push_and_create_pr(spec_name, title, body) -> PushAndCreatePRResult`
- `cleanup_merged_worktrees() -> int`
- `_with_retry(operation, max_retries=3)` - Retries on network/5xx, not on 401/403/404/422

**Worktree Paths:**
- Base: `.auto-claude/worktrees/tasks/{spec-name}/`
- Branch: `auto-claude/{spec-name}`

### 2.5 Platform Abstraction (`core/platform/` - 517 lines)

```python
class OS(Enum): WINDOWS, MACOS, LINUX
class ShellType(Enum): POWERSHELL, CMD, BASH, ZSH, FISH, UNKNOWN
```

**Functions:**
- `is_windows() / is_macos() / is_linux() / is_unix()`
- `get_path_delimiter()` - ";" or ":"
- `get_executable_extension()` - ".exe" or ""
- `find_executable(name, additional_paths=None) -> str | None`
- `requires_shell(command) -> bool` - Windows .cmd/.bat
- `validate_cli_path(cli_path) -> bool` - Rejects shell metacharacters, path traversal
- `get_claude_detection_paths() -> list[str]`
- `get_python_commands() -> list[list[str]]`

### 2.6 Exception Hierarchy (`core/exceptions.py`)

```
AutoClaudeError (base)
├── AgentError
│   ├── PlanningError
│   ├── CodingError
│   ├── QAError
│   └── RecoveryError
├── APIError
│   ├── RateLimitError (has retry_after)
│   ├── AuthenticationError (401)
│   └── TokenError
├── ConfigurationError
├── EnvironmentError
├── SpecError
├── PlanValidationError
├── WorktreeError
├── GitError
├── SecurityError
├── CommandBlockedError
├── MemoryError
└── IntegrationError
```

### 2.7 Other Core Modules

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `debug.py` | Colored debug logging | `debug()`, `debug_detailed()`, `debug_verbose()`, `@debug_timer()` |
| `retry.py` | Exponential backoff | `retry_async()`, `retry_sync()`, `RetryConfig(max_retries=3, base_delay=1.0)` |
| `progress.py` | Build progress tracking | `count_subtasks()`, `is_build_complete()`, `get_progress_percentage()` |
| `file_utils.py` | Atomic file writes | `atomic_write()`, `write_json_atomic()` |
| `phase_event.py` | Frontend sync protocol | `emit_phase()`, `emit_drift_report()` (ExecutionPhase enum) |
| `plan_normalization.py` | LLM field variant handling | `normalize_subtask_aliases()` |
| `model_config.py` | Utility model config | `get_utility_model_config()` (default: Haiku) |
| `sentry.py` | Error tracking | `init_sentry()`, `capture_exception()`, privacy path masking |
| `io_utils.py` | Safe console output | `safe_print()` (handles BrokenPipeError) |
| `gh_executable.py` | GitHub CLI finder | `get_gh_executable()`, `run_gh()` |
| `git_executable.py` | Git finder + env isolation | `get_git_executable()`, `run_git()`, `get_isolated_git_env()` |
| `dependency_validator.py` | Platform deps | `validate_platform_dependencies()` (pywin32, secretstorage) |

---

## 3. AGENT SYSTEM

### 3.1 Agent Configuration Registry (`agents/tools_pkg/models.py`)

**Single source of truth**: `AGENT_CONFIGS` dict maps agent_type -> tools/MCP/thinking

**Tool Categories:**
```python
BASE_READ_TOOLS = ["Read", "Glob", "Grep"]
BASE_WRITE_TOOLS = ["Write", "Edit", "Bash"]
WEB_TOOLS = ["WebFetch", "WebSearch"]
```

**Custom MCP Tool Constants:**
- `TOOL_UPDATE_SUBTASK_STATUS` = `mcp__auto-claude__update_subtask_status`
- `TOOL_GET_BUILD_PROGRESS` = `mcp__auto-claude__get_build_progress`
- `TOOL_RECORD_DISCOVERY` = `mcp__auto-claude__record_discovery`
- `TOOL_RECORD_GOTCHA` = `mcp__auto-claude__record_gotcha`
- `TOOL_GET_SESSION_CONTEXT` = `mcp__auto-claude__get_session_context`
- `TOOL_UPDATE_QA_STATUS` = `mcp__auto-claude__update_qa_status`

**Agent Configurations:**

| Agent | Tools | MCP Servers | Thinking | Bash |
|-------|-------|-------------|----------|------|
| `spec_gatherer` | Read + Web | none | medium | No |
| `spec_researcher` | Read + Web | context7 | medium | No |
| `spec_writer` | Read + Write | none | high | Yes |
| `spec_critic` | Read only | none | ultrathink | No |
| `planning` | Read + Write + Edit + Web | context7 | high | No |
| `planner` | Read + Write + Web | context7, graphiti, auto-claude, [linear] | high | Yes |
| `coder` | Read + Write + Web | context7, graphiti, auto-claude, [linear] | none | Yes |
| `qa_reviewer` | Read + Write + Web | context7, graphiti, auto-claude, browser, [linear] | high | Yes |
| `qa_fixer` | Read + Write + Web | context7, graphiti, auto-claude, browser, [linear] | medium | Yes |

### 3.2 Coder Agent (`agents/coder.py` - 43.6 KB)

**Main Function:**
```python
async def run_autonomous_agent(
    project_dir, spec_dir, model, max_iterations,
    verbose, source_spec_dir=None
) -> None
```

**Execution Flow:**
1. Load implementation_plan.json
2. Run planner session (if first run)
3. **Subtask Loop**: while pending subtasks exist:
   - Get next pending subtask
   - Generate subtask-specific prompt
   - Run Coder Agent session (`run_agent_session()`)
   - **Critical path** (synchronous): Update subtask status, save plan, sync to source
   - **Background enrichment** (async): Graphiti memory, Linear updates, insights
4. Post-completion: sync spec, run QA if applicable

**Session Management:**
```python
async def run_agent_session(
    client, starting_message, agent_type,
    subtask=None, session_num=None, attempt=1,
    previous_error=None, preloaded_graphiti_context=None
) -> tuple[str, str]  # (status, response_text)
```
- Status: "completed", "partial", "error", "stuck"
- Handles: session results, error recovery, stuck detection, Graphiti context injection

**Post-Session Processing:**
```python
async def post_session_processing(
    spec_dir, project_dir, subtask_id, session_num,
    success, subtasks_completed, discoveries
) -> None
```

**Key Features:**
- Path confusion prevention in prompts
- Monorepo handling
- Recovery mode (`coder_recovery.md` prompt) for stuck subtasks
- Subagent spawning for parallel work

### 3.3 Planning Agent (`agents/planning_agent.py` - 17.2 KB)

```python
class PlanningAgent:
    def __init__(self, spec_dir, project_dir, task_title,
                 model="claude-sonnet-4-5-20250929")

    async def run_interactive_planning() -> dict
    async def run_followup_planning(followup_request) -> dict
```

**Features:**
- Interactive planning with Anthropic memory tool
- Creates `spec.md` + `implementation_plan.json`
- Generates `RALPH_PROMPT.md` (ready-to-use autonomous execution prompt)
- Memory tool enabled (`include_memory_tool: True`)
- No bash execution allowed

### 3.4 Companion Agent (`agents/companion_agent.py` - 15.1 KB)

```python
class CompanionAgent:
    def __init__(self, spec_dir, project_dir, task_title,
                 current_phase, supervisor_mode=False)

    def build_context(self) -> str
    async def run_supervisor(self) -> None
```
- Read-only conversational interface between phases
- Answers user questions while coder is running
- Tools: Read, Glob, Grep only (no write, no bash)

### 3.5 Memory Manager (`agents/memory_manager.py` - 18.4 KB)

**Dual-Layer System:**
```
PRIMARY: Graphiti (semantic search, cross-session knowledge graph)
    ↓
FALLBACK: File-based memory (JSON/Markdown files)
```

**Key Functions:**
- `get_graphiti_context(spec_dir, project_dir, subtask) -> str | None`
- `save_session_memory(spec_dir, project_dir, subtask_id, session_num, success, ...) -> (bool, str)`
- `debug_memory_system_status()` - Prints health info

### 3.6 Memory Handlers (`agents/memory_handlers.py` - 11.2 KB)

Implements Anthropic memory tool protocol:
```python
class MemoryHandlers:
    def __init__(self, spec_dir)
    def view(path) -> str
    def create(path, content) -> str
    def str_replace(path, old_text, new_text) -> str
    def insert(path, line_number, content) -> str
    def delete(path) -> str
    def rename(path, new_path) -> str
    def _validate_path(path) -> Path  # Security: stays in memories/
```
Storage: `spec_dir/memories/`

### 3.7 User Message Queue (`agents/user_message_queue.py`)

Real-time chat between frontend and agents:
```python
def get_message_queue() -> UserMessageQueue | None
async def get_all_messages() -> list[UserMessage]
def is_pause_command(messages) -> bool
def is_stop_command(messages) -> bool
def is_control_command(messages) -> bool
```

---

## 4. SPEC CREATION PIPELINE

### 4.1 Pipeline Structure (`spec/pipeline/pipeline.py`)

**Dynamic 5-9 phase pipeline based on complexity** (from `complexity.py:phases_to_run()`):

| Complexity | Phases | Pipeline |
|------------|--------|----------|
| SIMPLE (1-2 files) | 5 | Discovery -> Historical Context -> Quick Spec -> Planning -> Validate |
| STANDARD (3-10 files) | 7-8 | Discovery -> Historical Context -> Requirements -> [Research] -> Context -> Spec Writing -> Planning -> Validate |
| COMPLEX (10+ files) | 9 | Discovery -> Historical Context -> Requirements -> Research -> Context -> Spec Writing -> Self-Critique -> Planning -> Validate |

### 4.2 Spec Module Structure

```
spec/
├── __init__.py                  # Lazy imports
├── complexity.py                # AI + heuristic complexity assessment
├── requirements.py              # Interactive requirements gathering
├── discovery.py                 # Project structure analysis
├── context.py                   # Relevant file discovery
├── writer.py                    # Spec document creation
├── validator.py                 # Validation helpers
├── compaction.py                # JSON compaction utilities
├── critique.py                  # Spec critique/validation
├── validation_strategy.py       # Strategy-based validation
├── phases/
│   ├── discovery_phases.py
│   ├── requirements_phases.py
│   ├── spec_phases.py
│   ├── planning_phases.py
│   └── executor.py             # Phase execution orchestrator
├── pipeline/
│   └── pipeline.py             # SpecOrchestrator class
└── validate_pkg/
    ├── spec_validator.py
    └── auto_fix_plan.py
```

### 4.3 Spec Agents

| Agent | Prompt | Input | Output | Tool Access |
|-------|--------|-------|--------|-------------|
| Complexity Assessor | `complexity_assessor.md` | Task description | Complexity tier | Read + Web |
| Spec Gatherer | `spec_gatherer.md` | project_index.json | requirements.json | Read + Web |
| Spec Researcher | `spec_researcher.md` | Requirements | research.json | Read + Web + Context7 |
| Spec Writer | `spec_writer.md` | All context | spec.md | Read + Write |
| Spec Critic | `spec_critic.md` | Spec + research | Fixed spec.md + critique_report.json | Read + Write + Context7 + ultrathink |

### 4.4 Spec Directory Output

```
.auto-claude/specs/XXX-name/
├── spec.md                      # Feature specification
├── implementation_plan.json     # Subtask plan + status
├── requirements.json            # Structured requirements
├── context.json                 # Relevant files discovered
├── project_index.json           # Project structure/services
├── research.json                # Validated library research
├── critique_report.json         # Spec critique findings
├── build-progress.txt           # Session-by-session notes
├── task_logs.json               # Execution logs (JSON)
├── task_logs.md                 # Execution logs (Markdown)
├── qa_report.md                 # QA findings
├── QA_FIX_REQUEST.md            # Issues to fix
├── RALPH_PROMPT.md              # Ralph-compatible execution prompt
├── REGRESSION_TEST_REPORT.md    # Test regression report
├── task_metadata.json           # Task config (model, branch, etc.)
├── memories/                    # Anthropic memory tool
│   ├── requirements.md
│   ├── decisions.md
│   └── discoveries.md
└── graphiti/                    # Graphiti memory storage
```

---

## 5. QA VALIDATION SYSTEM

### 5.1 QA Module Structure

```
qa/
├── __init__.py
├── loop.py          # Main QA orchestration loop
├── reviewer.py      # QA reviewer agent session
├── fixer.py         # QA fixer agent session
├── report.py        # Issue tracking and reporting
├── criteria.py      # Acceptance criteria management
└── qa_loop.py       # Legacy orchestration
```

### 5.2 QA Loop (`qa/loop.py`)

```python
async def run_qa_validation_loop(
    project_dir, spec_dir, model, verbose=False
) -> bool
```

**Constants:**
- `DEFAULT_MAX_QA_ITERATIONS = 50`
- `DEFAULT_MAX_CONSECUTIVE_ERRORS = 3`
- `DEFAULT_RECURRING_ISSUE_THRESHOLD = 2`

**Flow:**
```
1. QA Reviewer Session
   ├── [Approved] → SUCCESS
   └── [Rejected]
       ↓
2. Record iteration (issue tracking)
   ↓
3. Check for recurring issues
   ├── [3+ occurrences] → Escalate to Human
   └── [Continue]
       ↓
4. QA Fixer Session
   ↓
5. Loop back to QA Reviewer
   ↓
[Max iterations reached] → Escalate to Human
```

### 5.3 QA Reviewer (`qa/reviewer.py`)

Returns: `(status, response_text)` where status = "approved" | "rejected" | "error"

**Steps:**
1. Load spec.md, implementation_plan.json, Graphiti context
2. Verify all subtasks completed
3. Run development environment
4. Run automated tests (unit + integration + E2E)
5. Manual testing (acceptance criteria, edge cases)
6. Create qa_report.md

**Browser Tools Available:**
- Puppeteer: screenshot, click, fill, evaluate
- Electron: window_info, screenshot, send_command, read_logs

### 5.4 QA Fixer (`qa/fixer.py`)

Returns: `(status, response_text)` where status = "fixed" | "error"

**Steps:**
1. Load QA_FIX_REQUEST.md + qa_report.md + spec.md
2. Parse fix requirements
3. Apply fixes, commit, run tests after each
4. Verify all fixes

### 5.5 Issue Tracking (`qa/report.py`)

```python
ISSUE_SIMILARITY_THRESHOLD = 0.8   # SequenceMatcher ratio (Ratcliff/Obershelp)
RECURRING_ISSUE_THRESHOLD = 2      # Escalate after 2 occurrences
```

**Functions:**
- `record_iteration()`, `get_iteration_history()`
- `has_recurring_issues()`, `get_recurring_issue_summary()`
- `escalate_to_human()`, `create_manual_test_plan()`

### 5.6 Task Status Lifecycle

**Task Statuses** (defined in `shared/types.ts`):
`planning` | `coding` | `ai_review` | `human_review` | `pr_created` | `done` | `archived`

```
planning → coding → ai_review ←→ coding (QA rejection/fix loop)
                        ↓
                  human_review → pr_created → done → archived
                        ↓                      ↑
                       done ──────────────────-┘
```

**VALID_TRANSITIONS** (execution-handlers.ts):
| From | Allowed Targets |
|------|-----------------|
| planning | coding, archived |
| coding | planning, ai_review, human_review |
| ai_review | coding, human_review |
| human_review | coding, done, pr_created |
| pr_created | done |
| done | archived |
| archived | planning |

**Phase-to-Status Mapping** (automatic, from execution-progress events):
| Execution Phase | Maps to Status |
|-----------------|---------------|
| coding | coding |
| qa_review | ai_review |
| qa_fixing | ai_review |
| complete | human_review |

---

## 6. FRONTEND ELECTRON APP

### 6.1 Main Process (`src/main/`)

**Entry Point (`index.ts` - 530 lines):**
- Window creation with platform-specific settings
- GPU cache workaround for Windows
- macOS traffic light position customization
- Deep link protocol handler
- Auto-updater initialization
- Sentry initialization

**IPC Handlers (`ipc-handlers/` - 38 files):**
- `agent-events-handlers.ts` (30KB)
- `claude-code-handlers.ts` (40KB)
- `env-handlers.ts` (31KB)
- `memory-handlers.ts` (28KB)
- `github/` (18 modules)
- `gitlab/` (17 modules)
- `roadmap/` (8 modules)
- `context/` (3 modules)
- Plus: project, file, debug, drift, mcp, profile, linear, insights, ideation handlers

**Services:**
- `AgentManager` - Spawns/manages backend agent processes
- `TerminalManager` - PTY process lifecycle
- `PythonEnvManager` - Python runtime detection
- `CLI Tool Manager` - Tool detection + cache
- `File Watcher` - chokidar-based file monitoring
- `Claude Profile Manager` - OAuth token management
- `Task Log Service` - Phase-based logging
- `Memory Service` - Graphiti integration

### 6.2 Preload Bridge (`src/preload/`)

**Three-layer API:**
1. `electron-api.ts` - Direct Electron IPC (ipcRenderer.invoke)
2. `unified-api.ts` - Wraps electron-api with consistent interface
3. `index.ts` - Exports via `contextBridge.exposeInMainWorld('api', unifiedAPI)`

**Security:**
- Context isolation enabled
- Node integration disabled
- No direct `require` in renderer

### 6.3 Renderer (`src/renderer/`)

**Root Component (`App.tsx` - 1276 lines):**
- Theme initialization (light/dark/system)
- Zustand store hydration
- Global keyboard shortcuts
- IPC event listeners
- Layout: Header → Sidebar + MainContent

**State Management (Zustand stores):**

| Store | Purpose | Key State |
|-------|---------|-----------|
| `app-store.ts` | Global app state | projects, activeProject, settings, theme |
| `task-store.ts` | Task management | tasks, activeTask, taskStatus |
| `terminal-store.ts` | Terminal sessions | terminals, activeTerminal, outputBuffers |
| `agent-store.ts` | Agent state | agents, agentStatus, execution progress |
| `drift-store.ts` | Drift monitoring | stale state detection |

**Key Components:**
- `Sidebar.tsx` - Navigation with collapsible sections
- `TaskKanban.tsx` - 6-column kanban (planning→coding→ai_review→human_review→pr_created→done)
- `TaskCard.tsx` / `SortableTaskCard.tsx` - Drag-drop task cards
- `TaskCreationWizard.tsx` - Multi-step task creation
- `QuickTaskDialog.tsx` (Cmd+K) - Quick task entry
- `GlobalSearchDialog.tsx` (Cmd+P) - Search
- `AppSettings.tsx` - Settings dialog
- `Worktrees.tsx` (995 lines) - Git worktree management UI
- `BottomPanelTerminal.tsx` - VS Code-style terminal panel

**Code Splitting (React.lazy):**
DiscoveryHub, Context, RepositoryHub, Insights, GitLabIssues, Changelog, Worktrees, OnboardingWizard, AppSettingsDialog

**Internationalization (react-i18next):**
- Languages: en, fr
- Namespaces: common, navigation, settings, tasks, welcome, onboarding, dialogs, gitlab, taskReview, terminal, errors
- Rule: NEVER hardcode strings, always use `t()`

### 6.4 Shared Types (`src/shared/types/`)

**Key Types:**
```typescript
TaskStatus = 'planning' | 'coding' | 'ai_review' | 'human_review' | 'pr_created' | 'done'
ReviewReason = 'completed' | 'errors' | 'qa_rejected' | 'plan_review'
SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

interface ExecutionProgress {
  phase: ExecutionPhase
  phaseProgress: number        // 0-100 within phase
  overallProgress: number      // 0-100 overall
  currentSubtask?: string
  message?: string
  sequenceNumber?: number      // Detect stale updates
  completedPhases?: CompletablePhase[]
}
```

### 6.5 Build & Deployment

**Dev:** `npm run dev` (electron-vite + HMR)
**Build:** `npm run build` → `out/main/`, `out/renderer/`, `out/preload/`
**Package:** `npm run package:mac|win|linux`
- macOS: `.dmg` (signed + notarized)
- Windows: `.nsis` installer
- Linux: `.AppImage`, `.deb`, `.flatpak`
- Python bundled via `scripts/download-python.cjs` + `scripts/package-with-python.cjs`

---

## 7. INTEGRATION SYSTEMS

### 7.1 Graphiti Memory System (`integrations/graphiti/`)

**Architecture:**
```
integrations/graphiti/
├── config.py              # GraphitiConfig, GraphitiState, get_graphiti_status()
├── memory.py              # GraphitiMemory facade, get_graphiti_memory()
├── queries_pkg/
│   ├── client.py          # GraphitiClient (LadybugDB wrapper)
│   ├── queries.py         # GraphitiQueries (episode storage)
│   ├── search.py          # GraphitiSearch (semantic search)
│   └── schema.py          # Episode types, constants
└── providers_pkg/
    ├── factory.py          # create_llm_client(), create_embedder()
    ├── validators.py       # Health checks
    ├── models.py           # EMBEDDING_DIMENSIONS dict
    ├── exceptions.py       # ProviderError, ProviderNotInstalled
    ├── llm_providers/      # 6 providers: openai, anthropic, azure, ollama, google, openrouter
    └── embedder_providers/ # 6 providers: openai, voyage, azure, ollama, google, openrouter
```

**GraphitiMemory API:**
```python
memory = get_graphiti_memory(spec_dir, project_dir, group_id_mode="project")
await memory.initialize()
context = await memory.get_context_for_session("query", max_results=10)
await memory.add_session_insight(session_num, insights)
await memory.add_codebase_discoveries(discoveries)
await memory.add_pattern(pattern)
await memory.add_gotcha(gotcha)
```

**Episode Types:**
session_insight, codebase_discovery, pattern, gotcha, task_outcome, qa_result, historical_context

**Group ID Modes:**
- `SPEC` - Each spec gets isolated memory
- `PROJECT` - All specs share project-wide context

### 7.2 Linear Integration (`integrations/linear/`)

**Config (`config.py`):**
```python
STATUS_TODO = "Todo"
STATUS_IN_PROGRESS = "In Progress"
STATUS_IN_REVIEW = "In Review"
STATUS_DONE = "Done"
STATUS_BLOCKED = "Blocked"
STATUS_CANCELED = "Canceled"
```

**Manager (`integration.py`):**
```python
class LinearManager:
    def __init__(self, spec_dir, project_dir)
    async def create_issues_from_plan(implementation_plan) -> bool
    async def update_subtask_status(subtask_id, status) -> bool
    async def add_attempt_comment(subtask_id, ...) -> bool
    async def mark_stuck(subtask_id, ...) -> bool
```

**Updater (`updater.py`):** Mini-agent pattern for focused Linear updates:
```python
async def create_linear_task(spec_id, spec_title, description) -> (bool, str | None)
async def linear_task_started(task_id) -> bool
async def linear_subtask_completed(task_id, subtask_id) -> bool
async def linear_qa_started/approved/rejected(task_id) -> bool
async def linear_build_complete(task_id, status) -> bool
```

### 7.3 GitHub Automation (`runners/github/` - 41 files)

**CLI Commands:**
- `review-pr <number>` - AI-powered code review
- `triage [--apply-labels] [numbers]` - Issue classification + dedup
- `auto-fix <issue_number>` - Create spec from issue
- `batch-issues [numbers]` - Batch similar issues

**GHClient (`gh_client.py`):**
```python
class GHClient:
    def __init__(self, project_dir, default_timeout=30.0, max_retries=3, enable_rate_limiting=True)
    async def pr_get/pr_diff/pr_review/pr_list(...)
    async def issue_get/issue_list/issue_comment(...)
```
- Timeout/retry protection
- Rate limiting
- `PRTooLargeError` for >20,000 line PRs

### 7.4 Project Analyzer (`analysis/project_analyzer.py`)

**Detects tech stack and builds security profiles:**
- BASE_COMMANDS, LANGUAGE_COMMANDS, PACKAGE_MANAGER_COMMANDS
- FRAMEWORK_COMMANDS, DATABASE_COMMANDS, INFRASTRUCTURE_COMMANDS
- CLOUD_COMMANDS, CODE_QUALITY_COMMANDS, VERSION_MANAGER_COMMANDS

**Cache:** `.auto-claude-security.json`

```python
def get_or_create_profile(project_dir, force_reanalyze=False) -> SecurityProfile
def is_command_allowed(command, profile) -> bool
```

---

## 8. CLI & ORCHESTRATION

### 8.1 Main Entry Point (`run.py` - 600+ lines)

```bash
python run.py --spec 001                  # Run autonomous build
python run.py --spec 001 --qa             # Run QA validation
python run.py --spec 001 --review         # Review changes
python run.py --spec 001 --merge          # Merge into project
python run.py --spec 001 --discard        # Delete worktree
python run.py --spec 001 --followup       # Add follow-up tasks
python run.py --spec 001 --qa-status      # Check QA status
python run.py --list                      # List all specs
python run.py --plan "description"        # Interactive planning
python run.py --create-pr                 # Create GitHub PR
python run.py --merge-preview             # Preview conflicts
python run.py --batch-create file.json    # Batch create tasks
python run.py --batch-status              # Batch status
python run.py --cleanup-worktrees         # Remove stale worktrees
python run.py --recovery                  # Fix corrupted JSON
```

**Build Flow (`handle_build_command`):**
1. Get phase-specific models
2. Validate environment (auth token, spec.md, integrations)
3. Load review approval state
4. Check existing build
5. Choose workspace mode (isolated vs direct)
6. Setup workspace
7. `asyncio.run(run_autonomous_agent())`
8. Run QA validation (if applicable)
9. Finalize workspace (merge/review/discard)

**Interrupt Handling (`_handle_build_interrupt`):**
- Pause banner with input options (type, paste, file, skip)
- Saves to `HUMAN_INPUT.md`
- Resume with: `python run.py --spec XXX`

### 8.2 Spec Runner (`runners/spec_runner.py`)

```bash
python runners/spec_runner.py --interactive
python runners/spec_runner.py --task "Add user authentication"
python runners/spec_runner.py --task "Fix button" --complexity simple
python runners/spec_runner.py --continue <spec-id>
```

### 8.3 CLI Command Modules (`cli/`)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `workspace_commands.py` | Workspace merge/review/discard | `handle_merge_command()`, `handle_review_command()`, `handle_create_pr_command()` |
| `spec_commands.py` | Spec listing | `list_specs()`, `print_specs_list()` |
| `qa_commands.py` | QA management | `handle_qa_status_command()`, `handle_qa_command()` |
| `followup_commands.py` | Follow-up tasks | `collect_followup_task()` |
| `batch_commands.py` | Batch operations | `handle_batch_create_command()`, `handle_batch_status_command()` |
| `recovery.py` | JSON recovery | `detect_corrupted_files()`, `backup_corrupted_file()` |
| `input_handlers.py` | User input | `collect_user_input_interactive()` |
| `utils.py` | Shared utilities | `find_spec()`, `validate_environment()`, `get_project_dir()` |

### 8.4 Other Runners

| Runner | Purpose |
|--------|---------|
| `companion_runner.py` | Runs companion agent between phases |
| `insights_runner.py` | Extracts session insights |
| `ai_analyzer_runner.py` | AI analysis |
| `ideation_runner.py` | Improvement ideas |
| `roadmap_runner.py` | Feature roadmaps |
| `github/runner.py` | GitHub PR review, issue triage, auto-fix |

### 8.5 Configuration Precedence

**Model Selection:**
1. CLI `--model` flag
2. `AUTO_BUILD_MODEL` env var
3. Phase-specific config in `task_metadata.json`
4. Default: `"sonnet"` (Claude Sonnet 4.5)

**Base Branch:**
1. CLI `--base-branch`
2. `task_metadata.json`
3. `DEFAULT_BRANCH` env var
4. Auto-detect: main -> master -> current
5. Default: "main"

---

## 9. SECURITY MODEL

### 9.1 Three-Layer Defense

1. **OS Sandbox** - Bash command isolation via Claude SDK sandbox
2. **Filesystem Permissions** - Restricted to project_dir, spec_dir, original project (worktrees)
3. **Command Allowlist** - Dynamic from project analysis (`security.py` + `project_analyzer.py`)

### 9.2 MCP Server Validation

```python
def _validate_custom_mcp_server(server) -> bool
```
- **Whitelist**: npx, npm, node, python, python3, uv, uvx
- **Blocklist**: bash, sh, cmd, powershell, zsh, fish
- **Rejected flags**: --eval, -e, -c, --exec, -m, -p
- **Rejected**: Path separators in commands (prevents path traversal)

### 9.3 Frontend Security

- Context isolation enabled
- Node integration disabled
- URL scheme allowlist: http, https, mailto
- Path validation: shell metacharacters, env expansion blocked
- Graceful process termination with force-kill fallback

### 9.4 Security Profile Cache

`.auto-claude-security.json` - Cached per-project security profile from tech stack analysis

---

## 10. TEST SUITE

### 10.1 Overview

- **83 total test files** (69 in `/tests/`, 14 in `/apps/backend/`)
- **Framework**: pytest + pytest-asyncio
- **conftest.py**: 1,154 lines of shared fixtures
- **Markers**: `slow`, `integration`, `asyncio`

### 10.2 Test Categories

| Category | Files | Coverage |
|----------|-------|----------|
| Authentication & Auth | 6 | Tokens, keychains, SDK vars, security scanning |
| Core Infrastructure | 8 | Agent architecture, configs, platform, discovery, git |
| Git & Worktree | 5 | Worktree ops, PR worktrees, merge tests |
| Merge System | 10 | Types, auto-merger, conflict detection, orchestration, AI resolver |
| Spec & Planning | 8 | Pipeline, complexity, phases, plan schema |
| QA & Validation | 13 | QA loop, criteria, reports, iteration, recurring, output validation |
| GitHub Integration | 6 | PR review, E2E, bot detection, critique |
| Review System | 4 | State, approval, feedback, integration |
| Memory & Context | 3 | Graphiti config, search, handlers |
| Other | 12+ | Dependencies, risk, structured output, service orchestration |

### 10.3 Key Fixtures

- `temp_git_repo` - Isolated git repo with env isolation
- `python_project` / `node_project` / `docker_project` - Sample projects
- `sample_implementation_plan` - Realistic plan fixture
- `mock_run_agent_fn` - Configurable async agent mock factory
- `mock_spec_validator` - Validation result factory

### 10.4 SDK Mocking Pattern

Tests pre-mock `claude_agent_sdk` and `claude_code_sdk` before imports since these aren't available in the test environment. The conftest manages:
- Original module state preservation
- Per-test module isolation
- Selective mock preservation

---

## 11. ENVIRONMENT VARIABLES MASTER LIST

### Authentication (Required)
```
CLAUDE_CODE_OAUTH_TOKEN     # Primary OAuth token
ANTHROPIC_AUTH_TOKEN        # Enterprise CCR/proxy
ANTHROPIC_BASE_URL          # Custom API endpoint
```

### Model Configuration
```
ANTHROPIC_MODEL             # Model override
ANTHROPIC_DEFAULT_HAIKU_MODEL  # Haiku model override
AUTO_BUILD_MODEL            # Default build model
UTILITY_MODEL_ID            # Utility ops model (default: Haiku)
UTILITY_THINKING_BUDGET     # Thinking budget for utility ops
```

### Git & Workspace
```
DEFAULT_BRANCH              # Base branch (auto-detect)
CLAUDE_CODE_GIT_BASH_PATH   # Windows git-bash path
```

### Debug
```
DEBUG=true                  # Enable debug logging
DEBUG_LEVEL=1|2|3           # Verbosity
DEBUG_LOG_FILE=path         # File logging
```

### MCP Servers
```
CONTEXT7_ENABLED=true       # Context7 MCP
LINEAR_MCP_ENABLED=true     # Linear MCP
ELECTRON_MCP_ENABLED=true   # E2E testing via CDP
ELECTRON_DEBUG_PORT=9222    # Chrome DevTools port
PUPPETEER_MCP_ENABLED=true  # Puppeteer MCP
GRAPHITI_MCP_URL            # Graphiti MCP URL
USE_CLAUDE_MD=true          # Include CLAUDE.md in system prompt
CUSTOM_MCP_SERVERS          # JSON array of custom servers
AGENT_MCP_<agent>_ADD/REMOVE # Per-agent MCP overrides
```

### Graphiti Memory
```
GRAPHITI_ENABLED=true
GRAPHITI_DATABASE=auto_claude_memory
GRAPHITI_DB_PATH=~/.auto-claude/memories
GRAPHITI_LLM_PROVIDER=openai|anthropic|azure_openai|ollama|google|openrouter
GRAPHITI_EMBEDDER_PROVIDER=openai|voyage|azure_openai|ollama|google|openrouter
```

### Provider Credentials
```
OPENAI_API_KEY, OPENAI_MODEL, OPENAI_EMBEDDING_MODEL
ANTHROPIC_API_KEY, GRAPHITI_ANTHROPIC_MODEL
AZURE_OPENAI_API_KEY, AZURE_OPENAI_BASE_URL, AZURE_OPENAI_LLM_DEPLOYMENT, AZURE_OPENAI_EMBEDDING_DEPLOYMENT
VOYAGE_API_KEY, VOYAGE_EMBEDDING_MODEL
GOOGLE_API_KEY, GOOGLE_LLM_MODEL, GOOGLE_EMBEDDING_MODEL
OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_LLM_MODEL, OPENROUTER_EMBEDDING_MODEL
OLLAMA_BASE_URL, OLLAMA_LLM_MODEL, OLLAMA_EMBEDDING_MODEL, OLLAMA_EMBEDDING_DIM
```

### Integrations
```
LINEAR_API_KEY, LINEAR_TEAM_ID, LINEAR_PROJECT_ID
GITLAB_INSTANCE_URL, GITLAB_TOKEN, GITLAB_PROJECT
GITHUB_TOKEN, GITHUB_BOT_TOKEN, GITHUB_REPO
```

### Sentry
```
SENTRY_DSN                  # Error reporting endpoint
SENTRY_ENVIRONMENT          # Override environment
SENTRY_DEV=true             # Enable in development
SENTRY_TRACES_SAMPLE_RATE   # Performance monitoring (0-1, default 0.1)
```

### SDK Forwarded
```
NO_PROXY, DISABLE_TELEMETRY, DISABLE_COST_WARNINGS, API_TIMEOUT_MS
CLAUDE_CLI_PATH             # Override CLI detection
```

---

## 12. KEY DATA FLOWS

### 12.1 Build Execution

```
User: python run.py --spec 001
  ↓
run.py: parse_args() → find_spec() → validate_environment()
  ↓
handle_build_command():
  ├── get_phase_model(spec_dir, "planning"/"coding"/"qa", model)
  ├── ReviewState.load(spec_dir) → is_approval_valid()
  ├── choose_workspace() → setup_workspace() [creates worktree]
  ├── asyncio.run(run_autonomous_agent(...))
  │     ├── load implementation_plan.json
  │     ├── [Planner Session] → creates/updates plan
  │     ├── [Ralph Loop — Batch Mode] (FIX-028 documentation):
  │     │     ├── get_pending_subtasks_batch(spec_dir, max_batch=8)
  │     │     │     → Collects up to 8 pending subtasks from phases
  │     │     │       whose dependencies are satisfied
  │     │     ├── Build ralph prompt with task table:
  │     │     │     "You have N subtasks. Complete them IN ORDER."
  │     │     │     + anti-skip rules, hard stop on failure
  │     │     ├── run_agent_session(client, ralph_prompt)
  │     │     │     → Single SDK session processes all subtasks
  │     │     │     → Model selected once per session (FIX-036)
  │     │     ├── For each subtask completed in session:
  │     │     │     ├── update_subtask_status()  [critical path]
  │     │     │     ├── save_session_memory()    [background]
  │     │     │     └── linear_subtask_completed() [background]
  │     │     ├── Auto-continue: if subtasks remain, loop
  │     │     │     with fresh SDK client (new context window)
  │     │     └── Stop when: all complete OR stuck OR max sessions
  │     └── sync_spec_to_source()
  ├── run_qa_validation_loop(...)
  │     ├── QA Reviewer → qa_report.md
  │     ├── [If rejected] QA Fixer → fix + re-review
  │     └── [Loop until approved or max iterations]
  └── finalize_workspace() → merge/review/discard
```

### 12.2 Client Creation

```
create_client(project_dir, spec_dir, model, agent_type)
  ├── require_auth_token() → get_auth_token() [env → keychain]
  ├── get_sdk_env_vars() → env dict for SDK subprocess
  ├── _get_cached_project_data(project_dir) [TTL=300s]
  ├── load_project_mcp_config(project_dir) → MCP settings
  ├── get_allowed_tools(agent_type) → tool allowlist from AGENT_CONFIGS
  ├── get_required_mcp_servers(agent_type) → server list
  ├── load_claude_md(project_dir) → optional CLAUDE.md
  └── ClaudeSDKClient(
        cli_path, model, system_prompt,
        allowed_tools, mcp_servers,
        sandbox_config, permission_config,
        bash_security_hook, max_thinking_tokens,
        max_buffer_size=10MB
      )
```

### 12.3 Workspace Lifecycle

```
1. choose_workspace()
   ├── Auto-detect unsaved work → force ISOLATED
   └── User picks: ISOLATED (recommended) or DIRECT
2. setup_workspace()
   ├── [ISOLATED] create worktree at .auto-claude/worktrees/tasks/{name}/
   │   ├── git worktree add
   │   ├── copy_env_files_to_worktree()
   │   ├── copy_spec_to_worktree()
   │   └── return (worktree_path, manager)
   └── [DIRECT] return (project_dir, None)
3. Agent runs in workspace
4. finalize_workspace()
   ├── User picks: TEST (default) → MERGE → REVIEW → LATER
   └── handle_workspace_choice()
5. merge_existing_build()
   ├── detect_file_renames()
   ├── smart merge (AI conflict resolution)
   ├── fallback: git merge
   └── handle remaining conflicts
```

---

## 13. FILE MANIFEST

### Backend Core (`apps/backend/core/`)

| File | Lines | Purpose |
|------|-------|---------|
| client.py | 1066 | Claude SDK client factory |
| workspace.py | 1000+ | Merge operations |
| auth.py | ~500 | OAuth token management |
| worktree.py | 200+ | Git worktree manager |
| platform/__init__.py | 517 | Cross-platform abstraction |
| debug.py | ~200 | Debug logging |
| retry.py | ~150 | Retry with backoff |
| sentry.py | ~200 | Error tracking |
| exceptions.py | ~100 | Exception hierarchy |
| progress.py | ~200 | Build progress |
| simple_client.py | ~100 | Lightweight client |
| workspace/models.py | ~100 | Data classes |
| workspace/git_utils.py | 200+ | Git utilities |
| workspace/setup.py | ~200 | Workspace setup |
| workspace/finalization.py | ~200 | Post-build workflow |
| workspace/display.py | ~100 | Display functions |

### Backend Agents (`apps/backend/agents/`)

| File | Size | Purpose |
|------|------|---------|
| coder.py | 43.6 KB | Main coder agent |
| session.py | 27.8 KB | Session management |
| planning_agent.py | 17.2 KB | Planning agent |
| companion_agent.py | 15.1 KB | Companion agent |
| memory_manager.py | 18.4 KB | Memory orchestration |
| memory_handlers.py | 11.2 KB | Memory tool handlers |
| user_message_queue.py | 8.7 KB | User message queue |
| tools_pkg/models.py | - | AGENT_CONFIGS registry |

### Backend Prompts (`apps/backend/prompts/` - 51 files)

**Main Agents:** planner.md, coder.md, coder_recovery.md, qa_reviewer.md, qa_fixer.md, qa_review_and_fix.md
**Spec Creation:** spec_gatherer.md, spec_researcher.md, spec_writer.md, spec_critic.md, spec_quick.md, complexity_assessor.md, validation_fixer.md
**Planning:** planning_agent.md, followup_planner.md, spec_contract.json
**Fast Mode:** qa_reviewer_fast.md, qa_fixer_fast.md
**Analysis:** roadmap_discovery.md, roadmap_features.md, competitor_analysis.md, insight_extractor.md
**Ideation:** ideation_code_improvements.md, ideation_code_quality.md, ideation_documentation.md, ideation_performance.md, ideation_security.md, ideation_ui_ux.md
**GitHub:** 22 prompt files in `github/`

### Frontend Key Files

| File | Lines | Purpose |
|------|-------|---------|
| src/main/index.ts | 530 | Electron app init |
| src/renderer/App.tsx | 1276 | Root React component |
| src/renderer/components/Worktrees.tsx | 995 | Worktree management |
| src/main/platform/index.ts | 505 | Platform abstraction |
| src/main/ipc-handlers/ | 38 files | IPC handler modules |
| src/shared/types/ | 13 modules | TypeScript types |
| src/shared/i18n/ | 22 locale files | Translations (en + fr) |
| package.json | 247 | Dependencies + scripts |

### CI/CD Workflows

| Workflow | Purpose |
|----------|---------|
| ci.yml | Cross-platform testing (Ubuntu/Windows/macOS, Python 3.12/3.13) |
| release.yml | Multi-platform release build |
| beta-release.yml | Beta releases |
| lint.yml | Linting checks |
| quality-security.yml | Security scanning |
| virustotal-scan.yml | Malware scanning |
| discord-release.yml | Discord notifications |
| issue-auto-label.yml / pr-labeler.yml | Issue/PR labeling |

---

## END OF ARCHITECTURE AUDIT DOCUMENT

This document represents the complete ground truth of the Jerry (ac.jerry) codebase as of 2026-02-08. Use this as the reference when auditing for bugs, architecture drift, or missing features.

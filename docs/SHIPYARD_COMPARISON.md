# Shipyard vs Jerry: Feature Comparison & Portability Analysis

**Date:** 2026-02-06
**Shipyard Version:** 2.8.0 (by lgbarn, MIT License)
**Shipyard Repo:** `C:\Users\jamie.ballard\Documents\GitHub\shipyard-main`
**Jerry Repo:** `C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude`

---

## What Is Shipyard?

Shipyard is a **Claude Code plugin** (not an Electron app) that provides structured software development lifecycle management. It orchestrates 9 specialized AI agents, enforces quality gates (TDD, security audit, code review), and includes cross-session episodic memory with vector search. It's entirely CLI/text-based — no GUI.

**Key difference from Jerry:** Shipyard runs *inside* Claude Code as a plugin. Jerry runs *alongside* Claude Code as an Electron app that spawns and manages Claude processes. Shipyard is a development workflow tool; Jerry is an autonomous coding agent with a visual dashboard.

---

## Feature Matrix

| Feature | Shipyard | Jerry | Verdict |
|---------|----------|-------|---------|
| **Multi-agent orchestration** | 9 specialized agents (architect, builder, reviewer, auditor, etc.) | Primary agent + companion agent | Shipyard more diverse |
| **Model routing** | Per-role selection (haiku/sonnet/opus) | Single model per agent | PORT THIS |
| **Episodic memory** | SQLite + vector embeddings (local) | Graphiti + file-based (dual layer) | LEARN FROM THIS |
| **Secret scrubbing** | 17 patterns redacted before storage | None | PORT THIS |
| **Quality gates** | TDD, 2-stage review, security audit, IaC validation | QA loop with reviewer + fixer | LEARN FROM THIS |
| **Git integration** | Worktrees, checkpoints, atomic commits, rollback | Basic git via Claude | PORT CHECKPOINTS |
| **Skill auto-activation** | 17 skills with deterministic triggers | None (manual prompt) | CONSIDER |
| **State persistence** | .shipyard/ files + STATE.md | Zustand stores + IPC | Different paradigm |
| **Progress UI** | Text-based (Claude Code native tasks) | Full Electron GUI (TaskCard, ActivityFeed, etc.) | Jerry far ahead |
| **Session hooks** | SessionStart + PostToolUse hooks | None | CONSIDER |
| **Database repair** | 7-check pipeline + migrations | None | PORT FOR MEMORY |
| **Storage management** | Auto-pruning at cap (1GB default) | None | PORT THIS |
| **IaC validation** | Terraform, Ansible, Docker | Not applicable | SKIP |
| **Task decomposition** | Phase > Plan > Task hierarchy with waves | Spec > Build pipeline | Different approach |
| **Real-time streaming** | None (batch output) | Full streaming terminal output | Jerry far ahead |

---

## Recommended Ports (Priority Order)

### 1. SECRET SCRUBBING FOR MEMORY STORAGE
**Priority: HIGH | Effort: LOW**

Shipyard scrubs 17 secret patterns before indexing conversations into memory:
- AWS Access Keys, GitHub/OAuth tokens
- Anthropic/OpenAI API keys
- Database URLs, private keys, JWT tokens
- Azure connection strings, Stripe/Slack/NPM tokens

**Why Jerry needs this:** Jerry stores conversation history and memory. If a user's codebase contains API keys or the agent encounters credentials during execution, these could be persisted in Jerry's memory layer (Graphiti or file-based).

**Implementation:**
- Create `apps/backend/memory/scrubber.py`
- 17 regex patterns, each with a replacement tag like `[REDACTED:AWS_KEY]`
- Call scrubber before any memory write operation
- ~100 lines of Python

```
Shipyard reference: src/memory/scrubber.ts (100 lines)
Jerry target: apps/backend/memory/scrubber.py
```

---

### 2. MODEL ROUTING PER AGENT ROLE
**Priority: HIGH | Effort: MEDIUM**

Shipyard routes different agent roles to different models:
```json
{
  "model_routing": {
    "validation": "haiku",
    "building": "sonnet",
    "planning": "sonnet",
    "architecture": "opus",
    "debugging": "opus",
    "review": "sonnet",
    "security_audit": "sonnet"
  }
}
```

**Why Jerry needs this:** Jerry currently uses a single model for each agent. Using haiku for lightweight validation (complexity classification, QA pre-checks) and opus only for architecture decisions would significantly reduce cost and latency.

**Implementation:**
- Add `model_routing` to Jerry's settings/config
- Modify `agent-manager.ts` to select model based on agent role
- Map: companion=haiku, spec-generation=sonnet, qa-review=sonnet, complexity-classifier=haiku
- Settings UI dropdown per role

```
Shipyard reference: docs/PROTOCOLS.md (Model Routing Protocol)
Jerry target: apps/frontend/src/main/agent/agent-manager.ts + settings store
```

---

### 3. GIT CHECKPOINT & ROLLBACK SYSTEM
**Priority: HIGH | Effort: MEDIUM**

Shipyard creates named git tag checkpoints at key lifecycle points:
- `pre-build-phase-{N}` before executing
- `post-build-phase-{N}` after completing
- Safety checkpoint before any rollback

Users can rollback to any checkpoint with state recovery.

**Why Jerry needs this:** Jerry autonomously writes code. If an agent goes off-rails, there's no easy way to revert. Checkpoints at pre-build and post-build would give users a safety net.

**Implementation:**
- Before starting a build: `git tag jerry-pre-build-{taskId}`
- After successful build: `git tag jerry-post-build-{taskId}`
- Add "Rollback" button to TaskCard UI
- Rollback = `git reset --hard {tag}` + restore Jerry state

```
Shipyard reference: scripts/checkpoint.sh, commands/rollback.md
Jerry target: apps/backend/ (new checkpoint module) + TaskCard UI button
```

---

### 4. MEMORY STORAGE MANAGEMENT (PRUNING + REPAIR)
**Priority: MEDIUM | Effort: MEDIUM**

Shipyard includes:
- **Auto-pruning** — When memory DB exceeds cap (default 1GB), deletes oldest exchanges
- **7-check repair pipeline** — Structural integrity, referential integrity, orphaned records, stale entries, missing embeddings, reindex, vacuum
- **Migration framework** — Sequential SQL migrations with version tracking
- **Backup rotation** — Timestamped backups, keeps last 5

**Why Jerry needs this:** Jerry's dual-layer memory (Graphiti + file-based) will accumulate data over time. Without pruning, it'll grow unbounded. Without repair tools, corruption is unrecoverable.

**Implementation:**
- Add `memory/pruner.py` — Delete oldest entries when over cap
- Add `memory/repair.py` — Integrity checks for file-based memory
- Add pruning trigger to memory write path
- Config: `memory_cap_mb` setting (default 1024)

```
Shipyard reference: src/memory/pruner.ts, src/memory/repair.ts, src/memory/migrate.ts
Jerry target: apps/backend/memory/
```

---

### 5. TWO-STAGE CODE REVIEW
**Priority: MEDIUM | Effort: MEDIUM**

Shipyard's reviewer agent does two passes:
1. **Spec compliance** — Does the code match the plan?
2. **Quality review** — Is the code clean, performant, secure?

Each stage can block the pipeline.

**Why Jerry needs this:** Jerry's QA loop currently does a single review pass. Splitting into spec-compliance + quality would catch more issues and produce better results.

**Implementation:**
- Split `qa/loop.py` reviewer into two stages
- Stage 1: Compare output against spec (cheaper, haiku-capable)
- Stage 2: Quality review of the actual code changes (sonnet)
- Each stage returns pass/fail with specific feedback

```
Shipyard reference: agents/reviewer.md
Jerry target: apps/backend/qa/loop.py
```

---

### 6. ADAPTIVE CONTEXT LOADING
**Priority: MEDIUM | Effort: LOW**

Shipyard loads different amounts of context based on task type:
- **Minimal** — Just current state (for quick tasks)
- **Planning** — State + roadmap + phase info
- **Execution** — State + current plan + recent history
- **Brownfield** — Full codebase analysis docs
- **Full** — Everything

**Why Jerry needs this:** Jerry always loads the same context regardless of whether the agent is doing a simple fix or complex architecture. Adaptive loading would reduce token usage and improve focus.

**Implementation:**
- Add context tier selection to task creation
- Complexity classifier output maps to context tier
- Simple tasks get minimal context, complex tasks get full

```
Shipyard reference: scripts/state-read.sh (adaptive loading logic)
Jerry target: apps/backend/spec/pipeline/orchestrator.py + context builder
```

---

### 7. LESSONS LEARNED / POST-TASK RETROSPECTIVE
**Priority: LOW | Effort: LOW**

After shipping each phase, Shipyard runs a "lessons learned" skill:
- What went well?
- What was harder than expected?
- What patterns should be repeated?
- What should be avoided?

Results stored in memory for future context.

**Why Jerry needs this:** After completing tasks, Jerry could record what worked and what didn't, building institutional knowledge that improves future task execution.

**Implementation:**
- After QA passes, prompt the agent for a brief retrospective
- Store in memory layer tagged as "lesson"
- Retrieve relevant lessons when starting similar tasks

```
Shipyard reference: skills/lessons-learned/SKILL.md
Jerry target: apps/backend/memory/ + qa/loop.py post-pass hook
```

---

## Features to SKIP (Not Applicable to Jerry)

| Shipyard Feature | Why Skip |
|-----------------|----------|
| **IaC Validation** (Terraform/Ansible/Docker) | Jerry is a general coding agent, not DevOps-focused |
| **Plugin marketplace system** | Jerry is standalone, not a Claude Code plugin |
| **.shipyard/ file-based state** | Jerry already has Zustand + IPC, much better |
| **BATS shell testing** | Jerry is TypeScript + Python, not bash |
| **MCP server architecture** | Jerry uses direct IPC, no need for MCP layer |
| **Markdown-as-configuration** | Jerry uses proper TypeScript config, more robust |
| **Skill auto-activation triggers** | Jerry's task routing is code-driven, more flexible |
| **Worktree management** | Over-engineered for Jerry's use case |
| **Native Claude Code task UI** | Jerry has full Electron GUI, far superior |

---

## Architecture Comparison

### Jerry's Strengths Over Shipyard
1. **Full GUI** — Electron app with real-time streaming, task cards, timeline, terminal views
2. **Real-time output** — Live streaming of agent output via IPC
3. **Visual task management** — Drag-and-drop, status badges, companion indicators
4. **Integrated terminal** — Full terminal output with syntax highlighting
5. **Companion agent** — Lightweight read-only helper between phases
6. **Adaptive complexity routing** — Auto-classifies tasks and routes appropriately

### Shipyard's Strengths Over Jerry
1. **Memory with vector search** — Semantic search across past conversations using local embeddings
2. **Secret scrubbing** — Never stores credentials in memory
3. **Quality gates** — TDD enforcement, 2-stage review, security audit
4. **Checkpoints** — Git-based rollback safety at every lifecycle point
5. **Model routing** — Right-size model for each agent role
6. **Storage management** — Pruning, repair, migration, backup
7. **Cross-session context** — Episodic memory survives restarts

---

## Implementation Roadmap

If you want to port features, here's a suggested order:

| Phase | Feature | Effort | Impact |
|-------|---------|--------|--------|
| **Phase 1** | Secret scrubbing | 2-3 hours | Prevents credential leaks in memory |
| **Phase 1** | Model routing config | 3-4 hours | Cost savings + latency reduction |
| **Phase 2** | Git checkpoints | 4-5 hours | Safety net for autonomous code changes |
| **Phase 2** | Memory pruning | 3-4 hours | Prevents unbounded storage growth |
| **Phase 3** | Two-stage review | 4-5 hours | Better QA output quality |
| **Phase 3** | Adaptive context loading | 2-3 hours | Token efficiency |
| **Phase 4** | Lessons learned | 2-3 hours | Continuous improvement |
| **Phase 4** | Memory repair tools | 3-4 hours | Resilience |

**Total estimated: ~25-30 hours across 4 phases**

---

## Summary

Shipyard is a well-engineered development lifecycle tool with excellent memory management and quality enforcement. However, it's fundamentally different from Jerry — it's a text-based CLI plugin, while Jerry is a full GUI application with real-time streaming.

The most valuable ports are **defensive features** that Jerry currently lacks:
1. **Secret scrubbing** — Don't store credentials
2. **Model routing** — Use the right model for the job
3. **Git checkpoints** — Safety net for autonomous changes
4. **Memory pruning** — Don't grow unbounded

Jerry is already ahead on UX, real-time interaction, and visual task management. The Shipyard comparison mostly validates Jerry's architecture while highlighting gaps in memory safety and cost optimization.

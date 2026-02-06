# Shipyard Feature Ports — TODO

**Source:** [SHIPYARD_COMPARISON.md](../SHIPYARD_COMPARISON.md)
**Created:** 2026-02-06
**Status:** Planning

---

## Phase 1 — HIGH Priority

### [ ] 1. Secret Scrubbing for Memory Storage
- **Effort:** ~2-3 hours
- **Target:** `apps/backend/memory/scrubber.py`
- **What:** 17 regex patterns to strip API keys, tokens, and credentials before any memory write
- **Patterns:** AWS keys, GitHub/OAuth tokens, Anthropic/OpenAI keys, DB URLs, private keys, JWTs, Azure strings, Stripe/Slack/NPM tokens
- **Why:** Jerry stores conversations and memory but doesn't redact credentials

### [ ] 2. Model Routing per Agent Role
- **Effort:** ~3-4 hours
- **Target:** `apps/frontend/src/main/agent/agent-manager.ts` + settings store
- **What:** Route different agent roles to different models (haiku for validation, sonnet for building, opus for architecture)
- **Map:** companion=haiku, spec-generation=sonnet, qa-review=sonnet, complexity-classifier=haiku
- **Why:** Jerry uses one model per agent — wastes money and latency on simple tasks

### [ ] 3. Git Checkpoint & Rollback System
- **Effort:** ~4-5 hours
- **Target:** `apps/backend/` (new checkpoint module) + TaskCard UI button
- **What:** Auto-create git tags before/after builds (`jerry-pre-build-{taskId}`, `jerry-post-build-{taskId}`). Add "Rollback" button to TaskCard UI.
- **Why:** No safety net when autonomous agents go off-rails

---

## Phase 2 — MEDIUM Priority

### [ ] 4. Memory Storage Pruning + Repair
- **Effort:** ~6-8 hours
- **Target:** `apps/backend/memory/pruner.py`, `apps/backend/memory/repair.py`
- **What:** Auto-prune oldest entries when over storage cap (default 1GB). 7-check repair pipeline for file-based memory integrity.
- **Config:** `memory_cap_mb` setting (default 1024)
- **Why:** Jerry's dual-layer memory grows unbounded with no recovery tools

### [ ] 5. Two-Stage Code Review
- **Effort:** ~4-5 hours
- **Target:** `apps/backend/qa/loop.py`
- **What:** Split QA reviewer into Stage 1 (spec compliance, haiku-capable) and Stage 2 (code quality, sonnet). Each stage can block the pipeline.
- **Why:** Single-pass review misses spec drift vs code quality issues

### [ ] 6. Adaptive Context Loading
- **Effort:** ~2-3 hours
- **Target:** `apps/backend/spec/pipeline/orchestrator.py` + context builder
- **What:** Load minimal/planning/execution/full context based on task complexity. Complexity classifier output maps to context tier.
- **Why:** Jerry always loads same context regardless of task simplicity

---

## Phase 3 — LOW Priority

### [ ] 7. Lessons Learned / Post-Task Retrospective
- **Effort:** ~2-3 hours
- **Target:** `apps/backend/memory/` + `qa/loop.py` post-pass hook
- **What:** After QA passes, prompt agent for brief retrospective (what worked, what didn't). Store tagged as "lesson" in memory. Retrieve relevant lessons for similar future tasks.
- **Why:** Continuous improvement through institutional knowledge

---

## Total Estimated: ~25-30 hours across 3 phases

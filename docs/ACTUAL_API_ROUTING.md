# Actual API Routing in Jerry

**Last Updated**: February 8, 2026

## Executive Summary

Jerry has **adaptive model routing** based on task complexity, but it's currently **overridden by frontend UI settings**. This document clarifies the actual behavior.

---

## Current State: Frontend UI Controls Everything

### When You Create a Task:

1. **UI selects profile** (e.g., "Auto (Optimized)")
2. **Profile settings written to** `task_metadata.json`:
   ```json
   {
     "phaseModels": {
       "spec": "opus",
       "planning": "opus",
       "coding": "opus",
       "qa": "opus"
     },
     "phaseThinking": {
       "spec": "ultrathink",
       "planning": "high",
       "coding": "low",
       "qa": "low"
     }
   }
   ```
3. **Backend reads metadata** and uses these values
4. **Complexity routing is bypassed** (lines 247-257 in `phase_config.py`)

### Result: Your Screenshot Settings ARE What Runs

If you select "Auto (Optimized)" profile:
- **Spec**: Opus + Ultra Think
- **Planning**: Opus + High
- **Coding**: Opus + Low
- **QA**: Opus + Low

This is consistent across ALL task complexities because the profile overrides everything.

---

## Hidden Feature: Complexity-Based Routing

### What It Would Do (If Enabled)

The backend has adaptive routing that **would** run if tasks don't have `phaseModels` in metadata:

| Complexity | Planning | Thinking | Coding | Thinking | QA | Thinking |
|------------|----------|----------|--------|----------|-----|----------|
| **SIMPLE** | Opus | Low (1024) | Haiku | None | Skip | - |
| **MEDIUM** | Opus | Medium (4096) | Sonnet | Low | Haiku | Low |
| **COMPLEX** | Opus | High (16384) | Sonnet | Medium | Sonnet | Medium |

**Key Insight**: Planning ALWAYS uses Opus regardless of complexity!

### Why It's Not Active

The frontend UI **always writes** `phaseModels` to task metadata, so complexity routing never activates. It's dead code in production.

---

## Spec Creation vs Task Execution

There are **TWO different complexity systems**:

### 1. Spec Complexity (spec/complexity.py)
- **Levels**: SIMPLE, STANDARD, COMPLEX
- **Purpose**: Determines which **spec creation phases** run
  - SIMPLE: 5 phases (discovery → quick_spec → planning → validation)
  - STANDARD: 8 phases (+ requirements, context, spec_writing)
  - COMPLEX: 9 phases (+ research, self_critique)
- **Model**: Always uses the profile's "spec" model setting (currently Opus)

### 2. Task Execution Complexity (agents/complexity_classifier.py)
- **Levels**: SIMPLE, MEDIUM, COMPLEX
- **Purpose**: **Would** determine which model for planning/coding/QA
- **Status**: Currently **bypassed** by frontend profile settings

---

## Execution Priority

When backend determines which model to use:

```python
# Priority order (phase_config.py lines 236-264):
1. CLI argument (--model flag)
2. Profile's phase-specific config (phaseModels from metadata) ← YOU ARE HERE
3. Complexity-based routing (COMPLEXITY_PHASE_CONFIG)  ← NEVER REACHED
4. Single model from metadata
5. Default phase config (BALANCED_PHASE_MODELS)
```

**Reality**: Step 2 always wins because the frontend always sets `phaseModels`.

---

## Your Current Production Config

### From Screenshot (Active Settings)

**Profile**: Auto (Optimized)

**Phase Configuration**:
| Phase | Model | Thinking Level | Tokens | When Used |
|-------|-------|----------------|--------|-----------|
| Spec Creation | Opus 4.6 | Ultra Think | 63,999 | Every task |
| Planning | Opus 4.6 | High | 16,384 | Every task |
| Coding | Opus 4.6 | Low | 1,024 | Every task |
| QA Review | Opus 4.6 | Low | 1,024 | Every task |

**Feature Configuration**:
- Jerry Chat (Insights): Sonnet + Medium
- Ideation: Opus + High
- Roadmap: Opus + High
- GitHub Issues: Opus + Medium
- GitHub PR Review: Opus + Medium
- Utility: Haiku + Low

### Cost Impact

**Per Task** (assuming COMPLEX):
- Spec: ~$20-30 (Ultra Think + Opus)
- Planning: ~$8-12 (High Think + Opus)
- Coding: ~$15-25 (Opus, 3 coding sessions avg)
- QA: ~$3-5 (Opus, 2 QA reviews avg)
- **Total**: ~$46-72 per task

**All tasks use Opus** regardless of actual complexity.

---

## The Disconnect

### What the Code Says (Unused)
```python
# phase_config.py - COMPLEXITY_PHASE_CONFIG
SIMPLE tasks:  Opus+Low → Haiku+None → Skip
MEDIUM tasks:  Opus+Med → Sonnet+Low → Haiku+Low
COMPLEX tasks: Opus+High → Sonnet+Med → Sonnet+Med
```

### What Actually Happens (Used)
```typescript
// Frontend "Auto (Optimized)" profile
ALL tasks: Opus+Ultra → Opus+High → Opus+Low → Opus+Low
```

### Why
Frontend always writes `phaseModels` to task metadata → backend uses those → complexity routing never runs.

---

## Recommendations

### Option 1: Remove Profile Override (Enable Adaptive Routing)

**Change**: Don't write `phaseModels` to metadata unless user explicitly customizes

**Result**:
- SIMPLE tasks: Opus planning + Haiku coding + Skip QA = ~$5-8/task (85% cheaper)
- MEDIUM tasks: Opus planning + Sonnet coding + Haiku QA = ~$20-30/task (50% cheaper)
- COMPLEX tasks: Opus planning + Sonnet coding + Sonnet QA = ~$35-45/task (30% cheaper)

**Savings**: ~$400-600/month (assuming 20 tasks, 40% are SIMPLE/MEDIUM)

---

### Option 2: Add "Adaptive" Profile (Hybrid)

Keep current profiles but add new one:

```typescript
{
  id: 'adaptive',
  name: 'Adaptive (Cost-Optimized)',
  description: 'Automatically adjusts model based on task complexity',
  // Don't set phaseModels/phaseThinking - let backend decide
}
```

When user selects "Adaptive", don't write `phaseModels` to metadata → backend uses complexity routing.

---

### Option 3: Document Current Behavior (No Code Changes)

Just clarify that:
1. "Auto (Optimized)" = All Opus (current default)
2. Complexity routing exists but is bypassed
3. Cost optimization requires manual profile selection (Balanced/Quick)

---

### Option 4: Sync Frontend Profiles with Backend Routing

Make frontend profiles match backend complexity config:

```typescript
// Update AUTO_PHASE_MODELS to match COMPLEXITY_PHASE_CONFIG[COMPLEX]
export const AUTO_PHASE_MODELS = {
  spec: 'opus',      // Keep for spec creation
  planning: 'opus',  // Keep (always Opus per backend)
  coding: 'sonnet',  // Change from opus → matches COMPLEX routing
  qa: 'sonnet'       // Change from opus → matches COMPLEX routing
};

export const AUTO_PHASE_THINKING = {
  spec: 'ultrathink',  // Keep
  planning: 'high',    // Keep → matches COMPLEX
  coding: 'medium',    // Change from low → matches COMPLEX
  qa: 'medium'         // Change from low → matches COMPLEX
};
```

**Effect**: Frontend "Auto" profile would match what backend complexity routing does for COMPLEX tasks.

---

## What Should We Do?

**Your settings from the screenshot** show:
- Spec: Opus + Ultra Think
- Planning: Opus + High
- Coding: Opus + Low
- QA: Opus + Low

**Question for you**:
1. Do you want ALL tasks to use Opus (current), or adapt by complexity?
2. If adaptive: Should SIMPLE tasks skip QA and use Haiku for speed?
3. Should we expose "Adaptive" as a profile option in the UI?

Let me know your preference and I'll update:
- Backend defaults (`phase_config.py`)
- Frontend profiles (`models.ts`)
- Documentation
- Add/remove profile options in UI

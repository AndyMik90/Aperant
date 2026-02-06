# Phase 11: Build Optimization - Ralph Prompt

**Version:** 1.0
**Date:** 2026-02-04
**Tasks:** 4
**Max Iterations:** 50

---

## Quick Start

Copy and paste this into Ralph:

```bash
/ralph-loop:ralph-loop "
You are completing Phase 11: Build Optimization for Auto-Claude.

YOUR IDENTITY:
- You are an EXECUTOR, not an EVALUATOR.
- Execute each task completely before moving to the next.
- This is a 4-TASK JOB. Do NOT stop until all tasks are complete.

Repository:
- Project root: C:\Users\AlienZ\Desktop\Auto-Claude
- Frontend: apps/frontend/

Primary documentation:
- docs/plans/PHASE_11_BUILD_OPTIMIZATION.md (THIS IS YOUR SPEC)
- docs/PROGRESS.md

---

PHASE 11: BUILD OPTIMIZATION (4 tasks)

| # | Task | File | Promise |
|---|------|------|---------|
| 1 | OPT-1: Fix Vite/Chokidar warning | vite configs | OPT_1_WARNING_FIXED |
| 2 | OPT-2: Analyze bundle size | Build analysis | OPT_2_ANALYSIS_COMPLETE |
| 3 | OPT-3: Code splitting for heavy pages | Router/pages | OPT_3_SPLITTING_COMPLETE |
| 4 | OPT-4: Tree shaking audit | Imports | OPT_4_TREESHAKE_COMPLETE |

FINAL: <promise>PHASE_11_BUILD_OPTIMIZATION_COMPLETE</promise>

---

EXECUTION PROTOCOL

1. Read docs/plans/PHASE_11_BUILD_OPTIMIZATION.md FULLY first.

2. OPT-1: Fix Chokidar Warning
   - Add rollup onwarn config to suppress chokidar Stats warning
   - Location: apps/frontend/electron.vite.config.ts
   - Verify: npm run build shows no warning

3. OPT-2: Bundle Analysis
   - Install rollup-plugin-visualizer if needed
   - Generate bundle analysis
   - Document findings in docs/BUNDLE_ANALYSIS.md

4. OPT-3: Code Splitting
   - Add React.lazy() for Settings, Discovery, Analytics pages
   - Add Suspense wrappers with fallback
   - Verify lazy loading works

5. OPT-4: Tree Shaking
   - Check barrel file imports
   - Convert to direct imports where beneficial
   - Remove unused exports

6. VERIFICATION:
   - npm run build (must pass, no warnings)
   - npm test (must pass)
   - Check bundle sizes reduced

7. FINAL:
   When ALL 4 promises emitted AND builds pass:
   <promise>PHASE_11_BUILD_OPTIMIZATION_COMPLETE</promise>

---

CRITICAL CONSTRAINTS

1. 4-TASK JOB - Do NOT stop until all 4 tasks are complete.
2. ALL REQUIRED - Every task must be executed.
3. CONTINUATION - After each task, say: NEXT: Task N

---

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 50 --completion-promise "PHASE_11_BUILD_OPTIMIZATION_COMPLETE"
```

---

## Task Checklist

- [ ] OPT-1: Fix Vite warning → `<promise>OPT_1_WARNING_FIXED</promise>`
- [ ] OPT-2: Bundle analysis → `<promise>OPT_2_ANALYSIS_COMPLETE</promise>`
- [ ] OPT-3: Code splitting → `<promise>OPT_3_SPLITTING_COMPLETE</promise>`
- [ ] OPT-4: Tree shaking → `<promise>OPT_4_TREESHAKE_COMPLETE</promise>`
- [ ] Final → `<promise>PHASE_11_BUILD_OPTIMIZATION_COMPLETE</promise>`

---

**Phase 11: Build Optimization - 4 tasks | Low risk**

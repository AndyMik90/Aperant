# Phase 11: Build Optimization

**Version:** 1.0
**Date:** 2026-02-04
**Tasks:** 4
**Risk:** Low
**Focus:** Build warnings and bundle size

---

## Overview

Address deferred build and bundle issues from Phase 9 code sweep.

---

## Tasks

### OPT-1: Fix Vite/Chokidar Warning (SWEEP-14)

**Issue:** Vite build shows warning about unused import from chokidar
```
"Stats" is imported from external module "node:fs" but never used in "chokidar/index.js"
```

**Location:** Build output, chokidar dependency

**Solution Options:**
1. Update chokidar to latest version (if fix available)
2. Add Vite config to suppress the specific warning
3. Replace chokidar with alternative file watcher

**Implementation:**
```typescript
// vite.config.ts - Option 2: Suppress warning
export default defineConfig({
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress chokidar Stats warning
        if (warning.code === 'UNUSED_EXTERNAL_IMPORT' &&
            warning.source?.includes('chokidar')) {
          return;
        }
        warn(warning);
      }
    }
  }
});
```

**Acceptance:**
- [ ] Build runs without chokidar warning
- [ ] No functionality regression

---

### OPT-2: Analyze Bundle Size (SWEEP-15)

**Issue:** Large bundle sizes
- Main process: 3,006 KB (3MB)
- Renderer: 5,467 KB (5.4MB)

**Location:** Build output

**Analysis Tasks:**
1. Run bundle analyzer to identify largest dependencies
2. Document what's contributing to size
3. Identify candidates for lazy loading or code splitting

**Implementation:**
```bash
# Add bundle analyzer
npm install -D rollup-plugin-visualizer

# Generate report
npm run build -- --analyze
```

**Deliverable:** Bundle analysis report with recommendations

---

### OPT-3: Implement Code Splitting

**Issue:** Single large renderer bundle

**Solution:** Split by route/feature
- Lazy load Settings page
- Lazy load Discovery page
- Lazy load Analytics dashboard

**Implementation:**
```typescript
// Lazy load heavy pages
const Settings = lazy(() => import('./pages/Settings'));
const Discovery = lazy(() => import('./pages/Discovery'));
const Analytics = lazy(() => import('./components/AnalyticsDashboard'));

// In router
<Suspense fallback={<PageSkeleton />}>
  <Route path="/settings" element={<Settings />} />
</Suspense>
```

**Acceptance:**
- [ ] Initial bundle < 3MB
- [ ] Pages load on demand
- [ ] No visible loading delay for common paths

---

### OPT-4: Tree Shaking Audit

**Issue:** Potential unused code in bundle

**Tasks:**
1. Check for barrel file issues (index.ts re-exports)
2. Verify tree shaking works for UI component library
3. Remove any dead code paths

**Implementation:**
```typescript
// Bad: imports entire library
import { Button } from './components';

// Good: direct imports
import { Button } from './components/ui/button';
```

**Acceptance:**
- [ ] No unused exports in bundle
- [ ] Direct imports where beneficial

---

## Verification

```bash
# Build must pass
npm run build

# Check bundle sizes
ls -la apps/frontend/out/

# Run tests
npm test
```

---

## Success Criteria

- [ ] No build warnings
- [ ] Bundle analysis documented
- [ ] Code splitting implemented for heavy pages
- [ ] Bundle size reduced by at least 20%

---

## Completion Promise

```
<promise>PHASE_11_BUILD_OPTIMIZATION_COMPLETE</promise>
```

---

**Phase 11: Build Optimization - 4 tasks | Low risk**

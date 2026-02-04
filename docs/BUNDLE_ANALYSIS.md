# Bundle Analysis Report

Generated: 2026-02-04

## Build Output Summary

### Before Optimization
| Bundle | Size | Description |
|--------|------|-------------|
| Main (Electron) | 3,011.76 KB | Main process code |
| Preload | 75.95 KB | Preload scripts |
| Renderer JS | 5,533.06 KB | Frontend React app (single bundle) |
| Renderer CSS | 177.95 KB | Stylesheets |

### After Optimization (Code Splitting)
| Bundle | Size | Description |
|--------|------|-------------|
| Main (Electron) | 3,011.76 KB | Main process code |
| Preload | 75.95 KB | Preload scripts |
| **Renderer JS (initial)** | **4,409.39 KB** | Core app bundle |
| Renderer CSS | 177.95 KB | Stylesheets |

**Initial bundle reduction: 1,124 KB (20% smaller)**

### Lazy-Loaded Chunks
| Chunk | Size | Component |
|-------|------|-----------|
| AppSettings | 380.01 KB | Settings dialog |
| DiscoveryHub | 232.35 KB | Discovery hub |
| OnboardingWizard | 162.75 KB | Onboarding flow |
| Changelog | 97.49 KB | Changelog view |
| Context | 77.37 KB | Context panel |
| OllamaModelSelector | 53.24 KB | Ollama settings |
| Insights | 50.76 KB | Insights view |
| Worktrees | 41.86 KB | Worktrees view |
| GitLabIssues | 39.79 KB | GitLab issues |
| radio-group | 10.61 KB | Shared component |
| RepositoryHub | 2.01 KB | Repository hub |

## Major Dependencies by Category

### UI Framework & Components
- `react` + `react-dom` (~150 KB gzipped)
- `@radix-ui/*` - 15+ primitives (~200 KB total)
- `lucide-react` - Icon library (~50 KB)
- `motion` (Framer Motion) - Animations (~100 KB)
- `@dnd-kit/*` - Drag and drop (~60 KB)

### Terminal
- `@xterm/xterm` + addons (~300 KB)
  - `@xterm/addon-fit`
  - `@xterm/addon-serialize`
  - `@xterm/addon-web-links`
  - `@xterm/addon-webgl`

### Rich Text & Markdown
- `react-markdown` (~80 KB)
- `remark-gfm` (~40 KB)
- `highlight.js` - Code highlighting (~400 KB+ with all languages)

### State Management
- `zustand` (~10 KB) - Lightweight

### Internationalization
- `i18next` + `react-i18next` (~50 KB)

### AI/SDK (Main Process)
- `@anthropic-ai/sdk` (~100 KB)
- `@sentry/electron` + deps (~150 KB)

### Electron-Specific
- `electron-log` (~20 KB)
- `electron-updater` (~50 KB)
- `chokidar` (~30 KB)

### Utilities
- `zod` - Validation (~60 KB)
- `uuid` (~5 KB)
- `semver` (~20 KB)
- `tailwind-merge` + `clsx` (~15 KB)

## Optimizations Implemented

### 1. Code Splitting (OPT-3) ✅ COMPLETED

Implemented React.lazy() for infrequently used views:

```typescript
// Lazy-loaded components
const DiscoveryHub = lazy(() => import('./components/DiscoveryHub').then(m => ({ default: m.DiscoveryHub })));
const Context = lazy(() => import('./components/Context').then(m => ({ default: m.Context })));
const RepositoryHub = lazy(() => import('./components/RepositoryHub').then(m => ({ default: m.RepositoryHub })));
const Insights = lazy(() => import('./components/Insights').then(m => ({ default: m.Insights })));
const GitLabIssues = lazy(() => import('./components/GitLabIssues').then(m => ({ default: m.GitLabIssues })));
const GitLabMergeRequests = lazy(() => import('./components/gitlab-merge-requests').then(m => ({ default: m.GitLabMergeRequests })));
const Changelog = lazy(() => import('./components/Changelog').then(m => ({ default: m.Changelog })));
const Worktrees = lazy(() => import('./components/Worktrees').then(m => ({ default: m.Worktrees })));
const OnboardingWizard = lazy(() => import('./components/onboarding').then(m => ({ default: m.OnboardingWizard })));
const AppSettingsDialog = lazy(() => import('./components/settings/AppSettings').then(m => ({ default: m.AppSettingsDialog })));
```

### 2. Tree Shaking Audit (OPT-4) ✅ VERIFIED

**Status: Tree shaking is working correctly**

Audit findings:
- ✅ `lucide-react` - Using direct named imports (tree-shakeable)
- ✅ `@radix-ui/*` - Using specific package imports (tree-shakeable)
- ✅ No problematic barrel imports from `./components` or `./stores`
- ✅ Store imports use direct file paths
- ✅ Barrel files exist but are not used for cross-module imports

No changes needed - imports already follow tree-shaking best practices.

## Future Optimization Opportunities

### 1. highlight.js Optimization (Medium Impact)

Currently bundling all languages. Consider:
- Import only needed languages
- Lazy-load language definitions on demand
- Estimated savings: ~200-300 KB

```typescript
// Before (all languages)
import hljs from 'highlight.js';

// After (selective imports)
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
// ... register only needed languages
```

### 2. Motion/Framer Motion (Medium Impact)

Consider:
- Use `LazyMotion` with feature bundles
- Only load needed features

```typescript
import { LazyMotion, domAnimation } from 'motion';

function App() {
  return (
    <LazyMotion features={domAnimation} strict>
      {/* components */}
    </LazyMotion>
  );
}
```

## Monitoring

Bundle analysis is now automatically generated on every build:
- Location: `apps/frontend/out/renderer/stats.html`
- Open in browser to visualize module sizes interactively
- Plugin: `rollup-plugin-visualizer`

## Notes

- Main process (3 MB) is acceptable for Electron
- Preload (76 KB) is well-optimized
- Renderer initial bundle reduced from 5.5 MB to 4.4 MB (20% smaller)
- CSS (178 KB) is reasonable for a full app
- Vite/Chokidar warning suppressed (OPT-1)

## Related Files

- `apps/frontend/electron.vite.config.ts` - Build configuration
- `apps/frontend/package.json` - Dependencies
- `apps/frontend/src/renderer/App.tsx` - Code splitting implementation

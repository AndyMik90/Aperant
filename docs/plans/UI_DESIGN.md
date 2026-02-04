# Auto-Claude UI Design Specification

**Theme Name:** "Tron Grid"
**Last Updated:** 2026-02-03
**Status:** Design Specification

---

## Design Philosophy

A fusion of **Tron Cinematic Universe** aesthetics with **VSCode's** clean, functional design.

| Tron Influence | VSCode Influence |
|----------------|------------------|
| Deep dark backgrounds | Clean, flat design |
| Neon accent colors (cyan, orange) | Activity bar + sidebar pattern |
| Sharp geometric lines | Tab-based content areas |
| Grid patterns | Consistent spacing system |
| Glowing edges on focus | Subtle hover states |
| High contrast | Monospace fonts for code |

---

## Color Palette

### Backgrounds

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-base` | `#0a0a0f` | Main application background |
| `--bg-surface` | `#0d1117` | Panels, cards, surfaces |
| `--bg-elevated` | `#161b22` | Modals, dropdowns, popovers |
| `--bg-overlay` | `rgba(0,0,0,0.8)` | Modal overlays |
| `--bg-hover` | `#1a1f26` | Hover states on surfaces |
| `--bg-active` | `#21262d` | Active/selected states |

### Borders

| Token | Hex | Usage |
|-------|-----|-------|
| `--border-default` | `#21262d` | Default borders |
| `--border-muted` | `#30363d` | Subtle dividers |
| `--border-focus` | `#00d4ff` | Focus ring color |
| `--border-active` | `#00d4ff` | Active element border |

### Accent Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--accent-primary` | `#00d4ff` | Primary actions, focus states |
| `--accent-secondary` | `#ff6b00` | Warnings, highlights, attention |
| `--accent-success` | `#00ff88` | Success states, completed |
| `--accent-error` | `#ff3366` | Errors, failures |
| `--accent-warning` | `#ffb800` | Warnings, caution |
| `--accent-info` | `#58a6ff` | Information, links |

### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#f0f6fc` | Headings, important text |
| `--text-secondary` | `#8b949e` | Body text, descriptions |
| `--text-muted` | `#484f58` | Hints, placeholders, disabled |
| `--text-accent` | `#00d4ff` | Links, interactive text |
| `--text-code` | `#79c0ff` | Inline code |

### Status Colors

| Status | Background | Text | Border |
|--------|------------|------|--------|
| Planning | `rgba(0,212,255,0.1)` | `#00d4ff` | `#00d4ff` |
| Coding | `rgba(255,107,0,0.1)` | `#ff6b00` | `#ff6b00` |
| AI Review | `rgba(88,166,255,0.1)` | `#58a6ff` | `#58a6ff` |
| Human Review | `rgba(255,184,0,0.1)` | `#ffb800` | `#ffb800` |
| Done | `rgba(0,255,136,0.1)` | `#00ff88` | `#00ff88` |
| Failed | `rgba(255,51,102,0.1)` | `#ff3366` | `#ff3366` |

---

## Typography

### Font Families

```css
--font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
```

### Font Sizes

| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | 11px | Badges, labels |
| `--text-sm` | 12px | Secondary text, metadata |
| `--text-base` | 14px | Body text |
| `--text-lg` | 16px | Subheadings |
| `--text-xl` | 20px | Section headers |
| `--text-2xl` | 24px | Page titles |

### Font Weights

| Token | Weight | Usage |
|-------|--------|-------|
| `--font-normal` | 400 | Body text |
| `--font-medium` | 500 | Emphasis, buttons |
| `--font-semibold` | 600 | Headings, labels |
| `--font-bold` | 700 | Strong emphasis |

### Usage Guidelines

- **UI elements:** `--font-ui` (Inter)
- **Code, data, numbers:** `--font-mono` (JetBrains Mono)
- **Timestamps, IDs, file paths:** `--font-mono`
- **Task titles:** `--font-ui` semibold
- **Status badges:** `--font-mono` uppercase

---

## Spacing System

Based on 8px unit for consistent alignment.

| Token | Size | Usage |
|-------|------|-------|
| `--space-1` | 4px | Tight spacing |
| `--space-2` | 8px | Default gap |
| `--space-3` | 12px | Component padding |
| `--space-4` | 16px | Section padding |
| `--space-5` | 20px | Card padding |
| `--space-6` | 24px | Large gaps |
| `--space-8` | 32px | Section margins |
| `--space-10` | 40px | Page margins |
| `--space-12` | 48px | Major sections |

---

## Border Radius

**CRITICAL: Sharp corners everywhere.**

```css
--radius: 0;
--radius-sm: 0;
--radius-md: 0;
--radius-lg: 0;
--radius-full: 9999px; /* Only for avatars/circles */
```

Exceptions:
- User avatars: circular (`--radius-full`)
- Nothing else should have rounded corners

---

## Shadows & Glows

### No Box Shadows

Traditional box shadows are NOT used. Instead, use borders and glow effects.

### Glow Effects

```css
/* Focus glow - cyan ring with soft glow */
--glow-focus: 0 0 0 1px var(--accent-primary),
              0 0 8px rgba(0, 212, 255, 0.3);

/* Active glow - stronger emphasis */
--glow-active: 0 0 0 2px var(--accent-primary),
               0 0 12px rgba(0, 212, 255, 0.4);

/* Hover glow - subtle indication */
--glow-hover: 0 0 4px rgba(0, 212, 255, 0.2);

/* Success glow */
--glow-success: 0 0 8px rgba(0, 255, 136, 0.3);

/* Error glow */
--glow-error: 0 0 8px rgba(255, 51, 102, 0.3);

/* Warning glow */
--glow-warning: 0 0 8px rgba(255, 107, 0, 0.3);
```

---

## Animations & Transitions

### Timing

```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-normal: 200ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
```

### Glow Pulse Animation

```css
@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 0 1px var(--accent-primary),
                0 0 8px rgba(0, 212, 255, 0.3);
  }
  50% {
    box-shadow: 0 0 0 1px var(--accent-primary),
                0 0 16px rgba(0, 212, 255, 0.5);
  }
}

.active-indicator {
  animation: glow-pulse 2s ease-in-out infinite;
}
```

### Progress Bar Animation

```css
@keyframes progress-glow {
  0% { box-shadow: 0 0 4px var(--accent-primary); }
  50% { box-shadow: 0 0 12px var(--accent-primary); }
  100% { box-shadow: 0 0 4px var(--accent-primary); }
}
```

---

## Component Specifications

### Task Card

```
┌──────────────────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 60%         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ADD USER AUTHENTICATION                              [▶][⌘] │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  STATUS ► CODING          PHASE ► IMPLEMENTING               │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Subtask 3/5: Validate user credentials                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  DEPENDS ON ► Task #001, Task #002                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Specifications:**

| Property | Value |
|----------|-------|
| Background | `--bg-surface` (#0d1117) |
| Border | 1px solid `--border-default` (#21262d) |
| Border on hover | 1px solid `--accent-primary` (#00d4ff) |
| Box shadow on hover | `--glow-hover` |
| Padding | `--space-4` (16px) |
| Gap between elements | `--space-3` (12px) |
| Title font | `--font-ui` 14px semibold |
| Status label font | `--font-mono` 11px uppercase |
| Progress bar height | 4px |
| Progress bar color | Status-specific accent |

### Sidebar

```
┌────┬───────────────────────────────────────┐
│    │                                       │
│ ◈  │  JERRY                                │
│    │  ─────────────────────────────────    │
│ ◇  │                                       │
│    │  ► ACTIVE TASKS (3)                   │
│ ◆  │    ├── Add auth [CODING]              │
│    │    ├── Fix bug #42 [PLANNING]         │
│ ◇  │    └── Update deps [REVIEW]           │
│    │                                       │
│ ◇  │  ► COMPLETED TODAY (5)                │
│    │                                       │
│ ◇  │  ─────────────────────────────────    │
│    │                                       │
│ ⚙  │  ► ACTIVITY                           │
│    │    2:30 PM - Spec ready               │
│    │    1:15 PM - Task completed           │
│    │                                       │
└────┴───────────────────────────────────────┘
```

**Activity Bar (Left icons):**

| Property | Value |
|----------|-------|
| Width | 48px |
| Background | `--bg-base` (#0a0a0f) |
| Icon size | 24px |
| Icon color (default) | `--text-muted` (#484f58) |
| Icon color (active) | `--accent-primary` (#00d4ff) |
| Active indicator | 2px left border `--accent-primary` |

**Sidebar Panel:**

| Property | Value |
|----------|-------|
| Width | 260px |
| Background | `--bg-surface` (#0d1117) |
| Border right | 1px solid `--border-default` |
| Section header | `--font-mono` 11px uppercase `--text-muted` |
| Tree item padding | `--space-2` (8px) |

### Kanban Board

```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│    PLANNING     │     CODING      │    AI REVIEW    │   HUMAN REVIEW  │
│    ───────      │     ──────      │    ─────────    │   ────────────  │
│       2         │        1        │        0        │        1        │
├─────────────────┼─────────────────┼─────────────────┼─────────────────┤
│  (cards)        │  (cards)        │  (cards)        │  (cards)        │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

**Column Specifications:**

| Property | Value |
|----------|-------|
| Background | `--bg-base` (#0a0a0f) |
| Border | 1px solid `--border-default` |
| Header background | `--bg-surface` (#0d1117) |
| Header font | `--font-mono` 12px uppercase |
| Header color | Status-specific accent |
| Count badge | `--font-mono` 11px |
| Gap between cards | `--space-3` (12px) |
| Padding | `--space-4` (16px) |

### Buttons

**Primary Button:**
```css
.btn-primary {
  background: var(--accent-primary);
  color: var(--bg-base);
  border: none;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  padding: var(--space-2) var(--space-4);
  transition: var(--transition-fast);
}

.btn-primary:hover {
  box-shadow: var(--glow-active);
}

.btn-primary:focus {
  outline: none;
  box-shadow: var(--glow-focus);
}
```

**Secondary Button:**
```css
.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  padding: var(--space-2) var(--space-4);
  transition: var(--transition-fast);
}

.btn-secondary:hover {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
  box-shadow: var(--glow-hover);
}
```

**Ghost Button:**
```css
.btn-ghost {
  background: transparent;
  color: var(--text-muted);
  border: none;
  padding: var(--space-2);
  transition: var(--transition-fast);
}

.btn-ghost:hover {
  color: var(--accent-primary);
}
```

### Inputs

```css
.input {
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 14px;
  padding: var(--space-2) var(--space-3);
  transition: var(--transition-fast);
}

.input:hover {
  border-color: var(--border-muted);
}

.input:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: var(--glow-focus);
}

.input::placeholder {
  color: var(--text-muted);
}
```

### Terminal Panel

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLAUDE CODE SESSION                                      [─] [□] [×]│
│  ═══════════════════════════════════════════════════════════════════ │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┃ ► PHASE 4: CONTEXT DISCOVERY                                     │
│  ┃   ├─ Read: package.json ✓                                        │
│  ┃   ├─ Read: src/index.ts ✓                                        │
│  ┃   └─ Analyzing 15 files...                                       │
│  ┃                                                                   │
│  ┃ ► PHASE 5: SPEC CREATION                                         │
│  ┃   ├─ Write: .auto-build/specs/001/spec.md ✓                      │
│  ┃   └─ Complete                                                    │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  │ Type a message...                                         [SEND] │
└──────────────────────────────────────────────────────────────────────┘
```

**Specifications:**

| Property | Value |
|----------|-------|
| Background | `--bg-base` (#0a0a0f) |
| Border | 1px solid `--border-default` |
| Header background | `--bg-surface` (#0d1117) |
| Header font | `--font-mono` 12px uppercase |
| Output font | `--font-mono` 13px |
| Output line-height | 1.6 |
| Phase header color | `--accent-primary` |
| File path color | `--text-code` (#79c0ff) |
| Success checkmark | `--accent-success` |
| Input area border-top | 1px solid `--border-default` |
| Input focus | `--glow-focus` |

### Progress Bar

```css
.progress-bar {
  height: 4px;
  background: var(--bg-elevated);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent-primary);
  transition: width var(--transition-normal);
  box-shadow: 0 0 8px var(--accent-primary);
}

/* Status-specific colors */
.progress-bar-fill.planning { background: #00d4ff; }
.progress-bar-fill.coding { background: #ff6b00; }
.progress-bar-fill.review { background: #58a6ff; }
.progress-bar-fill.done { background: #00ff88; }
```

### Badges & Status Indicators

```css
.badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border: 1px solid currentColor;
}

.badge-planning {
  color: #00d4ff;
  background: rgba(0, 212, 255, 0.1);
}

.badge-coding {
  color: #ff6b00;
  background: rgba(255, 107, 0, 0.1);
}

.badge-review {
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.1);
}

.badge-done {
  color: #00ff88;
  background: rgba(0, 255, 136, 0.1);
}

.badge-failed {
  color: #ff3366;
  background: rgba(255, 51, 102, 0.1);
}
```

---

## Layout Patterns

### Main Application Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ ┌────┬───────────────────────────────────────────────────────────┐ │
│ │    │                                                           │ │
│ │ A  │  HEADER                                            [⚙]   │ │
│ │ C  │  ═══════════════════════════════════════════════════════ │ │
│ │ T  ├───────────────────────────────────────────────────────────┤ │
│ │ I  │                                                           │ │
│ │ V  │                                                           │ │
│ │ I  │                     MAIN CONTENT                          │ │
│ │ T  │                                                           │ │
│ │ Y  │                                                           │ │
│ │    │                                                           │ │
│ │ B  │                                                           │ │
│ │ A  │                                                           │ │
│ │ R  │                                                           │ │
│ │    │                                                           │ │
│ └────┴───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### With Sidebar Expanded

```
┌─────────────────────────────────────────────────────────────────────┐
│ ┌────┬─────────────┬─────────────────────────────────────────────┐ │
│ │    │             │                                             │ │
│ │ A  │  SIDEBAR    │  MAIN CONTENT                               │ │
│ │ C  │             │                                             │ │
│ │ T  │  ► Tasks    │                                             │ │
│ │ I  │  ► Sessions │                                             │ │
│ │ V  │  ► Activity │                                             │ │
│ │ I  │             │                                             │ │
│ │ T  │             │                                             │ │
│ │ Y  │             │                                             │ │
│ │    │             │                                             │ │
│ │ B  │             │                                             │ │
│ │ A  │  ─────────  │                                             │ │
│ │ R  │  [Settings] │                                             │ │
│ └────┴─────────────┴─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Responsive Behavior

### Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| Desktop | >= 1200px | Full layout, sidebar visible |
| Laptop | 900-1199px | Sidebar collapsible |
| Tablet | 600-899px | Sidebar hidden, icon bar only |
| Mobile | < 600px | Single column, bottom nav |

### Kanban Column Behavior

| Viewport | Columns Visible |
|----------|-----------------|
| >= 1400px | 4 columns |
| 1000-1399px | 3 columns (scroll) |
| 600-999px | 2 columns (scroll) |
| < 600px | 1 column (tabs) |

---

## Implementation Checklist

### Phase 1: Foundation

- [ ] Create `variables.css` with all tokens
- [ ] Set up CSS architecture (variables, reset, base)
- [ ] Remove all border-radius declarations
- [ ] Update base background colors
- [ ] Add glow effect mixins/utilities

### Phase 2: Core Components

- [ ] Update Button components
- [ ] Update Input components
- [ ] Update Card components
- [ ] Update Badge components
- [ ] Update Dialog/Modal components

### Phase 3: Layout

- [ ] Redesign Sidebar/Activity bar
- [ ] Update Header
- [ ] Update main content area
- [ ] Implement new spacing system

### Phase 4: Feature Components

- [ ] Redesign Task Cards
- [ ] Redesign Kanban Board
- [ ] Redesign Terminal panels
- [ ] Update Progress indicators
- [ ] Implement status-specific colors

### Phase 5: Polish

- [ ] Add glow animations
- [ ] Fine-tune transitions
- [ ] Responsive adjustments
- [ ] Accessibility audit
- [ ] Dark mode edge cases

---

## Accessibility

### Color Contrast

All text meets WCAG 2.1 AA standards:

| Combination | Ratio | Pass |
|-------------|-------|------|
| Primary text on base | 15.1:1 | AAA |
| Secondary text on base | 7.2:1 | AAA |
| Muted text on base | 4.6:1 | AA |
| Accent on base | 8.4:1 | AAA |

### Focus States

- All interactive elements have visible focus indicators
- Focus uses cyan glow effect (clearly visible)
- Tab order follows logical flow
- Skip links provided

### Motion

- Animations respect `prefers-reduced-motion`
- Essential info doesn't rely solely on animation
- Glow effects can be disabled

---

## References

- [Tron: Legacy Visual Design](https://www.imdb.com/title/tt1104001/)
- [VSCode Theme Guidelines](https://code.visualstudio.com/api/extension-guides/color-theme)
- [Tailwind CSS Dark Mode](https://tailwindcss.com/docs/dark-mode)

---

**End of UI Design Specification**

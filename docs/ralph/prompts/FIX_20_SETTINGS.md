# Ralph Prompt: FIX-20 + Settings Cleanup

**Created:** 2026-02-04
**Status:** Ready for execution
**Priority:** MEDIUM

---

## Task Summary

| # | Task | Description |
|---|------|-------------|
| 1 | FIX-20 | Terminal header always visible (even with 0 terminals) |
| 2 | SETTINGS-1 | Remove agentFramework dropdown (only 1 option) |
| 3 | SETTINGS-2 | Merge appearance + display sections |
| 4 | SETTINGS-3 | Move paths display to debug section |

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer fixing UI issues for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary documentation:
- docs\reports\SETTINGS_AUDIT_REPORT.md (settings analysis)

---

## TASKS (4 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | FIX-20: Terminal header always visible | FIX_20_TERMINAL_HEADER_COMPLETE |
| 2 | SETTINGS-1: Remove agentFramework dropdown | SETTINGS_1_AGENT_FRAMEWORK_COMPLETE |
| 3 | SETTINGS-2: Merge appearance + display sections | SETTINGS_2_MERGE_APPEARANCE_COMPLETE |
| 4 | SETTINGS-3: Move paths to debug section | SETTINGS_3_PATHS_TO_DEBUG_COMPLETE |

**FINAL:** <promise>FIX_20_SETTINGS_COMPLETE</promise>

---

## FIX-20: Terminal Header Always Visible

File: apps/frontend/src/renderer/components/TerminalGrid.tsx

Problem: When terminals.length === 0, the component returns an empty state (lines 354-375) WITHOUT the toolbar header. The toolbar header (lines 385-468) is only rendered when terminals exist.

Current behavior:
- 0 terminals: Shows centered empty state with 'New Terminal' button only
- 1+ terminals: Shows toolbar header with 'New Terminal', 'New Claude Code', 'Files' buttons

Target behavior:
- ALWAYS show the toolbar header (regardless of terminal count)
- When 0 terminals, show empty state content BELOW the header

Fix approach:
1. Extract the toolbar header to render BEFORE the if (terminals.length === 0) check
2. Wrap both the empty state and the terminal grid in a common container
3. The empty state should now be just the centered content, not a full return

Structure should be:
```tsx
return (
  <div className="flex h-full flex-col">
    {/* Toolbar - ALWAYS visible */}
    <div className="flex h-10 items-center...">
      {/* ... toolbar content ... */}
    </div>

    {/* Content area */}
    {terminals.length === 0 ? (
      {/* Empty state - centered */}
    ) : (
      {/* DndContext with terminal grid */}
    )}
  </div>
);
```

Then output: <promise>FIX_20_TERMINAL_HEADER_COMPLETE</promise>
Say: NEXT: SETTINGS-1 and begin SETTINGS-1

---

## SETTINGS-1: Remove agentFramework Dropdown

File: apps/frontend/src/renderer/components/settings/GeneralSettings.tsx

Problem: The agentFramework dropdown (lines 136-148) only has ONE option ('auto-claude'). This is a useless dropdown that confuses users.

Fix:
1. Remove the agentFramework dropdown entirely from the 'agent' section
2. Keep the agentFramework setting in the type/default for backwards compatibility
3. Just don't show it in the UI

Lines to remove (approximately 136-148):
```tsx
<div className="space-y-3">
  <Label htmlFor="agentFramework" ...>
  <p className="text-sm ...">
  <Select value={settings.agentFramework} ...>
    ...
  </Select>
</div>
```

Then output: <promise>SETTINGS_1_AGENT_FRAMEWORK_COMPLETE</promise>
Say: NEXT: SETTINGS-2 and begin SETTINGS-2

---

## SETTINGS-2: Merge Appearance + Display Sections

Files:
- apps/frontend/src/renderer/components/settings/AppSettings.tsx
- apps/frontend/src/renderer/components/settings/ThemeSettings.tsx
- apps/frontend/src/renderer/components/settings/DisplaySettings.tsx

Problem: 'appearance' and 'display' are separate sections with separate components. They should be merged since both are visual/appearance settings.

Fix approach:
1. In AppSettings.tsx:
   - Remove 'display' from appNavItemsConfig (keep only 'appearance')
   - Update renderAppSection to render combined content for 'appearance'

2. In ThemeSettings.tsx:
   - Add the UI Scale controls from DisplaySettings at the bottom
   - Import necessary constants (UI_SCALE_MIN, UI_SCALE_MAX, etc.)
   - Add new section divider before UI Scale

3. DisplaySettings.tsx can be kept for now (might be used elsewhere) or deprecated

The combined 'appearance' section should show:
- Theme mode (light/dark/system)
- Color theme (7 color options)
- UI Scale (slider + presets)

Then output: <promise>SETTINGS_2_MERGE_APPEARANCE_COMPLETE</promise>
Say: NEXT: SETTINGS-3 and begin SETTINGS-3

---

## SETTINGS-3: Move Paths Display to Debug Section

Files:
- apps/frontend/src/renderer/components/settings/AppSettings.tsx
- apps/frontend/src/renderer/components/settings/GeneralSettings.tsx
- apps/frontend/src/renderer/components/settings/DebugSettings.tsx

Problem: The 'paths' section only shows auto-detected CLI tool information (read-only). It's not configurable, so it belongs in 'debug' not as a top-level section.

Fix approach:
1. In AppSettings.tsx:
   - Remove 'paths' from appNavItemsConfig
   - Remove the 'paths' case from renderAppSection

2. In DebugSettings.tsx:
   - Add a new section 'CLI Tools' that shows the auto-detected tool info
   - Import the ToolDetectionDisplay component from GeneralSettings or recreate it
   - Add useEffect to fetch CLI tools info on mount

3. GeneralSettings.tsx:
   - Remove the section="paths" conditional branch
   - Export ToolDetectionDisplay if needed by DebugSettings

The nav should reduce from 11 to 9 items:
- appearance (merged with display)
- language
- devtools
- agent
- (paths removed)
- integrations
- api-profiles
- updates
- notifications
- debug (now includes paths display)

Then output: <promise>SETTINGS_3_PATHS_TO_DEBUG_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 4 promises were output
3. Output: <promise>FIX_20_SETTINGS_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. ALL 4 tasks are REQUIRED - no skipping
2. After each task, immediately continue to next
3. NO SUMMARIES - progress summaries are NOT stopping points
4. DO NOT break existing functionality
5. The job is done ONLY when <promise>FIX_20_SETTINGS_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>FIX_20_SETTINGS_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 4 tasks complete. BEGIN NOW.
" --max-iterations 150 --completion-promise "FIX_20_SETTINGS_COMPLETE"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `TerminalGrid.tsx` | Restructure to always show header toolbar |
| `GeneralSettings.tsx` | Remove agentFramework dropdown |
| `ThemeSettings.tsx` | Add UI Scale controls (merge display) |
| `AppSettings.tsx` | Remove 'display' and 'paths' from nav |
| `DebugSettings.tsx` | Add CLI tools info display |

---

## Verification After Run

1. Terminal page always shows header (New Terminal, New Claude Code, Files)
2. Settings nav has 9 items instead of 11
3. Agent settings no longer show agentFramework dropdown
4. Appearance section includes UI Scale
5. Debug section shows CLI tool detection info
6. Build passes

---

## Completion Promise

```
FIX_20_SETTINGS_COMPLETE
```

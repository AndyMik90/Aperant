# Settings Audit Report

**Date:** 2026-02-04
**Status:** Analysis Complete
**Purpose:** Identify outdated, redundant, or improvable settings

---

## Current Structure

### App Settings (11 sections)

| # | Section | Icon | Component | Purpose |
|---|---------|------|-----------|---------|
| 1 | appearance | Palette | ThemeSettings | Light/dark theme + color themes |
| 2 | display | Monitor | DisplaySettings | UI scale (75-200%) |
| 3 | language | Globe | LanguageSettings | EN/FR language |
| 4 | devtools | Code | DevToolsSettings | IDE + terminal preferences |
| 5 | agent | Bot | GeneralSettings | Agent profiles, models, thinking |
| 6 | paths | FolderOpen | GeneralSettings | CLI tool detection display |
| 7 | integrations | Key | IntegrationSettings | Claude OAuth + global API keys |
| 8 | api-profiles | Server | ProfileList | Custom API endpoints |
| 9 | updates | Package | AdvancedSettings | App updates, beta opt-in |
| 10 | notifications | Bell | AdvancedSettings | Task notifications |
| 11 | debug | Bug | DebugSettings | Logs, troubleshooting |

### Project Settings (6 sections)

| # | Section | Icon | Purpose |
|---|---------|------|---------|
| 1 | general | Settings2 | Project-level general settings |
| 2 | mcp | Server | MCP server configuration |
| 3 | linear | Zap | Linear integration |
| 4 | github | Github | GitHub integration |
| 5 | gitlab | GitLab | GitLab integration |
| 6 | memory | Database | Graphiti memory settings |

---

## Issues Found

### HIGH Priority - Should Fix

#### ISSUE-1: Agent Framework Dropdown (Useless)

**Location:** GeneralSettings.tsx lines 136-148
**Problem:** Dropdown with only ONE option ("auto-claude")
**Impact:** Confuses users, takes up space for no purpose

```tsx
<Select value={settings.agentFramework}>
  <SelectContent>
    <SelectItem value="auto-claude">Auto-Claude</SelectItem>
    <!-- Only one option! -->
  </SelectContent>
</Select>
```

**Recommendation:** Remove this setting entirely, or hide until multiple frameworks supported

---

#### ISSUE-2: Appearance + Display Should Merge

**Current:** 2 separate sections with 1 icon each
- Appearance: theme (light/dark/system), colorTheme (7 options)
- Display: uiScale (75-200%)

**Problem:** Too granular, user has to navigate between 2 sections for visual settings

**Recommendation:** Merge into single "Appearance" section:
- Theme mode
- Color theme
- UI Scale

---

#### ISSUE-3: Paths Section Has No Editable Settings

**Location:** GeneralSettings.tsx section="paths"
**Problem:** Only displays auto-detected CLI tool info (read-only). No user-configurable options visible.

**Current display:**
- Python: detected path, version, source
- Git: detected path, version, source
- GitHub CLI: detected path, version, source
- Claude CLI: detected path, version, source

**Recommendation:** Either:
1. Remove as standalone section (move display to Debug)
2. Or add user-configurable path overrides here

---

### MEDIUM Priority - Should Consider

#### ISSUE-4: Updates + Notifications Could Merge

**Current:** 2 separate sections that share AdvancedSettings component
- Updates: Check for updates, beta opt-in
- Notifications: 4 toggles (task complete, failed, review needed, sound)

**Recommendation:** Combine into "Preferences" or keep in "Advanced"

---

#### ISSUE-5: Integrations vs API Profiles Overlap

**Current:**
- Integrations: Claude OAuth, global API keys (OpenAI, Google, Groq, OpenRouter)
- API Profiles: Custom API endpoints

**Problem:** Similar purposes, user might be confused about where to put API keys

**Recommendation:** Consider:
1. Move global API keys into API Profiles as default profile
2. Or clarify distinction in UI with better descriptions

---

#### ISSUE-6: Redundant Model Selection

**Current:** Multiple places to set model:
- `defaultModel` in AppSettings
- `selectedAgentProfile` which has its own model
- `customPhaseModels` for per-phase override

**Problem:** `defaultModel` and profile model can get out of sync

**Note:** Migration code exists to sync these (`_migratedDefaultModelSync`)

**Recommendation:** Remove `defaultModel` field, always use profile-based model selection

---

### LOW Priority - Nice to Have

#### ISSUE-7: Legacy Migration Flags

**Flags:**
- `_migratedAgentProfileToAuto`
- `_migratedDefaultModelSync`

**Status:** Migrations likely complete for all users

**Recommendation:** Remove after next major version

---

#### ISSUE-8: dangerouslySkipPermissions Visible

**Location:** DevToolsSettings (as "YOLO Mode" toggle)

**Status:** Actually used for terminal permission skipping

**Recommendation:** Consider hiding in production or adding warning

---

#### ISSUE-9: autoUpdateAutoBuild Setting

**Location:** In AppSettings but not visible in any UI component

**Status:** May be dead/unused setting

**Recommendation:** Verify if implemented, remove if not

---

## Recommended Section Reorganization

### Current (11 App sections)
```
appearance → display → language → devtools → agent → paths → integrations → api-profiles → updates → notifications → debug
```

### Proposed (8 App sections)
```
appearance (merged) → language → devtools → agent → integrations (merged) → updates/notifications (merged) → debug
```

| Current | Proposed | Change |
|---------|----------|--------|
| appearance + display | appearance | MERGE - all visual settings |
| language | language | KEEP |
| devtools | devtools | KEEP |
| agent | agent | KEEP - remove agentFramework dropdown |
| paths | (remove) | REMOVE - move to debug or agent |
| integrations + api-profiles | integrations | MERGE - all API/auth settings |
| updates + notifications | preferences | MERGE - all preference toggles |
| debug | debug | KEEP - add paths display here |

---

## Ralph Task Candidates

Based on this audit, these could become Ralph tasks:

| Task ID | Description | Complexity | Files |
|---------|-------------|------------|-------|
| SETTINGS-1 | Remove agentFramework dropdown | Simple | 1 |
| SETTINGS-2 | Merge appearance + display sections | Medium | 3-4 |
| SETTINGS-3 | Clean up redundant defaultModel | Medium | 2-3 |
| SETTINGS-4 | Move paths display to debug | Simple | 2 |
| SETTINGS-5 | Merge integrations + api-profiles | Complex | 4-5 |

---

## Files Analyzed

| File | Purpose |
|------|---------|
| `settings.ts` | Type definitions (30+ settings) |
| `config.ts` | Default values |
| `models.ts` | Model/profile constants |
| `AppSettings.tsx` | Main dialog container |
| `GeneralSettings.tsx` | Agent + paths sections |
| `ThemeSettings.tsx` | Appearance section |
| `DisplaySettings.tsx` | UI scale section |

---

**Report Generated:** 2026-02-04

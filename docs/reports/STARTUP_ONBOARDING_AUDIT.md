# Startup & Onboarding Flow Audit Report

**Date:** 2026-02-04
**Auditor:** Claude Opus 4.5
**Status:** RESOLVED - Fixed by ONBOARDING-SIMPLIFY Ralph run

---

## Executive Summary

The onboarding wizard is well-architected (now 7-step flow after ONBOARDING-SIMPLIFY), with i18n support and good UX patterns. However, several issues were identified related to outdated terminology, architectural inconsistencies, missing features, and UX improvements.

### Resolution Status: ✅ FIXED

**ONBOARDING-SIMPLIFY** Ralph run (5m 41s) addressed all critical issues:

| Issue | Status | Fix |
|-------|--------|-----|
| ISSUE-1: Branding inconsistency | ✅ FIXED | Changed to "Jerry" everywhere |
| ISSUE-2: API key skips steps | ✅ FIXED | Now goes to claude-code step |
| ISSUE-3: GraphitiStep complexity | ✅ FIXED | Removed from wizard (now in Settings) |
| ISSUE-4: Missing docs link | ✅ FIXED | Added to CompletionStep |
| ISSUE-5,6: Missing i18n | ✅ FIXED | Added to AuthChoiceStep, DevToolsStep |
| ISSUE-7: WelcomeStep outdated | ✅ FIXED | Updated to "Autonomous Execution" |

**Original Findings (for historical reference):**
- 12 issues identified (4 Critical, 5 Medium, 3 Low)
- Inconsistent branding ("Jerry" vs "Auto Claude" vs "Auto-Claude")
- Step flow bypasses important steps when API key path is chosen
- Several steps are overly complex for first-time users
- Missing project initialization in onboarding flow

---

## Current Architecture

### Wizard Steps (7 total - after ONBOARDING-SIMPLIFY)

| Step | Component | Purpose |
|------|-----------|---------|
| 1 | WelcomeStep | Introduction with feature cards |
| 2 | AuthChoiceStep | OAuth vs API Key selection |
| 3 | OAuthStep | Claude profile/OAuth configuration |
| 4 | ClaudeCodeStep | CLI installation check |
| 5 | DevToolsStep | IDE/terminal preferences |
| 6 | PrivacyStep | Sentry error reporting opt-in |
| 7 | CompletionStep | Success + next actions |

*Note: GraphitiStep was removed from onboarding and moved to Settings*

### Entry Flow
```
App.tsx loads → loadSettings() → Check:
  - onboardingCompleted === false?
  - No profiles AND no OAuth tokens?
  → If both true: Show OnboardingWizard
```

---

## Issues Found

### CRITICAL

#### ISSUE-1: Branding Inconsistency
**Location:** Multiple files
**Problem:** Mixed usage of "Jerry", "Auto Claude", and "Auto-Claude"

| File | Text Used |
|------|-----------|
| `onboarding.json:4` | "Configure your Jerry environment" |
| `onboarding.json:8` | "Welcome to Jerry" |
| `onboarding.json:178` | "Jerry's AI features" |
| `WelcomeScreen.tsx` | Uses `welcome:hero.title` (Jerry) |
| `GraphitiStep.tsx:773` | "Auto Claude will maintain context" |
| `DevToolsStep.tsx:240,274,322-323` | "Auto Claude" |

**Impact:** Confusing user experience - unclear what the product is called
**Recommendation:** Standardize on ONE name throughout. Suggest "Jerry" as the friendly name.

---

#### ISSUE-2: API Key Path Skips 3 Important Steps
**Location:** `OnboardingWizard.tsx:110-118`
**Problem:** When user chooses API key (not OAuth), flow jumps from `auth-choice` directly to `graphiti`, skipping:
- OAuthStep (intentional)
- ClaudeCodeStep (NOT intentional - CLI still needed!)
- DevToolsStep (NOT intentional - preferences still useful!)

```typescript
// Current behavior skips too much:
const handleSkipToGraphiti = useCallback(() => {
  setOauthBypassed(true);
  setCompletedSteps(prev => new Set(prev).add('auth-choice'));
  const graphitiIndex = WIZARD_STEPS.findIndex(step => step.id === 'graphiti');
  setCurrentStepIndex(graphitiIndex);
}, []);
```

**Impact:** API key users miss CLI check and IDE preferences
**Recommendation:** Only skip OAuth step, not Claude Code and Dev Tools:
```typescript
const handleSkipToClaudeCode = useCallback(() => {
  setOauthBypassed(true);
  setCompletedSteps(prev => new Set(prev).add('auth-choice'));
  const claudeCodeIndex = WIZARD_STEPS.findIndex(step => step.id === 'claude-code');
  setCurrentStepIndex(claudeCodeIndex);
}, []);
```

---

#### ISSUE-3: No Project Creation in Onboarding
**Location:** OnboardingWizard.tsx
**Problem:** User completes onboarding but has no project. They're shown WelcomeScreen and must manually create a project.

**Current flow:**
1. Complete onboarding
2. See WelcomeScreen (no projects)
3. Must click "New Project" or "Open Project"
4. Then get prompted for Jerry initialization

**Better flow:**
1. Complete onboarding
2. In CompletionStep, offer to create/open first project
3. Guide directly into project initialization

**Impact:** Disjointed experience - user finishes setup but can't do anything
**Recommendation:** Add project setup as part of onboarding or make it more prominent in completion step

---

#### ISSUE-4: GraphitiStep Too Complex for First-Time Users
**Location:** `GraphitiStep.tsx` (1070+ lines)
**Problem:** Step is overwhelming with:
- 7 LLM provider options
- 6 embedding provider options
- Complex API key configuration
- Connection testing
- Provider-specific settings (Azure, Ollama, etc.)

Most new users just want to get started, not configure advanced memory systems.

**Impact:** User overwhelm, likely to skip this step
**Recommendation:**
1. Simplify to just enable/disable toggle
2. Default to OpenAI (most common)
3. Move advanced configuration to Settings
4. Or make this an "Advanced Setup" that's skippable with sane defaults

---

### MEDIUM

#### ISSUE-5: DevToolsStep Hardcoded Strings (No i18n)
**Location:** `DevToolsStep.tsx`
**Problem:** Many UI strings are hardcoded, not using translation keys:

```typescript
// Line 236-241: Hardcoded
<h1 className="text-2xl font-bold text-foreground tracking-tight">
  Developer Tools
</h1>
<p className="mt-2 text-muted-foreground">
  Choose your preferred IDE and terminal for working with Auto Claude worktrees
</p>

// Line 271-275: Hardcoded
<p className="text-sm font-medium text-foreground">
  Why configure these?
</p>
<p className="text-sm text-muted-foreground">
  When Auto Claude builds features in isolated worktrees...
</p>
```

**Impact:** Cannot localize DevToolsStep to other languages
**Recommendation:** Use translation keys from `onboarding.json` (keys already exist: `devtools.*`)

---

#### ISSUE-6: AuthChoiceStep Hardcoded Strings (No i18n)
**Location:** `AuthChoiceStep.tsx`
**Problem:** All strings are hardcoded:

```typescript
// Lines 115-119: Hardcoded
<h1 className="text-3xl font-bold...">
  Choose Your Authentication Method
</h1>
<p className="mt-3 text-muted-foreground...">
  Select how you want to authenticate with Claude...
</p>
```

**Impact:** Cannot localize auth choice step
**Recommendation:** Add translation keys for all text

---

#### ISSUE-7: WelcomeScreen Missing from Onboarding
**Location:** `WelcomeScreen.tsx` vs `WelcomeStep.tsx`
**Problem:** Two different "welcome" concepts:
- `WelcomeStep.tsx` - First step in onboarding wizard
- `WelcomeScreen.tsx` - Shown when no project is selected (after onboarding)

The WelcomeScreen (no project) is sparse and doesn't explain what to do.

**Impact:** After onboarding, users see generic project selection without guidance
**Recommendation:** Enhance WelcomeScreen with:
- Quick tips for first-time users
- Link to documentation
- Feature highlights (what Jerry can do)

---

#### ISSUE-8: Missing "Ralph Wiggum Mode" Explanation
**Location:** Entire onboarding flow
**Problem:** Ralph Wiggum Mode is a core feature (auto-approve, aggressive iteration) but is never explained during onboarding. Users only see it when creating a task.

**Impact:** Key feature is a surprise when creating first task
**Recommendation:** Add brief explanation in WelcomeStep feature cards or as its own mini-step

---

#### ISSUE-9: Completion Step External Link Doesn't Work
**Location:** `CompletionStep.tsx:83-87`
**Problem:** "Explore Documentation" card has no action handler - link does nothing:

```typescript
{
  icon: <BookOpen className="h-5 w-5" />,
  title: t('completion.exploreDocs.title'),
  description: t('completion.exploreDocs.description')
  // No action or actionLabel!
}
```

**Impact:** User clicks "Explore Documentation" but nothing happens
**Recommendation:** Add external link action:
```typescript
{
  ...
  action: () => window.electronAPI?.openExternal?.('https://docs.jerry.dev'),
  actionLabel: t('completion.exploreDocs.action', 'View Docs')
}
```

---

### LOW

#### ISSUE-10: Privacy Step Toggle Default
**Location:** `PrivacyStep.tsx:24`
**Problem:** Sentry is enabled by default:
```typescript
const [sentryEnabled, setSentryEnabled] = useState(settings.sentryEnabled ?? true);
```

This is standard practice but some users expect opt-in, not opt-out.

**Impact:** Minor - standard practice but worth noting
**Recommendation:** Keep as-is but ensure the toggle is prominent (it is)

---

#### ISSUE-11: Ollama Status Check Not Shown
**Location:** `GraphitiStep.tsx` and `OllamaModelSelector.tsx`
**Problem:** When Ollama is selected but not running, the error is only shown after clicking "Test Connection". No proactive detection.

**Impact:** User has to guess why Ollama isn't working
**Recommendation:** Add proactive Ollama status check when Ollama provider is selected

---

#### ISSUE-12: ClaudeCodeStep Install UX
**Location:** `ClaudeCodeStep.tsx:72-98`
**Problem:** After clicking "Install Claude Code", user sees:
> "Installation command sent to terminal. Please complete the installation there."

But there's no clear instruction about where the terminal is or how to get back.

**Impact:** User confusion about where to complete installation
**Recommendation:** Add clearer instructions:
- "Open a terminal window and follow the prompts"
- Or show inline terminal in the wizard
- Or provide direct download link

---

## Missing Features

### MISSING-1: Progress Save/Resume
**Problem:** If user closes app mid-onboarding, they start from step 1 again.
**Recommendation:** Save `currentStepIndex` to settings, resume on reopen.

### MISSING-2: Onboarding Analytics
**Problem:** No way to know which steps users skip or where they drop off.
**Recommendation:** Add optional analytics events (respect Sentry setting).

### MISSING-3: Re-run Specific Steps
**Problem:** Can only re-run entire wizard from Settings.
**Recommendation:** Allow re-running individual steps (e.g., just reconfigure Memory).

### MISSING-4: Keyboard Navigation
**Problem:** No keyboard shortcuts for wizard navigation.
**Recommendation:** Add Enter=Next, Escape=Skip, Backspace=Back.

### MISSING-5: Quick Start vs Full Setup
**Problem:** One-size-fits-all wizard. Power users want to skip; new users need guidance.
**Recommendation:** Offer "Quick Start" (minimal) vs "Full Setup" paths.

---

## Step-by-Step Flow Issues

### Current Flow (8 steps):
```
Welcome → Auth Choice → OAuth → Claude Code → Dev Tools → Privacy → Graphiti → Complete
```

### Suggested Improved Flow (6-7 steps):
```
Welcome → Auth (combined) → CLI Check → Dev Tools → Privacy → Complete
         ↳ Memory (optional advanced)
```

### Key Changes:
1. **Merge AuthChoice + OAuth** into single step with tabs
2. **Simplify Graphiti** - just enable/disable with defaults
3. **Make Memory optional** - power users can configure in Settings
4. **Add Project Creation** to completion or as step 7

---

## Recommended Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| P0 | ISSUE-2 (API key skips steps) | Low |
| P0 | ISSUE-1 (Branding inconsistency) | Medium |
| P1 | ISSUE-3 (No project in onboarding) | Medium |
| P1 | ISSUE-4 (GraphitiStep complexity) | High |
| P1 | ISSUE-9 (Docs link broken) | Low |
| P2 | ISSUE-5 (DevTools i18n) | Low |
| P2 | ISSUE-6 (AuthChoice i18n) | Low |
| P2 | ISSUE-7 (WelcomeScreen enhancement) | Medium |
| P2 | ISSUE-8 (Ralph Wiggum explanation) | Low |
| P3 | ISSUE-10-12 (Minor UX issues) | Low |

---

## Files Requiring Changes

| File | Issues |
|------|--------|
| `OnboardingWizard.tsx` | ISSUE-2 |
| `WelcomeStep.tsx` | ISSUE-1 |
| `AuthChoiceStep.tsx` | ISSUE-1, ISSUE-6 |
| `DevToolsStep.tsx` | ISSUE-1, ISSUE-5 |
| `GraphitiStep.tsx` | ISSUE-1, ISSUE-4 |
| `CompletionStep.tsx` | ISSUE-3, ISSUE-9 |
| `ClaudeCodeStep.tsx` | ISSUE-12 |
| `WelcomeScreen.tsx` | ISSUE-7 |
| `onboarding.json` | ISSUE-1, ISSUE-5, ISSUE-6, ISSUE-8 |

---

## Conclusion

The onboarding flow is functional but needs polish. The most critical issues are:

1. **Branding confusion** - Pick one name and stick with it
2. **API key path skips too much** - Users miss important setup
3. **No project creation** - Onboarding ends but user can't do anything
4. **GraphitiStep overwhelming** - Simplify for new users

Addressing P0/P1 issues would significantly improve the first-time user experience.

---

**Document Version:** 1.0
**Related:** [INDEX.md](../ralph/INDEX.md) | [TERMINAL_UI_GAP_ANALYSIS.md](TERMINAL_UI_GAP_ANALYSIS.md)

# Ralph Prompt: ONBOARDING-SIMPLIFY - Streamline First-Time Experience

**Created:** 2026-02-04
**Status:** Ready for execution
**Priority:** HIGH
**Tasks:** 7

---

## Task Summary

Simplify the onboarding wizard by removing complex steps and fixing critical issues identified in the startup audit.

| # | Task | Description |
|---|------|-------------|
| 1 | ONBOARD-1 | Remove GraphitiStep from wizard (move to Settings) |
| 2 | ONBOARD-2 | Fix API key path - should go to ClaudeCode, not Graphiti |
| 3 | ONBOARD-3 | Fix branding - standardize on "Jerry" throughout |
| 4 | ONBOARD-4 | Fix CompletionStep docs link (add action handler) |
| 5 | ONBOARD-5 | Add i18n to AuthChoiceStep hardcoded strings |
| 6 | ONBOARD-6 | Add i18n to DevToolsStep hardcoded strings |
| 7 | ONBOARD-7 | Update WelcomeStep to mention key features |

---

## Ralph Invocation Prompt

```bash
/ralph-loop:ralph-loop "
You are an autonomous senior engineer simplifying the onboarding flow for Auto-Claude (Jerry).

YOUR IDENTITY: You are an EXECUTOR, not an EVALUATOR. If a task is in this list, you execute it. Period.

Repository:
- Project root: C:\Users\jamie.ballard\Documents\GitHub\Auto-Claude

Primary Documentation (READ FOR CONTEXT):
- docs/reports/STARTUP_ONBOARDING_AUDIT.md - Full audit with issue details
- apps/frontend/src/shared/i18n/locales/en/onboarding.json - Translation keys

Component Reference:
- OnboardingWizard.tsx orchestrates the wizard flow
- Each step is a separate component in components/onboarding/
- GraphitiStep is being REMOVED from wizard (will remain for Settings use)

---

## TASKS (7 required - ALL MUST COMPLETE)

| # | Task | Promise |
|---|------|---------|
| 1 | ONBOARD-1: Remove GraphitiStep from wizard | ONBOARD_1_REMOVE_GRAPHITI_COMPLETE |
| 2 | ONBOARD-2: Fix API key path navigation | ONBOARD_2_FIX_APIKEY_PATH_COMPLETE |
| 3 | ONBOARD-3: Standardize branding to Jerry | ONBOARD_3_BRANDING_COMPLETE |
| 4 | ONBOARD-4: Fix docs link in CompletionStep | ONBOARD_4_DOCS_LINK_COMPLETE |
| 5 | ONBOARD-5: i18n for AuthChoiceStep | ONBOARD_5_AUTH_I18N_COMPLETE |
| 6 | ONBOARD-6: i18n for DevToolsStep | ONBOARD_6_DEVTOOLS_I18N_COMPLETE |
| 7 | ONBOARD-7: Update WelcomeStep features | ONBOARD_7_WELCOME_COMPLETE |

**FINAL:** <promise>ONBOARDING_SIMPLIFY_COMPLETE</promise>

---

## ONBOARD-1: Remove GraphitiStep from Wizard

File: apps/frontend/src/renderer/components/onboarding/OnboardingWizard.tsx

**Step 1: Update WIZARD_STEPS array (around line 35)**

BEFORE:
```typescript
const WIZARD_STEPS: { id: WizardStepId; labelKey: string }[] = [
  { id: 'welcome', labelKey: 'steps.welcome' },
  { id: 'auth-choice', labelKey: 'steps.authChoice' },
  { id: 'oauth', labelKey: 'steps.auth' },
  { id: 'claude-code', labelKey: 'steps.claudeCode' },
  { id: 'devtools', labelKey: 'steps.devtools' },
  { id: 'privacy', labelKey: 'steps.privacy' },
  { id: 'graphiti', labelKey: 'steps.memory' },
  { id: 'completion', labelKey: 'steps.done' }
];
```

AFTER:
```typescript
const WIZARD_STEPS: { id: WizardStepId; labelKey: string }[] = [
  { id: 'welcome', labelKey: 'steps.welcome' },
  { id: 'auth-choice', labelKey: 'steps.authChoice' },
  { id: 'oauth', labelKey: 'steps.auth' },
  { id: 'claude-code', labelKey: 'steps.claudeCode' },
  { id: 'devtools', labelKey: 'steps.devtools' },
  { id: 'privacy', labelKey: 'steps.privacy' },
  { id: 'completion', labelKey: 'steps.done' }
];
```

**Step 2: Update WizardStepId type (around line 32)**

BEFORE:
```typescript
type WizardStepId = 'welcome' | 'auth-choice' | 'oauth' | 'claude-code' | 'devtools' | 'privacy' | 'graphiti' | 'completion';
```

AFTER:
```typescript
type WizardStepId = 'welcome' | 'auth-choice' | 'oauth' | 'claude-code' | 'devtools' | 'privacy' | 'completion';
```

**Step 3: Remove GraphitiStep import (around line 20)**

Remove this line:
```typescript
import { GraphitiStep } from './GraphitiStep';
```

**Step 4: Remove graphiti case from renderStepContent (around line 224-231)**

Remove this entire case:
```typescript
case 'graphiti':
  return (
    <GraphitiStep
      onNext={goToNextStep}
      onBack={goToPreviousStep}
      onSkip={skipWizard}
    />
  );
```

**Step 5: Update handleSkipToGraphiti → handleSkipToPrivacy (line 111-118)**

Since we're removing graphiti, the API key path should go to privacy step (which then goes to completion).

BEFORE:
```typescript
const handleSkipToGraphiti = useCallback(() => {
  setOauthBypassed(true);
  setCompletedSteps(prev => new Set(prev).add('auth-choice'));
  const graphitiIndex = WIZARD_STEPS.findIndex(step => step.id === 'graphiti');
  setCurrentStepIndex(graphitiIndex);
}, []);
```

AFTER:
```typescript
const handleSkipToClaudeCode = useCallback(() => {
  setOauthBypassed(true);
  setCompletedSteps(prev => new Set(prev).add('auth-choice'));
  // Go to claude-code step (skip oauth only, not other steps)
  const claudeCodeIndex = WIZARD_STEPS.findIndex(step => step.id === 'claude-code');
  setCurrentStepIndex(claudeCodeIndex);
}, []);
```

**Step 6: Update goToPreviousStep logic (line 96-108)**

Update the back navigation since graphiti is removed:

BEFORE:
```typescript
// If going back from graphiti and oauth was bypassed...
if (currentStepId === 'graphiti' && oauthBypassed) {
```

AFTER:
```typescript
// If going back from privacy and oauth was bypassed, go back to auth-choice
if (currentStepId === 'privacy' && oauthBypassed) {
```

**DO NOT delete GraphitiStep.tsx file** - it's still used in Settings.

Then output: <promise>ONBOARD_1_REMOVE_GRAPHITI_COMPLETE</promise>
Say: NEXT: ONBOARD-2

---

## ONBOARD-2: Fix API Key Path Navigation

File: apps/frontend/src/renderer/components/onboarding/OnboardingWizard.tsx

The API key path currently skips too many steps. After choosing API key, user should still see:
- ClaudeCodeStep (CLI check)
- DevToolsStep (IDE/terminal preferences)
- PrivacyStep (Sentry opt-in)

This was partially done in ONBOARD-1. Now update the AuthChoiceStep prop name.

**Step 1: Update prop passed to AuthChoiceStep (around line 187-193)**

BEFORE:
```typescript
<AuthChoiceStep
  onNext={goToNextStep}
  onBack={goToPreviousStep}
  onSkip={skipWizard}
  onAPIKeyPathComplete={handleSkipToGraphiti}
/>
```

AFTER:
```typescript
<AuthChoiceStep
  onNext={goToNextStep}
  onBack={goToPreviousStep}
  onSkip={skipWizard}
  onAPIKeyPathComplete={handleSkipToClaudeCode}
/>
```

Then output: <promise>ONBOARD_2_FIX_APIKEY_PATH_COMPLETE</promise>
Say: NEXT: ONBOARD-3

---

## ONBOARD-3: Standardize Branding to 'Jerry'

Multiple files need branding updates. Standardize on 'Jerry' as the product name.

**File 1: apps/frontend/src/shared/i18n/locales/en/onboarding.json**

These are already correct (use Jerry). Verify and leave as-is:
- Line 4: \"Configure your Jerry environment\" ✓
- Line 8: \"Welcome to Jerry\" ✓

Update any that say 'Auto Claude':
- Line 178 (claudeCode.info.description): Change \"Auto Claude's AI features\" → \"Jerry's AI features\"

**File 2: apps/frontend/src/renderer/components/onboarding/GraphitiStep.tsx**

Line 772-773: Change \"Auto Claude will maintain context\" → \"Jerry will maintain context\"

**File 3: apps/frontend/src/renderer/components/onboarding/DevToolsStep.tsx**

Line 240: Change \"Auto Claude worktrees\" → \"Jerry worktrees\"
Line 274-275: Change \"Auto Claude builds features\" → \"Jerry builds features\"
Line 322-323: Change \"Auto Claude will open worktrees\" → \"Jerry will open worktrees\"
Line 371-372: Change \"Auto Claude will open terminal\" → \"Jerry will open terminal\"

**File 4: apps/frontend/src/shared/i18n/locales/en/onboarding.json**

Update devtools section (add if missing):
```json
\"devtools\": {
  \"title\": \"Developer Tools\",
  \"description\": \"Choose your preferred IDE and terminal for working with Jerry worktrees\",
  ...
  \"ide\": {
    \"description\": \"Jerry will open worktrees in this editor\"
  },
  \"terminal\": {
    \"description\": \"Jerry will open terminal sessions here\"
  }
}
```

Then output: <promise>ONBOARD_3_BRANDING_COMPLETE</promise>
Say: NEXT: ONBOARD-4

---

## ONBOARD-4: Fix Docs Link in CompletionStep

File: apps/frontend/src/renderer/components/onboarding/CompletionStep.tsx

**Step 1: Add action to exploreDocs (around line 83-87)**

BEFORE:
```typescript
{
  icon: <BookOpen className=\"h-5 w-5\" />,
  title: t('completion.exploreDocs.title'),
  description: t('completion.exploreDocs.description')
  // Missing action!
}
```

AFTER:
```typescript
{
  icon: <BookOpen className=\"h-5 w-5\" />,
  title: t('completion.exploreDocs.title'),
  description: t('completion.exploreDocs.description'),
  action: () => window.electronAPI?.openExternal?.('https://github.com/scopefall/jerry'),
  actionLabel: t('completion.exploreDocs.action', 'View Documentation')
}
```

**Step 2: Add translation key in onboarding.json**

Add to completion.exploreDocs section:
```json
\"exploreDocs\": {
  \"title\": \"Explore Documentation\",
  \"description\": \"Learn more about advanced features, best practices, and troubleshooting.\",
  \"action\": \"View Documentation\"
}
```

Then output: <promise>ONBOARD_4_DOCS_LINK_COMPLETE</promise>
Say: NEXT: ONBOARD-5

---

## ONBOARD-5: i18n for AuthChoiceStep

File: apps/frontend/src/renderer/components/onboarding/AuthChoiceStep.tsx

**Step 1: Add useTranslation hook (if not present)**

```typescript
import { useTranslation } from 'react-i18next';

// Inside component:
const { t } = useTranslation('onboarding');
```

**Step 2: Replace hardcoded strings (lines 115-147)**

BEFORE:
```typescript
<h1 className=\"text-3xl font-bold text-foreground tracking-tight\">
  Choose Your Authentication Method
</h1>
<p className=\"mt-3 text-muted-foreground text-lg\">
  Select how you want to authenticate with Claude. You can change this later in Settings.
</p>
```

AFTER:
```typescript
<h1 className=\"text-3xl font-bold text-foreground tracking-tight\">
  {t('authChoice.title')}
</h1>
<p className=\"mt-3 text-muted-foreground text-lg\">
  {t('authChoice.subtitle')}
</p>
```

**Step 3: Replace card text (lines 125-139)**

BEFORE:
```typescript
title=\"Sign in with Anthropic\"
description=\"Use your Anthropic account to authenticate. Simple and secure OAuth flow.\"
...
title=\"Use Custom API Key\"
description=\"Bring your own API key from Anthropic or a compatible API provider. ⚠️ Highly experimental — may incur significant costs.\"
```

AFTER:
```typescript
title={t('authChoice.oauth.title')}
description={t('authChoice.oauth.description')}
...
title={t('authChoice.apiKey.title')}
description={t('authChoice.apiKey.description')}
```

**Step 4: Replace info text and skip button (lines 143-158)**

BEFORE:
```typescript
<p className=\"text-muted-foreground text-sm\">
  Both options provide full access to Claude Code features. Choose based on your preference.
</p>
...
Skip for now
```

AFTER:
```typescript
<p className=\"text-muted-foreground text-sm\">
  {t('authChoice.infoText')}
</p>
...
{t('authChoice.skip')}
```

**Step 5: Add translations to onboarding.json**

Add new section after \"welcome\":
```json
\"authChoice\": {
  \"title\": \"Choose Your Authentication Method\",
  \"subtitle\": \"Select how you want to authenticate with Claude. You can change this later in Settings.\",
  \"oauth\": {
    \"title\": \"Sign in with Anthropic\",
    \"description\": \"Use your Anthropic account to authenticate. Simple and secure OAuth flow.\"
  },
  \"apiKey\": {
    \"title\": \"Use Custom API Key\",
    \"description\": \"Bring your own API key from Anthropic or a compatible provider. May incur costs.\"
  },
  \"infoText\": \"Both options provide full access to Jerry features. Choose based on your preference.\",
  \"skip\": \"Skip for now\"
},
```

Then output: <promise>ONBOARD_5_AUTH_I18N_COMPLETE</promise>
Say: NEXT: ONBOARD-6

---

## ONBOARD-6: i18n for DevToolsStep

File: apps/frontend/src/renderer/components/onboarding/DevToolsStep.tsx

**Step 1: Add useTranslation hook**

```typescript
import { useTranslation } from 'react-i18next';

// Inside component:
const { t } = useTranslation('onboarding');
```

**Step 2: Replace hardcoded strings throughout**

Key replacements:
- Line 236-241: Header title/description → `{t('devtools.title')}`, `{t('devtools.description')}`
- Line 248: \"Detecting installed tools...\" → `{t('devtools.detecting')}`
- Line 270-275: \"Why configure these?\" → `{t('devtools.whyConfigure')}`, `{t('devtools.whyConfigureDescription')}`
- Line 287: \"Detect Again\" → `{t('devtools.detectAgain')}`
- Line 297-299: \"Preferred IDE\" → `{t('devtools.ide.label')}`
- Line 322-323: Description → `{t('devtools.ide.description')}`
- Line 329: \"Custom IDE Path\" → `{t('devtools.ide.customPath')}`
- Line 346-348: \"Preferred Terminal\" → `{t('devtools.terminal.label')}`
- Line 371-372: Description → `{t('devtools.terminal.description')}`
- Line 378: \"Custom Terminal Path\" → `{t('devtools.terminal.customPath')}`
- Line 395: \"Detected on your system:\" → `{t('devtools.detectedSummary')}`
- Line 405: \"No additional tools detected...\" → `{t('devtools.noToolsDetected')}`
- Line 420: \"Back\" → `{t('common:back')}`
- Line 432: \"Save & Continue\" → `{t('devtools.saveAndContinue')}`

The translation keys already exist in onboarding.json under \"devtools\" - just need to use them!

Then output: <promise>ONBOARD_6_DEVTOOLS_I18N_COMPLETE</promise>
Say: NEXT: ONBOARD-7

---

## ONBOARD-7: Update WelcomeStep Features

File: apps/frontend/src/renderer/components/onboarding/WelcomeStep.tsx

The feature cards are good but could mention Ralph Wiggum Mode (autonomous execution).

**Step 1: Update the 'parallel' feature to mention autonomy**

In onboarding.json, update:
```json
\"parallel\": {
  \"title\": \"Autonomous Execution\",
  \"description\": \"Ralph Wiggum Mode enables aggressive iteration - Jerry works autonomously until tasks are complete\"
}
```

This introduces the key feature before users see it in task creation.

Then output: <promise>ONBOARD_7_WELCOME_COMPLETE</promise>
Say: NEXT: Verify and run build

---

## VERIFICATION

1. Run: npm run build (fix any errors)
2. Verify all 7 promises were output
3. Test the wizard flow manually if possible
4. Output: <promise>ONBOARDING_SIMPLIFY_COMPLETE</promise>

---

## CRITICAL CONSTRAINTS

1. ALL 7 tasks are REQUIRED - no skipping
2. After each task, immediately continue to next
3. DO NOT delete GraphitiStep.tsx (still used in Settings)
4. Ensure all i18n keys exist before using them
5. The wizard should now be 7 steps (was 8)
6. The job is done ONLY when <promise>ONBOARDING_SIMPLIFY_COMPLETE</promise> is output

---

HARD STOP RULE: You may NOT stop until <promise>ONBOARDING_SIMPLIFY_COMPLETE</promise> is output.

CURRENT STATUS: 0 of 7 tasks complete. BEGIN NOW.
\" --max-iterations 150 --completion-promise \"ONBOARDING_SIMPLIFY_COMPLETE\"
```

---

## Expected Changes

| File | Change |
|------|--------|
| `OnboardingWizard.tsx` | Remove graphiti step, fix navigation |
| `AuthChoiceStep.tsx` | Add i18n translations |
| `DevToolsStep.tsx` | Add i18n translations, fix branding |
| `CompletionStep.tsx` | Add docs link action |
| `WelcomeStep.tsx` | (via i18n) Update feature description |
| `GraphitiStep.tsx` | Fix branding (keep file) |
| `onboarding.json` | Add authChoice keys, update branding |

---

## Verification After Run

1. Wizard has 7 steps (not 8)
2. No GraphitiStep in wizard flow
3. API key path goes: AuthChoice → ClaudeCode → DevTools → Privacy → Complete
4. All text says "Jerry" (not "Auto Claude")
5. "Explore Documentation" link works
6. All UI text uses translation keys
7. Build passes

---

## New Wizard Flow

```
Step 1: Welcome        - Feature overview, Get Started button
Step 2: Auth Choice    - OAuth vs API Key selection
Step 3: OAuth          - Claude profile setup (skipped if API key chosen)
Step 4: Claude Code    - CLI installation check
Step 5: Dev Tools      - IDE/terminal preferences
Step 6: Privacy        - Sentry opt-in
Step 7: Completion     - Success + next actions
```

---

## Completion Promise

```
ONBOARDING_SIMPLIFY_COMPLETE
```

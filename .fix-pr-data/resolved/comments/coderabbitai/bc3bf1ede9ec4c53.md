# Comment: bc3bf1ede9ec4c53

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/LinearDashboard.tsx`
**Original ID:** 2713898525
**Created:** None
**Severity:** MEDIUM
**Status:** RESOLVED

---

## Original Content

_⚠️ Potential issue_ | _🟡 Minor_

**Hardcoded English string violates i18n requirements.**

The string "Try adjusting your filters or search terms" must use an i18n translation key per coding guidelines.

<details>
<summary>🌐 Proposed fix</summary>

```diff
         {hasFilters && (
           <div className="flex items-center justify-center gap-2 text-sm bg-muted/50 rounded-lg p-3">
             <Info className="h-4 w-4" />
-            <span>Try adjusting your filters or search terms</span>
+            <span>{t("linear.adjustFiltersHint")}</span>
           </div>
         )}
```

Note: You'll need to pass the `t` function to `EmptyState` as a prop, similar to `NotConnectedState`.
</details>

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/frontend/src/renderer/components/linear/LinearDashboard.tsx` around
lines 55 - 63, Replace the hardcoded English message in LinearDashboard's
empty-state block with an i18n key: call the translation function t(...) instead
of the literal "Try adjusting your filters or search terms", e.g.
t('linear.empty.adjustFilters') and add that key to your locale files; update
the EmptyState component usage in LinearDashboard.tsx to accept and pass the t
prop (same pattern as NotConnectedState) so EmptyState can render translated
text, and ensure the EmptyState component signature (prop name t) and any places
that render the message use t(...) instead of a hardcoded string.
```

</details>

<!-- fingerprinting:phantom:medusa:ocelot -->

<!-- This is an auto-generated comment by CodeRabbit -->

✅ Addressed in commits 26b4487 to e532ad1

---

## Suggested Fix

```typescript
Note: You'll need to pass the `t` function to `EmptyState` as a prop, similar to `NotConnectedState`.
</details>

<details>
<summary>🤖 Prompt for AI Agents</summary>
```

---

## Implementation Notes

*Status: RESOLVED*

**Resolution:** Body contains resolution marker

**Resolved At:** 2026-01-28T15:40:10.366716


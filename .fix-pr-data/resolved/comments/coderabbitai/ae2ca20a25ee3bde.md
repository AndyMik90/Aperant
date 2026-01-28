# Comment: ae2ca20a25ee3bde

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/components/LinearTicketItem.tsx`
**Line:** 185
**Original ID:** 2736972183
**Created:** None
**Severity:** MEDIUM
**Status:** RESOLVED

---

## Original Content

_🧹 Nitpick_ | _🔵 Trivial_

**Remove redundant screen reader text.**

The `SrOnly` span (line 183) duplicates the visible label text (line 181). Since `aria-live="polite"` is on the parent container, the visible status label is already announced. The redundant SR text may cause double announcements.



<details>
<summary>♻️ Proposed fix</summary>

```diff
 			{statusDisplay && (
-				<>
-					<span className={cn("text-xs font-medium", statusDisplay.textColor)}>
-						{statusDisplay.label}
-					</span>
-					<SrOnly>{getValidationSrText()}</SrOnly>
-				</>
+				<span className={cn("text-xs font-medium", statusDisplay.textColor)}>
+					{statusDisplay.label}
+				</span>
 			)}
```
</details>

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/frontend/src/renderer/components/linear/components/LinearTicketItem.tsx`
around lines 178 - 185, Redundant screen-reader text: remove the SrOnly element
that duplicates the visible status label to avoid double announcements—inside
the LinearTicketItem component where you render statusDisplay (the span showing
statusDisplay.label) and call getValidationSrText(), delete the
<SrOnly>{getValidationSrText()}</SrOnly> so the parent aria-live="polite"
announcement of the visible label is the sole announcement; if there are edge
cases where extra context is required, adjust getValidationSrText() to return an
empty string and keep SrOnly removed.
```

</details>

<!-- fingerprinting:phantom:poseidon:ocelot -->

<!-- This is an auto-generated comment by CodeRabbit -->

---

## Suggested Fix

```typescript
</details>

<details>
<summary>🤖 Prompt for AI Agents</summary>
```

---

## Implementation Notes

*Status: RESOLVED*

**Resolution:** Removed redundant SrOnly wrapper - role='status' with aria-live already announces visible label

### Fix Commit

`8ee52510e8e0d87131d4f040b9c16f5feb57dc89`
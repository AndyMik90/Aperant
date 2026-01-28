# Comment: dff9cb7ee47e8d9c

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/components/LinearTicketDetail.tsx`
**Line:** 215
**Original ID:** 2736122916
**Created:** None
**Severity:** HIGH
**Status:** PENDING

---

## Original Content

_🧹 Nitpick_ | _🔵 Trivial_

**Consider explicit locale for date formatting.**

`toLocaleDateString()` without arguments uses the browser's default locale, which may produce inconsistent date formats across users. For a consistent UX, consider using `Intl.DateTimeFormat` with explicit options or the i18n library's date formatting utilities.


<details>
<summary>♻️ Example with explicit formatting</summary>

```diff
 <div
   className="px-2 py-1 rounded-md bg-secondary text-sm text-muted-foreground"
   role="listitem"
 >
-  {new Date(ticket.createdAt).toLocaleDateString()}
+  {new Intl.DateTimeFormat(undefined, { 
+    year: 'numeric', 
+    month: 'short', 
+    day: 'numeric' 
+  }).format(new Date(ticket.createdAt))}
 </div>
```
</details>

<!-- suggestion_start -->

<details>
<summary>📝 Committable suggestion</summary>

> ‼️ **IMPORTANT**
> Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements.

```suggestion
				<div
					className="px-2 py-1 rounded-md bg-secondary text-sm text-muted-foreground"
					role="listitem"
				>
					{new Intl.DateTimeFormat(undefined, { 
					    year: 'numeric', 
					    month: 'short', 
					    day: 'numeric' 
					  }).format(new Date(ticket.createdAt))}
				</div>
```

</details>

<!-- suggestion_end -->

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In
`@apps/frontend/src/renderer/components/linear/components/LinearTicketDetail.tsx`
around lines 210 - 215, The date rendering in LinearTicketDetail currently uses
new Date(ticket.createdAt).toLocaleDateString(), which can vary by user locale;
change this to use an explicit formatter (e.g., Intl.DateTimeFormat with a
specified locale and options or your app i18n date formatter) when rendering the
createdAt value so the output is consistent across users; update the JSX in
LinearTicketDetail where the div currently contains new
Date(ticket.createdAt).toLocaleDateString() to call the chosen formatter
(keeping the same element and role attributes).
```

</details>

<!-- fingerprinting:phantom:medusa:ocelot -->

<!-- This is an auto-generated comment by CodeRabbit -->

---

## Suggested Fix

```typescript
</details>

<!-- suggestion_end -->

<details>
<summary>🤖 Prompt for AI Agents</summary>
```

---

## Implementation Notes

*Status: PENDING - Not yet verified or implemented*

### Verification Checklist

- [ ] Read file at comment location
- [ ] Verify if issue is already fixed
- [ ] Implement fix if needed
- [ ] Re-verify after implementation


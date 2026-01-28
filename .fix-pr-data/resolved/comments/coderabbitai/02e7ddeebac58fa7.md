# Comment: 02e7ddeebac58fa7

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/components/LinearTicketDetail.tsx`
**Line:** 41
**Original ID:** 2736267933
**Created:** None
**Severity:** MEDIUM
**Status:** SKIPPED

---

## Original Content

_⚠️ Potential issue_ | _🟡 Minor_

**Scroll reset doesn’t reset the panel’s internal scroll position.**

`scrollIntoView` moves the container into view but doesn’t change its own `scrollTop`, so switching tickets can leave the old scroll offset. Use `scrollTo` on the scroll container instead.

<details>
<summary>🐛 Suggested fix</summary>

```diff
-		if (detailRef.current) {
-			detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
-		}
+		detailRef.current?.scrollTo({ top: 0, behavior: "smooth" });
```
</details>

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In
`@apps/frontend/src/renderer/components/linear/components/LinearTicketDetail.tsx`
around lines 37 - 41, The effect that runs when the ticket changes currently
calls detailRef.current.scrollIntoView which only moves the element into view
but doesn't reset its internal scroll position; update the useEffect so that
when detailRef.current exists you call its scroll container's scrollTo (e.g.,
detailRef.current.scrollTo({ top: 0, behavior: "smooth" })) or set scrollTop = 0
to reset the panel internal scroll position instead of using scrollIntoView;
locate the useEffect and detailRef in LinearTicketDetail.tsx and replace the
scrollIntoView call with a scrollTo/scrollTop reset on detailRef.current.
```

</details>

<!-- fingerprinting:phantom:medusa:eagle -->

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

*Status: SKIPPED*

**Resolution:** Trivial nitpick or refactor suggestion
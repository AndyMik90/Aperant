# Comment: 0dd0d37aa9f6bdd9

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/hooks/useLinearTickets.ts`
**Line:** 175
**Original ID:** 2736267948
**Created:** None
**Severity:** HIGH
**Status:** PENDING

---

## Original Content

_⚠️ Potential issue_ | _🟠 Major_

**`append` flag doesn’t affect the fetched data (pagination bug).**

`append` only toggles loading state, but `fetchLinearTickets()` always replaces the list. Infinite scroll will keep replacing tickets instead of appending. Either pass an `append` flag to the store and append there, or remove `append`/`loadMore` to avoid misleading behavior.

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/frontend/src/renderer/components/linear/hooks/useLinearTickets.ts`
around lines 133 - 175, The append flag in fetchTicketsData is only toggling UI
state but not passed to or respected by fetchLinearTickets, so pagination just
replaces items; update the flow to either (A) pass the append boolean into
fetchLinearTickets (and update the store method that implements
fetchLinearTickets to accept an append parameter and append new items to the
existing list instead of replacing them) or (B) remove the append/loadMore logic
from fetchTicketsData (remove setIsLoadingMore and the append param) to avoid
misleading behavior; locate fetchTicketsData in useLinearTickets.ts and the
fetchLinearTickets implementation in the linear store and implement the chosen
change so that append actually appends or is removed consistently.
```

</details>

<!-- fingerprinting:phantom:medusa:eagle -->

<!-- This is an auto-generated comment by CodeRabbit -->

---

## Implementation Notes

*Status: PENDING - Not yet verified or implemented*

### Verification Checklist

- [ ] Read file at comment location
- [ ] Verify if issue is already fixed
- [ ] Implement fix if needed
- [ ] Re-verify after implementation


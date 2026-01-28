# Comment: ec2e16a126ab7cea

**Source:** sentry
**Type:** comment
**File:** `apps/frontend/src/main/ipc-handlers/linear-handlers.ts`
**Original ID:** 2734015254
**Created:** None
**Severity:** HIGH
**Status:** PENDING

---

## Original Content

**Bug:** The `Authorization` header for Linear API calls in `linear-handlers.ts` is missing the required 'Bearer ' prefix, which will cause all requests to fail with 401 Unauthorized errors.
<sub>Severity: HIGH</sub>
<!-- BUG_PREDICTION -->

<details>
<summary><b title="Reference ID: `9290906`">Suggested Fix</b></summary>

In `apps/frontend/src/main/ipc-handlers/linear-handlers.ts`, update the `Authorization` header to prepend the `Bearer ` prefix to the API key. Change `Authorization: apiKey,` to `Authorization: `Bearer ${apiKey}`,`.
</details>

<details open>
<summary><b title="Reference ID: `9290906`">Prompt for AI Agent</b></summary>

```
Review the code at the location below. A potential bug has been identified by an AI
agent.
Verify if this is a real issue. If it is, propose a fix; if not, explain why it's not
valid.

Location: apps/frontend/src/main/ipc-handlers/linear-handlers.ts#L70

Potential issue: The `linearGraphQL` function sends API requests to Linear with an
`Authorization` header that is missing the required `Bearer ` prefix. The value is set
directly to `apiKey` instead of `Bearer ${apiKey}`. This will cause all
frontend-initiated Linear API calls, such as `LINEAR_CHECK_CONNECTION`,
`LINEAR_GET_TEAMS`, and `LINEAR_IMPORT_ISSUES`, to be rejected by the Linear API with a
401 Unauthorized error. This effectively breaks the entire Linear integration feature
from the user interface, as other parts of the codebase have already been updated to
include this prefix to fix this exact issue.
```
</details>

<!--
<sub>Reference ID: `9290906`</sub>-->

---

## Suggested Fix

```typescript
Review the code at the location below. A potential bug has been identified by an AI
agent.
Verify if this is a real issue. If it is, propose a fix; if not, explain why it's not
valid.

Location: apps/frontend/src/main/ipc-handlers/linear-handlers.ts#L70

Potential issue: The `linearGraphQL` function sends API requests to Linear with an
`Authorization` header that is missing the required `Bearer ` prefix. The value is set
directly to `apiKey` instead of `Bearer ${apiKey}`. This will cause all
frontend-initiated Linear API calls, such as `LINEAR_CHECK_CONNECTION`,
`LINEAR_GET_TEAMS`, and `LINEAR_IMPORT_ISSUES`, to be rejected by the Linear API with a
401 Unauthorized error. This effectively breaks the entire Linear integration feature
from the user interface, as other parts of the codebase have already been updated to
include this prefix to fix this exact issue.
```

---

## Implementation Notes

*Status: PENDING - Not yet verified or implemented*

### Verification Checklist

- [ ] Read file at comment location
- [ ] Verify if issue is already fixed
- [ ] Implement fix if needed
- [ ] Re-verify after implementation

